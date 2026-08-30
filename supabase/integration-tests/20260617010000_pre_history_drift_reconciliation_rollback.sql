-- Pre-history administrative drift reconciliation -- linked proof.
--
-- Installs 20260617010000's parity block inside one outer transaction,
-- proves the three pre-history functions exist with their authoritative
-- production attributes, proves the load-bearing event_staff policy
-- predicate, proves the events FK is present, proves re-running the block
-- is idempotent, then ROLLS BACK. NOT RUN against a database in this
-- artifact; the authoritative runtime evidence is the full from-zero
-- `supabase start` replay (empty DB -> 20260811140000 and beyond).

BEGIN;

-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

-- ---------------------------------------------------------------------------
-- SECTION A -- pre-history administrative functions (verbatim from the
-- authoritative production schema dump). Blocking references:
--   is_current_admin()            -> 20260811140000 REVOKE/GRANT,
--                                    20260811210000 guard predicate
--   is_super_admin(uuid)          -> 20260811140000 REVOKE/GRANT
--   copy_master_map_to_event(...) -> 20260814020000 REVOKE EXECUTE
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_current_admin() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
      and au.is_active = true
  );
$$;
ALTER FUNCTION public.is_current_admin() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.is_super_admin("uid" uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM admin_users
    WHERE user_id = uid
    AND privilege_group = 'super_admin'
    AND is_active = true
  );
