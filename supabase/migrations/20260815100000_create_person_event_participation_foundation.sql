-- Canonical Person x Event Participation Foundation.
--
-- Participation is distinct from identity evidence (person_role_instances),
-- registration state, Assignment, Authority, Workspace, and Event Lifecycle.
-- An Event becoming inactive, completed, post-event, or archived never
-- changes a participation row.  Only an explicit governed revocation does.

BEGIN;

CREATE TABLE public.person_event_participations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participation_state text NOT NULL DEFAULT 'eligible'
    CHECK (participation_state IN ('eligible', 'revoked')),
  established_at timestamptz NOT NULL DEFAULT now(),
  established_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoked_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_event_participations_one_per_person_event UNIQUE (person_id, event_id),
  CONSTRAINT person_event_participations_revocation_consistency CHECK (
    (participation_state = 'eligible'
      AND revoked_at IS NULL
      AND revoked_by_auth_user_id IS NULL
      AND revoked_reason IS NULL)
    OR
    (participation_state = 'revoked'
      AND revoked_at IS NOT NULL
      AND nullif(btrim(coalesce(revoked_reason, '')), '') IS NOT NULL)
  )
);

CREATE INDEX person_event_participations_person_state_idx
  ON public.person_event_participations (person_id, participation_state);
CREATE INDEX person_event_participations_event_idx
  ON public.person_event_participations (event_id);

CREATE OR REPLACE FUNCTION public.set_person_event_participations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_person_event_participations_updated_at
BEFORE UPDATE ON public.person_event_participations
FOR EACH ROW EXECUTE FUNCTION public.set_person_event_participations_updated_at();

-- Evidence and lifecycle history deliberately have no foreign keys to their
-- operational source rows.  A source attendee/household row may be corrected
-- or deleted without erasing the canonical Participation or its provenance.
CREATE TABLE public.person_event_participation_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participation_id uuid NOT NULL REFERENCES public.person_event_participations(id) ON DELETE CASCADE,
  lifecycle_action text NOT NULL
    CHECK (lifecycle_action IN ('established', 'evidence_added', 'revoked', 'restored')),
  source_kind text NOT NULL CHECK (btrim(source_kind) <> ''),
  source_table text,
  source_record_id uuid,
  source_role_kind text CHECK (source_role_kind IS NULL OR btrim(source_role_kind) <> ''),
  source_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  actor_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_event_participation_evidence_action_shape CHECK (
    (lifecycle_action IN ('established', 'evidence_added')
      AND source_table IS NOT NULL
      AND source_record_id IS NOT NULL
      AND source_role_kind IS NOT NULL)
    OR
    (lifecycle_action = 'revoked'
      AND nullif(btrim(coalesce(reason, '')), '') IS NOT NULL)
    OR lifecycle_action = 'restored'
  )
);

CREATE INDEX person_event_participation_evidence_participation_idx
  ON public.person_event_participation_evidence (participation_id, occurred_at);
CREATE UNIQUE INDEX person_event_participation_evidence_source_unique
  ON public.person_event_participation_evidence (
    participation_id, source_kind, source_table, source_record_id, source_role_kind
  )
  WHERE lifecycle_action IN ('established', 'evidence_added');

CREATE OR REPLACE FUNCTION public.prevent_person_event_participation_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'person_event_participation_evidence is immutable';
END;
$$;

CREATE TRIGGER prevent_person_event_participation_evidence_mutation_trigger
BEFORE UPDATE OR DELETE ON public.person_event_participation_evidence
FOR EACH ROW EXECUTE FUNCTION public.prevent_person_event_participation_evidence_mutation();

-- This internal writer is deliberately not executable by browser roles.
-- Future claim/reconciliation paths may call it only after they have already
-- made a governed Person attribution for the exact Event source evidence.
CREATE OR REPLACE FUNCTION public.establish_person_event_participation_from_governed_evidence(
  p_person_id uuid,
  p_event_id uuid,
  p_source_kind text,
  p_source_table text,
  p_source_record_id uuid,
  p_source_role_kind text,
  p_actor_auth_user_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_provenance jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_participation_id uuid;
  v_was_created boolean := false;
BEGIN
  IF p_person_id IS NULL
    OR p_event_id IS NULL
    OR nullif(btrim(p_source_kind), '') IS NULL
    OR nullif(btrim(p_source_table), '') IS NULL
    OR p_source_record_id IS NULL
    OR nullif(btrim(p_source_role_kind), '') IS NULL THEN
    RAISE EXCEPTION 'participation evidence requires governed Person, Event, source, and role evidence';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.people p WHERE p.id = p_person_id) THEN
    RAISE EXCEPTION 'participation Person does not exist';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id) THEN
    RAISE EXCEPTION 'participation Event does not exist';
  END IF;

  INSERT INTO public.person_event_participations (
    person_id, event_id, established_by_auth_user_id
  )
  VALUES (p_person_id, p_event_id, p_actor_auth_user_id)
  ON CONFLICT (person_id, event_id) DO NOTHING
  RETURNING id INTO v_participation_id;

  v_was_created := v_participation_id IS NOT NULL;

  IF NOT v_was_created THEN
    SELECT pep.id
      INTO v_participation_id
    FROM public.person_event_participations pep
    WHERE pep.person_id = p_person_id
      AND pep.event_id = p_event_id
    FOR UPDATE;

    IF (SELECT pep.participation_state
        FROM public.person_event_participations pep
        WHERE pep.id = v_participation_id) = 'revoked' THEN
      RAISE EXCEPTION 'revoked participation cannot be re-established without an explicit governed restore';
    END IF;
  END IF;

  INSERT INTO public.person_event_participation_evidence (
    participation_id,
    lifecycle_action,
    source_kind,
    source_table,
    source_record_id,
    source_role_kind,
    source_event_id,
    actor_auth_user_id,
    reason,
    provenance
  )
  VALUES (
    v_participation_id,
    CASE WHEN v_was_created THEN 'established' ELSE 'evidence_added' END,
    p_source_kind,
    p_source_table,
    p_source_record_id,
    p_source_role_kind,
    p_event_id,
    p_actor_auth_user_id,
    p_reason,
    coalesce(p_provenance, '{}'::jsonb)
  )
  ON CONFLICT DO NOTHING;

  RETURN v_participation_id;
