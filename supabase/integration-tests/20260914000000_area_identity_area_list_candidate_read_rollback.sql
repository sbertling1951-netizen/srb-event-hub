-- Reusable Area List candidate read -- Area identity, linked proof.
--
-- Installs the exact DROP + CREATE from
-- 20260914000000_add_area_identity_to_area_list_candidate_read.sql inside
-- one outer transaction, exercises it against real fixture data, and rolls
-- everything (including the function replacement) back. Proves:
--   * the read now returns area_id / area_name from nearby_master.area_id
--     -> nearby_areas, and NULL for a place with no area_id ("Unassigned");
--   * the authority gate (assert_nearby_area_list_management_authority)
--     still runs first and unchanged -- an unauthorized caller is refused
--     before any candidate is returned;
--   * the eligibility / scope predicate is byte-preserved -- a
--     pending_review place is still excluded; a shared_public place from a
--     geographically distant Area is still INCLUDED (display organization,
--     not an authority restriction);
--   * the owner + REVOKE/GRANT posture from 20260825000000 is reapplied
--     verbatim (authenticated EXECUTE only; nothing for anon/service_role).
--
-- NOT RUN against a database in this environment (no local Supabase /
-- PostgreSQL). Ready to execute.

BEGIN;

-- ============================================================
-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

DROP FUNCTION public.list_nearby_master_places_for_area_list(uuid);

