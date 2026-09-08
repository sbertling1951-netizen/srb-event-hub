-- P-3G linked-database behavior proof: a self-service organizer keeps a
-- PRIVATE planning checklist for her own unfinished private draft.
--
-- Run only after 20260924000000 … 20261005000000 have been applied. Creates
-- isolated auth + identity rows, exercises the RPCs as the authenticated
-- browser role, and rolls everything back.
--
-- It proves:
--   1.  a brand-new Draft's checklist is EMPTY -- nothing is seeded,
--       generated, suggested, or created automatically;
--   2.  the eligible owner lists / adds / edits / ticks / unticks / removes
--       items for her own eligible private Draft only;
--   3.  title is required; note and target date are optional; is_completed
--       defaults to false;
--   4.  a PAST target date is accepted and nothing happens because of it, and
--       the column is date-typed (no time of day exists to schedule against);
--   5.  COMPLETION IS INERT: ticking every item leaves the Event fingerprint
--       -- status, is_active, visible_to_members, location, location_mode --
--       byte-identical, and changes nothing anywhere else;
--   6.  another organizer, an unresolved/ambiguous identity, an admin
--       account, a live / member-visible / non-Draft event, and an event
--       whose tenant is no longer a self-service private draft, cannot read
--       or mutate the checklist;
--   7.  NO checklist action creates or changes admin_task_registry,
--       agenda_items, event_agenda_state, announcements, vendors,
--       event_vendors, people, person_identifiers, attendees,
--       activity_registrations, or member_checkin_audit;
--   8.  the sibling planning tools still work alongside the checklist;
--   9.  deleting an event that has checklist items succeeds and removes them;
--       the deletion audit carries no title, note, date, completion state --
--       and NO ITEM COUNT.

BEGIN;

CREATE OR REPLACE FUNCTION public.p3g_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P-3G fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.p3g_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3g_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p3g_assert(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3g_untouchable_counts()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'admin_task_registry', (SELECT count(*) FROM public.admin_task_registry),
    'agenda_items', (SELECT count(*) FROM public.agenda_items),
    'event_agenda_state', (SELECT count(*) FROM public.event_agenda_state),
    'announcements', (SELECT count(*) FROM public.announcements),
    'vendors', (SELECT count(*) FROM public.vendors),
    'event_vendors', (SELECT count(*) FROM public.event_vendors),
    'people', (SELECT count(*) FROM public.people),
    'person_auth_accounts', (SELECT count(*) FROM public.person_auth_accounts),
    'person_identifiers', (SELECT count(*) FROM public.person_identifiers),
    'attendees', (SELECT count(*) FROM public.attendees),
    'activity_registrations', (SELECT count(*) FROM public.activity_registrations),
    'member_checkin_audit', (SELECT count(*) FROM public.member_checkin_audit)
  );
$function$;
ALTER FUNCTION public.p3g_untouchable_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3g_untouchable_counts() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3g_untouchable_counts() TO authenticated;

-- Everything a "readiness" or "launch" signal could possibly live in.
CREATE OR REPLACE FUNCTION public.p3g_event_fingerprint(p_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'status', e.status, 'is_active', e.is_active,
    'visible_to_members', e.visible_to_members,
    'location', e.location, 'venue_name', e.venue_name,
    'start_date', e.start_date, 'end_date', e.end_date,
    'location_mode', (SELECT d.location_mode FROM public.self_service_private_event_drafts d WHERE d.event_id = e.id)
  )
  FROM public.events AS e WHERE e.id = p_event_id;