$$;
ALTER FUNCTION public.is_super_admin(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.copy_master_map_to_event("master_id" uuid, "event_id" uuid) RETURNS void
    LANGUAGE sql
    AS $$
insert into parking_sites (
  event_id,
  site_number,
  display_label,
  map_x,
  map_y,
  assigned_attendee_id
)
select
  event_id,
  site_number,
  display_label,
  map_x,
  map_y,
  null
from master_map_sites
where master_map_id = master_id;
$$;
ALTER FUNCTION public.copy_master_map_to_event(uuid, uuid) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- SECTION B -- pre-history public.* RLS policies. Each is DROPPED (without
-- IF EXISTS) or DROPPED-then-recreated by the migration named beside it.
-- The command/roles/predicate below are transitional-only: the SAME
-- migration removes the policy during replay. Predicates mirror the legacy
-- authority each retiring migration documents (is_current_admin() /
-- is_super_admin() / USING(true)); none broadens authority.
-- ---------------------------------------------------------------------------

-- Cohort A -- is_super_admin(uuid) consumers, retired by 20260811150000.
DROP POLICY IF EXISTS "Admins can view their event access" ON public.admin_event_access;
CREATE POLICY "Admins can view their event access" ON public.admin_event_access
  FOR SELECT TO authenticated
  USING (
    (admin_user_id IN (SELECT au.id FROM public.admin_users au WHERE au.user_id = auth.uid()))
    OR public.is_super_admin(auth.uid())
  );
DROP POLICY IF EXISTS "Super admins can assign event access" ON public.admin_event_access;
CREATE POLICY "Super admins can assign event access" ON public.admin_event_access
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "Super admins can remove event access" ON public.admin_event_access;
CREATE POLICY "Super admins can remove event access" ON public.admin_event_access
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "Super admins can update event access" ON public.admin_event_access;
CREATE POLICY "Super admins can update event access" ON public.admin_event_access
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can view admins" ON public.admin_users;
CREATE POLICY "Admins can view admins" ON public.admin_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

-- Cohort B1 -- is_current_admin() Platform consumers, retired by 20260811160000.
DROP POLICY IF EXISTS "Admins can manage admin_permissions" ON public.admin_permissions;
CREATE POLICY "Admins can manage admin_permissions" ON public.admin_permissions
  FOR ALL USING (public.is_current_admin()) WITH CHECK (public.is_current_admin());
DROP POLICY IF EXISTS "Admins can manage area_groups" ON public.area_groups;
CREATE POLICY "Admins can manage area_groups" ON public.area_groups
  FOR ALL USING (public.is_current_admin()) WITH CHECK (public.is_current_admin());
DROP POLICY IF EXISTS "Admins can manage nearby_categories" ON public.nearby_categories;
CREATE POLICY "Admins can manage nearby_categories" ON public.nearby_categories
  FOR ALL USING (public.is_current_admin()) WITH CHECK (public.is_current_admin());
DROP POLICY IF EXISTS "Admins can manage nearby_master_places" ON public.nearby_master_places;
CREATE POLICY "Admins can manage nearby_master_places" ON public.nearby_master_places
  FOR ALL USING (public.is_current_admin()) WITH CHECK (public.is_current_admin());
DROP POLICY IF EXISTS "Admins can manage shared_area_locations" ON public.shared_area_locations;
CREATE POLICY "Admins can manage shared_area_locations" ON public.shared_area_locations
  FOR ALL USING (public.is_current_admin()) WITH CHECK (public.is_current_admin());
DROP POLICY IF EXISTS "Admins can manage user_roles" ON public.user_roles;
CREATE POLICY "Admins can manage user_roles" ON public.user_roles
  FOR ALL USING (public.is_current_admin()) WITH CHECK (public.is_current_admin());

-- Event operational tables -- retired by the 20260811230000-260000 cutovers.
DROP POLICY IF EXISTS "Admins can manage event_locations" ON public.event_locations;
CREATE POLICY "Admins can manage event_locations" ON public.event_locations
  FOR ALL USING (public.is_current_admin()) WITH CHECK (public.is_current_admin());
DROP POLICY IF EXISTS "Admins can manage event_nearby_places" ON public.event_nearby_places;
CREATE POLICY "Admins can manage event_nearby_places" ON public.event_nearby_places
  FOR ALL USING (public.is_current_admin()) WITH CHECK (public.is_current_admin());
DROP POLICY IF EXISTS "Admins can manage event_print_settings" ON public.event_print_settings;
CREATE POLICY "Admins can manage event_print_settings" ON public.event_print_settings
  FOR ALL USING (public.is_current_admin()) WITH CHECK (public.is_current_admin());
DROP POLICY IF EXISTS "Public insert imports" ON public.imports;
CREATE POLICY "Public insert imports" ON public.imports
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Admins can manage imports" ON public.imports;
CREATE POLICY "Admins can manage imports" ON public.imports
  FOR ALL USING (public.is_current_admin()) WITH CHECK (public.is_current_admin());
DROP POLICY IF EXISTS "Admins can manage event_import_rows" ON public.event_import_rows;
CREATE POLICY "Admins can manage event_import_rows" ON public.event_import_rows
  FOR ALL USING (public.is_current_admin()) WITH CHECK (public.is_current_admin());
DROP POLICY IF EXISTS "Admins can manage master_map_locations" ON public.master_map_locations;
CREATE POLICY "Admins can manage master_map_locations" ON public.master_map_locations
  FOR ALL USING (public.is_current_admin()) WITH CHECK (public.is_current_admin());

-- agenda_items -- retired by 20260811330000 (publication-bypass close).
DROP POLICY IF EXISTS "public read agenda_items" ON public.agenda_items;
CREATE POLICY "public read agenda_items" ON public.agenda_items
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins can insert agenda items" ON public.agenda_items;
CREATE POLICY "Admins can insert agenda items" ON public.agenda_items
  FOR INSERT WITH CHECK (public.is_current_admin());
DROP POLICY IF EXISTS "Admins can update agenda items" ON public.agenda_items;
CREATE POLICY "Admins can update agenda items" ON public.agenda_items
  FOR UPDATE USING (public.is_current_admin());
DROP POLICY IF EXISTS "Admins can delete agenda items" ON public.agenda_items;
CREATE POLICY "Admins can delete agenda items" ON public.agenda_items
  FOR DELETE USING (public.is_current_admin());
DROP POLICY IF EXISTS "SA or event admins can update agenda items" ON public.agenda_items;
CREATE POLICY "SA or event admins can update agenda items" ON public.agenda_items
  FOR UPDATE USING (public.is_current_admin());
DROP POLICY IF EXISTS "SA or event admins can delete agenda items" ON public.agenda_items;
CREATE POLICY "SA or event admins can delete agenda items" ON public.agenda_items
  FOR DELETE USING (public.is_current_admin());

-- agenda_categories -- retired by 20260811380000 (governed vocabulary ops).
DROP POLICY IF EXISTS "Admins can insert agenda categories" ON public.agenda_categories;
CREATE POLICY "Admins can insert agenda categories" ON public.agenda_categories
  FOR INSERT WITH CHECK (public.is_current_admin());
DROP POLICY IF EXISTS "Admins can update agenda categories" ON public.agenda_categories;
CREATE POLICY "Admins can update agenda categories" ON public.agenda_categories
  FOR UPDATE USING (public.is_current_admin());
DROP POLICY IF EXISTS "Admins can delete agenda categories" ON public.agenda_categories;
CREATE POLICY "Admins can delete agenda categories" ON public.agenda_categories
  FOR DELETE USING (public.is_current_admin());

-- nearby_master -- retired by 20260823080000 Part B. Predicates copied from
-- that migration's own "EXACT PRE-CHANGE STATE" header.
DROP POLICY IF EXISTS "Admins can manage nearby master" ON public.nearby_master;
CREATE POLICY "Admins can manage nearby master" ON public.nearby_master
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND au.is_active = true
      AND au.privilege_group IN ('super_admin', 'event_admin', 'content_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND au.is_active = true
      AND au.privilege_group IN ('super_admin', 'event_admin', 'content_admin')
  ));
