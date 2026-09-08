-- P-3D linked-database behavior proof: a self-service organizer keeps a
-- PRIVATE vendor plan for her own unfinished private draft.
--
-- Run only after 20260924000000 … 20261001000000 have been applied. Creates
-- isolated auth + identity rows, exercises the RPCs as the authenticated
-- browser role, and rolls everything back.
--
-- It proves:
--   1.  the eligible owner lists / adds / edits / removes vendor plan entries
--       for her own eligible private Draft only;
--   2.  another organizer, an unresolved/ambiguous identity, and an
--       admin/tenant-admin account cannot read or mutate them;
--   3.  a live / member-visible / non-Draft event, and an event whose tenant
--       is no longer a self-service private draft, cannot be planned;
--   4.  vendor name is required; optional category / website / contact detail
--       / note round-trip exactly, and blanks normalize to NULL;
--   5.  ONLY the three approved planning statuses are accepted;
--   6.  NO vendor plan action creates or changes vendors, event_vendors,
--       vendor_contacts, vendor_org_access, vendor invitations/candidacy/
--       admission/dispositions, people, person_auth_accounts,
--       person_identifiers, person_role_instances,
--       person_event_participations, attendees, attendee_household_members,
--       activity_registrations, member_checkin_audit, or any public/member
--       visibility;
--   7.  the existing organizer Agenda and P-3C guest list still work
--       alongside the vendor plan on the same draft;
--   8.  deleting an event that has vendor plan entries succeeds and removes
--       them; the deletion audit carries no vendor/contact/note content.

BEGIN;

CREATE OR REPLACE FUNCTION public.p3d_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P-3D fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.p3d_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3d_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p3d_assert(boolean, text) TO authenticated;

-- A stable snapshot of every vendor / identity / attendee / registration table
-- this feature must never touch.
CREATE OR REPLACE FUNCTION public.p3d_untouchable_counts()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'vendors', (SELECT count(*) FROM public.vendors),
    'event_vendors', (SELECT count(*) FROM public.event_vendors),
    'vendor_contacts', (SELECT count(*) FROM public.vendor_contacts),
    'people', (SELECT count(*) FROM public.people),
    'person_auth_accounts', (SELECT count(*) FROM public.person_auth_accounts),
    'person_identifiers', (SELECT count(*) FROM public.person_identifiers),
    'person_role_instances', (SELECT count(*) FROM public.person_role_instances),
    'person_event_participations', (SELECT count(*) FROM public.person_event_participations),
    'attendees', (SELECT count(*) FROM public.attendees),
    'attendee_household_members', (SELECT count(*) FROM public.attendee_household_members),
    'activity_registrations', (SELECT count(*) FROM public.activity_registrations),
    'member_checkin_audit', (SELECT count(*) FROM public.member_checkin_audit),
    'planned_guests', (SELECT count(*) FROM public.self_service_private_draft_planned_guests)
  );
$function$;
ALTER FUNCTION public.p3d_untouchable_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3d_untouchable_counts() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3d_untouchable_counts() TO authenticated;

CREATE OR REPLACE FUNCTION public.p3d_plan_facts(p_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM public.self_service_private_draft_vendor_plans WHERE event_id = p_event_id),
    'names', (SELECT coalesce(jsonb_agg(vendor_name ORDER BY vendor_name), '[]')
              FROM public.self_service_private_draft_vendor_plans WHERE event_id = p_event_id)
  );
