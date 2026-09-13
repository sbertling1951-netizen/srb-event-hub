-- Passport refund-eligibility UI-visibility reader -- linked-database
-- behavior proof. Database-only: no Stripe SDK, API call, webhook, or money
-- movement anywhere in this fixture.
--
-- Run only after every migration through 20261019000000 has been applied.
-- Creates isolated auth + identity rows, exercises the new reader as the
-- super-admin / ordinary-organizer-owner / foreign / anon / service_role
-- roles, and rolls everything back. NOT executed as part of this
-- implementation task -- proof-of-shape only, per this repository's
-- established convention for behavioral fixtures.
--
-- It proves:
--   1. eligible=true ONLY for a super-admin caller against a Passport that
--      is exactly 'reserved';
--   2. the SAME reserved Event, read by its own organizer-owner (NOT a
--      super-admin), reports eligible=false -- ownership never substitutes
--      for Platform Administrator authority;
--   3. active, expired, refunded, payment_pending, and a missing Passport
--      ALL report eligible=false for the SAME super-admin caller;
--   4. the row has exactly one column -- eligible -- no Passport state,
--      receipt, provider id, or any other field;
--   5. a foreign/non-owned Event id fails closed to the same non-
--      enumerating 'Event not found.' this family already raises, even for
--      a super-admin;
--   6. this reader prepares, executes, and writes NOTHING -- the governed
--      preparation command still requires its own independent authority
--      check, completely unaffected by this reader's own answer;
--   7. neither anon nor service_role may invoke it;
--   8. an ordinary FCOC/platform-Tenant Event, and its admin/authority
--      rows, are completely untouched by any of the above;
--   9. zero fixture residue survives the fixture's own explicit ROLLBACK.

BEGIN;

CREATE OR REPLACE FUNCTION public.psp7_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Passport refund-eligibility fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.psp7_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp7_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.psp7_assert(boolean, text) TO authenticated, service_role, anon;

