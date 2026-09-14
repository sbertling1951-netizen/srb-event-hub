-- Passport Refund Confirmation Column-Ambiguity Fix -- local-only database
-- behavior proof. Database-only: no Stripe SDK, API call, webhook, or real
-- money movement anywhere in this fixture. Every provider identifier below
-- is a fixture-only synthetic value; none references real Stripe, production,
-- a linked project, or any existing production identifier.
--
-- Run only after every migration through 20261020000000 has been applied to
-- an isolated LOCAL Supabase stack -- never against a linked or production
-- project. Creates isolated auth + identity rows, exercises the corrected
-- confirm_self_service_event_passport_refund(uuid, text, text) directly, and
-- rolls everything back. NOT executed as part of this implementation task --
-- proof-of-shape only, per this repository's established convention for
-- behavioral fixtures.
--
-- It proves:
--   1. one successful, signed-equivalent confirmation call against a
--      genuinely 'requested' refund request writes exactly one immutable
--      refund-audit row with the correct synthetic provider facts, advances
--      the request 'requested' -> 'confirmed', and moves the Passport
--      'reserved' -> 'refunded' with refunded_at set;
--   2. replaying the IDENTICAL provider evidence (same request id, same
--      provider_refund_id, same provider_event_id) a second time is a safe,
--      durable no-op: still exactly one audit row, and the same terminal
--      request/Passport state -- proving the exact ambiguity defect fixed in
--      20261020000000 no longer prevents the function body from running;
--   3. the payment attempt and original payment receipt/audit rows -- and
--      an unrelated ordinary FCOC/platform-Tenant Event and its admin
--      authority row -- are completely untouched by either call;
--   4. only service_role may call the confirmation command -- anon and
--      authenticated are both denied at the grant level, exactly as
--      20261018000000 established and this migration does not change;
--   5. zero fixture residue survives the fixture's own explicit ROLLBACK.

BEGIN;

CREATE OR REPLACE FUNCTION public.psp8_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Passport refund-confirmation column-ambiguity fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.psp8_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp8_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.psp8_assert(boolean, text) TO authenticated, service_role, anon;

