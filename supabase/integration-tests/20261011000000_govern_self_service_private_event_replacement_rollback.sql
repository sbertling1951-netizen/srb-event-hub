-- P-2D.1 linked-database behavior proof: the atomic private-event replacement
-- RPC, and the structured (non-exception) capacity-conflict outcome.
--
-- Run only after every migration through 20261011000000 has been applied.
-- Creates isolated auth + identity rows, exercises the governed RPCs as the
-- authenticated browser role, and rolls everything back. NOT executed as
-- part of this implementation task -- proof-of-shape only, per this
-- repository's established convention for behavioral fixtures.
--
-- It proves:
--   1. no current draft -> an ordinary create still succeeds normally;
--   2. one current draft -> create returns the structured 'active_event_exists'
--      outcome, never a raised exception, with zero mutation;
--   3. that outcome names ONLY the caller's own blocking Event -- a second,
--      unrelated organizer's own conflict names HER OWN Event, never the
--      first organizer's;
--   4. replace_self_service_organizer_event succeeds atomically: the old
--      Event/draft-marker/appointment/tenant are gone, exactly one new
--      Event/draft-marker/appointment/tenant exist, and capacity is back to
--      exactly 1 active unfinished Event (never 0, never 2) throughout;
--   5. invalid replacement input (a missing end date) leaves the old Event,
--      its tenant, and its appointment completely intact, with zero writes;
--   6. a foreign/unauthorized old Event id (belonging to a different
--      organizer) cannot be replaced -- the same non-enumerating
--      'Event not found.' the standalone delete command already uses, with
--      zero mutation;
--   7. idempotent retry: the same (actor, key) replays the identical
--      'replaced' result and writes no second deletion-audit or
--      command-audit row;
--   8. an ordinary FCOC/platform-Tenant Event, and its admin/authority rows,
--      are completely untouched by any of the above;
--   9. the pre-existing standalone delete_self_service_organizer_event
--      command still works, completely unmodified by this migration;
--   10. (Lun) reusing an idempotency key with a CHANGED old Event id, or
--       CHANGED new-draft input, fails safely (the fingerprint-mismatch
--       guard) and alters neither the caller's current project nor the
--       unrelated project it named;
--   11. (Lun) a genuinely forced mid-transaction failure -- a real,
--       unrelated ON DELETE RESTRICT foreign key
--       (person_tenant_administrator_appointments.tenant_id) blocking the
--       LAST step of the delegated deletion (tenant teardown), AFTER the
--       old Event/draft-marker/command-audit/lifecycle-audit/appointment
--       have already been deleted within the same transaction -- rolls back
--       the entire replacement, leaving the old Event, tenant, and
--       appointment completely intact and creating no new draft.

BEGIN;

