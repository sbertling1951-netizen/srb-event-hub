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

CREATE FUNCTION public.legacy_stored_area_parent_fixture_assert(
  p_condition boolean,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Legacy Stored Area parent fixture assertion failed: %', p_message;
  END IF;
END;
$function$;

ALTER FUNCTION public.legacy_stored_area_parent_fixture_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.legacy_stored_area_parent_fixture_assert(boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $fixture$
BEGIN
  PERFORM public.legacy_stored_area_parent_fixture_assert(
    NOT EXISTS (
      SELECT 1
      FROM public.nearby_areas
      WHERE name IN (
        'Stored Area Parent Fixture Same',
        'Stored Area Parent Fixture Different',
        'Stored Area Parent Fixture Atomic'
      )
    ),
    'fixture Nearby Area names must be unused before setup'
  );

  INSERT INTO auth.users (id, email) VALUES
    ('d1000000-0000-4000-8000-000000000001', 'stored-area-authorized@fixture.invalid'),
    ('d1000000-0000-4000-8000-000000000002', 'stored-area-denied@fixture.invalid');

  INSERT INTO public.admin_users (
    id, email, display_name, is_active, is_super_admin, user_id, privilege_group
  ) VALUES (
    'd1100000-0000-4000-8000-000000000001',
    'stored-area-authorized@fixture.invalid',
    'Stored Area Fixture Event Admin', true, false,
    'd1000000-0000-4000-8000-000000000001', 'event_admin'
  );

  INSERT INTO public.nearby_areas (id, name, description) VALUES
    ('d2000000-0000-4000-8000-000000000001', 'Stored Area Parent Fixture Same', 'same-id fixture parent'),
    ('d2000000-0000-4000-8000-000000000002', 'Stored Area Parent Fixture Different', 'different-id fixture parent');

  INSERT INTO public.nearby_area_templates (id, nearby_area_id, name, description) VALUES
    ('d2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Stored Area Template Fixture Same', 'same-id fixture template'),
    ('d2000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000002', 'Stored Area Template Fixture Different', 'different-id fixture template'),
    ('d2000000-0000-4000-8000-000000000004', NULL, 'Stored Area Template Fixture Unmapped', 'unmapped fixture template');
END;
$fixture$;

DO $fixture$
DECLARE
  v_same public.nearby_master%ROWTYPE;
  v_different public.nearby_master%ROWTYPE;
  v_atomic_template public.nearby_area_templates%ROWTYPE;
  v_atomic_place public.nearby_master%ROWTYPE;
  v_before_count integer;
  v_after_count integer;
  v_denied boolean := false;
  v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);

  SELECT * INTO v_same
  FROM public.upsert_stored_area_place(
    NULL,
    'd2000000-0000-4000-8000-000000000001',
    'Stored Area Fixture Same Place'
  );
  PERFORM public.legacy_stored_area_parent_fixture_assert(
    v_same.area_id = 'd2000000-0000-4000-8000-000000000001',
    'same template/parent UUID writes through the explicit relationship'
  );

  SELECT * INTO v_different
  FROM public.upsert_stored_area_place(
    NULL,
    'd2000000-0000-4000-8000-000000000003',
    'Stored Area Fixture Different Place'
  );
  PERFORM public.legacy_stored_area_parent_fixture_assert(
    v_different.area_id = 'd2000000-0000-4000-8000-000000000002'
      AND v_different.area_id <> 'd2000000-0000-4000-8000-000000000003',
    'different template/parent UUID writes only the resolved parent UUID'
  );

  SELECT count(*)::integer INTO v_before_count
  FROM public.nearby_master
  WHERE name = 'Stored Area Fixture Unmapped Place';
  BEGIN
    PERFORM public.upsert_stored_area_place(
      NULL,
      'd2000000-0000-4000-8000-000000000004',
      'Stored Area Fixture Unmapped Place'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Stored Area template d2000000-0000-4000-8000-000000000004 has no explicit Nearby Area parent mapping.';
  END;
  SELECT count(*)::integer INTO v_after_count
  FROM public.nearby_master
  WHERE name = 'Stored Area Fixture Unmapped Place';
  PERFORM public.legacy_stored_area_parent_fixture_assert(
    v_failed AND v_before_count = v_after_count,
    'unmapped template is denied before any Nearby master mutation'
  );

  SELECT * INTO v_atomic_template
  FROM public.create_stored_area(
    'Stored Area Parent Fixture Atomic',
    'atomic fixture template',
    10,
    'fixture search',
    'Fixture City',
    'Fixture State'
  );
  PERFORM public.legacy_stored_area_parent_fixture_assert(
    v_atomic_template.nearby_area_id IS NOT NULL
      AND v_atomic_template.id <> v_atomic_template.nearby_area_id
      AND EXISTS (
        SELECT 1
        FROM public.nearby_areas AS a
        WHERE a.id = v_atomic_template.nearby_area_id
      ),
    'atomic Stored Area creation makes distinct valid parent and template identities with an explicit link'
  );

  SELECT * INTO v_atomic_place
  FROM public.upsert_stored_area_place(
    NULL,
    v_atomic_template.id,
    'Stored Area Fixture Atomic Place'
  );
  PERFORM public.legacy_stored_area_parent_fixture_assert(
    v_atomic_place.area_id = v_atomic_template.nearby_area_id,
    'newly created Stored Area template resolves to its explicit parent for place writes'
  );

  PERFORM public.legacy_stored_area_parent_fixture_assert(
    (SELECT pg_get_constraintdef(oid)
     FROM pg_constraint
     WHERE conname = 'nearby_master_area_id_fkey')
      = 'FOREIGN KEY (area_id) REFERENCES nearby_areas(id) ON DELETE SET NULL',
    'nearby_master.area_id foreign key remains unchanged'
  );

  PERFORM public.legacy_stored_area_parent_fixture_assert(
    NOT has_function_privilege('anon', 'public.create_stored_area(text,text,numeric,text,text,text)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.create_stored_area(text,text,numeric,text,text,text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.upsert_stored_area_place(uuid,uuid,text,uuid,text,text,text,text,text,text,numeric,numeric)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.upsert_stored_area_place(uuid,uuid,text,uuid,text,text,text,text,text,text,numeric,numeric)', 'EXECUTE'),
    'Stored Area RPC execution grants remain authenticated-only'
  );

  PERFORM set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
  BEGIN
    PERFORM public.create_stored_area('Stored Area Parent Fixture Denied');
  EXCEPTION WHEN OTHERS THEN
    v_denied := SQLERRM = 'Stored Area management requires an active Super, Event, or Content Administrator.';
  END;
  PERFORM public.legacy_stored_area_parent_fixture_assert(
    v_denied
      AND NOT EXISTS (
        SELECT 1 FROM public.nearby_area_templates
        WHERE name = 'Stored Area Parent Fixture Denied'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.nearby_areas
        WHERE name = 'Stored Area Parent Fixture Denied'
      ),
    'unauthorized Stored Area creation is denied without partial parent or template mutation'
  );

  PERFORM public.legacy_stored_area_parent_fixture_assert(
    to_regprocedure('public.create_nearby_area_list(text,uuid,text,text)') IS NOT NULL,
    'existing governed Area List RPC remains present but is not used by this fixture'
  );
END;
$fixture$;

ROLLBACK;

DO $post_rollback$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.nearby_areas
    WHERE name IN (
      'Stored Area Parent Fixture Same',
      'Stored Area Parent Fixture Different',
      'Stored Area Parent Fixture Atomic',
      'Stored Area Parent Fixture Denied'
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.nearby_area_templates
    WHERE name LIKE 'Stored Area Template Fixture%'
       OR name = 'Stored Area Parent Fixture Atomic'
       OR name = 'Stored Area Parent Fixture Denied'
  ) OR EXISTS (
    SELECT 1
    FROM public.nearby_master
    WHERE name LIKE 'Stored Area Fixture % Place'
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'nearby_area_templates'
      AND column_name = 'nearby_area_id'
  ) OR to_regprocedure('public.create_stored_area(text,text,numeric,text,text,text)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Legacy Stored Area parent fixture rollback left residue';
  END IF;
END;
$post_rollback$;
