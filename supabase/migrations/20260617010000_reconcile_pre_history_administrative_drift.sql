-- ===========================================================================
-- PRE-HISTORY ADMINISTRATIVE DRIFT RECONCILIATION
-- ===========================================================================
--
-- ###########################################################################
-- # DO NOT EXECUTE THIS HISTORICAL RECONCILIATION MIGRATION AGAINST THE      #
-- # ESTABLISHED PRODUCTION DATABASE.                                         #
-- #                                                                         #
-- # Production already contains (or has since superseded) every object this #
-- # file recreates. Executing it against production would REGRESS live RLS  #
-- # by re-installing the legacy pre-history policies below.                 #
-- #                                                                         #
-- # On the established production database this migration is intended to be #
-- # LEDGER-MARKED APPLIED ONLY, after separate explicit authorization:      #
-- #   supabase migration repair --linked --status applied 20260617010000   #
-- # (a metadata-only ledger operation -- runs no SQL). Do NOT do that now.  #
-- ###########################################################################
--
-- WHY THIS FILE EXISTS
-- -------------------------------------------------------------------------
-- The checked-in migration history was reverse-engineered from a
-- pre-existing production database and was never runnable from an empty
-- database. `supabase db reset` applies migrations 20260617000000 ..
-- 20260811130000 cleanly, then FAILS at
-- 20260811140000_repair_legacy_administrative_function_acl.sql
-- (`REVOKE ALL ON FUNCTION public.is_current_admin() FROM PUBLIC`,
-- SQLSTATE 42883) because a body of pre-history schema -- created directly
-- on production before the migration history existed -- was never captured
-- in any migration. Migrations from 20260811140000 onward `REVOKE` / `DROP`
-- / guard-check that pre-history schema and therefore cannot replay.
--
-- This is the reconciliation layer identified in
-- supabase/identity-audits/baseline-diagnostics/ (the "Missing baseline
-- objects" set). It recreates ONLY the pre-history objects that a LATER
-- migration in the chain actually references in a DROP / REVOKE / guard
-- context -- i.e. only the objects that actually block a from-zero replay.
-- It deliberately does NOT recreate the ~120 other legacy RLS policies, the
-- 8 legacy `trg_*_updated_at` triggers, the 4 other legacy `events_*_fkey`
-- foreign keys, or the 7 other missing baseline functions, because no
-- migration touches those and a fresh database does not need them to reach
-- the current canonical architecture.
--
-- SERIAL POSITION
-- -------------------------------------------------------------------------
-- 20260617010000 sorts strictly AFTER
-- 20260617000000_create_pre_20260618_public_baseline.sql and strictly
-- BEFORE 20260618_add_evaluations.sql, ~194 migrations ahead of the first
-- replay failure. A migration placed after the failure could never fix a
-- from-zero replay, so this exceptional early insertion is required. No
-- existing migration is renumbered or edited.
--
-- WHAT REPLAY DOES WITH THIS STATE
-- -------------------------------------------------------------------------
-- Every object below is TRANSITIONAL. Later migrations, running in the same
-- fresh replay, retire all of it:
--   * is_current_admin() / is_super_admin() RLS consumers -> migrated to
--     has_platform_admin_authority / scoped task authority
--     (20260811150000, 20260811160000, 20260811230000-260000, 20260823080000).
--   * "Admins can manage event_staff" -> table dropped (20260811210000).
--   * agenda_templates family + events_assigned_agenda_template_id_fkey ->
--     dropped (20260811370000).
--   * legacy storage.objects event-photo policies -> governed
--     event_photos_object_* policies (20260811390000).
-- After a full replay the rebuilt schema matches today's canonical
-- production architecture; none of the objects below survive.
--
-- FIDELITY
-- -------------------------------------------------------------------------
-- Section A functions are reproduced VERBATIM from the authoritative
-- read-only production schema dump (pg_dump --schema-only), including their
-- legacy security attributes. Later migrations own later architectural
-- changes; this file does not "improve" them.
--
-- Every policy in Sections B/C/D is created only so a later unguarded
-- `DROP POLICY` (or, for event_staff, a later fail-closed guard) has a
-- target. The command / roles / predicate of each policy in Section B is
-- immaterial to the end state because the SAME later migration drops it
-- immediately -- except the event_staff policy in Section C, whose exact
-- predicate is load-bearing (20260811210000 raises unless
-- pg_get_expr(polqual)=pg_get_expr(polwithcheck)='is_current_admin()').
-- Predicates are reconstructed from each retiring migration's own header /
-- replacement policy and NEVER broaden authority beyond the legacy state
-- those migrations describe.
--
-- IDEMPOTENCY / PRODUCTION-SAFETY
-- -------------------------------------------------------------------------
-- Functions use CREATE OR REPLACE. Every policy is `DROP POLICY IF EXISTS`
-- then `CREATE POLICY`. The FK is added inside an existence-guarded DO
-- block. Re-running this file is safe. It never assumes it is being run
-- against production.

BEGIN;

-- ============================================================
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
-- ============================================================

COMMIT;
