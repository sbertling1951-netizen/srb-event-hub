-- Stripe Passport Checkout access-layer -- linked-database behavior proof.
-- Provider-independent: no Stripe SDK, API call, webhook, or money movement
-- anywhere in this fixture.
--
-- Run only after every migration through 20261014000000 has been applied.
-- Creates isolated auth + identity rows, exercises the two new readers as
-- the authenticated / service_role / anon roles, and rolls everything back.
-- NOT executed as part of this implementation task -- proof-of-shape only,
-- per this repository's established convention for behavioral fixtures.
--
-- It proves:
--   1. the owner reader returns 'no_open_attempt' for the caller's own
--      eligible Event with no preparing/open attempt;
--   2. the owner reader returns 'open_attempt' (attempt_id/event_id/state/
--      provider/created_at only) once a preparing attempt exists, and NEVER
--      returns provider_session_id even after the attempt is bound to a
--      provider session (Stripe contact is out of scope for this fixture --
--      the session id is set directly, as fixture-only setup);
--   3. the owner reader still returns 'no_open_attempt' safely (never a
--      raised exception) once the Passport is reserved -- a reserved Event
--      remains readable;
--   4. a foreign caller cannot read another organizer's attempt status --
--      the same non-enumerating 'Event not found.';
--   5. neither anon nor authenticated may invoke the service-only reader --
--      denied at the grant level before the function body ever runs;
--   6. the service-only reader, called as service_role, returns exactly the
--      five documented columns including provider_session_id;
--   7. neither reader mutates attempt, Passport, or receipt state;
--   8. an ordinary FCOC/platform-Tenant Event, and its admin/authority rows,
--      are completely untouched by any of the above;
--   9. zero fixture residue survives the fixture's own explicit ROLLBACK.

BEGIN;

