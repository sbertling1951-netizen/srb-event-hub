-- Stage: Retire one pre-governance legacy duplicate Branson parking_sites
-- row -- linked proof.
--
-- Installs the exact parity block (the retirement function) inside one
-- outer transaction, exercises it against synthetic fixture rows only --
-- the successful retirement path, the idempotent no-op re-run, and every
-- fail-closed abort path -- then rolls everything back. Executed once
-- against a disposable local database (npm run db:verify-replay stack);
-- NOT run against production.
--
-- The parity-block function's own guards are intentionally id-specific
-- (they target one exact, already-approved production row, never a
-- general heuristic), so this fixture necessarily creates its own local,
-- entirely synthetic rows keyed on those SAME four id constants -- this
-- is the only way to exercise the real shipped function rather than a
-- parallel, unfaithful copy of it. Every other column on every fixture
-- row is synthetic fixture content (fake names, fake dates, fake site
-- labels) -- no production row content beyond the bare opaque ids the
-- migration itself already necessarily hardcodes appears anywhere here.

BEGIN;

-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

CREATE FUNCTION public.retire_branson_legacy_duplicate_parking_site()
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_event_id CONSTANT uuid := '853f6934-8672-4219-ad59-520482098577';
  v_target_id CONSTANT uuid := '1469d1dc-95d3-4f07-a4b5-158d2128eec5';
  v_survivor_id CONSTANT uuid := 'dbc28a24-d408-4748-a481-74b8270f8464';
  v_canonical_master_site_id CONSTANT uuid := 'a14b9029-de88-4086-823a-2d0f9c1b4c3f';
  v_target public.parking_sites%ROWTYPE;
  v_survivor public.parking_sites%ROWTYPE;
  v_history_count integer;
  v_identity_correction_count integer;