$function$;
ALTER FUNCTION public.p3g_event_fingerprint(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3g_event_fingerprint(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3g_event_fingerprint(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3g_row(p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT to_jsonb(ci) FROM public.self_service_private_draft_checklist_items AS ci WHERE ci.id = p_id;
$function$;
ALTER FUNCTION public.p3g_row(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3g_row(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3g_row(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3g_item_count(p_event_id uuid)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT count(*)::integer FROM public.self_service_private_draft_checklist_items WHERE event_id = p_event_id;
$function$;
ALTER FUNCTION public.p3g_item_count(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3g_item_count(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3g_item_count(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3g_force_event(p_event_id uuid, p_status text, p_is_active boolean, p_visible boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  UPDATE public.events SET status = p_status, is_active = p_is_active, visible_to_members = p_visible
  WHERE id = p_event_id;
$function$;
ALTER FUNCTION public.p3g_force_event(uuid, text, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3g_force_event(uuid, text, boolean, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3g_force_event(uuid, text, boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3g_force_tenant_private(p_event_id uuid, p_private boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  UPDATE public.tenants SET is_self_service_private_draft = p_private
  WHERE id = (SELECT tenant_id FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.p3g_force_tenant_private(uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3g_force_tenant_private(uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3g_force_tenant_private(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3g_link(p_person_id uuid, p_auth_user_id uuid, p_is_primary boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', p_is_primary, now());
$function$;
ALTER FUNCTION public.p3g_link(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3g_link(uuid, uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3g_link(uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3g_deletion_audit_text()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT coalesce(string_agg(to_jsonb(a)::text, ' '), '')
  FROM public.self_service_event_deletion_audit AS a;
$function$;
ALTER FUNCTION public.p3g_deletion_audit_text() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3g_deletion_audit_text() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3g_deletion_audit_text() TO authenticated;

CREATE OR REPLACE FUNCTION public.p3g_audit_keys()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT coalesce(jsonb_agg(DISTINCT k ORDER BY k), '[]')
  FROM public.self_service_event_deletion_audit AS a,
       LATERAL jsonb_object_keys(to_jsonb(a)) AS k;
$function$;
ALTER FUNCTION public.p3g_audit_keys() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3g_audit_keys() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3g_audit_keys() TO authenticated;

CREATE OR REPLACE FUNCTION public.p3g_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.p3g_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3g_event_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3g_event_exists(uuid) TO authenticated;

DO $setup$
DECLARE
  v_person uuid;
  v_ordinary_tenant uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    '93b00000-0000-4000-8000-000000000001',
    '93b00000-0000-4000-8000-000000000002',
    '93b00000-0000-4000-8000-000000000003',
    '93b00000-0000-4000-8000-000000000004'
  )) THEN
    RAISE EXCEPTION 'P-3G fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('93b00000-0000-4000-8000-000000000001', 'p3g-alice@fixture.invalid', now()),
    ('93b00000-0000-4000-8000-000000000002', 'p3g-bob@fixture.invalid', now()),
    ('93b00000-0000-4000-8000-000000000003', 'p3g-carol@fixture.invalid', now()),
    ('93b00000-0000-4000-8000-000000000004', 'p3g-dave-admin@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3g_link(v_person, '93b00000-0000-4000-8000-000000000001', true);
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3g_link(v_person, '93b00000-0000-4000-8000-000000000002', true);
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3g_link(v_person, '93b00000-0000-4000-8000-000000000003', true);
  UPDATE public.people SET status = 'inactive' WHERE id = v_person;

  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title)
  VALUES ('p3g-fixture-ordinary', 'p3g-fixture-ordinary', 'P3G Ordinary Org', 'P3G Ordinary Org', 'P3G Ordinary Org')
  RETURNING id INTO v_ordinary_tenant;
  INSERT INTO public.admin_users (email, is_active, is_super_admin, privilege_group)
  VALUES ('p3g-dave-admin@fixture.invalid', true, false, 'event_admin');
  INSERT INTO public.admin_tenant_access (admin_user_id, tenant_id, is_active)
  SELECT au.id, v_ordinary_tenant, true FROM public.admin_users au WHERE au.email = 'p3g-dave-admin@fixture.invalid';
END;
$setup$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_da record; v_db record;
  v_a record; v_b record; v_c record; v_edited record; v_removed record;
  v_da_event uuid; v_db_event uuid;
  v_i1 uuid; v_i2 uuid;
  v_count integer;
  v_untouchable jsonb; v_fingerprint jsonb; v_row jsonb; v_keys jsonb;
  v_agenda record; v_guest record; v_vendor record; v_venue record; v_registry record;
  v_del record; v_failed boolean; v_audit_txt text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '93b00000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_da FROM public.create_self_service_organizer_draft(
    p_organization_name => 'Alice Org', p_event_name => 'Alice Event',
    p_end_date => current_date + 7, p_timezone => 'UTC',
    p_idempotency_key => '93bccc00-0000-4000-8000-000000000001',
    p_start_date => NULL, p_location_mode => 'location',
    p_location => 'Original Hall', p_starter_template => 'casual'
  );
  v_da_event := v_da.event_id;

  PERFORM set_config('request.jwt.claim.sub', '93b00000-0000-4000-8000-000000000002', true);
  SELECT * INTO v_db FROM public.create_self_service_organizer_draft(
    p_organization_name => 'Bob Org', p_event_name => 'Bob Event',
    p_end_date => current_date + 7, p_timezone => 'UTC',
    p_idempotency_key => '93bccc00-0000-4000-8000-000000000002',
    p_start_date => NULL, p_location_mode => 'no_location',
    p_location => NULL, p_starter_template => 'casual'
  );
  v_db_event := v_db.event_id;

  v_untouchable := public.p3g_untouchable_counts();
  v_fingerprint := public.p3g_event_fingerprint(v_da_event);

  -- ================================================================
  -- 1: A BRAND-NEW DRAFT'S CHECKLIST IS EMPTY. Nothing is seeded.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '93b00000-0000-4000-8000-000000000001', true);
  SELECT count(*) INTO v_count FROM public.list_my_private_draft_checklist_items(v_da_event);
  PERFORM public.p3g_assert(v_count = 0, 'a brand-new draft has an EMPTY checklist -- nothing seeded or generated');
  PERFORM public.p3g_assert(public.p3g_item_count(v_da_event) = 0, 'and no rows exist on disk either');
  -- the OTHER organizer's brand-new draft is empty too: creation seeds nothing
  PERFORM public.p3g_assert(public.p3g_item_count(v_db_event) = 0, 'a second brand-new draft is also empty');

  -- ================================================================
  -- 2/3: add items. Title required; note/date optional; default false.
  -- ================================================================
  SELECT * INTO v_a FROM public.add_my_private_draft_checklist_item(
    v_da_event, 'Call the hall back', 'ask about the kitchen', current_date + 3
  );
  PERFORM public.p3g_assert(
    v_a.item_title = 'Call the hall back'
    AND v_a.organizer_note = 'ask about the kitchen'
    AND v_a.target_date = current_date + 3
    AND v_a.is_completed = false,
    'a fully-specified item round-trips and defaults to NOT completed'
  );

  SELECT * INTO v_b FROM public.add_my_private_draft_checklist_item(
    v_da_event, '  Count the chairs  ', '   ', NULL
  );
  PERFORM public.p3g_assert(
    v_b.item_title = 'Count the chairs'
    AND v_b.organizer_note IS NULL
    AND v_b.target_date IS NULL
    AND v_b.is_completed = false,
    'a title-only item trims, stores NULL for blanks, and defaults to not completed'
  );

  -- 4: a PAST date is perfectly valid and nothing happens because of it
  SELECT * INTO v_c FROM public.add_my_private_draft_checklist_item(
    v_da_event, 'Something I meant to do last week', NULL, current_date - 30
  );
  PERFORM public.p3g_assert(
    v_c.target_date = current_date - 30 AND v_c.is_completed = false,
    'a target date 30 days in the past is accepted and carries no overdue state'
  );

  v_i1 := v_a.id; v_i2 := v_b.id;

  -- 4: the column is DATE-typed -- there is no time of day to schedule against
  v_row := public.p3g_row(v_i1);
  PERFORM public.p3g_assert(
    (v_row->>'target_date') = (current_date + 3)::text,
    'target_date is a plain date with no time component'
  );

  PERFORM public.p3g_assert(public.p3g_item_count(v_da_event) = 3, 'three organizer-authored items exist');

  -- 3: title is required
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_checklist_item(v_da_event, '   ');
  EXCEPTION WHEN OTHERS THEN v_failed := position('needs a title' in SQLERRM) > 0; END;
  PERFORM public.p3g_assert(v_failed, 'a blank title is rejected');

  -- ================================================================
  -- 2: edit, tick, untick.
  -- ================================================================
  SELECT * INTO v_edited FROM public.update_my_private_draft_checklist_item(
    p_event_id => v_da_event, p_checklist_item_id => v_i2,
    p_item_title => 'Count the chairs and tables', p_is_completed => true
  );
  PERFORM public.p3g_assert(
    v_edited.item_title = 'Count the chairs and tables' AND v_edited.is_completed = true,
    'an item can be edited and ticked in one governed update'
  );

  SELECT * INTO v_edited FROM public.update_my_private_draft_checklist_item(
    p_event_id => v_da_event, p_checklist_item_id => v_i2,
    p_item_title => 'Count the chairs and tables', p_is_completed => false
  );
  PERFORM public.p3g_assert(v_edited.is_completed = false, 'ticking is freely reversible');

  -- ================================================================
  -- 5: COMPLETION IS INERT -- tick EVERY item, then prove nothing moved.
  -- ================================================================
  PERFORM public.update_my_private_draft_checklist_item(v_da_event, v_i1, 'Call the hall back', NULL, NULL, true);
  PERFORM public.update_my_private_draft_checklist_item(v_da_event, v_i2, 'Count the chairs and tables', NULL, NULL, true);
  PERFORM public.update_my_private_draft_checklist_item(v_da_event, v_c.id, 'Something I meant to do last week', NULL, NULL, true);
  SELECT count(*) INTO v_count FROM public.list_my_private_draft_checklist_items(v_da_event) WHERE is_completed;
  PERFORM public.p3g_assert(v_count = 3, 'every item is now complete');
  PERFORM public.p3g_assert(
    public.p3g_event_fingerprint(v_da_event) = v_fingerprint,
    'ALL-COMPLETE changed NO event status / is_active / visibility / location / dates / location_mode'
  );

  -- and un-ticking everything is equally inert
  PERFORM public.update_my_private_draft_checklist_item(v_da_event, v_i1, 'Call the hall back', NULL, NULL, false);
  PERFORM public.p3g_assert(
    public.p3g_event_fingerprint(v_da_event) = v_fingerprint,
    'un-ticking changed nothing either'
  );

  -- ================================================================
  -- 2: remove.
  -- ================================================================
  SELECT * INTO v_removed FROM public.delete_my_private_draft_checklist_item(v_da_event, v_c.id);
  PERFORM public.p3g_assert(v_removed.deleted_id = v_c.id, 'delete returns the removed id');
  PERFORM public.p3g_assert(public.p3g_item_count(v_da_event) = 2, 'two items remain');

  v_failed := false;
  BEGIN PERFORM public.delete_my_private_draft_checklist_item(v_da_event, v_c.id);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Checklist item not found.'; END;
  PERFORM public.p3g_assert(v_failed, 'removing an already-removed item is Checklist item not found.');

  -- ================================================================
  -- 6: non-owner / unresolved / admin / ineligible-state are denied.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '93b00000-0000-4000-8000-000000000002', true);
  v_count := public.p3g_item_count(v_da_event);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_checklist_items(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3g_assert(v_failed, 'a non-owner organizer cannot list the checklist');

  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_checklist_item(v_da_event, 'Bob was here');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3g_assert(v_failed, 'a non-owner organizer cannot add an item');

  v_failed := false;
  BEGIN PERFORM public.update_my_private_draft_checklist_item(v_da_event, v_i1, 'Hijacked', NULL, NULL, true);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3g_assert(v_failed, 'a non-owner organizer cannot tick another owner''s item');

  v_failed := false;
  BEGIN PERFORM public.delete_my_private_draft_checklist_item(v_da_event, v_i1);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3g_assert(v_failed, 'a non-owner organizer cannot remove an item');

  PERFORM public.p3g_assert(public.p3g_item_count(v_da_event) = v_count, 'no non-owner attempt wrote anything');

  PERFORM set_config('request.jwt.claim.sub', '93b00000-0000-4000-8000-000000000003', true);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_checklist_items(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3g_assert(v_failed, 'an unresolved/ambiguous identity cannot read the checklist');

  PERFORM set_config('request.jwt.claim.sub', '93b00000-0000-4000-8000-000000000004', true);
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_checklist_item(v_da_event, 'Admin item');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3g_assert(v_failed, 'an admin/tenant-admin account gains no write access');

  PERFORM set_config('request.jwt.claim.sub', '93b00000-0000-4000-8000-000000000001', true);
  v_count := public.p3g_item_count(v_da_event);

  PERFORM public.p3g_force_event(v_da_event, 'Draft', true, false);
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_checklist_item(v_da_event, 'x');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3g_assert(v_failed, 'an active event cannot be planned through this path');

  PERFORM public.p3g_force_event(v_da_event, 'Draft', false, true);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_checklist_items(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3g_assert(v_failed, 'a member-visible event cannot be planned through this path');

  PERFORM public.p3g_force_event(v_da_event, 'Published', false, false);
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_checklist_item(v_da_event, 'x');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3g_assert(v_failed, 'a non-Draft (Published) event cannot be planned through this path');

  PERFORM public.p3g_force_event(v_da_event, 'Draft', false, false);
  PERFORM public.p3g_force_tenant_private(v_da_event, false);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_checklist_items(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3g_assert(v_failed, 'an event whose tenant is no longer a private draft cannot be planned');
  PERFORM public.p3g_force_tenant_private(v_da_event, true);

  PERFORM public.p3g_assert(public.p3g_item_count(v_da_event) = v_count, 'no ineligible-state attempt changed the checklist');

  -- ================================================================
  -- 8: every sibling planning tool still works on the same draft.
  -- ================================================================
  SELECT * INTO v_agenda FROM public.create_my_private_draft_agenda_item(
    v_da_event, 'Welcome', NULL, NULL, NULL, current_date + 7, time '09:00', NULL);
  PERFORM public.p3g_assert(v_agenda.agenda_version = 1, 'the P-3B Agenda still works');
  SELECT * INTO v_guest FROM public.add_my_private_draft_planned_guest(v_da_event, 'Jordan Rivera', NULL, NULL, NULL);
  PERFORM public.p3g_assert(v_guest.display_name = 'Jordan Rivera', 'the P-3C guest list still works');
  SELECT * INTO v_vendor FROM public.add_my_private_draft_vendor_plan(p_event_id => v_da_event, p_vendor_name => 'Riverbend Catering');
  PERFORM public.p3g_assert(v_vendor.vendor_name = 'Riverbend Catering', 'the P-3D vendor plan still works');
  SELECT * INTO v_venue FROM public.add_my_private_draft_venue_plan(v_da_event, 'Riverbend Legion Hall');
  PERFORM public.p3g_assert(v_venue.place_name = 'Riverbend Legion Hall', 'the P-3E venue plan still works');
  SELECT * INTO v_registry FROM public.add_my_private_draft_registry_plan(v_da_event, 'Riverbend Home Store');
  PERFORM public.p3g_assert(v_registry.provider_name = 'Riverbend Home Store', 'the P-3F registry plan still works');

  -- ================================================================
  -- 5 + 7: nothing readiness-related, authority-related, agenda-facing,
  --   or identity-related moved. (The sibling rows above are expected
  --   and are not in the untouchable set apart from agenda, which the
  --   P-3B call legitimately changed -- so it is compared separately.)
  -- ================================================================
  PERFORM public.p3g_assert(
    public.p3g_event_fingerprint(v_da_event) = v_fingerprint,
    'after ALL checklist activity, the Event fingerprint is unchanged'
  );
  DECLARE
    v_now jsonb := public.p3g_untouchable_counts();
  BEGIN
    PERFORM public.p3g_assert(
      (v_now->>'admin_task_registry') = (v_untouchable->>'admin_task_registry')
      AND (v_now->>'announcements') = (v_untouchable->>'announcements')
      AND (v_now->>'vendors') = (v_untouchable->>'vendors')
      AND (v_now->>'event_vendors') = (v_untouchable->>'event_vendors')
      AND (v_now->>'people') = (v_untouchable->>'people')
      AND (v_now->>'person_auth_accounts') = (v_untouchable->>'person_auth_accounts')
      AND (v_now->>'person_identifiers') = (v_untouchable->>'person_identifiers')
      AND (v_now->>'attendees') = (v_untouchable->>'attendees')
      AND (v_now->>'activity_registrations') = (v_untouchable->>'activity_registrations')
      AND (v_now->>'member_checkin_audit') = (v_untouchable->>'member_checkin_audit'),
      'no checklist action created or changed admin_task_registry / announcements / vendor / person / attendee / registration / check-in rows'
    );
  END;

  -- ================================================================
  -- 9: deletion removes checklist rows; the audit gains NO ITEM COUNT.
  -- ================================================================
  v_keys := public.p3g_audit_keys();
  PERFORM public.p3g_assert(public.p3g_item_count(v_da_event) >= 1, 'the draft still carries checklist items going into deletion');

  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_da_event, '93bdcd00-0000-4000-8000-000000000001'
  );
  PERFORM public.p3g_assert(v_del.outcome = 'deleted', 'an event with checklist items deletes cleanly');
  PERFORM public.p3g_assert(NOT public.p3g_event_exists(v_da_event), 'the event is gone');
  PERFORM public.p3g_assert(public.p3g_item_count(v_da_event) = 0, 'the checklist rows were removed with the event');

  -- the audit's COLUMN SET is unchanged: no checklist count column appeared
  PERFORM public.p3g_assert(
    public.p3g_audit_keys() = v_keys OR v_keys = '[]'::jsonb,
    'the deletion audit gained no new column'
  );
  v_audit_txt := public.p3g_deletion_audit_text();
  PERFORM public.p3g_assert(
    position('Call the hall' in v_audit_txt) = 0
    AND position('Count the chairs' in v_audit_txt) = 0
    AND position('kitchen' in v_audit_txt) = 0
    AND position('checklist' in v_audit_txt) = 0
    AND position('completed' in v_audit_txt) = 0
    AND position('target_date' in v_audit_txt) = 0,
    'the deletion audit contains no checklist title, note, date, completion state, or count'
  );

  PERFORM set_config('request.jwt.claim.sub', '93b00000-0000-4000-8000-000000000002', true);
  SELECT count(*) INTO v_count FROM public.list_my_private_draft_checklist_items(v_db_event);
  PERFORM public.p3g_assert(v_count = 0, 'the other organizer''s draft was never written to and is still empty');

  RAISE NOTICE 'ALL P-3G ORGANIZER PRIVATE-DRAFT CHECKLIST ASSERTIONS PASSED';
END;
$fixture$;

ROLLBACK;
