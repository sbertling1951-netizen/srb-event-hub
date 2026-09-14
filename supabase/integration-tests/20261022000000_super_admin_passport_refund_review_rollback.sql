-- Local-only runtime proof for migrations 20261021000000 and 20261022000000.
--
-- Run only against a fresh disposable local Supabase database after the full
-- migration chain. Every fixture identity below is synthetic and this file
-- rolls back unconditionally. It never invokes a provider or linked project.
BEGIN;

CREATE OR REPLACE FUNCTION public.psp9_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PSP9 assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.psp9_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp9_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.psp9_assert(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp9_link(p_person_id uuid, p_auth_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', true, now());
$function$;
ALTER FUNCTION public.psp9_link(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp9_link(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp9_link(uuid, uuid) TO authenticated;

-- Fixture-only setup reaches reserved plus a real receipt row. The real
-- service-only confirmation function below is still what writes the refund
-- audit and transitions the refund request/Passport to their terminal state.
CREATE OR REPLACE FUNCTION public.psp9_set_reserved_with_receipt(
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
  UPDATE public.self_service_event_passports AS passport
     SET state = 'reserved', paid_at = now(), updated_at = now()
   WHERE passport.event_id = p_event_id;
  UPDATE public.self_service_event_passport_payment_attempts AS attempt
     SET provider_session_id = p_provider_session_id, state = 'confirmed', updated_at = now()
   WHERE attempt.id = p_attempt_id;
  INSERT INTO public.self_service_event_passport_payment_receipt_audit (
    provider_event_id, provider_session_id, event_id, attempt_id
  ) VALUES (
    p_provider_event_id, p_provider_session_id, p_event_id, p_attempt_id
  ) RETURNING id INTO v_receipt_id;
  RETURN v_receipt_id;
END;
$function$;
ALTER FUNCTION public.psp9_set_reserved_with_receipt(uuid, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp9_set_reserved_with_receipt(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Invoker-security probes: they preserve the current caller's database role,
-- so they prove authenticated non-SA and anon execute denial directly.
CREATE OR REPLACE FUNCTION public.psp9_try_review(p_filter text)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM * FROM public.list_self_service_event_passport_refund_review(p_filter);
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$function$;
ALTER FUNCTION public.psp9_try_review(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp9_try_review(text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp9_try_review(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.psp9_review_shape_is_minimal()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT p.proargnames = ARRAY[
    'p_filter', 'request_id', 'event_id', 'event_name', 'requested_at',
    'completed_at', 'request_state', 'review_status'
  ]
  FROM pg_proc AS p
  WHERE p.oid = 'public.list_self_service_event_passport_refund_review(text)'::regprocedure;
$function$;
ALTER FUNCTION public.psp9_review_shape_is_minimal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp9_review_shape_is_minimal() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp9_review_shape_is_minimal() TO authenticated;

DO $fixture_users$
DECLARE
  v_dana_person uuid;
  v_riley_person uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id IN (
      '9eea0000-0000-4000-8000-000000000001',
      '9eea0000-0000-4000-8000-000000000002',
      '9eea0000-0000-4000-8000-000000000003'
    )
  ) THEN
    RAISE EXCEPTION 'PSP9 fixture identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('9eea0000-0000-4000-8000-000000000001', 'psp9-dana@fixture.invalid', now()),
    ('9eea0000-0000-4000-8000-000000000002', 'psp9-riley@fixture.invalid', now()),
    ('9eea0000-0000-4000-8000-000000000003', 'psp9-admin@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_dana_person;
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_riley_person;
  PERFORM public.psp9_link(v_dana_person, '9eea0000-0000-4000-8000-000000000001');
  PERFORM public.psp9_link(v_riley_person, '9eea0000-0000-4000-8000-000000000002');

  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('psp9-admin@fixture.invalid', '9eea0000-0000-4000-8000-000000000003', true, true, 'super_admin');
END;
$fixture_users$;

-- Dana owns Event A. Its real service-only confirmation produces the
-- audit-backed refunded state used by both reader proofs.
SET LOCAL ROLE authenticated;
DO $dana_refunded_setup$
DECLARE
  v_draft record;
  v_attempt record;
  v_receipt_id uuid;
  v_request record;
  v_confirmation record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9eea0000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_draft FROM public.create_self_service_organizer_draft(
    'PSP9 Dana Organization', 'PSP9 Refunded Event', current_date + 7, 'UTC',
    '9eea1000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp9_assert(v_draft.outcome = 'created', 'Dana draft is created');
  SELECT * INTO v_attempt FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_draft.event_id, '9eea1000-0000-4000-8000-000000000002'
  );
  PERFORM public.psp9_assert(v_attempt.outcome = 'prepared', 'Dana checkout attempt is prepared');

  SET LOCAL ROLE postgres;
  SELECT public.psp9_set_reserved_with_receipt(
    v_draft.event_id, v_attempt.attempt_id, 'cs_fixture_psp9_a', 'evt_fixture_psp9_payment_a'
  ) INTO v_receipt_id;
  SET LOCAL ROLE authenticated;

  PERFORM set_config('request.jwt.claim.sub', '9eea0000-0000-4000-8000-000000000003', true);
  SELECT * INTO v_request FROM public.prepare_self_service_event_passport_refund_request(
    v_draft.event_id, '9eea1000-0000-4000-8000-000000000003'
  );
  PERFORM public.psp9_assert(v_request.outcome = 'requested', 'Dana refund request is created');

  SET LOCAL ROLE service_role;
  SELECT * INTO v_confirmation FROM public.confirm_self_service_event_passport_refund(
    v_request.request_id, 're_fixture_psp9_a', 'evt_fixture_psp9_refund_a'
  );
  SET LOCAL ROLE authenticated;
  PERFORM public.psp9_assert(v_confirmation.outcome = 'confirmed', 'Dana refund is confirmed through the governed service-only function');

  PERFORM set_config('request.jwt.claim.sub', '9eea0000-0000-4000-8000-000000000001', true);
  PERFORM set_config('psp9.refunded_event', v_draft.event_id::text, true);
  PERFORM set_config('psp9.refunded_request', v_request.request_id::text, true);
END;
$dana_refunded_setup$;

-- Riley owns Event B. Its genuine governed request intentionally remains
-- requested, yielding the independent pending review row.
DO $riley_pending_setup$
DECLARE
  v_draft record;
  v_attempt record;
  v_request record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9eea0000-0000-4000-8000-000000000002', true);
  SELECT * INTO v_draft FROM public.create_self_service_organizer_draft(
    'PSP9 Riley Organization', 'PSP9 Pending Event', current_date + 8, 'UTC',
    '9eea1000-0000-4000-8000-000000000004', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp9_assert(v_draft.outcome = 'created', 'Riley draft is created');
  SELECT * INTO v_attempt FROM public.prepare_self_service_event_passport_checkout_attempt(
    v_draft.event_id, '9eea1000-0000-4000-8000-000000000005'
  );
  PERFORM public.psp9_assert(v_attempt.outcome = 'prepared', 'Riley checkout attempt is prepared');

  SET LOCAL ROLE postgres;
  PERFORM public.psp9_set_reserved_with_receipt(
    v_draft.event_id, v_attempt.attempt_id, 'cs_fixture_psp9_b', 'evt_fixture_psp9_payment_b'
  );
  SET LOCAL ROLE authenticated;

  PERFORM set_config('request.jwt.claim.sub', '9eea0000-0000-4000-8000-000000000003', true);
  SELECT * INTO v_request FROM public.prepare_self_service_event_passport_refund_request(
    v_draft.event_id, '9eea1000-0000-4000-8000-000000000006'
  );
  PERFORM public.psp9_assert(v_request.outcome = 'requested', 'Riley refund request is genuinely pending');
  PERFORM set_config('psp9.pending_event', v_draft.event_id::text, true);
  PERFORM set_config('psp9.pending_request', v_request.request_id::text, true);
END;
$riley_pending_setup$;

-- Owner-facing reader: after real confirmation, the original owner sees the
-- new refunded discriminator rather than the misleading not_confirmed path.
DO $owner_confirmation$
DECLARE
  v_outcome text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9eea0000-0000-4000-8000-000000000001', true);
  SELECT outcome INTO v_outcome
  FROM public.get_my_self_service_event_passport_confirmation(current_setting('psp9.refunded_event')::uuid);
  PERFORM public.psp9_assert(v_outcome = 'refunded', 'the actual owner sees refunded after governed refund confirmation');
END;
$owner_confirmation$;

-- Super-Admin review reader: prove classifications, filtering, privacy
-- shape, and direct-table-denial from its actual local database definition.
DO $super_admin_review$
DECLARE
  v_refunded_request uuid := current_setting('psp9.refunded_request')::uuid;
  v_pending_request uuid := current_setting('psp9.pending_request')::uuid;
  v_all_count integer;
  v_pending_count integer;
  v_refunded_count integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9eea0000-0000-4000-8000-000000000003', true);
  PERFORM public.psp9_assert(public.psp9_review_shape_is_minimal(), 'review RPC exposes only the documented minimal columns');

  SELECT count(*)::integer INTO v_all_count
  FROM public.list_self_service_event_passport_refund_review('all') AS review
  WHERE review.request_id IN (v_refunded_request, v_pending_request);
  PERFORM public.psp9_assert(v_all_count = 2, 'all retains both pending and audit-backed refunded requests');

  SELECT count(*)::integer INTO v_pending_count
  FROM public.list_self_service_event_passport_refund_review('pending') AS review
  WHERE review.request_id = v_pending_request AND review.review_status = 'pending';
  PERFORM public.psp9_assert(v_pending_count = 1, 'pending includes the genuine requested row');
  PERFORM public.psp9_assert(
    NOT EXISTS (SELECT 1 FROM public.list_self_service_event_passport_refund_review('pending') AS review WHERE review.request_id = v_refunded_request),
    'pending excludes the audit-backed refunded row'
  );

  SELECT count(*)::integer INTO v_refunded_count
  FROM public.list_self_service_event_passport_refund_review('refunded') AS review
  WHERE review.request_id = v_refunded_request
    AND review.review_status = 'refunded'
    AND review.completed_at IS NOT NULL;
  PERFORM public.psp9_assert(v_refunded_count = 1, 'refunded includes exactly the audit-backed completed row');
  PERFORM public.psp9_assert(
    NOT EXISTS (SELECT 1 FROM public.list_self_service_event_passport_refund_review('refunded') AS review WHERE review.request_id = v_pending_request),
    'refunded excludes the genuine requested row'
  );

  PERFORM public.psp9_assert(
    NOT has_table_privilege('authenticated', 'public.self_service_event_passport_refund_requests', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.self_service_event_passport_refund_requests', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.self_service_event_passport_refund_audit', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.self_service_event_passport_refund_audit', 'SELECT'),
    'review reader adds no direct browser table SELECT privilege'
  );
END;
$super_admin_review$;

-- A non-SA authenticated owner is rejected by the canonical platform gate.
DO $non_super_admin_denied$
DECLARE
  v_result text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9eea0000-0000-4000-8000-000000000001', true);
  SELECT public.psp9_try_review('all') INTO v_result;
  PERFORM public.psp9_assert(v_result = 'P0001', format('non-Super-Admin review call is denied (got %L)', v_result));
END;
$non_super_admin_denied$;

SET LOCAL ROLE anon;
DO $anon_denied$
DECLARE
  v_result text;
BEGIN
  SELECT public.psp9_try_review('all') INTO v_result;
  PERFORM set_config('psp9.anon_result', v_result, true);
END;
$anon_denied$;
SET LOCAL ROLE authenticated;
DO $anon_assertion$
BEGIN
  PERFORM public.psp9_assert(
    current_setting('psp9.anon_result') = '42501',
    format('anon has no execute on the review reader (got %L)', current_setting('psp9.anon_result'))
  );
END;
$anon_assertion$;

SET LOCAL ROLE postgres;
ROLLBACK;