CREATE FUNCTION public.list_nearby_master_places_for_area_list(
  p_area_list_id uuid
)
RETURNS TABLE (
  nearby_master_id uuid,
  name text,
  category_id uuid,
  category_label text,
  scope text,
  tenant_id uuid,
  area_id uuid,
  area_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_list public.nearby_area_lists%ROWTYPE;
BEGIN
  v_list := public.assert_nearby_area_list_management_authority(p_area_list_id);

  RETURN QUERY
  SELECT nm.id, nm.name, nm.category_id, pc.label, nm.scope, nm.tenant_id,
         na.id, na.name
  FROM public.nearby_master AS nm
  LEFT JOIN public.place_categories AS pc ON pc.id = nm.category_id
  LEFT JOIN public.nearby_areas AS na ON na.id = nm.area_id
  WHERE nm.status = 'active'
    AND nm.review_status = 'approved'
    AND (
      (v_list.scope = 'shared_public' AND nm.scope = 'shared_public')
      OR (
        v_list.scope = 'tenant_specific'
        AND (nm.scope = 'shared_public' OR nm.tenant_id = v_list.tenant_id)
      )
    )
  ORDER BY (na.name IS NULL), na.name, (pc.label IS NULL), pc.label, nm.name;
END;
$function$;

ALTER FUNCTION public.list_nearby_master_places_for_area_list(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_nearby_master_places_for_area_list(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.list_nearby_master_places_for_area_list(uuid)
  TO authenticated;

-- ============================================================
-- PARITY END
-- ============================================================

CREATE FUNCTION public.area_list_candidate_read_fixture_assert(
  p_condition boolean,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Area List candidate read fixture assertion failed: %', p_message;
  END IF;
END;
$function$;

ALTER FUNCTION public.area_list_candidate_read_fixture_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.area_list_candidate_read_fixture_assert(boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $fixture$
BEGIN
  PERFORM public.area_list_candidate_read_fixture_assert(
    NOT EXISTS (SELECT 1 FROM public.nearby_areas WHERE name LIKE 'AL Candidate Fixture%'),
    'fixture Area identities must be unused before setup'
  );

  INSERT INTO auth.users (id, email) VALUES
    ('e3000000-0000-4000-8000-000000000001', 'al-candidate-superadmin@fixture.invalid'),
    ('e3000000-0000-4000-8000-000000000002', 'al-candidate-outsider@fixture.invalid');

  INSERT INTO public.admin_users (
    id, email, display_name, is_active, is_super_admin, user_id, privilege_group
  ) VALUES
    ('e4000000-0000-4000-8000-000000000001', 'al-candidate-superadmin@fixture.invalid',
     'AL Candidate Super Admin', true, true,
     'e3000000-0000-4000-8000-000000000001', 'super_admin'),
    ('e4000000-0000-4000-8000-000000000002', 'al-candidate-outsider@fixture.invalid',
     'AL Candidate Outsider', true, false,
     'e3000000-0000-4000-8000-000000000002', 'event_admin');

  INSERT INTO public.nearby_areas (id, name, description) VALUES
    ('e5000000-0000-4000-8000-000000000001', 'AL Candidate Fixture Amana', 'fixture area A'),
    ('e5000000-0000-4000-8000-000000000002', 'AL Candidate Fixture Gulf Shores', 'fixture area B');

  INSERT INTO public.place_categories (id, code, label, sort_order, is_active) VALUES
    ('e6000000-0000-4000-8000-000000000001', 'al_fx_grocery', 'AL Fixture Grocery', 900, true),
    ('e6000000-0000-4000-8000-000000000002', 'al_fx_fuel', 'AL Fixture Fuel', 901, true);

  INSERT INTO public.nearby_master (
    id, name, category, category_id, address, status, scope, tenant_id, review_status, area_id
  ) VALUES
    -- Area A / Grocery -- eligible, area-identified
    ('e9000000-0000-4000-8000-000000000001', 'AL Fixture ALDI', 'AL Fixture Grocery',
     'e6000000-0000-4000-8000-000000000001', '1 Amana St', 'active', 'shared_public', NULL,
     'approved', 'e5000000-0000-4000-8000-000000000001'),
    -- Area A / Grocery -- eligible, area-identified
    ('e9000000-0000-4000-8000-000000000002', 'AL Fixture Amana General Store', 'AL Fixture Grocery',
     'e6000000-0000-4000-8000-000000000001', '2 Amana St', 'active', 'shared_public', NULL,
     'approved', 'e5000000-0000-4000-8000-000000000001'),
    -- Area B / Fuel -- eligible, geographically distant, still INCLUDED
    ('e9000000-0000-4000-8000-000000000003', 'AL Fixture Gulf Fuel', 'AL Fixture Fuel',
     'e6000000-0000-4000-8000-000000000002', '3 Gulf Blvd', 'active', 'shared_public', NULL,
     'approved', 'e5000000-0000-4000-8000-000000000002'),
    -- No area_id -- eligible, must appear with NULL area ("Unassigned")
    ('e9000000-0000-4000-8000-000000000004', 'AL Fixture Unassigned Cafe', NULL,
     NULL, '4 Nowhere Rd', 'active', 'shared_public', NULL, 'approved', NULL),
    -- pending_review -- excluded by the preserved predicate
    ('e9000000-0000-4000-8000-000000000005', 'AL Fixture Pending Place', 'AL Fixture Fuel',
     'e6000000-0000-4000-8000-000000000002', '5 Pending Way', 'active', 'shared_public', NULL,
     'pending_review', 'e5000000-0000-4000-8000-000000000001'),
    -- archived -- excluded by the preserved predicate
    ('e9000000-0000-4000-8000-000000000006', 'AL Fixture Archived Place', 'AL Fixture Grocery',
     'e6000000-0000-4000-8000-000000000001', '6 Gone St', 'archived', 'shared_public', NULL,
     'approved', 'e5000000-0000-4000-8000-000000000001');

  INSERT INTO public.nearby_area_lists (
    id, name, description, scope, tenant_id, is_active, created_by_auth_user_id
  ) VALUES (
    'e8000000-0000-4000-8000-000000000001', 'AL Candidate Fixture Shared List', NULL,
    'shared_public', NULL, true, 'e3000000-0000-4000-8000-000000000001'
  );
END;
$fixture$;

DO $fixture$
DECLARE
  v_count integer;
  v_failed boolean;
  v_area_a uuid;
BEGIN
  -- An admin with no Platform authority cannot read the candidate list for
  -- a shared_public Area List -- the authority gate runs first, unchanged.
  PERFORM set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000002', true);
  v_failed := false;
  BEGIN
    PERFORM public.list_nearby_master_places_for_area_list(
      'e8000000-0000-4000-8000-000000000001'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%Platform Administrator authority%';
  END;
  PERFORM public.area_list_candidate_read_fixture_assert(
    v_failed, 'unauthorized caller is refused by the unchanged authority gate before any candidate is returned'
  );

  -- The Platform Admin acts from here on.
  PERFORM set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);

  -- Exactly the four eligible places come back -- pending_review and
  -- archived are still excluded by the byte-preserved predicate.
  SELECT count(*)::integer INTO v_count
  FROM public.list_nearby_master_places_for_area_list('e8000000-0000-4000-8000-000000000001')
  WHERE nearby_master_id::text LIKE 'e9000000-0000-4000-8000-00000000000%';
  PERFORM public.area_list_candidate_read_fixture_assert(
    v_count = 4, 'exactly the four active + approved fixture places are eligible (predicate preserved)'
  );

  -- The geographically distant Area B place is INCLUDED -- this is display
  -- organization, not an authority restriction.
  PERFORM public.area_list_candidate_read_fixture_assert(
    EXISTS (
      SELECT 1 FROM public.list_nearby_master_places_for_area_list('e8000000-0000-4000-8000-000000000001')
      WHERE nearby_master_id = 'e9000000-0000-4000-8000-000000000003'
    ),
    'a shared_public place from another geographic Area is still returned, not hidden'
  );

  -- area_id / area_name are populated from nearby_master.area_id -> nearby_areas.
  SELECT area_id INTO v_area_a
  FROM public.list_nearby_master_places_for_area_list('e8000000-0000-4000-8000-000000000001')
  WHERE nearby_master_id = 'e9000000-0000-4000-8000-000000000001';
  PERFORM public.area_list_candidate_read_fixture_assert(
    v_area_a = 'e5000000-0000-4000-8000-000000000001',
    'area_id is read from the candidate place nearby_master.area_id'
  );

  PERFORM public.area_list_candidate_read_fixture_assert(
    EXISTS (
      SELECT 1 FROM public.list_nearby_master_places_for_area_list('e8000000-0000-4000-8000-000000000001')
      WHERE nearby_master_id = 'e9000000-0000-4000-8000-000000000003'
        AND area_name = 'AL Candidate Fixture Gulf Shores'
    ),
    'area_name resolves through nearby_areas'
  );

  -- The place with no area_id comes back with NULL area (the "Unassigned"
  -- group) -- never dropped by the LEFT JOIN.
  PERFORM public.area_list_candidate_read_fixture_assert(
    EXISTS (
      SELECT 1 FROM public.list_nearby_master_places_for_area_list('e8000000-0000-4000-8000-000000000001')
      WHERE nearby_master_id = 'e9000000-0000-4000-8000-000000000004'
        AND area_id IS NULL
        AND area_name IS NULL
    ),
    'a canonical place with no area_id is returned with a NULL area (Unassigned), not dropped'
  );

  -- Ordering: area-identified rows first (by area name), Unassigned last.
  PERFORM public.area_list_candidate_read_fixture_assert(
    (
      SELECT nearby_master_id
      FROM (
        SELECT nearby_master_id, row_number() OVER () AS ord
        FROM public.list_nearby_master_places_for_area_list('e8000000-0000-4000-8000-000000000001')
        WHERE nearby_master_id::text LIKE 'e9000000-0000-4000-8000-00000000000%'
      ) ranked
      ORDER BY ord DESC
      LIMIT 1
    ) = 'e9000000-0000-4000-8000-000000000004',
    'the Unassigned place sorts last'
  );

  -- The read column set is exactly eight, in the declared order.
  SELECT count(*)::integer INTO v_count
  FROM information_schema.parameters
  WHERE specific_schema = 'public'
    AND specific_name LIKE 'list_nearby_master_places_for_area_list%'
    AND parameter_mode = 'OUT';
  PERFORM public.area_list_candidate_read_fixture_assert(
    v_count = 8, 'the read returns exactly eight OUT columns'
  );
END;
$fixture$;

ROLLBACK;

-- Every FIXTURE object is gone after ROLLBACK. The
-- list_nearby_master_places_for_area_list definition is deliberately NOT
-- checked here: whether it is the 8-column (migration applied) or
-- 6-column (migration not yet applied) shape after rollback is a property
-- of the migration, not fixture residue.
DO $post_rollback$
BEGIN
  IF EXISTS (SELECT 1 FROM public.nearby_areas WHERE name LIKE 'AL Candidate Fixture%')
     OR EXISTS (SELECT 1 FROM public.nearby_master WHERE name LIKE 'AL Fixture %')
     OR EXISTS (SELECT 1 FROM public.nearby_area_lists WHERE name LIKE 'AL Candidate Fixture%')
     OR EXISTS (SELECT 1 FROM public.place_categories WHERE code LIKE 'al_fx_%')
     OR EXISTS (SELECT 1 FROM public.admin_users WHERE email LIKE 'al-candidate-%@fixture.invalid')
     OR EXISTS (SELECT 1 FROM auth.users WHERE email LIKE 'al-candidate-%@fixture.invalid')
     OR to_regprocedure('public.area_list_candidate_read_fixture_assert(boolean,text)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Area List candidate read Area-identity rollback left fixture residue';
  END IF;
END;
$post_rollback$;
