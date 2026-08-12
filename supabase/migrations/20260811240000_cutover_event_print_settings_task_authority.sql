-- Cohort 2 Event-task RLS cutover: print settings.
-- Authority is resolved only through the canonical task resolver against the
-- protected row's stored event_id; no legacy administrative fallback remains.
BEGIN;

DROP POLICY "Admins can manage event_print_settings" ON public.event_print_settings;

CREATE POLICY "Event task admins can read event_print_settings"
  ON public.event_print_settings
  FOR SELECT TO authenticated
  USING (public.has_event_task_authority('event.print.view', event_id));

CREATE POLICY "Event task admins can insert event_print_settings"
  ON public.event_print_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_event_task_authority('event.print.manage', event_id));

CREATE POLICY "Event task admins can update event_print_settings"
  ON public.event_print_settings
  FOR UPDATE TO authenticated
  USING (public.has_event_task_authority('event.print.manage', event_id))
  WITH CHECK (public.has_event_task_authority('event.print.manage', event_id));

CREATE POLICY "Event task admins can delete event_print_settings"
  ON public.event_print_settings
  FOR DELETE TO authenticated
  USING (public.has_event_task_authority('event.print.manage', event_id));

COMMIT;
