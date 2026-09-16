-- Retire one pre-governance legacy duplicate Branson parking_sites row.
--
-- WHAT WAS WRONG: a read-only diagnosis (Branson Parking / Identity Error)
-- found exactly one Branson parking_sites row with master_site_id IS NULL
-- -- a leftover from the pre-governance write path the Stage 6C sync
-- migration's own header documents ("safeSyncToSelectedEvent ... inserts
-- new rows WITHOUT master_site_id"). This is precisely the condition
-- app/admin/parking/parkingReconciliation.ts's buildCanonicalParkingSnapshot
-- checks first ("!assignment.master_site_id"), which is why Parking Admin
-- fails closed with "Canonical parking inventory contains an invalid event
-- or site identity." even after Branson's Master Map and Nearby List are
-- both correctly assigned.
--
-- A second, separate parking_sites row for the same Event already holds
-- master_site_id pointing at the exact canonical master site this legacy
-- row's own legacy display metadata (site_number, display_label, map_x,
-- map_y) matches on all four fields -- the correctly-linked survivor this
-- repair leaves untouched. Both rows are vacant. Neither
-- site_placement_history (every relevant column: previous_site_id,
-- resulting_site_id, requested_site_id, displaced_previous_site_id) nor
-- master_site_identity_correction.parking_site_id references the legacy
-- row -- confirmed by narrowly-scoped, read-only production inspection
-- immediately before this migration was written, per Pap's explicit
-- authorization for preparation of this one-record repair.
--
-- GOVERNING MODEL (approved): this is an explicit, human-approved,
-- single-record repair -- NOT a general manifest-tooling operation. The
-- existing governed repair pipeline (supabase/migrations/
-- 20260808170000_create_governed_parking_repair_tooling.sql,
-- analyze_parking_repair_candidates) was read (not invoked) during
-- diagnosis and would itself classify this exact row "excluded" /
-- "master_site_id_already_claimed", by design -- its automatic
-- direct-repair path only backfills an unclaimed master_site_id, and this
-- one is already claimed by the survivor. That fail-closed classification
-- is correct, not a defect to route around; this migration is the
-- separately-authorized, narrowly-scoped action it implies is needed.
-- sync_master_map_parking_inventory_to_event (Stage 6C) is never invoked
-- here or anywhere in this migration -- its own documented contract
-- reports (never repairs) master_site_id IS NULL rows as "manual_rows".
--
-- The exact target row, exact survivor row, exact canonical master site,
-- and exact Event are identified by their stable ids below -- never by
-- name, display-label, or a broad "all null links" heuristic. Every id is
-- production-verified but this file prints no other row content.
--
-- The reconciliation logic is written as a plain (SECURITY INVOKER)
-- function, called once by this migration and dropped again at the end of
-- the same transaction -- the same one-time-backfill-vehicle pattern
-- already established by 20261023000000's Stored Area parent-link repair,
-- for the same reason: this repo's own nested BEGIN/EXCEPTION fixture
-- idiom requires a callable function, not a bare anonymous DO block. It
-- adds no persistent schema surface: dropped before COMMIT, never
-- GRANTed to authenticated/anon/PUBLIC at any point, and is not a
-- reusable browser- or admin-callable operation.
--
-- FAIL-CLOSED, in order, before any write:
--   1. target row absent -> no-op (idempotent, safe for fresh replay);
--   2. target row present but no longer in the intended Event -> abort;
--   3. target row no longer vacant (occupied) -> abort;
--   4. target row no longer has master_site_id IS NULL -> abort;
--   5. survivor row absent -> abort;
--   6. survivor row no longer in the intended Event -> abort;
--   7. survivor row no longer vacant -> abort;
--   8. survivor row no longer linked to the expected canonical master
--      site -> abort;
--   9. the canonical master site no longer belongs to the Event's
--      currently-selected map -> abort;
--  10. target's legacy metadata (site_number, display_label, map_x,
--      map_y) no longer matches the canonical master site on all four
--      fields -> abort;
--  11. any site_placement_history row references the target through any
--      of its four parking-site columns -> abort;
--  12. any master_site_identity_correction row references the target ->
--      abort.
-- Only after every guard above passes does the function delete the one
-- target row. The survivor row, every other parking_sites row, every
-- Master Map, every master_map_sites row, event_map_settings, Nearby
-- data, attendees, and every site_placement_history /
-- master_site_identity_correction row are never written by this
-- migration under any condition.
--
-- OUT OF SCOPE, untouched by any statement below: master_maps,
-- master_map_sites, event_map_settings, nearby_areas,
-- nearby_area_templates, attendees, site_placement_history,
-- master_site_identity_correction, event_placement_sequence, every RLS
-- policy, every grant, and the pre-existing parking_sites FK/index
-- definitions themselves (all four site_placement_history FKs and
-- master_site_identity_correction's FK remain NO ACTION, providing an
-- unconditional database-level backstop behind this migration's own
-- explicit precondition checks).

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

REVOKE ALL ON FUNCTION public.retire_branson_legacy_duplicate_parking_site() FROM PUBLIC;

SELECT public.retire_branson_legacy_duplicate_parking_site();

DROP FUNCTION public.retire_branson_legacy_duplicate_parking_site();

COMMIT;
