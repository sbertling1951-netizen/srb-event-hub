-- P-2D.1: atomic private-event replacement, and a caller-scoped structured
-- capacity-conflict outcome in place of a raw exception.
--
-- Builds directly on 20260924000000 (P-2A/P-2B foundation), 20260925000000
-- (P-2C personal event reuse), and 20260926000000 (P-2D default one-active-
-- unfinished-event capacity + governed standalone deletion, most recently
-- restated verbatim-plus-one-value by 20261006000000 for the "wedding"
-- starter template). It adds exactly:
--
--   * public.replace_self_service_organizer_event(...) -- authenticated-only,
--     SECURITY DEFINER, idempotent. The ONE governed operation the accepted
--     Personal Event Planning Lifecycle contract (§5) requires: it deletes
--     the caller's own eligible unfinished private Event and creates a new
--     one in a SINGLE transaction. It delegates the entire deletion --
--     ownership re-verification, every private-draft-feature cleanup
--     (agenda, guests, vendor/venue/registry plans, checklist, budget), the
--     fail-closed dependency scan, and the core event/tenant teardown -- to
--     the existing, unmodified public.delete_self_service_organizer_event by
--     calling it as an ordinary function call inside this function's own
--     transaction. Nothing about deletion is duplicated or re-implemented.
--     New-draft creation reuses the exact same validation, fingerprinting,
--     identity-resolution, and row-construction shape as
--     create_self_service_organizer_draft, with the already-resolved
--     canonical Person carried forward instead of re-resolving.
--
--   * create_self_service_organizer_draft and create_self_service_organizer_event
--     restated with exactly one behavioral change: the capacity conflict that
--     used to RAISE EXCEPTION now returns a discriminated
--     'active_event_exists' outcome row naming only the CALLER'S OWN blocking
--     Event -- and only the minimum the UI needs to offer Continue or
--     Replace: its id, display name, and schedule (start/end date, timezone).
--     Adversarial-review correction (Lun): the canonical Person id, the
--     Event's status/is_active/visible_to_members lifecycle flags (never
--     read by the UI for this outcome), and every other column
--     (tenant_id/organizer_appointment_id/organization_name/location_mode/
--     location/starter_template/created_at) are all NULL for this outcome --
--     never another Person's data, never an internal identifier, never an
--     enumeration. Every other line is verbatim from 20261006000000 (which
--     was itself verbatim from 20260926000000 plus the "wedding" template
--     value). No GRANT/REVOKE is re-issued for them (CREATE OR REPLACE
--     preserves existing ownership and ACL, matching every prior restatement
--     of these two functions).
--
--   * one widened CHECK constraint on self_service_onboarding_command_audit.action
--     to accept 'private_event_replaced' alongside the existing
--     'private_draft_created' / 'private_event_added' values, so the atomic
--     replacement's creation half is recorded exactly like every other
--     governed creation, and reused for idempotent replay the same way.
--
-- What this migration does NOT do: it does not touch
-- delete_self_service_organizer_event itself, any private-draft-feature
-- table (agenda/guest/vendor/venue/registry/checklist/budget), Passport,
-- payment, launch, Event visibility/status semantics, Tenant/Event/Admin
-- authority, FCOC, catalog/vendor/place/map behavior, or the P-2C
-- multi-space RPCs' own authorization logic (create_self_service_organizer_event
-- keeps its existing "Organization not found." boundary; it merely gains the
-- same structured capacity-conflict outcome as its sibling).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Widen the command-audit action allow-list for the new governed action.
-- ---------------------------------------------------------------------------
ALTER TABLE public.self_service_onboarding_command_audit
  DROP CONSTRAINT self_service_onboarding_command_audit_action_check;

ALTER TABLE public.self_service_onboarding_command_audit
  ADD CONSTRAINT self_service_onboarding_command_audit_action_check
  CHECK (action IN ('private_draft_created', 'private_event_added', 'private_event_replaced'));

