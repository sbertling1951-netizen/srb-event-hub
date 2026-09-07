-- P-2D: governed deletion of an unfinished self-service organizer event, and
-- the default one-active-unfinished-event capacity.
--
-- Builds directly on 20260924000000 (P-2A/P-2B foundation) and 20260925000000
-- (P-2C personal event reuse).  It adds exactly:
--
--   * self_service_event_deletion_audit -- an append-only, immutable,
--     browser-inaccessible record that a governed deletion occurred.  It holds
--     ONLY non-content facts (canonical organizer Person id, authenticated
--     actor id, deletion scope, removed command-audit count, idempotency key,
--     timestamp).  It has NO foreign key to public.events or public.tenants,
--     because those rows are gone after a successful delete.  Event name,
--     dates, location, timezone, template, organization name, guest data,
--     photos -- none of it is copied here.
--
--   * a narrowly-scoped DELETE-only exception on the two existing immutable
--     self-service audit triggers (onboarding command audit, tenant lifecycle
--     audit).  UPDATE of those tables stays unconditionally forbidden.  DELETE
--     is allowed ONLY while public.delete_self_service_organizer_event has set
--     the transaction-local guard app.self_service_governed_deletion = 'on'.
--
--   * public.self_service_default_active_event_limit() -> 1.  The SINGLE place
--     a future paid tier changes to raise the ceiling.  No plan, subscription,
--     billing, entitlement, or payment object is created.
--
--   * public.get_my_self_service_organizer_capacity() -- authenticated-only,
--     SECURITY DEFINER read: active_event_limit, active_unfinished_event_count,
--     can_start_another_event.
--
--   * public.delete_self_service_organizer_event(uuid, uuid) -- authenticated-
--     only, SECURITY DEFINER, the ONLY governed deletion path.
--
--   * the default capacity check, added to BOTH existing creation commands
--     (create_self_service_organizer_draft, create_self_service_organizer_event)
--     immediately after canonical-Person resolution and before any events row
--     is written.  The two functions are otherwise restated verbatim from
--     20260924000000 / 20260925000000.  CREATE OR REPLACE preserves their
--     existing postgres ownership and authenticated-only EXECUTE ACL, so no
--     GRANT/REVOKE is re-issued for them (same approach as 20260923000000 and
--     20260925000000).
--
-- No global authority predicate, tenant/event RLS policy, tenant resolution,
-- auth/session behavior, hostname handling, or historical migration is changed.
-- people, person_auth_accounts, and person_resolution_audit are never deleted.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Minimal, immutable, browser-inaccessible deletion audit.
-- ---------------------------------------------------------------------------
CREATE TABLE public.self_service_event_deletion_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The canonical organizer Person whose unfinished event was deleted.  People
  -- are durable; this FK is RESTRICT so the fact keeps a real subject.
  organizer_person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  -- The authenticated account that performed the deletion.
  actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  -- Deliberately plain uuid columns, NOT foreign keys: the referenced event
  -- (always) and tenant (when the empty workspace was removed too) no longer
  -- exist after this row is written.
  deleted_event_id uuid NOT NULL,
  deleted_tenant_id uuid,
  deletion_scope text NOT NULL CHECK (deletion_scope IN (
    'event_only', 'event_and_empty_workspace'
  )),
  removed_command_audit_count integer NOT NULL CHECK (removed_command_audit_count >= 0),
  idempotency_key uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_service_event_deletion_audit_actor_key_unique
    UNIQUE (actor_auth_user_id, idempotency_key),
  CONSTRAINT self_service_event_deletion_audit_scope_tenant_agree
    CHECK ((deletion_scope = 'event_and_empty_workspace') = (deleted_tenant_id IS NOT NULL))
);

ALTER TABLE public.self_service_event_deletion_audit OWNER TO postgres;