$function$;
ALTER FUNCTION public.p3d_plan_facts(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3d_plan_facts(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3d_plan_facts(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3d_force_event(p_event_id uuid, p_status text, p_is_active boolean, p_visible boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  UPDATE public.events SET status = p_status, is_active = p_is_active, visible_to_members = p_visible
  WHERE id = p_event_id;
$function$;
ALTER FUNCTION public.p3d_force_event(uuid, text, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3d_force_event(uuid, text, boolean, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3d_force_event(uuid, text, boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3d_force_tenant_private(p_event_id uuid, p_private boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  UPDATE public.tenants SET is_self_service_private_draft = p_private
  WHERE id = (SELECT tenant_id FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.p3d_force_tenant_private(uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3d_force_tenant_private(uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3d_force_tenant_private(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3d_link(p_person_id uuid, p_auth_user_id uuid, p_is_primary boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', p_is_primary, now());
$function$;
ALTER FUNCTION public.p3d_link(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3d_link(uuid, uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3d_link(uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3d_deletion_audit_text()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT coalesce(string_agg(to_jsonb(a)::text, ' '), '')
  FROM public.self_service_event_deletion_audit AS a;
$function$;
ALTER FUNCTION public.p3d_deletion_audit_text() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3d_deletion_audit_text() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3d_deletion_audit_text() TO authenticated;

CREATE OR REPLACE FUNCTION public.p3d_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.p3d_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3d_event_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3d_event_exists(uuid) TO authenticated;

DO $setup$
DECLARE
  v_person uuid;
  v_ordinary_tenant uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    '92d00000-0000-4000-8000-000000000001',
    '92d00000-0000-4000-8000-000000000002',
    '92d00000-0000-4000-8000-000000000003',
    '92d00000-0000-4000-8000-000000000004'
  )) THEN
    RAISE EXCEPTION 'P-3D fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('92d00000-0000-4000-8000-000000000001', 'p3d-alice@fixture.invalid', now()),
    ('92d00000-0000-4000-8000-000000000002', 'p3d-bob@fixture.invalid', now()),
    ('92d00000-0000-4000-8000-000000000003', 'p3d-carol@fixture.invalid', now()),
    ('92d00000-0000-4000-8000-000000000004', 'p3d-dave-admin@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3d_link(v_person, '92d00000-0000-4000-8000-000000000001', true);
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3d_link(v_person, '92d00000-0000-4000-8000-000000000002', true);
  -- Carol -> inactive person -> resolve_auth_person_link invalid_or_ambiguous
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3d_link(v_person, '92d00000-0000-4000-8000-000000000003', true);
  UPDATE public.people SET status = 'inactive' WHERE id = v_person;

  -- Dave: real admin authority on an ORDINARY tenant, but NO organizer appointment.
  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title)
  VALUES ('p3d-fixture-ordinary', 'p3d-fixture-ordinary', 'P3D Ordinary Org', 'P3D Ordinary Org', 'P3D Ordinary Org')
  RETURNING id INTO v_ordinary_tenant;
  INSERT INTO public.admin_users (email, is_active, is_super_admin, privilege_group)
  VALUES ('p3d-dave-admin@fixture.invalid', true, false, 'event_admin');
  INSERT INTO public.admin_tenant_access (admin_user_id, tenant_id, is_active)
  SELECT au.id, v_ordinary_tenant, true FROM public.admin_users au WHERE au.email = 'p3d-dave-admin@fixture.invalid';
END;
$setup$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_da record;
  v_db record;
  v_added record;
  v_added2 record;
  v_edited record;
  v_removed record;
  v_da_event uuid;
  v_db_event uuid;
  v_plan1 uuid;
  v_plan2 uuid;
  v_list_count integer;
  v_untouchable jsonb;
  v_facts jsonb;
  v_agenda record;
  v_guest record;
  v_del record;
  v_failed boolean;
  v_audit_txt text;
  v_status text;
BEGIN
  -- Snapshot every table this feature must never touch. Draft creation itself
  -- (below) writes people/auth rows through the governed onboarding resolver;
  -- the snapshot is taken AFTER both drafts exist so the vendor-plan
  -- assertions compare like with like.
  PERFORM set_config('request.jwt.claim.sub', '92d00000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_da FROM public.create_self_service_organizer_draft(
    'Alice Org', 'Alice Event', current_date + 7, 'UTC',
    '92dccc00-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  v_da_event := v_da.event_id;

  PERFORM set_config('request.jwt.claim.sub', '92d00000-0000-4000-8000-000000000002', true);
  SELECT * INTO v_db FROM public.create_self_service_organizer_draft(
    'Bob Org', 'Bob Event', current_date + 7, 'UTC',
    '92dccc00-0000-4000-8000-000000000002', NULL, 'no_location', NULL, 'casual'
  );
  v_db_event := v_db.event_id;

  v_untouchable := public.p3d_untouchable_counts();

  -- ================================================================
  -- 1: eligible owner starts with an empty plan, adds entries.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '92d00000-0000-4000-8000-000000000001', true);
  SELECT count(*) INTO v_list_count FROM public.list_my_private_draft_vendor_plans(v_da_event);
  PERFORM public.p3d_assert(v_list_count = 0, 'a fresh draft has no vendor plan entries');

  SELECT * INTO v_added FROM public.add_my_private_draft_vendor_plan(
    v_da_event, 'Riverbend Catering', 'Caterers and food', 'contacted',
    'https://riverbend.example.invalid', 'ask for Dana, 555-0182',
    'Quoted verbally, waiting on the written version'
  );
  PERFORM public.p3d_assert(
    v_added.vendor_name = 'Riverbend Catering'
    AND v_added.service_category = 'Caterers and food'
    AND v_added.planning_status = 'contacted'
    AND v_added.website = 'https://riverbend.example.invalid'
    AND v_added.contact_detail = 'ask for Dana, 555-0182'
    AND v_added.organizer_note = 'Quoted verbally, waiting on the written version',
    'a fully-specified vendor plan entry round-trips every field'
  );

  -- 4: optional fields blank -> normalized to NULL; only the name is required,
  --    and the status defaults to considering.
  SELECT * INTO v_added2 FROM public.add_my_private_draft_vendor_plan(
    v_da_event, '  Aunt Ruth''s barn  ', '   ', NULL, '', NULL, ''
  );
  PERFORM public.p3d_assert(
    v_added2.vendor_name = 'Aunt Ruth''s barn'
    AND v_added2.service_category IS NULL
    AND v_added2.planning_status = 'considering'
    AND v_added2.website IS NULL
    AND v_added2.contact_detail IS NULL
    AND v_added2.organizer_note IS NULL,
    'a name-only placeholder trims the name, defaults to considering, and stores NULL for every blank optional field'
  );

  v_plan1 := v_added.id;
  v_plan2 := v_added2.id;

  v_facts := public.p3d_plan_facts(v_da_event);
  PERFORM public.p3d_assert(
    (v_facts->>'count')::int = 2
    AND v_facts->'names' = '["Aunt Ruth''s barn", "Riverbend Catering"]'::jsonb,
    'both vendor plan entries are listed for the owner'
  );

  -- 4: vendor name is required.
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_vendor_plan(v_da_event, '   ', NULL, 'considering', NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := position('needs a name' in SQLERRM) > 0; END;
  PERFORM public.p3d_assert(v_failed, 'a blank vendor name is rejected');

  -- ================================================================
  -- 5: ONLY the three approved statuses are accepted.
  -- ================================================================
  FOREACH v_status IN ARRAY ARRAY['considering', 'contacted', 'selected'] LOOP
    SELECT * INTO v_edited FROM public.update_my_private_draft_vendor_plan(
      v_da_event, v_plan2, 'Aunt Ruth''s barn', NULL, v_status, NULL, NULL, NULL
    );
    PERFORM public.p3d_assert(v_edited.planning_status = v_status,
      format('the approved status %s is accepted', v_status));
  END LOOP;

  FOREACH v_status IN ARRAY ARRAY['booked', 'ruled_out', 'admitted', 'paid', 'Considering', ''] LOOP
    v_failed := false;
    BEGIN PERFORM public.add_my_private_draft_vendor_plan(
      v_da_event, 'Bad status vendor', NULL, v_status, NULL, NULL, NULL);
    EXCEPTION WHEN OTHERS THEN
      v_failed := position('must be considering, contacted, or selected' in SQLERRM) > 0
               OR position('considering' in SQLERRM) > 0;
    END;
    PERFORM public.p3d_assert(v_failed, format('the unapproved status %L is rejected', v_status));
  END LOOP;

  PERFORM public.p3d_assert(
    (public.p3d_plan_facts(v_da_event)->>'count')::int = 2,
    'no rejected status attempt created a row'
  );

  -- ================================================================
  -- 1: edit + remove.
  -- ================================================================
  SELECT * INTO v_edited FROM public.update_my_private_draft_vendor_plan(
    v_da_event, v_plan2, 'Aunt Ruth''s barn', 'Venues and locations', 'selected',
    NULL, 'Ruth, 555-0143', 'Free, but we bring our own tables'
  );
  PERFORM public.p3d_assert(
    v_edited.service_category = 'Venues and locations'
    AND v_edited.planning_status = 'selected'
    AND v_edited.website IS NULL
    AND v_edited.contact_detail = 'Ruth, 555-0143'
    AND v_edited.created_at = v_added2.created_at
    AND v_edited.updated_at >= v_added2.updated_at,
    'an edit rewrites the editable fields, preserves created_at, and advances updated_at'
  );

  SELECT * INTO v_removed FROM public.delete_my_private_draft_vendor_plan(v_da_event, v_plan1);
  PERFORM public.p3d_assert(v_removed.deleted_id = v_plan1, 'delete returns the removed id');
  PERFORM public.p3d_assert(
    (public.p3d_plan_facts(v_da_event)->>'count')::int = 1,
    'one vendor plan entry remains after the delete'
  );

  -- a second delete of the same id is a clean not-found, no error swallowed
  v_failed := false;
  BEGIN PERFORM public.delete_my_private_draft_vendor_plan(v_da_event, v_plan1);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Vendor plan entry not found.'; END;
  PERFORM public.p3d_assert(v_failed, 'removing an already-removed entry is Vendor plan entry not found.');

  -- ================================================================
  -- 2: another organizer cannot read or mutate.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '92d00000-0000-4000-8000-000000000002', true);
  v_facts := public.p3d_plan_facts(v_da_event);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_vendor_plans(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3d_assert(v_failed, 'a non-owner organizer cannot list the vendor plan');

  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_vendor_plan(v_da_event, 'Bob was here', NULL, 'considering', NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3d_assert(v_failed, 'a non-owner organizer cannot add a vendor plan entry');

  v_failed := false;
  BEGIN PERFORM public.update_my_private_draft_vendor_plan(v_da_event, v_plan2, 'Hijacked', NULL, 'selected', NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3d_assert(v_failed, 'a non-owner organizer cannot edit a vendor plan entry');

  v_failed := false;
  BEGIN PERFORM public.delete_my_private_draft_vendor_plan(v_da_event, v_plan2);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3d_assert(v_failed, 'a non-owner organizer cannot remove a vendor plan entry');

  PERFORM public.p3d_assert(
    public.p3d_plan_facts(v_da_event) = v_facts,
    'every non-owner attempt wrote nothing to the vendor plan'
  );

  -- ================================================================
  -- 2: unresolved/ambiguous identity + admin account cannot.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '92d00000-0000-4000-8000-000000000003', true);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_vendor_plans(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3d_assert(v_failed, 'an unresolved/ambiguous identity cannot read the vendor plan');

  PERFORM set_config('request.jwt.claim.sub', '92d00000-0000-4000-8000-000000000004', true);
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_vendor_plan(v_da_event, 'Admin vendor', NULL, 'considering', NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3d_assert(v_failed, 'an admin/tenant-admin account gains no write access to an organizer vendor plan');

  -- ================================================================
  -- 3: live / member-visible / non-Draft / non-private-tenant cannot.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '92d00000-0000-4000-8000-000000000001', true);
  v_facts := public.p3d_plan_facts(v_da_event);

  PERFORM public.p3d_force_event(v_da_event, 'Draft', true, false);
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_vendor_plan(v_da_event, 'x', NULL, 'considering', NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3d_assert(v_failed, 'an active event cannot be planned through this path');

  PERFORM public.p3d_force_event(v_da_event, 'Draft', false, true);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_vendor_plans(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3d_assert(v_failed, 'a member-visible event cannot be planned through this path');

  PERFORM public.p3d_force_event(v_da_event, 'Published', false, false);
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_vendor_plan(v_da_event, 'x', NULL, 'considering', NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3d_assert(v_failed, 'a non-Draft (Published) event cannot be planned through this path');

  PERFORM public.p3d_force_event(v_da_event, 'Draft', false, false);
  PERFORM public.p3d_force_tenant_private(v_da_event, false);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_vendor_plans(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3d_assert(v_failed, 'an event whose tenant is no longer a self-service private draft cannot be planned');
  PERFORM public.p3d_force_tenant_private(v_da_event, true);

  PERFORM public.p3d_assert(
    public.p3d_plan_facts(v_da_event) = v_facts,
    'none of the ineligible-state attempts changed the vendor plan'
  );

  -- ================================================================
  -- 7: the organizer Agenda and the P-3C guest list still work on the
  --    same draft alongside the vendor plan.
  -- ================================================================
  SELECT * INTO v_agenda FROM public.create_my_private_draft_agenda_item(
    v_da_event, 'Welcome', NULL, NULL, NULL, current_date + 7, time '09:00', NULL
  );
  PERFORM public.p3d_assert(v_agenda.agenda_version = 1, 'the organizer Agenda still works alongside the vendor plan');

  SELECT * INTO v_guest FROM public.add_my_private_draft_planned_guest(
    v_da_event, 'Jordan Rivera', NULL, NULL, NULL
  );
  PERFORM public.p3d_assert(v_guest.display_name = 'Jordan Rivera',
    'the P-3C guest list still works alongside the vendor plan');

  -- ================================================================
  -- 6: nothing this feature touched changed any vendor / identity /
  --    attendee / registration / check-in table. (The agenda item and the
  --    one planned guest above are expected; planned_guests is excluded
  --    from the comparison for that reason.)
  -- ================================================================
  DECLARE
    v_now jsonb := public.p3d_untouchable_counts();
  BEGIN
    PERFORM public.p3d_assert(
      (v_now->>'vendors') = (v_untouchable->>'vendors')
      AND (v_now->>'event_vendors') = (v_untouchable->>'event_vendors')
      AND (v_now->>'vendor_contacts') = (v_untouchable->>'vendor_contacts')
      AND (v_now->>'people') = (v_untouchable->>'people')
      AND (v_now->>'person_auth_accounts') = (v_untouchable->>'person_auth_accounts')
      AND (v_now->>'person_identifiers') = (v_untouchable->>'person_identifiers')
      AND (v_now->>'person_role_instances') = (v_untouchable->>'person_role_instances')
      AND (v_now->>'person_event_participations') = (v_untouchable->>'person_event_participations')
      AND (v_now->>'attendees') = (v_untouchable->>'attendees')
      AND (v_now->>'attendee_household_members') = (v_untouchable->>'attendee_household_members')
      AND (v_now->>'activity_registrations') = (v_untouchable->>'activity_registrations')
      AND (v_now->>'member_checkin_audit') = (v_untouchable->>'member_checkin_audit'),
      'no vendor plan action created or changed a vendor / person / attendee / registration / check-in row'
    );
  END;

  -- ================================================================
  -- 8: deleting an event that has vendor plan entries succeeds and
  --    removes them.
  -- ================================================================
  PERFORM public.p3d_assert(
    (public.p3d_plan_facts(v_da_event)->>'count')::int >= 1,
    'the draft still carries at least one vendor plan entry going into deletion'
  );

  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_da_event, '92ddcd00-0000-4000-8000-000000000001'
  );
  PERFORM public.p3d_assert(v_del.outcome = 'deleted', 'an event with vendor plan entries deletes cleanly');
  PERFORM public.p3d_assert(NOT public.p3d_event_exists(v_da_event), 'the event is gone');
  PERFORM public.p3d_assert(
    (public.p3d_plan_facts(v_da_event)->>'count')::int = 0,
    'the vendor plan rows were removed with the event'
  );

  v_audit_txt := public.p3d_deletion_audit_text();
  PERFORM public.p3d_assert(
    position('Riverbend' in v_audit_txt) = 0
    AND position('riverbend.example.invalid' in v_audit_txt) = 0
    AND position('Aunt Ruth' in v_audit_txt) = 0
    AND position('555-0143' in v_audit_txt) = 0
    AND position('555-0182' in v_audit_txt) = 0
    AND position('Caterers and food' in v_audit_txt) = 0
    AND position('own tables' in v_audit_txt) = 0
    AND position('considering' in v_audit_txt) = 0
    AND position('selected' in v_audit_txt) = 0,
    'the deletion audit contains no vendor name, category, status, website, contact detail, or note'
  );

  -- Bob's untouched draft still lists nothing -- isolation held throughout.
  PERFORM set_config('request.jwt.claim.sub', '92d00000-0000-4000-8000-000000000002', true);
  SELECT count(*) INTO v_list_count FROM public.list_my_private_draft_vendor_plans(v_db_event);
  PERFORM public.p3d_assert(v_list_count = 0, 'the other organizer''s draft was never written to');

  RAISE NOTICE 'ALL P-3D ORGANIZER PRIVATE-DRAFT VENDOR PLAN ASSERTIONS PASSED';
END;
$fixture$;

ROLLBACK;
