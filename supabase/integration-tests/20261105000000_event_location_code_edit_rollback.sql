-- Local existing test admin; all created Event/audit rows are rolled back.
BEGIN;
SELECT set_config('request.jwt.claim.sub', (SELECT user_id::text FROM public.admin_users WHERE is_active AND privilege_group = 'super_admin' LIMIT 1), true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE location_code_result AS
SELECT * FROM public.create_event_for_tenant(
  p_tenant_id := '00000000-0000-0000-0000-000000000001',
  p_name := 'Location code rollback fixture',
  p_end_date := '2027-04-30', p_timezone := 'America/Chicago',
  p_location := 'Test venue', p_location_code := ' 86HJ8X2W+2X ');
RESET ROLE;
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO STRICT v_id FROM location_code_result WHERE location_code = '86HJ8X2W+2X';
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_id AND location_code = '86HJ8X2W+2X' AND location = 'Test venue') THEN
    RAISE EXCEPTION 'Event location code not persisted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_definition_command_audit WHERE event_id = v_id AND after_state->>'location_code' = '86HJ8X2W+2X') THEN
    RAISE EXCEPTION 'Event creation audit omitted location code';
  END IF;
  IF has_function_privilege('anon', 'public.create_event_for_tenant(uuid,text,date,text,date,text,text,numeric,numeric,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous creation granted';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE v record; updated public.events;
BEGIN
  SELECT * INTO STRICT v FROM location_code_result;
  SELECT * INTO updated FROM public.admin_save_event_details_guarded(p_event_id := v.id,
    p_name := v.name,
    p_location := v.location,
    p_start_date := v.start_date,
    p_end_date := v.end_date,
    p_event_code := v.event_code,
    p_status := v.status,
    p_is_active := v.is_active,
    p_visible_to_members := v.visible_to_members,
    p_lat := v.lat,
    p_lng := v.lng,
    p_write_coordinates := false,
    p_expected_name := v.name,
    p_expected_location := v.location,
    p_expected_start_date := v.start_date,
    p_expected_end_date := v.end_date,
    p_expected_event_code := v.event_code,
    p_expected_status := v.status,
    p_expected_is_active := v.is_active,
    p_expected_visible_to_members := v.visible_to_members,
    p_expected_lat := v.lat,
    p_expected_lng := v.lng,
    p_location_code := ' Updated code ',
    p_expected_location_code := v.location_code,
    p_write_location_code := true);
  IF updated.location_code <> 'Updated code' THEN RAISE EXCEPTION 'Code update failed'; END IF;
  BEGIN
    PERFORM public.admin_save_event_details_guarded(p_event_id := v.id,
    p_name := v.name,
    p_location := v.location,
    p_start_date := v.start_date,
    p_end_date := v.end_date,
    p_event_code := v.event_code,
    p_status := v.status,
    p_is_active := v.is_active,
    p_visible_to_members := v.visible_to_members,
    p_lat := v.lat,
    p_lng := v.lng,
    p_write_coordinates := false,
    p_expected_name := v.name,
    p_expected_location := v.location,
    p_expected_start_date := v.start_date,
    p_expected_end_date := v.end_date,
    p_expected_event_code := v.event_code,
    p_expected_status := v.status,
    p_expected_is_active := v.is_active,
    p_expected_visible_to_members := v.visible_to_members,
    p_expected_lat := v.lat,
    p_expected_lng := v.lng,
    p_location_code := ' Updated code ',
    p_expected_location_code := v.location_code,
    p_write_location_code := true);
    RAISE EXCEPTION 'Stale code overwrite allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'stale_event_details' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
ROLLBACK;
