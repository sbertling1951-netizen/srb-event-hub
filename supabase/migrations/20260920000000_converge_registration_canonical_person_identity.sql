-- ===========================================================================
-- Permanent registration <-> canonical-person convergence.
--
-- PROVEN DEFECT (read-only root-cause, prior cohort):
--   resolve_member_account() -- the full-account "My Events" authority --
--   discovers events strictly through the canonical graph:
--       auth.uid()
--         -> resolve_auth_person_link() -> people.id
--         -> person_event_participations (state 'eligible')
--         -> person_role_instances
--         -> attendees -> events
--   The canonical graph for a tenant was populated by ONE-TIME backfills
--   (the identity-resolution manifest, then 20260815100000's PEP loop over
--   existing person_role_instances). Any registration created AFTER those
--   backfills -- and after the person already activated an account -- has
--   no live path that establishes person_role_instances /
--   person_event_participations for it (attendees / household rows are
--   written directly under RLS with no governed choke point; activation is
--   fail-closed ALREADY_ACTIVATED afterward). => event silently absent from
--   full-account My Events while Single Event Access still works.
--
-- THE PERMANENT INVARIANT:
--   Whenever a registration role (attendee pilot, attendee copilot, or a
--   household member) is created or its identifying fields change, IF that
--   role's evidence unambiguously identifies exactly one already-activated
--   canonical person -- by the SAME two-factor bar activation uses:
--       (a) the role's normalized (first,last) name matches a name variant
--           already known for that person, AND
--       (b) the role's normalized email or phone equals a destination the
--           person has provably demonstrated control of
--           (auth.users.email_confirmed_at / phone_confirmed_at behind an
--            active person_auth_accounts link)
--   THEN the platform idempotently establishes person_role_instances (+ the
--   PILOT-only attendees.person_id bridge) and person_event_participations
--   (via the existing governed producer). Activation chronology is
--   irrelevant: registration-before-activation (finalize) and
--   registration-after-activation (here) converge to the SAME state.
--
-- SHARED-DESTINATION POLICY (see "POLICY 1" below): a confirmed account
--   destination + an exact human-name match to that person is sufficient,
--   even if another differently-named role on the same registration shares
--   that destination. This is exact activation-OTP parity
--   (finalize_member_identity_activation's matched_person branch links via
--   get_unresolved_verified_destination_roles with NO shared-identifier
--   exclusion). Reconciliation is therefore order-independent by
--   construction: the differently-named role simply does not resolve.
--
-- DURABLE OBSERVABILITY (Doug blocker 1): an unexpected engine failure
--   rolls back ALL tentative identity work in a subtransaction, the
--   registration write itself survives, and a durable row is written to
--   public.registration_identity_convergence_issues AFTER the failed
--   sub-block unwinds but BEFORE the trigger returns. Explicit conflicts
--   and ambiguity are recorded on the same surface; benign "no match" is
--   not (no noise).
--
--   DOUBLE-FAILURE FALLBACK (Doug re-review): if issue persistence ITSELF
--   fails, the recorder does not re-raise (registration survival is
--   absolute) but is never fully silent -- it emits exactly ONE bounded
--   server-side RAISE WARNING carrying only safe operational identifiers
--   (attendee_id, event_id, issue_type, role key, SQLSTATEs, bounded DB
--   error text) and NO email / phone / name / token / payload. Hierarchy:
--   PRIMARY = durable issue row; FALLBACK = bounded WARNING/log signal;
--   LAST = registration still succeeds.
--
-- ONE NORMALIZER (Doug blocker 3): _identity_convergence_norm_name /
--   _norm_email / _norm_phone are the single normalization authority, used
--   in controlled-destination extraction, candidate matching, competing-
--   role scans, member recovery, and the backfill. Phone normalization is
--   digits-only + strip a leading US '1' on 11-digit input, EVERYWHERE.
--
-- WHAT THIS MIGRATION DOES NOT DO (hard prohibitions honoured):
--   * resolve_member_account() untouched -- no raw-email fallback, no TEA.
--   * No identifier-only linkage (name + provably-controlled destination).
--   * attendees.person_id pointing at a DIFFERENT person is never
--     overwritten; an existing PRI is never re-pointed -- both raise a
--     durable IDENTITY_CONFLICT instead.
--   * No FCOC / tenant / event / person / attendee UUID is referenced.
-- ===========================================================================

BEGIN;

