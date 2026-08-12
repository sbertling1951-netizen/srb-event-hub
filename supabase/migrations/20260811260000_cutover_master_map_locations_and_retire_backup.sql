-- Master Map disposition: locations remain a public projection with
-- Platform-only catalog mutation; the orphaned legacy backup is retired.
BEGIN;

DROP POLICY "Admins can manage master_map_locations" ON public.master_map_locations;

CREATE POLICY "Platform admins can insert master_map_locations"
  ON public.master_map_locations
  FOR INSERT TO authenticated
  WITH CHECK (public.has_platform_admin_authority(auth.uid()));

CREATE POLICY "Platform admins can update master_map_locations"
  ON public.master_map_locations
  FOR UPDATE TO authenticated
  USING (public.has_platform_admin_authority(auth.uid()))
  WITH CHECK (public.has_platform_admin_authority(auth.uid()));

CREATE POLICY "Platform admins can delete master_map_locations"
  ON public.master_map_locations
  FOR DELETE TO authenticated
  USING (public.has_platform_admin_authority(auth.uid()));

-- Deliberately no CASCADE: an unobserved dependency must stop this migration.
DROP TABLE public.master_map_sites_backup;

COMMIT;
