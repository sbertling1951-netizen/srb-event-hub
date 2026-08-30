-- Nearby Stored-Area authority / lifecycle repair (P1) -- linked proof.
--
-- Installs the exact repaired definitions inside one outer transaction,
-- exercises them against the live task-authority + Nearby scope model, and
-- rolls every fixture object and the repair back. Proves the ratified
-- split: Event Admin+ may CONTRIBUTE (governed Event authority, fail-closed,
-- lifecycle-aware); only a System Administrator may modify or retire an
-- existing shared_public canonical record; contribution confers no later
-- canonical authority; a caller-supplied place id or template id cannot
-- cross the boundary; delete_stored_area_place archives (never physically
-- deletes) and leaves Event/relevance history intact; tenant-scoped rows
-- are refused by both Stored-Area paths.
--
-- NOT RUN against a database in this environment (no local Supabase /
-- PostgreSQL). Ready to execute.

BEGIN;

-- ============================================================
-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

-- ---------------------------------------------------------------------------
-- A. Contribution authority -- governed Event authority, never global
--    privilege_group. Internal helper: REVOKE-only, called exclusively by
--    the SECURITY DEFINER functions below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_stored_area_contribution_authority(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'Stored Area contribution requires a working Event context.';
  END IF;

  IF NOT public.has_event_task_authority('event.nearby.manage', p_event_id) THEN
    RAISE EXCEPTION 'Stored Area contribution requires event.nearby.manage authority for the working Event %.', p_event_id;
  END IF;

  -- Genuinely Event-originated: an archived / indeterminate Event cannot be
  -- used as an authority anchor for a new contribution.
  PERFORM public.assert_event_lifecycle_mutable(p_event_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- B. Canonical authority -- System Admin only. Internal helper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_stored_area_canonical_authority()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Shared Nearby catalog changes require System Administrator authority.';
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- assert_stored_area_management_authority -- signature preserved for
-- compatibility. The global privilege_group check is REMOVED; it now
-- enforces canonical (System Admin) authority. It is no longer wired into
-- any mutation path (upsert_stored_area_place and create_stored_area call
-- the specific split helpers directly) -- retained only so any
-- out-of-tree caller fails safe rather than silently keeping the old
-- broad gate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_stored_area_management_authority()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public.assert_stored_area_canonical_authority();
END;
$function$;

-- ---------------------------------------------------------------------------
-- create_stored_area -- CONTRIBUTION. Gains p_event_id; authority switches
-- from the global privilege_group check to governed Event contribution
-- authority. Body is otherwise byte-identical to 20260825010000 (the
-- name-reconciliation guards and the two atomic inserts are unchanged).
-- ---------------------------------------------------------------------------
DROP FUNCTION public.create_stored_area(text, text, numeric, text, text, text);

CREATE FUNCTION public.create_stored_area(
  p_name text,
  p_description text DEFAULT NULL,
  p_google_radius_miles numeric DEFAULT NULL,
  p_google_custom_search text DEFAULT NULL,
  p_google_search_city text DEFAULT NULL,
  p_google_search_state text DEFAULT NULL,
  p_event_id uuid DEFAULT NULL
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
  PERFORM public.assert_stored_area_contribution_authority(p_event_id);

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

-- ---------------------------------------------------------------------------
-- upsert_stored_area_place -- the authority SPLIT.
--
--   p_place_id IS NULL  -> CONTRIBUTION: assert_stored_area_contribution_
--                          authority(p_event_id). Creates a shared_public
--                          catalog row (status 'active', review_status
--                          'approved' -- identical to the column defaults
--                          the legacy insert relied on; there is no review
--                          step for this bucket in the governing model).
--                          created_by is stamped for provenance;
--                          contribution confers no later edit authority.
--   p_place_id NOT NULL -> CANONICAL MODIFICATION: assert_stored_area_
--                          canonical_authority() (System Admin only). The
--                          target must be a Stored-Area bucket row
--                          (area_id IS NOT NULL) AND scope 'shared_public'.
--
-- The branch is purely `p_place_id IS NULL`, and the authority decision is
-- the FIRST statement -- before the template is resolved and before any
-- existing row is read. A caller supplying an arbitrary id, another row's
-- id, or an alternate template id cannot turn a contribution into a
-- canonical edit; a template id never confers authority (it is only a
-- parent lookup, and its existence is not probed until authority passes).
-- Gains p_event_id (trailing, DEFAULT NULL) -- ignored on the canonical
-- path, required on the contribution path.
-- ---------------------------------------------------------------------------
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
  p_lng numeric DEFAULT NULL,
  p_event_id uuid DEFAULT NULL
)
RETURNS public.nearby_master
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_nearby_area_id uuid;
  v_existing_area_id uuid;
  v_existing_scope text;
  v_row public.nearby_master%ROWTYPE;
BEGIN
  -- Authority FIRST, branched on p_place_id, before any data probe.
  IF p_place_id IS NULL THEN
    PERFORM public.assert_stored_area_contribution_authority(p_event_id);
  ELSE
    PERFORM public.assert_stored_area_canonical_authority();
  END IF;

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
    -- CONTRIBUTION: create a new shared_public catalog row.
    INSERT INTO public.nearby_master (
      area_id, name, category, category_id, address, phone, link,
      description, location_code, lat, lng,
      scope, status, review_status, created_by
    ) VALUES (
      v_nearby_area_id, p_name, p_category, p_category_id, p_address, p_phone, p_website,
      p_notes, p_location_code, p_lat, p_lng,
      'shared_public', 'active', 'approved', auth.uid()::text
    )
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  -- CANONICAL MODIFICATION (authority already asserted above).
  SELECT area_id, scope
  INTO v_existing_area_id, v_existing_scope
  FROM public.nearby_master
  WHERE id = p_place_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stored Area place % not found.', p_place_id;
  END IF;

  IF v_existing_area_id IS NULL THEN
    RAISE EXCEPTION 'Place % is not a Stored Area place.', p_place_id;
  END IF;

  IF v_existing_scope IS DISTINCT FROM 'shared_public' THEN
    RAISE EXCEPTION 'Place % is a tenant-scoped catalog record; use update_nearby_master_place.', p_place_id;
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

-- ---------------------------------------------------------------------------
-- delete_stored_area_place -- callable signature preserved; semantics are
-- now governed RETIRE / ARCHIVE, never physical deletion.
--
-- Delegates to the canonical public.retire_nearby_master_place, which for a
-- shared_public row enforces has_platform_admin_authority, sets
-- status = 'archived' (idempotent), performs NO cascade, and leaves every
-- event_nearby_places / tenant_place_relevance / nearby_area_list_members /
-- provider-identity reference intact. Removing a catalog place from one
-- Event is a separate concern handled on event_nearby_places and never
-- reaches this function.
--
-- The name is retained only so the single existing caller
-- (app/admin/nearby/page.tsx deleteStoredPlace) keeps working; it is
-- documented UI-side as "Retire", not "Delete".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_stored_area_place(p_place_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_area_id uuid;
  v_scope text;
BEGIN
  SELECT area_id, scope
  INTO v_area_id, v_scope
  FROM public.nearby_master
  WHERE id = p_place_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stored Area place % not found.', p_place_id;
  END IF;

  IF v_area_id IS NULL THEN
    RAISE EXCEPTION 'Place % is not a Stored Area place.', p_place_id;
  END IF;

  IF v_scope IS DISTINCT FROM 'shared_public' THEN
    RAISE EXCEPTION 'Place % is a tenant-scoped catalog record; use retire_nearby_master_place.', p_place_id;
  END IF;

  -- Canonical governed retirement. retire_nearby_master_place re-derives
  -- authority from the row's own scope (shared_public -> System Admin) and
  -- archives without deleting or cascading.
  PERFORM public.retire_nearby_master_place(p_place_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Ownership + ACL hardening. Internal assert_* helpers stay REVOKE-only
-- (no role may call them directly). The three browser-reachable RPCs keep
-- their existing "authenticated EXECUTE, nothing else" posture -- the
-- authority decision is entirely inside the function body.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.assert_stored_area_contribution_authority(uuid) OWNER TO postgres;
ALTER FUNCTION public.assert_stored_area_canonical_authority() OWNER TO postgres;
ALTER FUNCTION public.assert_stored_area_management_authority() OWNER TO postgres;
ALTER FUNCTION public.create_stored_area(text, text, numeric, text, text, text, uuid) OWNER TO postgres;
ALTER FUNCTION public.upsert_stored_area_place(
  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric, uuid
) OWNER TO postgres;
ALTER FUNCTION public.delete_stored_area_place(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.assert_stored_area_contribution_authority(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_stored_area_canonical_authority()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_stored_area_management_authority()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_stored_area(text, text, numeric, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_stored_area_place(
  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_stored_area_place(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_stored_area(text, text, numeric, text, text, text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_stored_area_place(
  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_stored_area_place(uuid)
  TO authenticated;

-- ============================================================
-- PARITY END
-- ============================================================

CREATE FUNCTION public.stored_area_p1_fixture_assert(
  p_condition boolean,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Stored Area P1 fixture assertion failed: %', p_message;
  END IF;
END;
$function$;

ALTER FUNCTION public.stored_area_p1_fixture_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.stored_area_p1_fixture_assert(boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Fixture data.
-- ------------------------------------------------------------
DO $fixture$
BEGIN
  PERFORM public.stored_area_p1_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM public.tenants WHERE organization_code IN ('SA-P1-FX-A', 'SA-P1-FX-B')
    ),
    'fixture tenant codes must be unused before setup'
  );

  INSERT INTO auth.users (id, email) VALUES
    ('e1000000-0000-4000-8000-000000000001', 'sa-p1-ea-a@fixture.invalid'),
    ('e1000000-0000-4000-8000-000000000002', 'sa-p1-ea-b@fixture.invalid'),
    ('e1000000-0000-4000-8000-000000000003', 'sa-p1-content-legacy@fixture.invalid'),
    ('e1000000-0000-4000-8000-000000000004', 'sa-p1-system@fixture.invalid');

  INSERT INTO public.tenants (id, organization_code, slug, organization_name, display_name, app_title) VALUES
    ('e2000000-0000-4000-8000-00000000000a', 'SA-P1-FX-A', 'sa-p1-fx-a', 'SA P1 Fixture Org A', 'SA P1 Fixture A', 'SA P1 A'),
    ('e2000000-0000-4000-8000-00000000000b', 'SA-P1-FX-B', 'sa-p1-fx-b', 'SA P1 Fixture Org B', 'SA P1 Fixture B', 'SA P1 B');

  INSERT INTO public.events (id, name, tenant_id, end_date, timezone, lifecycle_state) VALUES
    ('e3000000-0000-4000-8000-00000000000a', 'SA P1 Fixture Event A',
       'e2000000-0000-4000-8000-00000000000a', (now() - interval '1 day')::date, 'America/Chicago', 'operational'),
    ('e3000000-0000-4000-8000-00000000000b', 'SA P1 Fixture Event B',
       'e2000000-0000-4000-8000-00000000000b', (now() - interval '1 day')::date, 'America/Chicago', 'operational'),
    ('e3000000-0000-4000-8000-0000000000aa', 'SA P1 Fixture Event A Archived',
       'e2000000-0000-4000-8000-00000000000a', (now() - interval '1 day')::date, 'America/Chicago', 'archived');

  INSERT INTO public.admin_users (id, email, display_name, is_active, is_super_admin, user_id, privilege_group) VALUES
    ('e4000000-0000-4000-8000-000000000001', 'sa-p1-ea-a@fixture.invalid', 'SA P1 EA A', true, false,
       'e1000000-0000-4000-8000-000000000001', 'event_admin'),
    ('e4000000-0000-4000-8000-000000000002', 'sa-p1-ea-b@fixture.invalid', 'SA P1 EA B', true, false,
       'e1000000-0000-4000-8000-000000000002', 'event_admin'),
    ('e4000000-0000-4000-8000-000000000003', 'sa-p1-content-legacy@fixture.invalid', 'SA P1 Content Legacy', true, false,
       'e1000000-0000-4000-8000-000000000003', 'content_admin'),
    ('e4000000-0000-4000-8000-000000000004', 'sa-p1-system@fixture.invalid', 'SA P1 System', true, true,
       'e1000000-0000-4000-8000-000000000004', 'super_admin');

  -- Governed Event authority is an explicit event grant only -- no platform
  -- inheritance, no admin_tenant_access. EA A holds it on Event A and on
  -- the archived Event A; EA B holds it on Event B.
  INSERT INTO public.admin_event_access (id, admin_user_id, event_id, role) VALUES
    ('e5000000-0000-4000-8000-00000000000a', 'e4000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-00000000000a', 'event_admin'),
    ('e5000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-0000000000aa', 'event_admin'),
    ('e5000000-0000-4000-8000-00000000000b', 'e4000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-00000000000b', 'event_admin');

  INSERT INTO public.admin_event_permissions (admin_event_access_id, permission_key, is_enabled) VALUES
    ('e5000000-0000-4000-8000-00000000000a', 'event.nearby.manage', true),
    ('e5000000-0000-4000-8000-0000000000aa', 'event.nearby.manage', true),
    ('e5000000-0000-4000-8000-00000000000b', 'event.nearby.manage', true);

  INSERT INTO public.nearby_areas (id, name, description) VALUES
    ('e6000000-0000-4000-8000-000000000001', 'SA P1 Fixture Area One', 'fixture parent one'),
    ('e6000000-0000-4000-8000-000000000002', 'SA P1 Fixture Area Two', 'fixture parent two');

  INSERT INTO public.nearby_area_templates (id, nearby_area_id, name, description) VALUES
    ('e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'SA P1 Fixture Template One', 'fixture template one'),
    ('e7000000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000002', 'SA P1 Fixture Template Two', 'fixture template two');

  -- A pre-existing legacy shared_public catalog row (area_id bucket).
  INSERT INTO public.nearby_master (id, area_id, name, scope, status, review_status) VALUES
    ('e8000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001',
       'SA P1 Fixture Canonical Place', 'shared_public', 'active', 'approved');

  -- An anomalous tenant_specific row that still carries an area_id -- must
  -- be refused by both Stored-Area paths (model rule 6: tenant/history = TA+).
  INSERT INTO public.nearby_master (id, area_id, name, scope, status, review_status, tenant_id) VALUES
    ('e8000000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000001',
       'SA P1 Fixture Tenant Place', 'tenant_specific', 'active', 'approved',
       'e2000000-0000-4000-8000-00000000000a');

  -- Downstream references to the canonical row that MUST survive retirement.
  INSERT INTO public.event_nearby_places (id, event_id, name, source_master_id) VALUES
    ('e9000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-00000000000a',
       'SA P1 Fixture Canonical Place', 'e8000000-0000-4000-8000-000000000001');
  INSERT INTO public.tenant_place_relevance (tenant_id, place_id) VALUES
    ('e2000000-0000-4000-8000-00000000000a', 'e8000000-0000-4000-8000-000000000001');
END;
$fixture$;

-- ------------------------------------------------------------
-- A. Contribution -- who may add new shared knowledge.
-- ------------------------------------------------------------
DO $fixture$
DECLARE
  v_contrib public.nearby_master%ROWTYPE;
  v_denied boolean;
  v_before integer;
  v_after integer;
BEGIN
  -- Anonymous.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_denied := false;
  SELECT count(*)::integer INTO v_before FROM public.nearby_master WHERE name = 'SA P1 Fixture Anon Place';
  BEGIN
    PERFORM public.upsert_stored_area_place(
      NULL, 'e7000000-0000-4000-8000-000000000001', 'SA P1 Fixture Anon Place',
      p_event_id => 'e3000000-0000-4000-8000-00000000000a'
    );
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;
  SELECT count(*)::integer INTO v_after FROM public.nearby_master WHERE name = 'SA P1 Fixture Anon Place';
  PERFORM public.stored_area_p1_fixture_assert(
    v_denied AND v_before = v_after,
    'anonymous caller cannot contribute a Stored Area place'
  );

  -- Legacy content_admin with no event.nearby.manage grant.
  PERFORM set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000003', true);
  v_denied := false;
  BEGIN
    PERFORM public.upsert_stored_area_place(
      NULL, 'e7000000-0000-4000-8000-000000000001', 'SA P1 Fixture Content Place',
      p_event_id => 'e3000000-0000-4000-8000-00000000000a'
    );
  EXCEPTION WHEN OTHERS THEN
    v_denied := SQLERRM LIKE 'Stored Area contribution requires event.nearby.manage authority%';
  END;
  PERFORM public.stored_area_p1_fixture_assert(
    v_denied AND NOT EXISTS (SELECT 1 FROM public.nearby_master WHERE name = 'SA P1 Fixture Content Place'),
    'content_admin with only the legacy privilege_group flag but no event.nearby.manage grant is denied contribution'
  );

  -- Event Admin A -> Event A: contribution allowed.
  PERFORM set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_contrib FROM public.upsert_stored_area_place(
    NULL, 'e7000000-0000-4000-8000-000000000001', 'SA P1 Fixture Contributed Place',
    p_event_id => 'e3000000-0000-4000-8000-00000000000a'
  );
  PERFORM public.stored_area_p1_fixture_assert(
    v_contrib.scope = 'shared_public'
      AND v_contrib.status = 'active'
      AND v_contrib.review_status = 'approved'
      AND v_contrib.tenant_id IS NULL
      AND v_contrib.area_id = 'e6000000-0000-4000-8000-000000000001',
    'Event Admin with event.nearby.manage contributes a new shared_public catalog place for their Event'
  );
  PERFORM public.stored_area_p1_fixture_assert(
    v_contrib.created_by = 'e1000000-0000-4000-8000-000000000001',
    'a contribution stamps created_by and confers no later canonical edit authority'
  );

  -- Same Event Admin cannot then edit the canonical record they contributed.
  v_denied := false;
  BEGIN
    PERFORM public.upsert_stored_area_place(
      v_contrib.id, 'e7000000-0000-4000-8000-000000000001', 'SA P1 Renamed By Contributor',
      p_event_id => 'e3000000-0000-4000-8000-00000000000a'
    );
  EXCEPTION WHEN OTHERS THEN
    v_denied := SQLERRM = 'Shared Nearby catalog changes require System Administrator authority.';
  END;
  PERFORM public.stored_area_p1_fixture_assert(
    v_denied
      AND (SELECT name FROM public.nearby_master WHERE id = v_contrib.id) = 'SA P1 Fixture Contributed Place',
    'the same Event Admin cannot edit the canonical record they just contributed'
  );

  -- A valid template id is only a parent lookup; passing one for an Event
  -- the caller has no authority on does not confer contribution rights.
  PERFORM set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
  v_denied := false;
  BEGIN
    PERFORM public.upsert_stored_area_place(
      NULL, 'e7000000-0000-4000-8000-000000000001', 'SA P1 Fixture Cross Event Place',
      p_event_id => 'e3000000-0000-4000-8000-00000000000a'
    );
  EXCEPTION WHEN OTHERS THEN
    v_denied := SQLERRM LIKE 'Stored Area contribution requires event.nearby.manage authority%';
  END;
  PERFORM public.stored_area_p1_fixture_assert(
    v_denied AND NOT EXISTS (SELECT 1 FROM public.nearby_master WHERE name = 'SA P1 Fixture Cross Event Place'),
    'a caller-supplied template id confers no authority'
  );

  -- Archived Event cannot anchor a contribution.
  PERFORM set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
  v_denied := false;
  BEGIN
    PERFORM public.upsert_stored_area_place(
      NULL, 'e7000000-0000-4000-8000-000000000001', 'SA P1 Fixture Archived Anchor Place',
      p_event_id => 'e3000000-0000-4000-8000-0000000000aa'
    );
  EXCEPTION WHEN OTHERS THEN
    v_denied := SQLERRM = 'event_archived';
  END;
  PERFORM public.stored_area_p1_fixture_assert(
    v_denied AND NOT EXISTS (SELECT 1 FROM public.nearby_master WHERE name = 'SA P1 Fixture Archived Anchor Place'),
    'contribution into an archived Event is refused by the lifecycle guard'
  );

  -- Event Admin may also create a Stored Area container (contribution-level).
  PERFORM public.create_stored_area(
    'SA P1 Fixture EA Created Area', 'ea created', 10, NULL, NULL, NULL,
    'e3000000-0000-4000-8000-00000000000a'
  );
  PERFORM public.stored_area_p1_fixture_assert(
    EXISTS (SELECT 1 FROM public.nearby_area_templates WHERE name = 'SA P1 Fixture EA Created Area'),
    'Event Admin with event.nearby.manage may create a Stored Area container for their Event'
  );
END;
$fixture$;

-- ------------------------------------------------------------
-- B. Canonical modification -- System Admin only; ids do not cross the line.
-- ------------------------------------------------------------
DO $fixture$
DECLARE
  v_denied boolean;
  v_row public.nearby_master%ROWTYPE;
BEGIN
  -- Event Admin from another Event/Tenant cannot edit the shared canonical row.
  PERFORM set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
  v_denied := false;
  BEGIN
    PERFORM public.upsert_stored_area_place(
      'e8000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000001',
      'SA P1 Edited By Other EA', p_event_id => 'e3000000-0000-4000-8000-00000000000b'
    );
  EXCEPTION WHEN OTHERS THEN
    v_denied := SQLERRM = 'Shared Nearby catalog changes require System Administrator authority.';
  END;
  PERFORM public.stored_area_p1_fixture_assert(
    v_denied
      AND (SELECT name FROM public.nearby_master WHERE id = 'e8000000-0000-4000-8000-000000000001')
          = 'SA P1 Fixture Canonical Place',
    'an Event Admin from another Event/Tenant cannot edit the shared canonical row'
  );

  -- A caller-supplied p_place_id makes it a canonical operation -- never a
  -- contribution -- so an Event Admin is denied before any row is touched.
  PERFORM set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
  v_denied := false;
  BEGIN
    PERFORM public.upsert_stored_area_place(
      'e8000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002',
      'SA P1 Hijacked', p_event_id => 'e3000000-0000-4000-8000-00000000000a'
    );
  EXCEPTION WHEN OTHERS THEN
    v_denied := SQLERRM = 'Shared Nearby catalog changes require System Administrator authority.';
  END;
  PERFORM public.stored_area_p1_fixture_assert(
    v_denied
      AND (SELECT name FROM public.nearby_master WHERE id = 'e8000000-0000-4000-8000-000000000001')
          = 'SA P1 Fixture Canonical Place'
      AND (SELECT area_id FROM public.nearby_master WHERE id = 'e8000000-0000-4000-8000-000000000001')
          = 'e6000000-0000-4000-8000-000000000001',
    'a caller-supplied p_place_id cannot turn a contribution into a canonical update'
  );

  -- System Administrator edits the canonical shared record.
  PERFORM set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000004', true);
  SELECT * INTO v_row FROM public.upsert_stored_area_place(
    'e8000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000001',
    'SA P1 Canonical Renamed By System', p_address => '1 Fixture Way'
  );
  PERFORM public.stored_area_p1_fixture_assert(
    v_row.name = 'SA P1 Canonical Renamed By System' AND v_row.address = '1 Fixture Way',
    'System Administrator edits the canonical shared record'
  );

  -- System Administrator reassigns the canonical record between Stored Areas.
  SELECT * INTO v_row FROM public.upsert_stored_area_place(
    'e8000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002',
    'SA P1 Canonical Renamed By System'
  );
  PERFORM public.stored_area_p1_fixture_assert(
    v_row.area_id = 'e6000000-0000-4000-8000-000000000002',
    'System Administrator reassigns the canonical record between Stored Areas'
  );

  -- Tenant-scoped row: refused by the upsert Stored-Area path even for System.
  v_denied := false;
  BEGIN
    PERFORM public.upsert_stored_area_place(
      'e8000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000001', 'SA P1 Tenant Edit'
    );
  EXCEPTION WHEN OTHERS THEN
    v_denied := SQLERRM LIKE 'Place % is a tenant-scoped catalog record; use update_nearby_master_place.';
  END;
  PERFORM public.stored_area_p1_fixture_assert(
    v_denied
      AND (SELECT name FROM public.nearby_master WHERE id = 'e8000000-0000-4000-8000-000000000002')
          = 'SA P1 Fixture Tenant Place',
    'a tenant-scoped catalog row is refused by both the upsert and delete Stored Area paths'
  );
END;
$fixture$;

-- ------------------------------------------------------------
-- C. delete_stored_area_place -> governed retire / archive, never delete.
-- ------------------------------------------------------------
DO $fixture$
DECLARE
  v_denied boolean;
BEGIN
  -- Event Admin cannot retire a shared canonical record.
  PERFORM set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
  v_denied := false;
  BEGIN
    PERFORM public.delete_stored_area_place('e8000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;
  PERFORM public.stored_area_p1_fixture_assert(
    v_denied
      AND (SELECT status FROM public.nearby_master WHERE id = 'e8000000-0000-4000-8000-000000000001')
          = 'active',
    'canonical retirement requires System Administrator authority'
  );

  -- Tenant-scoped row: refused by the delete Stored-Area path too.
  PERFORM set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000004', true);
  v_denied := false;
  BEGIN
    PERFORM public.delete_stored_area_place('e8000000-0000-4000-8000-000000000002');
  EXCEPTION WHEN OTHERS THEN
    v_denied := SQLERRM LIKE 'Place % is a tenant-scoped catalog record; use retire_nearby_master_place.';
  END;
  PERFORM public.stored_area_p1_fixture_assert(
    v_denied
      AND EXISTS (SELECT 1 FROM public.nearby_master WHERE id = 'e8000000-0000-4000-8000-000000000002'),
    'a tenant-scoped catalog row is refused by both the upsert and delete Stored Area paths (delete side)'
  );

  -- System Administrator: archive, not physical delete.
  PERFORM public.delete_stored_area_place('e8000000-0000-4000-8000-000000000001');
  PERFORM public.stored_area_p1_fixture_assert(
    EXISTS (SELECT 1 FROM public.nearby_master WHERE id = 'e8000000-0000-4000-8000-000000000001')
      AND (SELECT status FROM public.nearby_master WHERE id = 'e8000000-0000-4000-8000-000000000001')
          = 'archived',
    'delete_stored_area_place archives the canonical record and never physically deletes it'
  );

  -- Referential history is untouched.
  PERFORM public.stored_area_p1_fixture_assert(
    EXISTS (SELECT 1 FROM public.event_nearby_places WHERE id = 'e9000000-0000-4000-8000-000000000001')
      AND EXISTS (
        SELECT 1 FROM public.tenant_place_relevance
        WHERE place_id = 'e8000000-0000-4000-8000-000000000001'
      ),
    'existing Event associations and tenant relevance rows survive canonical retirement intact'
  );
END;
$fixture$;

-- ------------------------------------------------------------
-- D. ACL posture.
-- ------------------------------------------------------------
DO $fixture$
BEGIN
  PERFORM public.stored_area_p1_fixture_assert(
    NOT has_function_privilege('anon',
      'public.upsert_stored_area_place(uuid,uuid,text,uuid,text,text,text,text,text,text,numeric,numeric,uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated',
      'public.upsert_stored_area_place(uuid,uuid,text,uuid,text,text,text,text,text,text,numeric,numeric,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.delete_stored_area_place(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.delete_stored_area_place(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon',
      'public.create_stored_area(text,text,numeric,text,text,text,uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated',
      'public.create_stored_area(text,text,numeric,text,text,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
      'public.assert_stored_area_contribution_authority(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
      'public.assert_stored_area_canonical_authority()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
      'public.assert_stored_area_management_authority()', 'EXECUTE'),
    'Stored Area RPC EXECUTE remains authenticated-only and the internal assert helpers are uncallable'
  );
END;
$fixture$;

ROLLBACK;

DO $post_rollback$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tenants WHERE organization_code IN ('SA-P1-FX-A', 'SA-P1-FX-B')
  ) OR EXISTS (
    SELECT 1 FROM public.nearby_master WHERE name LIKE 'SA P1 Fixture%' OR name LIKE 'SA P1 Canonical%'
  ) OR EXISTS (
    SELECT 1 FROM public.nearby_area_templates WHERE name LIKE 'SA P1 Fixture%'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.parameters
    WHERE specific_schema = 'public'
      AND specific_name LIKE 'upsert_stored_area_place%'
      AND parameter_name = 'p_event_id'
  ) OR to_regprocedure('public.stored_area_p1_fixture_assert(boolean,text)') IS NOT NULL
    OR to_regprocedure('public.assert_stored_area_contribution_authority(uuid)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Stored Area contribution and canonical authority rollback left residue';
  END IF;
END;
$post_rollback$;
