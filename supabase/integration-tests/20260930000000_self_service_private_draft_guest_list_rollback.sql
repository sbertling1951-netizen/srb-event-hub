-- P-3C linked-database behavior proof: a self-service organizer keeps a
-- PRIVATE planned-guest list for her own unfinished private draft.
--
-- Run only after 20260924000000 … 20260930000000 have been applied. Creates
-- isolated auth + identity rows, exercises the RPCs as the authenticated
-- browser role, and rolls everything back.
--
-- It proves:
--   1.  the eligible owner lists / adds / edits / removes planned guests for
--       her own eligible private Draft only;
--   2.  another organizer, an unresolved/ambiguous identity, and an
--       admin/tenant-admin account cannot read or mutate them;
--   3.  a live / member-visible / non-Draft event, and an event whose tenant
--       is no longer a self-service private draft, cannot be planned;
--   4.  display name is required; optional email / phone / note round-trip
--       exactly, and blanks normalize to NULL;
--   5.  NO planned-guest action creates or changes people,
--       person_auth_accounts, person_identifiers, person_role_instances,
--       person_event_participations, attendees, attendee_household_members,
--       activity_registrations, member_checkin_audit, agenda_items, or
--       event_agenda_state;
--   6.  the existing organizer Agenda path still works alongside the guest
--       list on the same draft;
--   7.  deleting an event that has planned guests succeeds and removes the
--       planned-guest rows; the deletion audit carries no guest PII.

BEGIN;

CREATE OR REPLACE FUNCTION public.p3c_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P-3C fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.p3c_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3c_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p3c_assert(boolean, text) TO authenticated;

-- A stable snapshot of every identity / attendee / registration / agenda
-- table this feature must never touch.
CREATE OR REPLACE FUNCTION public.p3c_untouchable_counts()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'people', (SELECT count(*) FROM public.people),
    'person_auth_accounts', (SELECT count(*) FROM public.person_auth_accounts),
    'person_identifiers', (SELECT count(*) FROM public.person_identifiers),
    'person_role_instances', (SELECT count(*) FROM public.person_role_instances),
    'person_event_participations', (SELECT count(*) FROM public.person_event_participations),
    'attendees', (SELECT count(*) FROM public.attendees),
    'attendee_household_members', (SELECT count(*) FROM public.attendee_household_members),
    'activity_registrations', (SELECT count(*) FROM public.activity_registrations),
    'member_checkin_audit', (SELECT count(*) FROM public.member_checkin_audit),
    'agenda_items', (SELECT count(*) FROM public.agenda_items),
    'event_agenda_state', (SELECT count(*) FROM public.event_agenda_state)
  );
$function$;
ALTER FUNCTION public.p3c_untouchable_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3c_untouchable_counts() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3c_untouchable_counts() TO authenticated;

CREATE OR REPLACE FUNCTION public.p3c_guest_facts(p_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM public.self_service_private_draft_planned_guests WHERE event_id = p_event_id),
    'names', (SELECT coalesce(jsonb_agg(display_name ORDER BY display_name), '[]')
              FROM public.self_service_private_draft_planned_guests WHERE event_id = p_event_id)
  );
