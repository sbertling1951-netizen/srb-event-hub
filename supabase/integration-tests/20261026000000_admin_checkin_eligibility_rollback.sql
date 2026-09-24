-- Synthetic-only behavior proof for 20261026000000 (Admin Check-In
-- registration eligibility). Run on a disposable fully replayed local database
-- with psql -v ON_ERROR_STOP=1. No real IDs, names or production data.
-- Exercises the real complete_admin_checkin, the real authority resolver and
-- the real lifecycle guard; nothing is mocked. Asserts, then rolls back.
BEGIN;
SET LOCAL plpgsql.check_asserts = on;

DO $fixture$
DECLARE
  v_tenant uuid := gen_random_uuid();
  v_other_tenant uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_other_event uuid := gen_random_uuid();
  v_archived_event uuid := gen_random_uuid();
  v_actor_user uuid := gen_random_uuid();
  v_stranger_user uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_stranger_admin uuid := gen_random_uuid();
  v_access uuid := gen_random_uuid();
  v_stranger_access uuid := gen_random_uuid();
  v_waiting uuid;
  v_arrived uuid;
  v_parked uuid;
  v_cancelled uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid();
  v_waitlisted uuid := gen_random_uuid();
  v_other_attendee uuid := gen_random_uuid();
  v_archived_attendee uuid := gen_random_uuid();
  v_total integer;
  v_eligible integer;
  v_before public.attendees;
  v_after public.attendees;
  v_prefs_before jsonb;
  v_prefs_after jsonb;
  v_history_before jsonb;
  v_history_after jsonb;
  r record;
  v_raised text;