BEGIN
  -- Guard 1: idempotent / fresh-replay-safe no-op if the target is gone.
  SELECT * INTO v_target FROM public.parking_sites WHERE id = v_target_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Guard 2: target must remain scoped to the intended Event.
  IF v_target.event_id <> v_event_id THEN
    RAISE EXCEPTION
      'branson_parking_duplicate_retirement_event_mismatch: target row exists but is no longer scoped to the expected Event.';
  END IF;

  -- Guard 3: target must remain vacant.
  IF v_target.assigned_attendee_id IS NOT NULL THEN
    RAISE EXCEPTION
      'branson_parking_duplicate_retirement_target_occupied: target row is no longer vacant.';
  END IF;

  -- Guard 4: target must remain the unlinked legacy duplicate.
  IF v_target.master_site_id IS NOT NULL THEN
    RAISE EXCEPTION
      'branson_parking_duplicate_retirement_target_linked: target row now has a master_site_id -- no longer the unlinked legacy duplicate this repair targets.';
  END IF;

  -- Guard 5: exact survivor row must still exist.
  SELECT * INTO v_survivor FROM public.parking_sites WHERE id = v_survivor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'branson_parking_duplicate_retirement_survivor_missing: expected survivor row no longer exists.';
  END IF;

  -- Guard 6: survivor must remain scoped to the intended Event.
  IF v_survivor.event_id <> v_event_id THEN
    RAISE EXCEPTION
      'branson_parking_duplicate_retirement_survivor_event_mismatch: survivor row is no longer scoped to the expected Event.';
  END IF;

  -- Guard 7: survivor must remain vacant.
  IF v_survivor.assigned_attendee_id IS NOT NULL THEN
    RAISE EXCEPTION
      'branson_parking_duplicate_retirement_survivor_occupied: survivor row is no longer vacant.';
  END IF;

  -- Guard 8: survivor must remain linked to the expected canonical site.
  IF v_survivor.master_site_id IS DISTINCT FROM v_canonical_master_site_id THEN
    RAISE EXCEPTION
      'branson_parking_duplicate_retirement_survivor_relink: survivor row no longer links to the expected canonical master site.';
  END IF;

  -- Guard 9: the canonical master site must still belong to the Event's
  -- currently-selected map -- never assumed from Guard 8 alone.
  IF NOT EXISTS (
    SELECT 1
    FROM public.master_map_sites AS mms
    JOIN public.event_map_settings AS ems ON ems.selected_master_map_id = mms.master_map_id
    WHERE ems.event_id = v_event_id
      AND mms.id = v_canonical_master_site_id
  ) THEN
    RAISE EXCEPTION
      'branson_parking_duplicate_retirement_canonical_site_unresolved: the canonical master site is no longer part of the Event''s selected map.';
  END IF;

  -- Guard 10: target and survivor must remain the same physical site, by
  -- the already-proven legacy metadata relationship (all four fields).
  IF NOT EXISTS (
    SELECT 1
    FROM public.master_map_sites AS mms
    WHERE mms.id = v_canonical_master_site_id
      AND mms.site_number IS NOT DISTINCT FROM v_target.site_number
      AND mms.display_label IS NOT DISTINCT FROM v_target.display_label
      AND mms.map_x IS NOT DISTINCT FROM v_target.map_x
      AND mms.map_y IS NOT DISTINCT FROM v_target.map_y
  ) THEN
    RAISE EXCEPTION
      'branson_parking_duplicate_retirement_metadata_mismatch: target row''s legacy metadata no longer matches the canonical master site.';
  END IF;

  -- Guard 11: no site_placement_history reference to the target through
  -- any of its four parking-site columns.
  SELECT count(*) INTO v_history_count
  FROM public.site_placement_history AS sph
  WHERE sph.previous_site_id = v_target_id
     OR sph.resulting_site_id = v_target_id
     OR sph.requested_site_id = v_target_id
     OR sph.displaced_previous_site_id = v_target_id;

  IF v_history_count > 0 THEN
    RAISE EXCEPTION
      'branson_parking_duplicate_retirement_history_reference: % placement-history row(s) reference the target row -- retirement aborted.',
      v_history_count;
  END IF;

  -- Guard 12: no master_site_identity_correction reference to the target.
  SELECT count(*) INTO v_identity_correction_count
  FROM public.master_site_identity_correction AS msc
  WHERE msc.parking_site_id = v_target_id;

  IF v_identity_correction_count > 0 THEN
    RAISE EXCEPTION
      'branson_parking_duplicate_retirement_identity_correction_reference: % identity-correction row(s) reference the target row -- retirement aborted.',
      v_identity_correction_count;
  END IF;

  -- All preconditions hold: retire exactly the one target row.
  DELETE FROM public.parking_sites WHERE id = v_target_id;
END;
$function$;

-- PARITY END
-- ============================================================

CREATE FUNCTION public.stage_branson_parking_fixture_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'stage_branson_parking_fixture_assertion_failed: %', p_message;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Baseline row counts on tables this repair must never touch, captured
-- before any fixture setup runs.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_attendees_count integer;
  v_history_count integer;
  v_identity_correction_count integer;
  v_nearby_areas_count integer;
  v_nearby_templates_count integer;
BEGIN
  SELECT count(*) INTO v_attendees_count FROM public.attendees;
  SELECT count(*) INTO v_history_count FROM public.site_placement_history;
  SELECT count(*) INTO v_identity_correction_count FROM public.master_site_identity_correction;
  SELECT count(*) INTO v_nearby_areas_count FROM public.nearby_areas;
  SELECT count(*) INTO v_nearby_templates_count FROM public.nearby_area_templates;

  PERFORM set_config('stage_branson_parking.attendees_count', v_attendees_count::text, false);
  PERFORM set_config('stage_branson_parking.history_count', v_history_count::text, false);
  PERFORM set_config('stage_branson_parking.identity_correction_count', v_identity_correction_count::text, false);
  PERFORM set_config('stage_branson_parking.nearby_areas_count', v_nearby_areas_count::text, false);
  PERFORM set_config('stage_branson_parking.nearby_templates_count', v_nearby_templates_count::text, false);
