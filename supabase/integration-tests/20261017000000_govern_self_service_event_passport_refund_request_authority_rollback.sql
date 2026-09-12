-- Passport Super-Admin Refund Authority Foundation -- linked-database
-- behavior proof. Database-only: no Stripe SDK, API call, webhook, or money
-- movement anywhere in this fixture.
--
-- Run only after every migration through 20261017000000 has been applied.
-- Creates isolated auth + identity rows, exercises the new table/functions
-- as the super-admin / ordinary-authenticated / organizer-owner / anon /
-- service_role roles, and rolls everything back.
-- NOT executed as part of this implementation task -- proof-of-shape only,
-- per this repository's established convention for behavioral fixtures.
--
-- It proves:
--   1. a non-super-admin (ordinary authenticated caller, INCLUDING the
--      organizer who actually owns the Event) cannot create a request, and
--      cannot enumerate anything -- the SAME authority denial regardless of
--      ownership;
--   2. a verified super-admin gains NO general private-tenant/Event
--      browsing authority -- only this exact command against a supplied
--      opaque Event id succeeds; direct reads of organizer-private tables
--      remain denied at the grant level;
--   3. active, expired, payment_pending, refunded, and missing Passports
--      ALL fail closed to the same non-enumerating outcome -- only reserved
--      succeeds;
--   4. idempotent replay (same caller + key) returns the SAME request;
--      reusing a key for a different Event raises; a second, non-replay
--      request for the SAME receipt (same or different admin, different
--      key) is reported as 'refund_already_requested', never a duplicate
--      row;
--   5. the refund/request table denies anon, authenticated, AND
--      service_role at the grant level -- no policy, no table access for
--      any role;
--   6. the service-only reader returns exactly the four documented columns
--      for service_role, and is denied to anon/authenticated;
--   7. existing delete, payment confirmation, receipt-audit, and
--      private-draft isolation behavior is completely unaffected
--      (regression);
--   8. an ordinary FCOC/platform-Tenant Event, and its admin/authority
--      rows, are completely untouched by any of the above;
--   9. zero fixture residue survives the fixture's own explicit ROLLBACK.

BEGIN;

CREATE OR REPLACE FUNCTION public.psp6_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Passport refund-request-authority fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.psp6_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp6_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.psp6_assert(boolean, text) TO authenticated, service_role, anon;