-- ---------------------------------------------------------------------------
-- 2. create_self_service_organizer_draft: restated verbatim from
--    20261006000000 except the capacity-conflict branch, which now returns a
--    caller-scoped structured outcome instead of raising. The blocking
--    Event's identifying columns are carried in the SAME output columns an
--    ordinary 'created' result would use (event_id/event_name/start_date/
--    end_date/timezone/status/is_active/visible_to_members), so the UI needs
--    no new field names to render "Continue" (which already only needs
--    event_id to link to /organize/{event_id}, where the full draft loads
--    independently through the existing caller-scoped reader).
--    tenant_id/organizer_appointment_id/organization_name/location_mode/
--    location/starter_template/created_at are NULL for this outcome -- the
--    blocking Event's own tenant/appointment/location/template are not this
--    caller's business to learn through the CREATE path; they are already
--    fully available (for the SAME caller) through list_my_self_service_private_drafts.
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
--   'created'             -> a private draft row (all other columns set)
--   'identity_confirmation_required' -> one possible prior identity; no draft
--   'identity_review_required'       -> ambiguous / disputed / invalid link; no draft
--   'active_event_exists' -> the caller already has one active unfinished
--                            private Event; only event_id/event_name/
--                            start_date/end_date/timezone identify ONLY that
--                            Event -- no Person id, no internal identifier,
--                            no lifecycle flag the UI does not consume.
-- The three non-'created' outcomes are EXPECTED safe results, returned
-- normally. Hard input / idempotency / authorization problems still RAISE.
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
    'casual', 'birthday_family', 'club_rv', 'conference_corporate', 'dinner', 'sports_activity',
    'wedding'
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

  -- P-2D.1: the capacity conflict is now a caller-scoped structured outcome,
  -- not a raw exception. It names ONLY the caller's own blocking Event --
  -- never another Person's row, never an enumeration of "why" beyond the
  -- fact that one already exists. Same count>=limit predicate as before
  -- (preserving the future-subscription seam), only the branch's action
  -- changes from RAISE to a normal returned row.
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
    RETURN QUERY
    SELECT
      'active_event_exists'::text,
      NULL::uuid, NULL::uuid, NULL::uuid, cap_e.id,
      NULL::text, cap_e.name, cap_e.start_date, cap_e.end_date, cap_e.timezone,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::boolean, NULL::boolean,
      NULL::timestamptz
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
    ORDER BY cap_e.created_at ASC
    LIMIT 1;
    RETURN;
  END IF;

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

-- ---------------------------------------------------------------------------
-- 3. create_self_service_organizer_event: identical treatment. The P-2C
--    "add to an existing space" authorization boundary ("Organization not
--    found.") is untouched; only the capacity-conflict branch changes shape.
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
--   'created' | 'identity_confirmation_required' | 'identity_review_required'
--   | 'active_event_exists'
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
    'casual', 'birthday_family', 'club_rv', 'conference_corporate', 'dinner', 'sports_activity',
    'wedding'
  ) THEN
    RAISE EXCEPTION 'Starter template is not recognized.';
  END IF;

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

  -- P-2D.1: identical structured capacity-conflict outcome as
  -- create_self_service_organizer_draft.
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
    RETURN QUERY
    SELECT
      'active_event_exists'::text,
      NULL::uuid, NULL::uuid, NULL::uuid, cap_e.id,
      NULL::text, cap_e.name, cap_e.start_date, cap_e.end_date, cap_e.timezone,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::boolean, NULL::boolean,
      NULL::timestamptz
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
    ORDER BY cap_e.created_at ASC
    LIMIT 1;
    RETURN;
  END IF;

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

