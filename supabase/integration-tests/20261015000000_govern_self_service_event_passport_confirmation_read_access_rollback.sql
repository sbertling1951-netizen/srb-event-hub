-- Stripe Passport confirmed-state read access -- linked-database behavior
-- proof. Provider-independent: no Stripe SDK, API call, webhook, or money
-- movement anywhere in this fixture.
--
-- Run only after every migration through 20261015000000 has been applied.
-- Creates isolated auth + identity rows, exercises the new reader as the
-- authenticated / anon / service_role roles, and rolls everything back.
-- NOT executed as part of this implementation task -- proof-of-shape only,
-- per this repository's established convention for behavioral fixtures.
--
-- It proves:
--   1. the new reader returns 'not_confirmed' for the caller's own eligible
--      Event with no Passport row at all;
--   2. it still returns 'not_confirmed' while the Passport is
--      payment_pending (an open checkout attempt in progress);
--   3. it returns 'confirmed' once the Passport is reserved (fixture-only
--      -- Stripe confirmation itself is out of scope here, mirroring the
--      established 20261014 fixture's own scenario construction);
--   4. it returns only the single outcome column -- no attempt id, event
--      id, provider, timestamp, or any other field;
--   5. a foreign caller cannot read another organizer's confirmation status
--      -- the same non-enumerating 'Event not found.';
--   6. neither anon nor service_role may invoke it -- denied at the grant
--      level before the function body ever runs;
--   7. the existing get_my_self_service_event_passport_checkout_attempt
--      reader's own behavior (from 20261014000000) is completely
--      unaffected by this migration, including for the SAME reserved
--      Event;
--   8. an ordinary FCOC/platform-Tenant Event, and its admin/authority
--      rows, are completely untouched by any of the above;
--   9. zero fixture residue survives the fixture's own explicit ROLLBACK.

BEGIN;

CREATE OR REPLACE FUNCTION public.psp4_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Passport confirmation-read fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.psp4_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp4_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.psp4_assert(boolean, text) TO authenticated, service_role, anon;

CREATE OR REPLACE FUNCTION public.psp4_link(p_person_id uuid, p_auth_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', true, now());
$function$;
ALTER FUNCTION public.psp4_link(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp4_link(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp4_link(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp4_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.psp4_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp4_event_exists(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp4_event_exists(uuid) TO authenticated;

-- Fixture-only: reserves a Passport directly, bypassing the real
-- Stripe-contacting confirm route (entirely out of scope here) -- mirrors
-- the established 20261014 fixture's own psp3_set_reserved.
CREATE OR REPLACE FUNCTION public.psp4_set_reserved(p_event_id uuid, p_attempt_id uuid)
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
ALTER FUNCTION public.psp4_set_reserved(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp4_set_reserved(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.psp4_try_confirmation_reader_as(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM * FROM public.get_my_self_service_event_passport_confirmation(p_event_id);
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$function$;
ALTER FUNCTION public.psp4_try_confirmation_reader_as(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp4_try_confirmation_reader_as(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.psp4_try_confirmation_reader_as(uuid) TO anon, authenticated, service_role;

DO $setup$
DECLARE
  v_person uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id IN (
      '9ee50000-0000-4000-8000-000000000001',
      '9ee50000-0000-4000-8000-000000000002'
    )
  ) THEN
    RAISE EXCEPTION 'Passport confirmation-read fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('9ee50000-0000-4000-8000-000000000001', 'psp4-alice@fixture.invalid', now()),
    ('9ee50000-0000-4000-8000-000000000002', 'psp4-ben@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp4_link(v_person, '9ee50000-0000-4000-8000-000000000001');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp4_link(v_person, '9ee50000-0000-4000-8000-000000000002');
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
  VALUES ('psp4-ordinary-tenant', 'psp4-ordinary-tenant', 'PSP4 Ordinary Tenant', 'PSP4 Ordinary Tenant', 'PSP4 Ordinary Tenant', true)
  RETURNING id INTO v_ordinary_tenant;

  INSERT INTO public.events (name, tenant_id, status, is_active, visible_to_members, end_date, timezone)
  VALUES ('PSP4 Ordinary Event', v_ordinary_tenant, 'Active', true, true, current_date + 7, 'UTC')
  RETURNING id INTO v_ordinary_event;

  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('psp4-ordinary-admin@fixture.invalid', '9ee50000-0000-4000-8000-000000000099', true, false, 'event_admin')
  RETURNING id INTO v_ordinary_admin;

  INSERT INTO public.admin_event_access (admin_user_id, event_id, role)
  VALUES (v_ordinary_admin, v_ordinary_event, 'event_admin');

  PERFORM set_config('psp4.ordinary_tenant', v_ordinary_tenant::text, true);
  PERFORM set_config('psp4.ordinary_event', v_ordinary_event::text, true);
END;
$ordinary$;

SET LOCAL ROLE authenticated;

-- ===========================================================================
-- 1-3, 7: Alice -- not_confirmed with no Passport, not_confirmed while
-- payment_pending/open, confirmed once reserved, and the existing checkout-
-- attempt reader's own behavior is unaffected throughout.
-- ===========================================================================
DO $alice$
DECLARE
  v_alice_draft record;
  v_prepared record;
  v_confirmation record;
  v_attempt_read record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee50000-0000-4000-8000-000000000001', true);

  SELECT * INTO v_alice_draft FROM public.create_self_service_organizer_draft(
    'Alice Org', 'Alice Reunion', current_date + 7, 'UTC',
    '9ee5a000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp4_assert(v_alice_draft.outcome = 'created', 'Alice''s ordinary first draft is created');

  -- 1: no Passport row at all -> not_confirmed.
  SELECT * INTO v_confirmation FROM public.get_my_self_service_event_passport_confirmation(v_alice_draft.event_id);
  PERFORM public.psp4_assert(v_confirmation.outcome = 'not_confirmed', 'no Passport row yet -> not_confirmed');
  PERFORM public.psp4_assert(
    (SELECT count(*) FROM json_object_keys(row_to_json(v_confirmation)) AS k) = 1,
    'the confirmation reader row has exactly one column -- outcome -- no more'
  );

  -- 2: prepare a checkout attempt (payment_pending Passport, open attempt)
  -- -> still not_confirmed, and the existing attempt reader is unaffected.
  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_alice_draft.event_id, '9ee5a000-0000-4000-8000-000000000002'
  );
  PERFORM public.psp4_assert(v_prepared.outcome = 'prepared', 'Alice''s checkout attempt is prepared');

  SELECT * INTO v_confirmation FROM public.get_my_self_service_event_passport_confirmation(v_alice_draft.event_id);
  PERFORM public.psp4_assert(v_confirmation.outcome = 'not_confirmed', 'payment_pending/open attempt -> still not_confirmed');

  SELECT * INTO v_attempt_read FROM public.get_my_self_service_event_passport_checkout_attempt(v_alice_draft.event_id);
  PERFORM public.psp4_assert(
    v_attempt_read.outcome = 'open_attempt' AND v_attempt_read.state = 'preparing',
    'the existing checkout-attempt reader is completely unaffected by this migration'
  );

  -- 3, 7: once reserved (fixture-only, Stripe confirmation is out of
  -- scope), the new reader reports confirmed, AND the existing reader's own
  -- documented 'no_open_attempt' behavior for a reserved Event (proved in
  -- the 20261014 fixture) is unchanged.
  SET LOCAL ROLE postgres;
  PERFORM public.psp4_set_reserved(v_alice_draft.event_id, v_prepared.attempt_id);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee50000-0000-4000-8000-000000000001', true);

  SELECT * INTO v_confirmation FROM public.get_my_self_service_event_passport_confirmation(v_alice_draft.event_id);
  PERFORM public.psp4_assert(v_confirmation.outcome = 'confirmed', 'a reserved Passport reads back as confirmed');

  SELECT * INTO v_attempt_read FROM public.get_my_self_service_event_passport_checkout_attempt(v_alice_draft.event_id);
  PERFORM public.psp4_assert(
    v_attempt_read.outcome = 'no_open_attempt',
    'the existing checkout-attempt reader''s own no_open_attempt behavior for a reserved Event is unchanged by this migration'
  );

  PERFORM set_config('psp4.alice_event', v_alice_draft.event_id::text, true);
END;
$alice$;

-- ===========================================================================
-- 5: a foreign caller cannot read another organizer's confirmation status.
-- ===========================================================================
DO $ben$
DECLARE
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee50000-0000-4000-8000-000000000002', true);

  v_failed := false;
  BEGIN
    PERFORM public.get_my_self_service_event_passport_confirmation(
      current_setting('psp4.alice_event')::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp4_assert(v_failed, 'a foreign caller cannot read another organizer''s confirmation status, non-enumerating');
END;
$ben$;

-- ===========================================================================
-- 6: neither anon nor service_role may invoke the new reader.
-- ===========================================================================
DO $no_service_role_read$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp4_try_confirmation_reader_as(current_setting('psp4.alice_event')::uuid) INTO v_result;
  PERFORM public.psp4_assert(
    v_result = 'no error',
    format('authenticated CAN call its own owner reader (got %L)', v_result)
  );
END;
$no_service_role_read$;

SET LOCAL ROLE anon;
DO $no_anon_read$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp4_try_confirmation_reader_as(current_setting('psp4.alice_event')::uuid) INTO v_result;
  PERFORM set_config('psp4.anon_result', v_result, true);
END;
$no_anon_read$;
SET LOCAL ROLE authenticated;
PERFORM public.psp4_assert(
  current_setting('psp4.anon_result') = '42501',
  format('anon cannot call the confirmation reader directly (got %L)', current_setting('psp4.anon_result'))
);

SET LOCAL ROLE service_role;
DO $no_service_role_read2$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp4_try_confirmation_reader_as(current_setting('psp4.alice_event')::uuid) INTO v_result;
  PERFORM set_config('psp4.service_role_result', v_result, true);
END;
$no_service_role_read2$;
SET LOCAL ROLE authenticated;
PERFORM public.psp4_assert(
  current_setting('psp4.service_role_result') = '42501',
  format('service_role cannot call the confirmation reader directly (got %L)', current_setting('psp4.service_role_result'))
);

-- ===========================================================================
-- 8 (verified last): the ordinary FCOC/platform Tenant Event and its admin
-- authority row are completely unaffected by everything above.
-- ===========================================================================
DO $ordinary_check$
BEGIN
  PERFORM public.psp4_assert(
    public.psp4_event_exists(current_setting('psp4.ordinary_event')::uuid),
    'the ordinary platform Event is untouched'
  );
END;
$ordinary_check$;

SET LOCAL ROLE postgres;

ROLLBACK;