$function$;
ALTER FUNCTION public.p3c_guest_facts(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3c_guest_facts(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3c_guest_facts(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3c_force_event(p_event_id uuid, p_status text, p_is_active boolean, p_visible boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  UPDATE public.events SET status = p_status, is_active = p_is_active, visible_to_members = p_visible
  WHERE id = p_event_id;
$function$;
ALTER FUNCTION public.p3c_force_event(uuid, text, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3c_force_event(uuid, text, boolean, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3c_force_event(uuid, text, boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3c_force_tenant_private(p_event_id uuid, p_private boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  UPDATE public.tenants SET is_self_service_private_draft = p_private
  WHERE id = (SELECT tenant_id FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.p3c_force_tenant_private(uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3c_force_tenant_private(uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3c_force_tenant_private(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3c_link(p_person_id uuid, p_auth_user_id uuid, p_is_primary boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', p_is_primary, now());
$function$;
ALTER FUNCTION public.p3c_link(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3c_link(uuid, uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3c_link(uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3c_deletion_audit_text()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT coalesce(string_agg(to_jsonb(a)::text, ' '), '')
  FROM public.self_service_event_deletion_audit AS a;
$function$;
ALTER FUNCTION public.p3c_deletion_audit_text() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3c_deletion_audit_text() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3c_deletion_audit_text() TO authenticated;

CREATE OR REPLACE FUNCTION public.p3c_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.p3c_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3c_event_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3c_event_exists(uuid) TO authenticated;

DO $setup$
DECLARE
  v_person uuid;
  v_ordinary_tenant uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    '92c00000-0000-4000-8000-000000000001',
    '92c00000-0000-4000-8000-000000000002',
    '92c00000-0000-4000-8000-000000000003',
    '92c00000-0000-4000-8000-000000000004'
  )) THEN
    RAISE EXCEPTION 'P-3C fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('92c00000-0000-4000-8000-000000000001', 'p3c-alice@fixture.invalid', now()),
    ('92c00000-0000-4000-8000-000000000002', 'p3c-bob@fixture.invalid', now()),
    ('92c00000-0000-4000-8000-000000000003', 'p3c-carol@fixture.invalid', now()),
    ('92c00000-0000-4000-8000-000000000004', 'p3c-dave-admin@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3c_link(v_person, '92c00000-0000-4000-8000-000000000001', true);
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3c_link(v_person, '92c00000-0000-4000-8000-000000000002', true);
  -- Carol -> inactive person -> resolve_auth_person_link invalid_or_ambiguous
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3c_link(v_person, '92c00000-0000-4000-8000-000000000003', true);
  UPDATE public.people SET status = 'inactive' WHERE id = v_person;

  -- Dave: real admin authority on an ORDINARY tenant, but NO organizer appointment.
  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title)
  VALUES ('p3c-fixture-ordinary', 'p3c-fixture-ordinary', 'P3C Ordinary Org', 'P3C Ordinary Org', 'P3C Ordinary Org')
  RETURNING id INTO v_ordinary_tenant;
  INSERT INTO public.admin_users (email, is_active, is_super_admin, privilege_group)
  VALUES ('p3c-dave-admin@fixture.invalid', true, false, 'event_admin');
  INSERT INTO public.admin_tenant_access (admin_user_id, tenant_id, is_active)
  SELECT au.id, v_ordinary_tenant, true FROM public.admin_users au WHERE au.email = 'p3c-dave-admin@fixture.invalid';
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
  v_guest1 uuid;
  v_guest2 uuid;
  v_list_count integer;
  v_untouchable jsonb;
  v_facts jsonb;
  v_agenda record;
  v_del record;
  v_failed boolean;
  v_audit_txt text;
BEGIN
  -- Snapshot every table this feature must never touch. Draft creation itself
  -- (below) writes people/auth rows through the governed onboarding resolver;
  -- the snapshot is taken AFTER both drafts exist so the guest-list
  -- assertions compare like with like.
  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_da FROM public.create_self_service_organizer_draft(
    'Alice Org', 'Alice Event', current_date + 7, 'UTC',
    '92cccc00-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  v_da_event := v_da.event_id;

  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000002', true);
  SELECT * INTO v_db FROM public.create_self_service_organizer_draft(
    'Bob Org', 'Bob Event', current_date + 7, 'UTC',
    '92cccc00-0000-4000-8000-000000000002', NULL, 'no_location', NULL, 'casual'
  );
  v_db_event := v_db.event_id;

  v_untouchable := public.p3c_untouchable_counts();

  -- ================================================================
  -- 1: eligible owner starts with an empty list, adds guests.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000001', true);
  SELECT count(*) INTO v_list_count FROM public.list_my_private_draft_planned_guests(v_da_event);
  PERFORM public.p3c_assert(v_list_count = 0, 'a fresh draft has no planned guests');

  SELECT * INTO v_added FROM public.add_my_private_draft_planned_guest(
    v_da_event, 'Jordan Rivera', 'jordan@example.invalid', '+1 555 0100', 'College roommate, bringing partner'
  );
  PERFORM public.p3c_assert(
    v_added.display_name = 'Jordan Rivera'
    AND v_added.email = 'jordan@example.invalid'
    AND v_added.phone = '+1 555 0100'
    AND v_added.organizer_note = 'College roommate, bringing partner',
    'a fully-specified planned guest round-trips all four fields'
  );

  -- 4: optional fields blank -> normalized to NULL; only the name is required.
  SELECT * INTO v_added2 FROM public.add_my_private_draft_planned_guest(
    v_da_event, '  Sam Okafor  ', '   ', NULL, ''
  );
  PERFORM public.p3c_assert(
    v_added2.display_name = 'Sam Okafor'
    AND v_added2.email IS NULL
    AND v_added2.phone IS NULL
    AND v_added2.organizer_note IS NULL,
    'a name-only planned guest trims the name and stores NULL for every blank optional field'
  );

  v_guest1 := v_added.id;
  v_guest2 := v_added2.id;

  v_facts := public.p3c_guest_facts(v_da_event);
  PERFORM public.p3c_assert(
    (v_facts->>'count')::int = 2
    AND v_facts->'names' = '["Jordan Rivera", "Sam Okafor"]'::jsonb,
    'both planned guests are listed for the owner'
  );

  -- 4: display name is required.
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_planned_guest(v_da_event, '   ', NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := position('needs a display name' in SQLERRM) > 0; END;
  PERFORM public.p3c_assert(v_failed, 'a blank display name is rejected');

  -- ================================================================
  -- 1: edit + remove.
  -- ================================================================
  SELECT * INTO v_edited FROM public.update_my_private_draft_planned_guest(
    v_da_event, v_guest2, 'Sam Okafor', 'sam.o@example.invalid', NULL, 'Now has an email'
  );
  PERFORM public.p3c_assert(
    v_edited.email = 'sam.o@example.invalid'
    AND v_edited.phone IS NULL
    AND v_edited.organizer_note = 'Now has an email'
    AND v_edited.created_at = v_added2.created_at
    AND v_edited.updated_at >= v_added2.updated_at,
    'an edit rewrites the editable fields, preserves created_at, and advances updated_at'
  );

  SELECT * INTO v_removed FROM public.delete_my_private_draft_planned_guest(v_da_event, v_guest1);
  PERFORM public.p3c_assert(v_removed.deleted_id = v_guest1, 'delete returns the removed id');
  PERFORM public.p3c_assert(
    (public.p3c_guest_facts(v_da_event)->>'count')::int = 1,
    'one planned guest remains after the delete'
  );

  -- a second delete of the same id is a clean not-found, no error swallowed
  v_failed := false;
  BEGIN PERFORM public.delete_my_private_draft_planned_guest(v_da_event, v_guest1);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Planned guest not found.'; END;
  PERFORM public.p3c_assert(v_failed, 'removing an already-removed guest is Planned guest not found.');

  -- ================================================================
  -- 2: another organizer cannot read or mutate.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000002', true);
  v_facts := public.p3c_guest_facts(v_da_event);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_planned_guests(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3c_assert(v_failed, 'a non-owner organizer cannot list the guest list');

  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_planned_guest(v_da_event, 'Bob was here', NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3c_assert(v_failed, 'a non-owner organizer cannot add a planned guest');

  v_failed := false;
  BEGIN PERFORM public.update_my_private_draft_planned_guest(v_da_event, v_guest2, 'Hijacked', NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3c_assert(v_failed, 'a non-owner organizer cannot edit a planned guest');

  v_failed := false;
  BEGIN PERFORM public.delete_my_private_draft_planned_guest(v_da_event, v_guest2);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3c_assert(v_failed, 'a non-owner organizer cannot remove a planned guest');

  PERFORM public.p3c_assert(
    public.p3c_guest_facts(v_da_event) = v_facts,
    'every non-owner attempt wrote nothing to the guest list'
  );

  -- ================================================================
  -- 2: unresolved/ambiguous identity + admin account cannot.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000003', true);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_planned_guests(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3c_assert(v_failed, 'an unresolved/ambiguous identity cannot read the guest list');

  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000004', true);
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_planned_guest(v_da_event, 'Admin guest', NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3c_assert(v_failed, 'an admin/tenant-admin account gains no write access to an organizer guest list');

  -- ================================================================
  -- 3: live / member-visible / non-Draft / non-private-tenant cannot.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000001', true);
  v_facts := public.p3c_guest_facts(v_da_event);

  PERFORM public.p3c_force_event(v_da_event, 'Draft', true, false);
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_planned_guest(v_da_event, 'x', NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3c_assert(v_failed, 'an active event cannot be planned through this path');

  PERFORM public.p3c_force_event(v_da_event, 'Draft', false, true);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_planned_guests(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3c_assert(v_failed, 'a member-visible event cannot be planned through this path');

  PERFORM public.p3c_force_event(v_da_event, 'Published', false, false);
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_planned_guest(v_da_event, 'x', NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3c_assert(v_failed, 'a non-Draft (Published) event cannot be planned through this path');

  PERFORM public.p3c_force_event(v_da_event, 'Draft', false, false);
  PERFORM public.p3c_force_tenant_private(v_da_event, false);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_planned_guests(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3c_assert(v_failed, 'an event whose tenant is no longer a self-service private draft cannot be planned');
  PERFORM public.p3c_force_tenant_private(v_da_event, true);

  PERFORM public.p3c_assert(
    public.p3c_guest_facts(v_da_event) = v_facts,
    'none of the ineligible-state attempts changed the guest list'
  );

  -- ================================================================
  -- 6: the organizer Agenda path still works on the same draft.
  -- ================================================================
  SELECT * INTO v_agenda FROM public.create_my_private_draft_agenda_item(
    v_da_event, 'Welcome', NULL, NULL, NULL, current_date + 7, time '09:00', NULL
  );
  PERFORM public.p3c_assert(v_agenda.agenda_version = 1, 'the organizer Agenda still works alongside the guest list');

  -- ================================================================
  -- 5: nothing this feature touched changed any identity / attendee /
  --    registration / check-in table. (Agenda item above is expected;
  --    exclude it from the comparison.)
  -- ================================================================
  DECLARE
    v_now jsonb := public.p3c_untouchable_counts();
  BEGIN
    PERFORM public.p3c_assert(
      (v_now->>'people') = (v_untouchable->>'people')
      AND (v_now->>'person_auth_accounts') = (v_untouchable->>'person_auth_accounts')
      AND (v_now->>'person_identifiers') = (v_untouchable->>'person_identifiers')
      AND (v_now->>'person_role_instances') = (v_untouchable->>'person_role_instances')
      AND (v_now->>'person_event_participations') = (v_untouchable->>'person_event_participations')
      AND (v_now->>'attendees') = (v_untouchable->>'attendees')
      AND (v_now->>'attendee_household_members') = (v_untouchable->>'attendee_household_members')
      AND (v_now->>'activity_registrations') = (v_untouchable->>'activity_registrations')
      AND (v_now->>'member_checkin_audit') = (v_untouchable->>'member_checkin_audit'),
      'no planned-guest action created or changed a person / attendee / registration / check-in row'
    );
  END;

  -- ================================================================
  -- 7: deleting an event that has planned guests succeeds and removes them.
  -- ================================================================
  PERFORM public.p3c_assert(
    (public.p3c_guest_facts(v_da_event)->>'count')::int >= 1,
    'the draft still carries at least one planned guest going into deletion'
  );

  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_da_event, '92cdcd00-0000-4000-8000-000000000001'
  );
  PERFORM public.p3c_assert(v_del.outcome = 'deleted', 'an event with planned guests deletes cleanly');
  PERFORM public.p3c_assert(NOT public.p3c_event_exists(v_da_event), 'the event is gone');
  PERFORM public.p3c_assert(
    (public.p3c_guest_facts(v_da_event)->>'count')::int = 0,
    'the planned-guest rows were removed with the event'
  );

  v_audit_txt := public.p3c_deletion_audit_text();
  PERFORM public.p3c_assert(
    position('Jordan Rivera' in v_audit_txt) = 0
    AND position('jordan@example.invalid' in v_audit_txt) = 0
    AND position('Sam Okafor' in v_audit_txt) = 0
    AND position('sam.o@example.invalid' in v_audit_txt) = 0
    AND position('College roommate' in v_audit_txt) = 0,
    'the deletion audit contains no planned-guest name, email, phone, or note'
  );

  -- Bob's untouched draft still lists nothing -- isolation held throughout.
  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000002', true);
  SELECT count(*) INTO v_list_count FROM public.list_my_private_draft_planned_guests(v_db_event);
  PERFORM public.p3c_assert(v_list_count = 0, 'the other organizer''s draft was never written to');

  RAISE NOTICE 'ALL P-3C ORGANIZER PRIVATE-DRAFT GUEST LIST ASSERTIONS PASSED';
END;
$fixture$;

ROLLBACK;
