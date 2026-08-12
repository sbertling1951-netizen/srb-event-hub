-- Event assignments are authority relationships. Direct browser mutations
-- would bypass the governed task-authority operations, so retain self/platform
-- reads only and remove the legacy direct mutation policies.
BEGIN;

DROP POLICY "Super admins can assign event access" ON public.admin_event_access;
DROP POLICY "Super admins can remove event access" ON public.admin_event_access;
DROP POLICY "Super admins can update event access" ON public.admin_event_access;

COMMIT;
