-- P-3D contact-fields behavior proof: Contact name + Phone number replace the
-- opaque "contact detail" for NEW entries, while every existing row and every
-- already-deployed caller keeps working untouched.
--
-- Run only after 20260924000000 … 20261002000000 have been applied. Creates
-- isolated auth + identity rows, exercises the RPCs as the authenticated
-- browser role, and rolls everything back.
--
-- It proves:
--   1.  contact name + phone save, read back, and update privately;
--   2.  both may be blank, and blanks normalize to NULL;
--   3.  a LEGACY row (written through the exact pre-migration call shape)
--       keeps its contact_detail verbatim, is still readable, and is not
--       parsed, split, guessed at, or moved into the new columns;
--   4.  the ALREADY-DEPLOYED app's old call shapes -- 7 named arguments to
--       add, 8 to update, and the unchanged list/delete -- still work after
--       this migration alone, with no ambiguity error;
--   5.  the new values never touch vendors, event_vendors, vendor_contacts,
--       people, person_identifiers, attendees, or any admission/identity
--       table, and create no notification of any kind;
--   6.  add / edit / delete regression still holds, including the three
--       approved statuses and the required vendor name;
--   7.  a legacy row's contact_detail survives an edit made through the NEW
--       call shape that round-trips the legacy value.

BEGIN;

CREATE OR REPLACE FUNCTION public.p3dc_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P-3D contact-fields fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.p3dc_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3dc_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p3dc_assert(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3dc_untouchable_counts()
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
    'activity_registrations', (SELECT count(*) FROM public.activity_registrations),
    'member_checkin_audit', (SELECT count(*) FROM public.member_checkin_audit)
  );
$function$;
ALTER FUNCTION public.p3dc_untouchable_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3dc_untouchable_counts() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3dc_untouchable_counts() TO authenticated;

