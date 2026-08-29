-- Optimistic save-time concurrency protection for Admin Events.
--
-- app/admin/events/page.tsx currently saves Event Details with a direct
-- public.events.update(payload).eq('id', form.id) -- matched only by id --
-- and saves the Master Map + Nearby List assignments as two independent
-- writes through Promise.all (event_map_settings.upsert +
-- events.update(selected_nearby_area_id)). Neither path has a save-time
-- concurrency check, and the two assignment writes are not atomic, so a
-- stale editor can silently overwrite a newer administrator's values, and
-- one assignment write can land while the other fails.
--
-- public.events has no reliable updated_at / version / revision column and
-- event_map_settings.updated_at is not reliable concurrency metadata
-- (diagnosis). Following the Admin Agenda precedent's spirit -- a governed
-- DB operation that atomically verifies expectation before mutating and
-- raises a recognizable stale signal -- but per the product decision using
-- NARROW BASELINE COMPARE-AND-SWAP on the fields each editor owns, not a
-- new global event_configuration_version.
--
-- Authority: SECURITY DEFINER, matching the dominant repository convention
-- for governed Event operations. Both functions require
-- has_event_admin_authority(auth.uid(), p_event_id) -- byte-for-byte the
-- same predicate public.events UPDATE RLS already enforces
-- (20260813140000_reconcile_events_rls_grant_drift.sql) and the same
-- effective authority the page's own AdminRouteGuard + canAccessEvent
-- gate already require. This neither weakens nor broadens any boundary:
-- events / event_map_settings RLS and grants are untouched; no bridge
-- policy is added. The assignments function additionally routes the
-- event_map_settings write through this event-scoped check rather than
-- that table's looser privilege-group RLS -- a tightening confined to this
-- governed path, never a broadening.
--
-- Additive only. No historical migration modified. No table / RLS / grant
-- change. Coordinates and NULL/cleared assignments are compared and
-- written NULL-safely.

BEGIN;