END;
$$;

-- ---------------------------------------------------------------------------
-- Fixture setup: a synthetic Tenant/Event/Master Map/master_map_sites row
-- and the two parking_sites rows (target + survivor), using the exact
-- same ids the parity-block function's constants target. Every other
-- field is entirely synthetic fixture content.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant_id uuid := gen_random_uuid();
  v_event_id CONSTANT uuid := '853f6934-8672-4219-ad59-520482098577';
  v_target_id CONSTANT uuid := '1469d1dc-95d3-4f07-a4b5-158d2128eec5';
  v_survivor_id CONSTANT uuid := 'dbc28a24-d408-4748-a481-74b8270f8464';
  v_canonical_master_site_id CONSTANT uuid := 'a14b9029-de88-4086-823a-2d0f9c1b4c3f';
  v_master_map_id uuid;
BEGIN
  INSERT INTO public.tenants (id, organization_code, slug, organization_name, display_name, app_title)
  VALUES (v_tenant_id, 'FIX-' || left(v_tenant_id::text, 8), 'fix-' || left(v_tenant_id::text, 8), 'Fixture Org', 'Fixture Org', 'Fixture');

  INSERT INTO public.events (id, tenant_id, name, start_date, end_date, timezone, lifecycle_state)
  VALUES (v_event_id, v_tenant_id, 'Fixture Branson-Shaped Event', current_date, current_date + 4, 'UTC', 'operational');

  INSERT INTO public.master_maps (name)
  VALUES ('Fixture Master Map')
  RETURNING id INTO v_master_map_id;

  INSERT INTO public.event_map_settings (event_id, selected_master_map_id)
  VALUES (v_event_id, v_master_map_id);

  INSERT INTO public.master_map_sites (id, master_map_id, site_number, display_label, map_x, map_y)
  VALUES (v_canonical_master_site_id, v_master_map_id, 'F-01', 'Fixture Site F-01', 10, 20);

  -- Survivor: already correctly linked, vacant, no display metadata of
  -- its own (matching production's actual shape -- display fields come
  -- from master_map_sites once linked, per parkingReconciliation.ts).
  INSERT INTO public.parking_sites (id, event_id, master_site_id, assigned_attendee_id)
  VALUES (v_survivor_id, v_event_id, v_canonical_master_site_id, NULL);

  -- Target: unlinked legacy duplicate, vacant, carrying the matching
  -- legacy display metadata.
  INSERT INTO public.parking_sites (id, event_id, master_site_id, site_number, display_label, map_x, map_y, assigned_attendee_id)
  VALUES (v_target_id, v_event_id, NULL, 'F-01', 'Fixture Site F-01', 10, 20, NULL);
END;
$$;

SAVEPOINT after_fixture_setup;

-- ---------------------------------------------------------------------------
-- SCENARIO 1: successful retirement -- target deleted, survivor untouched.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_target_id CONSTANT uuid := '1469d1dc-95d3-4f07-a4b5-158d2128eec5';
  v_survivor_id CONSTANT uuid := 'dbc28a24-d408-4748-a481-74b8270f8464';
  v_canonical_master_site_id CONSTANT uuid := 'a14b9029-de88-4086-823a-2d0f9c1b4c3f';
  v_survivor_master_site_id uuid;
  v_survivor_occupant uuid;
BEGIN
  PERFORM public.retire_branson_legacy_duplicate_parking_site();

  PERFORM public.stage_branson_parking_fixture_assert(
    NOT EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_target_id),
    'target row must be deleted after a successful retirement'
  );

  SELECT master_site_id, assigned_attendee_id INTO v_survivor_master_site_id, v_survivor_occupant
  FROM public.parking_sites WHERE id = v_survivor_id;

  PERFORM public.stage_branson_parking_fixture_assert(
    v_survivor_master_site_id = v_canonical_master_site_id,
    'survivor row must remain exactly as inserted -- master_site_id unchanged'
  );
  PERFORM public.stage_branson_parking_fixture_assert(
    v_survivor_occupant IS NULL,
    'survivor row must remain vacant, exactly as inserted'
  );