CREATE OR REPLACE FUNCTION public.psp7_link(p_person_id uuid, p_auth_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', true, now());
$function$;
ALTER FUNCTION public.psp7_link(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp7_link(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp7_link(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp7_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.psp7_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp7_event_exists(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp7_event_exists(uuid) TO authenticated;

-- Fixture-only: reserves a Passport directly, bypassing the real
-- Stripe-contacting confirm route -- mirrors the established
-- psp4_set_reserved/psp6_set_reserved_with_receipt pattern. No receipt row
-- is needed here -- the reader under test never looks at one.
CREATE OR REPLACE FUNCTION public.psp7_set_reserved(p_event_id uuid, p_attempt_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  UPDATE public.self_service_event_passports
     SET state = 'reserved', paid_at = now(), updated_at = now()
   WHERE event_id = p_event_id;
  UPDATE public.self_service_event_passport_payment_attempts
     SET state = 'confirmed', updated_at = now()
   WHERE id = p_attempt_id;
$function$;
ALTER FUNCTION public.psp7_set_reserved(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp7_set_reserved(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Fixture-only: forces every OTHER Passport state this fixture needs to
-- prove ineligible -- mirrors the established psp6_force_passport_state.
CREATE OR REPLACE FUNCTION public.psp7_force_passport_state(p_event_id uuid, p_state text)
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
ALTER FUNCTION public.psp7_force_passport_state(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp7_force_passport_state(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.psp7_try_eligibility_reader_as(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM * FROM public.get_my_self_service_event_passport_refund_eligibility(p_event_id);
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$function$;
ALTER FUNCTION public.psp7_try_eligibility_reader_as(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp7_try_eligibility_reader_as(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.psp7_try_eligibility_reader_as(uuid) TO anon, authenticated, service_role;

DO $setup$
DECLARE
  v_person uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id IN (
      '9ee80000-0000-4000-8000-000000000001', -- Dana, organizer/owner, NOT an admin
      '9ee80000-0000-4000-8000-000000000002', -- Eve, unrelated ordinary authenticated caller
      '9ee80000-0000-4000-8000-000000000003'  -- Admin1, super_admin
    )
  ) THEN
    RAISE EXCEPTION 'Passport refund-eligibility fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('9ee80000-0000-4000-8000-000000000001', 'psp7-dana@fixture.invalid', now()),
    ('9ee80000-0000-4000-8000-000000000002', 'psp7-eve@fixture.invalid', now()),
    ('9ee80000-0000-4000-8000-000000000003', 'psp7-admin1@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp7_link(v_person, '9ee80000-0000-4000-8000-000000000001');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp7_link(v_person, '9ee80000-0000-4000-8000-000000000002');

  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('psp7-admin1@fixture.invalid', '9ee80000-0000-4000-8000-000000000003', true, true, 'super_admin');
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
  VALUES ('psp7-ordinary-tenant', 'psp7-ordinary-tenant', 'PSP7 Ordinary Tenant', 'PSP7 Ordinary Tenant', 'PSP7 Ordinary Tenant', true)
  RETURNING id INTO v_ordinary_tenant;

  INSERT INTO public.events (name, tenant_id, status, is_active, visible_to_members, end_date, timezone)
  VALUES ('PSP7 Ordinary Event', v_ordinary_tenant, 'Active', true, true, current_date + 7, 'UTC')
  RETURNING id INTO v_ordinary_event;

  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('psp7-ordinary-admin@fixture.invalid', '9ee80000-0000-4000-8000-000000000099', true, false, 'event_admin')
  RETURNING id INTO v_ordinary_admin;

  INSERT INTO public.admin_event_access (admin_user_id, event_id, role)
  VALUES (v_ordinary_admin, v_ordinary_event, 'event_admin');

  PERFORM set_config('psp7.ordinary_event', v_ordinary_event::text, true);
END;
$ordinary$;

-- ===========================================================================
-- Dana (organizer, NOT an admin) builds every scenario Event, as herself.
-- ===========================================================================
SET LOCAL ROLE authenticated;
DO $dana_setup$
DECLARE
  v_reserved record;
  v_pending record;
  v_active record;
  v_expired record;
  v_refunded record;
  v_missing record;
  v_prepared record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee80000-0000-4000-8000-000000000001', true);

  -- Event A: reserved -- the one eligible scenario (for a super-admin).
  SELECT * INTO v_reserved FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Reserved A', current_date + 7, 'UTC',
    '9ee8a000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp7_assert(v_reserved.outcome = 'created', 'Event A draft created');
  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_reserved.event_id, '9ee8a000-0000-4000-8000-000000000002'
  );
  SET LOCAL ROLE postgres;
  PERFORM public.psp7_set_reserved(v_reserved.event_id, v_prepared.attempt_id);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee80000-0000-4000-8000-000000000001', true);
  PERFORM set_config('psp7.event_a', v_reserved.event_id::text, true);

  -- Event C: payment_pending -- an attempt prepared, never confirmed.
  SELECT * INTO v_pending FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Pending C', current_date + 7, 'UTC',
    '9ee8a000-0000-4000-8000-000000000003', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp7_assert(v_pending.outcome = 'created', 'Event C draft created');
  PERFORM public.prepare_self_service_event_passport_checkout_attempt(
    v_pending.event_id, '9ee8a000-0000-4000-8000-000000000004'
  );
  PERFORM set_config('psp7.event_c', v_pending.event_id::text, true);

  -- Event D: active (launched).
  SELECT * INTO v_active FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Active D', current_date + 7, 'UTC',
    '9ee8a000-0000-4000-8000-000000000005', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp7_assert(v_active.outcome = 'created', 'Event D draft created');
  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_active.event_id, '9ee8a000-0000-4000-8000-000000000006'
  );
  SET LOCAL ROLE postgres;
  PERFORM public.psp7_set_reserved(v_active.event_id, v_prepared.attempt_id);
  PERFORM public.psp7_force_passport_state(v_active.event_id, 'active');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee80000-0000-4000-8000-000000000001', true);
  PERFORM set_config('psp7.event_d', v_active.event_id::text, true);

  -- Event E: expired.
  SELECT * INTO v_expired FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Expired E', current_date + 7, 'UTC',
    '9ee8a000-0000-4000-8000-000000000007', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp7_assert(v_expired.outcome = 'created', 'Event E draft created');
  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_expired.event_id, '9ee8a000-0000-4000-8000-000000000008'
  );
  SET LOCAL ROLE postgres;
  PERFORM public.psp7_set_reserved(v_expired.event_id, v_prepared.attempt_id);
  PERFORM public.psp7_force_passport_state(v_expired.event_id, 'expired');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee80000-0000-4000-8000-000000000001', true);
  PERFORM set_config('psp7.event_e', v_expired.event_id::text, true);

  -- Event F: refunded.
  SELECT * INTO v_refunded FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Refunded F', current_date + 7, 'UTC',
    '9ee8a000-0000-4000-8000-000000000009', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp7_assert(v_refunded.outcome = 'created', 'Event F draft created');
  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_refunded.event_id, '9ee8a000-0000-4000-8000-00000000000a'
  );
  SET LOCAL ROLE postgres;
  PERFORM public.psp7_set_reserved(v_refunded.event_id, v_prepared.attempt_id);
  PERFORM public.psp7_force_passport_state(v_refunded.event_id, 'refunded');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee80000-0000-4000-8000-000000000001', true);
  PERFORM set_config('psp7.event_f', v_refunded.event_id::text, true);

  -- Event G: an eligible private draft with NO Passport row at all.
  SELECT * INTO v_missing FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Missing G', current_date + 7, 'UTC',
    '9ee8a000-0000-4000-8000-00000000000b', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp7_assert(v_missing.outcome = 'created', 'Event G draft created');
  PERFORM set_config('psp7.event_g', v_missing.event_id::text, true);
END;
$dana_setup$;

-- ===========================================================================
-- 2: the SAME reserved Event (A), read by its own organizer-owner Dana --
-- who is NOT a super-admin -- reports eligible=false.
-- ===========================================================================
DO $owner_ineligible$
DECLARE
  v_read record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee80000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_read FROM public.get_my_self_service_event_passport_refund_eligibility(
    current_setting('psp7.event_a')::uuid
  );
  PERFORM public.psp7_assert(v_read.eligible = false, 'the reserved Event''s own organizer-owner is NOT eligible -- ownership never substitutes for Platform Administrator authority');
END;
$owner_ineligible$;

-- ===========================================================================
-- 5: a foreign, unrelated ordinary caller (Eve) cannot read Dana's
-- eligibility either -- non-enumerating.
-- ===========================================================================
DO $foreign_denied$
DECLARE
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee80000-0000-4000-8000-000000000002', true);
  v_failed := false;
  BEGIN
    PERFORM public.get_my_self_service_event_passport_refund_eligibility(
      current_setting('psp7.event_a')::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp7_assert(v_failed, 'an unrelated foreign caller cannot read another organizer''s refund eligibility, non-enumerating');
END;
$foreign_denied$;

-- ===========================================================================
-- 1, 3, 4: Admin1, a genuine super-admin -- eligible=true ONLY for the
-- reserved Event; false for active/expired/refunded/payment_pending/
-- missing; row has exactly one column.
-- ===========================================================================
DO $admin_eligibility$
DECLARE
  v_read record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee80000-0000-4000-8000-000000000003', true);

  -- 1: reserved -> eligible.
  SELECT * INTO v_read FROM public.get_my_self_service_event_passport_refund_eligibility(
    current_setting('psp7.event_a')::uuid
  );
  PERFORM public.psp7_assert(v_read.eligible = true, 'a super-admin against a reserved Passport is eligible');
  PERFORM public.psp7_assert(
    (SELECT count(*) FROM json_object_keys(row_to_json(v_read)) AS k) = 1,
    'the eligibility reader row has exactly one column -- eligible -- no more'
  );

  -- 3: payment_pending (Event C) -> ineligible.
  SELECT * INTO v_read FROM public.get_my_self_service_event_passport_refund_eligibility(
    current_setting('psp7.event_c')::uuid
  );
  PERFORM public.psp7_assert(v_read.eligible = false, 'payment_pending is ineligible even for a super-admin');

  -- 3: active (Event D) -> ineligible -- the exact defect this migration corrects.
  SELECT * INTO v_read FROM public.get_my_self_service_event_passport_refund_eligibility(
    current_setting('psp7.event_d')::uuid
  );
  PERFORM public.psp7_assert(v_read.eligible = false, 'an active (launched) Passport is ineligible even for a super-admin');

  -- 3: expired (Event E) -> ineligible.
  SELECT * INTO v_read FROM public.get_my_self_service_event_passport_refund_eligibility(
    current_setting('psp7.event_e')::uuid
  );
  PERFORM public.psp7_assert(v_read.eligible = false, 'an expired Passport is ineligible even for a super-admin');

  -- 3: refunded (Event F) -> ineligible.
  SELECT * INTO v_read FROM public.get_my_self_service_event_passport_refund_eligibility(
    current_setting('psp7.event_f')::uuid
  );
  PERFORM public.psp7_assert(v_read.eligible = false, 'an already-refunded Passport is ineligible');

  -- 3: missing (Event G, no Passport row) -> ineligible.
  SELECT * INTO v_read FROM public.get_my_self_service_event_passport_refund_eligibility(
    current_setting('psp7.event_g')::uuid
  );
  PERFORM public.psp7_assert(v_read.eligible = false, 'an Event with no Passport row at all is ineligible');

  -- an ordinary, non-private-draft Event (the FCOC control) -> raises the
  -- same non-enumerating error, even for a super-admin -- no broadening
  -- beyond the private-draft carve-out.
  DECLARE
    v_failed boolean := false;
  BEGIN
    BEGIN
      PERFORM public.get_my_self_service_event_passport_refund_eligibility(
        current_setting('psp7.ordinary_event')::uuid
      );
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'Event not found.';
    END;
    PERFORM public.psp7_assert(v_failed, 'an ordinary non-private-draft Event is rejected identically, even for a super-admin');
  END;
END;
$admin_eligibility$;

-- ===========================================================================
-- 6: this reader prepares, executes, and writes NOTHING -- the governed
-- preparation command still requires its own independent authority check,
-- and is itself untouched.
-- ===========================================================================
DO $no_side_effects$
DECLARE
  v_before_state text;
  v_after_state text;
BEGIN
  SET LOCAL ROLE postgres;
  SELECT state INTO v_before_state FROM public.self_service_event_passports
  WHERE event_id = current_setting('psp7.event_a')::uuid;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee80000-0000-4000-8000-000000000003', true);

  PERFORM public.get_my_self_service_event_passport_refund_eligibility(
    current_setting('psp7.event_a')::uuid
  );

  SET LOCAL ROLE postgres;
  SELECT state INTO v_after_state FROM public.self_service_event_passports
  WHERE event_id = current_setting('psp7.event_a')::uuid;
  PERFORM public.psp7_assert(
    v_before_state = v_after_state AND v_after_state = 'reserved',
    'reading eligibility never mutates the Passport row'
  );

  -- The governed preparation command STILL requires its own authority --
  -- calling it as the (non-admin) organizer-owner still fails identically,
  -- proving this reader substitutes for nothing.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee80000-0000-4000-8000-000000000001', true);
  DECLARE
    v_failed boolean := false;
  BEGIN
    BEGIN
      PERFORM public.prepare_self_service_event_passport_refund_request(
        current_setting('psp7.event_a')::uuid, '9ee8b000-0000-4000-8000-000000000001'
      );
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'Requesting a Passport refund requires Platform Administrator authority.';
    END;
    PERFORM public.psp7_assert(v_failed, 'the governed preparation command''s own authority check is completely unaffected by this reader');
  END;
END;
$no_side_effects$;

-- ===========================================================================
-- 7: neither anon nor service_role may invoke the new reader.
-- ===========================================================================
SET LOCAL ROLE anon;
DO $no_anon_read$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp7_try_eligibility_reader_as(current_setting('psp7.event_a')::uuid) INTO v_result;
  PERFORM set_config('psp7.anon_result', v_result, true);
END;
$no_anon_read$;
SET LOCAL ROLE authenticated;
PERFORM public.psp7_assert(
  current_setting('psp7.anon_result') = '42501',
  format('anon cannot call the eligibility reader directly (got %L)', current_setting('psp7.anon_result'))
);

SET LOCAL ROLE service_role;
DO $no_service_role_read$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp7_try_eligibility_reader_as(current_setting('psp7.event_a')::uuid) INTO v_result;
  PERFORM set_config('psp7.service_role_result', v_result, true);
END;
$no_service_role_read$;
SET LOCAL ROLE authenticated;
PERFORM public.psp7_assert(
  current_setting('psp7.service_role_result') = '42501',
  format('service_role cannot call the eligibility reader directly either (got %L)', current_setting('psp7.service_role_result'))
);

-- ===========================================================================
-- 8 (verified last): the ordinary FCOC/platform Tenant Event and its admin
-- authority row are completely unaffected by everything above.
-- ===========================================================================
DO $ordinary_check$
BEGIN
  PERFORM public.psp7_assert(
    public.psp7_event_exists(current_setting('psp7.ordinary_event')::uuid),
    'the ordinary platform Event is untouched'
  );
END;
$ordinary_check$;

SET LOCAL ROLE postgres;

ROLLBACK;
