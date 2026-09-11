-- Private Event Passport entitlement foundation -- linked-database behavior
-- proof. Provider-independent: no Stripe/webhook/checkout call, no money
-- movement.
--
-- Run only after every migration through 20261012000000 has been applied.
-- Creates isolated auth + identity rows, exercises the governed RPCs as the
-- authenticated browser role (and one direct anon/authenticated write
-- attempt against the raw table), and rolls everything back. NOT executed
-- as part of this implementation task -- proof-of-shape only, per this
-- repository's established convention for behavioral fixtures.
--
-- Since no governed RPC in this slice creates a self_service_event_passports
-- row (creation/transition to reserved/active/expired belongs to the
-- Stripe-checkout-and-webhook slice next in the contract's delivery
-- sequence), this fixture sets up each Passport state directly as postgres
-- -- exactly the established pattern this repository already uses when a
-- row's governed creation path genuinely belongs to a later phase (e.g.
-- P-2D.1's own forced-rollback proof inserting a real FK-blocking row
-- directly). The one exception is the payment_pending row's REMOVAL, which
-- IS governed in this slice (Lun's correction) -- exercised below through
-- the ordinary Delete and Replace commands themselves, never inserted
-- directly.
--
-- It proves:
--   1. an ordinary unpaid draft (no Passport row) behaves exactly as before
--      -- counts against capacity, remains ordinarily deletable;
--   2. a payment_pending Passport still counts against capacity, and a
--      direct standalone Delete of that Event succeeds AND removes exactly
--      its own payment_pending Passport row -- "a checkout that is merely
--      pending still consumes that slot... grants no entitlement";
--   3. an atomic Replace of a payment_pending Event also succeeds -- the old
--      Event and its payment_pending Passport row are both gone, and the new
--      Event carries no Passport row of its own;
--   4. a reserved Passport frees the one-unpaid-event slot, letting the SAME
--      organizer immediately create a new ordinary draft;
--   5. a reserved Passport Event is rejected by both the standalone Delete
--      command and the atomic Replace command, with zero mutation, the SAME
--      non-enumerating 'Event not found.' used for every other ineligible
--      Event, and its reserved Passport row completely intact after BOTH
--      rejected attempts -- never deleted, never touched;
--   6. active and expired Passports behave identically to reserved for
--      capacity, for BOTH Delete and Replace eligibility, and for their
--      Passport rows staying completely intact after rejection;
--   7. events.status / events.is_active / events.visible_to_members are
--      completely unchanged by Passport state at every step -- no Event
--      lifecycle/status/visibility field ever becomes an entitlement proxy;
--   8. an authenticated (non-owner) caller cannot delete or replace another
--      organizer's Event, preserved or not -- the same non-enumerating
--      denial either way;
--   9. neither the anon nor the authenticated role can write to
--      self_service_event_passports directly -- confirmed by an actual
--      rejected INSERT attempt in each role, not merely absent UI;
--   10. an ordinary FCOC/platform-Tenant Event, and its admin/authority
--       rows, are completely untouched by any of the above.

BEGIN;

CREATE OR REPLACE FUNCTION public.psp_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Passport entitlement fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.psp_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.psp_assert(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp_link(p_person_id uuid, p_auth_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', true, now());
$function$;
ALTER FUNCTION public.psp_link(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp_link(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp_link(uuid, uuid) TO authenticated;

-- Fixture-only: directly sets a Passport row's state, bypassing any governed
-- RPC (none exists yet in this slice to CREATE one). Mirrors the established
-- "insert a real row directly to construct a scenario the current phase
-- cannot yet create through its own governed command" pattern. Never used to
-- remove a row -- removal is exercised only through the governed Delete/
-- Replace commands themselves below.
CREATE OR REPLACE FUNCTION public.psp_set_passport(
  p_event_id uuid,
  p_state text,
  p_paid_at timestamptz,
  p_active_started_at timestamptz,
  p_active_ends_at timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.self_service_event_passports (
    event_id, state, paid_at, active_period_started_at, active_period_ends_at
  ) VALUES (
    p_event_id, p_state, p_paid_at, p_active_started_at, p_active_ends_at
  );
$function$;
ALTER FUNCTION public.psp_set_passport(uuid, text, timestamptz, timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp_set_passport(uuid, text, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.psp_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.psp_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp_event_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp_event_exists(uuid) TO authenticated;

-- Lun's correction proof: the Passport row's own state (or NULL if no row),
-- read directly -- used to confirm a payment_pending row is actually GONE
-- after a successful Delete/Replace, and that a reserved/active/expired row
-- is completely UNCHANGED after a rejected one.
CREATE OR REPLACE FUNCTION public.psp_passport_state(p_event_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT p.state FROM public.self_service_event_passports AS p WHERE p.event_id = p_event_id;
$function$;
ALTER FUNCTION public.psp_passport_state(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp_passport_state(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp_passport_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp_event_lifecycle_columns(p_event_id uuid)
RETURNS TABLE(status text, is_active boolean, visible_to_members boolean)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT e.status, e.is_active, e.visible_to_members FROM public.events AS e WHERE e.id = p_event_id;
$function$;
ALTER FUNCTION public.psp_event_lifecycle_columns(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp_event_lifecycle_columns(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.psp_event_lifecycle_columns(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.psp_try_insert_passport_as_caller(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  INSERT INTO public.self_service_event_passports (event_id, state, paid_at)
  VALUES (p_event_id, 'reserved', now());
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$function$;
ALTER FUNCTION public.psp_try_insert_passport_as_caller(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psp_try_insert_passport_as_caller(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.psp_try_insert_passport_as_caller(uuid) TO anon, authenticated;

DO $setup$
DECLARE
  v_person uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id IN (
      '9ee00000-0000-4000-8000-000000000001',
      '9ee00000-0000-4000-8000-000000000002',
      '9ee00000-0000-4000-8000-000000000003',
      '9ee00000-0000-4000-8000-000000000004',
      '9ee00000-0000-4000-8000-000000000005',
      '9ee00000-0000-4000-8000-000000000006'
    )
  ) THEN
    RAISE EXCEPTION 'Passport entitlement fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('9ee00000-0000-4000-8000-000000000001', 'psp-alice@fixture.invalid', now()),
    ('9ee00000-0000-4000-8000-000000000002', 'psp-ben@fixture.invalid', now()),
    ('9ee00000-0000-4000-8000-000000000003', 'psp-carol@fixture.invalid', now()),
    ('9ee00000-0000-4000-8000-000000000004', 'psp-dana@fixture.invalid', now()),
    ('9ee00000-0000-4000-8000-000000000005', 'psp-erin@fixture.invalid', now()),
    ('9ee00000-0000-4000-8000-000000000006', 'psp-frank@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp_link(v_person, '9ee00000-0000-4000-8000-000000000001');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp_link(v_person, '9ee00000-0000-4000-8000-000000000002');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp_link(v_person, '9ee00000-0000-4000-8000-000000000003');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp_link(v_person, '9ee00000-0000-4000-8000-000000000004');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp_link(v_person, '9ee00000-0000-4000-8000-000000000005');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.psp_link(v_person, '9ee00000-0000-4000-8000-000000000006');
END;
$setup$;

-- ===========================================================================
-- 10 (checked first, as a control): an ordinary FCOC/platform Tenant Event
-- and its admin authority row.
-- ===========================================================================
DO $ordinary$
DECLARE
  v_ordinary_tenant uuid;
  v_ordinary_event uuid;
  v_ordinary_admin uuid;
BEGIN
  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title, is_active)
  VALUES ('psp-ordinary-tenant', 'psp-ordinary-tenant', 'PSP Ordinary Tenant', 'PSP Ordinary Tenant', 'PSP Ordinary Tenant', true)
  RETURNING id INTO v_ordinary_tenant;

  INSERT INTO public.events (name, tenant_id, status, is_active, visible_to_members, end_date, timezone)
  VALUES ('PSP Ordinary Event', v_ordinary_tenant, 'Active', true, true, current_date + 7, 'UTC')
  RETURNING id INTO v_ordinary_event;

  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('psp-ordinary-admin@fixture.invalid', '9ee00000-0000-4000-8000-000000000099', true, false, 'event_admin')
  RETURNING id INTO v_ordinary_admin;

  INSERT INTO public.admin_event_access (admin_user_id, event_id, role)
  VALUES (v_ordinary_admin, v_ordinary_event, 'event_admin');

  PERFORM set_config('psp.ordinary_tenant', v_ordinary_tenant::text, true);
  PERFORM set_config('psp.ordinary_event', v_ordinary_event::text, true);
END;
$ordinary$;

SET LOCAL ROLE authenticated;

-- ===========================================================================
-- 1: an ordinary unpaid draft (no Passport row) behaves exactly as before.
-- ===========================================================================
DO $ordinary_draft$
DECLARE
  v_alice record;
  v_cap record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee00000-0000-4000-8000-000000000001', true);

  SELECT * INTO v_alice FROM public.create_self_service_organizer_draft(
    'Alice Org', 'Alice Reunion', current_date + 7, 'UTC',
    '9ee0a000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp_assert(v_alice.outcome = 'created', 'Alice''s ordinary first draft is created');

  SELECT * INTO v_cap FROM public.get_my_self_service_organizer_capacity();
  PERFORM public.psp_assert(
    v_cap.active_unfinished_event_count = 1 AND v_cap.can_start_another_event = false,
    'no Passport row: the ordinary draft counts against capacity exactly as before'
  );

  PERFORM public.psp_assert(
    public.psp_passport_state(v_alice.event_id) IS NULL,
    'Alice''s ordinary draft has no Passport row at all'
  );

  PERFORM set_config('psp.alice_event', v_alice.event_id::text, true);
END;
$ordinary_draft$;

-- ===========================================================================
-- 2: payment_pending still counts, and a direct standalone Delete succeeds
-- AND removes exactly its own payment_pending Passport row (Lun's
-- correction -- this is the runtime-blocking defect being repaired: before
-- the fix, the Passport foreign key plus the generic dependency scan made
-- this Delete abort with "unexpected dependent data in
-- self_service_event_passports").
-- ===========================================================================
DO $payment_pending$
DECLARE
  v_ben record;
  v_cap record;
  v_del record;
  v_lifecycle record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee00000-0000-4000-8000-000000000002', true);

  SELECT * INTO v_ben FROM public.create_self_service_organizer_draft(
    'Ben Org', 'Ben Cookout', current_date + 10, 'UTC',
    '9ee0b000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp_assert(v_ben.outcome = 'created', 'Ben''s ordinary first draft is created');

  SET LOCAL ROLE postgres;
  PERFORM public.psp_set_passport(v_ben.event_id, 'payment_pending', NULL, NULL, NULL);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee00000-0000-4000-8000-000000000002', true);

  SELECT * INTO v_cap FROM public.get_my_self_service_organizer_capacity();
  PERFORM public.psp_assert(
    v_cap.active_unfinished_event_count = 1 AND v_cap.can_start_another_event = false,
    'payment_pending still consumes the one-unpaid-event slot -- grants no entitlement'
  );

  -- events.status/is_active/visible_to_members are untouched by the
  -- payment_pending Passport row's mere existence.
  SELECT * INTO v_lifecycle FROM public.psp_event_lifecycle_columns(v_ben.event_id);
  PERFORM public.psp_assert(
    v_lifecycle.status = 'Draft' AND v_lifecycle.is_active = false AND v_lifecycle.visible_to_members = false,
    'a payment_pending Passport changes no Event lifecycle/status/visibility column'
  );

  -- payment_pending remains ordinarily deletable -- and the Delete itself
  -- (not any direct fixture write) removes the pending Passport row.
  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_ben.event_id, '9ee0b000-0000-4000-8000-000000000002'
  );
  PERFORM public.psp_assert(v_del.outcome = 'deleted', 'a payment_pending Event remains ordinarily deletable');
  PERFORM public.psp_assert(NOT public.psp_event_exists(v_ben.event_id), 'Ben''s payment_pending Event is gone after ordinary delete');
  PERFORM public.psp_assert(
    public.psp_passport_state(v_ben.event_id) IS NULL,
    'Ben''s payment_pending Passport row is gone too -- the governed Delete removed exactly it, not a database cascade'
  );
END;
$payment_pending$;

-- ===========================================================================
-- 3: an atomic Replace of a payment_pending Event also succeeds -- Replace
-- inherits Lun's correction purely by delegating to the governed Delete.
-- ===========================================================================
DO $payment_pending_replace$
DECLARE
  v_frank_first record;
  v_result record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee00000-0000-4000-8000-000000000006', true);

  SELECT * INTO v_frank_first FROM public.create_self_service_organizer_draft(
    'Frank Org', 'Frank Fundraiser', current_date + 12, 'UTC',
    '9ee0f000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp_assert(v_frank_first.outcome = 'created', 'Frank''s ordinary first draft is created');

  SET LOCAL ROLE postgres;
  PERFORM public.psp_set_passport(v_frank_first.event_id, 'payment_pending', NULL, NULL, NULL);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee00000-0000-4000-8000-000000000006', true);

  SELECT * INTO v_result FROM public.replace_self_service_organizer_event(
    v_frank_first.event_id, 'Frank New Org', 'Frank New Fundraiser', current_date + 40, 'UTC',
    '9ee0f000-0000-4000-8000-000000000002', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp_assert(v_result.outcome = 'replaced', 'a payment_pending Event can be atomically replaced');
  PERFORM public.psp_assert(v_result.deleted_event_id = v_frank_first.event_id, 'the reported deleted_event_id is Frank''s old (payment_pending) Event');
  PERFORM public.psp_assert(NOT public.psp_event_exists(v_frank_first.event_id), 'Frank''s old payment_pending Event is gone');
  PERFORM public.psp_assert(
    public.psp_passport_state(v_frank_first.event_id) IS NULL,
    'Frank''s old payment_pending Passport row is gone -- removed by the delegated governed Delete'
  );
  PERFORM public.psp_assert(
    public.psp_passport_state(v_result.event_id) IS NULL,
    'Frank''s new (replacement) Event carries no Passport row of its own'
  );
END;
$payment_pending_replace$;

-- ===========================================================================
-- 4-5: reserved frees the slot (letting the SAME organizer create another),
-- and blocks both standalone Delete and atomic Replace with zero mutation --
-- and the reserved Passport row itself is completely untouched by either
-- rejected attempt.
-- ===========================================================================
DO $reserved$
DECLARE
  v_carol_first record;
  v_carol_second record;
  v_cap record;
  v_lifecycle record;
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9ee00000-0000-4000-8000-000000000003', true);

  SELECT * INTO v_carol_first FROM public.create_self_service_organizer_draft(
    'Carol Org', 'Carol Gala', current_date + 14, 'UTC',
    '9ee0c000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp_assert(v_carol_first.outcome = 'created', 'Carol''s ordinary first draft is created');

  SELECT * INTO v_cap FROM public.get_my_self_service_organizer_capacity();
  PERFORM public.psp_assert(v_cap.can_start_another_event = false, 'Carol is at capacity before her Passport is reserved');

  SET LOCAL ROLE postgres;
  PERFORM public.psp_set_passport(v_carol_first.event_id, 'reserved', now(), NULL, NULL);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee00000-0000-4000-8000-000000000003', true);

  -- events.status/is_active/visible_to_members are untouched by reservation.
  SELECT * INTO v_lifecycle FROM public.psp_event_lifecycle_columns(v_carol_first.event_id);
  PERFORM public.psp_assert(
    v_lifecycle.status = 'Draft' AND v_lifecycle.is_active = false AND v_lifecycle.visible_to_members = false,
    'a reserved Passport changes no Event lifecycle/status/visibility column -- still private, Draft, inactive, pre-launch'
  );

  -- Capacity is freed.
  SELECT * INTO v_cap FROM public.get_my_self_service_organizer_capacity();
  PERFORM public.psp_assert(
    v_cap.active_unfinished_event_count = 0 AND v_cap.can_start_another_event = true,
    'a reserved Passport frees the one-unpaid-event slot'
  );

  -- The reserved Event cannot be ordinarily deleted.
  v_failed := false;
  BEGIN
    PERFORM public.delete_self_service_organizer_event(
      v_carol_first.event_id, '9ee0c000-0000-4000-8000-000000000002'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp_assert(v_failed, 'a reserved Passport Event is rejected by standalone Delete, non-enumerating');
  PERFORM public.psp_assert(public.psp_event_exists(v_carol_first.event_id), 'Carol''s reserved Event still exists after the rejected delete');
  PERFORM public.psp_assert(
    public.psp_passport_state(v_carol_first.event_id) = 'reserved',
    'Carol''s reserved Passport row is completely untouched by the rejected delete -- never deleted, never transitioned'
  );

  -- Nor can it be named as the old Event in an atomic Replace.
  v_failed := false;
  BEGIN
    PERFORM public.replace_self_service_organizer_event(
      v_carol_first.event_id, 'Carol Should Not Get This', 'Carol Should Not Get This', current_date + 20, 'UTC',
      '9ee0c000-0000-4000-8000-000000000003', NULL, 'no_location', NULL, 'casual'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp_assert(v_failed, 'a reserved Passport Event is rejected by atomic Replace, non-enumerating, with zero mutation');
  PERFORM public.psp_assert(public.psp_event_exists(v_carol_first.event_id), 'Carol''s reserved Event still exists after the rejected replace');
  PERFORM public.psp_assert(
    public.psp_passport_state(v_carol_first.event_id) = 'reserved',
    'Carol''s reserved Passport row is completely untouched by the rejected replace either'
  );

  -- The freed slot lets Carol create a NEW ordinary (unpaid) draft.
  SELECT * INTO v_carol_second FROM public.create_self_service_organizer_draft(
    'Carol New Org', 'Carol Second Event', current_date + 25, 'UTC',
    '9ee0c000-0000-4000-8000-000000000004', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp_assert(
    v_carol_second.outcome = 'created' AND v_carol_second.event_id <> v_carol_first.event_id,
    'a reserved Passport lets the SAME organizer begin a new private Event'
  );

  -- Capacity is back to exactly 1 (the new ordinary draft) -- never 0, never 2.
  SELECT * INTO v_cap FROM public.get_my_self_service_organizer_capacity();
  PERFORM public.psp_assert(
    v_cap.active_unfinished_event_count = 1 AND v_cap.can_start_another_event = false,
    'after creating the new draft, capacity is exactly 1 -- the reserved Event never re-counts'
  );
END;
$reserved$;

-- ===========================================================================
-- 6: active and expired behave identically to reserved for capacity AND for
-- BOTH Delete and Replace eligibility, with their Passport rows completely
-- untouched by every rejected attempt.
-- ===========================================================================
DO $active_and_expired$
DECLARE
  v_dana record;
  v_erin record;
  v_cap record;
  v_failed boolean;
BEGIN
  -- Dana: active.
  PERFORM set_config('request.jwt.claim.sub', '9ee00000-0000-4000-8000-000000000004', true);
  SELECT * INTO v_dana FROM public.create_self_service_organizer_draft(
    'Dana Org', 'Dana Conference', current_date + 30, 'UTC',
    '9ee0d000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp_assert(v_dana.outcome = 'created', 'Dana''s ordinary first draft is created');

  SET LOCAL ROLE postgres;
  PERFORM public.psp_set_passport(
    v_dana.event_id, 'active', now() - interval '1 month',
    now() - interval '1 month', now() + interval '11 months'
  );
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee00000-0000-4000-8000-000000000004', true);

  SELECT * INTO v_cap FROM public.get_my_self_service_organizer_capacity();
  PERFORM public.psp_assert(v_cap.can_start_another_event = true, 'an active Passport frees the one-unpaid-event slot exactly like reserved');

  v_failed := false;
  BEGIN
    PERFORM public.delete_self_service_organizer_event(v_dana.event_id, '9ee0d000-0000-4000-8000-000000000002');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp_assert(v_failed, 'an active Passport Event is rejected by standalone Delete');
  PERFORM public.psp_assert(public.psp_event_exists(v_dana.event_id), 'Dana''s active Event still exists');
  PERFORM public.psp_assert(
    public.psp_passport_state(v_dana.event_id) = 'active',
    'Dana''s active Passport row is completely untouched by the rejected delete'
  );

  v_failed := false;
  BEGIN
    PERFORM public.replace_self_service_organizer_event(
      v_dana.event_id, 'Dana Should Not Get This', 'Dana Should Not Get This', current_date + 45, 'UTC',
      '9ee0d000-0000-4000-8000-000000000003', NULL, 'no_location', NULL, 'casual'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp_assert(v_failed, 'an active Passport Event is rejected by atomic Replace too, non-enumerating, with zero mutation');
  PERFORM public.psp_assert(public.psp_event_exists(v_dana.event_id), 'Dana''s active Event still exists after the rejected replace');
  PERFORM public.psp_assert(
    public.psp_passport_state(v_dana.event_id) = 'active',
    'Dana''s active Passport row is completely untouched by the rejected replace either'
  );

  -- Erin: expired.
  PERFORM set_config('request.jwt.claim.sub', '9ee00000-0000-4000-8000-000000000005', true);
  SELECT * INTO v_erin FROM public.create_self_service_organizer_draft(
    'Erin Org', 'Erin Workshop', current_date + 35, 'UTC',
    '9ee0e000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.psp_assert(v_erin.outcome = 'created', 'Erin''s ordinary first draft is created');

  SET LOCAL ROLE postgres;
  PERFORM public.psp_set_passport(
    v_erin.event_id, 'expired', now() - interval '13 months',
    now() - interval '13 months', now() - interval '1 month'
  );
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '9ee00000-0000-4000-8000-000000000005', true);

  SELECT * INTO v_cap FROM public.get_my_self_service_organizer_capacity();
  PERFORM public.psp_assert(v_cap.can_start_another_event = true, 'an expired Passport frees the one-unpaid-event slot exactly like reserved');

  v_failed := false;
  BEGIN
    PERFORM public.delete_self_service_organizer_event(v_erin.event_id, '9ee0e000-0000-4000-8000-000000000002');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp_assert(v_failed, 'an expired Passport Event is rejected by standalone Delete');
  PERFORM public.psp_assert(public.psp_event_exists(v_erin.event_id), 'Erin''s expired Event still exists');
  PERFORM public.psp_assert(
    public.psp_passport_state(v_erin.event_id) = 'expired',
    'Erin''s expired Passport row is completely untouched by the rejected delete'
  );

  v_failed := false;
  BEGIN
    PERFORM public.replace_self_service_organizer_event(
      v_erin.event_id, 'Erin Should Not Get This', 'Erin Should Not Get This', current_date + 50, 'UTC',
      '9ee0e000-0000-4000-8000-000000000003', NULL, 'no_location', NULL, 'casual'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp_assert(v_failed, 'an expired Passport Event is rejected by atomic Replace too, non-enumerating, with zero mutation');
  PERFORM public.psp_assert(public.psp_event_exists(v_erin.event_id), 'Erin''s expired Event still exists after the rejected replace');
  PERFORM public.psp_assert(
    public.psp_passport_state(v_erin.event_id) = 'expired',
    'Erin''s expired Passport row is completely untouched by the rejected replace either'
  );

  PERFORM set_config('psp.dana_event', v_dana.event_id::text, true);
END;
$active_and_expired$;

-- ===========================================================================
-- 8: a non-owner cannot delete or replace another organizer's Event, whether
-- ordinary or Passport-preserved -- same non-enumerating denial either way.
-- ===========================================================================
DO $cross_owner$
DECLARE
  v_dana_event uuid;
  v_failed boolean;
BEGIN
  v_dana_event := current_setting('psp.dana_event')::uuid;

  -- Carol (a different organizer entirely) attempts to delete Dana's
  -- (active, Passport-preserved) Event.
  PERFORM set_config('request.jwt.claim.sub', '9ee00000-0000-4000-8000-000000000003', true);
  v_failed := false;
  BEGIN
    PERFORM public.delete_self_service_organizer_event(v_dana_event, '9ee0c000-0000-4000-8000-000000000099');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.psp_assert(v_failed, 'a non-owner cannot delete another organizer''s Passport-preserved Event');
  PERFORM public.psp_assert(public.psp_event_exists(v_dana_event), 'Dana''s Event still exists after Carol''s unauthorized attempt');
END;
$cross_owner$;

-- ===========================================================================
-- 9: neither anon nor authenticated can write to self_service_event_passports
-- directly -- an actual rejected INSERT, not merely an absent UI control.
-- ===========================================================================
DO $no_browser_write$
DECLARE
  v_alice_event uuid;
  v_result text;
BEGIN
  v_alice_event := current_setting('psp.alice_event')::uuid;

  PERFORM set_config('request.jwt.claim.sub', '9ee00000-0000-4000-8000-000000000001', true);
  SELECT public.psp_try_insert_passport_as_caller(v_alice_event) INTO v_result;
  PERFORM public.psp_assert(
    v_result = '42501',
    format('authenticated cannot write self_service_event_passports directly (got %L)', v_result)
  );
END;
$no_browser_write$;

-- Lun's correction: psp_assert is executable only by authenticated, so it
-- cannot be called while anon remains the active role. The attempted direct
-- mutation itself must still run genuinely AS anon -- only the assertion of
-- its outcome needs an authorized role. This block performs the mutation
-- attempt as anon and hands its result to the next block through
-- set_config/current_setting (an ordinary built-in callable by any role,
-- and the same transaction-scoped cross-block mechanism this fixture
-- already uses throughout -- e.g. psp.alice_event, psp.dana_event); it never
-- widens psp_assert's own grants and never touches the migration.
SET LOCAL ROLE anon;
DO $no_browser_write_anon_attempt$
DECLARE
  v_alice_event uuid;
  v_result text;
BEGIN
  v_alice_event := current_setting('psp.alice_event')::uuid;
  SELECT public.psp_try_insert_passport_as_caller(v_alice_event) INTO v_result;
  PERFORM set_config('psp.anon_write_result', v_result, true);
END;
$no_browser_write_anon_attempt$;

-- Restore a role authorized to execute psp_assert BEFORE asserting on the
-- anon attempt's result -- the mutation attempt above already ran entirely
-- as anon; only its outcome is checked here.
SET LOCAL ROLE authenticated;
DO $no_browser_write_anon_assert$
BEGIN
  PERFORM public.psp_assert(
    current_setting('psp.anon_write_result') = '42501',
    format(
      'anon cannot write self_service_event_passports directly (got %L)',
      current_setting('psp.anon_write_result')
    )
  );
END;
$no_browser_write_anon_assert$;
SET LOCAL ROLE postgres;

-- ===========================================================================
-- 10 (verified last): the ordinary FCOC/platform Tenant Event and its admin
-- authority row are completely unaffected by everything above.
-- ===========================================================================
DO $ordinary_check$
BEGIN
  PERFORM public.psp_assert(
    public.psp_event_exists(current_setting('psp.ordinary_event')::uuid),
    'the ordinary platform Event is untouched'
  );
END;
$ordinary_check$;

SET LOCAL ROLE postgres;

ROLLBACK;
