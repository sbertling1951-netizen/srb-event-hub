-- Synthetic-only behavior proof after 20261025000000. Run on a disposable
-- fully replayed local database with psql -v ON_ERROR_STOP=1. No real IDs.
-- Real identity resolver, RLS roles and optional-sharing writer; no mocks.
BEGIN;
SET LOCAL plpgsql.check_asserts = on;

DO $fixture$
DECLARE
  tenant_a uuid := gen_random_uuid();
  tenant_b uuid := gen_random_uuid();
  event_a uuid := gen_random_uuid();
  event_b uuid := gen_random_uuid();
  caller_id uuid := gen_random_uuid();
  v_person_id uuid := gen_random_uuid();
  user_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  target_id uuid;
  all_ids uuid[] := ARRAY[caller_id];
  token text := repeat('a', 43);
  token_arg text := '__TEA_CAPABILITY__:' || repeat('a', 43);
  prefs_before jsonb;
  history_before jsonb;
  map_definition_before text;
  total integer;
  r record;
BEGIN
  INSERT INTO public.tenants (id, organization_code, slug, organization_name, display_name, app_title)
  VALUES (tenant_a, tenant_a::text, tenant_a::text, 'Roster fixture A', 'Roster A', 'Roster A'),
         (tenant_b, tenant_b::text, tenant_b::text, 'Roster fixture B', 'Roster B', 'Roster B');
  INSERT INTO public.events (id, name, tenant_id, visible_to_members, is_active, status)
  VALUES (event_a, 'Roster fixture A', tenant_a, true, true, 'Active'),
         (event_b, 'Roster fixture B', tenant_b, true, true, 'Active');
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (user_id, user_id::text || '@fixture.invalid', now(), 'authenticated', 'authenticated'),
         (stranger_id, stranger_id::text || '@fixture.invalid', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, status) VALUES (v_person_id, 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person_id, user_id, 'active');
  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email)
  VALUES (caller_id, event_a, 'Viewer', 'Fixture', caller_id::text || '@fixture.invalid');
  INSERT INTO public.person_role_instances (
    person_id, event_id, attendee_id, identity_role, source_table,
    source_record_id, attribution_method, evidence_source, source_role_instance_key
  ) VALUES (
    v_person_id, event_a, caller_id, 'PILOT', 'public.attendees', caller_id,
    'automatic_backfill', 'synthetic roster fixture', 'attendee_pilot:' || caller_id
  );
  INSERT INTO public.person_event_participations (person_id, event_id)
  VALUES (v_person_id, event_a) ON CONFLICT DO NOTHING;

  -- Twenty-three eligible registrations, with names regardless of optional
  -- consent. Include records with preferences absent, false, and true.
  FOR i IN 2..23 LOOP
    target_id := gen_random_uuid();
    all_ids := array_append(all_ids, target_id);
    INSERT INTO public.attendees (
      id, event_id, pilot_first, pilot_last, email, primary_phone,
      coach_manufacturer, coach_model, assigned_site
    ) VALUES (
      target_id, event_a, 'Person ' || i, 'Fixture', target_id::text || '@fixture.invalid',
      '555' || lpad(i::text, 7, '0'), 'Fixture Coach', 'Fixture Model', 'LEGACY-' || i
    );
    INSERT INTO public.parking_sites (event_id, site_number, display_label, assigned_attendee_id)
    VALUES (event_a, 'SITE-' || i, 'SITE-' || i, target_id);
    IF i <= 12 THEN
      PERFORM public._apply_attendee_sharing_preferences(
        target_id, ARRAY['email'], 'member_self_service', NULL, user_id
      );
    END IF;
  END LOOP;
  PERFORM public._apply_attendee_sharing_preferences(caller_id, ARRAY[]::text[], 'member_self_service', NULL, user_id);
  PERFORM public._apply_attendee_sharing_preferences(all_ids[13], ARRAY[]::text[], 'member_self_service', NULL, user_id);
  PERFORM public._apply_attendee_sharing_preferences(all_ids[14], ARRAY['phone'], 'member_self_service', NULL, user_id);
  PERFORM public._apply_attendee_sharing_preferences(all_ids[15], ARRAY['campsite_location'], 'member_self_service', NULL, user_id);
  PERFORM public._apply_attendee_sharing_preferences(all_ids[16], ARRAY['coach_make_model'], 'member_self_service', NULL, user_id);
  INSERT INTO public.attendees (event_id, pilot_first, pilot_last, is_active, registration_status)
  VALUES (event_a, 'Inactive', 'Excluded', false, 'registered'),
         (event_a, 'Cancelled', 'Excluded', true, 'cancelled'),
         (event_b, 'Other Event', 'Excluded', true, 'registered');

  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO prefs_before FROM public.attendee_sharing_preferences p;
  SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) INTO history_before FROM public.attendee_sharing_preference_history h;
  SELECT pg_get_functiondef('public.get_event_participant_map_roster(uuid,text,text)'::regprocedure) INTO map_definition_before;

  PERFORM set_config('request.jwt.claim.sub', user_id::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO total FROM public.get_event_attendee_locator(event_a);
  ASSERT total = 23, 'viewer who shares nothing must see all 23 eligible registration names';
  ASSERT (SELECT count(DISTINCT id) FROM public.get_event_attendee_locator(event_a)) = 23, 'one row per attendee';
  ASSERT EXISTS (SELECT 1 FROM public.get_event_attendee_locator(event_a) WHERE id = caller_id), 'own registration included';
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_event_attendee_locator(event_b)), 'no cross-Event or cross-Tenant access';
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_event_attendee_locator(NULL)), 'null Event denied';
  ASSERT (SELECT count(*) FROM public.get_event_attendee_locator(event_a) WHERE email IS NOT NULL) = 11, 'email stays opt-in';
  ASSERT (SELECT count(*) FROM public.get_event_attendee_locator(event_a) WHERE phone IS NOT NULL) = 1, 'phone stays opt-in';
  ASSERT (SELECT count(*) FROM public.get_event_attendee_locator(event_a) WHERE campsite_location IS NOT NULL) = 1, 'site stays opt-in';
  ASSERT (SELECT count(*) FROM public.get_event_attendee_locator(event_a) WHERE coach_make IS NOT NULL OR coach_model IS NOT NULL) = 1, 'coach stays opt-in';
  SELECT * INTO r FROM public.get_event_attendee_locator(event_a) WHERE id = all_ids[17];
  ASSERT r.pilot_first = 'Person 17' AND r.email IS NULL AND r.phone IS NULL
    AND r.campsite_location IS NULL AND r.coach_make IS NULL AND r.coach_model IS NULL,
    'absent preferences expose names only';
  SELECT * INTO r FROM public.get_event_attendee_locator(event_a) WHERE id = all_ids[13];
  ASSERT r.pilot_first = 'Person 13' AND r.email IS NULL AND r.phone IS NULL
    AND r.campsite_location IS NULL AND r.coach_make IS NULL AND r.coach_model IS NULL,
    'false preferences expose names only';
  ASSERT (SELECT campsite_location FROM public.get_event_attendee_locator(event_a) WHERE id = all_ids[15]) = 'SITE-15', 'canonical site, never legacy label';
  ASSERT NOT has_table_privilege('authenticated', 'public.attendee_sharing_preferences', 'SELECT'), 'no direct preference table grant';
  RESET ROLE;

  ASSERT prefs_before = (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.attendee_sharing_preferences p), 'reads preserve every preference byte';
  ASSERT history_before = (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM public.attendee_sharing_preference_history h), 'reads preserve every history byte';
  ASSERT map_definition_before = pg_get_functiondef('public.get_event_participant_map_roster(uuid,text,text)'::regprocedure), 'separate governed map RPC is unchanged';
  ASSERT to_regprocedure('public.get_event_public_roster(uuid)') IS NULL, 'retired anonymous attendee feed stays absent';

  PERFORM set_config('request.jwt.claim.sub', stranger_id::text, true);
  SET LOCAL ROLE authenticated;
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_event_attendee_locator(event_a)), 'unrelated account denied';
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_event_attendee_locator(event_a)), 'anonymous Event UUID alone grants nothing';
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_event_attendee_locator(event_a, NULL, '__TEA_CAPABILITY__:bad')), 'malformed capability denied';
  RESET ROLE;

  INSERT INTO public.temporary_member_capabilities (capability_hash, event_id, tenant_id, attendee_id, expires_at)
  VALUES (encode(extensions.digest(token, 'sha256'), 'hex'), event_a, tenant_a, caller_id, now() + interval '1 hour');
  SET LOCAL ROLE anon;
  ASSERT (SELECT count(*) FROM public.get_event_attendee_locator(event_a, NULL, token_arg)) = 23, 'valid temporary viewer needs no optional consent';
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_event_attendee_locator(event_b, NULL, token_arg)), 'capability cannot cross Events';
  RESET ROLE;
  UPDATE public.temporary_member_capabilities SET revoked_at = now() WHERE attendee_id = caller_id;
  SET LOCAL ROLE anon;
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_event_attendee_locator(event_a, NULL, token_arg)), 'revoked capability denied';
  RESET ROLE;
  UPDATE public.temporary_member_capabilities SET revoked_at = NULL, expires_at = now() - interval '1 second' WHERE attendee_id = caller_id;
  SET LOCAL ROLE anon;
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_event_attendee_locator(event_a, NULL, token_arg)), 'expired capability denied';
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', user_id::text, true);
  UPDATE public.attendees SET registration_status = 'cancelled' WHERE id = caller_id;
  SET LOCAL ROLE authenticated;
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_event_attendee_locator(event_a)), 'cancelled viewer denied even if identity resolves';
  RESET ROLE;
  UPDATE public.attendees SET registration_status = 'registered', is_active = false WHERE id = caller_id;
  SET LOCAL ROLE authenticated;
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_event_attendee_locator(event_a)), 'inactive viewer denied';
  RESET ROLE;
  UPDATE public.attendees SET is_active = true WHERE id = caller_id;
  UPDATE public.events SET visible_to_members = false WHERE id = event_a;
  SET LOCAL ROLE authenticated;
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_event_attendee_locator(event_a)), 'hidden Event operational gate retained';
  RESET ROLE;
  UPDATE public.events SET visible_to_members = true, is_active = false WHERE id = event_a;
  SET LOCAL ROLE authenticated;
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_event_attendee_locator(event_a)), 'inactive Event operational gate retained';
  RESET ROLE;
  UPDATE public.events SET is_active = true WHERE id = event_a;
  UPDATE public.tenants SET is_active = false WHERE id = tenant_a;
  SET LOCAL ROLE authenticated;
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_event_attendee_locator(event_a)), 'inactive Tenant denied';
  RESET ROLE;
  UPDATE public.tenants SET is_active = true WHERE id = tenant_a;
  UPDATE public.person_event_participations SET participation_state = 'revoked', revoked_at = now(), revoked_reason = 'fixture'
  WHERE person_id = v_person_id AND event_id = event_a;
  SET LOCAL ROLE authenticated;
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_event_attendee_locator(event_a)), 'revoked participation denied';
  RESET ROLE;
  RAISE NOTICE 'PASS: roster names, optional masks, identities, isolation, consent preservation, separate map contract';
END;
$fixture$;

ROLLBACK;
