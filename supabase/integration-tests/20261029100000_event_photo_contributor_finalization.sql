DO $$
DECLARE
  v_tenant uuid := gen_random_uuid();
  v_private_tenant uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_other_event uuid := gen_random_uuid();
  v_private_event uuid := gen_random_uuid();
  v_pilot_person uuid := gen_random_uuid();
  v_copilot_person uuid := gen_random_uuid();
  v_pilot_user uuid := gen_random_uuid();
  v_copilot_user uuid := gen_random_uuid();
  v_stranger_user uuid := gen_random_uuid();
  v_attendee uuid := gen_random_uuid();
  v_other_attendee uuid := gen_random_uuid();
  v_private_attendee uuid := gen_random_uuid();
  v_pilot_photo uuid;
  v_copilot_photo uuid;
  v_legacy_photo uuid := gen_random_uuid();
  v_private_legacy_photo uuid := gen_random_uuid();
  v_pilot_path text := v_event::text || '/' || v_attendee::text || '/pilot.jpg';
  v_copilot_path text := v_event::text || '/' || v_attendee::text || '/copilot.jpg';
  v_legacy_path text := v_event::text || '/' || v_attendee::text || '/legacy.jpg';
  v_private_legacy_path text := v_private_event::text || '/' || v_private_attendee::text || '/legacy.jpg';
  v_unreferenced_path text := v_event::text || '/' || v_attendee::text || '/unreferenced.jpg';
  v_forged_path text := v_event::text || '/' || v_other_attendee::text || '/forged.jpg';
  v_count integer;