END;
$$;

SAVEPOINT after_successful_retirement;

-- ---------------------------------------------------------------------------
-- SCENARIO 2: re-running once the target is already gone is a harmless,
-- idempotent no-op (fresh-replay safe).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_survivor_id CONSTANT uuid := 'dbc28a24-d408-4748-a481-74b8270f8464';
  v_before integer;
  v_after integer;
BEGIN
  SELECT count(*) INTO v_before FROM public.parking_sites;
  PERFORM public.retire_branson_legacy_duplicate_parking_site();
  SELECT count(*) INTO v_after FROM public.parking_sites;

  PERFORM public.stage_branson_parking_fixture_assert(
    v_before = v_after,
    'a no-op re-run must not change the parking_sites row count'
  );
  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_survivor_id),
    'survivor row must still exist after the no-op re-run'
  );
END;
$$;

ROLLBACK TO SAVEPOINT after_fixture_setup;

-- ---------------------------------------------------------------------------
-- SCENARIO 3: target becomes occupied -> abort, nothing deleted.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event_id CONSTANT uuid := '853f6934-8672-4219-ad59-520482098577';
  v_target_id CONSTANT uuid := '1469d1dc-95d3-4f07-a4b5-158d2128eec5';
  v_attendee_id uuid;
BEGIN
  INSERT INTO public.attendees (event_id, pilot_first, pilot_last)
  VALUES (v_event_id, 'Fixture', 'Occupant')
  RETURNING id INTO v_attendee_id;

  UPDATE public.parking_sites SET assigned_attendee_id = v_attendee_id WHERE id = v_target_id;

  BEGIN
    PERFORM public.retire_branson_legacy_duplicate_parking_site();
    RAISE EXCEPTION 'occupied-target run should have aborted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage_branson_parking_fixture_assert(
      SQLERRM LIKE 'branson_parking_duplicate_retirement_target_occupied%',
      'expected the target-occupied guard to fire'
    );
  END;

  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_target_id),
    'target row must still exist after an aborted run'
  );
END;
$$;

ROLLBACK TO SAVEPOINT after_fixture_setup;

-- ---------------------------------------------------------------------------
-- SCENARIO 4: target gains a placement-history reference -> abort.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event_id CONSTANT uuid := '853f6934-8672-4219-ad59-520482098577';
  v_target_id CONSTANT uuid := '1469d1dc-95d3-4f07-a4b5-158d2128eec5';
  v_attendee_id uuid;
  v_actor_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.attendees (event_id, pilot_first, pilot_last)
  VALUES (v_event_id, 'Fixture', 'HistoryAttendee')
  RETURNING id INTO v_attendee_id;

  INSERT INTO auth.users (id, email)
  VALUES (v_actor_id, 'fixture-actor-' || v_actor_id || '@fixture.invalid');

  INSERT INTO public.site_placement_history (
    operation_id, event_sequence, event_id, attendee_id, action,
    requested_site_id, outcome, evidence_source, actor_auth_user_id, authority_basis, idempotency_key
  )
  VALUES (
    gen_random_uuid(), 1, v_event_id, v_attendee_id, 'assign',
    v_target_id, 'applied', 'parking_staff', v_actor_id, 'parking_manage', gen_random_uuid()
  );

  BEGIN
    PERFORM public.retire_branson_legacy_duplicate_parking_site();
    RAISE EXCEPTION 'history-referenced-target run should have aborted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage_branson_parking_fixture_assert(
      SQLERRM LIKE 'branson_parking_duplicate_retirement_history_reference%',
      'expected the history-reference guard to fire'
    );
  END;

  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_target_id),
    'target row must still exist after an aborted run'
  );
