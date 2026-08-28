BEGIN;

CREATE OR REPLACE FUNCTION public.replace_event_nearby_from_stored_area(
  p_event_id uuid,
  p_stored_area_template_id uuid,
  p_coordinate_overrides jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (replaced_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_area_id uuid;
  v_source_count integer;
BEGIN
  IF NOT public.has_event_task_authority('event.nearby.manage', p_event_id) THEN
    RAISE EXCEPTION 'Stored Area replacement requires event.nearby.manage authority.';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(p_event_id);

  -- Serialize destructive replacements of one Event.
  PERFORM 1 FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found.', p_event_id;
  END IF;

  SELECT nearby_area_id INTO v_area_id
  FROM public.nearby_area_templates
  WHERE id = p_stored_area_template_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stored Area template % not found.', p_stored_area_template_id;
  END IF;
  IF v_area_id IS NULL THEN
    RAISE EXCEPTION 'Stored Area template % has no explicit Nearby Area parent mapping.', p_stored_area_template_id;
  END IF;

  IF jsonb_typeof(p_coordinate_overrides) <> 'array' THEN
    RAISE EXCEPTION 'Coordinate overrides must be an array.';
  END IF;

  PERFORM 1 FROM public.nearby_master WHERE area_id = v_area_id FOR SHARE;
  CREATE TEMP TABLE _stored_area_replacement_source ON COMMIT DROP AS
  SELECT nm.*, row_number() OVER (ORDER BY nm.name, nm.id)::integer AS replacement_sort_order
  FROM public.nearby_master AS nm
  WHERE nm.area_id = v_area_id;
  SELECT count(*) INTO v_source_count FROM _stored_area_replacement_source;

  -- Every override is exact, finite, legal, and belongs to this source set.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_coordinate_overrides) AS o(source_master_id uuid, lat numeric, lng numeric)
    LEFT JOIN _stored_area_replacement_source AS s ON s.id = o.source_master_id
    WHERE s.id IS NULL OR o.source_master_id IS NULL OR o.lat IS NULL OR o.lng IS NULL
      OR NOT isfinite(o.lat::double precision) OR NOT isfinite(o.lng::double precision)
      OR o.lat < -90 OR o.lat > 90 OR o.lng < -180 OR o.lng > 180
  ) OR (SELECT count(*) FROM jsonb_to_recordset(p_coordinate_overrides) AS o(source_master_id uuid, lat numeric, lng numeric))
       <> (SELECT count(DISTINCT o.source_master_id) FROM jsonb_to_recordset(p_coordinate_overrides) AS o(source_master_id uuid, lat numeric, lng numeric)) THEN
    RAISE EXCEPTION 'Coordinate overrides must be unique, legal coordinates for Stored Area source places.';
  END IF;

  -- A browser may fill only a source row that lacks a complete canonical pair.
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_coordinate_overrides) AS o(source_master_id uuid, lat numeric, lng numeric)
    JOIN _stored_area_replacement_source AS s ON s.id = o.source_master_id
    WHERE s.lat IS NOT NULL AND s.lng IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Coordinate overrides are not allowed for Stored Area places with canonical coordinates.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM _stored_area_replacement_source AS s
    LEFT JOIN jsonb_to_recordset(p_coordinate_overrides) AS o(source_master_id uuid, lat numeric, lng numeric)
      ON o.source_master_id = s.id
    WHERE (s.lat IS NULL OR s.lng IS NULL)
      AND (nullif(btrim(s.address), '') IS NOT NULL OR nullif(btrim(s.location_code), '') IS NOT NULL)
      AND o.source_master_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Every Stored Area place needing coordinates requires a prepared coordinate override.';
  END IF;

  DELETE FROM public.event_nearby_places WHERE event_id = p_event_id;

  INSERT INTO public.event_nearby_places (
    event_id, source_master_id, name, address, phone, website, category, category_id,
    notes, sort_order, is_hidden, distance_miles, location_code, lat, lng
  )
  SELECT p_event_id, s.id, s.name, s.address, s.phone, s.link, s.category, s.category_id,
    s.description, s.replacement_sort_order, false, NULL, s.location_code,
    CASE WHEN s.lat IS NOT NULL AND s.lng IS NOT NULL THEN s.lat ELSE o.lat END,
    CASE WHEN s.lat IS NOT NULL AND s.lng IS NOT NULL THEN s.lng ELSE o.lng END
  FROM _stored_area_replacement_source AS s
  LEFT JOIN jsonb_to_recordset(p_coordinate_overrides) AS o(source_master_id uuid, lat numeric, lng numeric)
    ON o.source_master_id = s.id;

  replaced_count := v_source_count;
  RETURN NEXT;
END;
$function$;

ALTER FUNCTION public.replace_event_nearby_from_stored_area(uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.replace_event_nearby_from_stored_area(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.replace_event_nearby_from_stored_area(uuid, uuid, jsonb) TO authenticated;

COMMIT;