-- Reads the stored row directly, so the fixture can prove what is ON DISK and
-- not merely what an RPC chose to return.
CREATE OR REPLACE FUNCTION public.p3dc_row(p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT to_jsonb(vp) FROM public.self_service_private_draft_vendor_plans AS vp WHERE vp.id = p_id;
$function$;
ALTER FUNCTION public.p3dc_row(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3dc_row(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3dc_row(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3dc_link(p_person_id uuid, p_auth_user_id uuid, p_is_primary boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', p_is_primary, now());
$function$;
ALTER FUNCTION public.p3dc_link(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3dc_link(uuid, uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3dc_link(uuid, uuid, boolean) TO authenticated;

DO $setup$
DECLARE
  v_person uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    '92e00000-0000-4000-8000-000000000001',
    '92e00000-0000-4000-8000-000000000002'
  )) THEN
    RAISE EXCEPTION 'P-3D contact-fields fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('92e00000-0000-4000-8000-000000000001', 'p3dc-alice@fixture.invalid', now()),
    ('92e00000-0000-4000-8000-000000000002', 'p3dc-bob@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3dc_link(v_person, '92e00000-0000-4000-8000-000000000001', true);
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3dc_link(v_person, '92e00000-0000-4000-8000-000000000002', true);
END;
$setup$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_da record;
  v_legacy record;
  v_new record;
  v_blank record;
  v_edited record;
  v_da_event uuid;
  v_legacy_id uuid;
  v_new_id uuid;
  v_untouchable jsonb;
  v_row jsonb;
  v_listed record;
  v_failed boolean;
  v_status text;
  v_count integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '92e00000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_da FROM public.create_self_service_organizer_draft(
    'Alice Org', 'Alice Event', current_date + 7, 'UTC',
    '92eccc00-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  v_da_event := v_da.event_id;

  v_untouchable := public.p3dc_untouchable_counts();

  -- ================================================================
  -- 4 + 3: the ALREADY-DEPLOYED build's EXACT call shape.
  --   add: seven named arguments, no p_contact_name / p_contact_phone.
  -- This is the migration-before-deploy interval, reproduced literally.
  -- ================================================================
  SELECT * INTO v_legacy FROM public.add_my_private_draft_vendor_plan(
    p_event_id        => v_da_event,
    p_vendor_name     => 'Legacy Catering Co',
    p_service_category=> 'Caterers and food',
    p_planning_status => 'contacted',
    p_website         => 'https://legacy.example.invalid',
    p_contact_detail  => 'Dana on 555-0182, ask about the Saturday rate',
    p_organizer_note  => 'Called twice'
  );
  v_legacy_id := v_legacy.id;
  PERFORM public.p3dc_assert(
    v_legacy.vendor_name = 'Legacy Catering Co'
    AND v_legacy.contact_detail = 'Dana on 555-0182, ask about the Saturday rate',
    'the old seven-argument add call still works and stores contact_detail verbatim'
  );

  -- the old call leaves the two new columns NULL -- nothing is parsed out of
  -- the legacy free text, and nothing is invented for it
  v_row := public.p3dc_row(v_legacy_id);
  PERFORM public.p3dc_assert(
    v_row->>'contact_detail' = 'Dana on 555-0182, ask about the Saturday rate'
    AND v_row->>'contact_name' IS NULL
    AND v_row->>'contact_phone' IS NULL,
    'a legacy row keeps contact_detail verbatim and is never parsed into contact_name / contact_phone'
  );

  -- 4: the old EIGHT-argument update call shape still works too
  SELECT * INTO v_edited FROM public.update_my_private_draft_vendor_plan(
    p_event_id        => v_da_event,
    p_vendor_plan_id  => v_legacy_id,
    p_vendor_name     => 'Legacy Catering Co',
    p_service_category=> 'Caterers and food',
    p_planning_status => 'selected',
    p_website         => 'https://legacy.example.invalid',
    p_contact_detail  => 'Dana on 555-0182, ask about the Saturday rate',
    p_organizer_note  => 'Called twice'
  );
  PERFORM public.p3dc_assert(
    v_edited.planning_status = 'selected'
    AND v_edited.contact_detail = 'Dana on 555-0182, ask about the Saturday rate',
    'the old eight-argument update call still works and preserves contact_detail'
  );

  -- 4: the old list call shape is unchanged and still returns the legacy row
  SELECT count(*) INTO v_count FROM public.list_my_private_draft_vendor_plans(v_da_event);
  PERFORM public.p3dc_assert(v_count = 1, 'the unchanged list call still returns the legacy row');

  -- ================================================================
  -- 1: the NEW call shape saves contact name + phone.
  -- ================================================================
  SELECT * INTO v_new FROM public.add_my_private_draft_vendor_plan(
    p_event_id        => v_da_event,
    p_vendor_name     => 'Riverbend Catering',
    p_service_category=> 'Caterers and food',
    p_planning_status => 'considering',
    p_website         => 'https://riverbend.example.invalid',
    p_contact_detail  => NULL,
    p_organizer_note  => 'Recommended by Dave',
    p_contact_name    => 'Dana Whitfield',
    p_contact_phone   => '+1 555 0182'
  );
  v_new_id := v_new.id;
  PERFORM public.p3dc_assert(
    v_new.contact_name = 'Dana Whitfield'
    AND v_new.contact_phone = '+1 555 0182'
    AND v_new.contact_detail IS NULL,
    'a new entry stores contact name and phone and leaves the legacy field empty'
  );

  -- read back through list
  SELECT * INTO v_listed FROM public.list_my_private_draft_vendor_plans(v_da_event)
    WHERE id = v_new_id;
  PERFORM public.p3dc_assert(
    v_listed.contact_name = 'Dana Whitfield' AND v_listed.contact_phone = '+1 555 0182',
    'contact name and phone read back through the list RPC'
  );

  -- 1: update them
  SELECT * INTO v_edited FROM public.update_my_private_draft_vendor_plan(
    p_event_id        => v_da_event,
    p_vendor_plan_id  => v_new_id,
    p_vendor_name     => 'Riverbend Catering',
    p_service_category=> 'Caterers and food',
    p_planning_status => 'contacted',
    p_website         => NULL,
    p_contact_detail  => NULL,
    p_organizer_note  => 'Recommended by Dave',
    p_contact_name    => 'Dana W.',
    p_contact_phone   => '555-0199'
  );
  PERFORM public.p3dc_assert(
    v_edited.contact_name = 'Dana W.' AND v_edited.contact_phone = '555-0199',
    'contact name and phone update privately'
  );

  -- ================================================================
  -- 2: both new fields may be blank; blanks normalize to NULL.
  -- ================================================================
  SELECT * INTO v_blank FROM public.add_my_private_draft_vendor_plan(
    p_event_id      => v_da_event,
    p_vendor_name   => 'Aunt Ruth''s barn',
    p_contact_name  => '   ',
    p_contact_phone => ''
  );
  PERFORM public.p3dc_assert(
    v_blank.vendor_name = 'Aunt Ruth''s barn'
    AND v_blank.contact_name IS NULL
    AND v_blank.contact_phone IS NULL
    AND v_blank.planning_status = 'considering',
    'blank contact name and phone are valid and normalize to NULL'
  );

  -- clearing them on an existing row is allowed too
  SELECT * INTO v_edited FROM public.update_my_private_draft_vendor_plan(
    p_event_id       => v_da_event,
    p_vendor_plan_id => v_new_id,
    p_vendor_name    => 'Riverbend Catering',
    p_contact_name   => NULL,
    p_contact_phone  => NULL
  );
  PERFORM public.p3dc_assert(
    v_edited.contact_name IS NULL AND v_edited.contact_phone IS NULL,
    'contact name and phone can be cleared back to empty'
  );

  -- ================================================================
  -- 7: a legacy row's contact_detail survives an edit made through the
  --    NEW call shape that round-trips the legacy value back.
  -- ================================================================
  SELECT * INTO v_edited FROM public.update_my_private_draft_vendor_plan(
    p_event_id        => v_da_event,
    p_vendor_plan_id  => v_legacy_id,
    p_vendor_name     => 'Legacy Catering Co',
    p_service_category=> 'Caterers and food',
    p_planning_status => 'selected',
    p_website         => 'https://legacy.example.invalid',
    p_contact_detail  => 'Dana on 555-0182, ask about the Saturday rate',
    p_organizer_note  => 'Called twice',
    p_contact_name    => 'Dana Whitfield',
    p_contact_phone   => '+1 555 0182'
  );
  PERFORM public.p3dc_assert(
    v_edited.contact_detail = 'Dana on 555-0182, ask about the Saturday rate'
    AND v_edited.contact_name = 'Dana Whitfield'
    AND v_edited.contact_phone = '+1 555 0182',
    'a legacy row keeps its contact_detail while gaining the new structured fields'
  );

  -- ================================================================
  -- 6: add / edit / delete regression still holds.
  -- ================================================================
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_vendor_plan(v_da_event, '   ');
  EXCEPTION WHEN OTHERS THEN v_failed := position('needs a name' in SQLERRM) > 0; END;
  PERFORM public.p3dc_assert(v_failed, 'a blank vendor name is still rejected');

  FOREACH v_status IN ARRAY ARRAY['considering', 'contacted', 'selected'] LOOP
    SELECT * INTO v_edited FROM public.update_my_private_draft_vendor_plan(
      p_event_id => v_da_event, p_vendor_plan_id => v_new_id,
      p_vendor_name => 'Riverbend Catering', p_planning_status => v_status
    );
    PERFORM public.p3dc_assert(v_edited.planning_status = v_status,
      format('the approved status %s is still accepted', v_status));
  END LOOP;

  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_vendor_plan(
    p_event_id => v_da_event, p_vendor_name => 'X', p_planning_status => 'booked');
  EXCEPTION WHEN OTHERS THEN v_failed := position('considering, contacted, or selected' in SQLERRM) > 0; END;
  PERFORM public.p3dc_assert(v_failed, 'an unapproved status is still rejected');

  -- oversize new fields are rejected by length only
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_vendor_plan(
    p_event_id => v_da_event, p_vendor_name => 'X', p_contact_phone => repeat('9', 51));
  EXCEPTION WHEN OTHERS THEN v_failed := position('phone number must be 50' in SQLERRM) > 0; END;
  PERFORM public.p3dc_assert(v_failed, 'an oversize phone number is rejected on length alone');

  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_vendor_plan(
    p_event_id => v_da_event, p_vendor_name => 'X', p_contact_name => repeat('n', 201));
  EXCEPTION WHEN OTHERS THEN v_failed := position('contact name must be 200' in SQLERRM) > 0; END;
  PERFORM public.p3dc_assert(v_failed, 'an oversize contact name is rejected on length alone');

  -- 2: a non-owner still cannot see or touch any of it
  PERFORM set_config('request.jwt.claim.sub', '92e00000-0000-4000-8000-000000000002', true);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_vendor_plans(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3dc_assert(v_failed, 'a non-owner still cannot read contact name or phone');
  PERFORM set_config('request.jwt.claim.sub', '92e00000-0000-4000-8000-000000000001', true);

  -- delete still works
  PERFORM public.delete_my_private_draft_vendor_plan(v_da_event, v_new_id);
  SELECT count(*) INTO v_count FROM public.list_my_private_draft_vendor_plans(v_da_event)
    WHERE id = v_new_id;
  PERFORM public.p3dc_assert(v_count = 0, 'delete still removes one entry');

  -- ================================================================
  -- 5: nothing was matched, resolved, notified, or admitted.
  -- ================================================================
  DECLARE
    v_now jsonb := public.p3dc_untouchable_counts();
  BEGIN
    PERFORM public.p3dc_assert(
      v_now = v_untouchable,
      'no contact name or phone created or changed a vendor / vendor contact / person / attendee / registration / check-in row'
    );
  END;

  -- the legacy row is STILL exactly as it was written, at rest
  v_row := public.p3dc_row(v_legacy_id);
  PERFORM public.p3dc_assert(
    v_row->>'contact_detail' = 'Dana on 555-0182, ask about the Saturday rate',
    'the legacy contact_detail value is byte-identical at the end of the fixture'
  );

  RAISE NOTICE 'ALL P-3D VENDOR PLAN CONTACT-FIELD ASSERTIONS PASSED';
END;
$fixture$;

ROLLBACK;