END;
$$;

ROLLBACK TO SAVEPOINT after_fixture_setup;

-- ---------------------------------------------------------------------------
-- SCENARIO 5: survivor no longer linked to the expected canonical site
-- (relinked/unlinked elsewhere) -> abort.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_survivor_id CONSTANT uuid := 'dbc28a24-d408-4748-a481-74b8270f8464';
  v_target_id CONSTANT uuid := '1469d1dc-95d3-4f07-a4b5-158d2128eec5';
BEGIN
  UPDATE public.parking_sites SET master_site_id = NULL WHERE id = v_survivor_id;

  BEGIN
    PERFORM public.retire_branson_legacy_duplicate_parking_site();
    RAISE EXCEPTION 'survivor-relink run should have aborted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage_branson_parking_fixture_assert(
      SQLERRM LIKE 'branson_parking_duplicate_retirement_survivor_relink%',
      'expected the survivor-relink guard to fire'
    );
  END;

  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_target_id),
    'target row must still exist after an aborted run'
  );
END;
$$;

ROLLBACK TO SAVEPOINT after_fixture_setup;

-- ---------------------------------------------------------------------------
-- SCENARIO 6: survivor missing entirely -> abort.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_survivor_id CONSTANT uuid := 'dbc28a24-d408-4748-a481-74b8270f8464';
  v_target_id CONSTANT uuid := '1469d1dc-95d3-4f07-a4b5-158d2128eec5';
BEGIN
  DELETE FROM public.parking_sites WHERE id = v_survivor_id;

  BEGIN
    PERFORM public.retire_branson_legacy_duplicate_parking_site();
    RAISE EXCEPTION 'missing-survivor run should have aborted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage_branson_parking_fixture_assert(
      SQLERRM LIKE 'branson_parking_duplicate_retirement_survivor_missing%',
      'expected the survivor-missing guard to fire'
    );
  END;

  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_target_id),
    'target row must still exist after an aborted run'
  );
END;
$$;

ROLLBACK TO SAVEPOINT after_fixture_setup;

-- ---------------------------------------------------------------------------
-- SCENARIO 7: target's legacy metadata no longer matches the canonical
-- master site on all four fields -> abort.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_target_id CONSTANT uuid := '1469d1dc-95d3-4f07-a4b5-158d2128eec5';
BEGIN
  UPDATE public.parking_sites SET site_number = 'F-99-DRIFTED' WHERE id = v_target_id;

  BEGIN
    PERFORM public.retire_branson_legacy_duplicate_parking_site();
    RAISE EXCEPTION 'metadata-mismatch run should have aborted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage_branson_parking_fixture_assert(
      SQLERRM LIKE 'branson_parking_duplicate_retirement_metadata_mismatch%',
      'expected the metadata-mismatch guard to fire'
    );
  END;

  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_target_id),
    'target row must still exist after an aborted run'
  );
END;
$$;

ROLLBACK TO SAVEPOINT after_fixture_setup;

-- ---------------------------------------------------------------------------
-- SCENARIO 8: target no longer scoped to the intended Event -> abort.
-- Minimal state: one extra synthetic Event/Tenant to reassign the target
-- to; target stays otherwise pristine (vacant, unlinked), so this is the
-- first guard the run can reach.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_target_id CONSTANT uuid := '1469d1dc-95d3-4f07-a4b5-158d2128eec5';
  v_other_tenant_id uuid := gen_random_uuid();
  v_other_event_id uuid;
