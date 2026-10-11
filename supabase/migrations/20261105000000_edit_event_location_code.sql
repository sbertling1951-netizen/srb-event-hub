BEGIN;
DROP FUNCTION public.admin_save_event_details_guarded(uuid, text, text, date, date, text, text, boolean, boolean, boolean,
  numeric, numeric, text, text, date, date, text, text, boolean, boolean,
  numeric, numeric);
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
  p_expected_lng numeric,
  p_location_code text DEFAULT NULL,
  p_expected_location_code text DEFAULT NULL,
  p_write_location_code boolean DEFAULT false
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
     OR (coalesce(p_write_location_code, false) AND v_current.location_code IS DISTINCT FROM p_expected_location_code)
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
      location_code = CASE WHEN coalesce(p_write_location_code, false) THEN nullif(btrim(p_location_code), '') ELSE e.location_code END,
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
  numeric, numeric, text, text, boolean
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_save_event_details_guarded(
  uuid, text, text, date, date, text, text, boolean, boolean, boolean,
  numeric, numeric, text, text, date, date, text, text, boolean, boolean,
  numeric, numeric, text, text, boolean
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.admin_save_event_details_guarded(
  uuid, text, text, date, date, text, text, boolean, boolean, boolean,
  numeric, numeric, text, text, date, date, text, text, boolean, boolean,
  numeric, numeric, text, text, boolean
) TO authenticated;

COMMIT;
