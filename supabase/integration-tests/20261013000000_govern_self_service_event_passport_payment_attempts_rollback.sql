-- Stripe Passport Checkout database-authority foundation -- linked-database
-- behavior proof. Provider-independent: no Stripe SDK, API call, webhook, or
-- money movement anywhere in this fixture.
--
-- Run only after every migration through 20261013000000 has been applied.
-- Creates isolated auth + identity rows, exercises the governed RPCs as the
-- authenticated / service_role / anon roles, and rolls everything back. NOT
-- executed as part of this implementation task -- proof-of-shape only, per
-- this repository's established convention for behavioral fixtures.
--
-- It proves:
--   1. an owner can prepare a Passport checkout attempt for her own eligible
--      Event; the Event's Passport becomes payment_pending and the
--      one-unpaid-event slot is consumed;
--   2. a retried prepare with the SAME idempotency key replays the SAME
--      attempt -- never a second row;
--   3. a second prepare for the SAME Event with a DIFFERENT idempotency key
--      returns the caller-safe 'attempt_already_open' outcome naming the
--      existing attempt -- never a raw constraint error, never a second row;
--   4. a foreign caller cannot prepare a checkout for another organizer's
--      Event -- the same non-enumerating 'Event not found.', zero mutation;
--   5. Delete and Replace are both denied by the fixed, code-style
--      'checkout_cancellation_required' RAISE -- never a deletion -- while
--      an attempt is preparing OR open, and the attempt/Event/Passport are
--      completely untouched by either denial. This MUST be a raised
--      exception, not a structured return row: replace_self_service_organizer_event
--      is deliberately unmodified by this migration and captures delete's
--      result without branching on its outcome column, so only a
--      propagating exception -- not a normal return -- safely aborts
--      replace's delegated call with zero mutation;
--   6. only service_role may bind a provider Checkout Session id to a
--      prepared attempt (preparing -> open); authenticated and anon are
--      denied at the grant level before the function body ever runs;
--   7. only service_role may record an attempt expired/cancelled, and only
--      service_role may confirm a payment;
--   8. once a governed cancellation records an attempt expired or
--      cancelled, the EXISTING ordinary Delete/Replace pending-cleanup path
--      works again -- and once the old Event is actually deleted or
--      replaced, its now-terminal attempt row is RETAINED, completely
--      untouched, keeping its original plain Event id and terminal state
--      (event_id is deliberately NOT a foreign key, so it neither blocks
--      nor is discovered/cleaned up by that deletion), and remains
--      unreadable and unwritable to browser roles even as an orphaned
--      historical row;
--   9. a verified confirmation writes the immutable receipt BEFORE it
--      reserves exactly the intended Passport and confirms exactly the
--      intended attempt, and frees the one-unpaid-event slot;
--   10. a duplicate delivery of the SAME provider event id is a harmless
--       no-op -- the same receipt id comes back, and no second receipt row
--       is written;
--   11. once an attempt is confirmed, a second confirmation attempt against
--       it (a different provider event id, mismatched session) fails closed
--       with zero mutation;
--   12. a reserved Event (confirmed or, as here, fixture-inserted directly
--       -- Stripe contact is out of scope for this task) remains denied by
--       the PRE-EXISTING reserved/active/expired check, completely
--       unaffected by anything added in this migration;
--   13. a plain payment_pending Passport with NO attempt row -- the
--       pre-existing live behavior -- remains ordinarily deletable exactly
--       as before;
--   14. neither anon nor authenticated can write directly to the attempt or
--       receipt tables -- an actual rejected INSERT in each role, not merely
--       absent UI;
--   15. an ordinary FCOC/platform-Tenant Event, and its admin/authority
--       rows, are completely untouched by any of the above;
--   16. zero fixture residue survives the fixture's own explicit ROLLBACK.

BEGIN;