CREATE OR REPLACE FUNCTION public.psp8_link(p_person_id uuid, p_auth_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', true, now());
$function$;
ALTER FUNCTION public.psp8_link(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp8_link(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp8_link(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp8_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.psp8_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp8_event_exists(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp8_event_exists(uuid) TO authenticated;

-- Closes Lun's P2 gap: the ordinary control Event's admin_event_access row
-- must be verified unchanged, not just the Event's own existence.
CREATE OR REPLACE FUNCTION public.psp8_ordinary_access_row_matches(
  p_admin_user_id uuid, p_event_id uuid, p_role text
)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_event_access
    WHERE admin_user_id = p_admin_user_id AND event_id = p_event_id AND role = p_role
  ) AND (SELECT count(*)::integer FROM public.admin_event_access WHERE event_id = p_event_id) = 1;
$function$;
ALTER FUNCTION public.psp8_ordinary_access_row_matches(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp8_ordinary_access_row_matches(uuid, uuid, text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp8_ordinary_access_row_matches(uuid, uuid, text) TO authenticated;

-- Fixture-only: reaches 'reserved' + a real receipt/audit row directly,
-- bypassing the real Stripe-contacting confirm route -- mirrors the
-- established psp6_set_reserved_with_receipt / psp5_set_reserved_with_receipt
-- pattern.
CREATE OR REPLACE FUNCTION public.psp8_set_reserved_with_receipt(
  p_event_id uuid, p_attempt_id uuid, p_provider_session_id text, p_provider_event_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_receipt_id uuid;
BEGIN
  UPDATE public.self_service_event_passports
     SET state = 'reserved', paid_at = now(), updated_at = now()
   WHERE event_id = p_event_id;
  UPDATE public.self_service_event_passport_payment_attempts
     SET state = 'confirmed', updated_at = now()
   WHERE id = p_attempt_id;
  INSERT INTO public.self_service_event_passport_payment_receipt_audit (
    provider_event_id, provider_session_id, event_id, attempt_id
  ) VALUES (
    p_provider_event_id, p_provider_session_id, p_event_id, p_attempt_id
  ) RETURNING id INTO v_receipt_id;
  RETURN v_receipt_id;
END;
$function$;
ALTER FUNCTION public.psp8_set_reserved_with_receipt(uuid, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp8_set_reserved_with_receipt(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Fixture-only postgres-owned direct-row readers -- table owner bypasses the
-- REVOKE ALL on every Passport/attempt/receipt/request/refund table, exactly
-- the same verification pattern the 20261013-20261019 fixtures already use.
CREATE OR REPLACE FUNCTION public.psp8_passport_row(p_event_id uuid)
RETURNS TABLE(state text, refunded_at timestamptz, paid_at timestamptz, updated_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT state, refunded_at, paid_at, updated_at
  FROM public.self_service_event_passports WHERE event_id = p_event_id;
$function$;
ALTER FUNCTION public.psp8_passport_row(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp8_passport_row(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp8_passport_row(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp8_request_state(p_request_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT state FROM public.self_service_event_passport_refund_requests WHERE id = p_request_id;
$function$;
ALTER FUNCTION public.psp8_request_state(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp8_request_state(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp8_request_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp8_attempt_state(p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT state FROM public.self_service_event_passport_payment_attempts WHERE id = p_attempt_id;
$function$;
ALTER FUNCTION public.psp8_attempt_state(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp8_attempt_state(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp8_attempt_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp8_receipt_exists(p_receipt_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.self_service_event_passport_payment_receipt_audit WHERE id = p_receipt_id);
$function$;
ALTER FUNCTION public.psp8_receipt_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp8_receipt_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp8_receipt_exists(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp8_audit_row_count(p_receipt_id uuid)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT count(*)::integer FROM public.self_service_event_passport_refund_audit
  WHERE receipt_audit_id = p_receipt_id;
$function$;
ALTER FUNCTION public.psp8_audit_row_count(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp8_audit_row_count(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp8_audit_row_count(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp8_audit_row(p_receipt_id uuid)
RETURNS TABLE(
  provider_refund_id text, provider_event_id text, event_id uuid,
  receipt_audit_id uuid, amount_minor_units integer
)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT provider_refund_id, provider_event_id, event_id, receipt_audit_id, amount_minor_units
  FROM public.self_service_event_passport_refund_audit WHERE receipt_audit_id = p_receipt_id;
$function$;
ALTER FUNCTION public.psp8_audit_row(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp8_audit_row(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp8_audit_row(uuid) TO authenticated;

-- Grant-denial probes -- exactly the established pattern.
CREATE OR REPLACE FUNCTION public.psp8_try_confirm_as_caller(
  p_request_id uuid, p_provider_refund_id text, p_provider_event_id text
)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM * FROM public.confirm_self_service_event_passport_refund(
    p_request_id, p_provider_refund_id, p_provider_event_id
  );
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$function$;
ALTER FUNCTION public.psp8_try_confirm_as_caller(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp8_try_confirm_as_caller(uuid, text, text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp8_try_confirm_as_caller(uuid, text, text) TO anon, authenticated;

DO $setup$
DECLARE
  v_person uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id IN (
      '9ee90000-0000-4000-8000-000000000001', -- Dana, organizer/owner, NOT an admin
      '9ee90000-0000-4000-8000-000000000002'  -- Admin1, super_admin
    )
  ) THEN
    RAISE EXCEPTION 'Passport refund-confirmation column-ambiguity fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('9ee90000-0000-4000-8000-000000000001', 'psp8-dana@fixture.invalid', now()),
    ('9ee90000-0000-4000-8000-000000000002', 'psp8-admin1@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp8_link(v_person, '9ee90000-0000-4000-8000-000000000001');

  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('psp8-admin1@fixture.invalid', '9ee90000-0000-4000-8000-000000000002', true, true, 'super_admin');
END;
$setup$;

-- ===========================================================================
-- 3 (checked first, as a control): an ordinary FCOC/platform Tenant Event
-- and its admin authority row.
-- ===========================================================================
DO $ordinary$
DECLARE
  v_ordinary_tenant uuid;
  v_ordinary_event uuid;
  v_ordinary_admin uuid;
BEGIN
  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title, is_active)
  VALUES ('psp8-ordinary-tenant', 'psp8-ordinary-tenant', 'PSP8 Ordinary Tenant', 'PSP8 Ordinary Tenant', 'PSP8 Ordinary Tenant', true)
  RETURNING id INTO v_ordinary_tenant;

  INSERT INTO public.events (name, tenant_id, status, is_active, visible_to_members, end_date, timezone)
  VALUES ('PSP8 Ordinary Event', v_ordinary_tenant, 'Active', true, true, current_date + 7, 'UTC')
  RETURNING id INTO v_ordinary_event;

  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('psp8-ordinary-admin@fixture.invalid', '9ee90000-0000-4000-8000-000000000099', true, false, 'event_admin')
  RETURNING id INTO v_ordinary_admin;

  INSERT INTO public.admin_event_access (admin_user_id, event_id, role)
  VALUES (v_ordinary_admin, v_ordinary_event, 'event_admin');

  PERFORM set_config('psp8.ordinary_event', v_ordinary_event::text, true);
  PERFORM set_config('psp8.ordinary_admin', v_ordinary_admin::text, true);
END;
$ordinary$;

-- ===========================================================================
-- Dana (organizer, NOT an admin) builds the one reserved-with-receipt Event
-- this fixture needs, as herself.
-- ===========================================================================
SET LOCAL ROLE authenticated;
DO $dana_setup$
DECLARE
  v_reserved record;
  v_prepared record;
  v_receipt_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee90000-0000-4000-8000-000000000001', true);

  SELECT * INTO v_reserved FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Reserved A', current_date + 7, 'UTC',
    '9ee9a000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp8_assert(v_reserved.outcome = 'created', 'the reserved-scenario draft is created');

  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_reserved.event_id, '9ee9a000-0000-4000-8000-000000000002'
  );
  PERFORM public.psp8_assert(v_prepared.outcome = 'prepared', 'the checkout attempt is prepared');

  SET LOCAL ROLE postgres;
  SELECT public.psp8_set_reserved_with_receipt(
    v_reserved.event_id, v_prepared.attempt_id, 'cs_fixture_psp8', 'evt_fixture_psp8_payment'
  ) INTO v_receipt_id;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee90000-0000-4000-8000-000000000001', true);

  PERFORM set_config('psp8.event_a', v_reserved.event_id::text, true);
  PERFORM set_config('psp8.attempt_a', v_prepared.attempt_id::text, true);
  PERFORM set_config('psp8.receipt_a', v_receipt_id::text, true);
END;
$dana_setup$;

-- ===========================================================================
-- Admin1 (genuine super-admin) creates the one 'requested' refund request
-- confirm_self_service_event_passport_refund needs to act on -- the ordinary
-- governed prepare path, exactly as production uses it.
-- ===========================================================================
DO $admin_request$
DECLARE
  v_request record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee90000-0000-4000-8000-000000000002', true);

  SELECT * INTO v_request FROM public.prepare_self_service_event_passport_refund_request(
    current_setting('psp8.event_a')::uuid, '9ee9d000-0000-4000-8000-000000000001'
  );
  PERFORM public.psp8_assert(v_request.outcome = 'requested', 'the refund request is created against the reserved Passport');
  PERFORM public.psp8_assert(v_request.state = 'requested', 'sanity: the new request starts in state requested');

  PERFORM set_config('psp8.request_a', v_request.request_id::text, true);
END;
$admin_request$;

-- ===========================================================================
-- 1: one successful confirmation call, exercised as service_role -- the
-- ONLY authorized caller in production -- with synthetic provider evidence.
-- Proves the exact defect 20261020000000 fixes no longer blocks this call.
-- ===========================================================================
SET LOCAL ROLE service_role;
DO $confirm_first$
DECLARE
  v_result record;
  v_request_id uuid := current_setting('psp8.request_a')::uuid;
  v_event_id uuid := current_setting('psp8.event_a')::uuid;
  v_receipt_id uuid := current_setting('psp8.receipt_a')::uuid;
BEGIN
  SELECT * INTO v_result FROM public.confirm_self_service_event_passport_refund(
    v_request_id, 're_fixture_psp8_confirm_1', 'evt_fixture_psp8_refund_1'
  );
  PERFORM public.psp8_assert(v_result.outcome = 'confirmed', 'the first confirmation call succeeds with outcome confirmed');
  PERFORM public.psp8_assert(v_result.event_id = v_event_id, 'the returned event_id matches the request''s own Event');
  PERFORM public.psp8_assert(v_result.state = 'refunded', 'the returned state is refunded');
END;
$confirm_first$;
SET LOCAL ROLE authenticated;

DO $verify_first$
DECLARE
  v_request_id uuid := current_setting('psp8.request_a')::uuid;
  v_event_id uuid := current_setting('psp8.event_a')::uuid;
  v_receipt_id uuid := current_setting('psp8.receipt_a')::uuid;
  v_passport record;
  v_audit record;
BEGIN
  -- Request: requested -> confirmed.
  PERFORM public.psp8_assert(
    public.psp8_request_state(v_request_id) = 'confirmed',
    'the refund request transitions requested -> confirmed'
  );

  -- Passport: reserved -> refunded, with refunded_at set and paid_at preserved.
  SELECT * INTO v_passport FROM public.psp8_passport_row(v_event_id);
  PERFORM public.psp8_assert(v_passport.state = 'refunded', 'the Passport transitions reserved -> refunded');
  PERFORM public.psp8_assert(v_passport.refunded_at IS NOT NULL, 'refunded_at is set on confirmation');
  PERFORM public.psp8_assert(v_passport.paid_at IS NOT NULL, 'paid_at from the original payment is preserved, not cleared');

  -- Exactly one immutable refund-audit row, with the correct synthetic
  -- provider facts and the fixed $24.00 amount.
  PERFORM public.psp8_assert(
    public.psp8_audit_row_count(v_receipt_id) = 1,
    'exactly one refund-audit row exists after the first confirmation'
  );
  SELECT * INTO v_audit FROM public.psp8_audit_row(v_receipt_id);
  PERFORM public.psp8_assert(v_audit.provider_refund_id = 're_fixture_psp8_confirm_1', 'the audit row carries the exact synthetic provider_refund_id');
  PERFORM public.psp8_assert(v_audit.provider_event_id = 'evt_fixture_psp8_refund_1', 'the audit row carries the exact synthetic provider_event_id');
  PERFORM public.psp8_assert(v_audit.event_id = v_event_id, 'the audit row carries the exact Event id');
  PERFORM public.psp8_assert(v_audit.receipt_audit_id = v_receipt_id, 'the audit row links to the exact original receipt');
  PERFORM public.psp8_assert(v_audit.amount_minor_units = 2400, 'the audit row records exactly the fixed $24.00 amount');

  -- No unrelated records changed: the original payment attempt and receipt
  -- rows survive, unaltered in identity, alongside the new refund evidence.
  PERFORM public.psp8_assert(
    public.psp8_attempt_state(current_setting('psp8.attempt_a')::uuid) = 'confirmed',
    'the original payment attempt row is untouched by refund confirmation'
  );
  PERFORM public.psp8_assert(
    public.psp8_receipt_exists(v_receipt_id),
    'the original payment receipt/audit row is untouched by refund confirmation'
  );
END;
$verify_first$;

-- ===========================================================================
-- 2: replaying the IDENTICAL provider evidence a second time is a durable,
-- safe no-op -- still exactly one audit row, same terminal states. This is
-- the exact call shape that a redelivered Stripe webhook would repeat.
-- ===========================================================================
SET LOCAL ROLE service_role;
DO $confirm_replay$
DECLARE
  v_result record;
  v_request_id uuid := current_setting('psp8.request_a')::uuid;
  v_event_id uuid := current_setting('psp8.event_a')::uuid;
BEGIN
  SELECT * INTO v_result FROM public.confirm_self_service_event_passport_refund(
    v_request_id, 're_fixture_psp8_confirm_1', 'evt_fixture_psp8_refund_1'
  );
  PERFORM public.psp8_assert(v_result.outcome = 'confirmed', 'the replayed confirmation call still reports outcome confirmed');
  PERFORM public.psp8_assert(v_result.event_id = v_event_id, 'the replay still returns the same event_id');
  PERFORM public.psp8_assert(v_result.state = 'refunded', 'the replay still returns state refunded');
END;
$confirm_replay$;
SET LOCAL ROLE authenticated;

DO $verify_replay$
DECLARE
  v_request_id uuid := current_setting('psp8.request_a')::uuid;
  v_event_id uuid := current_setting('psp8.event_a')::uuid;
  v_receipt_id uuid := current_setting('psp8.receipt_a')::uuid;
  v_passport record;
BEGIN
  PERFORM public.psp8_assert(
    public.psp8_audit_row_count(v_receipt_id) = 1,
    'the replay writes NO second audit row -- durable idempotency at both provider identities'
  );
  PERFORM public.psp8_assert(
    public.psp8_request_state(v_request_id) = 'confirmed',
    'the replay leaves the refund request at its terminal confirmed state'
  );
  SELECT * INTO v_passport FROM public.psp8_passport_row(v_event_id);
  PERFORM public.psp8_assert(v_passport.state = 'refunded', 'the replay leaves the Passport at its terminal refunded state');
END;
$verify_replay$;

-- ===========================================================================
-- 4: only service_role may call the confirmation command -- anon and
-- authenticated are both denied at the grant level, unaffected by this fix.
-- ===========================================================================
DO $no_authenticated_confirm$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp8_try_confirm_as_caller(
    current_setting('psp8.request_a')::uuid, 're_fixture_psp8_denied', 'evt_fixture_psp8_denied'
  ) INTO v_result;
  PERFORM public.psp8_assert(
    v_result = '42501',
    format('authenticated cannot call confirm_self_service_event_passport_refund directly (got %L)', v_result)
  );
END;
$no_authenticated_confirm$;

SET LOCAL ROLE anon;
DO $no_anon_confirm$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp8_try_confirm_as_caller(
    current_setting('psp8.request_a')::uuid, 're_fixture_psp8_denied', 'evt_fixture_psp8_denied'
  ) INTO v_result;
  PERFORM set_config('psp8.anon_result', v_result, true);
END;
$no_anon_confirm$;
SET LOCAL ROLE authenticated;
PERFORM public.psp8_assert(
  current_setting('psp8.anon_result') = '42501',
  format('anon cannot call confirm_self_service_event_passport_refund directly either (got %L)', current_setting('psp8.anon_result'))
);

-- ===========================================================================
-- 3 (verified last): the ordinary FCOC/platform Tenant Event and its admin
-- authority row are completely unaffected by everything above.
-- ===========================================================================
DO $ordinary_check$
BEGIN
  PERFORM public.psp8_assert(
    public.psp8_event_exists(current_setting('psp8.ordinary_event')::uuid),
    'the ordinary platform Event is untouched'
  );
  PERFORM public.psp8_assert(
    public.psp8_ordinary_access_row_matches(
      current_setting('psp8.ordinary_admin')::uuid,
      current_setting('psp8.ordinary_event')::uuid,
      'event_admin'
    ),
    'exactly the original synthetic admin_event_access row -- same admin identity, same Event identity, same role -- still exists, unchanged'
  );
END;
$ordinary_check$;

SET LOCAL ROLE postgres;

ROLLBACK;
