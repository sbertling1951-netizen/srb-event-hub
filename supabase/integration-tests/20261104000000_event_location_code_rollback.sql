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
ROLLBACK;
