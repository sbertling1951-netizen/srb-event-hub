-- P-3E linked-database behavior proof: a self-service organizer keeps a
-- PRIVATE venue / place plan for her own unfinished private draft.
--
-- Run only after 20260924000000 … 20261003000000 have been applied. Creates
-- isolated auth + identity rows, exercises the RPCs as the authenticated
-- browser role, and rolls everything back.
--
-- It proves:
--   1.  the eligible owner lists / adds / edits / removes venue plan entries
--       for her own eligible private Draft only;
--   2.  place name is required; ONLY the three approved statuses are accepted;
--   3.  every optional field may be blank, and blanks normalize to NULL;
--   4.  another organizer, an unresolved/ambiguous identity, an admin account,
--       a live / member-visible / non-Draft event, and an event whose tenant is
--       no longer a self-service private draft, cannot read or mutate them;
--   5.  NO add / update / 'selected' action changes ANY official Event location
--       field -- events.location, venue_name, street_address, lat, lng,
--       status, is_active, visible_to_members -- or the draft's location_mode;
--   6.  NO venue plan action creates or changes vendors, event_vendors,
--       vendor_contacts, people, person_identifiers, attendees,
--       activity_registrations, member_checkin_audit, event_nearby_places,
--       nearby_master, master_map_locations, event_locations, or
--       venue_evidence;
--   7.  the P-3B Agenda, P-3C guest list, and P-3D vendor plan still work
--       alongside the venue plan on the same draft;
--   8.  deleting an event that has venue plan entries succeeds and removes
--       them; the deletion audit carries no venue/contact/note content.

BEGIN;

CREATE OR REPLACE FUNCTION public.p3e_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P-3E fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.p3e_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3e_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p3e_assert(boolean, text) TO authenticated;

-- The complete official Event-location fingerprint plus the draft's
-- location_mode. If ANY venue-plan action moves ANY of these, the comparison
-- below fails.
CREATE OR REPLACE FUNCTION public.p3e_event_location_fingerprint(p_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'location', e.location,
    'venue_name', e.venue_name,
    'street_address', e.street_address,
    'lat', e.lat,
    'lng', e.lng,
    'status', e.status,
    'is_active', e.is_active,
    'visible_to_members', e.visible_to_members,
    'location_mode', (SELECT d.location_mode FROM public.self_service_private_event_drafts d WHERE d.event_id = e.id),
    'event_locations', (SELECT count(*) FROM public.event_locations el WHERE el.event_id = e.id)
  )
  FROM public.events AS e WHERE e.id = p_event_id;
