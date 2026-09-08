-- Add "wedding" as an accepted organizer starter-template key.
--
-- This is the smallest possible server-side change: ONE value is added to an
-- allow-list in four places (one CHECK constraint, three validation blocks).
-- Nothing else changes.
--
-- ===========================================================================
-- WHY THIS IS SAFE BETWEEN MIGRATION APPLY AND APP DEPLOY
-- ===========================================================================
-- The change is PURELY PERMISSIVE and therefore compatible in both directions:
--
--   * the six existing keys ('casual', 'birthday_family', 'club_rv',
--     'conference_corporate', 'dinner', 'sports_activity') remain accepted,
--     unchanged, in the same order, with the same error message for a value
--     outside the set;
--   * the currently-deployed build never SENDS 'wedding' -- its template
--     catalog does not contain it -- so it is unaffected by the wider set and
--     keeps working exactly as it does today;
--   * the new build, once deployed, may send 'wedding' and the server will
--     already accept it.
--
-- There is therefore no ordering hazard: this migration may sit applied for
-- any length of time before the application deploy.
--
-- What this migration does NOT do:
--   * NO backfill, NO data rewrite, NO UPDATE, NO INSERT, NO DELETE -- not a
--     single existing row is read or written. Every stored starter_template
--     value already satisfies the widened constraint by construction, because
--     the new set is a strict superset of the old one;
--   * it changes NO authority predicate, ownership rule, eligibility check,
--     idempotency fingerprint, optimistic-concurrency baseline, deletion path,
--     grant, ACL, RLS policy, or lifecycle behavior. The three functions are
--     restated VERBATIM apart from the single allow-list line in each;
--   * it adds NO wedding-specific workflow, readiness rule, agenda,
--     checklist, guest, vendor, venue, registry, payment, Passport, tenant, or
--     public behavior. 'wedding' is a neutral private-draft starting point and
--     is treated by the server exactly like the other six keys.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Widen the stored-value CHECK on the private-draft marker.
--
--    The new set is a strict superset of the old one, so every existing row
--    already satisfies it; the validation scan Postgres performs on ADD
--    CONSTRAINT can only pass. The table holds one row per unfinished
--    self-service draft, so the ACCESS EXCLUSIVE lock is momentary. Drop and
--    add happen in the same transaction, so no session ever observes the
--    table without a constraint.
-- ---------------------------------------------------------------------------
ALTER TABLE public.self_service_private_event_drafts
  DROP CONSTRAINT self_service_private_event_drafts_starter_template_check;

ALTER TABLE public.self_service_private_event_drafts
  ADD CONSTRAINT self_service_private_event_drafts_starter_template_check
  CHECK (starter_template IN (
    'casual',
    'birthday_family',
    'club_rv',
    'conference_corporate',
    'dinner',
    'sports_activity',
    'wedding'
  ));

-- ---------------------------------------------------------------------------
-- 2. create_self_service_organizer_draft: restated VERBATIM from
--    20260926000000 with ONE added allow-list value.
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

-- ---------------------------------------------------------------------------
-- 3. create_self_service_organizer_event: restated VERBATIM from
--    20260926000000 with ONE added allow-list value.
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
    'casual', 'birthday_family', 'club_rv', 'conference_corporate', 'dinner', 'sports_activity',
    'wedding'
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

-- ---------------------------------------------------------------------------
-- 4. save_my_self_service_private_draft_details: restated VERBATIM from
--    20260927000000 with ONE added allow-list value. The optimistic-
--    concurrency baseline comparison is untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_my_self_service_private_draft_details(
  p_event_id uuid,
  -- proposed values (same field set + rules as create_self_service_organizer_draft)
  p_event_name text,
  p_start_date date,
  p_end_date date,
  p_timezone text,
  p_location_mode text,
  p_location text,
  p_starter_template text,
  -- expected persisted baseline, as loaded by this editor
  p_expected_event_name text,
  p_expected_start_date date,
  p_expected_end_date date,
  p_expected_timezone text,
  p_expected_location text,
  p_expected_location_mode text,
  p_expected_starter_template text
)
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
  v_actor uuid := auth.uid();
  v_event_name text := nullif(btrim(p_event_name), '');
  v_timezone text := nullif(btrim(p_timezone), '');
  v_location_mode text := nullif(btrim(p_location_mode), '');
  v_location text := nullif(btrim(p_location), '');
  v_starter_template text := nullif(btrim(p_starter_template), '');
  v_link_status text;
  v_person_id uuid;
  v_event public.events%ROWTYPE;
  v_draft public.self_service_private_event_drafts%ROWTYPE;
  v_appointment_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Saving event details requires an authenticated verified account.';
  END IF;

  -- Same verified-account contract as the create / delete commands.
  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Saving event details requires a verified account email.';
  END IF;

  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  -- Same validation as draft creation (verbatim messages).
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

  -- Fail-closed identity: exactly-resolved, or a genuinely unlinked account
  -- matched only by its OWN appointment row (same precedence as the read /
  -- delete RPCs).  Anything else is treated as a missing draft.
  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_actor) AS link;

  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  -- Authorize + lock: a hidden, inactive, non-member-visible Draft in an
  -- active private self-service tenant the caller personally organizes.
  -- Person-scoped when resolved; own-appointment only when no_link.  Locks
  -- the events row and the draft-marker row against a concurrent save/delete.
  SELECT e.*
    INTO v_event
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
  FOR UPDATE OF e
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  SELECT d.*
    INTO v_draft
  FROM public.self_service_private_event_drafts AS d
  WHERE d.event_id = p_event_id
  FOR UPDATE;

  v_appointment_id := v_draft.organizer_appointment_id;

  -- Optimistic stale-save protection: if the persisted baseline differs from
  -- what the editor loaded, write NEITHER table.
  IF v_event.name IS DISTINCT FROM p_expected_event_name
     OR v_event.start_date IS DISTINCT FROM p_expected_start_date
     OR v_event.end_date IS DISTINCT FROM p_expected_end_date
     OR v_event.timezone IS DISTINCT FROM p_expected_timezone
     OR v_event.location IS DISTINCT FROM p_expected_location
     OR v_draft.location_mode IS DISTINCT FROM p_expected_location_mode
     OR v_draft.starter_template IS DISTINCT FROM p_expected_starter_template
  THEN
    RAISE EXCEPTION 'stale_draft_details';
  END IF;

  UPDATE public.events AS e
  SET name = v_event_name,
      start_date = p_start_date,
      end_date = p_end_date,
      timezone = v_timezone,
      location = v_location
  WHERE e.id = p_event_id;

  UPDATE public.self_service_private_event_drafts AS d
  SET location_mode = v_location_mode,
      starter_template = v_starter_template
  WHERE d.event_id = p_event_id;

  -- Return the same safe draft shape get_my_self_service_private_draft returns,
  -- re-validating every draft / private / active predicate.
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
  WHERE oa.id = v_appointment_id
    AND oa.is_active = true
    AND d.event_id = p_event_id
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false;
END;
$function$;

COMMIT;
