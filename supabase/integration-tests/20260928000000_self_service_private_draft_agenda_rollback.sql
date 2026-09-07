-- P-3B linked-database behavior proof: a self-service organizer plans a private
-- Agenda for her own unfinished private draft.
--
-- Run only after 20260924000000 … 20260928000000 have been applied. Creates
-- isolated auth + identity rows, exercises the RPCs as the authenticated
-- browser role, and rolls everything back.
--
-- It proves:
--   1.  the eligible owner reads ONLY her own draft's agenda + version;
--   2.  create / update / delete work and advance the shared per-Event agenda
--       version;
--   3.  every organizer agenda item is stored non-public (is_published = false,
--       source = 'organizer_manual');
--   4.  organizer agenda activity is recorded in the shared command ledger with
--       resolved_authority_branch = 'organizer' and task_key IS NULL -- never
--       mislabeled as tenant-admin task authority;
--   5.  a stale expected agenda version is rejected ('stale_agenda_version')
--       with ZERO write and no new ledger row;
--   6.  another organizer cannot read or modify the draft agenda;
--   7.  an unresolved/ambiguous identity cannot;
--   8.  an account holding admin_users + admin_tenant_access (but no organizer
--       appointment) gains NOTHING here;
--   9.  a live / member-visible / non-Draft event cannot be planned through
--       this path;
--  10.  the existing admin agenda RPC (create_event_agenda_item) still gates on
--       has_event_task_authority and still rejects a non-admin owner -- the
--       admin agenda surface is unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.p3b_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P-3B fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.p3b_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3b_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p3b_assert(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3b_agenda_facts(p_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'item_count', (SELECT count(*) FROM public.agenda_items WHERE event_id = p_event_id),
    'all_hidden', (SELECT coalesce(bool_and(is_published = false), true) FROM public.agenda_items WHERE event_id = p_event_id),
    'all_organizer_source', (SELECT coalesce(bool_and(source = 'organizer_manual'), true) FROM public.agenda_items WHERE event_id = p_event_id),
    'version', coalesce((SELECT version FROM public.event_agenda_state WHERE event_id = p_event_id), 0),
    'ledger_organizer', (
      SELECT count(*) FROM public.agenda_command_ledger
      WHERE event_id = p_event_id AND resolved_authority_branch = 'organizer'
    ),
    'ledger_organizer_bad_branch', (
      SELECT count(*) FROM public.agenda_command_ledger
      WHERE event_id = p_event_id
        AND action LIKE 'organizer_private_agenda_item_%'
        AND (resolved_authority_branch <> 'organizer' OR task_key IS NOT NULL)
    ),
    'ledger_admin_actions', (
      SELECT count(*) FROM public.agenda_command_ledger
      WHERE event_id = p_event_id AND resolved_authority_branch IN ('tenant', 'event', 'platform', 'compound')
    ),
    'titles', (SELECT coalesce(jsonb_agg(title ORDER BY title), '[]') FROM public.agenda_items WHERE event_id = p_event_id)
  );
$function$;
ALTER FUNCTION public.p3b_agenda_facts(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3b_agenda_facts(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3b_agenda_facts(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3b_force_event(p_event_id uuid, p_status text, p_is_active boolean, p_visible boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  UPDATE public.events SET status = p_status, is_active = p_is_active, visible_to_members = p_visible
  WHERE id = p_event_id;
$function$;
ALTER FUNCTION public.p3b_force_event(uuid, text, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3b_force_event(uuid, text, boolean, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3b_force_event(uuid, text, boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3b_link(p_person_id uuid, p_auth_user_id uuid, p_is_primary boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', p_is_primary, now());
$function$;
ALTER FUNCTION public.p3b_link(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3b_link(uuid, uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3b_link(uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3b_first_item_id(p_event_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT id FROM public.agenda_items WHERE event_id = p_event_id ORDER BY created_at, id LIMIT 1;
$function$;
ALTER FUNCTION public.p3b_first_item_id(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3b_first_item_id(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3b_first_item_id(uuid) TO authenticated;

DO $setup$
DECLARE
  v_person uuid;
  v_ordinary_tenant uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    '92f00000-0000-4000-8000-000000000001',
    '92f00000-0000-4000-8000-000000000002',
    '92f00000-0000-4000-8000-000000000003',
    '92f00000-0000-4000-8000-000000000004'
  )) THEN
    RAISE EXCEPTION 'P-3B fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('92f00000-0000-4000-8000-000000000001', 'p3b-alice@fixture.invalid', now()),
    ('92f00000-0000-4000-8000-000000000002', 'p3b-bob@fixture.invalid', now()),
    ('92f00000-0000-4000-8000-000000000003', 'p3b-carol@fixture.invalid', now()),
    ('92f00000-0000-4000-8000-000000000004', 'p3b-dave-admin@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3b_link(v_person, '92f00000-0000-4000-8000-000000000001', true);
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3b_link(v_person, '92f00000-0000-4000-8000-000000000002', true);
  -- Carol -> inactive person -> invalid_or_ambiguous
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3b_link(v_person, '92f00000-0000-4000-8000-000000000003', true);
  UPDATE public.people SET status = 'inactive' WHERE id = v_person;

  -- Dave: real admin authority on an ORDINARY tenant, but NO organizer appointment.
  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title)
  VALUES ('p3b-fixture-ordinary', 'p3b-fixture-ordinary', 'P3B Ordinary Org', 'P3B Ordinary Org', 'P3B Ordinary Org')
  RETURNING id INTO v_ordinary_tenant;
  INSERT INTO public.admin_users (email, is_active, is_super_admin, privilege_group)
  VALUES ('p3b-dave-admin@fixture.invalid', true, false, 'event_admin');
  INSERT INTO public.admin_tenant_access (admin_user_id, tenant_id, is_active)
  SELECT au.id, v_ordinary_tenant, true FROM public.admin_users au WHERE au.email = 'p3b-dave-admin@fixture.invalid';
END;
$setup$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_da record;
  v_db record;
  v_created record;
  v_created2 record;
  v_updated record;
  v_deleted record;
  v_agenda record;
  v_da_event uuid;
  v_db_event uuid;
  v_item1 uuid;
  v_item2 uuid;
  v_facts jsonb;
  v_failed boolean;
BEGIN
  -- Alice + Bob each create a private draft.
  PERFORM set_config('request.jwt.claim.sub', '92f00000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_da FROM public.create_self_service_organizer_draft(
    'Alice Org', 'Alice Event', current_date + 7, 'UTC',
    '92ffff00-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  v_da_event := v_da.event_id;

  PERFORM set_config('request.jwt.claim.sub', '92f00000-0000-4000-8000-000000000002', true);
  SELECT * INTO v_db FROM public.create_self_service_organizer_draft(
    'Bob Org', 'Bob Event', current_date + 7, 'UTC',
    '92ffff00-0000-4000-8000-000000000002', NULL, 'no_location', NULL, 'casual'
  );
  v_db_event := v_db.event_id;

  -- ================================================================
  -- 1: eligible owner reads only her own draft agenda.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '92f00000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_agenda FROM public.get_my_private_draft_agenda(v_da_event);
  PERFORM public.p3b_assert(
    v_agenda.agenda_version = 0 AND v_agenda.items = '[]'::jsonb,
    'a fresh draft agenda reads as version 0 with no items'
  );

  v_failed := false;
  BEGIN PERFORM public.get_my_private_draft_agenda(v_db_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3b_assert(v_failed, 'Alice cannot read Bob''s draft agenda');

  -- ================================================================
  -- 2 + 3 + 4: create; stored non-public; ledger branch = organizer.
  -- ================================================================
  SELECT * INTO v_created FROM public.create_my_private_draft_agenda_item(
    v_da_event, 'Opening remarks', 'Welcome', 'Main hall', 'Alice',
    current_date + 7, time '09:00', time '09:30'
  );
  PERFORM public.p3b_assert(
    v_created.agenda_version = 1
    AND (v_created.item->>'title') = 'Opening remarks'
    AND (v_created.item->>'location') = 'Main hall',
    'creating the first agenda item returns version 1 and the item'
  );
  v_facts := public.p3b_agenda_facts(v_da_event);
  PERFORM public.p3b_assert(
    (v_facts->>'item_count')::int = 1
    AND (v_facts->>'all_hidden')::boolean
    AND (v_facts->>'all_organizer_source')::boolean
    AND (v_facts->>'version')::int = 1
    AND (v_facts->>'ledger_organizer')::int = 1
    AND (v_facts->>'ledger_organizer_bad_branch')::int = 0
    AND (v_facts->>'ledger_admin_actions')::int = 0,
    'item is stored hidden + organizer-source; ledger records exactly one organizer-branch row, task_key null'
  );

  SELECT * INTO v_created2 FROM public.create_my_private_draft_agenda_item(
    v_da_event, 'Lunch', NULL, NULL, NULL, current_date + 7, time '12:00', NULL
  );
  PERFORM public.p3b_assert(v_created2.agenda_version = 2, 'second item advances the version to 2');

  v_item1 := (v_created.item->>'id')::uuid;
  v_item2 := (v_created2.item->>'id')::uuid;

  -- ================================================================
  -- 2: update with the fresh version.
  -- ================================================================
  SELECT * INTO v_updated FROM public.update_my_private_draft_agenda_item(
    v_da_event, v_item1, 2, 'Opening remarks (revised)', 'Updated welcome', 'Main hall', 'Alice',
    current_date + 7, time '09:05', time '09:35'
  );
  PERFORM public.p3b_assert(
    v_updated.agenda_version = 3 AND (v_updated.item->>'title') = 'Opening remarks (revised)',
    'a fresh-version update returns version 3 and the updated item'
  );

  -- ================================================================
  -- 5: stale update + stale delete -> rejected, zero write.
  -- ================================================================
  v_facts := public.p3b_agenda_facts(v_da_event);
  v_failed := false;
  BEGIN
    PERFORM public.update_my_private_draft_agenda_item(
      v_da_event, v_item1, 1, 'Stale title', NULL, NULL, NULL, NULL, time '09:00', NULL
    );
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'stale_agenda_version'; END;
  PERFORM public.p3b_assert(v_failed, 'a stale-version update is rejected stale_agenda_version');
  PERFORM public.p3b_assert(
    public.p3b_agenda_facts(v_da_event) = v_facts,
    'the stale update wrote nothing (items, version, ledger all unchanged)'
  );

  v_failed := false;
  BEGIN
    PERFORM public.delete_my_private_draft_agenda_item(v_da_event, v_item2, 99);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'stale_agenda_version'; END;
  PERFORM public.p3b_assert(v_failed, 'a stale-version delete is rejected stale_agenda_version');
  PERFORM public.p3b_assert(
    public.p3b_agenda_facts(v_da_event) = v_facts,
    'the stale delete wrote nothing'
  );

  -- ================================================================
  -- 2: delete with the fresh version.
  -- ================================================================
  SELECT * INTO v_deleted FROM public.delete_my_private_draft_agenda_item(v_da_event, v_item2, 3);
  PERFORM public.p3b_assert(
    v_deleted.agenda_version = 4 AND v_deleted.deleted_id = v_item2,
    'a fresh-version delete returns version 4'
  );
  v_facts := public.p3b_agenda_facts(v_da_event);
  PERFORM public.p3b_assert(
    (v_facts->>'item_count')::int = 1
    AND (v_facts->>'all_hidden')::boolean
    AND (v_facts->>'ledger_organizer')::int = 4
    AND (v_facts->>'ledger_organizer_bad_branch')::int = 0
    AND (v_facts->>'ledger_admin_actions')::int = 0,
    'one item remains, still hidden; four organizer-branch ledger rows (2 create, 1 update, 1 delete), none mislabeled, zero admin-branch rows'
  );

  -- ================================================================
  -- 6: another organizer cannot read or modify.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '92f00000-0000-4000-8000-000000000002', true);
  v_facts := public.p3b_agenda_facts(v_da_event);
  v_failed := false;
  BEGIN PERFORM public.get_my_private_draft_agenda(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3b_assert(v_failed, 'a non-owner organizer cannot read the draft agenda');

  v_failed := false;
  BEGIN
    PERFORM public.create_my_private_draft_agenda_item(v_da_event, 'Bob was here', NULL, NULL, NULL, NULL, time '10:00', NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3b_assert(v_failed, 'a non-owner organizer cannot create an agenda item');

  v_failed := false;
  BEGIN
    PERFORM public.update_my_private_draft_agenda_item(v_da_event, v_item1, 4, 'Hijacked', NULL, NULL, NULL, NULL, time '09:00', NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3b_assert(v_failed, 'a non-owner organizer cannot update an agenda item');

  v_failed := false;
  BEGIN
    PERFORM public.delete_my_private_draft_agenda_item(v_da_event, v_item1, 4);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3b_assert(v_failed, 'a non-owner organizer cannot delete an agenda item');

  PERFORM public.p3b_assert(
    public.p3b_agenda_facts(v_da_event) = v_facts,
    'every non-owner attempt wrote nothing to the draft agenda'
  );

  -- ================================================================
  -- 7: unresolved/ambiguous identity cannot.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '92f00000-0000-4000-8000-000000000003', true);
  v_failed := false;
  BEGIN PERFORM public.get_my_private_draft_agenda(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3b_assert(v_failed, 'an unresolved/ambiguous identity cannot read the draft agenda');

  -- ================================================================
  -- 8: admin_users + admin_tenant_access grants NOTHING here.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '92f00000-0000-4000-8000-000000000004', true);
  v_failed := false;
  BEGIN PERFORM public.get_my_private_draft_agenda(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3b_assert(v_failed, 'an admin/tenant-admin account gains no read access to an organizer draft agenda');

  v_failed := false;
  BEGIN
    PERFORM public.create_my_private_draft_agenda_item(v_da_event, 'Admin item', NULL, NULL, NULL, NULL, time '10:00', NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3b_assert(v_failed, 'an admin/tenant-admin account gains no write access to an organizer draft agenda');

  -- ================================================================
  -- 9: live / member-visible / non-Draft event cannot be planned.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '92f00000-0000-4000-8000-000000000001', true);
  v_facts := public.p3b_agenda_facts(v_da_event);

  PERFORM public.p3b_force_event(v_da_event, 'Draft', true, false);
  v_failed := false;
  BEGIN PERFORM public.create_my_private_draft_agenda_item(v_da_event, 'x', NULL, NULL, NULL, NULL, time '09:00', NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3b_assert(v_failed, 'an active event cannot be planned through this path');

  PERFORM public.p3b_force_event(v_da_event, 'Draft', false, true);
  v_failed := false;
  BEGIN PERFORM public.get_my_private_draft_agenda(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3b_assert(v_failed, 'a member-visible event cannot be planned through this path');

  PERFORM public.p3b_force_event(v_da_event, 'Published', false, false);
  v_failed := false;
  BEGIN PERFORM public.create_my_private_draft_agenda_item(v_da_event, 'x', NULL, NULL, NULL, NULL, time '09:00', NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3b_assert(v_failed, 'a non-Draft (Published) event cannot be planned through this path');

  PERFORM public.p3b_force_event(v_da_event, 'Draft', false, false);
  PERFORM public.p3b_assert(
    public.p3b_agenda_facts(v_da_event) = v_facts,
    'none of the live/visible/published attempts changed the agenda'
  );

  -- ================================================================
  -- 10: the existing admin agenda RPC is unchanged -- still gates on
  --     has_event_task_authority, still rejects a non-admin owner.
  -- ================================================================
  v_failed := false;
  BEGIN
    PERFORM public.create_event_agenda_item(
      v_da_event, 'Admin-path item', NULL, NULL, NULL, NULL, NULL, NULL, time '09:00', NULL, true, NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'unauthorized'; END;
  PERFORM public.p3b_assert(
    v_failed,
    'the admin create_event_agenda_item RPC still requires Event task authority (organizer ownership does not confer it)'
  );

  -- 13: every remaining agenda item on the draft is non-public.
  PERFORM public.p3b_assert(
    (public.p3b_agenda_facts(v_da_event)->>'all_hidden')::boolean,
    'all organizer agenda items remain non-public / non-published'
  );

  RAISE NOTICE 'ALL P-3B ORGANIZER PRIVATE-DRAFT AGENDA ASSERTIONS PASSED';
END;
$fixture$;

ROLLBACK;
