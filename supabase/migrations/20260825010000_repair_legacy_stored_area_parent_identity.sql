-- Repair the legacy Stored Area parent-identity boundary.
--
-- nearby_area_templates remains the browser selection identity. The
-- nearby_master.area_id FK continues to point at nearby_areas. This adds
-- the explicit relationship the legacy flow lacked; it never infers or
-- backfills a relationship for existing rows.

BEGIN;

-- ============================================================
-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

ALTER TABLE public.nearby_area_templates
  ADD COLUMN nearby_area_id uuid;

ALTER TABLE public.nearby_area_templates
  ADD CONSTRAINT nearby_area_templates_nearby_area_id_fkey
  FOREIGN KEY (nearby_area_id)
  REFERENCES public.nearby_areas(id)
  ON DELETE RESTRICT;

CREATE INDEX nearby_area_templates_nearby_area_id_idx
  ON public.nearby_area_templates (nearby_area_id)
  WHERE nearby_area_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assert_stored_area_management_authority()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_users AS au
    WHERE au.user_id = auth.uid()
      AND au.is_active = true
      AND au.privilege_group = ANY (ARRAY['super_admin', 'event_admin', 'content_admin'])
  ) THEN
    RAISE EXCEPTION 'Stored Area management requires an active Super, Event, or Content Administrator.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_stored_area(
  p_name text,
  p_description text DEFAULT NULL,
  p_google_radius_miles numeric DEFAULT NULL,
  p_google_custom_search text DEFAULT NULL,
  p_google_search_city text DEFAULT NULL,
  p_google_search_state text DEFAULT NULL
)
RETURNS public.nearby_area_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_name text := nullif(btrim(p_name), '');
  v_description text := nullif(btrim(p_description), '');
  v_parent public.nearby_areas%ROWTYPE;
  v_template public.nearby_area_templates%ROWTYPE;
BEGIN
  PERFORM public.assert_stored_area_management_authority();

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Stored Area name is required.';
  END IF;

  -- A pre-existing same-name legacy record needs explicit reconciliation;
  -- neither name equality nor a prior template is identity evidence.
  IF EXISTS (
    SELECT 1
    FROM public.nearby_area_templates AS t
    WHERE lower(btrim(t.name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'A Stored Area template named % already exists and requires explicit parent reconciliation.', v_name;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.nearby_areas AS a
    WHERE lower(btrim(a.name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'A legacy Nearby Area named % already exists and requires explicit parent reconciliation.', v_name;
  END IF;

  INSERT INTO public.nearby_areas (name, description)
  VALUES (v_name, v_description)
  RETURNING * INTO v_parent;

  INSERT INTO public.nearby_area_templates (
    nearby_area_id,
    name,
    description,
    google_radius_miles,
    google_custom_search,
    google_search_city,
    google_search_state,
    google_last_run
  ) VALUES (
    v_parent.id,
    v_name,
    v_description,
    p_google_radius_miles,
    nullif(btrim(p_google_custom_search), ''),
    nullif(btrim(p_google_search_city), ''),
    nullif(btrim(p_google_search_state), ''),
    NULL
  )
  RETURNING * INTO v_template;

  RETURN v_template;
END;
$function$;

DROP FUNCTION public.upsert_stored_area_place(
  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric
);

CREATE FUNCTION public.upsert_stored_area_place(
  p_place_id uuid,
  p_template_id uuid,
  p_name text,
  p_category_id uuid DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_location_code text DEFAULT NULL,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL
)
RETURNS public.nearby_master
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_nearby_area_id uuid;
  v_existing_area_id uuid;
  v_row public.nearby_master%ROWTYPE;
BEGIN
  PERFORM public.assert_stored_area_management_authority();

  IF p_template_id IS NULL THEN
    RAISE EXCEPTION 'Stored Area template identity is required.';
  END IF;

  SELECT t.nearby_area_id
  INTO v_nearby_area_id
  FROM public.nearby_area_templates AS t
  WHERE t.id = p_template_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stored Area template % not found.', p_template_id;
  END IF;

  IF v_nearby_area_id IS NULL THEN
    RAISE EXCEPTION 'Stored Area template % has no explicit Nearby Area parent mapping.', p_template_id;
  END IF;

  IF p_place_id IS NULL THEN
    INSERT INTO public.nearby_master (
      area_id, name, category, category_id, address, phone, link,
      description, location_code, lat, lng
    ) VALUES (
      v_nearby_area_id, p_name, p_category, p_category_id, p_address, p_phone, p_website,
      p_notes, p_location_code, p_lat, p_lng
    )
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  SELECT area_id INTO v_existing_area_id
  FROM public.nearby_master
  WHERE id = p_place_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stored Area place % not found.', p_place_id;
  END IF;

  IF v_existing_area_id IS NULL THEN
    RAISE EXCEPTION 'Place % is not a Stored Area place.', p_place_id;
  END IF;

  UPDATE public.nearby_master
  SET
    area_id = v_nearby_area_id,
    name = p_name,
    category = p_category,
    category_id = p_category_id,
    address = p_address,
    phone = p_phone,
    link = p_website,
    description = p_notes,
    location_code = p_location_code,
    lat = p_lat,
    lng = p_lng
  WHERE id = p_place_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

ALTER FUNCTION public.assert_stored_area_management_authority() OWNER TO postgres;
ALTER FUNCTION public.create_stored_area(text, text, numeric, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.upsert_stored_area_place(
  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.assert_stored_area_management_authority()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_stored_area(text, text, numeric, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_stored_area_place(
  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_stored_area(text, text, numeric, text, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_stored_area_place(
  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric
) TO authenticated;

-- ============================================================
-- PARITY END
-- ============================================================

COMMIT;