CREATE INDEX self_service_event_deletion_audit_person_idx
  ON public.self_service_event_deletion_audit (organizer_person_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_self_service_event_deletion_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RAISE EXCEPTION 'self_service_event_deletion_audit is immutable';
END;
$function$;

ALTER FUNCTION public.prevent_self_service_event_deletion_audit_mutation()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prevent_self_service_event_deletion_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER prevent_self_service_event_deletion_audit_mutation_trigger
BEFORE UPDATE OR DELETE ON public.self_service_event_deletion_audit
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_service_event_deletion_audit_mutation();

ALTER TABLE public.self_service_event_deletion_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.self_service_event_deletion_audit
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Narrowly-scoped DELETE-only exception on the two existing immutable
--    self-service audit triggers.
--
--    UPDATE stays unconditionally forbidden -- onboarding history is never
--    rewritten.  DELETE is permitted ONLY when the transaction-local guard
--    app.self_service_governed_deletion = 'on' is set, which ONLY
--    public.delete_self_service_organizer_event sets, immediately before it
--    removes the operational rows, and which the database clears at
--    transaction end.  The GUC is not a GRANTable object and setting it does
--    nothing on its own.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_self_service_onboarding_command_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.self_service_governed_deletion', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'self_service_onboarding_command_audit is immutable';
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_self_service_tenant_lifecycle_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.self_service_governed_deletion', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'self_service_tenant_lifecycle_audit is immutable';
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Server-owned default active-unfinished-event capacity.  One line; the
--    only thing a future paid tier changes.
-- ---------------------------------------------------------------------------
-- STABLE (not IMMUTABLE): the body returns a constant 1 today, but this is
-- the designated future subscription / per-Person entitlement seam.  STABLE
-- lets a later version read a per-caller entitlement row without any
-- volatility-contract change at that point.
CREATE OR REPLACE FUNCTION public.self_service_default_active_event_limit()
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT 1;
$function$;

ALTER FUNCTION public.self_service_default_active_event_limit() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.self_service_default_active_event_limit()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Authenticated-only capacity read.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_self_service_organizer_capacity()
RETURNS TABLE(
  active_event_limit integer,
  active_unfinished_event_count integer,
  can_start_another_event boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_auth uuid := auth.uid();
  v_link_status text;
  v_person_id uuid;
  v_limit integer := public.self_service_default_active_event_limit();
  v_count integer := 0;
BEGIN
  IF v_auth IS NULL THEN
    RETURN;
  END IF;

  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_auth) AS link;

  -- Fail closed: an identity that is not exactly resolved (and is not a
  -- genuinely unlinked account) cannot be counted and cannot start another.
  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RETURN QUERY SELECT v_limit, v_limit, false;
    RETURN;
  END IF;

  SELECT count(*)::integer
    INTO v_count
  FROM public.self_service_organizer_appointments AS oa
  JOIN public.self_service_private_event_drafts AS d
    ON d.organizer_appointment_id = oa.id
  JOIN public.events AS e
    ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  WHERE oa.is_active = true
    AND (
      (v_link_status = 'resolved' AND oa.person_id = v_person_id)
      OR (v_link_status = 'no_link' AND oa.auth_user_id = v_auth)
    )
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false;

  RETURN QUERY SELECT v_limit, v_count, (v_count < v_limit);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. The one governed deletion path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_self_service_organizer_event(
  p_event_id uuid,
  p_idempotency_key uuid
)
RETURNS TABLE(
  outcome text,
  deleted_event_id uuid,
  deleted_tenant_id uuid,
  deletion_scope text,
  removed_command_audit_count integer,
  occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_link_status text;
  v_person_id uuid;
  v_existing public.self_service_event_deletion_audit%ROWTYPE;
  v_appointment_id uuid;
  v_appointment_person_id uuid;
  v_tenant_id uuid;
  v_scope text;
  v_other_events integer;
  v_removed_cmd_audit integer;
  v_dep record;
  v_dep_count bigint;
  v_audit public.self_service_event_deletion_audit%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Deleting an unfinished event requires an authenticated verified account.';
  END IF;

  -- Same verified-account contract as the creation commands.
  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Deleting an unfinished event requires a verified account email.';
  END IF;

  IF p_event_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An event and an idempotency key are required.';
  END IF;

  -- Serialize retries for this (actor, key) and concurrent operations on the
  -- target event.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'self_service_event_deletion:' || v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('self_service_event_deletion_target:' || p_event_id::text, 0)
  );

  -- Idempotent replay: a prior SUCCESSFUL deletion for this (actor, key).
  SELECT * INTO v_existing
  FROM public.self_service_event_deletion_audit AS a
  WHERE a.actor_auth_user_id = v_actor
    AND a.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.deleted_event_id <> p_event_id THEN
      RAISE EXCEPTION 'Idempotency key was already used to delete a different event.';
    END IF;
    RETURN QUERY SELECT
      'deleted'::text, v_existing.deleted_event_id, v_existing.deleted_tenant_id,
      v_existing.deletion_scope, v_existing.removed_command_audit_count,
      v_existing.occurred_at;
    RETURN;
  END IF;

  -- Fail-closed identity: exactly-resolved, or a genuinely unlinked account
  -- matched only by its OWN appointment row.  Anything else is treated as a
  -- missing event (non-enumerating), exactly like the read RPCs.
  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_actor) AS link;

  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  -- Authorize: a hidden, inactive, non-member-visible Draft in an active
  -- private self-service tenant the caller personally organizes.  Person-scoped
  -- when resolved; own-appointment only when no_link.  A miss is
  -- indistinguishable from a missing id.
  SELECT oa.id, oa.person_id, oa.tenant_id
    INTO v_appointment_id, v_appointment_person_id, v_tenant_id
  FROM public.self_service_private_event_drafts AS d
  JOIN public.self_service_organizer_appointments AS oa
    ON oa.id = d.organizer_appointment_id
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
  WHERE d.event_id = p_event_id
    AND oa.is_active = true
    AND (
      (v_link_status = 'resolved' AND oa.person_id = v_person_id)
      OR (v_link_status = 'no_link' AND oa.auth_user_id = v_actor)
    )
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false
  LIMIT 1;

  IF v_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  -- Complete dependency coverage: a hidden Draft self-service event has no rows
  -- in ANY other events(id) child table (there are no triggers on public.events
  -- and RLS hides it from every admin command).  If that is ever untrue, fail
  -- closed with zero partial deletion -- this whole function is one
  -- transaction.  The draft marker and command audit for THIS event are the
  -- expected children and are excluded.
  FOR v_dep IN
    SELECT (con.conrelid::regclass)::text AS child_table,
           att.attname AS child_col
    FROM pg_constraint AS con
    JOIN pg_attribute AS att
      ON att.attrelid = con.conrelid
     AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.events'::regclass
      AND con.conrelid NOT IN (
        'public.self_service_private_event_drafts'::regclass,
        'public.self_service_onboarding_command_audit'::regclass
      )
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s WHERE %I = $1',
      v_dep.child_table, v_dep.child_col
    ) INTO v_dep_count USING p_event_id;
    IF v_dep_count > 0 THEN
      RAISE EXCEPTION
        'Unfinished event % has unexpected dependent data in %; deletion aborted.',
        p_event_id, v_dep.child_table;
    END IF;
  END LOOP;

  -- Was this the last event in its private tenant?  If so, the empty private
  -- workspace goes too.
  SELECT count(*)::integer
    INTO v_other_events
  FROM public.events AS se
  WHERE se.tenant_id = v_tenant_id
    AND se.id <> p_event_id;

  v_scope := CASE WHEN v_other_events = 0
    THEN 'event_and_empty_workspace'
    ELSE 'event_only'
  END;

  SELECT count(*)::integer
    INTO v_removed_cmd_audit
  FROM public.self_service_onboarding_command_audit AS ca
  WHERE ca.event_id = p_event_id;

  -- Minimal, non-content deletion fact FIRST.
  INSERT INTO public.self_service_event_deletion_audit (
    organizer_person_id, actor_auth_user_id, deleted_event_id, deleted_tenant_id,
    deletion_scope, removed_command_audit_count, idempotency_key
  ) VALUES (
    v_appointment_person_id, v_actor, p_event_id,
    CASE WHEN v_scope = 'event_and_empty_workspace' THEN v_tenant_id ELSE NULL END,
    v_scope, v_removed_cmd_audit, p_idempotency_key
  ) RETURNING * INTO v_audit;

  -- Open the governed DELETE window for the two immutable audit tables, for
  -- this transaction only.
  PERFORM set_config('app.self_service_governed_deletion', 'on', true);

  -- Children first: command audit -> draft marker -> event.
  DELETE FROM public.self_service_onboarding_command_audit AS ca
  WHERE ca.event_id = p_event_id;

  DELETE FROM public.self_service_private_event_drafts AS d
  WHERE d.event_id = p_event_id;

  DELETE FROM public.events AS e
  WHERE e.id = p_event_id;

  -- Last event in the space -> remove the empty private workspace: lifecycle
  -- audit, organizer appointment, tenant.
  IF v_scope = 'event_and_empty_workspace' THEN
    DELETE FROM public.self_service_tenant_lifecycle_audit AS la
    WHERE la.tenant_id = v_tenant_id;

    DELETE FROM public.self_service_organizer_appointments AS oa
    WHERE oa.id = v_appointment_id;

    DELETE FROM public.tenants AS t
    WHERE t.id = v_tenant_id;
  END IF;

  -- Close the governed DELETE window immediately: it must not outlive this
  -- operation even within a longer-lived transaction.  (An error before here
  -- aborts the whole transaction, rolling the guard back regardless.)
  PERFORM set_config('app.self_service_governed_deletion', 'off', true);

  RETURN QUERY SELECT
    'deleted'::text, v_audit.deleted_event_id, v_audit.deleted_tenant_id,
    v_audit.deletion_scope, v_audit.removed_command_audit_count, v_audit.occurred_at;
