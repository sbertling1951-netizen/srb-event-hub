-- P-2D linked-database behavior proof: governed unfinished-event deletion and
-- the default one-active-unfinished-event capacity.
--
-- Run only after 20260924000000, 20260925000000 AND 20260926000000 have been
-- applied.  The fixture creates isolated auth + identity rows, exercises the
-- governed RPCs as the authenticated browser role, and rolls everything back.
--
-- It proves:
--   1.  default capacity is 1; get_my_self_service_organizer_capacity reflects
--       it; BOTH creation paths (new event via create_self_service_organizer_draft,
--       add event via create_self_service_organizer_event) reject a second
--       active unfinished Draft server-side with zero writes;
--   2.  owner deletion of the last Draft in a private tenant removes the event,
--       its draft marker, its command audit, the two lifecycle-audit rows, the
--       organizer appointment and the private tenant -- and writes exactly one
--       minimal deletion-audit row;
--   3.  people / person_auth_accounts / person_resolution_audit are preserved;
--   4.  after a successful delete the organizer is back under capacity and can
--       immediately create again (delete-then-create);
--   5.  event-only deletion (a sibling Draft remains) leaves the tenant,
--       appointment and lifecycle audit intact;
--   6.  a non-owner, an unresolved/ambiguous identity, a non-Draft/active event,
--       and an event carrying unexpected dependent data are ALL rejected
--       fail-closed ('Event not found.' / 'unexpected dependent data') with NO
--       partial deletion;
--   7.  the deletion-audit row is immutable to UPDATE, and the onboarding
--       command audit + tenant lifecycle audit remain immutable to UPDATE and
--       reject an ungoverned DELETE;
--   8.  deletion idempotency: the same (actor, key) replays the same result and
--       writes no second audit row; the same key against a different event is
--       rejected;
--   9.  the deletion-audit row contains no event name, organization name,
--       location, dates, timezone, or template -- only non-content identifiers.

BEGIN;