CREATE OR REPLACE FUNCTION public.psp2_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Passport payment-attempts fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.psp2_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp2_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.psp2_assert(boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.psp2_link(p_person_id uuid, p_auth_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', true, now());
$function$;
ALTER FUNCTION public.psp2_link(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp2_link(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp2_link(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp2_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.psp2_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp2_event_exists(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp2_event_exists(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.psp2_passport_state(p_event_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT p.state FROM public.self_service_event_passports AS p WHERE p.event_id = p_event_id;
$function$;
ALTER FUNCTION public.psp2_passport_state(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp2_passport_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.psp2_passport_state(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.psp2_attempt_row(p_attempt_id uuid)
RETURNS TABLE(state text, event_id uuid, provider_session_id text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT a.state, a.event_id, a.provider_session_id
  FROM public.self_service_event_passport_payment_attempts AS a
  WHERE a.id = p_attempt_id;
$function$;
ALTER FUNCTION public.psp2_attempt_row(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp2_attempt_row(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.psp2_attempt_row(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.psp2_attempt_count_for_event(p_event_id uuid)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT count(*)::integer FROM public.self_service_event_passport_payment_attempts
  WHERE event_id = p_event_id;
$function$;
ALTER FUNCTION public.psp2_attempt_count_for_event(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp2_attempt_count_for_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.psp2_attempt_count_for_event(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.psp2_receipt_count_for_provider_event(p_provider_event_id text)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT count(*)::integer FROM public.self_service_event_passport_payment_receipt_audit
  WHERE provider_event_id = p_provider_event_id;
$function$;
ALTER FUNCTION public.psp2_receipt_count_for_provider_event(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp2_receipt_count_for_provider_event(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.psp2_receipt_count_for_provider_event(text) TO authenticated, service_role;

-- Fixture-only: directly sets a Passport row's state, bypassing the governed
-- prepare/confirm commands -- used only to reconstruct the two states
-- (payment_pending-with-no-attempt, and reserved) that predate this
-- migration and must remain exactly as they already behaved.
CREATE OR REPLACE FUNCTION public.psp2_set_passport(p_event_id uuid, p_state text, p_paid_at timestamptz)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.self_service_event_passports (event_id, state, paid_at)
  VALUES (p_event_id, p_state, p_paid_at);
$function$;
ALTER FUNCTION public.psp2_set_passport(uuid, text, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp2_set_passport(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.psp2_try_insert_attempt_as_caller(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  INSERT INTO public.self_service_event_passport_payment_attempts (
    event_id, organizer_person_id, actor_auth_user_id, idempotency_key
  ) VALUES (
    p_event_id, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
  );
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$function$;
ALTER FUNCTION public.psp2_try_insert_attempt_as_caller(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp2_try_insert_attempt_as_caller(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp2_try_insert_attempt_as_caller(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.psp2_try_select_attempt_as_caller(p_attempt_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM 1 FROM public.self_service_event_passport_payment_attempts WHERE id = p_attempt_id;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$function$;
ALTER FUNCTION public.psp2_try_select_attempt_as_caller(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp2_try_select_attempt_as_caller(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp2_try_select_attempt_as_caller(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.psp2_try_insert_receipt_as_caller(p_event_id uuid, p_attempt_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  INSERT INTO public.self_service_event_passport_payment_receipt_audit (
    provider_event_id, provider_session_id, event_id, attempt_id
  ) VALUES (
    gen_random_uuid()::text, gen_random_uuid()::text, p_event_id, p_attempt_id
  );
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$function$;
ALTER FUNCTION public.psp2_try_insert_receipt_as_caller(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp2_try_insert_receipt_as_caller(uuid, uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp2_try_insert_receipt_as_caller(uuid, uuid) TO anon, authenticated;

-- Fixture-only: attempts the three service_role-only RPCs as whatever role
-- is currently active, reporting SQLSTATE instead of raising -- used to
-- prove authenticated/anon are denied at the grant level, before the
-- function body ever runs.
CREATE OR REPLACE FUNCTION public.psp2_try_service_only_rpcs_as_caller(p_attempt_id uuid)
RETURNS TABLE(bind_result text, terminal_result text, confirm_result text)
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_bind text;
  v_terminal text;
  v_confirm text;
BEGIN
  BEGIN
    PERFORM public.bind_self_service_event_passport_checkout_session(p_attempt_id, 'cs_should_not_bind');
    v_bind := 'no error';
  EXCEPTION WHEN OTHERS THEN v_bind := SQLSTATE;
  END;

  BEGIN
    PERFORM public.record_self_service_event_passport_checkout_terminal_state(
      p_attempt_id, NULL, 'cancelled'
    );
    v_terminal := 'no error';
  EXCEPTION WHEN OTHERS THEN v_terminal := SQLSTATE;
  END;

  BEGIN
    PERFORM public.confirm_self_service_event_passport_payment(
      p_attempt_id, 'cs_should_not_confirm', 'evt_should_not_confirm'
    );
    v_confirm := 'no error';
  EXCEPTION WHEN OTHERS THEN v_confirm := SQLSTATE;
  END;

  RETURN QUERY SELECT v_bind, v_terminal, v_confirm;
END;
$function$;
ALTER FUNCTION public.psp2_try_service_only_rpcs_as_caller(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp2_try_service_only_rpcs_as_caller(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp2_try_service_only_rpcs_as_caller(uuid) TO anon, authenticated;

DO $setup$
DECLARE
  v_person uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id IN (
      '9ee30000-0000-4000-8000-000000000001',
      '9ee30000-0000-4000-8000-000000000002',
      '9ee30000-0000-4000-8000-000000000003',
      '9ee30000-0000-4000-8000-000000000004',
      '9ee30000-0000-4000-8000-000000000005',
      '9ee30000-0000-4000-8000-000000000006'
    )
  ) THEN
    RAISE EXCEPTION 'Passport payment-attempts fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('9ee30000-0000-4000-8000-000000000001', 'psp2-alice@fixture.invalid', now()),
    ('9ee30000-0000-4000-8000-000000000002', 'psp2-ben@fixture.invalid', now()),
    ('9ee30000-0000-4000-8000-000000000003', 'psp2-carol@fixture.invalid', now()),
    ('9ee30000-0000-4000-8000-000000000004', 'psp2-dana@fixture.invalid', now()),
    ('9ee30000-0000-4000-8000-000000000005', 'psp2-erin@fixture.invalid', now()),
    ('9ee30000-0000-4000-8000-000000000006', 'psp2-frank@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp2_link(v_person, '9ee30000-0000-4000-8000-000000000001');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp2_link(v_person, '9ee30000-0000-4000-8000-000000000002');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp2_link(v_person, '9ee30000-0000-4000-8000-000000000003');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp2_link(v_person, '9ee30000-0000-4000-8000-000000000004');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp2_link(v_person, '9ee30000-0000-4000-8000-000000000005');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp2_link(v_person, '9ee30000-0000-4000-8000-000000000006');
END;
$setup$;

-- ===========================================================================
-- 15 (checked first, as a control): an ordinary FCOC/platform Tenant Event
-- and its admin authority row.
-- ===========================================================================
DO $ordinary$
DECLARE
  v_ordinary_tenant uuid;
  v_ordinary_event uuid;
  v_ordinary_admin uuid;
BEGIN
  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title, is_active)
  VALUES ('psp2-ordinary-tenant', 'psp2-ordinary-tenant', 'PSP2 Ordinary Tenant', 'PSP2 Ordinary Tenant', 'PSP2 Ordinary Tenant', true)
  RETURNING id INTO v_ordinary_tenant;

  INSERT INTO public.events (name, tenant_id, status, is_active, visible_to_members, end_date, timezone)
  VALUES ('PSP2 Ordinary Event', v_ordinary_tenant, 'Active', true, true, current_date + 7, 'UTC')
  RETURNING id INTO v_ordinary_event;

  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('psp2-ordinary-admin@fixture.invalid', '9ee30000-0000-4000-8000-000000000099', true, false, 'event_admin')
  RETURNING id INTO v_ordinary_admin;

  INSERT INTO public.admin_event_access (admin_user_id, event_id, role)
  VALUES (v_ordinary_admin, v_ordinary_event, 'event_admin');

  PERFORM set_config('psp2.ordinary_tenant', v_ordinary_tenant::text, true);
  PERFORM set_config('psp2.ordinary_event', v_ordinary_event::text, true);
END;
$ordinary$;

SET LOCAL ROLE authenticated;

-- ===========================================================================
-- 1-3, 5 (preparing), 8 (cancelled -> ordinary delete works again, and the
-- now-terminal attempt row is retained, unreadable/unwritable to browser
-- roles): Alice.
-- ===========================================================================
DO $alice$
DECLARE
  v_alice_draft record;
  v_prepared record;
  v_retry record;
  v_conflict record;
  v_del record;
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee30000-0000-4000-8000-000000000001', true);

  SELECT * INTO v_alice_draft FROM public.create_self_service_organizer_draft(
    'Alice Org', 'Alice Reunion', current_date + 7, 'UTC',
    '9ee3a000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp2_assert(v_alice_draft.outcome = 'created', 'Alice''s ordinary first draft is created');
  PERFORM public.psp2_assert(
    public.psp2_passport_state(v_alice_draft.event_id) IS NULL,
    'no Passport row exists before any checkout attempt'
  );

  -- 1: prepare succeeds; Passport becomes payment_pending.
  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_alice_draft.event_id, '9ee3a000-0000-4000-8000-000000000002'
  );
  PERFORM public.psp2_assert(v_prepared.outcome = 'prepared', 'Alice''s checkout attempt is prepared');
  PERFORM public.psp2_assert(v_prepared.state = 'preparing', 'a freshly prepared attempt is preparing');
  PERFORM public.psp2_assert(
    public.psp2_passport_state(v_alice_draft.event_id) = 'payment_pending',
    'preparing a checkout creates the Event''s payment_pending Passport row'
  );
  PERFORM public.psp2_assert(
    public.psp2_attempt_count_for_event(v_alice_draft.event_id) = 1,
    'exactly one attempt row exists for Alice''s Event'
  );

  -- 2: idempotent retry with the SAME key replays the SAME attempt.
  SELECT * INTO v_retry FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_alice_draft.event_id, '9ee3a000-0000-4000-8000-000000000002'
  );
  PERFORM public.psp2_assert(
    v_retry.outcome = 'prepared' AND v_retry.attempt_id = v_prepared.attempt_id,
    'retrying prepare with the same idempotency key replays the SAME attempt'
  );
  PERFORM public.psp2_assert(
    public.psp2_attempt_count_for_event(v_alice_draft.event_id) = 1,
    'the idempotent retry did not create a second attempt row'
  );

  -- 3: a DIFFERENT idempotency key for the SAME Event is rejected safely.
  SELECT * INTO v_conflict FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_alice_draft.event_id, '9ee3a000-0000-4000-8000-000000000003'
  );
  PERFORM public.psp2_assert(
    v_conflict.outcome = 'attempt_already_open' AND v_conflict.attempt_id = v_prepared.attempt_id,
    'a second concurrent attempt for the same Event returns attempt_already_open naming the existing attempt'
  );
  PERFORM public.psp2_assert(
    public.psp2_attempt_count_for_event(v_alice_draft.event_id) = 1,
    'the rejected second attempt did not create a new row'
  );

  -- 5 (preparing): Delete and Replace are both denied by the raised
  -- 'checkout_cancellation_required' message, with zero mutation.
  DECLARE
    v_failed boolean;
  BEGIN
    v_failed := false;
    BEGIN
      PERFORM public.delete_self_service_organizer_event(
        v_alice_draft.event_id, '9ee3a000-0000-4000-8000-000000000004'
      );
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'checkout_cancellation_required';
    END;
    PERFORM public.psp2_assert(v_failed, 'Delete raises checkout_cancellation_required while the attempt is preparing');

    v_failed := false;
    BEGIN
      PERFORM public.replace_self_service_organizer_event(
        v_alice_draft.event_id, 'Alice Should Not Replace', 'Alice Should Not Replace', current_date + 20, 'UTC',
        '9ee3a000-0000-4000-8000-000000000005', NULL, 'no_location', NULL, 'casual'
      );
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'checkout_cancellation_required';
    END;
    PERFORM public.psp2_assert(
      v_failed,
      'Replace is likewise denied with checkout_cancellation_required while the attempt is preparing, with zero mutation'
    );
  END;

  PERFORM public.psp2_assert(public.psp2_event_exists(v_alice_draft.event_id), 'Alice''s Event still exists after both denials');
  PERFORM public.psp2_assert(
    public.psp2_passport_state(v_alice_draft.event_id) = 'payment_pending',
    'Alice''s Passport is still payment_pending after both denials'
  );
  DECLARE
    v_attempt record;
  BEGIN
    SELECT * INTO v_attempt FROM public.psp2_attempt_row(v_prepared.attempt_id);
    PERFORM public.psp2_assert(v_attempt.state = 'preparing', 'Alice''s attempt is still preparing after both denials');
  END;

  -- 8: once a governed cancellation records the attempt cancelled, ordinary
  -- Delete works again through the EXISTING pending-cleanup path.
  SET LOCAL ROLE service_role;
  PERFORM public.record_self_service_event_passport_checkout_terminal_state(
    v_prepared.attempt_id, NULL, 'cancelled'
  );
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee30000-0000-4000-8000-000000000001', true);

  DECLARE
    v_attempt record;
  BEGIN
    SELECT * INTO v_attempt FROM public.psp2_attempt_row(v_prepared.attempt_id);
    PERFORM public.psp2_assert(v_attempt.state = 'cancelled', 'the attempt is durably cancelled');
  END;

  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_alice_draft.event_id, '9ee3a000-0000-4000-8000-000000000006'
  );
  PERFORM public.psp2_assert(v_del.outcome = 'deleted', 'ordinary Delete succeeds once the attempt is cancelled');
  PERFORM public.psp2_assert(NOT public.psp2_event_exists(v_alice_draft.event_id), 'Alice''s Event no longer exists');
  PERFORM public.psp2_assert(
    public.psp2_passport_state(v_alice_draft.event_id) IS NULL,
    'Alice''s payment_pending Passport row is gone too'
  );

  -- The now-terminal attempt row is retained, completely untouched, exactly
  -- as the approved specification requires -- event_id is a plain,
  -- non-foreign-key audit reference, so ordinary deletion of the Event it
  -- was for never removes, updates, or otherwise touches it. It durably
  -- outlives the Event.
  PERFORM public.psp2_assert(
    public.psp2_attempt_count_for_event(v_alice_draft.event_id) = 1,
    'the cancelled attempt row still exists after its Event is deleted'
  );
  DECLARE
    v_attempt record;
  BEGIN
    SELECT * INTO v_attempt FROM public.psp2_attempt_row(v_prepared.attempt_id);
    PERFORM public.psp2_assert(
      v_attempt.state = 'cancelled' AND v_attempt.event_id = v_alice_draft.event_id,
      'the retained attempt row keeps its original plain Event id and terminal state, unchanged'
    );
  END;

  -- It remains unreadable and unwritable to browser roles even now that its
  -- Event is gone -- the same table-wide RLS/grant denial, proven again
  -- specifically against this now-orphaned historical row.
  DECLARE
    v_result text;
  BEGIN
    SELECT public.psp2_try_select_attempt_as_caller(v_prepared.attempt_id) INTO v_result;
    PERFORM public.psp2_assert(
      v_result = '42501',
      format('authenticated cannot read the retained historical attempt row directly (got %L)', v_result)
    );
  END;

  SET LOCAL ROLE anon;
  DECLARE
    v_result text;
  BEGIN
    SELECT public.psp2_try_select_attempt_as_caller(v_prepared.attempt_id) INTO v_result;
    PERFORM set_config('psp2.alice_anon_select_result', v_result, true);
  END;
  SET LOCAL ROLE authenticated;
  PERFORM public.psp2_assert(
    current_setting('psp2.alice_anon_select_result') = '42501',
    format('anon cannot read the retained historical attempt row directly (got %L)', current_setting('psp2.alice_anon_select_result'))
  );

  -- No generic dependency scan or foreign key blocked this ordinary
  -- deletion -- proven simply by v_del.outcome = 'deleted' above succeeding
  -- at all despite the retained attempt row's continued existence.

  PERFORM set_config('psp2.alice_event', v_alice_draft.event_id::text, true);
  PERFORM set_config('psp2.alice_attempt', v_prepared.attempt_id::text, true);
END;
$alice$;

-- ===========================================================================
-- 4: a foreign caller cannot prepare a checkout for another organizer's
-- Event.
-- ===========================================================================
DO $ben_prepares_own$
DECLARE
  v_ben_draft record;
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee30000-0000-4000-8000-000000000002', true);

  SELECT * INTO v_ben_draft FROM public.create_self_service_organizer_draft(
    'Ben Org', 'Ben Cookout', current_date + 10, 'UTC',
    '9ee3b000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp2_assert(v_ben_draft.outcome = 'created', 'Ben''s ordinary first draft is created');

  v_failed := false;
  BEGIN
    -- Ben attempts to prepare a checkout for Alice's (already-deleted, but
    -- the id is simply foreign either way) Event id -- fabricated here as
    -- any event id Ben does not own.
    PERFORM public.prepare_self_service_event_passport_checkout_attempt(
      current_setting('psp2.alice_event')::uuid, '9ee3b000-0000-4000-8000-000000000002'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp2_assert(v_failed, 'a foreign caller cannot prepare a checkout for another organizer''s Event id, non-enumerating');
  -- Exactly Alice's own retained historical (cancelled) attempt row --
  -- Ben's unauthorized try created no new one.
  PERFORM public.psp2_assert(
    public.psp2_attempt_count_for_event(current_setting('psp2.alice_event')::uuid) = 1,
    'no new attempt row was created by Ben''s unauthorized try against Alice''s (already fully deleted) Event id'
  );

  PERFORM set_config('psp2.ben_event', v_ben_draft.event_id::text, true);
END;
$ben_prepares_own$;

-- ===========================================================================
-- 14: neither anon nor authenticated can write directly to the attempt or
-- receipt tables.
-- ===========================================================================
DO $no_browser_write$
DECLARE
  v_ben_event uuid;
  v_result text;
BEGIN
  v_ben_event := current_setting('psp2.ben_event')::uuid;
  PERFORM set_config('request.jwt.claim.sub', '9ee30000-0000-4000-8000-000000000002', true);

  SELECT public.psp2_try_insert_attempt_as_caller(v_ben_event) INTO v_result;
  PERFORM public.psp2_assert(
    v_result = '42501',
    format('authenticated cannot write self_service_event_passport_payment_attempts directly (got %L)', v_result)
  );

  SELECT public.psp2_try_insert_receipt_as_caller(v_ben_event, gen_random_uuid()) INTO v_result;
  PERFORM public.psp2_assert(
    v_result = '42501',
    format('authenticated cannot write self_service_event_passport_payment_receipt_audit directly (got %L)', v_result)
  );
END;
$no_browser_write$;

-- psp2_assert is executable only by authenticated/service_role, so it
-- cannot be called while anon remains the active role. Each attempted
-- direct mutation still runs genuinely AS anon; its result is handed to a
-- following authenticated-role block via set_config/current_setting (the
-- same transaction-scoped cross-block mechanism this fixture already uses
-- throughout) so the assertion can run under an authorized role.
SET LOCAL ROLE anon;
DO $no_browser_write_anon_attempt$
DECLARE
  v_ben_event uuid;
  v_result text;
BEGIN
  v_ben_event := current_setting('psp2.ben_event')::uuid;

  SELECT public.psp2_try_insert_attempt_as_caller(v_ben_event) INTO v_result;
  PERFORM set_config('psp2.anon_attempt_write_result', v_result, true);

  SELECT public.psp2_try_insert_receipt_as_caller(v_ben_event, gen_random_uuid()) INTO v_result;
  PERFORM set_config('psp2.anon_receipt_write_result', v_result, true);
END;
$no_browser_write_anon_attempt$;

SET LOCAL ROLE authenticated;
DO $no_browser_write_anon_assert$
BEGIN
  PERFORM public.psp2_assert(
    current_setting('psp2.anon_attempt_write_result') = '42501',
    format('anon cannot write self_service_event_passport_payment_attempts directly (got %L)', current_setting('psp2.anon_attempt_write_result'))
  );
  PERFORM public.psp2_assert(
    current_setting('psp2.anon_receipt_write_result') = '42501',
    format('anon cannot write self_service_event_passport_payment_receipt_audit directly (got %L)', current_setting('psp2.anon_receipt_write_result'))
  );
END;
$no_browser_write_anon_assert$;

-- ===========================================================================
-- 6, 7, 9, 10, 11, 5 (open): Carol -- the full bind -> open-denial ->
-- confirm -> duplicate-replay -> post-confirm-denial lifecycle.
-- ===========================================================================
DO $carol$
DECLARE
  v_carol_draft record;
  v_prepared record;
  v_grants record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee30000-0000-4000-8000-000000000003', true);

  SELECT * INTO v_carol_draft FROM public.create_self_service_organizer_draft(
    'Carol Org', 'Carol Gala', current_date + 14, 'UTC',
    '9ee3c000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp2_assert(v_carol_draft.outcome = 'created', 'Carol''s ordinary first draft is created');

  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_carol_draft.event_id, '9ee3c000-0000-4000-8000-000000000002'
  );
  PERFORM public.psp2_assert(v_prepared.outcome = 'prepared', 'Carol''s checkout attempt is prepared');

  -- 6, 7: authenticated cannot invoke any of the three service_role-only
  -- commands -- denied at the grant level, before the function body runs.
  SELECT * INTO v_grants FROM public.psp2_try_service_only_rpcs_as_caller(v_prepared.attempt_id);
  PERFORM public.psp2_assert(v_grants.bind_result = '42501', format('authenticated cannot call bind_* directly (got %L)', v_grants.bind_result));
  PERFORM public.psp2_assert(v_grants.terminal_result = '42501', format('authenticated cannot call record_terminal_state directly (got %L)', v_grants.terminal_result));
  PERFORM public.psp2_assert(v_grants.confirm_result = '42501', format('authenticated cannot call confirm_* directly (got %L)', v_grants.confirm_result));

  -- psp2_assert is executable only by authenticated/service_role, so the
  -- three attempts must run as anon while the assertions run afterward,
  -- under authenticated -- handed across via set_config/current_setting,
  -- exactly like the direct-table-write proof above.
  SET LOCAL ROLE anon;
  SELECT * INTO v_grants FROM public.psp2_try_service_only_rpcs_as_caller(v_prepared.attempt_id);
  PERFORM set_config('psp2.anon_bind_result', v_grants.bind_result, true);
  PERFORM set_config('psp2.anon_terminal_result', v_grants.terminal_result, true);
  PERFORM set_config('psp2.anon_confirm_result', v_grants.confirm_result, true);

  SET LOCAL ROLE authenticated;
  PERFORM public.psp2_assert(
    current_setting('psp2.anon_bind_result') = '42501',
    format('anon cannot call bind_* directly (got %L)', current_setting('psp2.anon_bind_result'))
  );
  PERFORM public.psp2_assert(
    current_setting('psp2.anon_terminal_result') = '42501',
    format('anon cannot call record_terminal_state directly (got %L)', current_setting('psp2.anon_terminal_result'))
  );
  PERFORM public.psp2_assert(
    current_setting('psp2.anon_confirm_result') = '42501',
    format('anon cannot call confirm_* directly (got %L)', current_setting('psp2.anon_confirm_result'))
  );
  PERFORM set_config('request.jwt.claim.sub', '9ee30000-0000-4000-8000-000000000003', true);

  -- service_role binds the Checkout Session -- preparing -> open.
  SET LOCAL ROLE service_role;
  PERFORM public.bind_self_service_event_passport_checkout_session(
    v_prepared.attempt_id, 'cs_test_carol_1'
  );
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee30000-0000-4000-8000-000000000003', true);

  DECLARE
    v_attempt record;
  BEGIN
    SELECT * INTO v_attempt FROM public.psp2_attempt_row(v_prepared.attempt_id);
    PERFORM public.psp2_assert(
      v_attempt.state = 'open' AND v_attempt.provider_session_id = 'cs_test_carol_1',
      'the attempt is open with the bound provider session id'
    );
  END;
  PERFORM public.psp2_assert(
    public.psp2_passport_state(v_carol_draft.event_id) = 'payment_pending',
    'binding a session does not itself change the Passport state'
  );

  -- 5 (open): Delete is STILL denied once the attempt is open, not just
  -- while preparing.
  DECLARE
    v_failed boolean := false;
  BEGIN
    BEGIN
      PERFORM public.delete_self_service_organizer_event(
        v_carol_draft.event_id, '9ee3c000-0000-4000-8000-000000000003'
      );
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'checkout_cancellation_required';
    END;
    PERFORM public.psp2_assert(v_failed, 'Delete raises checkout_cancellation_required while the attempt is open');
  END;
  PERFORM public.psp2_assert(public.psp2_event_exists(v_carol_draft.event_id), 'Carol''s Event still exists after the open-attempt denial');

  -- service_role confirms the payment.
  SET LOCAL ROLE service_role;
  DECLARE
    v_confirm record;
  BEGIN
    SELECT * INTO v_confirm FROM public.confirm_self_service_event_passport_payment(
      v_prepared.attempt_id, 'cs_test_carol_1', 'evt_test_carol_1'
    );
    PERFORM public.psp2_assert(v_confirm.outcome = 'confirmed', 'confirmation succeeds');
    PERFORM public.psp2_assert(v_confirm.event_id = v_carol_draft.event_id, 'confirmation names exactly Carol''s Event');
    PERFORM public.psp2_assert(v_confirm.passport_state = 'reserved', 'confirmation reports the Passport reserved');
    PERFORM set_config('psp2.carol_receipt_id', v_confirm.receipt_id::text, true);
  END;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee30000-0000-4000-8000-000000000003', true);

  -- 9: the Passport is genuinely reserved and the attempt genuinely
  -- confirmed, and the slot is freed.
  PERFORM public.psp2_assert(
    public.psp2_passport_state(v_carol_draft.event_id) = 'reserved',
    'Carol''s Passport is reserved after confirmation'
  );
  DECLARE
    v_attempt record;
    v_cap record;
  BEGIN
    SELECT * INTO v_attempt FROM public.psp2_attempt_row(v_prepared.attempt_id);
    PERFORM public.psp2_assert(v_attempt.state = 'confirmed', 'the attempt is confirmed');

    SELECT * INTO v_cap FROM public.get_my_self_service_organizer_capacity();
    PERFORM public.psp2_assert(v_cap.can_start_another_event = true, 'a reserved Passport frees the one-unpaid-event slot');
  END;

  -- 10: a duplicate delivery of the SAME provider event id is a harmless
  -- no-op -- same receipt id, no second receipt row.
  SET LOCAL ROLE service_role;
  DECLARE
    v_replay record;
  BEGIN
    SELECT * INTO v_replay FROM public.confirm_self_service_event_passport_payment(
      v_prepared.attempt_id, 'cs_test_carol_1', 'evt_test_carol_1'
    );
    PERFORM public.psp2_assert(
      v_replay.outcome = 'confirmed' AND v_replay.receipt_id::text = current_setting('psp2.carol_receipt_id'),
      'a replayed webhook delivery for the same provider event id returns the SAME receipt id'
    );
  END;
  PERFORM public.psp2_assert(
    public.psp2_receipt_count_for_provider_event('evt_test_carol_1') = 1,
    'exactly one receipt row exists for this provider event id, even after the replay'
  );

  -- 11: a NEW provider event id against the now-confirmed attempt fails
  -- closed -- it is no longer 'open'.
  DECLARE
    v_failed boolean := false;
  BEGIN
    BEGIN
      PERFORM public.confirm_self_service_event_passport_payment(
        v_prepared.attempt_id, 'cs_test_carol_1', 'evt_test_carol_2'
      );
    EXCEPTION WHEN OTHERS THEN
      v_failed := true;
    END;
    PERFORM public.psp2_assert(v_failed, 'a second, different provider event against an already-confirmed attempt fails closed');
  END;
  PERFORM public.psp2_assert(
    public.psp2_receipt_count_for_provider_event('evt_test_carol_2') = 0,
    'the failed second confirmation wrote no receipt row'
  );
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee30000-0000-4000-8000-000000000003', true);

  -- 12 (this migration's slice of it): Delete/Replace of a NOW-reserved
  -- Event are denied by the PRE-EXISTING reserved check -- confirmation
  -- just proved that path is reachable through a real confirmed payment,
  -- not only through a direct fixture insert.
  DECLARE
    v_failed boolean := false;
  BEGIN
    BEGIN
      PERFORM public.delete_self_service_organizer_event(
        v_carol_draft.event_id, '9ee3c000-0000-4000-8000-000000000004'
      );
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'Event not found.';
    END;
    PERFORM public.psp2_assert(v_failed, 'a reserved (genuinely confirmed) Passport Event is rejected by standalone Delete');
  END;
  PERFORM public.psp2_assert(public.psp2_event_exists(v_carol_draft.event_id), 'Carol''s reserved Event still exists');
END;
$carol$;

-- ===========================================================================
-- 8 (expired variant, through Replace): Dana -- open attempt expired, then
-- atomic Replace works again, and the now-terminal attempt row is retained.
-- ===========================================================================
DO $dana$
DECLARE
  v_dana_draft record;
  v_prepared record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee30000-0000-4000-8000-000000000004', true);

  SELECT * INTO v_dana_draft FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Conference', current_date + 30, 'UTC',
    '9ee3d000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp2_assert(v_dana_draft.outcome = 'created', 'Dana''s ordinary first draft is created');

  SELECT * INTO v_prepared FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_dana_draft.event_id, '9ee3d000-0000-4000-8000-000000000002'
  );
  PERFORM public.psp2_assert(v_prepared.outcome = 'prepared', 'Dana''s checkout attempt is prepared');

  SET LOCAL ROLE service_role;
  PERFORM public.bind_self_service_event_passport_checkout_session(v_prepared.attempt_id, 'cs_test_dana_1');
  PERFORM public.record_self_service_event_passport_checkout_terminal_state(
    v_prepared.attempt_id, 'cs_test_dana_1', 'expired'
  );
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee30000-0000-4000-8000-000000000004', true);

  DECLARE
    v_attempt record;
  BEGIN
    SELECT * INTO v_attempt FROM public.psp2_attempt_row(v_prepared.attempt_id);
    PERFORM public.psp2_assert(v_attempt.state = 'expired', 'the attempt is durably expired');
  END;

  -- The expired-attempt case is proven through atomic REPLACE (not Delete)
  -- here, complementing Alice's cancelled-attempt-through-Delete proof
  -- above: replace_self_service_organizer_event is untouched by this
  -- migration and inherits this same retention behavior purely through its
  -- existing delegation to delete_self_service_organizer_event.
  DECLARE
    v_replace record;
  BEGIN
    SELECT * INTO v_replace FROM public.replace_self_service_organizer_event(
      v_dana_draft.event_id, 'Dana New Org', 'Dana New Gathering', current_date + 40, 'UTC',
      '9ee3d000-0000-4000-8000-000000000004', NULL, 'no_location', NULL, 'casual'
    );
    PERFORM public.psp2_assert(v_replace.outcome = 'replaced', 'atomic Replace succeeds once the open attempt is recorded expired');
  END;
  PERFORM public.psp2_assert(NOT public.psp2_event_exists(v_dana_draft.event_id), 'Dana''s old Event no longer exists');

  -- The now-terminal (expired) attempt row is retained, completely
  -- untouched, exactly as the approved specification requires.
  PERFORM public.psp2_assert(
    public.psp2_attempt_count_for_event(v_dana_draft.event_id) = 1,
    'the expired attempt row still exists after its Event is replaced'
  );
  DECLARE
    v_attempt record;
  BEGIN
    SELECT * INTO v_attempt FROM public.psp2_attempt_row(v_prepared.attempt_id);
    PERFORM public.psp2_assert(
      v_attempt.state = 'expired' AND v_attempt.event_id = v_dana_draft.event_id,
      'the retained attempt row keeps its original plain Event id and terminal state, unchanged'
    );
  END;
END;
$dana$;

-- ===========================================================================
-- 13: a plain payment_pending Passport with NO attempt row -- the
-- pre-existing live behavior -- remains ordinarily deletable, unaffected by
-- this migration.
-- ===========================================================================
DO $erin$
DECLARE
  v_erin_draft record;
  v_del record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee30000-0000-4000-8000-000000000005', true);

  SELECT * INTO v_erin_draft FROM public.create_self_service_organizer_draft(
    'Erin Org', 'Erin Workshop', current_date + 35, 'UTC',
    '9ee3e000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp2_assert(v_erin_draft.outcome = 'created', 'Erin''s ordinary first draft is created');

  SET LOCAL ROLE postgres;
  PERFORM public.psp2_set_passport(v_erin_draft.event_id, 'payment_pending', NULL);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee30000-0000-4000-8000-000000000005', true);

  PERFORM public.psp2_assert(
    public.psp2_attempt_count_for_event(v_erin_draft.event_id) = 0,
    'Erin has a payment_pending Passport with genuinely no attempt row'
  );

  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_erin_draft.event_id, '9ee3e000-0000-4000-8000-000000000002'
  );
  PERFORM public.psp2_assert(v_del.outcome = 'deleted', 'a plain payment_pending Passport with no attempt remains ordinarily deletable');
  PERFORM public.psp2_assert(NOT public.psp2_event_exists(v_erin_draft.event_id), 'Erin''s Event is gone');
END;
$erin$;

-- ===========================================================================
-- 12 (direct-insert variant): a reserved Passport, inserted directly (no
-- Stripe contact is in scope for this task), remains denied by the
-- PRE-EXISTING reserved check -- completely unaffected by this migration.
-- ===========================================================================
DO $frank$
DECLARE
  v_frank_draft record;
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee30000-0000-4000-8000-000000000006', true);

  SELECT * INTO v_frank_draft FROM public.create_self_service_organizer_draft(
    'Frank Org', 'Frank Fundraiser', current_date + 12, 'UTC',
    '9ee3f000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp2_assert(v_frank_draft.outcome = 'created', 'Frank''s ordinary first draft is created');

  SET LOCAL ROLE postgres;
  PERFORM public.psp2_set_passport(v_frank_draft.event_id, 'reserved', now());
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee30000-0000-4000-8000-000000000006', true);

  v_failed := false;
  BEGIN
    PERFORM public.delete_self_service_organizer_event(
      v_frank_draft.event_id, '9ee3f000-0000-4000-8000-000000000002'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp2_assert(v_failed, 'a directly reserved Passport Event is rejected by standalone Delete, unaffected by this migration');
  PERFORM public.psp2_assert(public.psp2_event_exists(v_frank_draft.event_id), 'Frank''s reserved Event still exists');
END;
$frank$;

-- ===========================================================================
-- 15 (verified last): the ordinary FCOC/platform Tenant Event and its admin
-- authority row are completely unaffected by everything above.
-- ===========================================================================
DO $ordinary_check$
BEGIN
  PERFORM public.psp2_assert(
    public.psp2_event_exists(current_setting('psp2.ordinary_event')::uuid),
    'the ordinary platform Event is untouched'
  );
END;
$ordinary_check$;

SET LOCAL ROLE postgres;

ROLLBACK;