END;
$function$;

ALTER FUNCTION public.get_my_self_service_organizer_capacity() OWNER TO postgres;
ALTER FUNCTION public.delete_self_service_organizer_event(uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_my_self_service_organizer_capacity()
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.delete_self_service_organizer_event(uuid, uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.get_my_self_service_organizer_capacity()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_self_service_organizer_event(uuid, uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Default capacity enforcement inside the two existing creation commands.
--    Restated verbatim from 20260924000000 / 20260925000000 with ONLY the
--    P-2D capacity block added (after canonical-Person resolution, before the
--    first events insert).  CREATE OR REPLACE preserves ownership + ACL.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_self_service_organizer_draft(
  p_organization_name text,
  p_event_name text,
  p_end_date date,
  p_timezone text,
  p_idempotency_key uuid,
  p_start_date date DEFAULT NULL,
  p_location_mode text DEFAULT 'no_location',
  p_location text DEFAULT NULL,
  p_starter_template text DEFAULT 'casual'
)
-- The first column is the discriminator:
--   'created'                        -> a private draft row (all other columns set)
--   'identity_confirmation_required' -> one possible prior identity; no draft
--   'identity_review_required'       -> ambiguous / disputed / invalid link; no draft
-- The two identity outcomes are EXPECTED safe results, returned normally so the
-- governed resolver's durable person_resolution_audit row commits.  Hard input
-- / idempotency / authorization problems still RAISE.
RETURNS TABLE(
  outcome text,
  tenant_id uuid,
  organizer_appointment_id uuid,
  organizer_person_id uuid,
  event_id uuid,
  organization_name text,
  event_name text,
  start_date date,
  end_date date,
  timezone text,
  location_mode text,
  location text,
  starter_template text,
  status text,
  is_active boolean,
  visible_to_members boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor_auth_user_id uuid := auth.uid();
  v_organization_name text := nullif(btrim(p_organization_name), '');
  v_event_name text := nullif(btrim(p_event_name), '');
  v_timezone text := nullif(btrim(p_timezone), '');
  v_location_mode text := nullif(btrim(p_location_mode), '');
  v_location text := nullif(btrim(p_location), '');
  v_starter_template text := nullif(btrim(p_starter_template), '');
  v_request_fingerprint text;
  v_existing public.self_service_onboarding_command_audit%ROWTYPE;
  v_safe_outcome_ledger public.self_service_onboarding_safe_outcome_ledger%ROWTYPE;
  v_tenant public.tenants%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_appointment public.self_service_organizer_appointments%ROWTYPE;
  v_alias_suffix text;
  v_person_link_status text;
  v_person_resolution_outcome text;
  v_organizer_person_id uuid;
  v_person_resolution_audit_id uuid;
  v_safe_identity_outcome text;
BEGIN
  IF v_actor_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Self-service draft creation requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    WHERE u.id = v_actor_auth_user_id
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Self-service draft creation requires a verified account email.';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required.';
  END IF;

  IF v_organization_name IS NULL OR length(v_organization_name) > 200 THEN
    RAISE EXCEPTION 'Organization name is required and must be 200 characters or fewer.';
  END IF;

  IF v_event_name IS NULL OR length(v_event_name) > 200 THEN
    RAISE EXCEPTION 'Event name is required and must be 200 characters or fewer.';
  END IF;

  IF p_end_date IS NULL THEN
    RAISE EXCEPTION 'A scheduled Event end date is required.';
  END IF;

  IF p_start_date IS NOT NULL AND p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Event end date cannot be before start date.';
  END IF;

  IF v_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names AS tz WHERE tz.name = v_timezone
  ) THEN
    RAISE EXCEPTION 'A valid IANA Event timezone is required.';
  END IF;

  IF v_location_mode NOT IN ('location', 'online', 'no_location') THEN
    RAISE EXCEPTION 'Location mode must be location, online, or no_location.';
  END IF;

  IF v_location_mode = 'location' AND v_location IS NULL THEN
    RAISE EXCEPTION 'A location is required when location mode is location.';
  END IF;

  IF v_location_mode <> 'location' AND v_location IS NOT NULL THEN
    RAISE EXCEPTION 'Location text is allowed only when location mode is location.';
  END IF;

  IF v_location IS NOT NULL AND length(v_location) > 500 THEN
    RAISE EXCEPTION 'Location must be 500 characters or fewer.';
  END IF;

  IF v_starter_template NOT IN (
    'casual', 'birthday_family', 'club_rv', 'conference_corporate', 'dinner', 'sports_activity'
  ) THEN
    RAISE EXCEPTION 'Starter template is not recognized.';
  END IF;

  v_request_fingerprint := encode(
    extensions.digest(
      convert_to(
        jsonb_build_array(
          v_organization_name, v_event_name, p_start_date, p_end_date,
          v_timezone, v_location_mode, v_location, v_starter_template
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Serialize retries before looking them up.  The audit stores only the
  -- digest, never the submitted names, location, or account email.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'self_service_onboarding:' || v_actor_auth_user_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  SELECT * INTO v_existing
  FROM public.self_service_onboarding_command_audit AS a
  WHERE a.actor_auth_user_id = v_actor_auth_user_id
    AND a.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_request_fingerprint THEN
      RAISE EXCEPTION 'Idempotency key was already used with different draft input.';
    END IF;

    RETURN QUERY
    SELECT
      'created'::text,
      t.id, oa.id, oa.person_id, e.id, t.organization_name, e.name, e.start_date,
      e.end_date, e.timezone, d.location_mode, e.location,
      d.starter_template, e.status, e.is_active, e.visible_to_members,
      e.created_at::timestamptz
    FROM public.self_service_organizer_appointments AS oa
    JOIN public.self_service_private_event_drafts AS d
      ON d.organizer_appointment_id = oa.id
    JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
    JOIN public.tenants AS t ON t.id = oa.tenant_id
    WHERE oa.auth_user_id = v_actor_auth_user_id
      AND oa.is_active = true
      AND d.event_id = v_existing.event_id
      AND t.is_active = true
      AND t.is_self_service_private_draft = true
      AND e.status = 'Draft'
      AND e.is_active = false
      AND e.visible_to_members = false;
    RETURN;
  END IF;

  -- P-2B: a prior UNCERTAIN safe outcome for this (actor, key) is frozen.
  -- Same key + same input -> replay it verbatim: no re-resolution, no second
  -- person_resolution_audit row, no downstream write.  Same key + changed
  -- input -> the same idempotency conflict as a draft.  (After external
  -- identity verification, creating the draft is a deliberate new attempt
  -- with a fresh key -- not a silent re-meaning of this request.)
  SELECT * INTO v_safe_outcome_ledger
  FROM public.self_service_onboarding_safe_outcome_ledger AS l
  WHERE l.actor_auth_user_id = v_actor_auth_user_id
    AND l.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_safe_outcome_ledger.request_fingerprint <> v_request_fingerprint THEN
      RAISE EXCEPTION 'Idempotency key was already used with different draft input.';
    END IF;

    RETURN QUERY SELECT
      v_safe_outcome_ledger.safe_outcome,
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
      NULL::text, NULL::text, NULL::date, NULL::date,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::boolean, NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;

  -- ----------------------------------------------------------------------
  -- P-2B: resolve the organizer's canonical Person BEFORE any Tenant,
  -- appointment, or Event is written.  The actor is auth.uid() only; the
  -- verified email/phone are read server-side inside the resolvers.  No
  -- caller-supplied Person / tenant / authority value is accepted anywhere.
  --
  -- Exact linkage is the canonical resolver's decision.  For anything that is
  -- not exactly one active canonical link (no_link OR invalid_or_ambiguous),
  -- the governed self-service resolver classifies the outcome and writes
  -- exactly one durable, non-PII person_resolution_audit row.  An EXPECTED
  -- uncertain outcome is then returned NORMALLY (never RAISE) so that audit
  -- row commits while no Tenant / appointment / Event / Person / account link
  -- is created -- every downstream creation fact is only reached below.
  -- ----------------------------------------------------------------------
  SELECT link.status, link.person_id
    INTO v_person_link_status, v_organizer_person_id
  FROM public.resolve_auth_person_link(v_actor_auth_user_id) AS link;

  IF v_person_link_status = 'resolved' THEN
    v_person_resolution_outcome := 'resolved_existing';
  ELSE
    -- no_link OR invalid_or_ambiguous
    SELECT r.outcome, r.person_id, r.audit_id
      INTO v_person_resolution_outcome, v_organizer_person_id, v_person_resolution_audit_id
    FROM public.resolve_self_service_organizer_person(v_actor_auth_user_id) AS r;
  END IF;

  -- Every safe outcome below comes from the governed resolver, so it carries a
  -- person_resolution_audit row id.  (The 'resolved' exact-link path set
  -- v_person_resolution_outcome := 'resolved_existing' and is handled by the
  -- draft path.)
  IF v_person_resolution_outcome = 'needs_confirmation' THEN
    -- Exactly one possible prior identity.  Do not auto-link or create.
    v_safe_identity_outcome := 'identity_confirmation_required';
  ELSIF v_person_resolution_outcome NOT IN ('resolved_existing', 'created_new') THEN
    -- multiple candidates / disputed evidence / invalid or ambiguous link /
    -- a resolver error converted to a safe review outcome.
    v_safe_identity_outcome := 'identity_review_required';
  END IF;

  IF v_safe_identity_outcome IS NOT NULL THEN
    -- Bind this safe outcome durably to (actor, key, fingerprint): a retry
    -- with the same key + input replays it above without re-resolving.  The
    -- one person_resolution_audit row written by the resolver is the durable
    -- non-PII evidence; this ledger row records the returned result.  Nothing
    -- else is created.  This response names nothing about any candidate,
    -- prior tenant, event, person, household role, or identifier.
    INSERT INTO public.self_service_onboarding_safe_outcome_ledger (
      actor_auth_user_id, idempotency_key, request_fingerprint,
      safe_outcome, person_resolution_audit_id
    ) VALUES (
      v_actor_auth_user_id, p_idempotency_key, v_request_fingerprint,
      v_safe_identity_outcome, v_person_resolution_audit_id
    );

    RETURN QUERY SELECT
      v_safe_identity_outcome,
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
      NULL::text, NULL::text, NULL::date, NULL::date,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::boolean, NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_organizer_person_id IS NULL THEN
    -- Impossible unless resolve_auth_person_link or the resolver violated its
    -- contract (a 'resolved' / 'created_new' outcome always carries a Person).
    -- Fail closed with no partial write; this is an internal error, not an
    -- expected safe identity outcome.
    RAISE EXCEPTION 'Self-service organizer identity resolution returned no Person.';
  END IF;


  -- P-2D default capacity: a standard individual organizer may hold exactly
  -- ONE active unfinished private Draft event at a time.  Enforced here --
  -- after canonical-Person resolution has succeeded, before any Event row is
  -- written -- so a second active unfinished event is rejected server-side no
  -- matter what the browser sends.  A future paid tier raises the ceiling by
  -- changing public.self_service_default_active_event_limit() ALONE; this
  -- call site and the browser contract never change.
  IF (
    SELECT count(*)
    FROM public.self_service_organizer_appointments AS cap_oa
    JOIN public.self_service_private_event_drafts AS cap_d
      ON cap_d.organizer_appointment_id = cap_oa.id
    JOIN public.events AS cap_e
      ON cap_e.id = cap_d.event_id AND cap_e.tenant_id = cap_oa.tenant_id
    JOIN public.tenants AS cap_t ON cap_t.id = cap_oa.tenant_id
    WHERE cap_oa.person_id = v_organizer_person_id
      AND cap_oa.is_active = true
      AND cap_t.is_active = true
      AND cap_t.is_self_service_private_draft = true
      AND cap_e.status = 'Draft'
      AND cap_e.is_active = false
      AND cap_e.visible_to_members = false
  ) >= public.self_service_default_active_event_limit() THEN
    RAISE EXCEPTION 'You already have an active unfinished event. Finish or delete it before starting another.';
  END IF;

  -- Generated aliases are internal-only identifiers.  They derive from a
  -- newly generated Tenant identity, not the Organizer's name or email.
  v_tenant.id := gen_random_uuid();
  v_alias_suffix := replace(v_tenant.id::text, '-', '');

  INSERT INTO public.tenants (
    id, organization_code, slug, organization_name, display_name, app_title,
    is_active, is_self_service_private_draft
  ) VALUES (
    v_tenant.id,
    'org-' || substr(v_alias_suffix, 1, 20),
    'org-' || substr(v_alias_suffix, 1, 20),
    v_organization_name,
    v_organization_name,
    v_organization_name,
    false,
    true
  ) RETURNING * INTO v_tenant;

  INSERT INTO public.self_service_tenant_lifecycle_audit (
    tenant_id, actor_auth_user_id, action
  ) VALUES (
    v_tenant.id, v_actor_auth_user_id, 'tenant_created'
  );

  INSERT INTO public.self_service_organizer_appointments (
    person_id, auth_user_id, tenant_id
  ) VALUES (
    v_organizer_person_id, v_actor_auth_user_id, v_tenant.id
  ) RETURNING * INTO v_appointment;

  -- This is a distinct, auditable onboarding transition rather than an
  -- implicit default: the Tenant is inactive-first and is active only after
  -- its Organizer authority fact has been persisted.
  UPDATE public.tenants
     SET is_active = true,
         updated_at = now()
   WHERE id = v_tenant.id
  RETURNING * INTO v_tenant;

  INSERT INTO public.self_service_tenant_lifecycle_audit (
    tenant_id, actor_auth_user_id, action
  ) VALUES (
    v_tenant.id, v_actor_auth_user_id, 'tenant_activated'
  );

  INSERT INTO public.events (
    tenant_id, name, location, start_date, end_date, timezone, status,
    is_active, visible_to_members
  ) VALUES (
    v_tenant.id, v_event_name, v_location, p_start_date, p_end_date,
    v_timezone, 'Draft', false, false
  ) RETURNING * INTO v_event;

  INSERT INTO public.self_service_private_event_drafts (
    event_id, tenant_id, organizer_appointment_id, location_mode, starter_template
  ) VALUES (
    v_event.id, v_tenant.id, v_appointment.id, v_location_mode, v_starter_template
  );

  INSERT INTO public.self_service_onboarding_command_audit (
    actor_auth_user_id, idempotency_key, request_fingerprint, tenant_id,
    organizer_appointment_id, event_id
  ) VALUES (
    v_actor_auth_user_id, p_idempotency_key, v_request_fingerprint, v_tenant.id,
    v_appointment.id, v_event.id
  );

  RETURN QUERY
  SELECT
    'created'::text,
    t.id, oa.id, oa.person_id, e.id, t.organization_name, e.name, e.start_date,
    e.end_date, e.timezone, d.location_mode, e.location,
    d.starter_template, e.status, e.is_active, e.visible_to_members,
    e.created_at::timestamptz
  FROM public.self_service_organizer_appointments AS oa
  JOIN public.self_service_private_event_drafts AS d
    ON d.organizer_appointment_id = oa.id
  JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  WHERE oa.auth_user_id = v_actor_auth_user_id
    AND oa.is_active = true
    AND d.event_id = v_event.id
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_self_service_organizer_event(
  p_organization_tenant_id uuid,
  p_event_name text,
  p_end_date date,
  p_timezone text,
  p_idempotency_key uuid,
  p_start_date date DEFAULT NULL,
  p_location_mode text DEFAULT 'no_location',
  p_location text DEFAULT NULL,
  p_starter_template text DEFAULT 'casual'
)
-- Same discriminated return as create_self_service_organizer_draft:
--   'created'                        -> a private draft row (all columns set)
--   'identity_confirmation_required' -> one possible prior identity; no draft
--   'identity_review_required'       -> ambiguous / disputed / invalid link
RETURNS TABLE(
  outcome text,
  tenant_id uuid,
  organizer_appointment_id uuid,
  organizer_person_id uuid,
  event_id uuid,
  organization_name text,
  event_name text,
  start_date date,
  end_date date,
  timezone text,
  location_mode text,
  location text,
  starter_template text,
  status text,
  is_active boolean,
  visible_to_members boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor_auth_user_id uuid := auth.uid();
  v_event_name text := nullif(btrim(p_event_name), '');
  v_timezone text := nullif(btrim(p_timezone), '');
  v_location_mode text := nullif(btrim(p_location_mode), '');
  v_location text := nullif(btrim(p_location), '');
  v_starter_template text := nullif(btrim(p_starter_template), '');
  v_request_fingerprint text;
  v_existing public.self_service_onboarding_command_audit%ROWTYPE;
  v_safe_outcome_ledger public.self_service_onboarding_safe_outcome_ledger%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_appointment_id uuid;
  v_person_link_status text;
  v_person_resolution_outcome text;
  v_organizer_person_id uuid;
  v_person_resolution_audit_id uuid;
  v_safe_identity_outcome text;
BEGIN
  IF v_actor_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Self-service draft creation requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    WHERE u.id = v_actor_auth_user_id
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Self-service draft creation requires a verified account email.';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required.';
  END IF;

  IF p_organization_tenant_id IS NULL THEN
    RAISE EXCEPTION 'An event space is required.';
  END IF;

  IF v_event_name IS NULL OR length(v_event_name) > 200 THEN
    RAISE EXCEPTION 'Event name is required and must be 200 characters or fewer.';
  END IF;

  IF p_end_date IS NULL THEN
    RAISE EXCEPTION 'A scheduled Event end date is required.';
  END IF;

  IF p_start_date IS NOT NULL AND p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Event end date cannot be before start date.';
  END IF;

  IF v_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names AS tz WHERE tz.name = v_timezone
  ) THEN
    RAISE EXCEPTION 'A valid IANA Event timezone is required.';
  END IF;

  IF v_location_mode NOT IN ('location', 'online', 'no_location') THEN
    RAISE EXCEPTION 'Location mode must be location, online, or no_location.';
  END IF;

  IF v_location_mode = 'location' AND v_location IS NULL THEN
    RAISE EXCEPTION 'A location is required when location mode is location.';
  END IF;

  IF v_location_mode <> 'location' AND v_location IS NOT NULL THEN
    RAISE EXCEPTION 'Location text is allowed only when location mode is location.';
  END IF;

  IF v_location IS NOT NULL AND length(v_location) > 500 THEN
    RAISE EXCEPTION 'Location must be 500 characters or fewer.';
  END IF;

  IF v_starter_template NOT IN (
    'casual', 'birthday_family', 'club_rv', 'conference_corporate', 'dinner', 'sports_activity'
  ) THEN
    RAISE EXCEPTION 'Starter template is not recognized.';
  END IF;

  -- The fingerprint binds the target event space AND every narrow event
  -- input, so the same event details submitted to a different event space is
  -- a different request, and a reused key with any change fails closed.
  v_request_fingerprint := encode(
    extensions.digest(
      convert_to(
        jsonb_build_array(
          p_organization_tenant_id, v_event_name, p_start_date, p_end_date,
          v_timezone, v_location_mode, v_location, v_starter_template
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'self_service_onboarding:' || v_actor_auth_user_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  SELECT * INTO v_existing
  FROM public.self_service_onboarding_command_audit AS a
  WHERE a.actor_auth_user_id = v_actor_auth_user_id
    AND a.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_request_fingerprint THEN
      RAISE EXCEPTION 'Idempotency key was already used with different draft input.';
    END IF;

    -- The audit row lookup already proved (actor, key) ownership; replay the
    -- created row from the draft marker, re-validating its private/draft state.
    RETURN QUERY
    SELECT
      'created'::text,
      t.id, oa.id, oa.person_id, e.id, t.organization_name, e.name, e.start_date,
      e.end_date, e.timezone, d.location_mode, e.location,
      d.starter_template, e.status, e.is_active, e.visible_to_members,
      e.created_at::timestamptz
    FROM public.self_service_private_event_drafts AS d
    JOIN public.self_service_organizer_appointments AS oa
      ON oa.id = d.organizer_appointment_id
    JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = d.tenant_id
    JOIN public.tenants AS t ON t.id = d.tenant_id
    WHERE d.event_id = v_existing.event_id
      AND t.is_active = true
      AND t.is_self_service_private_draft = true
      AND e.status = 'Draft'
      AND e.is_active = false
      AND e.visible_to_members = false;
    RETURN;
  END IF;

  -- A prior UNCERTAIN safe outcome for this (actor, key) is frozen: same key +
  -- same input replays it verbatim; same key + changed input conflicts.
  SELECT * INTO v_safe_outcome_ledger
  FROM public.self_service_onboarding_safe_outcome_ledger AS l
  WHERE l.actor_auth_user_id = v_actor_auth_user_id
    AND l.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_safe_outcome_ledger.request_fingerprint <> v_request_fingerprint THEN
      RAISE EXCEPTION 'Idempotency key was already used with different draft input.';
    END IF;

    RETURN QUERY SELECT
      v_safe_outcome_ledger.safe_outcome,
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
      NULL::text, NULL::text, NULL::date, NULL::date,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::boolean, NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;

  -- Same identity-resolution precedence and safe outcomes as the P-2A command.
  SELECT link.status, link.person_id
    INTO v_person_link_status, v_organizer_person_id
  FROM public.resolve_auth_person_link(v_actor_auth_user_id) AS link;

  IF v_person_link_status = 'resolved' THEN
    v_person_resolution_outcome := 'resolved_existing';
  ELSE
    SELECT r.outcome, r.person_id, r.audit_id
      INTO v_person_resolution_outcome, v_organizer_person_id, v_person_resolution_audit_id
    FROM public.resolve_self_service_organizer_person(v_actor_auth_user_id) AS r;
  END IF;

  IF v_person_resolution_outcome = 'needs_confirmation' THEN
    v_safe_identity_outcome := 'identity_confirmation_required';
  ELSIF v_person_resolution_outcome NOT IN ('resolved_existing', 'created_new') THEN
    v_safe_identity_outcome := 'identity_review_required';
  END IF;

  IF v_safe_identity_outcome IS NOT NULL THEN
    INSERT INTO public.self_service_onboarding_safe_outcome_ledger (
      actor_auth_user_id, idempotency_key, request_fingerprint,
      safe_outcome, person_resolution_audit_id
    ) VALUES (
      v_actor_auth_user_id, p_idempotency_key, v_request_fingerprint,
      v_safe_identity_outcome, v_person_resolution_audit_id
    );

    RETURN QUERY SELECT
      v_safe_identity_outcome,
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
      NULL::text, NULL::text, NULL::date, NULL::date,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::boolean, NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_organizer_person_id IS NULL THEN
    RAISE EXCEPTION 'Self-service organizer identity resolution returned no Person.';
  END IF;


  -- P-2D default capacity: a standard individual organizer may hold exactly
  -- ONE active unfinished private Draft event at a time.  Enforced here --
  -- after canonical-Person resolution has succeeded, before any Event row is
  -- written -- so a second active unfinished event is rejected server-side no
  -- matter what the browser sends.  A future paid tier raises the ceiling by
  -- changing public.self_service_default_active_event_limit() ALONE; this
  -- call site and the browser contract never change.
  IF (
    SELECT count(*)
    FROM public.self_service_organizer_appointments AS cap_oa
    JOIN public.self_service_private_event_drafts AS cap_d
      ON cap_d.organizer_appointment_id = cap_oa.id
    JOIN public.events AS cap_e
      ON cap_e.id = cap_d.event_id AND cap_e.tenant_id = cap_oa.tenant_id
    JOIN public.tenants AS cap_t ON cap_t.id = cap_oa.tenant_id
    WHERE cap_oa.person_id = v_organizer_person_id
      AND cap_oa.is_active = true
      AND cap_t.is_active = true
      AND cap_t.is_self_service_private_draft = true
      AND cap_e.status = 'Draft'
      AND cap_e.is_active = false
      AND cap_e.visible_to_members = false
  ) >= public.self_service_default_active_event_limit() THEN
    RAISE EXCEPTION 'You already have an active unfinished event. Finish or delete it before starting another.';
  END IF;

  -- Authorize against an EXISTING active organizer appointment whose subject
  -- IS the resolved canonical Person.  Person-scoped ONLY: a resolved caller
  -- can never reach another Person's event space through an appointment row
  -- that merely carries their auth_user_id.  The (person_id, tenant_id) active
  -- unique index makes this at most one row.
  SELECT oa.id
    INTO v_appointment_id
  FROM public.self_service_organizer_appointments AS oa
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  WHERE oa.tenant_id = p_organization_tenant_id
    AND oa.is_active = true
    AND oa.person_id = v_organizer_person_id
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
  LIMIT 1;

  IF v_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Organization not found.';
  END IF;

  INSERT INTO public.events (
    tenant_id, name, location, start_date, end_date, timezone, status,
    is_active, visible_to_members
  ) VALUES (
    p_organization_tenant_id, v_event_name, v_location, p_start_date, p_end_date,
    v_timezone, 'Draft', false, false
  ) RETURNING * INTO v_event;

  INSERT INTO public.self_service_private_event_drafts (
    event_id, tenant_id, organizer_appointment_id, location_mode, starter_template
  ) VALUES (
    v_event.id, p_organization_tenant_id, v_appointment_id, v_location_mode, v_starter_template
  );

  INSERT INTO public.self_service_onboarding_command_audit (
    actor_auth_user_id, idempotency_key, request_fingerprint, tenant_id,
    organizer_appointment_id, event_id, action
  ) VALUES (
    v_actor_auth_user_id, p_idempotency_key, v_request_fingerprint,
    p_organization_tenant_id, v_appointment_id, v_event.id, 'private_event_added'
  );

  RETURN QUERY
  SELECT
    'created'::text,
    t.id, oa.id, oa.person_id, e.id, t.organization_name, e.name, e.start_date,
    e.end_date, e.timezone, d.location_mode, e.location,
    d.starter_template, e.status, e.is_active, e.visible_to_members,
    e.created_at::timestamptz
  FROM public.self_service_private_event_drafts AS d
  JOIN public.self_service_organizer_appointments AS oa
    ON oa.id = d.organizer_appointment_id
  JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = d.tenant_id
  JOIN public.tenants AS t ON t.id = d.tenant_id
  WHERE d.event_id = v_event.id;
END;
$function$;

COMMIT;
