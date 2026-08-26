-- Linked-database proof for the pending governed attendee parking-need
-- command. The migration definition and all isolated fixture evidence are
-- installed inside one transaction and removed by the outer rollback.

BEGIN;

-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

CREATE FUNCTION public.set_attendee_parking_need(
  p_attendee_id uuid,
  p_needs_parking boolean
)
RETURNS TABLE(
  outcome text,
  event_id uuid,
  attendee_id uuid,
  needs_parking boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_event_id uuid;
  v_current_needs_parking boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_attendee_id IS NULL OR p_needs_parking IS NULL THEN
    RAISE EXCEPTION 'parking_need_required' USING ERRCODE = '22023';
  END IF;

  -- Lock and derive scope from the canonical attendee row. The browser never
  -- supplies Event identity, so it cannot redirect this command across Events.
  SELECT a.event_id, a.needs_parking
    INTO v_event_id, v_current_needs_parking
  FROM public.attendees AS a
  WHERE a.id = p_attendee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendee_not_found' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_event_task_authority('event.attendees.manage', v_event_id) THEN
    RAISE EXCEPTION 'authorization_denied' USING ERRCODE = '42501';
  END IF;

  -- Operational intent is mutable only in the Event lifecycle states that
  -- allow ordinary governed attendee work. Authority is deliberately checked
  -- first, matching the established Event mutation pattern.
  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  -- Parking owns canonical placement. Never create the contradictory state
  -- "Doesn't Need Parking" plus an assigned parking site by silently clearing
  -- or changing that relationship here.
  IF p_needs_parking = false AND EXISTS (
    SELECT 1
    FROM public.parking_sites AS ps
    WHERE ps.event_id = v_event_id
      AND ps.assigned_attendee_id = p_attendee_id
  ) THEN
    RAISE EXCEPTION 'parking_assignment_must_be_removed_first'
      USING ERRCODE = '23514',
        DETAIL = 'Remove this attendee''s parking assignment in Parking before marking them as not needing parking.';
  END IF;

  -- Idempotent retries report the persisted state without an unnecessary
  -- attendee UPDATE or any other side effect.
  IF v_current_needs_parking IS NOT DISTINCT FROM p_needs_parking THEN
    RETURN QUERY
    SELECT 'unchanged'::text, v_event_id, p_attendee_id, v_current_needs_parking;
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.attendees AS a
  SET needs_parking = p_needs_parking
  WHERE a.id = p_attendee_id
  RETURNING 'updated'::text, a.event_id, a.id, a.needs_parking;
END;
$function$;

ALTER FUNCTION public.set_attendee_parking_need(uuid, boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_attendee_parking_need(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.set_attendee_parking_need(uuid, boolean)
  TO authenticated;

-- ============================================================
-- PARITY END

CREATE FUNCTION public.attendee_parking_need_fixture_assert(
  p_condition boolean,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Attendee parking-need fixture assertion failed: %', p_message;
  END IF;
END;
$function$;

ALTER FUNCTION public.attendee_parking_need_fixture_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.attendee_parking_need_fixture_assert(boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $fixture$
BEGIN
  PERFORM public.attendee_parking_need_fixture_assert(
    NOT EXISTS (
      SELECT 1
      FROM public.tenants
      WHERE organization_code = 'PARKING-NEED-FIXTURE'
    ),
    'fixture tenant identity must be unused before setup'
  );

  INSERT INTO public.tenants (
    id, organization_code, slug, organization_name, display_name, app_title
  ) VALUES (
    'a3000000-0000-4000-8000-000000000001',
    'PARKING-NEED-FIXTURE',
    'parking-need-fixture',
    'Attendee Parking Need Fixture',
    'Attendee Parking Need Fixture',
    'Attendee Parking Need Fixture'
  );

  INSERT INTO public.events (
    id, tenant_id, name, start_date, end_date, timezone, lifecycle_state,
    status, visible_to_members, is_active, event_code, location
  ) VALUES
    (
      'a3000000-0000-4000-8000-000000000011',
      'a3000000-0000-4000-8000-000000000001',
      'Attendee Parking Need Fixture Operational Event', current_date,
      current_date + 7, 'UTC', 'operational', 'active', true, true,
      'PARK-NEED-A', 'Fixture A'
    ),
    (
      'a3000000-0000-4000-8000-000000000012',
      'a3000000-0000-4000-8000-000000000001',
      'Attendee Parking Need Fixture Cross Event', current_date,
      current_date + 7, 'UTC', 'operational', 'active', true, true,
      'PARK-NEED-B', 'Fixture B'
    ),
    (
      'a3000000-0000-4000-8000-000000000013',
      'a3000000-0000-4000-8000-000000000001',
      'Attendee Parking Need Fixture Archived Event', current_date,
      current_date + 7, 'UTC', 'archived', 'archived', true, true,
      'PARK-NEED-C', 'Fixture C'
    );

  INSERT INTO auth.users (id, email) VALUES
    ('a3000000-0000-4000-8000-000000000101', 'parking-need-authorized@fixture.invalid'),
    ('a3000000-0000-4000-8000-000000000102', 'parking-need-denied@fixture.invalid');

  INSERT INTO public.admin_users (
    id, user_id, email, display_name, is_active, is_super_admin, privilege_group
  ) VALUES
    (
      'a3000000-0000-4000-8000-000000000201',
      'a3000000-0000-4000-8000-000000000101',
      'parking-need-authorized@fixture.invalid',
      'Parking Need Fixture Authorized', true, false, 'event_admin'
    ),
    (
      'a3000000-0000-4000-8000-000000000202',
      'a3000000-0000-4000-8000-000000000102',
      'parking-need-denied@fixture.invalid',
      'Parking Need Fixture Denied', true, false, 'event_admin'
    );

  INSERT INTO public.admin_event_access (id, admin_user_id, event_id, role) VALUES
    (
      'a3000000-0000-4000-8000-000000000301',
      'a3000000-0000-4000-8000-000000000201',
      'a3000000-0000-4000-8000-000000000011', 'event_admin'
    ),
    (
      'a3000000-0000-4000-8000-000000000302',
      'a3000000-0000-4000-8000-000000000201',
      'a3000000-0000-4000-8000-000000000013', 'event_admin'
    ),
    (
      'a3000000-0000-4000-8000-000000000303',
      'a3000000-0000-4000-8000-000000000202',
      'a3000000-0000-4000-8000-000000000011', 'event_admin'
    );

  INSERT INTO public.admin_event_permissions (
    admin_event_access_id, permission_key
  ) VALUES
    ('a3000000-0000-4000-8000-000000000301', 'event.attendees.manage'),
    ('a3000000-0000-4000-8000-000000000301', 'event.attendees.view'),
    ('a3000000-0000-4000-8000-000000000302', 'event.attendees.manage');

  -- Both ordinary creation paths omit the field and therefore receive the
  -- one canonical database default: Needs Parking.
  INSERT INTO public.attendees (
    id, event_id, entry_id, email, pilot_first, pilot_last, source_type,
    is_active, registration_status
  ) VALUES
    (
      'a3000000-0000-4000-8000-000000000401',
      'a3000000-0000-4000-8000-000000000011', 'PARK-DEFAULT-MANUAL',
      'parking-default-manual@fixture.invalid', 'Parking', 'Manual', 'manual',
      true, 'active'
    ),
    (
      'a3000000-0000-4000-8000-000000000402',
      'a3000000-0000-4000-8000-000000000011', 'PARK-DEFAULT-IMPORT',
      'parking-default-import@fixture.invalid', 'Parking', 'Import', 'imported',
      true, 'active'
    ),
    (
      'a3000000-0000-4000-8000-000000000403',
      'a3000000-0000-4000-8000-000000000011', 'PARK-TRUE-UNPLACED',
      'parking-true@fixture.invalid', 'Parking', 'True', 'manual',
      true, 'active'
    ),
    (
      'a3000000-0000-4000-8000-000000000404',
      'a3000000-0000-4000-8000-000000000011', 'PARK-FALSE-UNPLACED',
      'parking-false@fixture.invalid', 'Parking', 'False', 'manual',
      true, 'active'
    ),
    (
      'a3000000-0000-4000-8000-000000000405',
      'a3000000-0000-4000-8000-000000000011', 'PARK-TRUE-PLACED',
      'parking-placed@fixture.invalid', 'Parking', 'Placed', 'manual',
      true, 'active'
    ),
    (
      'a3000000-0000-4000-8000-000000000406',
      'a3000000-0000-4000-8000-000000000012', 'PARK-CROSS-EVENT',
      'parking-cross-event@fixture.invalid', 'Parking', 'Cross', 'manual',
      true, 'active'
    ),
    (
      'a3000000-0000-4000-8000-000000000407',
      'a3000000-0000-4000-8000-000000000013', 'PARK-ARCHIVED',
      'parking-archived@fixture.invalid', 'Parking', 'Archived', 'manual',
      true, 'active'
    ),
    (
      'a3000000-0000-4000-8000-000000000408',
      'a3000000-0000-4000-8000-000000000011', 'PARK-DENIED',
      'parking-denied@fixture.invalid', 'Parking', 'Denied', 'manual',
      true, 'active'
    );

  UPDATE public.attendees
  SET
    needs_parking = false,
    has_arrived = false,
    assigned_site = 'Legacy False Unchanged'
  WHERE id = 'a3000000-0000-4000-8000-000000000404';

  UPDATE public.attendees
  SET
    needs_parking = true,
    has_arrived = true,
    assigned_site = 'Legacy Assignment Unchanged'
  WHERE id = 'a3000000-0000-4000-8000-000000000405';

  INSERT INTO public.parking_sites (
    id, event_id, site_number, display_label, assigned_attendee_id
  ) VALUES (
    'a3000000-0000-4000-8000-000000000501',
    'a3000000-0000-4000-8000-000000000011',
    'PARK-FIXTURE-1', 'Parking Fixture Site',
    'a3000000-0000-4000-8000-000000000405'
  );
END;
$fixture$;

DO $fixture$
DECLARE
  v_outcome text;
  v_needs_parking boolean;
  v_summary_count bigint;
  v_denied boolean := false;
  v_cross_event_denied boolean := false;
  v_anonymous_denied boolean := false;
  v_null_denied boolean := false;
  v_missing_denied boolean := false;
  v_placed_denied boolean := false;
  v_lifecycle_denied boolean := false;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    'a3000000-0000-4000-8000-000000000101',
    true
  );

  PERFORM public.attendee_parking_need_fixture_assert(
    (SELECT needs_parking IS TRUE FROM public.attendees
      WHERE id = 'a3000000-0000-4000-8000-000000000401')
      AND
    (SELECT needs_parking IS TRUE FROM public.attendees
      WHERE id = 'a3000000-0000-4000-8000-000000000402'),
    'manual and governed-import default creation both persist Needs Parking'
  );

  SELECT active_needs_parking_unplaced
    INTO v_summary_count
  FROM public.get_event_operational_summary(
    'a3000000-0000-4000-8000-000000000011'
  );
  PERFORM public.attendee_parking_need_fixture_assert(
    v_summary_count = 4,
    'operational summary includes active Needs Parking plus no canonical placement'
  );

  SELECT outcome, needs_parking
    INTO v_outcome, v_needs_parking
  FROM public.set_attendee_parking_need(
    'a3000000-0000-4000-8000-000000000403', false
  );
  PERFORM public.attendee_parking_need_fixture_assert(
    v_outcome = 'updated'
      AND v_needs_parking IS FALSE
      AND (SELECT has_arrived IS FALSE AND assigned_site IS NULL
           FROM public.attendees
           WHERE id = 'a3000000-0000-4000-8000-000000000403')
      AND NOT EXISTS (
        SELECT 1
        FROM public.parking_sites
        WHERE assigned_attendee_id = 'a3000000-0000-4000-8000-000000000403'
      ),
    'unplaced true to false changes only parking intent'
  );

  SELECT active_needs_parking_unplaced
    INTO v_summary_count
  FROM public.get_event_operational_summary(
    'a3000000-0000-4000-8000-000000000011'
  );
  PERFORM public.attendee_parking_need_fixture_assert(
    v_summary_count = 3,
    'operational summary excludes an unplaced Does Not Need Parking attendee'
  );

  SELECT outcome, needs_parking
    INTO v_outcome, v_needs_parking
  FROM public.set_attendee_parking_need(
    'a3000000-0000-4000-8000-000000000404', true
  );
  PERFORM public.attendee_parking_need_fixture_assert(
    v_outcome = 'updated'
      AND v_needs_parking IS TRUE
      AND (SELECT has_arrived IS FALSE
             AND assigned_site = 'Legacy False Unchanged'
           FROM public.attendees
           WHERE id = 'a3000000-0000-4000-8000-000000000404')
      AND NOT EXISTS (
        SELECT 1
        FROM public.parking_sites
        WHERE assigned_attendee_id = 'a3000000-0000-4000-8000-000000000404'
      ),
    'unplaced false to true changes only parking intent'
  );

  SELECT outcome
    INTO v_outcome
  FROM public.set_attendee_parking_need(
    'a3000000-0000-4000-8000-000000000404', true
  );
  PERFORM public.attendee_parking_need_fixture_assert(
    v_outcome = 'unchanged',
    'same requested parking intent is idempotent without a second attendee update'
  );

  BEGIN
    PERFORM public.set_attendee_parking_need(
      'a3000000-0000-4000-8000-000000000405', false
    );
  EXCEPTION WHEN check_violation THEN
    v_placed_denied := SQLERRM = 'parking_assignment_must_be_removed_first';
  END;
  PERFORM public.attendee_parking_need_fixture_assert(
    v_placed_denied
      AND (SELECT needs_parking IS TRUE
             AND has_arrived IS TRUE
             AND assigned_site = 'Legacy Assignment Unchanged'
           FROM public.attendees
           WHERE id = 'a3000000-0000-4000-8000-000000000405')
      AND (SELECT assigned_attendee_id = 'a3000000-0000-4000-8000-000000000405'
           FROM public.parking_sites
           WHERE id = 'a3000000-0000-4000-8000-000000000501'),
    'placed true to false is rejected and leaves Arrival, legacy projection, and canonical placement untouched'
  );

  SELECT active_needs_parking_unplaced
    INTO v_summary_count
  FROM public.get_event_operational_summary(
    'a3000000-0000-4000-8000-000000000011'
  );
  PERFORM public.attendee_parking_need_fixture_assert(
    v_summary_count = 4,
    'operational summary excludes placed Needs Parking and retains unplaced Needs Parking only'
  );

  BEGIN
    PERFORM public.set_attendee_parking_need(
      'a3000000-0000-4000-8000-000000000403', NULL
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_null_denied := SQLERRM = 'parking_need_required';
  END;
  PERFORM public.attendee_parking_need_fixture_assert(
    v_null_denied,
    'null requested parking need is rejected'
  );

  BEGIN
    PERFORM public.set_attendee_parking_need(
      'a3000000-0000-4000-8000-000000000499', true
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_missing_denied := SQLERRM = 'attendee_not_found';
  END;
  PERFORM public.attendee_parking_need_fixture_assert(
    v_missing_denied,
    'missing attendee is rejected'
  );

  PERFORM set_config(
    'request.jwt.claim.sub',
    'a3000000-0000-4000-8000-000000000102',
    true
  );
  BEGIN
    PERFORM public.set_attendee_parking_need(
      'a3000000-0000-4000-8000-000000000408', false
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := SQLERRM = 'authorization_denied';
  END;
  PERFORM public.attendee_parking_need_fixture_assert(
    v_denied
      AND (SELECT needs_parking IS TRUE
           FROM public.attendees
           WHERE id = 'a3000000-0000-4000-8000-000000000408'),
    'caller without event.attendees.manage is denied with zero mutation'
  );

  PERFORM set_config(
    'request.jwt.claim.sub',
    'a3000000-0000-4000-8000-000000000101',
    true
  );
  BEGIN
    PERFORM public.set_attendee_parking_need(
      'a3000000-0000-4000-8000-000000000406', false
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_cross_event_denied := SQLERRM = 'authorization_denied';
  END;
  PERFORM public.attendee_parking_need_fixture_assert(
    v_cross_event_denied
      AND (SELECT needs_parking IS TRUE
           FROM public.attendees
           WHERE id = 'a3000000-0000-4000-8000-000000000406'),
    'authority is derived from the attendee Event and cannot cross Events'
  );

  BEGIN
    PERFORM public.set_attendee_parking_need(
      'a3000000-0000-4000-8000-000000000407', false
    );
  EXCEPTION WHEN OTHERS THEN
    v_lifecycle_denied := SQLERRM = 'event_archived';
  END;
  PERFORM public.attendee_parking_need_fixture_assert(
    v_lifecycle_denied
      AND (SELECT needs_parking IS TRUE
           FROM public.attendees
           WHERE id = 'a3000000-0000-4000-8000-000000000407'),
    'archived Event lifecycle denial leaves parking need untouched'
  );

  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.set_attendee_parking_need(
      'a3000000-0000-4000-8000-000000000403', true
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_anonymous_denied := SQLERRM = 'unauthorized';
  END;
  PERFORM public.attendee_parking_need_fixture_assert(
    v_anonymous_denied,
    'anonymous caller is denied'
  );

  PERFORM public.attendee_parking_need_fixture_assert(
    NOT has_function_privilege(
      'anon',
      'public.set_attendee_parking_need(uuid,boolean)',
      'EXECUTE'
    )
      AND has_function_privilege(
        'authenticated',
        'public.set_attendee_parking_need(uuid,boolean)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'service_role',
        'public.set_attendee_parking_need(uuid,boolean)',
        'EXECUTE'
      ),
    'parking need RPC grants are authenticated-only'
  );
END;
$fixture$;

ROLLBACK;

DO $post_rollback$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tenants
    WHERE organization_code = 'PARKING-NEED-FIXTURE'
  ) OR EXISTS (
    SELECT 1
    FROM public.events
    WHERE event_code IN ('PARK-NEED-A', 'PARK-NEED-B', 'PARK-NEED-C')
  ) OR EXISTS (
    SELECT 1
    FROM public.attendees
    WHERE entry_id LIKE 'PARK-%'
  ) OR EXISTS (
    SELECT 1
    FROM public.parking_sites
    WHERE id = 'a3000000-0000-4000-8000-000000000501'
  ) OR to_regprocedure('public.set_attendee_parking_need(uuid,boolean)') IS NOT NULL
    OR to_regprocedure('public.attendee_parking_need_fixture_assert(boolean,text)') IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM supabase_migrations.schema_migrations
      WHERE version = '20260825030000'
    )
  THEN
    RAISE EXCEPTION 'Attendee parking-need fixture rollback left residue';
  END IF;
END;
$post_rollback$;