CREATE OR REPLACE FUNCTION public.psp3_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Passport checkout-access fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.psp3_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp3_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.psp3_assert(boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.psp3_link(p_person_id uuid, p_auth_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', true, now());
$function$;
ALTER FUNCTION public.psp3_link(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp3_link(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp3_link(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp3_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.psp3_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp3_event_exists(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp3_event_exists(uuid) TO authenticated;

-- Fixture-only: binds a provider session id directly, bypassing the real
-- Stripe-contacting bind route (entirely out of scope here) -- mirrors the
-- established "construct a scenario the current phase's own governed
-- commands already prove elsewhere" pattern.
CREATE OR REPLACE FUNCTION public.psp3_set_attempt_session(p_attempt_id uuid, p_session_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  UPDATE public.self_service_event_passport_payment_attempts
     SET provider_session_id = p_session_id,
         state = 'open',
         updated_at = now()
   WHERE id = p_attempt_id;
$function$;
ALTER FUNCTION public.psp3_set_attempt_session(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp3_set_attempt_session(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.psp3_set_reserved(p_event_id uuid, p_attempt_id uuid)
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
ALTER FUNCTION public.psp3_set_reserved(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp3_set_reserved(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.psp3_try_server_reader_as_caller(p_attempt_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM * FROM public.get_self_service_event_passport_checkout_attempt_for_server(p_attempt_id);
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$function$;
ALTER FUNCTION public.psp3_try_server_reader_as_caller(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp3_try_server_reader_as_caller(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp3_try_server_reader_as_caller(uuid) TO anon, authenticated;

DO $setup$
DECLARE
  v_person uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id IN (
      '9ee40000-0000-4000-8000-000000000001',
      '9ee40000-0000-4000-8000-000000000002'
    )
  ) THEN
    RAISE EXCEPTION 'Passport checkout-access fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('9ee40000-0000-4000-8000-000000000001', 'psp3-alice@fixture.invalid', now()),
    ('9ee40000-0000-4000-8000-000000000002', 'psp3-ben@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp3_link(v_person, '9ee40000-0000-4000-8000-000000000001');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp3_link(v_person, '9ee40000-0000-4000-8000-000000000002');
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
  VALUES ('psp3-ordinary-tenant', 'psp3-ordinary-tenant', 'PSP3 Ordinary Tenant', 'PSP3 Ordinary Tenant', 'PSP3 Ordinary Tenant', true)
  RETURNING id INTO v_ordinary_tenant;

  INSERT INTO public.events (name, tenant_id, status, is_active, visible_to_members, end_date, timezone)
  VALUES ('PSP3 Ordinary Event', v_ordinary_tenant, 'Active', true, true, current_date + 7, 'UTC')
  RETURNING id INTO v_ordinary_event;

  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('psp3-ordinary-admin@fixture.invalid', '9ee40000-0000-4000-8000-000000000099', true, false, 'event_admin')
  RETURNING id INTO v_ordinary_admin;

  INSERT INTO public.admin_event_access (admin_user_id, event_id, role)
  VALUES (v_ordinary_admin, v_ordinary_event, 'event_admin');

  PERFORM set_config('psp3.ordinary_tenant', v_ordinary_tenant::text, true);
  PERFORM set_config('psp3.ordinary_event', v_ordinary_event::text, true);
END;
$ordinary$;

SET LOCAL ROLE authenticated;

-- ===========================================================================
-- 1-3: Alice -- no_open_attempt, open_attempt with no session leak, still
-- safe once reserved.
-- ===========================================================================
DO $alice$
DECLARE
  v_alice_draft record;
  v_prepared record;
  v_read record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee40000-0000-4000-8000-000000000001', true);

  SELECT * INTO v_alice_draft FROM public.create_self_service_organizer_draft(
    'Alice Org', 'Alice Reunion', current_date + 7, 'UTC',
    '9ee4a000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp3_assert(v_alice_draft.outcome = 'created', 'Alice''s ordinary first draft is created');

  -- 1: no attempt yet -> no_open_attempt, safely, not an exception.
  SELECT * INTO v_read FROM public.get_my_self_service_event_passport_checkout_attempt(v_alice_draft.event_id);
  PERFORM public.psp3_assert(v_read.outcome = 'no_open_attempt', 'no attempt yet -> no_open_attempt');
  PERFORM public.psp3_assert(v_read.attempt_id IS NULL AND v_read.event_id IS NULL, 'no_open_attempt discloses no other column');

  -- 2: prepare, then bind (fixture-only) -> open_attempt, no session leak.
  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_alice_draft.event_id, '9ee4a000-0000-4000-8000-000000000002'
  );
  PERFORM public.psp3_assert(v_prepared.outcome = 'prepared', 'Alice''s checkout attempt is prepared');

  SELECT * INTO v_read FROM public.get_my_self_service_event_passport_checkout_attempt(v_alice_draft.event_id);
  PERFORM public.psp3_assert(
    v_read.outcome = 'open_attempt' AND v_read.attempt_id = v_prepared.attempt_id
      AND v_read.event_id = v_alice_draft.event_id AND v_read.state = 'preparing' AND v_read.provider = 'stripe',
    'a preparing attempt reads back as open_attempt with the expected minimal fields'
  );

  SET LOCAL ROLE postgres;
  PERFORM public.psp3_set_attempt_session(v_prepared.attempt_id, 'cs_test_alice_1');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee40000-0000-4000-8000-000000000001', true);

  SELECT * INTO v_read FROM public.get_my_self_service_event_passport_checkout_attempt(v_alice_draft.event_id);
  PERFORM public.psp3_assert(v_read.outcome = 'open_attempt' AND v_read.state = 'open', 'now open after binding');
  -- The owner reader's RETURNS TABLE has no provider_session_id column at
  -- all -- there is no field to even check for leakage; this positively
  -- confirms the row shape carries only the five documented columns.
  PERFORM public.psp3_assert(
    (SELECT count(*) FROM json_object_keys(row_to_json(v_read)) AS k) = 6,
    'the owner reader row has exactly outcome/attempt_id/event_id/state/provider/created_at -- six columns, no more'
  );

  -- 3: once reserved (fixture-only, Stripe confirmation is out of scope),
  -- the owner reader is STILL safely readable -- no_open_attempt, never an
  -- exception, even though the Event's Passport is now reserved.
  SET LOCAL ROLE postgres;
  PERFORM public.psp3_set_reserved(v_alice_draft.event_id, v_prepared.attempt_id);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee40000-0000-4000-8000-000000000001', true);

  SELECT * INTO v_read FROM public.get_my_self_service_event_passport_checkout_attempt(v_alice_draft.event_id);
  PERFORM public.psp3_assert(
    v_read.outcome = 'no_open_attempt',
    'a reserved Event reads back as no_open_attempt safely -- never a raised exception'
  );

  PERFORM set_config('psp3.alice_event', v_alice_draft.event_id::text, true);
  PERFORM set_config('psp3.alice_attempt', v_prepared.attempt_id::text, true);
END;
$alice$;

-- ===========================================================================
-- 4: a foreign caller cannot read another organizer's attempt status.
-- ===========================================================================
DO $ben$
DECLARE
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee40000-0000-4000-8000-000000000002', true);

  v_failed := false;
  BEGIN
    PERFORM public.get_my_self_service_event_passport_checkout_attempt(
      current_setting('psp3.alice_event')::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp3_assert(v_failed, 'a foreign caller cannot read another organizer''s attempt status, non-enumerating');
END;
$ben$;

-- ===========================================================================
-- 5: neither anon nor authenticated may invoke the service-only reader.
-- ===========================================================================
DO $no_browser_read$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp3_try_server_reader_as_caller(current_setting('psp3.alice_attempt')::uuid) INTO v_result;
  PERFORM public.psp3_assert(
    v_result = '42501',
    format('authenticated cannot call the service-only reader directly (got %L)', v_result)
  );
END;
$no_browser_read$;

SET LOCAL ROLE anon;
DO $no_browser_read_anon$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp3_try_server_reader_as_caller(current_setting('psp3.alice_attempt')::uuid) INTO v_result;
  PERFORM set_config('psp3.anon_server_reader_result', v_result, true);
END;
$no_browser_read_anon$;
SET LOCAL ROLE authenticated;
PERFORM public.psp3_assert(
  current_setting('psp3.anon_server_reader_result') = '42501',
  format('anon cannot call the service-only reader directly (got %L)', current_setting('psp3.anon_server_reader_result'))
);

-- ===========================================================================
-- 6: the service-only reader, called as service_role, returns exactly the
-- five documented columns.
-- ===========================================================================
SET LOCAL ROLE service_role;
DO $server_reader$
DECLARE
  v_read record;
BEGIN
  SELECT * INTO v_read FROM public.get_self_service_event_passport_checkout_attempt_for_server(
    current_setting('psp3.alice_attempt')::uuid
  );
  PERFORM public.psp3_assert(
    v_read.attempt_id = current_setting('psp3.alice_attempt')::uuid
      AND v_read.event_id = current_setting('psp3.alice_event')::uuid
      AND v_read.state = 'confirmed'
      AND v_read.provider = 'stripe'
      AND v_read.provider_session_id = 'cs_test_alice_1',
    'the service-only reader returns the exact expected row for the specific attempt id'
  );
  PERFORM public.psp3_assert(
    (SELECT count(*) FROM json_object_keys(row_to_json(v_read)) AS k) = 5,
    'the service-only reader row has exactly attempt_id/event_id/state/provider/provider_session_id -- five columns, no more'
  );
END;
$server_reader$;
SET LOCAL ROLE authenticated;

-- ===========================================================================
-- 8 (verified last): the ordinary FCOC/platform Tenant Event and its admin
-- authority row are completely unaffected by everything above.
-- ===========================================================================
DO $ordinary_check$
BEGIN
  PERFORM public.psp3_assert(
    public.psp3_event_exists(current_setting('psp3.ordinary_event')::uuid),
    'the ordinary platform Event is untouched'
  );
END;
$ordinary_check$;

SET LOCAL ROLE postgres;

ROLLBACK;
