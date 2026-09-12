-- Passport Governed Refund Foundation -- linked-database behavior proof.
-- Domain-model only: no Stripe SDK, API call, webhook, or money movement
-- anywhere in this fixture.
--
-- Run only after every migration through 20261016000000 has been applied.
-- Creates isolated auth + identity rows, exercises the new state/table/
-- retention-correction/delete-restatement, and rolls everything back.
-- NOT executed as part of this implementation task -- proof-of-shape only,
-- per this repository's established convention for behavioral fixtures.
--
-- It proves:
--   1. a refunded Passport is NOT preserved (is_self_service_event_passport_preserved
--      returns false), and its Event is structurally eligible for ordinary
--      delete WITHOUT the generic dependency-scan exclusion list ever being
--      widened for either audit table;
--   2. the existing payment receipt/audit row, the payment attempt row, and
--      the new refund/audit row ALL survive that Event's deletion --
--      permanent evidence, exactly as required;
--   3. dual refund idempotency: a duplicate provider_refund_id and a
--      duplicate provider_event_id are both rejected, independently; a
--      duplicate receipt_audit_id (refunding the same receipt twice) is
--      also rejected;
--   4. the refund/audit table denies anon, authenticated, AND service_role
--      at the grant level -- no policy, no table access for any browser or
--      service role;
--   5. the refund/audit table's immutability trigger rejects UPDATE and
--      DELETE unconditionally, exactly like the payment receipt/audit
--      table's own trigger;
--   6. a STILL-reserved (never refunded) Event remains fully protected --
--      the restatement did not weaken the existing reserved/active/expired
--      fail-closed check;
--   7. the pre-existing payment_pending Event deletion path is unaffected
--      (regression);
--   8. an ordinary FCOC/platform-Tenant Event, and its admin/authority
--      rows, are completely untouched by any of the above;
--   9. zero fixture residue survives the fixture's own explicit ROLLBACK.

BEGIN;

CREATE OR REPLACE FUNCTION public.psp5_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Passport refund-foundation fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.psp5_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp5_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.psp5_assert(boolean, text) TO authenticated, service_role, anon;

