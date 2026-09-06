-- P-2C: personal event-space reuse for a returning self-service organizer.
--
-- P-2A/P-2B (20260924000000) gave a verified account exactly ONE governed
-- path: create a new private tenant + organizer appointment + hidden Draft
-- event, every time.  P-2C lets a RETURNING canonical Person:
--   * resume the private drafts she personally organizes (unchanged);
--   * add another private Draft event to an event space she already
--     organizes, WITHOUT creating a second tenant or appointment; and
--   * still deliberately create a separate event space -- the existing
--     20260924000000 create_self_service_organizer_draft command, unchanged.
--
-- "Event space" is the user-facing name for a self-service private tenant a
-- canonical Person personally organizes.  Nothing here weakens a global
-- authority predicate (has_platform_admin_authority /
-- has_tenant_admin_authority / has_event_admin_authority), a tenant/event RLS
-- policy, the _is_self_service_private_draft_tenant helper, or the seven
-- Platform / Tenant Administration exclusions -- it only lets ONE existing
-- event space hold more than one Draft event, makes the organizer read
-- surface Person-first, and adds one governed add-event command.
--
-- No Platform / Tenant / Event administrator, admin_users, admin_event_access,
-- admin_tenant_access, or person_tenant_administrator_appointments row is
-- created by any P-2C path.  The one add-event command is, like the P-2A
-- create command, the only browser mutation boundary it introduces.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. One Draft event per event space was encoded only by this UNIQUE
--    constraint on the draft-marker table (one organizer appointment per
--    tenant -> one draft-marker row per tenant).  Drop only it.  The event_id
--    PRIMARY KEY still guarantees one draft-marker row per event, and every
--    foreign key, CHECK, and the (tenant_id, organizer_appointment_id)
--    columns themselves are unchanged.
-- ---------------------------------------------------------------------------
ALTER TABLE public.self_service_private_event_drafts
  DROP CONSTRAINT self_service_private_event_drafts_tenant_appointment_unique;

-- ---------------------------------------------------------------------------
-- 2. The organizer appointment's real subject is the canonical Person
--    (P-2B).  Enforce at most one ACTIVE appointment per (person_id,
--    tenant_id), mirroring the existing active-scoped partial indexes and the
--    soft-inactive model -- a revoked/superseded appointment stays as history.
--    The existing full UNIQUE (auth_user_id, tenant_id) constraint is kept.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX self_service_organizer_appointments_active_person_tenant_key
  ON public.self_service_organizer_appointments (person_id, tenant_id)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 3. Record the new governed action for adding an event to an existing event
--    space.  'private_draft_created' (the first event of a new space) is
--    kept; the immutable-audit trigger and the (actor, key) uniqueness are
--    unchanged.
-- ---------------------------------------------------------------------------
ALTER TABLE public.self_service_onboarding_command_audit
  DROP CONSTRAINT self_service_onboarding_command_audit_action_check;

ALTER TABLE public.self_service_onboarding_command_audit
  ADD CONSTRAINT self_service_onboarding_command_audit_action_check
  CHECK (action IN ('private_draft_created', 'private_event_added'));

-- ---------------------------------------------------------------------------
-- 4. Person-first organizer reads, with an identity-CONDITIONAL fallback.
--
--    resolve_auth_person_link returns exactly one of 'resolved' / 'no_link' /
--    'invalid_or_ambiguous'.  Ownership is decided by that status, never by a
--    blanket disjunction:
--
--      * 'resolved'            -> match ONLY oa.person_id = <resolved Person>.
--                                The caller's auth_user_id is NEVER an
--                                alternative authorization path, so a resolved
--                                caller cannot reach another Person's space
--                                through an appointment row that merely
--                                carries their auth_user_id.
--      * 'no_link'             -> match ONLY oa.auth_user_id = auth.uid().
--                                This is the narrow backward-compatibility
--                                fallback for an appointment whose Person link
--                                was later removed; it still only ever matches
--                                the caller's OWN appointment row.
--      * 'invalid_or_ambiguous' (or anything else) -> match nothing; the
--                                function returns no rows.
--
--    list_my_self_service_private_drafts and get_my_self_service_private_draft
--    are restated verbatim from 20260924000000 with ONLY the ownership
--    predicate changed; every draft / private / active predicate is retained.
--    CREATE OR REPLACE preserves their postgres ownership and
--    authenticated-only EXECUTE ACL (same approach as 20260923000000), so no
--    GRANT/REVOKE is re-issued for them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_self_service_private_organizations()
RETURNS TABLE(
  tenant_id uuid,
  organizer_appointment_id uuid,
  organizer_person_id uuid,
  organization_name text,
  draft_event_count bigint,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_link_status text;
  v_person_id uuid;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_auth_user_id) AS link;

  -- Only an exactly-resolved or a genuinely unlinked caller can own rows here.
  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    oa.id,
    oa.person_id,
    t.organization_name,
    (
      SELECT count(*)
      FROM public.self_service_private_event_drafts AS d
      JOIN public.events AS e
        ON e.id = d.event_id
       AND e.tenant_id = oa.tenant_id
      WHERE d.organizer_appointment_id = oa.id
        AND e.status = 'Draft'
        AND e.is_active = false
        AND e.visible_to_members = false
    ),
    oa.created_at
  FROM public.self_service_organizer_appointments AS oa
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  WHERE oa.is_active = true
    AND (
      (v_link_status = 'resolved' AND oa.person_id = v_person_id)
      OR (v_link_status = 'no_link' AND oa.auth_user_id = v_auth_user_id)
    )
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
  ORDER BY oa.created_at DESC, t.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_self_service_private_draft(p_event_id uuid)
