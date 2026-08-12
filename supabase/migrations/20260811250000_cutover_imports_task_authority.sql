-- Imports authority cutover: retire obsolete anonymous creation and bind all
-- remaining access to canonical Event tasks using each protected row's event_id.
BEGIN;

DROP POLICY "Public insert imports" ON public.imports;
DROP POLICY "Admins can manage imports" ON public.imports;

CREATE POLICY "Event task admins can read imports"
  ON public.imports
  FOR SELECT TO authenticated
  USING (public.has_event_task_authority('event.imports.view', event_id));

CREATE POLICY "Event task admins can insert imports"
  ON public.imports
  FOR INSERT TO authenticated
  WITH CHECK (public.has_event_task_authority('event.imports.manage', event_id));

CREATE POLICY "Event task admins can update imports"
  ON public.imports
  FOR UPDATE TO authenticated
  USING (public.has_event_task_authority('event.imports.manage', event_id))
  WITH CHECK (public.has_event_task_authority('event.imports.manage', event_id));

CREATE POLICY "Event task admins can delete imports"
  ON public.imports
  FOR DELETE TO authenticated
  USING (public.has_event_task_authority('event.imports.manage', event_id));

DROP POLICY "Admins can manage event_import_rows" ON public.event_import_rows;

CREATE POLICY "Event task admins can read event_import_rows"
  ON public.event_import_rows
  FOR SELECT TO authenticated
  USING (public.has_event_task_authority('event.imports.view', event_id));

CREATE POLICY "Event task admins can insert event_import_rows"
  ON public.event_import_rows
  FOR INSERT TO authenticated
  WITH CHECK (public.has_event_task_authority('event.imports.manage', event_id));

CREATE POLICY "Event task admins can update event_import_rows"
  ON public.event_import_rows
  FOR UPDATE TO authenticated
  USING (public.has_event_task_authority('event.imports.manage', event_id))
  WITH CHECK (public.has_event_task_authority('event.imports.manage', event_id));

CREATE POLICY "Event task admins can delete event_import_rows"
  ON public.event_import_rows
  FOR DELETE TO authenticated
  USING (public.has_event_task_authority('event.imports.manage', event_id));

COMMIT;