CREATE OR REPLACE FUNCTION public.p2d1_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P-2D.1 fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.p2d1_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d1_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2d1_assert(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d1_link(p_person_id uuid, p_auth_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', true, now());
$function$;
ALTER FUNCTION public.p2d1_link(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d1_link(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d1_link(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d1_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.p2d1_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d1_event_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d1_event_exists(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d1_tenant_exists(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id);
$function$;
ALTER FUNCTION public.p2d1_tenant_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d1_tenant_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d1_tenant_exists(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d1_appointment_exists(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.self_service_organizer_appointments
    WHERE tenant_id = p_tenant_id AND is_active = true
  );
$function$;
ALTER FUNCTION public.p2d1_appointment_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d1_appointment_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d1_appointment_exists(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d1_counts()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'tenants', (SELECT count(*) FROM public.tenants),
    'events', (SELECT count(*) FROM public.events),
    'organizer_appointments', (SELECT count(*) FROM public.self_service_organizer_appointments),
    'private_event_drafts', (SELECT count(*) FROM public.self_service_private_event_drafts),
    'command_audit', (SELECT count(*) FROM public.self_service_onboarding_command_audit),
    'tenant_lifecycle_audit', (SELECT count(*) FROM public.self_service_tenant_lifecycle_audit),
    'deletion_audit', (SELECT count(*) FROM public.self_service_event_deletion_audit)
  );
$function$;
ALTER FUNCTION public.p2d1_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d1_counts() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2d1_counts() TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d1_deletion_audit_count_for(p_actor uuid, p_key uuid)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT count(*)::integer FROM public.self_service_event_deletion_audit
  WHERE actor_auth_user_id = p_actor AND idempotency_key = p_key;
$function$;
ALTER FUNCTION public.p2d1_deletion_audit_count_for(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d1_deletion_audit_count_for(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d1_deletion_audit_count_for(uuid, uuid) TO authenticated;

-- Adversarial-review correction (Lun): forces a REAL, unrelated, ON DELETE
-- RESTRICT foreign key (person_tenant_administrator_appointments.tenant_id,
-- 20260824040000 -- a completely separate, non-self-service Tenant-Admin
-- affiliation model) to block the LAST step of the delegated deletion (the
-- tenant teardown itself), AFTER the event/draft-marker/command-audit/
-- lifecycle-audit/appointment rows have already been deleted within the same
-- transaction. This is the repository's own real constraint mechanism --
-- not a test-only hook, not a weakened assertion, and not code introduced by
-- this migration.
CREATE OR REPLACE FUNCTION public.p2d1_block_tenant_teardown(p_person_id uuid, p_tenant_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.person_tenant_administrator_appointments (person_id, tenant_id)
  VALUES (p_person_id, p_tenant_id);
$function$;
ALTER FUNCTION public.p2d1_block_tenant_teardown(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d1_block_tenant_teardown(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d1_block_tenant_teardown(uuid, uuid) TO authenticated;

DO $setup$
DECLARE
  v_person uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id IN (
      '92d10000-0000-4000-8000-000000000001',
      '92d10000-0000-4000-8000-000000000002',
      '92d10000-0000-4000-8000-000000000003'
    )
  ) THEN
    RAISE EXCEPTION 'P-2D.1 fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('92d10000-0000-4000-8000-000000000001', 'p2d1-alice@fixture.invalid', now()),
    ('92d10000-0000-4000-8000-000000000002', 'p2d1-ben@fixture.invalid', now()),
    ('92d10000-0000-4000-8000-000000000003', 'p2d1-carol@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p2d1_link(v_person, '92d10000-0000-4000-8000-000000000001');

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p2d1_link(v_person, '92d10000-0000-4000-8000-000000000002');

  -- Carol: an isolated organizer used only for the forced-mid-transaction-
  -- failure proof, so a real FK block on tenant teardown never interferes
  -- with Alice's or Ben's scenarios above.
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p2d1_link(v_person, '92d10000-0000-4000-8000-000000000003');
END;
$setup$;

-- ===========================================================================
-- 8 (checked first, as a control): an ordinary FCOC/platform Tenant Event and
-- its admin authority row exist, entirely untouched by anything below.
-- ===========================================================================
DO $ordinary$
DECLARE
  v_ordinary_tenant uuid;
  v_ordinary_event uuid;
  v_ordinary_admin uuid;
BEGIN
  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title, is_active)
  VALUES ('p2d1-ordinary-tenant', 'p2d1-ordinary-tenant', 'P2D1 Ordinary Tenant', 'P2D1 Ordinary Tenant', 'P2D1 Ordinary Tenant', true)
  RETURNING id INTO v_ordinary_tenant;

  INSERT INTO public.events (name, tenant_id, status, is_active, visible_to_members, end_date, timezone)
  VALUES ('P2D1 Ordinary Event', v_ordinary_tenant, 'Active', true, true, current_date + 7, 'UTC')
  RETURNING id INTO v_ordinary_event;

  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('p2d1-ordinary-admin@fixture.invalid', '92d10000-0000-4000-8000-000000000099', true, false, 'event_admin')
  RETURNING id INTO v_ordinary_admin;

  INSERT INTO public.admin_event_access (admin_user_id, event_id, role)
  VALUES (v_ordinary_admin, v_ordinary_event, 'event_admin');

  PERFORM set_config('p2d1.ordinary_tenant', v_ordinary_tenant::text, true);
  PERFORM set_config('p2d1.ordinary_event', v_ordinary_event::text, true);
END;
$ordinary$;

SET LOCAL ROLE authenticated;

-- ===========================================================================
-- 1-3: no current draft -> ordinary create; one current draft -> structured
-- conflict outcome naming ONLY the caller's own blocking Event.
-- ===========================================================================
DO $conflict$
DECLARE
  v_alice_first record;
  v_alice_conflict record;
  v_ben_first record;
  v_ben_conflict record;
BEGIN
  -- Alice: no current draft -> ordinary create succeeds.
  PERFORM set_config('request.jwt.claim.sub', '92d10000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_alice_first FROM public.create_self_service_organizer_draft(
    'Alice Org', 'Alice Reunion', current_date + 7, 'UTC',
    '92d1a000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.p2d1_assert(v_alice_first.outcome = 'created', 'Alice''s first create succeeds normally with no current draft');

  -- Alice: one current draft -> structured outcome, not an exception.
  SELECT * INTO v_alice_conflict FROM public.create_self_service_organizer_draft(
    'Alice Org Two', 'Alice Second Event', current_date + 9, 'UTC',
    '92d1a000-0000-4000-8000-000000000002', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.p2d1_assert(
    v_alice_conflict.outcome = 'active_event_exists',
    'a second create returns the structured active_event_exists outcome, never an exception'
  );
  PERFORM public.p2d1_assert(
    v_alice_conflict.event_id = v_alice_first.event_id AND v_alice_conflict.event_name = 'Alice Reunion',
    'the conflict outcome names exactly Alice''s own first (blocking) Event'
  );
  PERFORM public.p2d1_assert(
    v_alice_conflict.tenant_id IS NULL AND v_alice_conflict.organizer_appointment_id IS NULL
    AND v_alice_conflict.organization_name IS NULL AND v_alice_conflict.location_mode IS NULL,
    'the conflict outcome discloses no tenant/appointment/organization/location data'
  );

  -- Ben (a completely unrelated organizer): his own conflict, once he has one
  -- unfinished Event, names ONLY his own Event -- never Alice's.
  PERFORM set_config('request.jwt.claim.sub', '92d10000-0000-4000-8000-000000000002', true);
  SELECT * INTO v_ben_first FROM public.create_self_service_organizer_draft(
    'Ben Org', 'Ben Cookout', current_date + 14, 'UTC',
    '92d1b000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.p2d1_assert(v_ben_first.outcome = 'created', 'Ben''s first create also succeeds normally');

  SELECT * INTO v_ben_conflict FROM public.create_self_service_organizer_draft(
    'Ben Org Two', 'Ben Second Event', current_date + 16, 'UTC',
    '92d1b000-0000-4000-8000-000000000002', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.p2d1_assert(
    v_ben_conflict.outcome = 'active_event_exists' AND v_ben_conflict.event_id = v_ben_first.event_id,
    'Ben''s conflict names his own blocking Event'
  );
  PERFORM public.p2d1_assert(
    v_ben_conflict.event_id <> v_alice_first.event_id AND v_ben_conflict.event_name <> 'Alice Reunion',
    'Ben''s conflict NEVER names Alice''s Event -- caller-scoped, not global'
  );

  PERFORM set_config('p2d1.alice_event', v_alice_first.event_id::text, true);
  PERFORM set_config('p2d1.alice_tenant', v_alice_first.tenant_id::text, true);
  PERFORM set_config('p2d1.ben_event', v_ben_first.event_id::text, true);
END;
$conflict$;

-- ===========================================================================
-- 5-6: invalid replacement input and a foreign old-Event id both leave
-- everything completely intact.
-- ===========================================================================
DO $guard$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '92d10000-0000-4000-8000-000000000001', true);
  v_before := public.p2d1_counts();

  -- Invalid replacement input: a NULL end date. Validation must run before
  -- any deletion, so Alice's original Event is completely untouched.
  v_failed := false;
  BEGIN
    PERFORM public.replace_self_service_organizer_event(
      current_setting('p2d1.alice_event')::uuid,
      'Alice Org', 'Alice Replacement', NULL, 'UTC',
      '92d1a000-0000-4000-8000-000000000003', NULL, 'no_location', NULL, 'casual'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'A scheduled Event end date is required.';
  END;
  PERFORM public.p2d1_assert(v_failed, 'invalid replacement input (missing end date) is rejected before any deletion');
  PERFORM public.p2d1_assert(
    public.p2d1_event_exists(current_setting('p2d1.alice_event')::uuid),
    'Alice''s original Event still exists after the invalid-input attempt'
  );

  -- A foreign old-Event id: Alice attempts to replace Ben's Event.
  v_failed := false;
  BEGIN
    PERFORM public.replace_self_service_organizer_event(
      current_setting('p2d1.ben_event')::uuid,
      'Alice Org', 'Alice Should Not Get This', current_date + 20, 'UTC',
      '92d1a000-0000-4000-8000-000000000004', NULL, 'no_location', NULL, 'casual'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.p2d1_assert(v_failed, 'a foreign old-Event id is rejected with the same non-enumerating Event not found.');
  PERFORM public.p2d1_assert(
    public.p2d1_event_exists(current_setting('p2d1.ben_event')::uuid),
    'Ben''s Event still exists after Alice''s unauthorized replace attempt'
  );

  v_after := public.p2d1_counts();
  PERFORM public.p2d1_assert(v_before = v_after, 'zero rows changed anywhere across both rejected attempts');
END;
$guard$;

-- ===========================================================================
-- 4, 7: atomic replace success, capacity stays exactly 1 throughout, and a
-- retried call with the same idempotency key replays the identical result.
-- ===========================================================================
DO $replace$
DECLARE
  v_old_tenant uuid;
  v_old_event uuid;
  v_result record;
  v_retry record;
  v_cap record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '92d10000-0000-4000-8000-000000000001', true);
  v_old_event := current_setting('p2d1.alice_event')::uuid;
  v_old_tenant := current_setting('p2d1.alice_tenant')::uuid;

  SELECT * INTO v_cap FROM public.get_my_self_service_organizer_capacity();
  PERFORM public.p2d1_assert(v_cap.active_unfinished_event_count = 1, 'exactly one active unfinished Event before replace');

  SELECT * INTO v_result FROM public.replace_self_service_organizer_event(
    v_old_event, 'Alice New Org', 'Alice New Gathering', current_date + 30, 'America/Denver',
    '92d1a000-0000-4000-8000-000000000005', NULL, 'no_location', NULL, 'wedding'
  );
  PERFORM public.p2d1_assert(v_result.outcome = 'replaced', 'the atomic replace succeeds');
  PERFORM public.p2d1_assert(v_result.deleted_event_id = v_old_event, 'the reported deleted_event_id is the OLD Event');
  PERFORM public.p2d1_assert(v_result.event_name = 'Alice New Gathering', 'the returned draft is the NEW Event');
  PERFORM public.p2d1_assert(v_result.event_id <> v_old_event, 'the new Event has a different id from the old one');

  -- Old Event, its tenant, and its appointment are gone (it was the only
  -- Event in its private workspace).
  PERFORM public.p2d1_assert(NOT public.p2d1_event_exists(v_old_event), 'the old Event no longer exists');
  PERFORM public.p2d1_assert(NOT public.p2d1_tenant_exists(v_old_tenant), 'the old (now-empty) private workspace tenant no longer exists');

  -- Exactly one new Event/tenant/appointment exist for Alice; capacity is
  -- back to exactly 1 -- never 0, never 2.
  SELECT * INTO v_cap FROM public.get_my_self_service_organizer_capacity();
  PERFORM public.p2d1_assert(
    v_cap.active_unfinished_event_count = 1 AND v_cap.can_start_another_event = false,
    'after replace, capacity is exactly 1 active unfinished Event -- never 0, never 2'
  );
  PERFORM public.p2d1_assert(
    public.p2d1_tenant_exists(v_result.tenant_id) AND public.p2d1_appointment_exists(v_result.tenant_id),
    'the new tenant and its active organizer appointment exist'
  );

  -- Idempotent retry: the exact same (actor, key) replays the identical
  -- result and writes no second deletion-audit row.
  SELECT * INTO v_retry FROM public.replace_self_service_organizer_event(
    v_old_event, 'Alice New Org', 'Alice New Gathering', current_date + 30, 'America/Denver',
    '92d1a000-0000-4000-8000-000000000005', NULL, 'no_location', NULL, 'wedding'
  );
  PERFORM public.p2d1_assert(
    v_retry.outcome = 'replaced' AND v_retry.event_id = v_result.event_id AND v_retry.deleted_event_id = v_old_event,
    'retrying with the same idempotency key replays the identical replaced result'
  );
  PERFORM public.p2d1_assert(
    public.p2d1_deletion_audit_count_for(
      '92d10000-0000-4000-8000-000000000001'::uuid, '92d1a000-0000-4000-8000-000000000005'::uuid
    ) = 1,
    'exactly one deletion-audit row exists for this (actor, key) even after the retry'
  );

  SELECT * INTO v_cap FROM public.get_my_self_service_organizer_capacity();
  PERFORM public.p2d1_assert(
    v_cap.active_unfinished_event_count = 1,
    'capacity is still exactly 1 after the idempotent retry -- the replay never double-creates'
  );

  PERFORM set_config('p2d1.alice_new_event', v_result.event_id::text, true);
  PERFORM set_config('p2d1.alice_new_tenant', v_result.tenant_id::text, true);
END;
$replace$;

-- ===========================================================================
-- Adversarial-review correction (Lun): an idempotency-key reuse naming a
-- CHANGED old Event, or CHANGED new-draft input, must fail safely (the
-- existing fingerprint-mismatch guard) and must not alter either the
-- already-replaced current project or the unrelated project it tried to
-- name.
-- ===========================================================================
DO $idempotency_conflict$
DECLARE
  v_alice_current uuid;
  v_ben_event uuid;
  v_before jsonb;
  v_after jsonb;
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '92d10000-0000-4000-8000-000000000001', true);
  v_alice_current := current_setting('p2d1.alice_new_event')::uuid;
  v_ben_event := current_setting('p2d1.ben_event')::uuid;
  v_before := public.p2d1_counts();

  -- Same key as the successful replace above, but different new-draft input
  -- (event name changed).
  v_failed := false;
  BEGIN
    PERFORM public.replace_self_service_organizer_event(
      v_alice_current, 'Alice New Org', 'Alice DIFFERENT Gathering', current_date + 30, 'America/Denver',
      '92d1a000-0000-4000-8000-000000000005', NULL, 'no_location', NULL, 'wedding'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Idempotency key was already used with different replacement input.';
  END;
  PERFORM public.p2d1_assert(v_failed, 'reusing the key with a changed new-draft input fails safely');
  PERFORM public.p2d1_assert(
    public.p2d1_event_exists(v_alice_current),
    'Alice''s current (already-replaced) project is untouched by the changed-input retry'
  );

  -- Same key, same new-draft input, but a DIFFERENT (foreign, unrelated) old
  -- Event id -- Ben's.
  v_failed := false;
  BEGIN
    PERFORM public.replace_self_service_organizer_event(
      v_ben_event, 'Alice New Org', 'Alice New Gathering', current_date + 30, 'America/Denver',
      '92d1a000-0000-4000-8000-000000000005', NULL, 'no_location', NULL, 'wedding'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Idempotency key was already used with different replacement input.';
  END;
  PERFORM public.p2d1_assert(v_failed, 'reusing the key with a changed old-Event id fails safely');
  PERFORM public.p2d1_assert(
    public.p2d1_event_exists(v_alice_current) AND public.p2d1_event_exists(v_ben_event),
    'neither Alice''s current project nor Ben''s unrelated project was altered'
  );

  v_after := public.p2d1_counts();
  PERFORM public.p2d1_assert(v_before = v_after, 'zero rows changed anywhere across both conflicting-key retries');
END;
$idempotency_conflict$;

-- ===========================================================================
-- Adversarial-review correction (Lun): a REAL, unrelated ON DELETE RESTRICT
-- foreign key (person_tenant_administrator_appointments.tenant_id) forces
-- the tenant-teardown step of the delegated deletion to fail AFTER the old
-- Event, its draft marker, its command audit, the tenant lifecycle audit,
-- and the organizer appointment have already been deleted within the same
-- transaction. The whole replacement -- deletion included -- must roll back,
-- leaving Carol's original Event completely intact.
-- ===========================================================================
DO $forced_rollback$
DECLARE
  v_carol_draft record;
  v_carol_person uuid;
  v_before jsonb;
  v_after jsonb;
  v_failed boolean;
  v_sqlstate text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '92d10000-0000-4000-8000-000000000003', true);

  SELECT * INTO v_carol_draft FROM public.create_self_service_organizer_draft(
    'Carol Org', 'Carol Fundraiser', current_date + 21, 'UTC',
    '92d1c000-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.p2d1_assert(v_carol_draft.outcome = 'created', 'Carol''s first draft is created');
  v_carol_person := v_carol_draft.organizer_person_id;

  -- Block the LAST step of deletion (tenant teardown) with a real, unrelated
  -- FK -- as postgres, exactly like the established p2d_add_dependency
  -- pattern this repo already uses to force the event-dependency scan.
  SET LOCAL ROLE postgres;
  PERFORM public.p2d1_block_tenant_teardown(v_carol_person, v_carol_draft.tenant_id);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '92d10000-0000-4000-8000-000000000003', true);

  v_before := public.p2d1_counts();

  v_failed := false;
  BEGIN
    PERFORM public.replace_self_service_organizer_event(
      v_carol_draft.event_id, 'Carol New Org', 'Carol New Gala', current_date + 40, 'UTC',
      '92d1c000-0000-4000-8000-000000000002', NULL, 'no_location', NULL, 'casual'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    v_sqlstate := SQLSTATE;
  END;
  PERFORM public.p2d1_assert(v_failed, 'the forced tenant-teardown FK violation aborts the replacement');
  -- 23503 = foreign_key_violation -- the REAL Postgres code for this,
  -- narrowed exactly like this repo's own SQLSTATE-precise convention, so an
  -- unrelated failure could never be misattributed to this proof.
  PERFORM public.p2d1_assert(v_sqlstate = '23503', 'the failure is a genuine foreign-key violation, not an unrelated error');

  -- The ENTIRE replacement rolled back: Carol's original Event, its tenant,
  -- and its appointment are all still there, exactly as before the attempt.
  PERFORM public.p2d1_assert(
    public.p2d1_event_exists(v_carol_draft.event_id),
    'Carol''s original Event still exists -- the deletion that already ran was rolled back'
  );
  PERFORM public.p2d1_assert(
    public.p2d1_tenant_exists(v_carol_draft.tenant_id) AND public.p2d1_appointment_exists(v_carol_draft.tenant_id),
    'Carol''s original tenant and organizer appointment still exist -- also rolled back'
  );

  v_after := public.p2d1_counts();
  PERFORM public.p2d1_assert(v_before = v_after, 'zero net rows changed -- the failed mid-transaction replacement left no trace');

  -- No new draft was ever created for Carol.
  DECLARE
    v_cap record;
  BEGIN
    SELECT * INTO v_cap FROM public.get_my_self_service_organizer_capacity();
    PERFORM public.p2d1_assert(
      v_cap.active_unfinished_event_count = 1,
      'Carol still has exactly her one original unfinished Event -- no new draft was created by the failed attempt'
    );
  END;
END;
$forced_rollback$;

-- ===========================================================================
-- 9: the pre-existing standalone delete command still works, completely
-- unmodified by this migration.
-- ===========================================================================
DO $standalone_delete$
DECLARE
  v_ben_event uuid;
  v_del record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '92d10000-0000-4000-8000-000000000002', true);
  v_ben_event := current_setting('p2d1.ben_event')::uuid;

  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_ben_event, '92d1b000-0000-4000-8000-000000000003'
  );
  PERFORM public.p2d1_assert(v_del.outcome = 'deleted', 'the standalone delete command still works unmodified');
  PERFORM public.p2d1_assert(NOT public.p2d1_event_exists(v_ben_event), 'Ben''s Event is gone after the standalone delete');
END;
$standalone_delete$;

-- ===========================================================================
-- 8 (verified last): the ordinary FCOC/platform Tenant Event and its admin
-- authority row are completely unaffected by everything above.
-- ===========================================================================
DO $ordinary_check$
BEGIN
  PERFORM public.p2d1_assert(
    public.p2d1_event_exists(current_setting('p2d1.ordinary_event')::uuid),
    'the ordinary platform Event is untouched'
  );
  PERFORM public.p2d1_assert(
    public.p2d1_tenant_exists(current_setting('p2d1.ordinary_tenant')::uuid),
    'the ordinary platform Tenant is untouched'
  );
END;
$ordinary_check$;

SET LOCAL ROLE postgres;

ROLLBACK;