BEGIN
  INSERT INTO public.tenants (
    id, organization_code, slug, organization_name, display_name,
    app_title, is_active, is_self_service_private_draft
  )
  VALUES (
    v_tenant, v_tenant::text, v_tenant::text, 'Photo fixture',
    'Photo fixture', 'Photo fixture', true, false
  ), (
    v_private_tenant, v_private_tenant::text, v_private_tenant::text,
    'Private photo fixture', 'Private photo fixture', 'Private photo fixture',
    true, true
  );

  INSERT INTO public.events (
    id, name, tenant_id, lifecycle_state, is_active, visible_to_members
  )
  VALUES
    (v_event, 'Photo fixture event', v_tenant, 'operational', true, true),
    (v_other_event, 'Other photo fixture event', v_tenant, 'operational', true, true),
    (v_private_event, 'Private photo fixture event', v_private_tenant, 'operational', true, true);

  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES
    (v_pilot_user, v_pilot_user::text || '@fixture.invalid', now(), 'authenticated', 'authenticated'),
    (v_copilot_user, v_copilot_user::text || '@fixture.invalid', now(), 'authenticated', 'authenticated'),
    (v_stranger_user, v_stranger_user::text || '@fixture.invalid', now(), 'authenticated', 'authenticated');

  INSERT INTO public.people (
    id, tenant_id, display_first_name, display_last_name
  )
  VALUES
    (v_pilot_person, v_tenant, 'Pilot', 'Contributor'),
    (v_copilot_person, v_tenant, 'CoPilot', 'Contributor');

  INSERT INTO public.person_auth_accounts (
    person_id, auth_user_id, status, is_primary, verified_at
  )
  VALUES
    (v_pilot_person, v_pilot_user, 'active', true, now()),
    (v_copilot_person, v_copilot_user, 'active', true, now());

  INSERT INTO public.attendees (
    id, event_id, pilot_first, pilot_last, is_active, registration_status,
    person_id
  )
  VALUES
    (v_attendee, v_event, 'Pilot', 'Fixture', true, 'registered', v_pilot_person),
    (v_other_attendee, v_other_event, 'Other', 'Fixture', true, 'registered', NULL),
    (v_private_attendee, v_private_event, 'Pilot', 'Private Fixture', true,
     'registered', v_pilot_person);

  INSERT INTO public.person_event_participations (person_id, event_id)
  VALUES
    (v_pilot_person, v_event),
    (v_copilot_person, v_event);

  INSERT INTO public.person_role_instances (
    person_id, tenant_id, event_id, attendee_id, identity_role,
    source_table, source_record_id, attribution_method, evidence_source,
    source_role_instance_key
  )
  VALUES
    (v_pilot_person, v_tenant, v_event, v_attendee, 'PILOT',
     'public.attendees', v_attendee, 'registration_lifecycle_convergence',
     'photo-finalization-fixture', 'photo-fixture-pilot-' || v_attendee),
    (v_copilot_person, v_tenant, v_event, v_attendee, 'COPILOT',
     'public.attendees', v_attendee, 'registration_lifecycle_convergence',
     'photo-finalization-fixture', 'photo-fixture-copilot-' || v_attendee);

  INSERT INTO storage.buckets (id, name, public, type)
  VALUES ('event-photos', 'event-photos', false, 'STANDARD');

  INSERT INTO storage.objects (id, bucket_id, name, owner_id, metadata)
  VALUES
    (gen_random_uuid(), 'event-photos', v_pilot_path, v_pilot_user::text, '{}'::jsonb),
    (gen_random_uuid(), 'event-photos', v_copilot_path, v_copilot_user::text, '{}'::jsonb),
    (gen_random_uuid(), 'event-photos', v_legacy_path, v_pilot_user::text, '{}'::jsonb),
    (gen_random_uuid(), 'event-photos', v_unreferenced_path, v_pilot_user::text, '{}'::jsonb),
    (gen_random_uuid(), 'event-photos', v_forged_path, v_copilot_user::text, '{}'::jsonb);

  PERFORM set_config('request.jwt.claim.sub', v_pilot_user::text, true);
  SELECT f.photo_id INTO v_pilot_photo
  FROM public.finalize_event_photo_upload(
    v_event, v_attendee, v_pilot_path, 'pilot caption'
  ) AS f;
  ASSERT v_pilot_photo IS NOT NULL, 'Pilot finalization must create a pending photo';

  PERFORM set_config('request.jwt.claim.sub', v_copilot_user::text, true);
  SELECT f.photo_id INTO v_copilot_photo
  FROM public.finalize_event_photo_upload(
    v_event, v_attendee, v_copilot_path, 'copilot caption'
  ) AS f;
  ASSERT v_copilot_photo IS NOT NULL, 'Co-Pilot finalization must create a pending photo';

  SELECT count(*) INTO v_count
  FROM public.finalize_event_photo_upload(
    v_event, v_attendee, v_pilot_path, 'forged duplicate'
  ) AS f;
  ASSERT v_count = 0, 'a second claim for an existing object must fail closed';

  SELECT count(*) INTO v_count
  FROM public.finalize_event_photo_upload(
    v_event, v_attendee, v_forged_path, 'wrong uploader'
  ) AS f;
  ASSERT v_count = 0, 'claiming another caller''s object must fail closed';

  SELECT count(*) INTO v_count
  FROM public.finalize_event_photo_upload(
    v_event, v_attendee,
    v_event::text || '/' || v_attendee::text || '/missing.jpg',
    'missing object'
  ) AS f;
  ASSERT v_count = 0, 'a nonexistent object must not finalize';

  ASSERT NOT public.can_delete_unfinalized_event_photo_object(
    v_copilot_user, v_unreferenced_path
  ), 'a different uploader must not clean up the object';
  PERFORM set_config('request.jwt.claim.sub', v_pilot_user::text, true);
  ASSERT public.can_delete_unfinalized_event_photo_object(
    v_pilot_user, v_unreferenced_path
  ), 'the uploading caller may clean up its own unreferenced object';
  ASSERT NOT public.can_delete_unfinalized_event_photo_object(
    v_pilot_user, v_pilot_path
  ), 'a finalized object must never be cleanup-eligible';

  PERFORM set_config('request.jwt.claim.sub', v_copilot_user::text, true);
  ASSERT public.is_event_photo_owner(v_copilot_photo),
    'Co-Pilot owns the Co-Pilot photo';
  ASSERT NOT public.is_event_photo_owner(v_pilot_photo),
    'Co-Pilot does not own the Pilot photo';
  ASSERT public.is_authenticated_attendee_of_event(v_copilot_user, v_event),
    'Co-Pilot retains same-Event gallery eligibility';
  ASSERT public.is_authenticated_attendee_of_event(v_pilot_user, v_event),
    'Pilot retains same-Event gallery eligibility';
  ASSERT NOT public.can_authenticated_read_event_photo_object(
    v_copilot_user, v_pilot_path
  ), 'another contributor cannot read the Pilot original through Storage';

  UPDATE public.event_photos
  SET photo_status = 'approved'
  WHERE id IN (v_pilot_photo, v_copilot_photo);

  ASSERT EXISTS (
    SELECT 1
    FROM public.read_event_photo_original_path(v_copilot_photo)
  ), 'the Co-Pilot may read the own approved original path';
  ASSERT NOT EXISTS (
    SELECT 1
    FROM public.read_event_photo_original_path(v_pilot_photo)
  ), 'the Co-Pilot may not read the Pilot original path';
  ASSERT EXISTS (
    SELECT 1
    FROM public.event_photos
    WHERE id = v_copilot_photo
      AND contributor_person_id = v_copilot_person
      AND photographer_name_snapshot = 'CoPilot Contributor'
  ), 'photographer attribution must be server-derived';

  PERFORM set_config('request.jwt.claim.sub', v_stranger_user::text, true);
  ASSERT NOT public.is_authenticated_attendee_of_event(v_stranger_user, v_event),
    'unrelated authenticated callers are not Event attendees';
  ASSERT NOT EXISTS (
    SELECT 1
    FROM public.read_event_photo_original_path(v_copilot_photo)
  ), 'unrelated callers cannot read an original path';

  PERFORM set_config('request.jwt.claim.sub', v_copilot_user::text, true);
  UPDATE public.person_event_participations
  SET participation_state = 'revoked', revoked_at = now(), revoked_reason = 'fixture revocation'
  WHERE person_id = v_copilot_person AND event_id = v_event;
  ASSERT NOT public.is_event_photo_owner(v_copilot_photo),
    'revoked participation loses existing contributor ownership';

  UPDATE public.person_event_participations
  SET participation_state = 'eligible', revoked_at = NULL, revoked_reason = NULL
  WHERE person_id = v_copilot_person AND event_id = v_event;
  UPDATE public.events
  SET visible_to_members = false, is_active = false
  WHERE id = v_event;
  ASSERT public.is_event_photo_owner(v_copilot_photo),
    'historical contributor access is independent of Event lifecycle';
  ASSERT NOT EXISTS (
    SELECT 1
    FROM public.resolve_event_photo_contributor(v_event, v_attendee)
  ), 'new uploads remain closed when the Event is inactive or hidden';

  PERFORM set_config('request.jwt.claim.sub', v_pilot_user::text, true);
  INSERT INTO public.event_photos (
    id, event_id, attendee_id, storage_path, photo_status, caption_status,
    member_caption, photographer_name_snapshot
  )
  VALUES (
    v_legacy_photo, v_event, v_attendee, v_legacy_path, 'approved', 'approved',
    'legacy', 'Legacy Pilot'
  );

  INSERT INTO public.event_photos (
    id, event_id, attendee_id, storage_path, photo_status, caption_status,
    member_caption, photographer_name_snapshot
  )
  VALUES (
    v_private_legacy_photo, v_private_event, v_private_attendee,
    v_private_legacy_path, 'approved', 'approved', 'private legacy',
    'Private Legacy Pilot'
  );

  ASSERT public.is_event_photo_owner(v_legacy_photo),
    'the Pilot retains the legacy owner path without invented attribution';

  SET LOCAL ROLE authenticated;
  ASSERT NOT EXISTS (
    SELECT 1
    FROM public.event_photos
    WHERE id = v_private_legacy_photo
  ), 'direct table access denies a legacy private-Draft photo';
  ASSERT NOT public.is_event_photo_owner(v_private_legacy_photo),
    'ownership helper denies a legacy private-Draft photo';
  ASSERT NOT EXISTS (
    SELECT 1
    FROM public.read_my_event_photo_uploads(v_private_event, v_private_attendee)
  ), 'My Uploads denies a legacy private-Draft photo';
  ASSERT EXISTS (
    SELECT 1
    FROM public.read_my_event_photo_uploads(v_event, v_attendee)
    WHERE id = v_legacy_photo
  ), 'My Uploads retains ordinary-Event legacy ownership';
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', v_copilot_user::text, true);
  ASSERT NOT public.is_event_photo_owner(v_legacy_photo),
    'a Co-Pilot sharing a registration does not own the legacy Pilot row';

  PERFORM set_config('request.jwt.claim.sub', v_pilot_user::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.event_photos (
      event_id, attendee_id, contributor_person_id, storage_path,
      photo_status, caption_status
    )
    VALUES (
      v_event, v_attendee, v_pilot_person,
      v_event::text || '/' || v_attendee::text || '/direct.jpg',
      'pending', 'pending'
    );
    ASSERT false, 'authenticated direct metadata INSERT must be denied';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
  RESET ROLE;
END;
$$;