END;
$$;

-- The current safe producer derives Person, Event, and role exclusively from
-- an existing governed person_role_instances row.  It covers only the
-- already-proven PILOT and HOUSEHOLD_MEMBER evidence set; it does not infer
-- COPILOT or GUEST identity from attendee fields.
CREATE OR REPLACE FUNCTION public.establish_person_event_participation_from_role_instance(
  p_person_role_instance_id uuid,
  p_actor_auth_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_role public.person_role_instances%ROWTYPE;
BEGIN
  SELECT pri.*
    INTO v_role
  FROM public.person_role_instances pri
  WHERE pri.id = p_person_role_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'person role instance does not exist';
  END IF;

  RETURN public.establish_person_event_participation_from_governed_evidence(
    v_role.person_id,
    v_role.event_id,
    'person_role_instance',
    'public.person_role_instances',
    v_role.id,
    v_role.identity_role,
    p_actor_auth_user_id,
    NULL,
    jsonb_build_object(
      'attribution_method', v_role.attribution_method,
      'evidence_source', v_role.evidence_source,
      'source_manifest_version', v_role.source_manifest_version,
      'source_role_instance_key', v_role.source_role_instance_key
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_person_event_participation(
  p_participation_id uuid,
  p_actor_auth_user_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  IF p_participation_id IS NULL
    OR nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'participation revocation requires a target and reason';
  END IF;

  UPDATE public.person_event_participations pep
  SET participation_state = 'revoked',
      revoked_at = now(),
      revoked_by_auth_user_id = p_actor_auth_user_id,
      revoked_reason = p_reason
  WHERE pep.id = p_participation_id
    AND pep.participation_state = 'eligible'
  RETURNING pep.event_id INTO v_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'participation is missing or already revoked';
  END IF;

  INSERT INTO public.person_event_participation_evidence (
    participation_id, lifecycle_action, source_kind, actor_auth_user_id,
    reason, provenance
  )
  VALUES (
    p_participation_id, 'revoked', 'governed_revocation',
    p_actor_auth_user_id, p_reason, jsonb_build_object('event_id', v_event_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_eligible_person_event_ids()
RETURNS TABLE(event_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_link_status text;
  v_person_id uuid;
BEGIN
  SELECT r.status, r.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(auth.uid()) r;

  IF v_link_status IS DISTINCT FROM 'resolved' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT pep.event_id
  FROM public.person_event_participations pep
  JOIN public.events e ON e.id = pep.event_id
  WHERE pep.person_id = v_person_id
    AND pep.participation_state = 'eligible';
END;
$$;

-- Backfill only exact already-governed Person x Event identity evidence.
-- No attendee, household, copilot, guest, identifier, or name field is used
-- directly here; every row first passed the existing role-instance governance.
DO $$
DECLARE
  v_role_id uuid;
BEGIN
  FOR v_role_id IN
    SELECT pri.id
    FROM public.person_role_instances pri
  LOOP
    PERFORM public.establish_person_event_participation_from_role_instance(v_role_id, NULL);
  END LOOP;
END;
$$;

ALTER TABLE public.person_event_participations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_event_participation_evidence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.person_event_participations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.person_event_participation_evidence FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.set_person_event_participations_updated_at() OWNER TO postgres;
ALTER FUNCTION public.prevent_person_event_participation_evidence_mutation() OWNER TO postgres;
ALTER FUNCTION public.establish_person_event_participation_from_governed_evidence(uuid, uuid, text, text, uuid, text, uuid, text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.establish_person_event_participation_from_role_instance(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.revoke_person_event_participation(uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.list_my_eligible_person_event_ids() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_person_event_participations_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_person_event_participation_evidence_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.establish_person_event_participation_from_governed_evidence(uuid, uuid, text, text, uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.establish_person_event_participation_from_role_instance(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_person_event_participation(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_my_eligible_person_event_ids() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_eligible_person_event_ids() TO authenticated;

COMMIT;