-- ---------------------------------------------------------------------------
-- 4. The one atomic replacement operation. Deletion is entirely delegated to
--    the existing, unmodified public.delete_self_service_organizer_event
--    (called as an ordinary function call inside this function's own
--    transaction) -- every private-draft-feature cleanup and the fail-closed
--    dependency scan it performs apply unchanged, and its own idempotent-
--    replay-by-(actor,key) branch makes the delete half of a retry safe for
--    free. New-draft creation reuses create_self_service_organizer_draft's
--    validation/fingerprint/row shape verbatim, with the already-resolved
--    canonical Person carried forward (no second resolution call, no risk of
--    a duplicate Person or a second person_resolution_audit row).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_self_service_organizer_event(
  p_old_event_id uuid,
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
--   'replaced'                       -> old Event deleted, new draft created
--   'identity_confirmation_required' -> one possible prior identity; NOTHING
--                                       touched (old Event intact, no draft)
--   'identity_review_required'       -> ambiguous / disputed / invalid link;
--                                       NOTHING touched
-- Hard input / ownership / idempotency problems still RAISE, with zero
-- mutation (this whole function is one transaction).
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
  created_at timestamptz,
  deleted_event_id uuid,
  deletion_scope text
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
  v_delete_outcome text;
  v_deleted_event_id uuid;
  v_deleted_tenant_id uuid;
  v_deletion_scope text;
BEGIN
  IF v_actor_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Replacing an unfinished event requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    WHERE u.id = v_actor_auth_user_id
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Replacing an unfinished event requires a verified account email.';
  END IF;

  IF p_old_event_id IS NULL THEN
    RAISE EXCEPTION 'The event being replaced is required.';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required.';
  END IF;

  -- ----------------------------------------------------------------------
  -- Accept the COMPLETE valid new-draft input before touching the old Event
  -- at all -- identical validation to create_self_service_organizer_draft.
  -- ----------------------------------------------------------------------
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
    'casual', 'birthday_family', 'club_rv', 'conference_corporate', 'dinner', 'sports_activity',
    'wedding'
  ) THEN
    RAISE EXCEPTION 'Starter template is not recognized.';
  END IF;

  -- The fingerprint binds the OLD event id too, so a reused key naming a
  -- different old Event, or different new-draft input, always conflicts
  -- rather than silently replaying the wrong thing.
  v_request_fingerprint := encode(
    extensions.digest(
      convert_to(
        jsonb_build_array(
          p_old_event_id, v_organization_name, v_event_name, p_start_date, p_end_date,
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
      'self_service_event_replacement:' || v_actor_auth_user_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  -- Idempotent replay: the creation half is written LAST, so its presence
  -- proves the whole replacement (deletion included) already committed.
  SELECT * INTO v_existing
  FROM public.self_service_onboarding_command_audit AS a
  WHERE a.actor_auth_user_id = v_actor_auth_user_id
    AND a.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_request_fingerprint THEN
      RAISE EXCEPTION 'Idempotency key was already used with different replacement input.';
    END IF;

    SELECT a.deleted_event_id, a.deletion_scope
      INTO v_deleted_event_id, v_deletion_scope
    FROM public.self_service_event_deletion_audit AS a
    WHERE a.actor_auth_user_id = v_actor_auth_user_id
      AND a.idempotency_key = p_idempotency_key;

    RETURN QUERY
    SELECT
      'replaced'::text,
      t.id, oa.id, oa.person_id, e.id, t.organization_name, e.name, e.start_date,
      e.end_date, e.timezone, d.location_mode, e.location,
      d.starter_template, e.status, e.is_active, e.visible_to_members,
      e.created_at::timestamptz,
      v_deleted_event_id, v_deletion_scope
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

  SELECT * INTO v_safe_outcome_ledger
  FROM public.self_service_onboarding_safe_outcome_ledger AS l
  WHERE l.actor_auth_user_id = v_actor_auth_user_id
    AND l.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_safe_outcome_ledger.request_fingerprint <> v_request_fingerprint THEN
      RAISE EXCEPTION 'Idempotency key was already used with different replacement input.';
    END IF;

    RETURN QUERY SELECT
      v_safe_outcome_ledger.safe_outcome,
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
      NULL::text, NULL::text, NULL::date, NULL::date,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::boolean, NULL::boolean, NULL::timestamptz,
      NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Resolve the canonical Person ONCE. An uncertain outcome here means the
  -- old Event is left completely untouched -- deletion only ever happens
  -- below, after this succeeds.
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
      NULL::boolean, NULL::boolean, NULL::timestamptz,
      NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_organizer_person_id IS NULL THEN
    RAISE EXCEPTION 'Self-service organizer identity resolution returned no Person.';
  END IF;

  -- ----------------------------------------------------------------------
  -- Delegate the ENTIRE deletion -- ownership re-verification (so this can
  -- never touch another Person's Event: an unowned/foreign/ineligible/
  -- already-deleted p_old_event_id raises the same non-enumerating
  -- 'Event not found.' the standalone command already uses), every private-
  -- draft-feature cleanup, the fail-closed dependency scan, and the core
  -- event/tenant teardown -- to the existing governed command. Reusing this
  -- SAME idempotency key makes the deletion half of a retry idempotent for
  -- free through that function's own replay branch.
  -- ----------------------------------------------------------------------
  SELECT d.outcome, d.deleted_event_id, d.deleted_tenant_id, d.deletion_scope
    INTO v_delete_outcome, v_deleted_event_id, v_deleted_tenant_id, v_deletion_scope
  FROM public.delete_self_service_organizer_event(p_old_event_id, p_idempotency_key) AS d;

  -- ----------------------------------------------------------------------
  -- Create the new draft. Identical shape to create_self_service_organizer_draft
  -- from this point, using the Person already resolved above.
  -- ----------------------------------------------------------------------
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
    organizer_appointment_id, event_id, action
  ) VALUES (
    v_actor_auth_user_id, p_idempotency_key, v_request_fingerprint, v_tenant.id,
    v_appointment.id, v_event.id, 'private_event_replaced'
  );

  RETURN QUERY
  SELECT
    'replaced'::text,
    t.id, oa.id, oa.person_id, e.id, t.organization_name, e.name, e.start_date,
    e.end_date, e.timezone, d.location_mode, e.location,
    d.starter_template, e.status, e.is_active, e.visible_to_members,
    e.created_at::timestamptz,
    v_deleted_event_id, v_deletion_scope
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

ALTER FUNCTION public.replace_self_service_organizer_event(
  uuid, text, text, date, text, uuid, date, text, text, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.replace_self_service_organizer_event(
  uuid, text, text, date, text, uuid, date, text, text, text
) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.replace_self_service_organizer_event(
  uuid, text, text, date, text, uuid, date, text, text, text
) TO authenticated;

COMMIT;