-- ============================================================
-- Event Details: baseline compare-and-swap.
--
-- Compares only the columns this editor's full Details save can
-- overwrite, against the baseline the editor loaded. Coordinates are only
-- compared and written when the editor's coordinate-persistence plan is
-- write/clear (p_write_coordinates = true); a "preserve" save does not own
-- the lat/lng columns and must neither conflict on nor rewrite them.
-- selected_nearby_area_id and every other column are deliberately NOT
-- touched here -- the Assignments editor owns those.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_save_event_details_guarded(
  p_event_id uuid,
  -- proposed values
  p_name text,
  p_location text,
  p_start_date date,
  p_end_date date,
  p_event_code text,
  p_status text,
  p_is_active boolean,
  p_visible_to_members boolean,
  p_write_coordinates boolean,
  p_lat numeric,
  p_lng numeric,
  -- expected persisted baseline (as originally loaded by this editor)
  p_expected_name text,
  p_expected_location text,
  p_expected_start_date date,
  p_expected_end_date date,
  p_expected_event_code text,
  p_expected_status text,
  p_expected_is_active boolean,
  p_expected_visible_to_members boolean,
  p_expected_lat numeric,
  p_expected_lng numeric
)
RETURNS public.events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_current public.events%ROWTYPE;
  v_updated public.events%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  IF NOT public.has_event_admin_authority(v_actor, p_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'malformed_event';
  END IF;

  IF p_is_active IS NULL OR p_visible_to_members IS NULL THEN
    RAISE EXCEPTION 'malformed_event';
  END IF;

  SELECT e.* INTO v_current
  FROM public.events AS e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  IF v_current.name IS DISTINCT FROM p_expected_name
     OR v_current.location IS DISTINCT FROM p_expected_location
     OR v_current.start_date IS DISTINCT FROM p_expected_start_date
     OR v_current.end_date IS DISTINCT FROM p_expected_end_date
     OR v_current.event_code IS DISTINCT FROM p_expected_event_code
     OR v_current.status IS DISTINCT FROM p_expected_status
     OR v_current.is_active IS DISTINCT FROM p_expected_is_active
     OR v_current.visible_to_members IS DISTINCT FROM p_expected_visible_to_members
     OR (
       coalesce(p_write_coordinates, false)
       AND (
         v_current.lat IS DISTINCT FROM p_expected_lat
         OR v_current.lng IS DISTINCT FROM p_expected_lng
       )
     )
  THEN
    RAISE EXCEPTION 'stale_event_details';
  END IF;

  UPDATE public.events AS e
  SET name = p_name,
      location = p_location,
      start_date = p_start_date,
      end_date = p_end_date,
      event_code = p_event_code,
      status = p_status,
      is_active = p_is_active,
      visible_to_members = p_visible_to_members,
      lat = CASE WHEN coalesce(p_write_coordinates, false) THEN p_lat ELSE e.lat END,
      lng = CASE WHEN coalesce(p_write_coordinates, false) THEN p_lng ELSE e.lng END
  WHERE e.id = p_event_id
  RETURNING e.* INTO v_updated;

  RETURN v_updated;
END;
$$;

ALTER FUNCTION public.admin_save_event_details_guarded(
  uuid, text, text, date, date, text, text, boolean, boolean, boolean,
  numeric, numeric, text, text, date, date, text, text, boolean, boolean,
  numeric, numeric
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_save_event_details_guarded(
  uuid, text, text, date, date, text, text, boolean, boolean, boolean,
  numeric, numeric, text, text, date, date, text, text, boolean, boolean,
  numeric, numeric
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.admin_save_event_details_guarded(
  uuid, text, text, date, date, text, text, boolean, boolean, boolean,
  numeric, numeric, text, text, date, date, text, text, boolean, boolean,
  numeric, numeric
) TO authenticated;

-- ============================================================
-- Event Assignments: atomic dual baseline compare-and-swap.
--
-- Verifies BOTH the persisted Master Map assignment
-- (event_map_settings.selected_master_map_id) and the persisted Nearby
-- List assignment (events.selected_nearby_area_id) against the editor's
-- baselines. If either differs, mutates NEITHER. If both match, writes
-- both in this single function's transaction. NULL means "no assignment"
-- for both baselines and both writes; a missing event_map_settings row is
-- treated as the NULL Master Map baseline and self-healed on write.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_save_event_assignments_guarded(
  p_event_id uuid,
  p_master_map_id uuid,
  p_nearby_list_id uuid,
  p_expected_master_map_id uuid,
  p_expected_nearby_list_id uuid
)
RETURNS TABLE(persisted_master_map_id uuid, persisted_nearby_list_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_current_nearby uuid;
  v_current_map uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  IF NOT public.has_event_admin_authority(v_actor, p_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Lock the Event row; confirms it exists and serializes concurrent
  -- assignment saves for this Event against each other.
  SELECT e.selected_nearby_area_id INTO v_current_nearby
  FROM public.events AS e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- Lock the map-settings row when present; its absence is the NULL
  -- (never-configured) Master Map baseline.
  SELECT ems.selected_master_map_id INTO v_current_map
  FROM public.event_map_settings AS ems
  WHERE ems.event_id = p_event_id
  FOR UPDATE;

  IF v_current_nearby IS DISTINCT FROM p_expected_nearby_list_id
     OR v_current_map IS DISTINCT FROM p_expected_master_map_id
  THEN
    RAISE EXCEPTION 'stale_event_assignments';
  END IF;

  UPDATE public.events AS e
  SET selected_nearby_area_id = p_nearby_list_id
  WHERE e.id = p_event_id;

  INSERT INTO public.event_map_settings (event_id, selected_master_map_id)
  VALUES (p_event_id, p_master_map_id)
  ON CONFLICT ON CONSTRAINT event_map_settings_event_id_key DO UPDATE
  SET selected_master_map_id = excluded.selected_master_map_id,
      updated_at = now();

  RETURN QUERY
  SELECT
    (SELECT ems.selected_master_map_id
       FROM public.event_map_settings AS ems
      WHERE ems.event_id = p_event_id),
    (SELECT e.selected_nearby_area_id
       FROM public.events AS e
      WHERE e.id = p_event_id);
END;
$$;

ALTER FUNCTION public.admin_save_event_assignments_guarded(uuid, uuid, uuid, uuid, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_save_event_assignments_guarded(uuid, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.admin_save_event_assignments_guarded(uuid, uuid, uuid, uuid, uuid)
  TO authenticated;

COMMIT;