DROP POLICY IF EXISTS "Anyone can view nearby master" ON public.nearby_master;
CREATE POLICY "Anyone can view nearby master" ON public.nearby_master
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public read nearby_master" ON public.nearby_master;
CREATE POLICY "public read nearby_master" ON public.nearby_master
  FOR SELECT TO anon, authenticated USING (true);

-- ---------------------------------------------------------------------------
-- SECTION C -- the ONE load-bearing pre-history policy. 20260811210000
-- raises a fail-closed exception unless a policy named exactly
-- "Admins can manage event_staff" exists on public.event_staff with
-- pg_get_expr(polqual) = pg_get_expr(polwithcheck) = 'is_current_admin()'.
-- public.event_staff itself IS created by the baseline; only this policy is
-- missing. TO PUBLIC (no role list) so polroles = {0}, matching the legacy
-- state. 20260811210000 then DROP TABLEs public.event_staff.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage event_staff" ON public.event_staff;
CREATE POLICY "Admins can manage event_staff" ON public.event_staff
  FOR ALL
  USING (is_current_admin())
  WITH CHECK (is_current_admin());

-- ---------------------------------------------------------------------------
-- SECTION D -- pre-history storage.objects event-photo policies, retired by
-- 20260811390000 (governed event_photos_object_* policies). Names are taken
-- from that migration's own DROP statements. Predicates are transitional
-- (immediately dropped); bucket-scoped, matching the legacy event-photos
-- upload/view/delete intent, no broader. Wrapped so a permissions quirk on
-- storage.objects surfaces as a clear error rather than a silent gap.
-- ---------------------------------------------------------------------------
DO $reconcile_storage$
BEGIN
  DROP POLICY IF EXISTS "Anonymous upload event photos" ON storage.objects;
  CREATE POLICY "Anonymous upload event photos" ON storage.objects
    FOR INSERT TO anon WITH CHECK (bucket_id = 'event-photos');

  DROP POLICY IF EXISTS "Authenticated users can upload event photos" ON storage.objects;
  CREATE POLICY "Authenticated users can upload event photos" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'event-photos');

  DROP POLICY IF EXISTS "Anonymous delete event photos 1rdror8_0" ON storage.objects;
  CREATE POLICY "Anonymous delete event photos 1rdror8_0" ON storage.objects
    FOR DELETE TO anon USING (bucket_id = 'event-photos');

  DROP POLICY IF EXISTS "Anonymous delete event photos 1rdror8_1" ON storage.objects;
  CREATE POLICY "Anonymous delete event photos 1rdror8_1" ON storage.objects
    FOR DELETE TO anon USING (bucket_id = 'event-photos');

  DROP POLICY IF EXISTS "Anonymous view event photos 1rdror8_0" ON storage.objects;
  CREATE POLICY "Anonymous view event photos 1rdror8_0" ON storage.objects
    FOR SELECT TO anon USING (bucket_id = 'event-photos');

  DROP POLICY IF EXISTS "Authenticated users can view their event photos" ON storage.objects;
  CREATE POLICY "Authenticated users can view their event photos" ON storage.objects
    FOR SELECT TO authenticated USING (bucket_id = 'event-photos');
END;
$reconcile_storage$;

-- ---------------------------------------------------------------------------
-- SECTION E -- pre-history foreign key events_assigned_agenda_template_id_fkey.
-- 20260811370000 does `ALTER TABLE public.events DROP CONSTRAINT
-- events_assigned_agenda_template_id_fkey` (no IF EXISTS). Both
-- public.events.assigned_agenda_template_id and public.agenda_templates are
-- created by the baseline; only the FK between them is pre-history drift.
-- The delete action is immaterial (the FK, agenda_templates, and the column
-- are all retired by 20260811370000); NO ACTION (the default) is used.
-- Existence-guarded so this is safe if the FK is somehow already present.
-- ---------------------------------------------------------------------------
DO $reconcile_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_assigned_agenda_template_id_fkey'
      AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_assigned_agenda_template_id_fkey
      FOREIGN KEY (assigned_agenda_template_id)
      REFERENCES public.agenda_templates (id);
  END IF;
END;
$reconcile_fk$;

-- ============================================================
-- PARITY END

CREATE FUNCTION public.drift_reconcile_fixture_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $fn$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'pre-history drift reconciliation fixture assertion failed: %', p_message;
  END IF;
END;
$fn$;
ALTER FUNCTION public.drift_reconcile_fixture_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.drift_reconcile_fixture_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;

