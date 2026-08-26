-- Linked-database proof for the pending governed attendee Name Tag and Coach
-- Plate need commands. The migration definitions and all isolated fixture
-- evidence are installed inside one transaction and removed by outer rollback.

BEGIN;

-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

CREATE FUNCTION public.set_attendee_name_tag_need(
  p_attendee_id uuid,
  p_needs_name_tag boolean
)
RETURNS TABLE(
  outcome text,
  event_id uuid,
  attendee_id uuid,
  needs_name_tag boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_event_id uuid;
  v_current_needs_name_tag boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_attendee_id IS NULL OR p_needs_name_tag IS NULL THEN
    RAISE EXCEPTION 'name_tag_need_required' USING ERRCODE = '22023';
  END IF;

  -- Lock and derive scope from the canonical attendee row. The browser never
  -- supplies Event identity, so it cannot redirect this command across Events.
  SELECT a.event_id, a.needs_name_tag
    INTO v_event_id, v_current_needs_name_tag
  FROM public.attendees AS a
  WHERE a.id = p_attendee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendee_not_found' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_event_task_authority('event.attendees.manage', v_event_id) THEN
    RAISE EXCEPTION 'authorization_denied' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  -- Idempotent retries report the persisted state without an unnecessary
  -- attendee UPDATE or any other side effect.
  IF v_current_needs_name_tag IS NOT DISTINCT FROM p_needs_name_tag THEN
    RETURN QUERY
    SELECT 'unchanged'::text, v_event_id, p_attendee_id, v_current_needs_name_tag;
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.attendees AS a
  SET needs_name_tag = p_needs_name_tag
  WHERE a.id = p_attendee_id
  RETURNING 'updated'::text, a.event_id, a.id, a.needs_name_tag;
END;
$function$;

ALTER FUNCTION public.set_attendee_name_tag_need(uuid, boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_attendee_name_tag_need(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.set_attendee_name_tag_need(uuid, boolean)
  TO authenticated;

CREATE FUNCTION public.set_attendee_coach_plate_need(
  p_attendee_id uuid,
  p_needs_coach_plate boolean
)
RETURNS TABLE(
  outcome text,
  event_id uuid,
  attendee_id uuid,
  needs_coach_plate boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_event_id uuid;
  v_current_needs_coach_plate boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_attendee_id IS NULL OR p_needs_coach_plate IS NULL THEN
    RAISE EXCEPTION 'coach_plate_need_required' USING ERRCODE = '22023';
  END IF;

  -- Lock and derive scope from the canonical attendee row. The browser never
  -- supplies Event identity, so it cannot redirect this command across Events.
  SELECT a.event_id, a.needs_coach_plate
    INTO v_event_id, v_current_needs_coach_plate
  FROM public.attendees AS a
  WHERE a.id = p_attendee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendee_not_found' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_event_task_authority('event.attendees.manage', v_event_id) THEN
    RAISE EXCEPTION 'authorization_denied' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  -- Idempotent retries report the persisted state without an unnecessary
  -- attendee UPDATE or any other side effect.
  IF v_current_needs_coach_plate IS NOT DISTINCT FROM p_needs_coach_plate THEN
    RETURN QUERY
    SELECT 'unchanged'::text, v_event_id, p_attendee_id, v_current_needs_coach_plate;
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.attendees AS a
  SET needs_coach_plate = p_needs_coach_plate
  WHERE a.id = p_attendee_id
  RETURNING 'updated'::text, a.event_id, a.id, a.needs_coach_plate;
END;
$function$;

ALTER FUNCTION public.set_attendee_coach_plate_need(uuid, boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_attendee_coach_plate_need(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.set_attendee_coach_plate_need(uuid, boolean)
  TO authenticated;

-- ============================================================
-- PARITY END

CREATE FUNCTION public.attendee_operational_needs_fixture_assert(
  p_condition boolean,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Attendee operational-needs fixture assertion failed: %', p_message;
  END IF;
END;
$function$;

ALTER FUNCTION public.attendee_operational_needs_fixture_assert(boolean, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.attendee_operational_needs_fixture_assert(boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $fixture$
BEGIN
  PERFORM public.attendee_operational_needs_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM public.tenants
      WHERE organization_code = 'ATTENDEE-OPS-NEEDS-FIXTURE'
    ),
    'fixture tenant identity must be unused before setup'
  );

  INSERT INTO public.tenants (
    id, organization_code, slug, organization_name, display_name, app_title
  ) VALUES (
    'a4000000-0000-4000-8000-000000000001',
    'ATTENDEE-OPS-NEEDS-FIXTURE',
    'attendee-operational-needs-fixture',
    'Attendee Operational Needs Fixture',
    'Attendee Operational Needs Fixture',
    'Attendee Operational Needs Fixture'
  );

  INSERT INTO public.events (
    id, tenant_id, name, start_date, end_date, timezone, lifecycle_state,
    status, visible_to_members, is_active, event_code, location
  ) VALUES
    (
      'a4000000-0000-4000-8000-000000000011',
      'a4000000-0000-4000-8000-000000000001',
      'Attendee Operational Needs Fixture Operational Event', current_date,
      current_date + 7, 'UTC', 'operational', 'active', true, true,
      'ATT-OPS-NEED-A', 'Fixture A'
    ),
    (
      'a4000000-0000-4000-8000-000000000012',
      'a4000000-0000-4000-8000-000000000001',
      'Attendee Operational Needs Fixture Cross Event', current_date,
      current_date + 7, 'UTC', 'operational', 'active', true, true,
      'ATT-OPS-NEED-B', 'Fixture B'
    ),
    (
      'a4000000-0000-4000-8000-000000000013',
      'a4000000-0000-4000-8000-000000000001',
      'Attendee Operational Needs Fixture Archived Event', current_date,
      current_date + 7, 'UTC', 'archived', 'archived', true, true,
      'ATT-OPS-NEED-C', 'Fixture C'
    );

  INSERT INTO auth.users (id, email) VALUES
    ('a4000000-0000-4000-8000-000000000101', 'attendee-ops-authorized@fixture.invalid'),
    ('a4000000-0000-4000-8000-000000000102', 'attendee-ops-denied@fixture.invalid');

  INSERT INTO public.admin_users (
    id, user_id, email, display_name, is_active, is_super_admin, privilege_group
  ) VALUES
    (
      'a4000000-0000-4000-8000-000000000201',
      'a4000000-0000-4000-8000-000000000101',
      'attendee-ops-authorized@fixture.invalid',
      'Attendee Operational Needs Fixture Authorized', true, false, 'event_admin'
    ),
    (
      'a4000000-0000-4000-8000-000000000202',
      'a4000000-0000-4000-8000-000000000102',
      'attendee-ops-denied@fixture.invalid',
      'Attendee Operational Needs Fixture Denied', true, false, 'event_admin'
    );

  INSERT INTO public.admin_event_access (id, admin_user_id, event_id, role) VALUES
    (
      'a4000000-0000-4000-8000-000000000301',
      'a4000000-0000-4000-8000-000000000201',
      'a4000000-0000-4000-8000-000000000011', 'event_admin'
    ),
    (
      'a4000000-0000-4000-8000-000000000302',
      'a4000000-0000-4000-8000-000000000201',
      'a4000000-0000-4000-8000-000000000013', 'event_admin'
    ),
    (
      'a4000000-0000-4000-8000-000000000303',
      'a4000000-0000-4000-8000-000000000202',
      'a4000000-0000-4000-8000-000000000011', 'event_admin'
    );

  INSERT INTO public.admin_event_permissions (admin_event_access_id, permission_key)
  VALUES
    ('a4000000-0000-4000-8000-000000000301', 'event.attendees.manage'),
    ('a4000000-0000-4000-8000-000000000302', 'event.attendees.manage'),
    ('a4000000-0000-4000-8000-000000000303', 'event.attendees.view');

  -- Both ordinary creation paths omit the three operational fields and so
  -- retain the single canonical database defaults. These commands correct
  -- pre-existing records only; no historical backfill is performed.
  INSERT INTO public.attendees (
    id, event_id, entry_id, email, pilot_first, pilot_last, source_type,
    is_active, registration_status
  ) VALUES
    (
      'a4000000-0000-4000-8000-000000000401',
      'a4000000-0000-4000-8000-000000000011', 'OPS-DEFAULT-MANUAL',
      'attendee-ops-default-manual@fixture.invalid', 'Operational', 'Manual', 'manual',
      true, 'active'
    ),
    (
      'a4000000-0000-4000-8000-000000000402',
      'a4000000-0000-4000-8000-000000000011', 'OPS-DEFAULT-IMPORT',
      'attendee-ops-default-import@fixture.invalid', 'Operational', 'Import', 'imported',
      true, 'active'
    ),
    (
      'a4000000-0000-4000-8000-000000000403',
      'a4000000-0000-4000-8000-000000000011', 'OPS-NAME-TAG',
      'attendee-ops-name-tag@fixture.invalid', 'Name', 'Tag', 'manual', true, 'active'
    ),
    (
      'a4000000-0000-4000-8000-000000000404',
      'a4000000-0000-4000-8000-000000000011', 'OPS-COACH-PLATE',
      'attendee-ops-coach-plate@fixture.invalid', 'Coach', 'Plate', 'manual', true, 'active'
    ),
    (
      'a4000000-0000-4000-8000-000000000405',
      'a4000000-0000-4000-8000-000000000012', 'OPS-CROSS-EVENT',
      'attendee-ops-cross@fixture.invalid', 'Cross', 'Event', 'manual', true, 'active'
    ),
    (
      'a4000000-0000-4000-8000-000000000406',
      'a4000000-0000-4000-8000-000000000013', 'OPS-ARCHIVED',
      'attendee-ops-archived@fixture.invalid', 'Archived', 'Event', 'manual', true, 'active'
    ),
    (
      'a4000000-0000-4000-8000-000000000407',
      'a4000000-0000-4000-8000-000000000011', 'OPS-DENIED',
      'attendee-ops-denied@fixture.invalid', 'Denied', 'Authority', 'manual', true, 'active'
    );

  -- A canonical Parking assignment deliberately exists for the Name Tag
  -- case. Unlike parking intent, these requirement corrections have no
  -- placement conflict and must never alter Arrival, legacy projection, or
  -- the canonical Parking relationship.
  UPDATE public.attendees
  SET has_arrived = true, assigned_site = 'Legacy Placement Projection'
  WHERE id = 'a4000000-0000-4000-8000-000000000403';

  UPDATE public.attendees
  SET needs_name_tag = false, needs_parking = false, has_arrived = true,
      assigned_site = 'Legacy Coach Projection'
  WHERE id = 'a4000000-0000-4000-8000-000000000404';

  INSERT INTO public.parking_sites (
    id, event_id, site_number, display_label, assigned_attendee_id
  ) VALUES (
    'a4000000-0000-4000-8000-000000000501',
    'a4000000-0000-4000-8000-000000000011',
    'OPS-NEED-1', 'Operational Needs Fixture Site',
    'a4000000-0000-4000-8000-000000000403'
  );
END;
$fixture$;

DO $fixture$
DECLARE
  v_outcome text;
  v_name_tag boolean;
  v_coach_plate boolean;
  v_name_tag_null_denied boolean := false;
  v_coach_plate_null_denied boolean := false;
  v_missing_denied boolean := false;
  v_denied boolean := false;
  v_cross_event_denied boolean := false;
  v_lifecycle_denied boolean := false;
  v_anonymous_denied boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a4000000-0000-4000-8000-000000000101', true);

  PERFORM public.attendee_operational_needs_fixture_assert(
    (SELECT needs_name_tag IS TRUE AND needs_coach_plate IS TRUE AND needs_parking IS TRUE
       FROM public.attendees WHERE id = 'a4000000-0000-4000-8000-000000000401')
    AND
    (SELECT needs_name_tag IS TRUE AND needs_coach_plate IS TRUE AND needs_parking IS TRUE
       FROM public.attendees WHERE id = 'a4000000-0000-4000-8000-000000000402'),
    'manual and governed-import default creation both persist all operational needs as true'
  );

  SELECT outcome, needs_name_tag INTO v_outcome, v_name_tag
  FROM public.set_attendee_name_tag_need('a4000000-0000-4000-8000-000000000403', false);
  PERFORM public.attendee_operational_needs_fixture_assert(
    v_outcome = 'updated' AND v_name_tag IS FALSE
      AND (SELECT needs_coach_plate IS TRUE AND needs_parking IS TRUE
                  AND has_arrived IS TRUE AND assigned_site = 'Legacy Placement Projection'
             FROM public.attendees WHERE id = 'a4000000-0000-4000-8000-000000000403')
      AND (SELECT assigned_attendee_id = 'a4000000-0000-4000-8000-000000000403'
             FROM public.parking_sites WHERE id = 'a4000000-0000-4000-8000-000000000501'),
    'Name Tag true to false changes only Name Tag and does not create a Parking-style conflict'
  );

  SELECT outcome, needs_name_tag INTO v_outcome, v_name_tag
  FROM public.set_attendee_name_tag_need('a4000000-0000-4000-8000-000000000403', true);
  PERFORM public.attendee_operational_needs_fixture_assert(
    v_outcome = 'updated' AND v_name_tag IS TRUE
      AND (SELECT needs_coach_plate IS TRUE AND needs_parking IS TRUE
                  AND has_arrived IS TRUE AND assigned_site = 'Legacy Placement Projection'
             FROM public.attendees WHERE id = 'a4000000-0000-4000-8000-000000000403'),
    'Name Tag false to true changes only Name Tag'
  );

  SELECT outcome INTO v_outcome
  FROM public.set_attendee_name_tag_need('a4000000-0000-4000-8000-000000000403', true);
  PERFORM public.attendee_operational_needs_fixture_assert(
    v_outcome = 'unchanged',
    'same requested Name Tag need is idempotent without a second attendee update'
  );

  SELECT outcome, needs_coach_plate INTO v_outcome, v_coach_plate
  FROM public.set_attendee_coach_plate_need('a4000000-0000-4000-8000-000000000404', false);
  PERFORM public.attendee_operational_needs_fixture_assert(
    v_outcome = 'updated' AND v_coach_plate IS FALSE
      AND (SELECT needs_name_tag IS FALSE AND needs_parking IS FALSE
                  AND has_arrived IS TRUE AND assigned_site = 'Legacy Coach Projection'
             FROM public.attendees WHERE id = 'a4000000-0000-4000-8000-000000000404'),
    'Coach Plate true to false changes only Coach Plate'
  );

  SELECT outcome, needs_coach_plate INTO v_outcome, v_coach_plate
  FROM public.set_attendee_coach_plate_need('a4000000-0000-4000-8000-000000000404', true);
  PERFORM public.attendee_operational_needs_fixture_assert(
    v_outcome = 'updated' AND v_coach_plate IS TRUE
      AND (SELECT needs_name_tag IS FALSE AND needs_parking IS FALSE
                  AND has_arrived IS TRUE AND assigned_site = 'Legacy Coach Projection'
             FROM public.attendees WHERE id = 'a4000000-0000-4000-8000-000000000404'),
    'Coach Plate false to true changes only Coach Plate'
  );

  SELECT outcome INTO v_outcome
  FROM public.set_attendee_coach_plate_need('a4000000-0000-4000-8000-000000000404', true);
  PERFORM public.attendee_operational_needs_fixture_assert(
    v_outcome = 'unchanged',
    'same requested Coach Plate need is idempotent without a second attendee update'
  );

  BEGIN
    PERFORM public.set_attendee_name_tag_need('a4000000-0000-4000-8000-000000000403', NULL);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_name_tag_null_denied := SQLERRM = 'name_tag_need_required';
  END;
  BEGIN
    PERFORM public.set_attendee_coach_plate_need('a4000000-0000-4000-8000-000000000404', NULL);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_coach_plate_null_denied := SQLERRM = 'coach_plate_need_required';
  END;
  BEGIN
    PERFORM public.set_attendee_name_tag_need('a4000000-0000-4000-8000-000000000499', false);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_missing_denied := SQLERRM = 'attendee_not_found';
  END;
  PERFORM public.attendee_operational_needs_fixture_assert(
    v_name_tag_null_denied AND v_coach_plate_null_denied AND v_missing_denied,
    'null requested need and missing attendee are rejected'
  );

  PERFORM set_config('request.jwt.claim.sub', 'a4000000-0000-4000-8000-000000000102', true);
  BEGIN
    PERFORM public.set_attendee_name_tag_need('a4000000-0000-4000-8000-000000000407', false);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := SQLERRM = 'authorization_denied';
  END;
  PERFORM public.attendee_operational_needs_fixture_assert(
    v_denied
      AND (SELECT needs_name_tag IS TRUE AND needs_coach_plate IS TRUE
             FROM public.attendees WHERE id = 'a4000000-0000-4000-8000-000000000407'),
    'caller without event.attendees.manage is denied with zero mutation'
  );

  PERFORM set_config('request.jwt.claim.sub', 'a4000000-0000-4000-8000-000000000101', true);
  BEGIN
    PERFORM public.set_attendee_coach_plate_need('a4000000-0000-4000-8000-000000000405', false);
  EXCEPTION WHEN insufficient_privilege THEN
    v_cross_event_denied := SQLERRM = 'authorization_denied';
  END;
  PERFORM public.attendee_operational_needs_fixture_assert(
    v_cross_event_denied
      AND (SELECT needs_name_tag IS TRUE AND needs_coach_plate IS TRUE
             FROM public.attendees WHERE id = 'a4000000-0000-4000-8000-000000000405'),
    'authority is derived from the attendee Event and cannot cross Events'
  );

  BEGIN
    PERFORM public.set_attendee_name_tag_need('a4000000-0000-4000-8000-000000000406', false);
  EXCEPTION WHEN OTHERS THEN
    v_lifecycle_denied := SQLERRM = 'event_archived';
  END;
  PERFORM public.attendee_operational_needs_fixture_assert(
    v_lifecycle_denied
      AND (SELECT needs_name_tag IS TRUE AND needs_coach_plate IS TRUE
             FROM public.attendees WHERE id = 'a4000000-0000-4000-8000-000000000406'),
    'archived Event lifecycle denial leaves needs untouched'
  );

  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.set_attendee_coach_plate_need('a4000000-0000-4000-8000-000000000404', false);
  EXCEPTION WHEN insufficient_privilege THEN
    v_anonymous_denied := SQLERRM = 'unauthorized';
  END;
  PERFORM public.attendee_operational_needs_fixture_assert(
    v_anonymous_denied,
    'anonymous caller is denied'
  );

  PERFORM public.attendee_operational_needs_fixture_assert(
    NOT has_function_privilege('anon', 'public.set_attendee_name_tag_need(uuid,boolean)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.set_attendee_name_tag_need(uuid,boolean)', 'EXECUTE')
      AND NOT has_function_privilege('service_role', 'public.set_attendee_name_tag_need(uuid,boolean)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.set_attendee_coach_plate_need(uuid,boolean)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.set_attendee_coach_plate_need(uuid,boolean)', 'EXECUTE')
      AND NOT has_function_privilege('service_role', 'public.set_attendee_coach_plate_need(uuid,boolean)', 'EXECUTE'),
    'both operational-need RPC grants are authenticated-only'
  );
END;
$fixture$;

ROLLBACK;

DO $post_rollback$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tenants
    WHERE organization_code = 'ATTENDEE-OPS-NEEDS-FIXTURE'
  ) OR EXISTS (
    SELECT 1 FROM public.events
    WHERE event_code IN ('ATT-OPS-NEED-A', 'ATT-OPS-NEED-B', 'ATT-OPS-NEED-C')
  ) OR EXISTS (
    SELECT 1 FROM public.attendees
    WHERE entry_id LIKE 'OPS-%'
  ) OR EXISTS (
    SELECT 1 FROM public.parking_sites
    WHERE id = 'a4000000-0000-4000-8000-000000000501'
  ) OR to_regprocedure('public.set_attendee_name_tag_need(uuid,boolean)') IS NOT NULL
    OR to_regprocedure('public.set_attendee_coach_plate_need(uuid,boolean)') IS NOT NULL
    OR to_regprocedure('public.attendee_operational_needs_fixture_assert(boolean,text)') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations
      WHERE version = '20260825040000'
    )
  THEN
    RAISE EXCEPTION 'Attendee operational-needs fixture rollback left residue';
  END IF;
END;
$post_rollback$;