CREATE OR REPLACE FUNCTION public.p2d_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P-2D fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.p2d_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_assert(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d_counts()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT jsonb_build_object(
    'tenants', (SELECT count(*) FROM public.tenants),
    'events', (SELECT count(*) FROM public.events),
    'people', (SELECT count(*) FROM public.people),
    'person_auth_accounts', (SELECT count(*) FROM public.person_auth_accounts),
    'person_resolution_audit', (SELECT count(*) FROM public.person_resolution_audit),
    'organizer_appointments', (SELECT count(*) FROM public.self_service_organizer_appointments),
    'private_event_drafts', (SELECT count(*) FROM public.self_service_private_event_drafts),
    'command_audit', (SELECT count(*) FROM public.self_service_onboarding_command_audit),
    'tenant_lifecycle_audit', (SELECT count(*) FROM public.self_service_tenant_lifecycle_audit),
    'deletion_audit', (SELECT count(*) FROM public.self_service_event_deletion_audit)
  );
$function$;
ALTER FUNCTION public.p2d_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_counts() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_counts() TO authenticated;

-- Lift / restore the capacity ceiling for THIS transaction only, so the
-- multi-draft-in-one-space scenarios (assertion set 5) can be built.  The
-- ceiling itself is what assertion set 1 proves; this helper never runs there.
CREATE OR REPLACE FUNCTION public.p2d_set_limit(p_limit integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.self_service_default_active_event_limit() '
    'RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO ''pg_catalog'' '
    'AS $g$ SELECT %s $g$', p_limit::text
  );
END;
$function$;
ALTER FUNCTION public.p2d_set_limit(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_set_limit(integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_set_limit(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d_add_dependency(p_event_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.announcements (event_id) VALUES (p_event_id);
$function$;
ALTER FUNCTION public.p2d_add_dependency(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_add_dependency(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_add_dependency(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d_clear_dependency(p_event_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  DELETE FROM public.announcements WHERE event_id = p_event_id;
$function$;
ALTER FUNCTION public.p2d_clear_dependency(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_clear_dependency(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_clear_dependency(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d_set_event_active(p_event_id uuid, p_is_active boolean)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  UPDATE public.events SET is_active = p_is_active WHERE id = p_event_id;
$function$;
ALTER FUNCTION public.p2d_set_event_active(uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_set_event_active(uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_set_event_active(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d_event_exists(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.p2d_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_event_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_event_exists(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d_tenant_exists(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id);
$function$;
ALTER FUNCTION public.p2d_tenant_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_tenant_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_tenant_exists(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d_deletion_audit_text()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT coalesce(string_agg(to_jsonb(a)::text, ' '), '')
  FROM public.self_service_event_deletion_audit AS a;
$function$;
ALTER FUNCTION public.p2d_deletion_audit_text() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_deletion_audit_text() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_deletion_audit_text() TO authenticated;

-- Attempt an immutable-audit mutation as the table owner (RLS bypassed), so
-- the BEFORE trigger itself is what we are testing.  Returns SQLERRM, or
-- 'no error' if the write unexpectedly succeeded.
CREATE OR REPLACE FUNCTION public.p2d_try_update_command_audit(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
BEGIN
  UPDATE public.self_service_onboarding_command_audit SET action = action WHERE id = p_id;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END;
$function$;
ALTER FUNCTION public.p2d_try_update_command_audit(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_try_update_command_audit(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_try_update_command_audit(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d_try_ungoverned_delete_command_audit(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
BEGIN
  DELETE FROM public.self_service_onboarding_command_audit WHERE id = p_id;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END;
$function$;
ALTER FUNCTION public.p2d_try_ungoverned_delete_command_audit(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_try_ungoverned_delete_command_audit(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_try_ungoverned_delete_command_audit(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d_try_update_lifecycle_audit(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
BEGIN
  UPDATE public.self_service_tenant_lifecycle_audit SET action = action WHERE id = p_id;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END;
$function$;
ALTER FUNCTION public.p2d_try_update_lifecycle_audit(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_try_update_lifecycle_audit(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_try_update_lifecycle_audit(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d_try_update_deletion_audit(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
BEGIN
  UPDATE public.self_service_event_deletion_audit SET deletion_scope = deletion_scope WHERE id = p_id;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END;
$function$;
ALTER FUNCTION public.p2d_try_update_deletion_audit(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_try_update_deletion_audit(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_try_update_deletion_audit(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d_command_audit_id(p_event_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT id FROM public.self_service_onboarding_command_audit WHERE event_id = p_event_id;
$function$;
ALTER FUNCTION public.p2d_command_audit_id(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_command_audit_id(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_command_audit_id(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d_lifecycle_audit_id(p_tenant_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT id FROM public.self_service_tenant_lifecycle_audit WHERE tenant_id = p_tenant_id LIMIT 1;
$function$;
ALTER FUNCTION public.p2d_lifecycle_audit_id(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_lifecycle_audit_id(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_lifecycle_audit_id(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d_deletion_audit_id(p_event_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT id FROM public.self_service_event_deletion_audit WHERE deleted_event_id = p_event_id;
$function$;
ALTER FUNCTION public.p2d_deletion_audit_id(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_deletion_audit_id(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_deletion_audit_id(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2d_link(p_person_id uuid, p_auth_user_id uuid, p_is_primary boolean)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', p_is_primary, now());
$function$;
ALTER FUNCTION public.p2d_link(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2d_link(uuid, uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2d_link(uuid, uuid, boolean) TO authenticated;

DO $setup$
DECLARE
  v_person uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id IN (
      '92d00000-0000-4000-8000-000000000001',
      '92d00000-0000-4000-8000-000000000002',
      '92d00000-0000-4000-8000-000000000003'
    )
  ) THEN
    RAISE EXCEPTION 'P-2D fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('92d00000-0000-4000-8000-000000000001', 'p2d-alice@fixture.invalid', now()),
    ('92d00000-0000-4000-8000-000000000002', 'p2d-bob@fixture.invalid', now()),
    ('92d00000-0000-4000-8000-000000000003', 'p2d-carol@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p2d_link(v_person, '92d00000-0000-4000-8000-000000000001', true);

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p2d_link(v_person, '92d00000-0000-4000-8000-000000000002', true);

  -- Carol: linked to a Person that is now inactive -> resolve_auth_person_link
  -- returns invalid_or_ambiguous.
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p2d_link(v_person, '92d00000-0000-4000-8000-000000000003', true);
  UPDATE public.people SET status = 'inactive' WHERE id = v_person;
END;
$setup$;

SET LOCAL ROLE authenticated;

-- =====================================================================
-- 1-4: default capacity, last-draft deletion, identity preservation,
--      delete-then-create.
-- =====================================================================
DO $f14$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_cap record;
  v_a1 record;
  v_a2 record;
  v_del record;
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '92d00000-0000-4000-8000-000000000001', true);

  SELECT * INTO v_cap FROM public.get_my_self_service_organizer_capacity();
  PERFORM public.p2d_assert(
    v_cap.active_event_limit = 1
    AND v_cap.active_unfinished_event_count = 0
    AND v_cap.can_start_another_event = true,
    'a new organizer sees limit 1, count 0, can start'
  );

  SELECT * INTO v_a1 FROM public.create_self_service_organizer_draft(
    'Alice Org', 'Alice First Event', current_date + 7, 'UTC',
    '92dddd00-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.p2d_assert(v_a1.outcome = 'created', 'first draft is created');

  SELECT * INTO v_cap FROM public.get_my_self_service_organizer_capacity();
  PERFORM public.p2d_assert(
    v_cap.active_event_limit = 1
    AND v_cap.active_unfinished_event_count = 1
    AND v_cap.can_start_another_event = false,
    'after one draft: count 1, cannot start another'
  );

  v_after := public.p2d_counts();
  v_failed := false;
  BEGIN
    PERFORM public.create_self_service_organizer_draft(
      'Alice Org Two', 'Alice Second Event', current_date + 9, 'UTC',
      '92dddd00-0000-4000-8000-000000000002', NULL, 'no_location', NULL, 'casual'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'You already have an active unfinished event. Finish or delete it before starting another.';
  END;
  PERFORM public.p2d_assert(v_failed, 'a second new-event-space create is rejected by default capacity');
  PERFORM public.p2d_assert(public.p2d_counts() = v_after, 'the rejected new-space create wrote nothing');

  v_failed := false;
  BEGIN
    PERFORM public.create_self_service_organizer_event(
      v_a1.tenant_id, 'Alice Added Event', current_date + 9, 'UTC',
      '92dddd00-0000-4000-8000-000000000003', NULL, 'no_location', NULL, 'casual'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'You already have an active unfinished event. Finish or delete it before starting another.';
  END;
  PERFORM public.p2d_assert(v_failed, 'a second add-event is rejected by default capacity');
  PERFORM public.p2d_assert(public.p2d_counts() = v_after, 'the rejected add-event wrote nothing');

  -- ---- owner deletes the last Draft ----
  v_before := public.p2d_counts();
  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_a1.event_id, '92dede00-0000-4000-8000-000000000001'
  );
  v_after := public.p2d_counts();

  PERFORM public.p2d_assert(
    v_del.outcome = 'deleted'
    AND v_del.deleted_event_id = v_a1.event_id
    AND v_del.deleted_tenant_id = v_a1.tenant_id
    AND v_del.deletion_scope = 'event_and_empty_workspace'
    AND v_del.removed_command_audit_count = 1,
    'last-draft deletion reports event_and_empty_workspace scope'
  );
  PERFORM public.p2d_assert(
    (v_after->>'events')::bigint = (v_before->>'events')::bigint - 1
    AND (v_after->>'private_event_drafts')::bigint = (v_before->>'private_event_drafts')::bigint - 1
    AND (v_after->>'command_audit')::bigint = (v_before->>'command_audit')::bigint - 1
    AND (v_after->>'tenant_lifecycle_audit')::bigint = (v_before->>'tenant_lifecycle_audit')::bigint - 2
    AND (v_after->>'organizer_appointments')::bigint = (v_before->>'organizer_appointments')::bigint - 1
    AND (v_after->>'tenants')::bigint = (v_before->>'tenants')::bigint - 1
    AND (v_after->>'deletion_audit')::bigint = (v_before->>'deletion_audit')::bigint + 1,
    'operational rows removed; exactly one deletion-audit row written'
  );
  PERFORM public.p2d_assert(
    NOT public.p2d_event_exists(v_a1.event_id)
    AND NOT public.p2d_tenant_exists(v_a1.tenant_id),
    'the event and its private tenant no longer exist'
  );
  PERFORM public.p2d_assert(
    (v_after->>'people')::bigint = (v_before->>'people')::bigint
    AND (v_after->>'person_auth_accounts')::bigint = (v_before->>'person_auth_accounts')::bigint
    AND (v_after->>'person_resolution_audit')::bigint = (v_before->>'person_resolution_audit')::bigint,
    'people, person-auth linkage and person-resolution history are preserved'
  );

  -- ---- capacity freed; delete-then-create ----
  SELECT * INTO v_cap FROM public.get_my_self_service_organizer_capacity();
  PERFORM public.p2d_assert(
    v_cap.active_unfinished_event_count = 0 AND v_cap.can_start_another_event = true,
    'after deletion the organizer is back under capacity'
  );
  SELECT * INTO v_a2 FROM public.create_self_service_organizer_draft(
    'Alice Restart Org', 'Alice Restart Event', current_date + 5, 'UTC',
    '92dddd00-0000-4000-8000-000000000004', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.p2d_assert(v_a2.outcome = 'created', 'delete-then-create succeeds');
END;
$f14$;

-- =====================================================================
-- 5: event-only deletion keeps the workspace; last sibling removes it.
-- =====================================================================
DO $f5$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_a3 record;
  v_a3b record;
  v_del record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '92d00000-0000-4000-8000-000000000001', true);

  PERFORM public.p2d_set_limit(5);
  SELECT * INTO v_a3 FROM public.create_self_service_organizer_draft(
    'Alice Multi Org', 'Alice Multi Event One', current_date + 6, 'UTC',
    '92dddd00-0000-4000-8000-000000000005', NULL, 'no_location', NULL, 'casual'
  );
  SELECT * INTO v_a3b FROM public.create_self_service_organizer_event(
    v_a3.tenant_id, 'Alice Multi Event Two', current_date + 8, 'UTC',
    '92dddd00-0000-4000-8000-000000000006', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.p2d_assert(
    v_a3.outcome = 'created' AND v_a3b.outcome = 'created'
    AND v_a3b.tenant_id = v_a3.tenant_id AND v_a3b.event_id <> v_a3.event_id,
    'with the ceiling lifted, a two-event private space is built'
  );
  PERFORM public.p2d_set_limit(1);

  v_before := public.p2d_counts();
  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_a3b.event_id, '92dede00-0000-4000-8000-000000000002'
  );
  v_after := public.p2d_counts();
  PERFORM public.p2d_assert(
    v_del.deletion_scope = 'event_only' AND v_del.deleted_tenant_id IS NULL,
    'deleting a non-last event reports event_only scope'
  );
  PERFORM public.p2d_assert(
    (v_after->>'events')::bigint = (v_before->>'events')::bigint - 1
    AND (v_after->>'private_event_drafts')::bigint = (v_before->>'private_event_drafts')::bigint - 1
    AND (v_after->>'command_audit')::bigint = (v_before->>'command_audit')::bigint - 1
    AND (v_after->>'tenants')::bigint = (v_before->>'tenants')::bigint
    AND (v_after->>'organizer_appointments')::bigint = (v_before->>'organizer_appointments')::bigint
    AND (v_after->>'tenant_lifecycle_audit')::bigint = (v_before->>'tenant_lifecycle_audit')::bigint
    AND (v_after->>'deletion_audit')::bigint = (v_before->>'deletion_audit')::bigint + 1,
    'event-only deletion keeps the tenant, appointment and lifecycle audit'
  );
  PERFORM public.p2d_assert(public.p2d_event_exists(v_a3.event_id), 'the sibling Draft is untouched');

  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_a3.event_id, '92dede00-0000-4000-8000-000000000003'
  );
  PERFORM public.p2d_assert(
    v_del.deletion_scope = 'event_and_empty_workspace'
    AND NOT public.p2d_tenant_exists(v_a3.tenant_id),
    'deleting the last sibling removes the now-empty private workspace'
  );
END;
$f5$;

-- =====================================================================
-- 6: fail-closed rejections with no partial deletion.
-- =====================================================================
DO $f6$
DECLARE
  v_before jsonb;
  v_alice_event uuid;
  v_b1 record;
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '92d00000-0000-4000-8000-000000000001', true);
  SELECT event_id INTO v_alice_event
  FROM public.list_my_self_service_private_drafts()
  LIMIT 1;
  PERFORM public.p2d_assert(v_alice_event IS NOT NULL, 'Alice still has her restart Draft');

  -- Bob creates his own Draft, then tries to delete Alice's event.
  PERFORM set_config('request.jwt.claim.sub', '92d00000-0000-4000-8000-000000000002', true);
  SELECT * INTO v_b1 FROM public.create_self_service_organizer_draft(
    'Bob Org', 'Bob Event', current_date + 4, 'UTC',
    '92dddd00-0000-4000-8000-000000000007', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.p2d_assert(v_b1.outcome = 'created', 'Bob has his own Draft');

  v_before := public.p2d_counts();
  v_failed := false;
  BEGIN
    PERFORM public.delete_self_service_organizer_event(v_alice_event, '92dede00-0000-4000-8000-000000000010');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.p2d_assert(v_failed, 'a non-owner deletion is rejected as Event not found.');
  PERFORM public.p2d_assert(public.p2d_counts() = v_before, 'the rejected non-owner deletion wrote nothing');
  PERFORM public.p2d_assert(public.p2d_event_exists(v_alice_event), 'Alice''s event is intact');

  -- Carol: invalid_or_ambiguous identity.
  PERFORM set_config('request.jwt.claim.sub', '92d00000-0000-4000-8000-000000000003', true);
  v_failed := false;
  BEGIN
    PERFORM public.delete_self_service_organizer_event(v_alice_event, '92dede00-0000-4000-8000-000000000011');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.p2d_assert(v_failed, 'an unresolved/ambiguous identity deletion is rejected fail-closed');

  -- Non-Draft: flip Alice's event active, retry as Alice, restore.
  PERFORM set_config('request.jwt.claim.sub', '92d00000-0000-4000-8000-000000000001', true);
  PERFORM public.p2d_set_event_active(v_alice_event, true);
  v_before := public.p2d_counts();
  v_failed := false;
  BEGIN
    PERFORM public.delete_self_service_organizer_event(v_alice_event, '92dede00-0000-4000-8000-000000000012');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event not found.';
  END;
  PERFORM public.p2d_assert(v_failed, 'an active (non-Draft-state) event cannot be deleted through this path');
  PERFORM public.p2d_assert(public.p2d_counts() = v_before, 'the rejected active-event deletion wrote nothing');
  PERFORM public.p2d_set_event_active(v_alice_event, false);

  -- Dependent data -> rejected, fully rolled back.
  PERFORM public.p2d_add_dependency(v_alice_event);
  v_before := public.p2d_counts();
  v_failed := false;
  BEGIN
    PERFORM public.delete_self_service_organizer_event(v_alice_event, '92dede00-0000-4000-8000-000000000013');
  EXCEPTION WHEN OTHERS THEN
    v_failed := position('unexpected dependent data' in SQLERRM) > 0;
  END;
  PERFORM public.p2d_assert(v_failed, 'an event carrying unexpected dependent data is rejected');
  PERFORM public.p2d_assert(
    public.p2d_counts() = v_before AND public.p2d_event_exists(v_alice_event),
    'the dependent-data rejection is fully rolled back -- no partial deletion, no deletion-audit row'
  );
  PERFORM public.p2d_clear_dependency(v_alice_event);
END;
$f6$;

-- =====================================================================
-- 7-9: immutability, idempotency replay, no-content audit.
-- =====================================================================
DO $f7$
DECLARE
  v_fresh record;
  v_del record;
  v_del_replay record;
  v_after_first jsonb;
  v_failed boolean;
  v_cmd_audit_id uuid;
  v_lifecycle_id uuid;
  v_deletion_audit_id uuid;
  v_audit_txt text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '92d00000-0000-4000-8000-000000000001', true);

  PERFORM public.p2d_set_limit(5);
  SELECT * INTO v_fresh FROM public.create_self_service_organizer_draft(
    'Immutability Org', 'Immutability Event', current_date + 3, 'UTC',
    '92dddd00-0000-4000-8000-000000000020', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.p2d_set_limit(1);

  v_cmd_audit_id := public.p2d_command_audit_id(v_fresh.event_id);
  v_lifecycle_id := public.p2d_lifecycle_audit_id(v_fresh.tenant_id);
  PERFORM public.p2d_assert(
    v_cmd_audit_id IS NOT NULL AND v_lifecycle_id IS NOT NULL,
    'the fresh space has a command-audit and a lifecycle-audit row'
  );

  PERFORM public.p2d_assert(
    public.p2d_try_update_command_audit(v_cmd_audit_id)
      = 'self_service_onboarding_command_audit is immutable',
    'command audit UPDATE remains forbidden'
  );
  PERFORM public.p2d_assert(
    public.p2d_try_update_lifecycle_audit(v_lifecycle_id)
      = 'self_service_tenant_lifecycle_audit is immutable',
    'tenant lifecycle audit UPDATE remains forbidden'
  );
  PERFORM public.p2d_assert(
    public.p2d_try_ungoverned_delete_command_audit(v_cmd_audit_id)
      = 'self_service_onboarding_command_audit is immutable',
    'an ungoverned DELETE of the command audit is forbidden (the governed guard is required)'
  );

  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_fresh.event_id, '92dede00-0000-4000-8000-000000000020'
  );
  PERFORM public.p2d_assert(v_del.outcome = 'deleted', 'the fresh event deletes cleanly');
  v_after_first := public.p2d_counts();

  SELECT * INTO v_del_replay FROM public.delete_self_service_organizer_event(
    v_fresh.event_id, '92dede00-0000-4000-8000-000000000020'
  );
  PERFORM public.p2d_assert(
    v_del_replay.outcome = 'deleted'
    AND v_del_replay.deleted_event_id = v_del.deleted_event_id
    AND v_del_replay.deletion_scope = v_del.deletion_scope
    AND v_del_replay.occurred_at = v_del.occurred_at
    AND public.p2d_counts() = v_after_first,
    'a deletion replay with the same (actor, key) returns the same result and writes nothing new'
  );

  v_failed := false;
  BEGIN
    PERFORM public.delete_self_service_organizer_event(
      gen_random_uuid(), '92dede00-0000-4000-8000-000000000020'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Idempotency key was already used to delete a different event.';
  END;
  PERFORM public.p2d_assert(v_failed, 'reusing a deletion key for a different event is rejected');

  v_deletion_audit_id := public.p2d_deletion_audit_id(v_fresh.event_id);
  PERFORM public.p2d_assert(
    public.p2d_try_update_deletion_audit(v_deletion_audit_id)
      = 'self_service_event_deletion_audit is immutable',
    'the deletion audit is immutable to UPDATE'
  );

  v_audit_txt := public.p2d_deletion_audit_text();
  PERFORM public.p2d_assert(
    position('Alice First Event' in v_audit_txt) = 0
    AND position('Alice Org' in v_audit_txt) = 0
    AND position('Alice Multi Event' in v_audit_txt) = 0
    AND position('Immutability Event' in v_audit_txt) = 0
    AND position('Immutability Org' in v_audit_txt) = 0
    AND position('casual' in v_audit_txt) = 0
    AND position('UTC' in v_audit_txt) = 0,
    'the deletion audit contains no event name, organization name, template, or timezone'
  );

  RAISE NOTICE 'ALL P-2D ORGANIZER DELETION + CAPACITY ASSERTIONS PASSED';
END;
$f7$;

ROLLBACK;