DO $fixture$
DECLARE
  v_def text;
  v_polqual text;
  v_polwithcheck text;
BEGIN
  -- public.is_current_admin() exists with SECURITY DEFINER and search_path public
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_current_admin' AND p.pronargs = 0;
  PERFORM public.drift_reconcile_fixture_assert(
    v_def IS NOT NULL
      AND v_def LIKE '%SECURITY DEFINER%'
      AND v_def LIKE '%SET search_path TO ''public''%'
      AND v_def LIKE '%LANGUAGE sql%'
      AND v_def LIKE '%from public.admin_users au%'
      AND v_def LIKE '%au.user_id = auth.uid()%',
    'public.is_current_admin() exists with SECURITY DEFINER and search_path public'
  );

  -- public.is_super_admin(uuid) exists (SECURITY DEFINER, legacy unpinned search_path)
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_super_admin'
    AND pg_get_function_identity_arguments(p.oid) = 'uid uuid';
  PERFORM public.drift_reconcile_fixture_assert(
    v_def IS NOT NULL
      AND v_def LIKE '%SECURITY DEFINER%'
      AND v_def NOT LIKE '%SET search_path%'
      AND v_def LIKE '%privilege_group = ''super_admin''%',
    'public.is_super_admin(uuid) exists'
  );

  -- public.copy_master_map_to_event(uuid,uuid) exists (SECURITY INVOKER)
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'copy_master_map_to_event'
    AND pg_get_function_identity_arguments(p.oid) = 'master_id uuid, event_id uuid';
  PERFORM public.drift_reconcile_fixture_assert(
    v_def IS NOT NULL
      AND v_def NOT LIKE '%SECURITY DEFINER%'
      AND v_def LIKE '%from master_map_sites%'
      AND v_def LIKE '%where master_map_id = master_id%',
    'public.copy_master_map_to_event(uuid,uuid) exists'
  );

  -- event_staff policy predicate is exactly is_current_admin()
  SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
  INTO v_polqual, v_polwithcheck
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'event_staff' AND p.polname = 'Admins can manage event_staff';
  PERFORM public.drift_reconcile_fixture_assert(
    v_polqual = 'is_current_admin()' AND v_polwithcheck = 'is_current_admin()',
    'event_staff policy predicate is exactly is_current_admin()'
  );

  -- events_assigned_agenda_template_id_fkey is present for 20260811370000 to drop
  PERFORM public.drift_reconcile_fixture_assert(
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'events_assigned_agenda_template_id_fkey'
        AND conrelid = 'public.events'::regclass AND contype = 'f'
    ),
    'events_assigned_agenda_template_id_fkey is present for 20260811370000 to drop'
  );

  -- 20260811140000 REVOKE/GRANT statements now resolve: exercising the exact
  -- ACL statements from that migration must not raise undefined_function.
  REVOKE ALL ON FUNCTION public.is_current_admin() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.is_current_admin() TO authenticated;
  REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;
  REVOKE EXECUTE ON FUNCTION public.copy_master_map_to_event(uuid, uuid) FROM PUBLIC, anon;
  PERFORM public.drift_reconcile_fixture_assert(
    true, '20260811140000 REVOKE/GRANT statements now resolve'
  );

  -- 20260811210000 fail-closed guard is satisfied: the exact EXISTS check
  -- from that migration returns true.
  PERFORM public.drift_reconcile_fixture_assert(
    EXISTS (
      SELECT 1 FROM pg_policy AS p
      WHERE p.polrelid = 'public.event_staff'::regclass
        AND p.polname = 'Admins can manage event_staff'
        AND pg_get_expr(p.polqual, p.polrelid) = 'is_current_admin()'
        AND pg_get_expr(p.polwithcheck, p.polrelid) = 'is_current_admin()'
    ),
    '20260811210000 fail-closed guard is satisfied'
  );

  -- reconciliation is idempotent on re-run: re-issuing a representative
  -- subset of the parity block must not error.
  CREATE OR REPLACE FUNCTION public.is_current_admin() RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
      AS $$ select exists (select 1 from public.admin_users au where au.user_id = auth.uid() and au.is_active = true); $$;
  DROP POLICY IF EXISTS "Admins can manage event_staff" ON public.event_staff;
  CREATE POLICY "Admins can manage event_staff" ON public.event_staff
    FOR ALL USING (is_current_admin()) WITH CHECK (is_current_admin());
  PERFORM public.drift_reconcile_fixture_assert(true, 'reconciliation is idempotent on re-run');
END;
$fixture$;

ROLLBACK;

DO $post$
BEGIN
  IF to_regprocedure('public.drift_reconcile_fixture_assert(boolean,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-history drift reconciliation rollback left residue';
  END IF;
END;
$post$;