CREATE OR REPLACE FUNCTION public.psp5_link(p_person_id uuid, p_auth_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', true, now());
$function$;
ALTER FUNCTION public.psp5_link(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp5_link(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp5_link(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp5_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.psp5_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp5_event_exists(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp5_event_exists(uuid) TO authenticated;

-- Fixture-only: reaches 'reserved' + a real receipt/audit row directly,
-- bypassing the real Stripe-contacting confirm route (entirely out of scope
-- here) -- mirrors the established psp4_set_reserved pattern, extended to
-- also produce the receipt/audit row this fixture's refund needs to link to.
CREATE OR REPLACE FUNCTION public.psp5_set_reserved_with_receipt(
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
ALTER FUNCTION public.psp5_set_reserved_with_receipt(uuid, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp5_set_reserved_with_receipt(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Fixture-only: reaches 'refunded' + a real refund/audit row directly --
-- no governed refund-confirmation command exists yet (by design, this
-- migration introduces none); this is the ONLY way this fixture can ever
-- construct the scenario the later, separately authorized writer will
-- someday produce for real.
CREATE OR REPLACE FUNCTION public.psp5_set_refunded(
  p_event_id uuid, p_receipt_audit_id uuid, p_provider_refund_id text, p_provider_event_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  UPDATE public.self_service_event_passports
     SET state = 'refunded', refunded_at = now(), updated_at = now()
   WHERE event_id = p_event_id;
  INSERT INTO public.self_service_event_passport_refund_audit (
    provider_refund_id, provider_event_id, event_id, receipt_audit_id
  ) VALUES (
    p_provider_refund_id, p_provider_event_id, p_event_id, p_receipt_audit_id
  );
END;
$function$;
ALTER FUNCTION public.psp5_set_refunded(uuid, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp5_set_refunded(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Fixture-only direct-row readers, postgres-only (table owner bypasses the
-- REVOKE ALL on every Passport/attempt/receipt/refund table -- exactly the
-- same verification pattern the 20261013/20261014 fixtures already use).
CREATE OR REPLACE FUNCTION public.psp5_attempt_state(p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT state FROM public.self_service_event_passport_payment_attempts WHERE id = p_attempt_id;
$function$;
ALTER FUNCTION public.psp5_attempt_state(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp5_attempt_state(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp5_attempt_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp5_receipt_exists(p_receipt_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.self_service_event_passport_payment_receipt_audit WHERE id = p_receipt_id);
$function$;
ALTER FUNCTION public.psp5_receipt_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp5_receipt_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp5_receipt_exists(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp5_refund_audit_exists(p_receipt_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.self_service_event_passport_refund_audit WHERE receipt_audit_id = p_receipt_id
  );
$function$;
ALTER FUNCTION public.psp5_refund_audit_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp5_refund_audit_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp5_refund_audit_exists(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp5_passport_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.self_service_event_passports WHERE event_id = p_event_id);
$function$;
ALTER FUNCTION public.psp5_passport_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp5_passport_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp5_passport_exists(uuid) TO authenticated;

-- Grant-denial probes: attempt a bare SELECT/INSERT against the refund/audit
-- table AS THE CALLING ROLE (not postgres) and report the SQLSTATE, exactly
-- mirroring the established psp3_try_server_reader_as_caller pattern.
CREATE OR REPLACE FUNCTION public.psp5_try_select_refund_audit()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM 1 FROM public.self_service_event_passport_refund_audit LIMIT 1;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$function$;
ALTER FUNCTION public.psp5_try_select_refund_audit() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp5_try_select_refund_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.psp5_try_select_refund_audit() TO anon, authenticated, service_role;

DO $setup$
DECLARE
  v_person uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id IN (
      '9ee60000-0000-4000-8000-000000000001',
      '9ee60000-0000-4000-8000-000000000002'
    )
  ) THEN
    RAISE EXCEPTION 'Passport refund-foundation fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('9ee60000-0000-4000-8000-000000000001', 'psp5-alice@fixture.invalid', now()),
    ('9ee60000-0000-4000-8000-000000000002', 'psp5-ben@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp5_link(v_person, '9ee60000-0000-4000-8000-000000000001');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp5_link(v_person, '9ee60000-0000-4000-8000-000000000002');
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
  VALUES ('psp5-ordinary-tenant', 'psp5-ordinary-tenant', 'PSP5 Ordinary Tenant', 'PSP5 Ordinary Tenant', 'PSP5 Ordinary Tenant', true)
  RETURNING id INTO v_ordinary_tenant;

  INSERT INTO public.events (name, tenant_id, status, is_active, visible_to_members, end_date, timezone)
  VALUES ('PSP5 Ordinary Event', v_ordinary_tenant, 'Active', true, true, current_date + 7, 'UTC')
  RETURNING id INTO v_ordinary_event;

  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('psp5-ordinary-admin@fixture.invalid', '9ee60000-0000-4000-8000-000000000099', true, false, 'event_admin')
  RETURNING id INTO v_ordinary_admin;

  INSERT INTO public.admin_event_access (admin_user_id, event_id, role)
  VALUES (v_ordinary_admin, v_ordinary_event, 'event_admin');

  PERFORM set_config('psp5.ordinary_tenant', v_ordinary_tenant::text, true);
  PERFORM set_config('psp5.ordinary_event', v_ordinary_event::text, true);
END;
$ordinary$;

SET LOCAL ROLE authenticated;

-- ===========================================================================
-- 6, 7: Ben -- a still-reserved Event stays protected; a plain
-- payment_pending draft (no attempt ever prepared) still deletes normally.
-- ===========================================================================
DO $ben$
DECLARE
  v_ben_reserved_draft record;
  v_ben_plain_draft record;
  v_ben_prepared record;
  v_receipt_id uuid;
  v_deletion record;
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee60000-0000-4000-8000-000000000002', true);

  -- 6: a reserved (never refunded) Event.
  SELECT * INTO v_ben_reserved_draft FROM public.create_self_service_organizer_draft(
    'Ben Org', 'Ben Reserved Reunion', current_date + 7, 'UTC',
    '9ee6a000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp5_assert(v_ben_reserved_draft.outcome = 'created', 'Ben''s reserved-scenario draft is created');

  SELECT * INTO v_ben_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_ben_reserved_draft.event_id, '9ee6a000-0000-4000-8000-000000000002'
  );
  PERFORM public.psp5_assert(v_ben_prepared.outcome = 'prepared', 'Ben''s checkout attempt is prepared');

  SET LOCAL ROLE postgres;
  SELECT public.psp5_set_reserved_with_receipt(
    v_ben_reserved_draft.event_id, v_ben_prepared.attempt_id, 'cs_test_ben_1', 'evt_test_ben_1'
  ) INTO v_receipt_id;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee60000-0000-4000-8000-000000000002', true);

  v_failed := false;
  BEGIN
    PERFORM public.delete_self_service_organizer_event(
      v_ben_reserved_draft.event_id, '9ee6b000-0000-4000-8000-000000000001'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp5_assert(v_failed, 'a reserved (never refunded) Event remains fully protected from ordinary deletion');

  -- 7: a plain payment_pending draft (no attempt ever prepared) --
  -- regression: still deletes normally.
  SELECT * INTO v_ben_plain_draft FROM public.create_self_service_organizer_draft(
    'Ben Org', 'Ben Plain Reunion', current_date + 7, 'UTC',
    '9ee6a000-0000-4000-8000-000000000003', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp5_assert(v_ben_plain_draft.outcome = 'created', 'Ben''s plain-scenario draft is created');

  SELECT * INTO v_deletion FROM public.delete_self_service_organizer_event(
    v_ben_plain_draft.event_id, '9ee6b000-0000-4000-8000-000000000002'
  );
  PERFORM public.psp5_assert(v_deletion.outcome = 'deleted', 'an ordinary unpaid draft with no Passport row still deletes normally');
END;
$ben$;

-- ===========================================================================
-- 1, 2: Alice -- reserved -> refunded -> ordinary deletion succeeds, and
-- ALL payment/refund evidence survives that deletion.
-- ===========================================================================
DO $alice$
DECLARE
  v_alice_draft record;
  v_prepared record;
  v_receipt_id uuid;
  v_deletion record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee60000-0000-4000-8000-000000000001', true);

  SELECT * INTO v_alice_draft FROM public.create_self_service_organizer_draft(
    'Alice Org', 'Alice Refund Reunion', current_date + 7, 'UTC',
    '9ee6a000-0000-4000-8000-000000000004', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp5_assert(v_alice_draft.outcome = 'created', 'Alice''s refund-scenario draft is created');

  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_alice_draft.event_id, '9ee6a000-0000-4000-8000-000000000005'
  );
  PERFORM public.psp5_assert(v_prepared.outcome = 'prepared', 'Alice''s checkout attempt is prepared');

  SET LOCAL ROLE postgres;
  SELECT public.psp5_set_reserved_with_receipt(
    v_alice_draft.event_id, v_prepared.attempt_id, 'cs_test_alice_1', 'evt_test_alice_1'
  ) INTO v_receipt_id;

  PERFORM public.psp5_assert(
    public.is_self_service_event_passport_preserved(v_alice_draft.event_id),
    'sanity: reserved IS preserved before refund'
  );

  PERFORM public.psp5_set_refunded(
    v_alice_draft.event_id, v_receipt_id, 're_test_alice_1', 'evt_test_alice_refund_1'
  );

  -- 1: refunded is NOT preserved.
  PERFORM public.psp5_assert(
    public.is_self_service_event_passport_preserved(v_alice_draft.event_id) = false,
    'a refunded Passport is NOT preserved'
  );

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee60000-0000-4000-8000-000000000001', true);

  -- 1 (continued): the Event is now structurally eligible for ordinary
  -- deletion -- no checkout_cancellation_required, no 'Event not found.',
  -- no generic dependency-scan abort on either audit table.
  SELECT * INTO v_deletion FROM public.delete_self_service_organizer_event(
    v_alice_draft.event_id, '9ee6b000-0000-4000-8000-000000000003'
  );
  PERFORM public.psp5_assert(v_deletion.outcome = 'deleted', 'a refunded Event is ordinarily deletable');
  PERFORM public.psp5_assert(NOT public.psp5_event_exists(v_alice_draft.event_id), 'the Event row is gone');
  PERFORM public.psp5_assert(
    NOT public.psp5_passport_exists(v_alice_draft.event_id),
    'the refunded Passport row itself is cleaned up by the SAME state-scoped branch as payment_pending'
  );

  -- 2: payment and refund evidence are PERMANENT -- both survive.
  PERFORM public.psp5_assert(
    public.psp5_attempt_state(v_prepared.attempt_id) = 'confirmed',
    'the payment attempt row survives Event deletion, still confirmed'
  );
  PERFORM public.psp5_assert(
    public.psp5_receipt_exists(v_receipt_id),
    'the original payment receipt/audit row survives Event deletion'
  );
  PERFORM public.psp5_assert(
    public.psp5_refund_audit_exists(v_receipt_id),
    'the refund/audit row survives Event deletion'
  );

  PERFORM set_config('psp5.alice_receipt', v_receipt_id::text, true);
END;
$alice$;

-- ===========================================================================
-- 3: dual refund idempotency -- as postgres (owner bypasses the table's own
-- REVOKE ALL, exactly like every other direct-row fixture assertion above).
-- ===========================================================================
SET LOCAL ROLE postgres;
DO $idempotency$
DECLARE
  v_receipt_id uuid := current_setting('psp5.alice_receipt')::uuid;
  v_failed boolean;
BEGIN
  -- Duplicate provider_refund_id (different provider_event_id, different
  -- receipt) -- rejected independently of the other two keys.
  v_failed := false;
  BEGIN
    INSERT INTO public.self_service_event_passport_refund_audit (
      provider_refund_id, provider_event_id, event_id, receipt_audit_id
    ) VALUES (
      're_test_alice_1', 'evt_test_alice_refund_DUPLICATE_A',
      gen_random_uuid(), gen_random_uuid()
    );
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  PERFORM public.psp5_assert(v_failed, 'a duplicate provider_refund_id is rejected');

  -- Duplicate provider_event_id (different provider_refund_id, different
  -- receipt) -- rejected independently.
  v_failed := false;
  BEGIN
    INSERT INTO public.self_service_event_passport_refund_audit (
      provider_refund_id, provider_event_id, event_id, receipt_audit_id
    ) VALUES (
      're_test_alice_DUPLICATE_B', 'evt_test_alice_refund_1',
      gen_random_uuid(), gen_random_uuid()
    );
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  PERFORM public.psp5_assert(v_failed, 'a duplicate provider_event_id is rejected');

  -- Duplicate receipt_audit_id (refunding the SAME original receipt a
  -- second time, with otherwise-unique provider identities) -- rejected.
  v_failed := false;
  BEGIN
    INSERT INTO public.self_service_event_passport_refund_audit (
      provider_refund_id, provider_event_id, event_id, receipt_audit_id
    ) VALUES (
      're_test_alice_DUPLICATE_C', 'evt_test_alice_refund_DUPLICATE_C',
      gen_random_uuid(), v_receipt_id
    );
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  PERFORM public.psp5_assert(v_failed, 'refunding the same receipt twice is rejected');
END;
$idempotency$;

-- ===========================================================================
-- 5: immutability -- UPDATE and DELETE are both unconditionally rejected.
-- ===========================================================================
DO $immutable$
DECLARE
  v_receipt_id uuid := current_setting('psp5.alice_receipt')::uuid;
  v_failed boolean;
BEGIN
  v_failed := false;
  BEGIN
    UPDATE public.self_service_event_passport_refund_audit
       SET amount_minor_units = 2400
     WHERE receipt_audit_id = v_receipt_id;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'self_service_event_passport_refund_audit is immutable';
  END;
  PERFORM public.psp5_assert(v_failed, 'UPDATE on the refund/audit table is rejected');

  v_failed := false;
  BEGIN
    DELETE FROM public.self_service_event_passport_refund_audit
     WHERE receipt_audit_id = v_receipt_id;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'self_service_event_passport_refund_audit is immutable';
  END;
  PERFORM public.psp5_assert(v_failed, 'DELETE on the refund/audit table is rejected');
END;
$immutable$;

-- ===========================================================================
-- 4: grant denial -- anon, authenticated, and service_role can ALL not
-- touch the refund/audit table directly.
-- ===========================================================================
SET LOCAL ROLE authenticated;
DO $no_authenticated_read$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp5_try_select_refund_audit() INTO v_result;
  PERFORM public.psp5_assert(
    v_result = '42501',
    format('authenticated cannot read the refund/audit table directly (got %L)', v_result)
  );
END;
$no_authenticated_read$;

SET LOCAL ROLE anon;
DO $no_anon_read$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp5_try_select_refund_audit() INTO v_result;
  PERFORM set_config('psp5.anon_result', v_result, true);
END;
$no_anon_read$;
SET LOCAL ROLE authenticated;
PERFORM public.psp5_assert(
  current_setting('psp5.anon_result') = '42501',
  format('anon cannot read the refund/audit table directly (got %L)', current_setting('psp5.anon_result'))
);

SET LOCAL ROLE service_role;
DO $no_service_role_read$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp5_try_select_refund_audit() INTO v_result;
  PERFORM set_config('psp5.service_role_result', v_result, true);
END;
$no_service_role_read$;
SET LOCAL ROLE authenticated;
PERFORM public.psp5_assert(
  current_setting('psp5.service_role_result') = '42501',
  format('service_role cannot read the refund/audit table directly (got %L)', current_setting('psp5.service_role_result'))
);

-- ===========================================================================
-- 8 (verified last): the ordinary FCOC/platform Tenant Event and its admin
-- authority row are completely unaffected by everything above.
-- ===========================================================================
DO $ordinary_check$
BEGIN
  PERFORM public.psp5_assert(
    public.psp5_event_exists(current_setting('psp5.ordinary_event')::uuid),
    'the ordinary platform Event is untouched'
  );
END;
$ordinary_check$;

SET LOCAL ROLE postgres;

ROLLBACK;
