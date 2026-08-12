-- One minimal, read-only exception to this CMD's "application code only"
-- scope: event_agenda_state has zero SELECT policies by design (backend
-- CMD Stage 14: "RLS enabled; zero policies unless a later governed read
-- explicitly requires one"). This IS that later moment -- the Admin
-- Agenda UI cutover requires reading the current version on page load
-- (governing Stage 3), and every mutating RPC requires a real version
-- be supplied, so there is no way to satisfy that requirement without
-- some read path. No other table, policy, or RPC is touched.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_event_agenda_version(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_version integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT (public.has_event_task_authority('event.agenda.view', p_event_id)
          OR public.has_event_task_authority('event.agenda.manage', p_event_id)) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT s.version INTO v_version FROM public.event_agenda_state AS s WHERE s.event_id = p_event_id;
  IF NOT FOUND THEN
    INSERT INTO public.event_agenda_state(event_id, version) VALUES (p_event_id, 0)
    ON CONFLICT (event_id) DO NOTHING;
    SELECT s.version INTO v_version FROM public.event_agenda_state AS s WHERE s.event_id = p_event_id;
  END IF;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_agenda_version(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_agenda_version(uuid) TO authenticated;

COMMIT;
