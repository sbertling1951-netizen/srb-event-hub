-- Private Event Passport entitlement foundation (delivery-sequence slice 1 of
-- docs/architecture/EPICENTRAX_PRIVATE_EVENT_PASSPORT_RESERVATION_CONTRACT.md).
--
-- Provider-independent only: no Stripe/payment-provider call, no money
-- movement, no launch, no invitations, no guest access, no browser UI change.
-- Adds exactly:
--
--   * public.self_service_event_passports -- one independent entitlement row
--     per Event that has ever begun a Passport. Deliberately holds ONLY the
--     fields the accepted contract requires: the Event ownership reference,
--     the Passport state, the payment-confirmed timestamp, the active-period
--     start/end timestamps, and created/updated facts. No Stripe customer/
--     session/payment id, no provider secret, no receipt content, no
--     checkout URL, no tax data, no refund/launch/renewal field -- those
--     belong to later, separately authorized slices. It is NOT an audit
--     table (it is a live, mutable entitlement record, unlike
--     self_service_event_deletion_audit / self_service_onboarding_command_audit),
--     but it is exactly as browser-inaccessible: RLS enabled, every grant
--     revoked from PUBLIC/anon/authenticated/service_role. No governed
--     RPC exists yet to write to it in this slice -- creation/transition
--     commands belong to the Stripe-checkout-and-webhook slice next in the
--     contract's delivery sequence. This migration only proves the state
--     model and its consequences are correct; a later migration adds the
--     governed commands that populate it.
--
--   * public.is_self_service_event_passport_preserved(uuid) -- the one
--     narrowly-scoped internal predicate every capacity/Delete/Replace path
--     below calls. "Preserved" means state IN ('reserved','active','expired')
--     -- exactly the three states the contract says no longer consume the
--     one-unpaid-event slot and are no longer eligible for ordinary Delete.
--     'payment_pending' and "no Passport row at all" both resolve to NOT
--     preserved, so they remain fully ordinary (count toward capacity,
--     remain deletable/replaceable) -- matching "a checkout that is merely
--     pending still consumes that slot" and "no Passport record means
--     ordinary unpaid draft" precisely. SECURITY DEFINER, STABLE, no EXECUTE
--     grant to any role: it is called only from other postgres-owned
--     SECURITY DEFINER functions in this same migration, which already
--     execute in the definer's own context -- exactly the established
--     nested-SECURITY-DEFINER pattern from the P0 event-photo migration
--     (20261010000000), restated here for the identical reason.
--
--   * create_self_service_organizer_draft, create_self_service_organizer_event,
--     and get_my_self_service_organizer_capacity restated with exactly one
--     added predicate in their capacity-counting queries:
--     "AND NOT public.is_self_service_event_passport_preserved(<event>.id)".
--     Every other line is verbatim from 20261011000000 (create_* functions)
--     / 20260926000000 (get_my_self_service_organizer_capacity, never
--     restated since). No GRANT/REVOKE is re-issued (CREATE OR REPLACE
--     preserves existing ownership and ACL, matching every prior
--     restatement in this family).
--
--   * delete_self_service_organizer_event restated with exactly one added
--     predicate in its ownership/eligibility query: the SAME
--     is_self_service_event_passport_preserved exclusion. A preserved
--     Event fails to match, exactly like a foreign, non-Draft, or already-
--     deleted Event today, and the function raises the SAME non-enumerating
--     'Event not found.' -- never a distinct message that would disclose
--     Passport state to an unauthorized caller, and never a refund or
--     cancellation side effect. Every other line is verbatim from
--     20261007000000 (its most recent prior restatement).
--
--   * Lun's correction: the FIRST restatement of this migration left
--     payment_pending Events completely undeletable in practice. The
--     Passport foreign key (events(id) ON DELETE RESTRICT) means any
--     self_service_event_passports row -- payment_pending included --
--     blocks a plain events delete, and this function's existing fail-closed
--     dependency scan (over every foreign key referencing public.events)
--     already treats an unaccounted-for child row as an abort condition.
--     Because "a checkout that is merely pending still consumes that slot;
--     it grants no entitlement," a payment_pending Event MUST remain
--     ordinarily deletable -- so this restatement adds, immediately after
--     ownership/eligibility is confirmed and before any dependent-data
--     scanning or Event deletion: a locked (FOR UPDATE), freshly-read check
--     of this Event's Passport state (defense-in-depth against a concurrent
--     transition even though no writer exists yet in this slice); the SAME
--     non-enumerating 'Event not found.' if that fresh read shows
--     reserved/active/expired; and, for payment_pending only, an explicit,
--     state-scoped DELETE of exactly that Event's own Passport row, followed
--     by a fail-closed recheck that no Passport row remains. This is the
--     ONLY Passport cleanup a governed command may ever perform -- it is not
--     a cascade, the foreign key keeps ON DELETE RESTRICT unchanged, and
--     reserved/active/expired rows are never deleted, updated, or touched by
--     it. The existing generic dependency scan is left completely unchanged
--     (self_service_event_passports is deliberately NOT added to its
--     exclusion list) so it still acts as a fail-closed backstop for this
--     table exactly as for every other one.
--
-- replace_self_service_organizer_event is NOT restated and NOT modified.
-- It delegates its entire deletion phase to delete_self_service_organizer_event
-- as an ordinary function call (see 20261011000000) -- fixing delete's
-- eligibility query once protects both the standalone Delete command AND
-- atomic Replace, with zero additional code. If a preserved Event is named,
-- the delegated call raises 'Event not found.', the whole replace aborts
-- with zero mutation, and the caller's actual Passport Event is completely
-- untouched -- exactly "no refund/cancellation behavior may be created."
--
-- What this migration does NOT do: no Stripe/payment-provider call, no
-- webhook, no checkout-session creation, no receipt, no launch transition,
-- no renewal/expiry scheduling, no browser UI change, no RLS/authority-
-- foundation change, no touch to FCOC, ordinary tenants, Platform/Tenant/
-- Event administration, P0 media boundaries, or P-2C's (still unexposed)
-- multi-space UI.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The independent Passport entitlement record.
-- ---------------------------------------------------------------------------
CREATE TABLE public.self_service_event_passports (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('payment_pending', 'reserved', 'active', 'expired')),
  -- Payment confirmation -- set only once a provider payment is actually
  -- confirmed (state moves out of 'payment_pending'). Never set merely
  -- because a checkout was initiated.
  paid_at timestamptz,
  -- The 12-month active period. Deliberately NULL until the Event actually
  -- launches -- "the 12-month active period begins only when the Event is
  -- successfully launched, never when payment is initiated or confirmed."
  active_period_started_at timestamptz,
  active_period_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_service_event_passports_paid_at_agrees_with_state CHECK (
    (state = 'payment_pending' AND paid_at IS NULL)
    OR (state IN ('reserved', 'active', 'expired') AND paid_at IS NOT NULL)
  ),
  CONSTRAINT self_service_event_passports_active_period_agrees_with_state CHECK (
    (state IN ('payment_pending', 'reserved') AND active_period_started_at IS NULL AND active_period_ends_at IS NULL)
    OR (state IN ('active', 'expired') AND active_period_started_at IS NOT NULL AND active_period_ends_at IS NOT NULL)
  )
);