DO $guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'must be applied as postgres (migration owner), not %', current_user;
  END IF;

  IF to_regprocedure('public.resolve_auth_person_link(uuid)') IS NULL THEN
    RAISE EXCEPTION 'prerequisite missing: public.resolve_auth_person_link(uuid)';
  END IF;
  IF to_regprocedure(
       'public.establish_person_event_participation_from_role_instance(uuid, uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'prerequisite missing: establish_person_event_participation_from_role_instance';
  END IF;
  IF to_regprocedure('public.has_platform_admin_authority(uuid)') IS NULL
     OR to_regprocedure('public.has_event_task_authority(text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'prerequisite missing: authority primitives';
  END IF;
  IF to_regclass('public.person_role_instances') IS NULL
     OR to_regclass('public.person_event_participations') IS NULL THEN
    RAISE EXCEPTION 'prerequisite missing: canonical identity tables';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1. person_role_instances.attribution_method: allow the new lifecycle
--    source alongside the two existing ones. Additive CHECK widening only.
-- ---------------------------------------------------------------------------
ALTER TABLE public.person_role_instances
  DROP CONSTRAINT IF EXISTS person_role_instances_attribution_method_check;

ALTER TABLE public.person_role_instances
  ADD CONSTRAINT person_role_instances_attribution_method_check
  CHECK (attribution_method IN (
    'automatic_backfill',
    'member_claim_verified',
    'registration_lifecycle_convergence'
  ));

-- ---------------------------------------------------------------------------
-- 2. Durable failure / conflict / review surface (Doug blocker 1).
--    Postgres-only writes; RLS default-deny; one governed read RPC.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.registration_identity_convergence_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendee_id uuid NOT NULL REFERENCES public.attendees(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  household_member_id uuid REFERENCES public.attendee_household_members(id) ON DELETE SET NULL,
  source_role_instance_key text,
  issue_type text NOT NULL
    CHECK (issue_type IN ('ENGINE_ERROR', 'IDENTITY_CONFLICT', 'IDENTITY_AMBIGUITY')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'dismissed')),
  sqlstate text,
  detail text,
  evidence_person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  conflicting_person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  actor_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_identity_convergence_issues_resolution_shape CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status IN ('resolved', 'dismissed') AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS registration_identity_convergence_issues_open_idx
  ON public.registration_identity_convergence_issues (status, issue_type, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS registration_identity_convergence_issues_attendee_idx
  ON public.registration_identity_convergence_issues (attendee_id);
CREATE INDEX IF NOT EXISTS registration_identity_convergence_issues_event_idx
  ON public.registration_identity_convergence_issues (event_id);

-- One OPEN row per (attendee, type, role-key) -- repeat occurrences bump
-- occurrence_count / last_seen_at instead of flooding. A resolved row does
-- not block a fresh recurrence.
CREATE UNIQUE INDEX IF NOT EXISTS registration_identity_convergence_issues_open_dedupe
  ON public.registration_identity_convergence_issues (
    attendee_id, issue_type, coalesce(source_role_instance_key, '')
  )
  WHERE status = 'open';

ALTER TABLE public.registration_identity_convergence_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.registration_identity_convergence_issues
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS set_registration_identity_convergence_issues_updated_at
  ON public.registration_identity_convergence_issues;
CREATE TRIGGER set_registration_identity_convergence_issues_updated_at
  BEFORE UPDATE ON public.registration_identity_convergence_issues
  FOR EACH ROW EXECUTE FUNCTION public.set_identity_updated_at();

-- ---------------------------------------------------------------------------
-- 3. THE canonical normalizers (Doug blocker 3). IMMUTABLE, reused
--    everywhere below and by the tests. No other regex snippets.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._identity_convergence_norm_name(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT nullif(lower(regexp_replace(trim(coalesce(p_value, '')), '\s+', ' ', 'g')), '');
$$;

CREATE OR REPLACE FUNCTION public._identity_convergence_norm_email(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT nullif(lower(trim(coalesce(p_value, ''))), '');
$$;

-- Digits only; a leading US country code '1' on 11-digit input is stripped
-- so that "+1 (555) 123-4567", "1-555-123-4567" and "5551234567" all
-- normalize identically -- used on BOTH sides of every phone comparison.
CREATE OR REPLACE FUNCTION public._identity_convergence_norm_phone(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT nullif(
    CASE
      WHEN length(regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g') FROM 2)
      ELSE regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g')
    END,
    ''
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Internal helper: name variants already known for a canonical person
--    (mirrors evaluate_member_identity_claim's person_name_variants).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._identity_convergence_person_name_variants(
  p_person_id uuid
)
RETURNS TABLE(first_name text, last_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  SELECT DISTINCT
    public._identity_convergence_norm_name(p.display_first_name),
    public._identity_convergence_norm_name(p.display_last_name)
  FROM public.people p
  WHERE p.id = p_person_id
    AND p.status = 'active'
    AND p.merged_into_person_id IS NULL

  UNION

  SELECT DISTINCT
    public._identity_convergence_norm_name(a.pilot_first),
    public._identity_convergence_norm_name(a.pilot_last)
  FROM public.person_role_instances pri
  JOIN public.attendees a ON a.id = pri.attendee_id
  WHERE pri.person_id = p_person_id
    AND pri.identity_role = 'PILOT'

  UNION

  SELECT DISTINCT
    public._identity_convergence_norm_name(a.copilot_first),
    public._identity_convergence_norm_name(a.copilot_last)
  FROM public.person_role_instances pri
  JOIN public.attendees a ON a.id = pri.attendee_id
  WHERE pri.person_id = p_person_id
    AND pri.identity_role = 'COPILOT'

  UNION

  SELECT DISTINCT
    public._identity_convergence_norm_name(hm.first_name),
    public._identity_convergence_norm_name(hm.last_name)
  FROM public.person_role_instances pri
  JOIN public.attendee_household_members hm ON hm.id = pri.household_member_id
  WHERE pri.person_id = p_person_id
    AND pri.identity_role = 'HOUSEHOLD_MEMBER';
$$;

-- ---------------------------------------------------------------------------
-- 5. Internal helper: destinations a canonical person has PROVABLY
--    demonstrated control of -- a confirmed auth.users email / phone behind
--    an active person_auth_accounts link. The durable equivalent of the OTP
--    finalize_member_identity_activation verifies. Self-asserted
--    person_identifiers ('observed') rows are deliberately NOT consulted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._identity_convergence_controlled_destinations(
  p_person_id uuid
)
RETURNS TABLE(kind text, normalized_value text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  SELECT 'email'::text, public._identity_convergence_norm_email(u.email)
  FROM public.person_auth_accounts paa
  JOIN auth.users u ON u.id = paa.auth_user_id
  WHERE paa.person_id = p_person_id
    AND paa.status = 'active'
    AND u.email_confirmed_at IS NOT NULL
    AND public._identity_convergence_norm_email(u.email) IS NOT NULL

  UNION

  SELECT 'phone'::text, public._identity_convergence_norm_phone(u.phone)
  FROM public.person_auth_accounts paa
  JOIN auth.users u ON u.id = paa.auth_user_id
  WHERE paa.person_id = p_person_id
    AND paa.status = 'active'
    AND u.phone_confirmed_at IS NOT NULL
    AND public._identity_convergence_norm_phone(u.phone) IS NOT NULL;
$$;

-- ---------------------------------------------------------------------------
-- 6. Internal helper: given ONE role's normalised evidence, return the
--    resolved canonical person AND the candidate count so callers can
--    distinguish "no match" (benign) from ">1 match" (ambiguous, worth a
--    durable review row). Fail-closed:
--      * name (first AND last) mandatory
--      * >=1 identifier present AND equal to a controlled destination
--      * candidate active / unmerged / active auth link
--      * candidate_count <> 1  -> resolved_person_id NULL
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._identity_convergence_resolve_role(text, text, text, text);
CREATE OR REPLACE FUNCTION public._identity_convergence_resolve_role(
  p_norm_first text,
  p_norm_last text,
  p_norm_email text,
  p_norm_phone text
)
RETURNS TABLE(resolved_person_id uuid, candidate_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_person_ids uuid[];
BEGIN
  resolved_person_id := NULL;
  candidate_count := 0;

  IF p_norm_first IS NULL OR p_norm_last IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;
  IF p_norm_email IS NULL AND p_norm_phone IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT cand.person_id)
    INTO v_person_ids
  FROM (
    SELECT p.id AS person_id
    FROM public.people p
    JOIN public.person_auth_accounts paa
      ON paa.person_id = p.id
     AND paa.status = 'active'
    WHERE p.status = 'active'
      AND p.merged_into_person_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public._identity_convergence_person_name_variants(p.id) v
        WHERE v.first_name = p_norm_first
          AND v.last_name = p_norm_last
      )
      AND EXISTS (
        SELECT 1
        FROM public._identity_convergence_controlled_destinations(p.id) d
        WHERE (d.kind = 'email' AND p_norm_email IS NOT NULL AND d.normalized_value = p_norm_email)
           OR (d.kind = 'phone' AND p_norm_phone IS NOT NULL AND d.normalized_value = p_norm_phone)
      )
  ) cand;

  candidate_count := coalesce(array_length(v_person_ids, 1), 0);
  IF candidate_count = 1 THEN
    resolved_person_id := v_person_ids[1];
  END IF;

  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Internal helper: record / dedupe a durable convergence issue. Called
--    only from the OUTER function body (never inside a rolled-back
--    sub-block). Best-effort: wrapped so it can never fail a registration
--    write. On repeat it bumps occurrence_count + last_seen_at.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._identity_convergence_record_issue(
  p_attendee_id uuid,
  p_event_id uuid,
  p_household_member_id uuid,
  p_source_role_instance_key text,
  p_issue_type text,
  p_sqlstate text,
  p_detail text,
  p_evidence_person_id uuid,
  p_conflicting_person_id uuid,
  p_actor_auth_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  BEGIN
    SELECT e.tenant_id INTO v_tenant_id FROM public.events e WHERE e.id = p_event_id;

    INSERT INTO public.registration_identity_convergence_issues (
      attendee_id, event_id, tenant_id, household_member_id, source_role_instance_key,
      issue_type, sqlstate, detail, evidence_person_id, conflicting_person_id,
      actor_auth_user_id
    )
    VALUES (
      p_attendee_id, p_event_id, v_tenant_id, p_household_member_id,
      p_source_role_instance_key, p_issue_type, p_sqlstate, left(coalesce(p_detail, ''), 1000),
      p_evidence_person_id, p_conflicting_person_id, p_actor_auth_user_id
    )
    ON CONFLICT (attendee_id, issue_type, coalesce(source_role_instance_key, ''))
      WHERE status = 'open'
    DO UPDATE SET
      occurrence_count = public.registration_identity_convergence_issues.occurrence_count + 1,
      last_seen_at = now(),
      sqlstate = excluded.sqlstate,
      detail = excluded.detail,
      evidence_person_id = excluded.evidence_person_id,
      conflicting_person_id = excluded.conflicting_person_id,
      actor_auth_user_id = coalesce(excluded.actor_auth_user_id,
                                    public.registration_identity_convergence_issues.actor_auth_user_id),
      updated_at = now();
  EXCEPTION WHEN OTHERS THEN
    -- Issue persistence itself failed. Registration survival is still
    -- absolute -- we never re-raise. But the underlying identity failure
    -- must not become completely invisible: emit ONE bounded server-side
    -- WARNING (log-visible) carrying only safe operational identifiers and
    -- SQLSTATEs -- never an email / phone / name / token / payload dump.
    DECLARE
      v_rec_sqlstate text;
      v_rec_message text;
    BEGIN
      GET STACKED DIAGNOSTICS
        v_rec_sqlstate = RETURNED_SQLSTATE,
        v_rec_message = MESSAGE_TEXT;
      RAISE WARNING
        '[registration_identity_convergence] durable issue persistence FAILED; '
        'identity failure is now log-only. attendee_id=% event_id=% issue_type=% '
        'role_key=% original_sqlstate=% recorder_sqlstate=% recorder_error=%',
        p_attendee_id,
        p_event_id,
        p_issue_type,
        coalesce(p_source_role_instance_key, '(none)'),
        coalesce(nullif(p_sqlstate, ''), '(none)'),
        v_rec_sqlstate,
        left(coalesce(v_rec_message, ''), 300);
    EXCEPTION WHEN OTHERS THEN
      -- Even the WARNING path must never abort the registration.
      NULL;
    END;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public._identity_convergence_resolve_open_issues(
  p_attendee_id uuid,
  p_source_role_instance_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  BEGIN
    UPDATE public.registration_identity_convergence_issues
    SET status = 'resolved',
        resolved_at = now(),
        resolution_note = 'auto: convergence succeeded on a later reconcile',
        updated_at = now()
    WHERE attendee_id = p_attendee_id
      AND coalesce(source_role_instance_key, '') = coalesce(p_source_role_instance_key, '')
      AND status = 'open'
      AND issue_type IN ('IDENTITY_CONFLICT', 'IDENTITY_AMBIGUITY');
  EXCEPTION WHEN OTHERS THEN
    -- Same rule as the recorder: never re-raise, never fully silent.
    DECLARE
      v_rec_sqlstate text;
      v_rec_message text;
    BEGIN
      GET STACKED DIAGNOSTICS
        v_rec_sqlstate = RETURNED_SQLSTATE,
        v_rec_message = MESSAGE_TEXT;
      RAISE WARNING
        '[registration_identity_convergence] stale-issue auto-resolve FAILED. '
        'attendee_id=% role_key=% recorder_sqlstate=% recorder_error=%',
        p_attendee_id,
        coalesce(p_source_role_instance_key, '(none)'),
        v_rec_sqlstate,
        left(coalesce(v_rec_message, ''), 300);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. The convergence engine. For one attendee registration, reconcile every
--    role it carries against the canonical graph, idempotently and
--    order-independently.
--
--    Transaction safety (Doug blocker 1): all tentative identity mutation
--    runs inside an inner sub-block. An unexpected exception there rolls
--    back every tentative PRI / attendees.person_id / PEP change; the
--    registration row that triggered this is untouched; a durable
--    ENGINE_ERROR row is written from the OUTER body afterward. The engine
--    itself never re-raises -- a registration write must never fail because
--    identity is unclear or the engine hit a bug.
--
--    Shared-destination POLICY 1 (Doug blocker 2): resolution is by name +
--    provably-controlled destination only. A differently-named role that
--    shares a destination simply fails to resolve to that person -- there
--    is no order-sensitive "shared identifier" guard, so the outcome for a
--    given final registration state is identical regardless of the order
--    attendee / household rows were written. Later evidence that would
--    re-point an existing lifecycle attribution is refused and recorded as
--    a durable IDENTITY_CONFLICT (never silently applied, never ignored).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_attendee_registration_identity(
  p_attendee_id uuid,
  p_actor_auth_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_att public.attendees%ROWTYPE;
  v_event_id uuid;
  v_role record;
  v_resolved_person_id uuid;
  v_candidate_count integer;
  v_existing_pri public.person_role_instances%ROWTYPE;
  v_new_pri_id uuid;
  v_key text;
  v_linked jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_ambiguous jsonb := '[]'::jsonb;
  v_conflict_items jsonb := '[]'::jsonb;   -- {key, hh_id, evidence, conflicting, detail}
  v_ambiguous_items jsonb := '[]'::jsonb;  -- {key, hh_id}
  v_engine_error boolean := false;
  v_err_sqlstate text;
  v_err_msg text;
  v_item jsonb;
BEGIN
  IF p_attendee_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_attendee_id');
  END IF;

  SELECT * INTO v_att FROM public.attendees WHERE id = p_attendee_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attendee_not_found');
  END IF;
  v_event_id := v_att.event_id;

  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = v_event_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_not_found');
  END IF;

  -- Guard is set in the OUTER context so it survives an inner rollback and
  -- reliably suppresses the re-entrant trigger on our own person_id UPDATE.
  PERFORM set_config('epicentrax.identity_convergence_active', 'true', true);

  BEGIN
    ---------------------------------------------------------------------------
    -- Tentative identity work. Any unexpected error here unwinds the whole
    -- sub-block (all PRI / person_id / PEP writes below) with zero residue;
    -- the outer body then records a durable ENGINE_ERROR.
    ---------------------------------------------------------------------------
    FOR v_role IN
      SELECT
        'PILOT'::text AS identity_role,
        'attendee_pilot:' || v_att.id::text AS role_key,
        'public.attendees'::text AS source_table,
        v_att.id AS source_record_id,
        NULL::uuid AS household_member_id,
        public._identity_convergence_norm_name(v_att.pilot_first) AS n_first,
        public._identity_convergence_norm_name(v_att.pilot_last) AS n_last,
        public._identity_convergence_norm_email(v_att.email) AS n_email,
        public._identity_convergence_norm_phone(
          coalesce(v_att.cell_phone, v_att.primary_phone, v_att.phone)
        ) AS n_phone

      UNION ALL

      SELECT
        'COPILOT'::text,
        'attendee_copilot:' || v_att.id::text,
        'public.attendees'::text,
        v_att.id,
        NULL::uuid,
        public._identity_convergence_norm_name(v_att.copilot_first),
        public._identity_convergence_norm_name(v_att.copilot_last),
        public._identity_convergence_norm_email(v_att.copilot_email),
        public._identity_convergence_norm_phone(v_att.copilot_cell_phone)
      WHERE NULLIF(trim(concat_ws(' ', v_att.copilot_first, v_att.copilot_last)), '') IS NOT NULL
         OR NULLIF(trim(coalesce(v_att.copilot_email, '')), '') IS NOT NULL
         OR NULLIF(trim(coalesce(v_att.copilot_cell_phone, '')), '') IS NOT NULL

      UNION ALL

      SELECT
        'HOUSEHOLD_MEMBER'::text,
        'household_member:' || hm.id::text,
        'public.attendee_household_members'::text,
        hm.id,
        hm.id,
        public._identity_convergence_norm_name(hm.first_name),
        public._identity_convergence_norm_name(hm.last_name),
        public._identity_convergence_norm_email(hm.email),
        public._identity_convergence_norm_phone(hm.cell_phone)
      FROM public.attendee_household_members hm
      WHERE hm.attendee_id = v_att.id
    LOOP
      v_key := v_role.role_key;

      SELECT r.resolved_person_id, r.candidate_count
        INTO v_resolved_person_id, v_candidate_count
      FROM public._identity_convergence_resolve_role(
        v_role.n_first, v_role.n_last, v_role.n_email, v_role.n_phone
      ) r;

      -- CASE 5: an existing person_role_instance for this exact source key.
      SELECT * INTO v_existing_pri
      FROM public.person_role_instances
      WHERE source_role_instance_key = v_key;

      IF FOUND THEN
        IF v_resolved_person_id IS NOT NULL
           AND v_existing_pri.person_id <> v_resolved_person_id THEN
          -- Later evidence now points somewhere else. Never re-point an
          -- existing attribution; record it durably instead.
          v_conflict_items := v_conflict_items || jsonb_build_object(
            'key', v_key, 'hh_id', v_role.household_member_id,
            'evidence', v_resolved_person_id, 'conflicting', v_existing_pri.person_id,
            'detail', 'existing role instance is attributed to a different canonical person than current evidence resolves to'
          );
        ELSE
          -- Consistent (or no longer resolvable) -- idempotently ensure PEP
          -- and clear any stale open issue for this role.
          PERFORM public.establish_person_event_participation_from_role_instance(
            v_existing_pri.id, p_actor_auth_user_id
          );
          PERFORM public._identity_convergence_resolve_open_issues(v_att.id, v_key);
        END IF;
        CONTINUE;
      END IF;

      IF v_resolved_person_id IS NULL THEN
        IF v_candidate_count > 1 THEN
          v_ambiguous_items := v_ambiguous_items || jsonb_build_object(
            'key', v_key, 'hh_id', v_role.household_member_id
          );
        END IF;
        -- candidate_count = 0 -> benign, no issue row.
        CONTINUE;
      END IF;

      -- CASE 3: PILOT bridge conflict -- attendees.person_id (PILOT-only)
      -- already belongs to a different canonical person. Never overwrite.
      IF v_role.identity_role = 'PILOT'
         AND v_att.person_id IS NOT NULL
         AND v_att.person_id <> v_resolved_person_id THEN
        v_conflict_items := v_conflict_items || jsonb_build_object(
          'key', v_key, 'hh_id', NULL,
          'evidence', v_resolved_person_id, 'conflicting', v_att.person_id,
          'detail', 'attendees.person_id already bound to a different canonical person'
        );
        CONTINUE;
      END IF;

      -- Establish the canonical role instance. tenant_id NULL to match every
      -- existing person_role_instances row.
      INSERT INTO public.person_role_instances (
        person_id, tenant_id, event_id, attendee_id, identity_role,
        household_member_id, source_table, source_record_id,
        attribution_method, evidence_source, source_manifest_version,
        source_role_instance_key
      )
      VALUES (
        v_resolved_person_id, NULL, v_att.event_id, v_att.id, v_role.identity_role,
        v_role.household_member_id, v_role.source_table, v_role.source_record_id,
        'registration_lifecycle_convergence', 'registration_lifecycle_convergence',
        '20260920000000_converge_registration_canonical_person_identity.sql',
        v_key
      )
      ON CONFLICT (source_role_instance_key) DO NOTHING
      RETURNING id INTO v_new_pri_id;

      IF v_new_pri_id IS NULL THEN
        SELECT id INTO v_new_pri_id
        FROM public.person_role_instances
        WHERE source_role_instance_key = v_key;
      END IF;

      IF v_role.identity_role = 'PILOT' THEN
        UPDATE public.attendees
        SET person_id = v_resolved_person_id
        WHERE id = v_att.id
          AND person_id IS NULL;
        v_att.person_id := coalesce(v_att.person_id, v_resolved_person_id);
      END IF;

      PERFORM public.establish_person_event_participation_from_role_instance(
        v_new_pri_id, p_actor_auth_user_id
      );

      v_linked := v_linked || jsonb_build_object(
        'role', v_role.identity_role,
        'source_role_instance_key', v_key,
        'person_id', v_resolved_person_id,
        'event_id', v_att.event_id
      );
      PERFORM public._identity_convergence_resolve_open_issues(v_att.id, v_key);
    END LOOP;

  EXCEPTION WHEN OTHERS THEN
    v_engine_error := true;
    GET STACKED DIAGNOSTICS
      v_err_sqlstate = RETURNED_SQLSTATE,
      v_err_msg = MESSAGE_TEXT;
    -- The inner sub-block's tentative work is now fully rolled back.
  END;

  PERFORM set_config('epicentrax.identity_convergence_active', 'false', true);

  ---------------------------------------------------------------------------
  -- OUTER body: the inner sub-block has either committed its work into this
  -- (still-open) transaction or been rolled back. Durable issue rows are
  -- written HERE so they survive an inner rollback.
  ---------------------------------------------------------------------------
  IF v_engine_error THEN
    PERFORM public._identity_convergence_record_issue(
      p_attendee_id, v_event_id, NULL, NULL,
      'ENGINE_ERROR', v_err_sqlstate, v_err_msg, NULL, NULL, p_actor_auth_user_id
    );
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'engine_error',
      'sqlstate', v_err_sqlstate, 'detail', v_err_msg,
      'attendee_id', p_attendee_id
    );
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_conflict_items) LOOP
    PERFORM public._identity_convergence_record_issue(
      p_attendee_id, v_event_id,
      nullif(v_item ->> 'hh_id', '')::uuid,
      v_item ->> 'key',
      'IDENTITY_CONFLICT', NULL, v_item ->> 'detail',
      nullif(v_item ->> 'evidence', '')::uuid,
      nullif(v_item ->> 'conflicting', '')::uuid,
      p_actor_auth_user_id
    );
    v_conflicts := v_conflicts || jsonb_build_object(
      'source_role_instance_key', v_item ->> 'key',
      'evidence_person_id', v_item ->> 'evidence',
      'conflicting_person_id', v_item ->> 'conflicting'
    );
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_ambiguous_items) LOOP
    PERFORM public._identity_convergence_record_issue(
      p_attendee_id, v_event_id,
      nullif(v_item ->> 'hh_id', '')::uuid,
      v_item ->> 'key',
      'IDENTITY_AMBIGUITY', NULL, 'more than one activated canonical person matches this role''s evidence',
      NULL, NULL, p_actor_auth_user_id
    );
    v_ambiguous := v_ambiguous || jsonb_build_object(
      'source_role_instance_key', v_item ->> 'key'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'attendee_id', p_attendee_id,
    'linked', v_linked,
    'conflicts', v_conflicts,
    'ambiguous', v_ambiguous
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Trigger functions + triggers -- the boundary raw writes cannot skip.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_reconcile_attendee_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF current_setting('epicentrax.identity_convergence_active', true) = 'true' THEN
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'attendees' THEN
    IF TG_OP = 'UPDATE' AND NOT (
         NEW.pilot_first        IS DISTINCT FROM OLD.pilot_first
      OR NEW.pilot_last         IS DISTINCT FROM OLD.pilot_last
      OR NEW.email              IS DISTINCT FROM OLD.email
      OR NEW.phone              IS DISTINCT FROM OLD.phone
      OR NEW.primary_phone      IS DISTINCT FROM OLD.primary_phone
      OR NEW.cell_phone         IS DISTINCT FROM OLD.cell_phone
      OR NEW.copilot_first      IS DISTINCT FROM OLD.copilot_first
      OR NEW.copilot_last       IS DISTINCT FROM OLD.copilot_last
      OR NEW.copilot_email      IS DISTINCT FROM OLD.copilot_email
      OR NEW.copilot_cell_phone IS DISTINCT FROM OLD.copilot_cell_phone
      OR NEW.person_id          IS DISTINCT FROM OLD.person_id
    ) THEN
      RETURN NULL;
    END IF;

    PERFORM public.reconcile_attendee_registration_identity(NEW.id, NULL);

  ELSIF TG_TABLE_NAME = 'attendee_household_members' THEN
    IF TG_OP = 'UPDATE' AND NOT (
         NEW.first_name  IS DISTINCT FROM OLD.first_name
      OR NEW.last_name   IS DISTINCT FROM OLD.last_name
      OR NEW.email       IS DISTINCT FROM OLD.email
      OR NEW.cell_phone  IS DISTINCT FROM OLD.cell_phone
      OR NEW.attendee_id IS DISTINCT FROM OLD.attendee_id
    ) THEN
      RETURN NULL;
    END IF;

    PERFORM public.reconcile_attendee_registration_identity(NEW.attendee_id, NULL);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS reconcile_attendee_identity_after_write ON public.attendees;
CREATE TRIGGER reconcile_attendee_identity_after_write
  AFTER INSERT OR UPDATE ON public.attendees
  FOR EACH ROW EXECUTE FUNCTION public.tg_reconcile_attendee_identity();

DROP TRIGGER IF EXISTS reconcile_household_identity_after_write ON public.attendee_household_members;
CREATE TRIGGER reconcile_household_identity_after_write
  AFTER INSERT OR UPDATE ON public.attendee_household_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_reconcile_attendee_identity();

-- ---------------------------------------------------------------------------
-- 10. Member recovery safety net. SECONDARY -- historical gaps, legacy
--     rows, evidence corrected out of band, any future path that slips the
--     boundary. Authority resolved internally from auth.uid(); the browser
--     can never pass a person_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_my_member_registrations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_link_status text;
  v_person_id uuid;
  v_attendee_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT r.status, r.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_uid) r;

  IF v_link_status IS DISTINCT FROM 'resolved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'person_not_resolved');
  END IF;

  FOR v_attendee_id IN
    SELECT DISTINCT a.id
    FROM public.attendees a
    WHERE a.person_id = v_person_id

    UNION

    SELECT DISTINCT pri.attendee_id
    FROM public.person_role_instances pri
    WHERE pri.person_id = v_person_id

    UNION

    SELECT DISTINCT a.id
    FROM public.attendees a
    JOIN public._identity_convergence_controlled_destinations(v_person_id) d ON true
    WHERE (d.kind = 'email' AND (
             public._identity_convergence_norm_email(a.email) = d.normalized_value
             OR public._identity_convergence_norm_email(a.copilot_email) = d.normalized_value))
       OR (d.kind = 'phone' AND (
             public._identity_convergence_norm_phone(coalesce(a.cell_phone, a.primary_phone, a.phone)) = d.normalized_value
             OR public._identity_convergence_norm_phone(a.copilot_cell_phone) = d.normalized_value))

    UNION

    SELECT DISTINCT hm.attendee_id
    FROM public.attendee_household_members hm
    JOIN public._identity_convergence_controlled_destinations(v_person_id) d ON true
    WHERE (d.kind = 'email' AND public._identity_convergence_norm_email(hm.email) = d.normalized_value)
       OR (d.kind = 'phone' AND public._identity_convergence_norm_phone(hm.cell_phone) = d.normalized_value)
  LOOP
    v_results := v_results || public.reconcile_attendee_registration_identity(v_attendee_id, v_uid);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'person_id', v_person_id,
    'registrations_examined', v_count,
    'results', v_results
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. Governed operator read RPC for the durable issue surface. Per-event
--     access requires event.attendees.manage on that event; the
--     unscoped/platform view requires platform admin authority.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_registration_identity_convergence_issues(
  p_event_id uuid DEFAULT NULL,
  p_status text DEFAULT 'open'
)
RETURNS TABLE(
  id uuid,
  attendee_id uuid,
  event_id uuid,
  tenant_id uuid,
  household_member_id uuid,
  source_role_instance_key text,
  issue_type text,
  status text,
  sqlstate text,
  detail text,
  evidence_person_id uuid,
  conflicting_person_id uuid,
  occurrence_count integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  resolved_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF p_event_id IS NOT NULL THEN
    IF NOT public.has_event_task_authority('event.attendees.manage', p_event_id) THEN
      RAISE EXCEPTION 'not authorized for this event';
    END IF;
  ELSE
    IF NOT public.has_platform_admin_authority(v_uid) THEN
      RAISE EXCEPTION 'platform administrator authority required for the unscoped view';
    END IF;
  END IF;

  RETURN QUERY
  SELECT i.id, i.attendee_id, i.event_id, i.tenant_id, i.household_member_id,
         i.source_role_instance_key, i.issue_type, i.status, i.sqlstate, i.detail,
         i.evidence_person_id, i.conflicting_person_id, i.occurrence_count,
         i.first_seen_at, i.last_seen_at, i.resolved_at
  FROM public.registration_identity_convergence_issues i
  WHERE (p_event_id IS NULL OR i.event_id = p_event_id)
    AND (v_status IS NULL OR v_status = 'all' OR i.status = v_status)
  ORDER BY i.last_seen_at DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- 12. Ownership / grants.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public._identity_convergence_norm_name(text) OWNER TO postgres;
ALTER FUNCTION public._identity_convergence_norm_email(text) OWNER TO postgres;
ALTER FUNCTION public._identity_convergence_norm_phone(text) OWNER TO postgres;
ALTER FUNCTION public._identity_convergence_person_name_variants(uuid) OWNER TO postgres;
ALTER FUNCTION public._identity_convergence_controlled_destinations(uuid) OWNER TO postgres;
ALTER FUNCTION public._identity_convergence_resolve_role(text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public._identity_convergence_record_issue(uuid, uuid, uuid, text, text, text, text, uuid, uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public._identity_convergence_resolve_open_issues(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.reconcile_attendee_registration_identity(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.tg_reconcile_attendee_identity() OWNER TO postgres;
ALTER FUNCTION public.reconcile_my_member_registrations() OWNER TO postgres;
ALTER FUNCTION public.list_registration_identity_convergence_issues(uuid, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public._identity_convergence_norm_name(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._identity_convergence_norm_email(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._identity_convergence_norm_phone(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._identity_convergence_person_name_variants(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._identity_convergence_controlled_destinations(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._identity_convergence_resolve_role(text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._identity_convergence_record_issue(uuid, uuid, uuid, text, text, text, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._identity_convergence_resolve_open_issues(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reconcile_attendee_registration_identity(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_reconcile_attendee_identity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reconcile_my_member_registrations() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_registration_identity_convergence_issues(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.reconcile_my_member_registrations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_registration_identity_convergence_issues(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 13. Bounded apply-time historical backfill -- the SAME fail-closed,
--     idempotent engine over every existing registration. Reports linked /
--     conflict / ambiguity / engine-error counts (not just successes).
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  v_attendee_id uuid;
  v_summary jsonb;
  v_linked integer := 0;
  v_conflict integer := 0;
  v_ambiguous integer := 0;
  v_errors integer := 0;
BEGIN
  FOR v_attendee_id IN
    SELECT id FROM public.attendees ORDER BY created_at
  LOOP
    v_summary := public.reconcile_attendee_registration_identity(v_attendee_id, NULL);
    IF (v_summary ->> 'ok') = 'false' AND (v_summary ->> 'reason') = 'engine_error' THEN
      v_errors := v_errors + 1;
    ELSE
      v_linked := v_linked + coalesce(jsonb_array_length(v_summary -> 'linked'), 0);
      v_conflict := v_conflict + coalesce(jsonb_array_length(v_summary -> 'conflicts'), 0);
      v_ambiguous := v_ambiguous + coalesce(jsonb_array_length(v_summary -> 'ambiguous'), 0);
    END IF;
  END LOOP;

  RAISE NOTICE 'registration identity convergence backfill: % linked, % conflict, % ambiguity, % engine-error(s) recorded',
    v_linked, v_conflict, v_ambiguous, v_errors;
END
$backfill$;

COMMIT;