BEGIN
  INSERT INTO public.tenants (id, organization_code, slug, organization_name, display_name, app_title)
  VALUES (v_other_tenant_id, 'FIX2-' || left(v_other_tenant_id::text, 8), 'fix2-' || left(v_other_tenant_id::text, 8), 'Fixture Org 2', 'Fixture Org 2', 'Fixture');

  INSERT INTO public.events (tenant_id, name)
  VALUES (v_other_tenant_id, 'Fixture Other Event')
  RETURNING id INTO v_other_event_id;

  UPDATE public.parking_sites SET event_id = v_other_event_id WHERE id = v_target_id;

  BEGIN
    PERFORM public.retire_branson_legacy_duplicate_parking_site();
    RAISE EXCEPTION 'target-event-mismatch run should have aborted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage_branson_parking_fixture_assert(
      SQLERRM LIKE 'branson_parking_duplicate_retirement_event_mismatch%',
      'expected the target-event-mismatch guard to fire'
    );
  END;

  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_target_id),
    'target row must still exist after an aborted run'
  );
  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = 'dbc28a24-d408-4748-a481-74b8270f8464'::uuid),
    'survivor row must still exist after an aborted run'
  );
END;
$$;

ROLLBACK TO SAVEPOINT after_fixture_setup;

-- ---------------------------------------------------------------------------
-- SCENARIO 9: target gains a master_site_id (no longer unlinked) -> abort.
-- Minimal state: one extra master_map_sites row on the same fixture map,
-- distinct from the canonical site, so linking the target to it does not
-- collide with the survivor's own (event_id, master_site_id) pair.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_target_id CONSTANT uuid := '1469d1dc-95d3-4f07-a4b5-158d2128eec5';
  v_master_map_id uuid;
  v_decoy_site_id uuid;
BEGIN
  SELECT master_map_id INTO v_master_map_id
  FROM public.master_map_sites WHERE id = 'a14b9029-de88-4086-823a-2d0f9c1b4c3f'::uuid;

  INSERT INTO public.master_map_sites (master_map_id, site_number)
  VALUES (v_master_map_id, 'F-02-DECOY')
  RETURNING id INTO v_decoy_site_id;

  UPDATE public.parking_sites SET master_site_id = v_decoy_site_id WHERE id = v_target_id;

  BEGIN
    PERFORM public.retire_branson_legacy_duplicate_parking_site();
    RAISE EXCEPTION 'target-linked run should have aborted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage_branson_parking_fixture_assert(
      SQLERRM LIKE 'branson_parking_duplicate_retirement_target_linked%',
      'expected the target-linked guard to fire'
    );
  END;

  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_target_id),
    'target row must still exist after an aborted run'
  );
  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = 'dbc28a24-d408-4748-a481-74b8270f8464'::uuid),
    'survivor row must still exist after an aborted run'
  );
END;
$$;

ROLLBACK TO SAVEPOINT after_fixture_setup;

-- ---------------------------------------------------------------------------
-- SCENARIO 10: survivor no longer scoped to the intended Event -> abort.
-- Minimal state: one extra synthetic Event/Tenant to reassign the
-- survivor to; target stays pristine, so every guard before Guard 6
-- passes and this is the first one the run can reach.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_target_id CONSTANT uuid := '1469d1dc-95d3-4f07-a4b5-158d2128eec5';
  v_survivor_id CONSTANT uuid := 'dbc28a24-d408-4748-a481-74b8270f8464';
  v_other_tenant_id uuid := gen_random_uuid();
  v_other_event_id uuid;
BEGIN
  INSERT INTO public.tenants (id, organization_code, slug, organization_name, display_name, app_title)
  VALUES (v_other_tenant_id, 'FIX3-' || left(v_other_tenant_id::text, 8), 'fix3-' || left(v_other_tenant_id::text, 8), 'Fixture Org 3', 'Fixture Org 3', 'Fixture');

  INSERT INTO public.events (tenant_id, name)
  VALUES (v_other_tenant_id, 'Fixture Other Event 2')
  RETURNING id INTO v_other_event_id;

  UPDATE public.parking_sites SET event_id = v_other_event_id WHERE id = v_survivor_id;

  BEGIN
    PERFORM public.retire_branson_legacy_duplicate_parking_site();
    RAISE EXCEPTION 'survivor-event-mismatch run should have aborted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage_branson_parking_fixture_assert(
      SQLERRM LIKE 'branson_parking_duplicate_retirement_survivor_event_mismatch%',
      'expected the survivor-event-mismatch guard to fire'
    );
  END;

  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_target_id),
    'target row must still exist after an aborted run'
  );
  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_survivor_id),
    'survivor row must still exist after an aborted run'
  );