BEGIN
  -- ---------------------------------------------------------------- setup ---
  INSERT INTO public.tenants (id, organization_code, slug, organization_name,
                              display_name, app_title, is_active)
  VALUES (v_tenant, v_tenant::text, v_tenant::text, 'Checkin fixture',
          'Checkin', 'Checkin', true),
         (v_other_tenant, v_other_tenant::text, v_other_tenant::text, 'Other fixture',
          'Other', 'Other', true);

  INSERT INTO public.events (id, name, tenant_id, lifecycle_state, end_date,
                             timezone, is_active)
  VALUES (v_event, 'Checkin fixture event', v_tenant, 'operational',
          (now() + interval '30 days')::date, 'America/Denver', true),
         (v_other_event, 'Other fixture event', v_tenant, 'operational',
          (now() + interval '30 days')::date, 'America/Denver', true),
         (v_archived_event, 'Archived fixture event', v_tenant, 'archived',
          (now() - interval '400 days')::date, 'America/Denver', true);

  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_actor_user, v_actor_user::text || '@fixture.invalid', now(),
          'authenticated', 'authenticated'),
         (v_stranger_user, v_stranger_user::text || '@fixture.invalid', now(),
          'authenticated', 'authenticated');

  INSERT INTO public.admin_users (id, user_id, email, is_active)
  VALUES (v_admin, v_actor_user, v_actor_user::text || '@fixture.invalid', true),
         (v_stranger_admin, v_stranger_user, v_stranger_user::text || '@fixture.invalid', true);

  -- The actor holds event.checkin.manage on all three fixture Events, so every
  -- rejection below is proved to come from the guard under test rather than
  -- from a missing grant.
  INSERT INTO public.admin_event_access (id, admin_user_id, event_id, role)
  VALUES (v_access, v_admin, v_event, 'event_admin'),
         (gen_random_uuid(), v_admin, v_other_event, 'event_admin'),
         (gen_random_uuid(), v_admin, v_archived_event, 'event_admin');
  INSERT INTO public.admin_event_permissions (admin_event_access_id, permission_key, is_enabled)
  SELECT aea.id, task_key, true
  FROM public.admin_event_access AS aea
  -- event.attendees.view is granted only so the Admin operational-summary
  -- cross-check below can run under its own separate authority; it is not part
  -- of the Check-In write path.
  CROSS JOIN (VALUES ('event.checkin.manage'), ('event.attendees.view')) AS t(task_key)
  WHERE aea.admin_user_id = v_admin;

  -- The stranger admin is assigned to the Event but NOT granted check-in.
  INSERT INTO public.admin_event_access (id, admin_user_id, event_id, role)
  VALUES (v_stranger_access, v_stranger_admin, v_event, 'event_admin');

  -- 23 loaded registrations: 22 eligible, 1 cancelled. Names are synthetic.
  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last,
                                is_active, registration_status)
  SELECT gen_random_uuid(), v_event, 'Pilot', 'Fixture' || lpad(i::text, 2, '0'),
         true, 'registered'
  FROM generate_series(1, 20) AS g(i);

  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last,
                                is_active, registration_status, has_arrived,
                                arrival_status)
  VALUES (gen_random_uuid(), v_event, 'Pilot', 'FixtureArrived', true,
          'registered', true, 'arrived'),
         (gen_random_uuid(), v_event, 'Pilot', 'FixtureParked', true,
          'registered', true, 'parked');

  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last,
                                is_active, registration_status, cancelled_at)
  VALUES (v_cancelled, v_event, 'Pilot', 'FixtureCancelled', true,
          'cancelled', now());

  -- Additional ineligible / boundary records, kept out of the 23-record count
  -- so the headline arithmetic stays exactly 23 total and 22 eligible.
  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last,
                                is_active, registration_status)
  VALUES (v_inactive, v_other_event, 'Pilot', 'FixtureInactive', false, 'registered'),
         (v_waitlisted, v_other_event, 'Pilot', 'FixtureWaitlisted', true, 'waitlisted'),
         (v_other_attendee, v_other_event, 'Pilot', 'FixtureOther', true, 'registered'),
         (v_archived_attendee, v_archived_event, 'Pilot', 'FixtureArchived', true, 'registered');

  SELECT a.id INTO v_waiting FROM public.attendees AS a
  WHERE a.event_id = v_event AND a.pilot_last = 'Fixture01';
  SELECT a.id INTO v_arrived FROM public.attendees AS a
  WHERE a.event_id = v_event AND a.pilot_last = 'FixtureArrived';
  SELECT a.id INTO v_parked FROM public.attendees AS a
  WHERE a.event_id = v_event AND a.pilot_last = 'FixtureParked';

  PERFORM set_config('request.jwt.claim.sub', v_actor_user::text, true);

  -- ------------------------------------------- 23 total / 22 eligible ---
  SELECT count(*) INTO v_total
  FROM public.attendees AS a WHERE a.event_id = v_event;
  SELECT count(*) INTO v_eligible
  FROM public.attendees AS a
  WHERE a.event_id = v_event
    AND a.is_active IS TRUE
    AND a.registration_status IS DISTINCT FROM 'cancelled';
  ASSERT v_total = 23, 'expected 23 loaded registrations, got ' || v_total;
  ASSERT v_eligible = 22, 'expected 22 eligible registrations, got ' || v_eligible;

  -- The Admin operational summary must still report the same 22, proving the
  -- Check-In rule and the Admin figure agree rather than diverging.
  SELECT s.active_registrations INTO v_eligible
  FROM public.get_event_operational_summary(v_event) AS s;
  ASSERT v_eligible = 22,
    'Admin summary must still report 22 active registrations, got ' || v_eligible;

  -- --------------------------------------------- eligible arrival works ---
  SELECT * INTO r FROM public.complete_admin_checkin(v_waiting, v_event, true, false);
  ASSERT r.outcome = 'applied', 'eligible arrival must be applied, got ' || r.outcome;
  ASSERT r.rejection_code IS NULL, 'applied arrival must carry no rejection code';
  ASSERT r.has_arrived IS TRUE, 'eligible arrival must record has_arrived';
  ASSERT r.arrival_status = 'arrived', 'eligible arrival must set arrived, got ' || r.arrival_status;

  -- ------------------------------------------------------- undo works ---
  SELECT * INTO r FROM public.complete_admin_checkin(v_waiting, v_event, false, false);
  ASSERT r.outcome = 'applied', 'undo must be applied, got ' || r.outcome;
  ASSERT r.has_arrived IS FALSE, 'undo must clear has_arrived';
  ASSERT r.arrival_status = 'not_arrived', 'undo must set not_arrived, got ' || r.arrival_status;

  -- --------------------------------------- parked state is preserved ---
  SELECT * INTO r FROM public.complete_admin_checkin(v_parked, v_event, true, false);
  ASSERT r.outcome = 'applied', 'parked attendee arrival must be applied';
  ASSERT r.arrival_status = 'parked',
    'an already-parked attendee must stay parked, got ' || r.arrival_status;

  -- ------------------------- eligible already-arrived record still works ---
  SELECT * INTO r FROM public.complete_admin_checkin(v_arrived, v_event, true, false);
  ASSERT r.outcome = 'applied', 'eligible arrived record must remain actionable';
  ASSERT r.arrival_status = 'arrived', 'arrived must stay arrived, got ' || r.arrival_status;

  -- ------------------------------------------- cancelled is rejected ---
  SELECT a.* INTO v_before FROM public.attendees AS a WHERE a.id = v_cancelled;
  SELECT * INTO r FROM public.complete_admin_checkin(v_cancelled, v_event, true, true);
  ASSERT r.outcome = 'rejected', 'a cancelled registration must be rejected, got ' || r.outcome;
  ASSERT r.rejection_code = 'registration_not_current',
    'expected registration_not_current, got ' || coalesce(r.rejection_code, '<null>');
  SELECT a.* INTO v_after FROM public.attendees AS a WHERE a.id = v_cancelled;
  ASSERT v_after IS NOT DISTINCT FROM v_before,
    'a rejected check-in must leave the stored row byte-identical';
  ASSERT v_after.has_arrived IS NOT TRUE, 'a cancelled registration must not be marked arrived';
  ASSERT v_after.registration_status = 'cancelled', 'cancellation must be preserved';
  ASSERT v_after.cancelled_at IS NOT NULL, 'cancellation metadata must be preserved';

  -- --------------------------------------------- inactive is rejected ---
  SELECT a.* INTO v_before FROM public.attendees AS a WHERE a.id = v_inactive;
  SELECT * INTO r FROM public.complete_admin_checkin(v_inactive, v_other_event, true, false);
  ASSERT r.outcome = 'rejected', 'an inactive record must be rejected, got ' || r.outcome;
  ASSERT r.rejection_code = 'registration_not_current',
    'inactive must reject with registration_not_current';
  SELECT a.* INTO v_after FROM public.attendees AS a WHERE a.id = v_inactive;
  ASSERT v_after IS NOT DISTINCT FROM v_before,
    'a rejected inactive check-in must not mutate the row';

  -- ---------------- a non-cancelled status keeps its Admin eligibility ---
  SELECT * INTO r FROM public.complete_admin_checkin(v_waitlisted, v_other_event, true, false);
  ASSERT r.outcome = 'applied',
    'a non-cancelled status must retain existing Admin eligibility, got ' || r.outcome;
  ASSERT r.arrival_status = 'arrived', 'waitlisted arrival must record arrived';

  -- ------------------------- cancellation after selection is rejected ---
  -- The operator loaded and selected this record while it was eligible; the
  -- registration is cancelled before they submit.
  SELECT a.* INTO v_before FROM public.attendees AS a WHERE a.id = v_arrived;
  ASSERT v_before.registration_status IS DISTINCT FROM 'cancelled',
    'precondition: the selected record starts eligible';
  UPDATE public.attendees SET registration_status = 'cancelled', cancelled_at = now()
  WHERE id = v_arrived;
  SELECT a.* INTO v_before FROM public.attendees AS a WHERE a.id = v_arrived;
  SELECT * INTO r FROM public.complete_admin_checkin(v_arrived, v_event, false, false);
  ASSERT r.outcome = 'rejected',
    'cancellation after selection must be rejected, got ' || r.outcome;
  ASSERT r.rejection_code = 'registration_not_current',
    'cancellation after selection must use the distinct code';
  SELECT a.* INTO v_after FROM public.attendees AS a WHERE a.id = v_arrived;
  ASSERT v_after IS NOT DISTINCT FROM v_before,
    'a rejected submission must not revert or alter prior arrival history';
  ASSERT v_after.has_arrived IS TRUE,
    'the arrival recorded while the record was eligible must survive';

  -- ------------------- rejection leaves sharing and history untouched ---
  SELECT coalesce(jsonb_agg(to_jsonb(p.*) ORDER BY p.field_key), '[]'::jsonb)
  INTO v_prefs_before
  FROM public.attendee_sharing_preferences AS p WHERE p.attendee_id = v_cancelled;
  SELECT coalesce(jsonb_agg(to_jsonb(h.*)), '[]'::jsonb) INTO v_history_before
  FROM public.attendee_sharing_preference_history AS h WHERE h.attendee_id = v_cancelled;
  -- p_share_with_attendees true must not create consent for a rejected target.
  SELECT * INTO r FROM public.complete_admin_checkin(v_cancelled, v_event, true, true);
  ASSERT r.outcome = 'rejected', 'cancelled must still reject with sharing requested';
  SELECT coalesce(jsonb_agg(to_jsonb(p.*) ORDER BY p.field_key), '[]'::jsonb)
  INTO v_prefs_after
  FROM public.attendee_sharing_preferences AS p WHERE p.attendee_id = v_cancelled;
  SELECT coalesce(jsonb_agg(to_jsonb(h.*)), '[]'::jsonb) INTO v_history_after
  FROM public.attendee_sharing_preference_history AS h WHERE h.attendee_id = v_cancelled;
  ASSERT v_prefs_after = v_prefs_before, 'rejection must not change sharing preferences';
  ASSERT v_history_after = v_history_before, 'rejection must not append sharing history';
  SELECT a.* INTO v_after FROM public.attendees AS a WHERE a.id = v_cancelled;
  ASSERT v_after.share_with_attendees IS NOT TRUE,
    'rejection must not set the legacy sharing projection either';

  -- ------------------------------ pre-existing guards remain intact ---
  -- attendee_not_found still precedes eligibility.
  v_raised := NULL;
  BEGIN
    PERFORM public.complete_admin_checkin(gen_random_uuid(), v_event, true, false);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  ASSERT v_raised = 'attendee_not_found', 'expected attendee_not_found, got ' || coalesce(v_raised, '<none>');

  -- Event scope mismatch.
  v_raised := NULL;
  BEGIN
    PERFORM public.complete_admin_checkin(v_waiting, v_other_event, true, false);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  ASSERT v_raised = 'event_scope_mismatch', 'expected event_scope_mismatch, got ' || coalesce(v_raised, '<none>');

  -- Archived Event lifecycle still refuses before any eligibility decision.
  v_raised := NULL;
  BEGIN
    PERFORM public.complete_admin_checkin(v_archived_attendee, v_archived_event, true, false);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  ASSERT v_raised = 'event_archived', 'expected event_archived, got ' || coalesce(v_raised, '<none>');

  -- Missing task authority still refuses.
  PERFORM set_config('request.jwt.claim.sub', v_stranger_user::text, true);
  v_raised := NULL;
  BEGIN
    PERFORM public.complete_admin_checkin(v_waiting, v_event, true, false);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  ASSERT v_raised = 'authorization_denied', 'expected authorization_denied, got ' || coalesce(v_raised, '<none>');

  -- An unauthenticated actor still refuses.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_raised := NULL;
  BEGIN
    PERFORM public.complete_admin_checkin(v_waiting, v_event, true, false);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  ASSERT v_raised = 'unauthorized', 'expected unauthorized, got ' || coalesce(v_raised, '<none>');

  -- An authority failure must also leave the target untouched.
  SELECT a.* INTO v_after FROM public.attendees AS a WHERE a.id = v_waiting;
  ASSERT v_after.has_arrived IS FALSE,
    'the undone eligible record must remain not-arrived after refused attempts';

  RAISE NOTICE 'admin check-in eligibility fixture: all assertions passed';
END
$fixture$;

ROLLBACK;