RETURNS TABLE(
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
  v_auth_user_id uuid := auth.uid();
  v_link_status text;
  v_person_id uuid;
BEGIN
  IF v_auth_user_id IS NULL OR p_event_id IS NULL THEN
    RETURN;
  END IF;

  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_auth_user_id) AS link;

  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    oa.id,
    oa.person_id,
    e.id,
    t.organization_name,
    e.name,
    e.start_date,
    e.end_date,
    e.timezone,
    d.location_mode,
    e.location,
    d.starter_template,
    e.status,
    e.is_active,
    e.visible_to_members,
    e.created_at::timestamptz
  FROM public.self_service_organizer_appointments AS oa
  JOIN public.self_service_private_event_drafts AS d
    ON d.organizer_appointment_id = oa.id
  JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  WHERE (
      (v_link_status = 'resolved' AND oa.person_id = v_person_id)
      OR (v_link_status = 'no_link' AND oa.auth_user_id = v_auth_user_id)
    )
    AND oa.is_active = true
    AND d.event_id = p_event_id
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_self_service_private_drafts()
RETURNS TABLE(
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
  v_auth_user_id uuid := auth.uid();
  v_link_status text;
  v_person_id uuid;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_auth_user_id) AS link;

  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    oa.id,
    oa.person_id,
    e.id,
    t.organization_name,
    e.name,
    e.start_date,
    e.end_date,
    e.timezone,
    d.location_mode,
    e.location,
    d.starter_template,
    e.status,
    e.is_active,
    e.visible_to_members,
    e.created_at::timestamptz
  FROM public.self_service_organizer_appointments AS oa
  JOIN public.self_service_private_event_drafts AS d
    ON d.organizer_appointment_id = oa.id
  JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  WHERE (
      (v_link_status = 'resolved' AND oa.person_id = v_person_id)
      OR (v_link_status = 'no_link' AND oa.auth_user_id = v_auth_user_id)
    )
    AND oa.is_active = true
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false
  ORDER BY e.created_at DESC, e.id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Governed "add a private Draft event to an existing personal event space"
--    command.
--
--    It is deliberately the same shape as create_self_service_organizer_draft
--    MINUS the organization name (the event space already exists; P-2C does
--    not rename it) and MINUS every tenant/appointment/activation write.  It:
--
--      * derives the actor from auth.uid() only; accepts no caller-supplied
--        Person, authority, status, visibility, tenant ownership, lifecycle,
--        or organization-name value;
--      * requires the same verified-account contract as the P-2A command;
--      * fingerprints the target event space together with every narrow event
--        input, and shares the (actor, idempotency_key) command-audit and
--        safe-outcome-ledger tables -- identical replay / conflict behavior;
--      * resolves the organizer's canonical Person with the SAME precedence
--        and SAME safe outcomes as the P-2A command (exact link decides;
--        anything else is classified by the governed audited resolver; an
--        EXPECTED uncertain outcome is RETURNED, never RAISEd, so its
--        person_resolution_audit row commits while nothing downstream is
--        written);
--      * authorizes ONLY against an existing ACTIVE organizer appointment
--        whose person_id IS the resolved canonical Person, in the supplied
--        event space, and only when the event space is an active private
--        self-service draft tenant.  By the time authorization runs, identity
--        resolution has succeeded ('resolved_existing' or 'created_new'), so
--        the organizer is a canonical Person and the appointment's
--        auth_user_id is a linkage/idempotency fact only -- never an
--        authorization path.  Every other tenant -- ordinary, inactive,
--        someone else's, or one where the caller is merely a member /
--        attendee / Event Admin / Tenant Admin -- is indistinguishable from a
--        missing id: 'Organization not found.'
--        (An unauthorized caller whose identity resolver transiently created a
--        Person in the zero-evidence branch is fully rolled back by that
--        RAISE -- no tenant, appointment, Person, link, event, or audit row
--        persists.)
--      * creates ONLY one events row (Draft / inactive / hidden), one
--        self_service_private_event_drafts row against the EXISTING
--        appointment, and one self_service_onboarding_command_audit row with
--        action 'private_event_added'.  No tenant, no appointment, no
--        self_service_tenant_lifecycle_audit row, no admin/authority row.
-- ---------------------------------------------------------------------------
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

ALTER FUNCTION public.list_my_self_service_private_organizations() OWNER TO postgres;
ALTER FUNCTION public.create_self_service_organizer_event(
  uuid, text, date, text, uuid, date, text, text, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_my_self_service_private_organizations()
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.create_self_service_organizer_event(
  uuid, text, date, text, uuid, date, text, text, text
) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.list_my_self_service_private_organizations()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_self_service_organizer_event(
  uuid, text, date, text, uuid, date, text, text, text
) TO authenticated;

COMMIT;