END;
$$;

ROLLBACK TO SAVEPOINT after_fixture_setup;

-- ---------------------------------------------------------------------------
-- SCENARIO 11: survivor becomes occupied -> abort.
-- Minimal state: one extra attendee in the intended Event, assigned to
-- the survivor; target and the survivor's Event/link stay pristine.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event_id CONSTANT uuid := '853f6934-8672-4219-ad59-520482098577';
  v_target_id CONSTANT uuid := '1469d1dc-95d3-4f07-a4b5-158d2128eec5';
  v_survivor_id CONSTANT uuid := 'dbc28a24-d408-4748-a481-74b8270f8464';
  v_attendee_id uuid;
BEGIN
  INSERT INTO public.attendees (event_id, pilot_first, pilot_last)
  VALUES (v_event_id, 'Fixture', 'SurvivorOccupant')
  RETURNING id INTO v_attendee_id;

  UPDATE public.parking_sites SET assigned_attendee_id = v_attendee_id WHERE id = v_survivor_id;

  BEGIN
    PERFORM public.retire_branson_legacy_duplicate_parking_site();
    RAISE EXCEPTION 'survivor-occupied run should have aborted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage_branson_parking_fixture_assert(
      SQLERRM LIKE 'branson_parking_duplicate_retirement_survivor_occupied%',
      'expected the survivor-occupied guard to fire'
    );
  END;

  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_target_id),
    'target row must still exist after an aborted run'
  );
  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_survivor_id),
    'survivor row must still exist after an aborted run'
  );
END;
$$;

ROLLBACK TO SAVEPOINT after_fixture_setup;

-- ---------------------------------------------------------------------------
-- SCENARIO 12: the canonical master site no longer belongs to the
-- Event's currently-selected Master Map -> abort. Minimal state: one
-- extra, otherwise-empty Master Map, reselected onto the Event -- the
-- survivor's own master_site_id column is untouched, so Guard 8 still
-- passes and Guard 9's re-resolution against the map is what fails.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event_id CONSTANT uuid := '853f6934-8672-4219-ad59-520482098577';
  v_target_id CONSTANT uuid := '1469d1dc-95d3-4f07-a4b5-158d2128eec5';
  v_survivor_id CONSTANT uuid := 'dbc28a24-d408-4748-a481-74b8270f8464';
  v_other_map_id uuid;
BEGIN
  INSERT INTO public.master_maps (name)
  VALUES ('Fixture Other Master Map')
  RETURNING id INTO v_other_map_id;

  UPDATE public.event_map_settings SET selected_master_map_id = v_other_map_id WHERE event_id = v_event_id;

  BEGIN
    PERFORM public.retire_branson_legacy_duplicate_parking_site();
    RAISE EXCEPTION 'canonical-site-unresolved run should have aborted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage_branson_parking_fixture_assert(
      SQLERRM LIKE 'branson_parking_duplicate_retirement_canonical_site_unresolved%',
      'expected the canonical-site-unresolved guard to fire'
    );
  END;

  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_target_id),
    'target row must still exist after an aborted run'
  );
  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_survivor_id),
    'survivor row must still exist after an aborted run'
  );
END;
$$;

ROLLBACK TO SAVEPOINT after_fixture_setup;