ALTER TABLE public.self_service_event_passports OWNER TO postgres;

CREATE INDEX self_service_event_passports_state_idx
  ON public.self_service_event_passports (state);

ALTER TABLE public.self_service_event_passports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.self_service_event_passports
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The one internal preservation predicate every consumer below calls.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_self_service_event_passport_preserved(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'pg_catalog'
AS $function$
  -- A NULL p_event_id can never match a row, so this fails closed (false =
  -- "not preserved") on a missing/unresolved id, exactly like every other
  -- predicate in this migration family.
  SELECT EXISTS (
    SELECT 1 FROM public.self_service_event_passports AS p
    WHERE p.event_id = p_event_id
      AND p.state IN ('reserved', 'active', 'expired')
  );
$function$;

ALTER FUNCTION public.is_self_service_event_passport_preserved(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_self_service_event_passport_preserved(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. get_my_self_service_organizer_capacity: restated verbatim from
--    20260926000000 (never restated since) with the one added exclusion.
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
    AND e.visible_to_members = false
    AND NOT public.is_self_service_event_passport_preserved(e.id);

  RETURN QUERY SELECT v_limit, v_count, (v_count < v_limit);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. create_self_service_organizer_draft: restated verbatim from
--    20261011000000 with the one added exclusion, in both the capacity-count
--    query and the active_event_exists blocking-Event row-fetch (so a
--    Passport-preserved Event is never counted AND never surfaced as the
--    reason capacity is exhausted).
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

  -- P-2D.1: the capacity conflict is a caller-scoped structured outcome, not
  -- a raw exception. Passport correction: a Passport-preserved Event
  -- (reserved/active/expired) is excluded from BOTH the count and the
  -- blocking-Event row-fetch below -- it neither occupies the slot nor is
  -- ever named as the reason capacity is exhausted.
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
      AND NOT public.is_self_service_event_passport_preserved(cap_e.id)
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
      AND NOT public.is_self_service_event_passport_preserved(cap_e.id)
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
-- 5. create_self_service_organizer_event: identical treatment.
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

  -- Identical structured capacity-conflict outcome as
  -- create_self_service_organizer_draft, including the Passport exclusion.
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
      AND NOT public.is_self_service_event_passport_preserved(cap_e.id)
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
      AND NOT public.is_self_service_event_passport_preserved(cap_e.id)
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
-- 6. delete_self_service_organizer_event: restated verbatim from
--    20261007000000 with the one added exclusion in the ownership/
--    eligibility query. A Passport-preserved Event fails to match, exactly
--    like a foreign/non-Draft/already-deleted Event, and raises the SAME
--    non-enumerating 'Event not found.' -- this single change also protects
--    replace_self_service_organizer_event, which delegates its entire
--    deletion phase to this function unmodified.
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
  v_passport_state text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Deleting an unfinished event requires an authenticated verified account.';
  END IF;

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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'self_service_event_deletion:' || v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('self_service_event_deletion_target:' || p_event_id::text, 0)
  );

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

  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_actor) AS link;

  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

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
    AND NOT public.is_self_service_event_passport_preserved(e.id)
  LIMIT 1;

  IF v_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  -- Lun's correction: lock and recheck this Event's Passport state, in this
  -- same governed transaction, before any dependent-data scanning or Event
  -- deletion. FOR UPDATE takes a row lock when a Passport row exists, so a
  -- concurrent transaction cannot transition it to a preserved state
  -- underneath this deletion. reserved/active/expired fail closed here with
  -- the SAME non-enumerating 'Event not found.' even if a race somehow got
  -- them past the earlier ownership/eligibility filter above -- they are
  -- never deleted, cascaded, or otherwise touched.
  SELECT p.state
    INTO v_passport_state
  FROM public.self_service_event_passports AS p
  WHERE p.event_id = p_event_id
  FOR UPDATE;

  IF v_passport_state IN ('reserved', 'active', 'expired') THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  IF v_passport_state = 'payment_pending' THEN
    -- The ONLY permitted Passport cleanup a governed delete may ever
    -- perform: exactly this Event's own payment_pending row, state-scoped so
    -- this WHERE clause could never remove a row that is anything other than
    -- payment_pending. ON DELETE RESTRICT remains in force on the foreign
    -- key -- this explicit, narrowly-scoped DELETE (not a database cascade)
    -- is what makes ordinary deletion of a payment_pending Event possible.
    DELETE FROM public.self_service_event_passports AS p
    WHERE p.event_id = p_event_id
      AND p.state = 'payment_pending';

    -- Fail closed: if any Passport row still exists for this Event after the
    -- state-scoped cleanup above, something is wrong -- abort rather than
    -- proceed to delete an Event with dependent Passport data still present.
    IF EXISTS (
      SELECT 1 FROM public.self_service_event_passports AS p WHERE p.event_id = p_event_id
    ) THEN
      RAISE EXCEPTION
        'Unfinished event % has unexpected dependent data in self_service_event_passports; deletion aborted.',
        p_event_id;
    END IF;
  END IF;

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

  -- Open the governed DELETE window for this transaction only: the existing
  -- 'on' marker (immutable onboarding-command / tenant-lifecycle audit
  -- exception) plus a companion marker naming the exact Event id (the
  -- organizer-Agenda ledger exception below verifies BOTH).
  PERFORM set_config('app.self_service_governed_deletion', 'on', true);
  PERFORM set_config('app.self_service_governed_deletion_event_id', p_event_id::text, true);

  -- P-3B organizer-Agenda cleanup: THIS Event's known private-draft Agenda
  -- children, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Only this Event's organizer-branch P-3B Agenda ledger rows are removed;
  -- any non-organizer ledger row is left for the scan to fail closed on.
  DELETE FROM public.agenda_command_ledger AS acl
  WHERE acl.event_id = p_event_id
    AND acl.resolved_authority_branch = 'organizer'
    AND acl.task_key IS NULL
    AND acl.action IN (
      'organizer_private_agenda_item_created',
      'organizer_private_agenda_item_updated',
      'organizer_private_agenda_item_deleted'
    );

  DELETE FROM public.agenda_items AS ai
  WHERE ai.event_id = p_event_id;

  DELETE FROM public.event_agenda_state AS eas
  WHERE eas.event_id = p_event_id;

  -- P-3C organizer private guest-list cleanup: THIS Event's planned-guest
  -- rows, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Planning data only -- no identity, attendee, or invitation rows exist to
  -- remove, and the deletion audit records only the non-content fact of
  -- deletion (no guest names, emails, phones, or notes).
  DELETE FROM public.self_service_private_draft_planned_guests AS plg
  WHERE plg.event_id = p_event_id;

  -- P-3D organizer private vendor-plan cleanup: THIS Event's vendor-plan
  -- rows, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Planning data only -- no vendor account, contact, access, invitation,
  -- candidacy, admission, or disposition row exists to remove, and the
  -- deletion audit records only the non-content fact of deletion (no vendor
  -- names, categories, statuses, websites, contact details, or notes).
  DELETE FROM public.self_service_private_draft_vendor_plans AS svp
  WHERE svp.event_id = p_event_id;

  -- P-3E organizer private venue-plan cleanup: THIS Event's venue-plan rows,
  -- removed BEFORE the fail-closed dependency scan and Event delete. Planning
  -- data only -- no Event location, map object, Nearby place, catalog asset,
  -- vendor relationship, or identity row exists to remove, and the deletion
  -- audit records only the non-content fact of deletion (no place names,
  -- addresses, websites, contact names, phone numbers, statuses, or notes).
  DELETE FROM public.self_service_private_draft_venue_plans AS svnp
  WHERE svnp.event_id = p_event_id;

  -- P-3F organizer private registry-plan cleanup: THIS Event's registry-plan
  -- rows, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Planning data only -- no published registry, provider account,
  -- integration, payment, purchase, gift, or order row exists to remove, and
  -- the deletion audit records only the non-content fact of deletion (no
  -- provider names, URLs, statuses, or notes).
  DELETE FROM public.self_service_private_draft_registry_plans AS srp
  WHERE srp.event_id = p_event_id;

  -- P-3G organizer private planning-checklist cleanup: THIS Event's checklist
  -- rows, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Deliberately NO count is captured: the deletion audit must not learn how
  -- many private reminders the organizer kept, any more than what they said.
  DELETE FROM public.self_service_private_draft_checklist_items AS sci
  WHERE sci.event_id = p_event_id;

  -- P-3H organizer private budget-plan cleanup: THIS Event's budget-line rows,
  -- removed BEFORE the fail-closed dependency scan and Event delete. Private
  -- planning numbers only -- no payment, invoice, receipt, contract, order,
  -- purchase, or commerce row exists to remove, because none was ever created.
  -- Deliberately NO count and NO total is captured: the deletion audit must
  -- not learn how many budget lines the organizer kept, in what currency, or
  -- what they added up to, any more than what they were called. An aggregate
  -- amount is private financial content, not innocuous metadata.
  DELETE FROM public.self_service_private_draft_budget_lines AS sbl
  WHERE sbl.event_id = p_event_id;

  -- Complete dependency coverage: after the known private-draft children above,
  -- a hidden Draft self-service event must have no rows in ANY other events(id)
  -- child table.  If that is ever untrue, fail closed with zero partial
  -- deletion -- this whole function is one transaction.  The draft marker and
  -- onboarding command audit for THIS event are the expected children and are
  -- excluded.
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

  -- Children first: onboarding command audit -> draft marker -> event.
  DELETE FROM public.self_service_onboarding_command_audit AS ca
  WHERE ca.event_id = p_event_id;

  DELETE FROM public.self_service_private_event_drafts AS d
  WHERE d.event_id = p_event_id;

  DELETE FROM public.events AS e
  WHERE e.id = p_event_id;

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
  -- aborts the whole transaction, rolling both markers back regardless.)
  PERFORM set_config('app.self_service_governed_deletion', 'off', true);
  PERFORM set_config('app.self_service_governed_deletion_event_id', '', true);

  RETURN QUERY SELECT
    'deleted'::text, v_audit.deleted_event_id, v_audit.deleted_tenant_id,
    v_audit.deletion_scope, v_audit.removed_command_audit_count, v_audit.occurred_at;
END;
$function$;

COMMIT;
