-- Cohort B1: migrate the six genuinely Platform-governed is_current_admin()
-- RLS consumers to the accepted Platform authority primitive.
--
-- Affected tables: admin_permissions, area_groups, nearby_categories,
-- nearby_master_places, shared_area_locations, user_roles.
--
-- Scope: exactly the six "Admins can manage <table>" ALL-command policies.
-- Held back (separate, later decisions): agenda_templates and its 3 sibling
-- tables (Agenda-template ownership is a product/Tenant-Event decision, no
-- ownership model exists yet), vendor_org_access (mixes global Vendor
-- grants with Event-bound invitations, not a simple Platform boundary),
-- and every Event/Tenant operational table (event_staff, event_locations,
-- event_nearby_places, event_print_settings, event_import_rows, imports,
-- master_map_locations, master_map_sites_backup, admin_event_permissions).
--
-- The legacy policies were scoped TO PUBLIC (no TO clause -- polroles =
-- {0}), inherited from is_current_admin() itself having anon/PUBLIC
-- EXECUTE before the prior ACL repair. has_platform_admin_authority(uuid)
-- has never had anon/PUBLIC EXECUTE (authenticated-only by design), so the
-- replacement policies are scoped explicitly TO authenticated here --
-- preserving the old PUBLIC role scope would either mask nothing (rows
-- always denied to anon either way) or, for the two tables with no
-- independent public-read policy (admin_permissions, user_roles), turn a
-- silent 0-row anon result into a permission-denied error. Scoping TO
-- authenticated is the correct, intended execution boundary, not a
-- narrowing of who legitimately gets access.
--
-- Each independent "Anyone can read <table>" USING (true) SELECT policy on
-- area_groups, nearby_categories, nearby_master_places, and
-- shared_area_locations is untouched by this migration.

DROP POLICY "Admins can manage admin_permissions" ON public.admin_permissions;
CREATE POLICY "Admins can manage admin_permissions"
  ON public.admin_permissions
  FOR ALL
  TO authenticated
  USING (public.has_platform_admin_authority(auth.uid()))
  WITH CHECK (public.has_platform_admin_authority(auth.uid()));

DROP POLICY "Admins can manage area_groups" ON public.area_groups;
CREATE POLICY "Admins can manage area_groups"
  ON public.area_groups
  FOR ALL
  TO authenticated
  USING (public.has_platform_admin_authority(auth.uid()))
  WITH CHECK (public.has_platform_admin_authority(auth.uid()));

DROP POLICY "Admins can manage nearby_categories" ON public.nearby_categories;
CREATE POLICY "Admins can manage nearby_categories"
  ON public.nearby_categories
  FOR ALL
  TO authenticated
  USING (public.has_platform_admin_authority(auth.uid()))
  WITH CHECK (public.has_platform_admin_authority(auth.uid()));

DROP POLICY "Admins can manage nearby_master_places" ON public.nearby_master_places;
CREATE POLICY "Admins can manage nearby_master_places"
  ON public.nearby_master_places
  FOR ALL
  TO authenticated
  USING (public.has_platform_admin_authority(auth.uid()))
  WITH CHECK (public.has_platform_admin_authority(auth.uid()));

DROP POLICY "Admins can manage shared_area_locations" ON public.shared_area_locations;
CREATE POLICY "Admins can manage shared_area_locations"
  ON public.shared_area_locations
  FOR ALL
  TO authenticated
  USING (public.has_platform_admin_authority(auth.uid()))
  WITH CHECK (public.has_platform_admin_authority(auth.uid()));

DROP POLICY "Admins can manage user_roles" ON public.user_roles;
CREATE POLICY "Admins can manage user_roles"
  ON public.user_roles
  FOR ALL
  TO authenticated
  USING (public.has_platform_admin_authority(auth.uid()))
  WITH CHECK (public.has_platform_admin_authority(auth.uid()));