-- ---------------------------------------------------------------------------
-- SCENARIO 13: a master_site_identity_correction row references the
-- target -> abort. Minimal state: one extra, otherwise-empty Master Map
-- (a distinct old/new map pair is required by that table's own CHECK
-- constraint) plus one draft correction row pointing its
-- parking_site_id at the target; target/survivor stay pristine, so
-- every guard before Guard 12 passes.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event_id CONSTANT uuid := '853f6934-8672-4219-ad59-520482098577';
  v_target_id CONSTANT uuid := '1469d1dc-95d3-4f07-a4b5-158d2128eec5';
  v_survivor_id CONSTANT uuid := 'dbc28a24-d408-4748-a481-74b8270f8464';
  v_canonical_master_site_id CONSTANT uuid := 'a14b9029-de88-4086-823a-2d0f9c1b4c3f';
  v_master_map_id uuid;
  v_other_map_id uuid;
BEGIN
  SELECT master_map_id INTO v_master_map_id
  FROM public.master_map_sites WHERE id = v_canonical_master_site_id;

  INSERT INTO public.master_maps (name)
  VALUES ('Fixture Correction-Only Master Map')
  RETURNING id INTO v_other_map_id;

  INSERT INTO public.master_site_identity_correction (
    parking_site_id, event_id, expected_old_master_site_id, expected_old_map_id,
    expected_new_map_id, proposed_new_master_site_id, before_state, proposal_time_proof
  )
  VALUES (
    v_target_id, v_event_id, v_canonical_master_site_id, v_master_map_id,
    v_other_map_id, v_canonical_master_site_id, '{}'::jsonb, '{}'::jsonb
  );

  BEGIN
    PERFORM public.retire_branson_legacy_duplicate_parking_site();
    RAISE EXCEPTION 'identity-correction-referenced run should have aborted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage_branson_parking_fixture_assert(
      SQLERRM LIKE 'branson_parking_duplicate_retirement_identity_correction_reference%',
      'expected the identity-correction-reference guard to fire'
    );
  END;

  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_target_id),
    'target row must still exist after an aborted run'
  );
  PERFORM public.stage_branson_parking_fixture_assert(
    EXISTS (SELECT 1 FROM public.parking_sites WHERE id = v_survivor_id),
    'survivor row must still exist after an aborted run'
  );
END;
$$;

ROLLBACK TO SAVEPOINT after_fixture_setup;

-- ---------------------------------------------------------------------------
-- Final proof: no row was ever added to, removed from, or otherwise
-- touched on any out-of-scope table across the entire exercise above.
-- (events/event_map_settings/master_maps/master_map_sites are this
-- fixture's own necessary synthetic setup for the id-specific function
-- under test, not out-of-scope tables -- their content is asserted
-- correct by the per-scenario checks above instead.)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public.stage_branson_parking_fixture_assert(
    (SELECT count(*) FROM public.attendees) = current_setting('stage_branson_parking.attendees_count')::integer,
    'attendees row count must be unchanged'
  );
  PERFORM public.stage_branson_parking_fixture_assert(
    (SELECT count(*) FROM public.site_placement_history) = current_setting('stage_branson_parking.history_count')::integer,
    'site_placement_history row count must be unchanged'
  );
  PERFORM public.stage_branson_parking_fixture_assert(
    (SELECT count(*) FROM public.master_site_identity_correction) = current_setting('stage_branson_parking.identity_correction_count')::integer,
    'master_site_identity_correction row count must be unchanged'
  );
  PERFORM public.stage_branson_parking_fixture_assert(
    (SELECT count(*) FROM public.nearby_areas) = current_setting('stage_branson_parking.nearby_areas_count')::integer,
    'nearby_areas row count must be unchanged'
  );
  PERFORM public.stage_branson_parking_fixture_assert(
    (SELECT count(*) FROM public.nearby_area_templates) = current_setting('stage_branson_parking.nearby_templates_count')::integer,
    'nearby_area_templates row count must be unchanged'
  );
END;
$$;

ROLLBACK;