CREATE OR REPLACE FUNCTION public.psp6_link(p_person_id uuid, p_auth_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', true, now());
$function$;
ALTER FUNCTION public.psp6_link(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp6_link(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp6_link(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp6_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.psp6_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp6_event_exists(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp6_event_exists(uuid) TO authenticated;

-- Fixture-only: reaches 'reserved' + a real receipt/audit row directly,
-- bypassing the real Stripe-contacting confirm route -- mirrors the
-- established psp5_set_reserved_with_receipt pattern.
CREATE OR REPLACE FUNCTION public.psp6_set_reserved_with_receipt(
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
ALTER FUNCTION public.psp6_set_reserved_with_receipt(uuid, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp6_set_reserved_with_receipt(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Fixture-only: forces every OTHER Passport state this fixture needs to
-- prove rejected -- 'active'/'expired' (with a launched active period, the
-- only shape those states may ever carry), 'refunded', or leaves the
-- Passport row entirely absent ('missing' -- p_state NULL).
CREATE OR REPLACE FUNCTION public.psp6_force_passport_state(p_event_id uuid, p_state text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_state IS NULL THEN
    DELETE FROM public.self_service_event_passports WHERE event_id = p_event_id;
    RETURN;
  END IF;

  IF p_state IN ('active', 'expired') THEN
    UPDATE public.self_service_event_passports
       SET state = p_state, paid_at = coalesce(paid_at, now()),
           active_period_started_at = now(), active_period_ends_at = now() + interval '365 days',
           updated_at = now()
     WHERE event_id = p_event_id;
  ELSIF p_state = 'refunded' THEN
    UPDATE public.self_service_event_passports
       SET state = 'refunded', paid_at = coalesce(paid_at, now()), refunded_at = now(),
           active_period_started_at = NULL, active_period_ends_at = NULL,
           updated_at = now()
     WHERE event_id = p_event_id;
  ELSE
    UPDATE public.self_service_event_passports
       SET state = p_state, updated_at = now()
     WHERE event_id = p_event_id;
  END IF;
END;
$function$;
ALTER FUNCTION public.psp6_force_passport_state(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp6_force_passport_state(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.psp6_request_row_count(p_receipt_id uuid)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT count(*)::integer FROM public.self_service_event_passport_refund_requests
  WHERE receipt_audit_id = p_receipt_id;
$function$;
ALTER FUNCTION public.psp6_request_row_count(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp6_request_row_count(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp6_request_row_count(uuid) TO authenticated;

-- Grant-denial probes -- exactly the established pattern.
CREATE OR REPLACE FUNCTION public.psp6_try_select_requests()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM 1 FROM public.self_service_event_passport_refund_requests LIMIT 1;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$function$;
ALTER FUNCTION public.psp6_try_select_requests() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp6_try_select_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.psp6_try_select_requests() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.psp6_try_select_organizer_drafts()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM 1 FROM public.self_service_private_event_drafts LIMIT 1;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$function$;
ALTER FUNCTION public.psp6_try_select_organizer_drafts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp6_try_select_organizer_drafts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.psp6_try_select_organizer_drafts() TO authenticated;

CREATE OR REPLACE FUNCTION public.psp6_try_server_reader_as_caller(p_request_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM * FROM public.get_self_service_event_passport_refund_request_for_server(p_request_id);
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$function$;
ALTER FUNCTION public.psp6_try_server_reader_as_caller(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp6_try_server_reader_as_caller(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp6_try_server_reader_as_caller(uuid) TO anon, authenticated;

DO $setup$
DECLARE
  v_person uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id IN (
      '9ee70000-0000-4000-8000-000000000001', -- Dana, organizer
      '9ee70000-0000-4000-8000-000000000002', -- Charlie, ordinary authenticated, non-admin
      '9ee70000-0000-4000-8000-000000000003', -- Admin1, super_admin
      '9ee70000-0000-4000-8000-000000000004'  -- Admin2, super_admin
    )
  ) THEN
    RAISE EXCEPTION 'Passport refund-request-authority fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('9ee70000-0000-4000-8000-000000000001', 'psp6-dana@fixture.invalid', now()),
    ('9ee70000-0000-4000-8000-000000000002', 'psp6-charlie@fixture.invalid', now()),
    ('9ee70000-0000-4000-8000-000000000003', 'psp6-admin1@fixture.invalid', now()),
    ('9ee70000-0000-4000-8000-000000000004', 'psp6-admin2@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp6_link(v_person, '9ee70000-0000-4000-8000-000000000001');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp6_link(v_person, '9ee70000-0000-4000-8000-000000000002');

  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('psp6-admin1@fixture.invalid', '9ee70000-0000-4000-8000-000000000003', true, true, 'super_admin');

  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('psp6-admin2@fixture.invalid', '9ee70000-0000-4000-8000-000000000004', true, true, 'super_admin');
END;
$setup$;

-- ===========================================================================
-- 8 (checked first, as a control): an ordinary FCOC/platform Tenant Event
-- and its admin authority row.
-- ===========================================================================
DO $ordinary$
DECLARE
  v_ordinary_tenant uuid;
  v_ordinary_event uuid;
  v_ordinary_admin uuid;
BEGIN
  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title, is_active)
  VALUES ('psp6-ordinary-tenant', 'psp6-ordinary-tenant', 'PSP6 Ordinary Tenant', 'PSP6 Ordinary Tenant', 'PSP6 Ordinary Tenant', true)
  RETURNING id INTO v_ordinary_tenant;

  INSERT INTO public.events (name, tenant_id, status, is_active, visible_to_members, end_date, timezone)
  VALUES ('PSP6 Ordinary Event', v_ordinary_tenant, 'Active', true, true, current_date + 7, 'UTC')
  RETURNING id INTO v_ordinary_event;

  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('psp6-ordinary-admin@fixture.invalid', '9ee70000-0000-4000-8000-000000000099', true, false, 'event_admin')
  RETURNING id INTO v_ordinary_admin;

  INSERT INTO public.admin_event_access (admin_user_id, event_id, role)
  VALUES (v_ordinary_admin, v_ordinary_event, 'event_admin');

  PERFORM set_config('psp6.ordinary_tenant', v_ordinary_tenant::text, true);
  PERFORM set_config('psp6.ordinary_event', v_ordinary_event::text, true);
END;
$ordinary$;

-- ===========================================================================
-- Dana (organizer) builds every scenario Event, as herself.
-- ===========================================================================
SET LOCAL ROLE authenticated;
DO $dana_setup$
DECLARE
  v_reserved_a record;
  v_reserved_b record;
  v_pending record;
  v_active record;
  v_expired record;
  v_refunded record;
  v_missing record;
  v_prepared record;
  v_receipt_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee70000-0000-4000-8000-000000000001', true);

  -- Event A: reserved -- the one eligible scenario, used for the main
  -- request/idempotency/duplicate proof.
  SELECT * INTO v_reserved_a FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Reserved A', current_date + 7, 'UTC',
    '9ee7a000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp6_assert(v_reserved_a.outcome = 'created', 'Event A draft created');
  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_reserved_a.event_id, '9ee7a000-0000-4000-8000-000000000002'
  );
  SET LOCAL ROLE postgres;
  SELECT public.psp6_set_reserved_with_receipt(
    v_reserved_a.event_id, v_prepared.attempt_id, 'cs_test_a', 'evt_test_a'
  ) INTO v_receipt_id;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee70000-0000-4000-8000-000000000001', true);
  PERFORM set_config('psp6.event_a', v_reserved_a.event_id::text, true);
  PERFORM set_config('psp6.receipt_a', v_receipt_id::text, true);

  -- Event B: reserved -- used ONLY for the idempotency-key-reused-for-a-
  -- different-event conflict proof.
  SELECT * INTO v_reserved_b FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Reserved B', current_date + 7, 'UTC',
    '9ee7a000-0000-4000-8000-000000000003', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp6_assert(v_reserved_b.outcome = 'created', 'Event B draft created');
  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_reserved_b.event_id, '9ee7a000-0000-4000-8000-000000000004'
  );
  SET LOCAL ROLE postgres;
  PERFORM public.psp6_set_reserved_with_receipt(
    v_reserved_b.event_id, v_prepared.attempt_id, 'cs_test_b', 'evt_test_b'
  );
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee70000-0000-4000-8000-000000000001', true);
  PERFORM set_config('psp6.event_b', v_reserved_b.event_id::text, true);

  -- Event C: payment_pending -- no attempt ever prepared.
  SELECT * INTO v_pending FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Pending C', current_date + 7, 'UTC',
    '9ee7a000-0000-4000-8000-000000000005', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp6_assert(v_pending.outcome = 'created', 'Event C draft created');
  -- payment_pending requires a Passport row to exist at all -- prepare an
  -- attempt (creates the payment_pending Passport row as a side effect)
  -- but never confirm it.
  PERFORM public.prepare_self_service_event_passport_checkout_attempt(
    v_pending.event_id, '9ee7a000-0000-4000-8000-000000000006'
  );
  PERFORM set_config('psp6.event_c', v_pending.event_id::text, true);

  -- Event D: active (launched).
  SELECT * INTO v_active FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Active D', current_date + 7, 'UTC',
    '9ee7a000-0000-4000-8000-000000000007', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp6_assert(v_active.outcome = 'created', 'Event D draft created');
  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_active.event_id, '9ee7a000-0000-4000-8000-000000000008'
  );
  SET LOCAL ROLE postgres;
  PERFORM public.psp6_set_reserved_with_receipt(v_active.event_id, v_prepared.attempt_id, 'cs_test_d', 'evt_test_d');
  PERFORM public.psp6_force_passport_state(v_active.event_id, 'active');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee70000-0000-4000-8000-000000000001', true);
  PERFORM set_config('psp6.event_d', v_active.event_id::text, true);

  -- Event E: expired.
  SELECT * INTO v_expired FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Expired E', current_date + 7, 'UTC',
    '9ee7a000-0000-4000-8000-000000000009', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp6_assert(v_expired.outcome = 'created', 'Event E draft created');
  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_expired.event_id, '9ee7a000-0000-4000-8000-00000000000a'
  );
  SET LOCAL ROLE postgres;
  PERFORM public.psp6_set_reserved_with_receipt(v_expired.event_id, v_prepared.attempt_id, 'cs_test_e', 'evt_test_e');
  PERFORM public.psp6_force_passport_state(v_expired.event_id, 'expired');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee70000-0000-4000-8000-000000000001', true);
  PERFORM set_config('psp6.event_e', v_expired.event_id::text, true);

  -- Event F: refunded (already, hypothetically, refunded by some other
  -- unrelated already-completed process -- this fixture never itself
  -- writes a real refund/audit row for it).
  SELECT * INTO v_refunded FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Refunded F', current_date + 7, 'UTC',
    '9ee7a000-0000-4000-8000-00000000000b', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp6_assert(v_refunded.outcome = 'created', 'Event F draft created');
  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_refunded.event_id, '9ee7a000-0000-4000-8000-00000000000c'
  );
  SET LOCAL ROLE postgres;
  PERFORM public.psp6_set_reserved_with_receipt(v_refunded.event_id, v_prepared.attempt_id, 'cs_test_f', 'evt_test_f');
  PERFORM public.psp6_force_passport_state(v_refunded.event_id, 'refunded');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee70000-0000-4000-8000-000000000001', true);
  PERFORM set_config('psp6.event_f', v_refunded.event_id::text, true);

  -- Event G: an eligible private draft with NO Passport row at all.
  SELECT * INTO v_missing FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Missing G', current_date + 7, 'UTC',
    '9ee7a000-0000-4000-8000-00000000000d', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp6_assert(v_missing.outcome = 'created', 'Event G draft created');
  PERFORM public.psp6_assert(
    public.psp6_event_exists(v_missing.event_id),
    'sanity: Event G was actually created'
  );
  PERFORM set_config('psp6.event_g', v_missing.event_id::text, true);
END;
$dana_setup$;

-- ===========================================================================
-- 1: a non-super-admin CANNOT create a request -- neither an unrelated
-- ordinary authenticated caller (Charlie) NOR the organizer who actually
-- owns the Event (Dana).
-- ===========================================================================
DO $non_admin_denied$
DECLARE
  v_failed boolean;
BEGIN
  -- Charlie: unrelated, not the owner, not an admin.
  PERFORM set_config('request.jwt.claim.sub', '9ee70000-0000-4000-8000-000000000002', true);
  v_failed := false;
  BEGIN
    PERFORM public.prepare_self_service_event_passport_refund_request(
      current_setting('psp6.event_a')::uuid, '9ee7b000-0000-4000-8000-000000000001'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Requesting a Passport refund requires Platform Administrator authority.';
  END;
  PERFORM public.psp6_assert(v_failed, 'an ordinary unrelated authenticated caller cannot create a refund request');

  -- Dana: the ACTUAL owner of Event A -- ownership never substitutes for
  -- Platform Administrator authority.
  PERFORM set_config('request.jwt.claim.sub', '9ee70000-0000-4000-8000-000000000001', true);
  v_failed := false;
  BEGIN
    PERFORM public.prepare_self_service_event_passport_refund_request(
      current_setting('psp6.event_a')::uuid, '9ee7b000-0000-4000-8000-000000000002'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Requesting a Passport refund requires Platform Administrator authority.';
  END;
  PERFORM public.psp6_assert(v_failed, 'the Event''s own organizer-owner cannot create a refund request without Platform Administrator authority');
END;
$non_admin_denied$;

-- ===========================================================================
-- 3: active, expired, payment_pending, refunded, and missing Passports ALL
-- fail closed -- exercised as Admin1, a genuine super-admin.
-- ===========================================================================
DO $ineligible_states$
DECLARE
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee70000-0000-4000-8000-000000000003', true);

  -- payment_pending (Event C)
  v_failed := false;
  BEGIN
    PERFORM public.prepare_self_service_event_passport_refund_request(
      current_setting('psp6.event_c')::uuid, '9ee7c000-0000-4000-8000-000000000001'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp6_assert(v_failed, 'a payment_pending Passport cannot create a refund request');

  -- active (Event D)
  v_failed := false;
  BEGIN
    PERFORM public.prepare_self_service_event_passport_refund_request(
      current_setting('psp6.event_d')::uuid, '9ee7c000-0000-4000-8000-000000000002'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp6_assert(v_failed, 'an active (launched) Passport cannot create a refund request');

  -- expired (Event E)
  v_failed := false;
  BEGIN
    PERFORM public.prepare_self_service_event_passport_refund_request(
      current_setting('psp6.event_e')::uuid, '9ee7c000-0000-4000-8000-000000000003'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp6_assert(v_failed, 'an expired Passport cannot create a refund request');

  -- refunded (Event F)
  v_failed := false;
  BEGIN
    PERFORM public.prepare_self_service_event_passport_refund_request(
      current_setting('psp6.event_f')::uuid, '9ee7c000-0000-4000-8000-000000000004'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp6_assert(v_failed, 'an already-refunded Passport cannot create a second refund request');

  -- missing (Event G -- no Passport row at all)
  v_failed := false;
  BEGIN
    PERFORM public.prepare_self_service_event_passport_refund_request(
      current_setting('psp6.event_g')::uuid, '9ee7c000-0000-4000-8000-000000000005'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp6_assert(v_failed, 'an Event with no Passport row at all cannot create a refund request');

  -- an ordinary, non-private-draft Event (the FCOC control) -- proves no
  -- broadening beyond the private-draft carve-out.
  v_failed := false;
  BEGIN
    PERFORM public.prepare_self_service_event_passport_refund_request(
      current_setting('psp6.ordinary_event')::uuid, '9ee7c000-0000-4000-8000-000000000006'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp6_assert(v_failed, 'an ordinary non-private-draft Event is rejected identically -- no broadening beyond the private-draft carve-out');
END;
$ineligible_states$;

-- ===========================================================================
-- 2, 4: the ONE eligible scenario (Event A, reserved) -- success, replay,
-- idempotency-key conflict, and cross-admin duplicate protection.
-- ===========================================================================
DO $eligible_flow$
DECLARE
  v_first record;
  v_replay record;
  v_duplicate record;
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee70000-0000-4000-8000-000000000003', true);

  -- 2: the ONE successful path -- a genuine super-admin, a specific
  -- supplied opaque Event id, exactly matching the eligible scenario.
  SELECT * INTO v_first FROM public.prepare_self_service_event_passport_refund_request(
    current_setting('psp6.event_a')::uuid, '9ee7d000-0000-4000-8000-000000000001'
  );
  PERFORM public.psp6_assert(v_first.outcome = 'requested', 'a reserved Passport with exactly one receipt succeeds');
  PERFORM public.psp6_assert(v_first.event_id = current_setting('psp6.event_a')::uuid, 'the returned event_id matches the caller-supplied id');
  PERFORM public.psp6_assert(
    (SELECT count(*) FROM json_object_keys(row_to_json(v_first)) AS k) = 5,
    'the prepare command''s row has exactly outcome/request_id/event_id/state/created_at -- five columns, no more'
  );

  -- 4a: idempotent replay -- SAME admin, SAME key -> the SAME request.
  SELECT * INTO v_replay FROM public.prepare_self_service_event_passport_refund_request(
    current_setting('psp6.event_a')::uuid, '9ee7d000-0000-4000-8000-000000000001'
  );
  PERFORM public.psp6_assert(
    v_replay.outcome = 'requested' AND v_replay.request_id = v_first.request_id,
    'replaying the same (admin, idempotency key) returns the SAME request, not a new one'
  );

  -- 4b: the SAME key reused against a DIFFERENT event -> raises.
  v_failed := false;
  BEGIN
    PERFORM public.prepare_self_service_event_passport_refund_request(
      current_setting('psp6.event_b')::uuid, '9ee7d000-0000-4000-8000-000000000001'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Idempotency key was already used to request a refund for a different event.';
  END;
  PERFORM public.psp6_assert(v_failed, 'reusing the same idempotency key for a different event raises');

  -- 4c: a DIFFERENT admin, a DIFFERENT key, the SAME event/receipt -> safe
  -- 'refund_already_requested', never a duplicate row.
  PERFORM set_config('request.jwt.claim.sub', '9ee70000-0000-4000-8000-000000000004', true);
  SELECT * INTO v_duplicate FROM public.prepare_self_service_event_passport_refund_request(
    current_setting('psp6.event_a')::uuid, '9ee7d000-0000-4000-8000-000000000002'
  );
  PERFORM public.psp6_assert(
    v_duplicate.outcome = 'refund_already_requested' AND v_duplicate.request_id = v_first.request_id,
    'a different admin with a different key requesting the SAME receipt is reported as already-requested, referencing the SAME existing request'
  );

  SET LOCAL ROLE authenticated;
  PERFORM public.psp6_assert(
    public.psp6_request_row_count(current_setting('psp6.receipt_a')::uuid) = 1,
    'exactly one request row exists for this receipt after replay, conflict, and duplicate attempts'
  );

  PERFORM set_config('psp6.request_a', v_first.request_id::text, true);
END;
$eligible_flow$;

-- ===========================================================================
-- 2 (continued): a super-admin gains NO general private-tenant/Event
-- browsing authority -- direct reads of organizer-private tables remain
-- denied at the grant level even for a verified super-admin.
-- ===========================================================================
SELECT set_config('request.jwt.claim.sub', '9ee70000-0000-4000-8000-000000000003', true);
DO $no_general_authority$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp6_try_select_organizer_drafts() INTO v_result;
  PERFORM public.psp6_assert(
    v_result = '42501',
    format('a super-admin still cannot directly read organizer-private tables (got %L)', v_result)
  );

  SELECT public.psp6_try_select_requests() INTO v_result;
  PERFORM public.psp6_assert(
    v_result = '42501',
    format('a super-admin still cannot directly read the refund-request table -- only through the governed command (got %L)', v_result)
  );
END;
$no_general_authority$;

-- ===========================================================================
-- 5: anon and service_role also cannot read the refund-request table.
-- ===========================================================================
SET LOCAL ROLE anon;
DO $no_anon_read$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp6_try_select_requests() INTO v_result;
  PERFORM set_config('psp6.anon_result', v_result, true);
END;
$no_anon_read$;
SET LOCAL ROLE authenticated;
SELECT public.psp6_assert(
  current_setting('psp6.anon_result') = '42501',
  format('anon cannot read the refund-request table (got %L)', current_setting('psp6.anon_result'))
);

SET LOCAL ROLE service_role;
DO $no_service_role_table_read$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp6_try_select_requests() INTO v_result;
  PERFORM set_config('psp6.service_role_table_result', v_result, true);
END;
$no_service_role_table_read$;
SET LOCAL ROLE authenticated;
SELECT public.psp6_assert(
  current_setting('psp6.service_role_table_result') = '42501',
  format('service_role cannot read the refund-request table directly either (got %L)', current_setting('psp6.service_role_table_result'))
);

-- ===========================================================================
-- 6: the service-only reader returns exactly the four documented columns
-- for service_role, and is denied to anon/authenticated.
-- ===========================================================================
DO $no_browser_server_reader$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp6_try_server_reader_as_caller(current_setting('psp6.request_a')::uuid) INTO v_result;
  PERFORM public.psp6_assert(
    v_result = '42501',
    format('authenticated cannot call the service-only reader directly (got %L)', v_result)
  );
END;
$no_browser_server_reader$;

SET LOCAL ROLE anon;
DO $no_anon_server_reader$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp6_try_server_reader_as_caller(current_setting('psp6.request_a')::uuid) INTO v_result;
  PERFORM set_config('psp6.anon_server_reader_result', v_result, true);
END;
$no_anon_server_reader$;
SET LOCAL ROLE authenticated;
SELECT public.psp6_assert(
  current_setting('psp6.anon_server_reader_result') = '42501',
  format('anon cannot call the service-only reader directly (got %L)', current_setting('psp6.anon_server_reader_result'))
);

SET LOCAL ROLE service_role;
DO $server_reader$
DECLARE
  v_read record;
BEGIN
  SELECT * INTO v_read FROM public.get_self_service_event_passport_refund_request_for_server(
    current_setting('psp6.request_a')::uuid
  );
  PERFORM public.psp6_assert(
    v_read.request_id = current_setting('psp6.request_a')::uuid
      AND v_read.event_id = current_setting('psp6.event_a')::uuid
      AND v_read.receipt_audit_id = current_setting('psp6.receipt_a')::uuid
      AND v_read.state = 'requested',
    'the service-only reader returns the exact expected row for the specific request id'
  );
  PERFORM public.psp6_assert(
    (SELECT count(*) FROM json_object_keys(row_to_json(v_read)) AS k) = 4,
    'the service-only reader row has exactly request_id/event_id/receipt_audit_id/state -- four columns, no more'
  );
END;
$server_reader$;
SET LOCAL ROLE authenticated;

-- ===========================================================================
-- 7: existing delete, receipt-audit, and private-draft isolation behavior
-- is completely unaffected (regression) -- Dana can still ordinarily
-- delete a plain unpaid draft with no Passport row.
-- ===========================================================================
DO $regression$
DECLARE
  v_plain record;
  v_deletion record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee70000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_plain FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Plain Regression', current_date + 7, 'UTC',
    '9ee7e000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp6_assert(v_plain.outcome = 'created', 'regression: plain draft still creates normally');

  SELECT * INTO v_deletion FROM public.delete_self_service_organizer_event(
    v_plain.event_id, '9ee7e000-0000-4000-8000-000000000002'
  );
  PERFORM public.psp6_assert(v_deletion.outcome = 'deleted', 'regression: an ordinary unpaid draft still deletes normally');

  -- and Event A (reserved, now with a refund request against it) is STILL
  -- protected from ordinary deletion -- this migration created no path
  -- that changes that.
  DECLARE
    v_failed boolean := false;
  BEGIN
    BEGIN
      PERFORM public.delete_self_service_organizer_event(
        current_setting('psp6.event_a')::uuid, '9ee7e000-0000-4000-8000-000000000003'
      );
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'Event not found.';
    END;
    PERFORM public.psp6_assert(v_failed, 'regression: a reserved Event with a PENDING refund request is still fully protected from ordinary deletion -- only a future, separately authorized provider-confirmation slice may ever change that');
  END;
END;
$regression$;

-- ===========================================================================
-- 8 (verified last): the ordinary FCOC/platform Tenant Event and its admin
-- authority row are completely unaffected by everything above.
-- ===========================================================================
DO $ordinary_check$
BEGIN
  PERFORM public.psp6_assert(
    public.psp6_event_exists(current_setting('psp6.ordinary_event')::uuid),
    'the ordinary platform Event is untouched'
  );
END;
$ordinary_check$;

SET LOCAL ROLE postgres;

ROLLBACK;
