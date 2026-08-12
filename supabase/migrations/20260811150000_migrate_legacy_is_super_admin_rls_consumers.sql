-- Cohort A: migrate the five legacy is_super_admin(uuid) RLS consumers to
-- the accepted Platform authority primitive. The predicates are semantically
-- equivalent for this authority decision; no other policy branch changes.

BEGIN;

DROP POLICY "Admins can view their event access" ON public.admin_event_access;
CREATE POLICY "Admins can view their event access"
  ON public.admin_event_access
  FOR SELECT
  TO authenticated
  USING (
    (admin_user_id IN (
      SELECT admin_users.id
      FROM public.admin_users
      WHERE admin_users.user_id = auth.uid()
    ))
    OR public.has_platform_admin_authority(auth.uid())
  );

DROP POLICY "Super admins can assign event access" ON public.admin_event_access;
CREATE POLICY "Super admins can assign event access"
  ON public.admin_event_access
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_platform_admin_authority(auth.uid()));

DROP POLICY "Super admins can remove event access" ON public.admin_event_access;
CREATE POLICY "Super admins can remove event access"
  ON public.admin_event_access
  FOR DELETE
  TO authenticated
  USING (public.has_platform_admin_authority(auth.uid()));

DROP POLICY "Super admins can update event access" ON public.admin_event_access;
CREATE POLICY "Super admins can update event access"
  ON public.admin_event_access
  FOR UPDATE
  TO authenticated
  USING (public.has_platform_admin_authority(auth.uid()));

DROP POLICY "Admins can view admins" ON public.admin_users;
CREATE POLICY "Admins can view admins"
  ON public.admin_users
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_platform_admin_authority(auth.uid())
  );

COMMIT;