$function$;
ALTER FUNCTION public.p3e_event_location_fingerprint(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3e_event_location_fingerprint(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3e_event_location_fingerprint(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3e_untouchable_counts()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'vendors', (SELECT count(*) FROM public.vendors),
    'event_vendors', (SELECT count(*) FROM public.event_vendors),
    'vendor_contacts', (SELECT count(*) FROM public.vendor_contacts),
    'people', (SELECT count(*) FROM public.people),
    'person_auth_accounts', (SELECT count(*) FROM public.person_auth_accounts),
    'person_identifiers', (SELECT count(*) FROM public.person_identifiers),
    'person_event_participations', (SELECT count(*) FROM public.person_event_participations),
    'attendees', (SELECT count(*) FROM public.attendees),
    'activity_registrations', (SELECT count(*) FROM public.activity_registrations),
    'member_checkin_audit', (SELECT count(*) FROM public.member_checkin_audit),
    'event_nearby_places', (SELECT count(*) FROM public.event_nearby_places),
    'nearby_master', (SELECT count(*) FROM public.nearby_master),
    'master_map_locations', (SELECT count(*) FROM public.master_map_locations),
    'event_locations', (SELECT count(*) FROM public.event_locations),
    'venue_evidence', (SELECT count(*) FROM public.venue_evidence)
  );
$function$;
ALTER FUNCTION public.p3e_untouchable_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3e_untouchable_counts() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3e_untouchable_counts() TO authenticated;

CREATE OR REPLACE FUNCTION public.p3e_plan_facts(p_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM public.self_service_private_draft_venue_plans WHERE event_id = p_event_id),
    'names', (SELECT coalesce(jsonb_agg(place_name ORDER BY place_name), '[]')
              FROM public.self_service_private_draft_venue_plans WHERE event_id = p_event_id)
  );
$function$;
ALTER FUNCTION public.p3e_plan_facts(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3e_plan_facts(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3e_plan_facts(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3e_force_event(p_event_id uuid, p_status text, p_is_active boolean, p_visible boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  UPDATE public.events SET status = p_status, is_active = p_is_active, visible_to_members = p_visible
  WHERE id = p_event_id;
$function$;
ALTER FUNCTION public.p3e_force_event(uuid, text, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3e_force_event(uuid, text, boolean, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3e_force_event(uuid, text, boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3e_force_tenant_private(p_event_id uuid, p_private boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  UPDATE public.tenants SET is_self_service_private_draft = p_private
  WHERE id = (SELECT tenant_id FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.p3e_force_tenant_private(uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3e_force_tenant_private(uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3e_force_tenant_private(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3e_link(p_person_id uuid, p_auth_user_id uuid, p_is_primary boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', p_is_primary, now());
$function$;
ALTER FUNCTION public.p3e_link(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3e_link(uuid, uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3e_link(uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3e_deletion_audit_text()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT coalesce(string_agg(to_jsonb(a)::text, ' '), '')
  FROM public.self_service_event_deletion_audit AS a;
$function$;
ALTER FUNCTION public.p3e_deletion_audit_text() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3e_deletion_audit_text() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3e_deletion_audit_text() TO authenticated;

CREATE OR REPLACE FUNCTION public.p3e_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.p3e_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3e_event_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3e_event_exists(uuid) TO authenticated;

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
    RAISE EXCEPTION 'P-3E fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('92f00000-0000-4000-8000-000000000001', 'p3e-alice@fixture.invalid', now()),
    ('92f00000-0000-4000-8000-000000000002', 'p3e-bob@fixture.invalid', now()),
    ('92f00000-0000-4000-8000-000000000003', 'p3e-carol@fixture.invalid', now()),
    ('92f00000-0000-4000-8000-000000000004', 'p3e-dave-admin@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3e_link(v_person, '92f00000-0000-4000-8000-000000000001', true);
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3e_link(v_person, '92f00000-0000-4000-8000-000000000002', true);
  -- Carol -> inactive person -> resolve_auth_person_link invalid_or_ambiguous
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3e_link(v_person, '92f00000-0000-4000-8000-000000000003', true);
  UPDATE public.people SET status = 'inactive' WHERE id = v_person;

  -- Dave: real admin authority on an ORDINARY tenant, but NO organizer appointment.
  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title)
  VALUES ('p3e-fixture-ordinary', 'p3e-fixture-ordinary', 'P3E Ordinary Org', 'P3E Ordinary Org', 'P3E Ordinary Org')
  RETURNING id INTO v_ordinary_tenant;
  INSERT INTO public.admin_users (email, is_active, is_super_admin, privilege_group)
  VALUES ('p3e-dave-admin@fixture.invalid', true, false, 'event_admin');
  INSERT INTO public.admin_tenant_access (admin_user_id, tenant_id, is_active)
  SELECT au.id, v_ordinary_tenant, true FROM public.admin_users au WHERE au.email = 'p3e-dave-admin@fixture.invalid';
END;
$setup$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_da record;
  v_db record;
  v_added record;
  v_blank record;
  v_edited record;
  v_removed record;
  v_da_event uuid;
  v_db_event uuid;
  v_plan1 uuid;
  v_plan2 uuid;
  v_list_count integer;
  v_untouchable jsonb;
  v_loc jsonb;
  v_facts jsonb;
  v_agenda record;
  v_guest record;
  v_vendor record;
  v_del record;
  v_failed boolean;
  v_status text;
  v_audit_txt text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '92f00000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_da FROM public.create_self_service_organizer_draft(
    p_organization_name => 'Alice Org', p_event_name => 'Alice Event',
    p_end_date => current_date + 7, p_timezone => 'UTC',
    p_idempotency_key => '92fccc00-0000-4000-8000-000000000001',
    p_start_date => NULL, p_location_mode => 'location',
    p_location => 'Original Hall', p_starter_template => 'casual'
  );
  v_da_event := v_da.event_id;

  PERFORM set_config('request.jwt.claim.sub', '92f00000-0000-4000-8000-000000000002', true);
  SELECT * INTO v_db FROM public.create_self_service_organizer_draft(
    p_organization_name => 'Bob Org', p_event_name => 'Bob Event',
    p_end_date => current_date + 7, p_timezone => 'UTC',
    p_idempotency_key => '92fccc00-0000-4000-8000-000000000002',
    p_start_date => NULL, p_location_mode => 'no_location',
    p_location => NULL, p_starter_template => 'casual'
  );
  v_db_event := v_db.event_id;

  v_untouchable := public.p3e_untouchable_counts();
  -- The official Event location fingerprint, captured BEFORE any venue
  -- planning happens. Nothing below may move it.
  v_loc := public.p3e_event_location_fingerprint(v_da_event);
  PERFORM public.p3e_assert(v_loc->>'location' = 'Original Hall', 'the draft starts with its own saved location');
  PERFORM public.p3e_assert(v_loc->>'location_mode' = 'location', 'the draft starts in location mode');

  -- ================================================================
  -- 1: eligible owner starts empty, adds entries.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '92f00000-0000-4000-8000-000000000001', true);
  SELECT count(*) INTO v_list_count FROM public.list_my_private_draft_venue_plans(v_da_event);
  PERFORM public.p3e_assert(v_list_count = 0, 'a fresh draft has no venue plan entries');

  SELECT * INTO v_added FROM public.add_my_private_draft_venue_plan(
    v_da_event, 'Riverbend Legion Hall',
    'behind the fairgrounds, gravel lot, no street number',
    'https://legion.example.invalid', 'Dana Whitfield', '+1 555 0182',
    'contacted', 'Holds about 120 they think; check the kitchen'
  );
  PERFORM public.p3e_assert(
    v_added.place_name = 'Riverbend Legion Hall'
    AND v_added.location_description = 'behind the fairgrounds, gravel lot, no street number'
    AND v_added.website = 'https://legion.example.invalid'
    AND v_added.contact_name = 'Dana Whitfield'
    AND v_added.contact_phone = '+1 555 0182'
    AND v_added.planning_status = 'contacted'
    AND v_added.organizer_note = 'Holds about 120 they think; check the kitchen',
    'a fully-specified venue plan entry round-trips every field'
  );

  -- 3: every optional field blank -> NULL; only the name is required, and the
  --    status defaults to considering.
  SELECT * INTO v_blank FROM public.add_my_private_draft_venue_plan(
    v_da_event, '  Aunt Ruth''s barn  ', '   ', '', NULL, '', NULL, ''
  );
  PERFORM public.p3e_assert(
    v_blank.place_name = 'Aunt Ruth''s barn'
    AND v_blank.location_description IS NULL
    AND v_blank.website IS NULL
    AND v_blank.contact_name IS NULL
    AND v_blank.contact_phone IS NULL
    AND v_blank.organizer_note IS NULL
    AND v_blank.planning_status = 'considering',
    'a name-only placeholder trims the name, defaults to considering, and stores NULL for every blank optional field'
  );

  v_plan1 := v_added.id;
  v_plan2 := v_blank.id;

  v_facts := public.p3e_plan_facts(v_da_event);
  PERFORM public.p3e_assert(
    (v_facts->>'count')::int = 2
    AND v_facts->'names' = '["Aunt Ruth''s barn", "Riverbend Legion Hall"]'::jsonb,
    'both venue plan entries are listed for the owner'
  );

  -- 2: place name is required.
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_venue_plan(v_da_event, '   ');
  EXCEPTION WHEN OTHERS THEN v_failed := position('needs a name' in SQLERRM) > 0; END;
  PERFORM public.p3e_assert(v_failed, 'a blank place name is rejected');

  -- 2: ONLY the three approved statuses are accepted.
  FOREACH v_status IN ARRAY ARRAY['considering', 'contacted', 'selected'] LOOP
    SELECT * INTO v_edited FROM public.update_my_private_draft_venue_plan(
      p_event_id => v_da_event, p_venue_plan_id => v_plan2,
      p_place_name => 'Aunt Ruth''s barn', p_planning_status => v_status
    );
    PERFORM public.p3e_assert(v_edited.planning_status = v_status,
      format('the approved status %s is accepted', v_status));
  END LOOP;

  FOREACH v_status IN ARRAY ARRAY['booked', 'visited', 'held', 'Considering', ''] LOOP
    v_failed := false;
    BEGIN PERFORM public.add_my_private_draft_venue_plan(
      p_event_id => v_da_event, p_place_name => 'Bad status place',
      p_planning_status => v_status);
    EXCEPTION WHEN OTHERS THEN
      v_failed := position('considering, contacted, or selected' in SQLERRM) > 0;
    END;
    PERFORM public.p3e_assert(v_failed, format('the unapproved status %L is rejected', v_status));
  END LOOP;

  -- ================================================================
  -- 5: THE CENTRAL PROOF -- marking an entry 'selected' changes NO
  --    official Event location field and no draft location_mode.
  -- ================================================================
  SELECT * INTO v_edited FROM public.update_my_private_draft_venue_plan(
    p_event_id => v_da_event, p_venue_plan_id => v_plan1,
    p_place_name => 'Riverbend Legion Hall',
    p_location_description => '221 Mill Road, Riverbend',
    p_website => 'https://legion.example.invalid',
    p_contact_name => 'Dana Whitfield', p_contact_phone => '+1 555 0182',
    p_planning_status => 'selected', p_organizer_note => 'Going with this one'
  );
  PERFORM public.p3e_assert(v_edited.planning_status = 'selected', 'the entry is marked selected');
  PERFORM public.p3e_assert(
    public.p3e_event_location_fingerprint(v_da_event) = v_loc,
    'selecting a venue plan entry changed NO official Event location field and no draft location_mode'
  );
  PERFORM public.p3e_assert(
    (public.p3e_event_location_fingerprint(v_da_event)->>'location') = 'Original Hall',
    'the Event location is still the organizer''s own saved value, untouched by planning'
  );

  -- ================================================================
  -- 1: edit + remove.
  -- ================================================================
  SELECT * INTO v_removed FROM public.delete_my_private_draft_venue_plan(v_da_event, v_plan2);
  PERFORM public.p3e_assert(v_removed.deleted_id = v_plan2, 'delete returns the removed id');
  PERFORM public.p3e_assert(
    (public.p3e_plan_facts(v_da_event)->>'count')::int = 1,
    'one venue plan entry remains after the delete'
  );

  v_failed := false;
  BEGIN PERFORM public.delete_my_private_draft_venue_plan(v_da_event, v_plan2);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Venue plan entry not found.'; END;
  PERFORM public.p3e_assert(v_failed, 'removing an already-removed entry is Venue plan entry not found.');

  -- ================================================================
  -- 4: another organizer cannot read or mutate.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '92f00000-0000-4000-8000-000000000002', true);
  v_facts := public.p3e_plan_facts(v_da_event);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_venue_plans(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3e_assert(v_failed, 'a non-owner organizer cannot list the venue plan');

  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_venue_plan(v_da_event, 'Bob was here');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3e_assert(v_failed, 'a non-owner organizer cannot add a venue plan entry');

  v_failed := false;
  BEGIN PERFORM public.update_my_private_draft_venue_plan(v_da_event, v_plan1, 'Hijacked');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3e_assert(v_failed, 'a non-owner organizer cannot edit a venue plan entry');

  v_failed := false;
  BEGIN PERFORM public.delete_my_private_draft_venue_plan(v_da_event, v_plan1);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3e_assert(v_failed, 'a non-owner organizer cannot remove a venue plan entry');

  PERFORM public.p3e_assert(
    public.p3e_plan_facts(v_da_event) = v_facts,
    'every non-owner attempt wrote nothing to the venue plan'
  );

  -- 4: unresolved/ambiguous identity + admin account cannot.
  PERFORM set_config('request.jwt.claim.sub', '92f00000-0000-4000-8000-000000000003', true);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_venue_plans(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3e_assert(v_failed, 'an unresolved/ambiguous identity cannot read the venue plan');

  PERFORM set_config('request.jwt.claim.sub', '92f00000-0000-4000-8000-000000000004', true);
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_venue_plan(v_da_event, 'Admin place');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3e_assert(v_failed, 'an admin/tenant-admin account gains no write access to an organizer venue plan');

  -- 4: live / member-visible / non-Draft / non-private-tenant cannot.
  PERFORM set_config('request.jwt.claim.sub', '92f00000-0000-4000-8000-000000000001', true);
  v_facts := public.p3e_plan_facts(v_da_event);

  PERFORM public.p3e_force_event(v_da_event, 'Draft', true, false);
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_venue_plan(v_da_event, 'x');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3e_assert(v_failed, 'an active event cannot be planned through this path');

  PERFORM public.p3e_force_event(v_da_event, 'Draft', false, true);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_venue_plans(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3e_assert(v_failed, 'a member-visible event cannot be planned through this path');

  PERFORM public.p3e_force_event(v_da_event, 'Published', false, false);
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_venue_plan(v_da_event, 'x');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3e_assert(v_failed, 'a non-Draft (Published) event cannot be planned through this path');

  PERFORM public.p3e_force_event(v_da_event, 'Draft', false, false);
  PERFORM public.p3e_force_tenant_private(v_da_event, false);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_venue_plans(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3e_assert(v_failed, 'an event whose tenant is no longer a self-service private draft cannot be planned');
  PERFORM public.p3e_force_tenant_private(v_da_event, true);

  PERFORM public.p3e_assert(
    public.p3e_plan_facts(v_da_event) = v_facts,
    'none of the ineligible-state attempts changed the venue plan'
  );

  -- ================================================================
  -- 7: the P-3B Agenda, P-3C guests, and P-3D vendor plan still work
  --    alongside the venue plan on the same draft.
  -- ================================================================
  SELECT * INTO v_agenda FROM public.create_my_private_draft_agenda_item(
    v_da_event, 'Welcome', NULL, NULL, NULL, current_date + 7, time '09:00', NULL
  );
  PERFORM public.p3e_assert(v_agenda.agenda_version = 1, 'the organizer Agenda still works alongside the venue plan');

  SELECT * INTO v_guest FROM public.add_my_private_draft_planned_guest(
    v_da_event, 'Jordan Rivera', NULL, NULL, NULL);
  PERFORM public.p3e_assert(v_guest.display_name = 'Jordan Rivera',
    'the P-3C guest list still works alongside the venue plan');

  SELECT * INTO v_vendor FROM public.add_my_private_draft_vendor_plan(
    p_event_id => v_da_event, p_vendor_name => 'Riverbend Catering');
  PERFORM public.p3e_assert(v_vendor.vendor_name = 'Riverbend Catering',
    'the P-3D vendor plan still works alongside the venue plan');

  -- ================================================================
  -- 5 + 6: nothing official moved. The Event location fingerprint is
  --   still byte-identical, and no vendor / identity / attendee /
  --   Nearby / map / venue-evidence row was created or changed.
  --   (Agenda item, guest, and vendor rows above are expected and are
  --   not in the untouchable set.)
  -- ================================================================
  PERFORM public.p3e_assert(
    public.p3e_event_location_fingerprint(v_da_event) = v_loc,
    'after ALL venue planning, every official Event location field and the draft location_mode are unchanged'
  );
  DECLARE
    v_now jsonb := public.p3e_untouchable_counts();
  BEGIN
    PERFORM public.p3e_assert(
      v_now = v_untouchable,
      'no venue plan action created or changed a vendor / person / attendee / registration / Nearby / map / event_location / venue_evidence row'
    );
  END;

  -- ================================================================
  -- 8: deleting an event that has venue plan entries succeeds and
  --    removes them.
  -- ================================================================
  PERFORM public.p3e_assert(
    (public.p3e_plan_facts(v_da_event)->>'count')::int >= 1,
    'the draft still carries at least one venue plan entry going into deletion'
  );

  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_da_event, '92fdcd00-0000-4000-8000-000000000001'
  );
  PERFORM public.p3e_assert(v_del.outcome = 'deleted', 'an event with venue plan entries deletes cleanly');
  PERFORM public.p3e_assert(NOT public.p3e_event_exists(v_da_event), 'the event is gone');
  PERFORM public.p3e_assert(
    (public.p3e_plan_facts(v_da_event)->>'count')::int = 0,
    'the venue plan rows were removed with the event'
  );

  v_audit_txt := public.p3e_deletion_audit_text();
  PERFORM public.p3e_assert(
    position('Riverbend Legion' in v_audit_txt) = 0
    AND position('Mill Road' in v_audit_txt) = 0
    AND position('fairgrounds' in v_audit_txt) = 0
    AND position('legion.example.invalid' in v_audit_txt) = 0
    AND position('Dana Whitfield' in v_audit_txt) = 0
    AND position('555 0182' in v_audit_txt) = 0
    AND position('Aunt Ruth' in v_audit_txt) = 0
    AND position('Going with this one' in v_audit_txt) = 0
    AND position('selected' in v_audit_txt) = 0,
    'the deletion audit contains no place name, address, website, contact name, phone, status, or note'
  );

  -- Bob's untouched draft still lists nothing -- isolation held throughout.
  PERFORM set_config('request.jwt.claim.sub', '92f00000-0000-4000-8000-000000000002', true);
  SELECT count(*) INTO v_list_count FROM public.list_my_private_draft_venue_plans(v_db_event);
  PERFORM public.p3e_assert(v_list_count = 0, 'the other organizer''s draft was never written to');

  RAISE NOTICE 'ALL P-3E ORGANIZER PRIVATE-DRAFT VENUE PLAN ASSERTIONS PASSED';
END;
$fixture$;

ROLLBACK;
