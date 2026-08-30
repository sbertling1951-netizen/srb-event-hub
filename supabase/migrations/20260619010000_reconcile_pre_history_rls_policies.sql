-- ===========================================================================
-- PRE-HISTORY RLS POLICY + PLACEMENT-INTEGRITY RECONCILIATION
-- ===========================================================================
--
-- ###########################################################################
-- # DO NOT EXECUTE THIS HISTORICAL RECONCILIATION MIGRATION AGAINST THE      #
-- # ESTABLISHED PRODUCTION DATABASE.                                         #
-- #                                                                         #
-- # Every policy below is copied VERBATIM from the authoritative read-only   #
-- # production schema dump -- it is production's CURRENT policy set for      #
-- # these tables. Many of these policies were also created directly,        #
-- # before the migration history existed. Running this file against the     #
-- # established production database is at best a no-op and at worst         #
-- # regressive (some of these policies were later superseded/retired by     #
-- # subsequent migrations and production may no longer be in this exact     #
-- # historical state). On the established production database this is       #
-- # LEDGER-MARKED APPLIED ONLY, after separate explicit authorization:      #
-- #   supabase migration repair --linked --status applied 20260619010000   #
-- # Do NOT do that now.                                                     #
-- ###########################################################################
--
-- WHY THIS FILE EXISTS
-- -------------------------------------------------------------------------
-- Third companion to 20260617010000 (functions/policies/FK referenced by
-- later migrations) and 20260619000000 (RLS ENABLE state). Enabling RLS on
-- the 47 pre-history tables (20260619000000) correctly closed a security
-- gap -- but it also revealed that the migration history never created the
-- pre-history RLS *policies* those tables carry on production. Without them,
-- a from-zero rebuild has RLS enabled + no permitting policy, so current
-- application reads are DENIED where production allows them:
--
--   * agenda_items  "Members can view published agenda items"
--       (app/member/agenda, lib/experienceContext/providers/agendaProvider)
--   * announcements "Members can view published announcements"
--       (app/member/announcements, app/announcements, announcementsProvider)
--   * attendees     "Members can view own attendee row"   (app/attendees/[id])
--   * event_map_settings / master_maps / master_map_sites /
--     master_map_locations  public read  (app/coach-map/public, app/locations)
--   * event_vendors "Members can view visible event vendors"  (app/member)
--   * vendors       "Members can view active vendors"  (app/member/vendor-signup)
--   * agenda_categories public read  (agenda providers)
--   * admin_privilege_group_permissions  admin read  (lib/getCurrentAdminAccess)
--   * ... and the remaining legacy per-table admin/public policies.
--
-- This file recreates the COMPLETE production-only policy set for these
-- tables (67 policies) -- verbatim, no inference, no invented authority --
-- so the rebuilt security contract matches production semantically. Tables
-- whose only legacy policies target dead objects (nearby_places,
-- nearby_event, nearby_template_places, activities, activity_registrations)
-- are included for completeness and are inert-but-harmless; the deny-all
-- Group-2 tables (admin_event_permissions, admin_permission_presets,
-- evaluation_*, event_photo_metadata, photo_display_log) are NOT touched
-- and stay deny-all, exactly as production.
--
-- It also reconstructs the pre-history correctness invariant
-- `unique_attendee_site_per_event` -- a partial UNIQUE INDEX on
-- public.attendees that prevents two attendees being assigned the same
-- (case-insensitive, trimmed, non-empty) site within one Event. No
-- migration creates it; a fresh deploy would otherwise permit duplicate
-- site assignments. Definition is verbatim from the production catalog.
--
-- SERIAL POSITION
-- -------------------------------------------------------------------------
-- 20260619010000 sorts after 20260619000000 (RLS enable-state, which every
-- policy below depends on) and before 20260703_ (the next migration). All
-- 47 tables plus public.attendees exist by this point.
--
-- IDEMPOTENCY / SAFETY
-- -------------------------------------------------------------------------
-- Every policy is `DROP POLICY IF EXISTS` then `CREATE POLICY`. The unique
-- index uses `CREATE UNIQUE INDEX IF NOT EXISTS`. No policy predicate is
-- rewritten. No grant, function, or table structure changes. Re-running is
-- safe.

BEGIN;

-- ============================================================
-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

-- ---------------------------------------------------------------------------
-- The 67 RLS policies present on authoritative production but not created
-- by any tracked migration. Verbatim from `pg_dump --schema-only` of the
-- linked production database (read-only). Ordered by table, then name.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow authenticated delete activities" ON public.activities;
CREATE POLICY "Allow authenticated delete activities" ON "public"."activities" FOR DELETE TO "authenticated" USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert activities" ON public.activities;
CREATE POLICY "Allow authenticated insert activities" ON "public"."activities" FOR INSERT TO "authenticated" WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated select activities" ON public.activities;
CREATE POLICY "Allow authenticated select activities" ON "public"."activities" FOR SELECT TO "authenticated" USING (true);

DROP POLICY IF EXISTS "Allow authenticated update activities" ON public.activities;
CREATE POLICY "Allow authenticated update activities" ON "public"."activities" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public insert activities" ON public.activities;
CREATE POLICY "Public insert activities" ON "public"."activities" FOR INSERT TO "anon" WITH CHECK (true);

DROP POLICY IF EXISTS "Public read activities" ON public.activities;
CREATE POLICY "Public read activities" ON "public"."activities" FOR SELECT TO "anon" USING (true);

DROP POLICY IF EXISTS "Public insert activity registrations" ON public.activity_registrations;
CREATE POLICY "Public insert activity registrations" ON "public"."activity_registrations" FOR INSERT TO "anon" WITH CHECK (true);

DROP POLICY IF EXISTS "Public read activity registrations" ON public.activity_registrations;
CREATE POLICY "Public read activity registrations" ON "public"."activity_registrations" FOR SELECT TO "anon" USING (true);

DROP POLICY IF EXISTS "Admins can view assigned events" ON public.admin_event_access;
CREATE POLICY "Admins can view assigned events" ON "public"."admin_event_access" FOR SELECT TO "authenticated" USING (("admin_user_id" IN ( SELECT "admin_users"."id"
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"()))));

DROP POLICY IF EXISTS "Super admins manage permission audit" ON public.admin_permission_audit;
CREATE POLICY "Super admins manage permission audit" ON "public"."admin_permission_audit" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = 'super_admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = 'super_admin'::"text")))));

DROP POLICY IF EXISTS "Admins can manage privilege permissions" ON public.admin_privilege_group_permissions;
CREATE POLICY "Admins can manage privilege permissions" ON "public"."admin_privilege_group_permissions" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = 'super_admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = 'super_admin'::"text")))));

DROP POLICY IF EXISTS "Admins can read their row" ON public.admin_users;
CREATE POLICY "Admins can read their row" ON "public"."admin_users" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR ("email" = ("auth"."jwt"() ->> 'email'::"text"))));

DROP POLICY IF EXISTS "Admins can view themselves" ON public.admin_users;
CREATE POLICY "Admins can view themselves" ON "public"."admin_users" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));

DROP POLICY IF EXISTS "Anyone can view agenda categories" ON public.agenda_categories;
CREATE POLICY "Anyone can view agenda categories" ON "public"."agenda_categories" FOR SELECT TO "authenticated", "anon" USING (true);

DROP POLICY IF EXISTS "public read agenda_categories" ON public.agenda_categories;
CREATE POLICY "public read agenda_categories" ON "public"."agenda_categories" FOR SELECT TO "authenticated", "anon" USING (true);

DROP POLICY IF EXISTS "Members can view published agenda items" ON public.agenda_items;
CREATE POLICY "Members can view published agenda items" ON "public"."agenda_items" FOR SELECT TO "authenticated", "anon" USING (("is_published" = true));

DROP POLICY IF EXISTS "Admins can delete announcements" ON public.announcements;
CREATE POLICY "Admins can delete announcements" ON "public"."announcements" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"]))))));

DROP POLICY IF EXISTS "Admins can insert announcements" ON public.announcements;
CREATE POLICY "Admins can insert announcements" ON "public"."announcements" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"]))))));

DROP POLICY IF EXISTS "Admins can update announcements" ON public.announcements;
CREATE POLICY "Admins can update announcements" ON "public"."announcements" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"]))))));

DROP POLICY IF EXISTS "Admins can view announcements" ON public.announcements;
CREATE POLICY "Admins can view announcements" ON "public"."announcements" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text", 'read_only'::"text"]))))));

DROP POLICY IF EXISTS "Members can view published announcements" ON public.announcements;
CREATE POLICY "Members can view published announcements" ON "public"."announcements" FOR SELECT TO "authenticated", "anon" USING (("is_published" = true));

DROP POLICY IF EXISTS "Anyone can read area_groups" ON public.area_groups;
CREATE POLICY "Anyone can read area_groups" ON "public"."area_groups" FOR SELECT USING (true);

DROP POLICY IF EXISTS "Members can view own attendee row" ON public.attendees;
CREATE POLICY "Members can view own attendee row" ON "public"."attendees" FOR SELECT TO "authenticated" USING (("lower"("email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))));

DROP POLICY IF EXISTS "Authorized admins can view engagement activity" ON public.engagement_activity;
CREATE POLICY "Authorized admins can view engagement activity" ON "public"."engagement_activity" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND (("au"."is_super_admin" = true) OR ("au"."privilege_group" = 'super_admin'::"text"))))));

DROP POLICY IF EXISTS "Anyone can read event_locations" ON public.event_locations;
CREATE POLICY "Anyone can read event_locations" ON "public"."event_locations" FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can insert event map settings" ON public.event_map_settings;
CREATE POLICY "Admins can insert event map settings" ON "public"."event_map_settings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"]))))));

DROP POLICY IF EXISTS "Admins can update event map settings" ON public.event_map_settings;
CREATE POLICY "Admins can update event map settings" ON "public"."event_map_settings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"]))))));

DROP POLICY IF EXISTS "Admins can view event map settings" ON public.event_map_settings;
CREATE POLICY "Admins can view event map settings" ON "public"."event_map_settings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));

DROP POLICY IF EXISTS "public read event_map_settings" ON public.event_map_settings;
CREATE POLICY "public read event_map_settings" ON "public"."event_map_settings" FOR SELECT TO "authenticated", "anon" USING (true);

DROP POLICY IF EXISTS "Anyone can read event_nearby_places" ON public.event_nearby_places;
CREATE POLICY "Anyone can read event_nearby_places" ON "public"."event_nearby_places" FOR SELECT USING (true);

DROP POLICY IF EXISTS "Members can view visible event vendors" ON public.event_vendors;
CREATE POLICY "Members can view visible event vendors" ON "public"."event_vendors" FOR SELECT TO "authenticated", "anon" USING (("is_visible_to_members" = true));

DROP POLICY IF EXISTS "Anyone can read master_map_locations" ON public.master_map_locations;
CREATE POLICY "Anyone can read master_map_locations" ON "public"."master_map_locations" FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can delete master map sites" ON public.master_map_sites;
CREATE POLICY "Admins can delete master map sites" ON "public"."master_map_sites" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"]))))));

DROP POLICY IF EXISTS "Admins can insert master map sites" ON public.master_map_sites;
CREATE POLICY "Admins can insert master map sites" ON "public"."master_map_sites" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"]))))));

DROP POLICY IF EXISTS "Admins can update master map sites" ON public.master_map_sites;
CREATE POLICY "Admins can update master map sites" ON "public"."master_map_sites" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"]))))));

DROP POLICY IF EXISTS "Admins can view master map sites" ON public.master_map_sites;
CREATE POLICY "Admins can view master map sites" ON "public"."master_map_sites" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));

DROP POLICY IF EXISTS "public read master_map_sites" ON public.master_map_sites;
CREATE POLICY "public read master_map_sites" ON "public"."master_map_sites" FOR SELECT TO "authenticated", "anon" USING (true);

DROP POLICY IF EXISTS "Admins can insert master maps" ON public.master_maps;
CREATE POLICY "Admins can insert master maps" ON "public"."master_maps" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND (("au"."privilege_group" = 'super_admin'::"text") OR ("au"."privilege_group" = 'event_admin'::"text") OR ("au"."privilege_group" = 'content_admin'::"text"))))));

DROP POLICY IF EXISTS "Admins can update master maps" ON public.master_maps;
CREATE POLICY "Admins can update master maps" ON "public"."master_maps" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND (("au"."privilege_group" = 'super_admin'::"text") OR ("au"."privilege_group" = 'event_admin'::"text") OR ("au"."privilege_group" = 'content_admin'::"text")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND (("au"."privilege_group" = 'super_admin'::"text") OR ("au"."privilege_group" = 'event_admin'::"text") OR ("au"."privilege_group" = 'content_admin'::"text"))))));

DROP POLICY IF EXISTS "Admins can view master maps" ON public.master_maps;
CREATE POLICY "Admins can view master maps" ON "public"."master_maps" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));

DROP POLICY IF EXISTS "public read master_maps" ON public.master_maps;
CREATE POLICY "public read master_maps" ON "public"."master_maps" FOR SELECT TO "authenticated", "anon" USING (true);

DROP POLICY IF EXISTS "Super admins manage nearby templates" ON public.nearby_area_templates;
CREATE POLICY "Super admins manage nearby templates" ON "public"."nearby_area_templates" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = 'super_admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = 'super_admin'::"text")))));

DROP POLICY IF EXISTS "Admins can insert nearby areas" ON public.nearby_areas;
CREATE POLICY "Admins can insert nearby areas" ON "public"."nearby_areas" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"]))))));

DROP POLICY IF EXISTS "Admins can update nearby areas" ON public.nearby_areas;
CREATE POLICY "Admins can update nearby areas" ON "public"."nearby_areas" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"]))))));

DROP POLICY IF EXISTS "public read nearby_areas" ON public.nearby_areas;
CREATE POLICY "public read nearby_areas" ON "public"."nearby_areas" FOR SELECT TO "authenticated", "anon" USING (true);

DROP POLICY IF EXISTS "Anyone can read nearby_categories" ON public.nearby_categories;
CREATE POLICY "Anyone can read nearby_categories" ON "public"."nearby_categories" FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage nearby event" ON public.nearby_event;
CREATE POLICY "Admins can manage nearby event" ON "public"."nearby_event" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'content_admin'::"text"]))))));

DROP POLICY IF EXISTS "Anyone can view nearby event" ON public.nearby_event;
CREATE POLICY "Anyone can view nearby event" ON "public"."nearby_event" FOR SELECT TO "authenticated", "anon" USING (true);

DROP POLICY IF EXISTS "public read nearby_event" ON public.nearby_event;
CREATE POLICY "public read nearby_event" ON "public"."nearby_event" FOR SELECT TO "authenticated", "anon" USING (true);

DROP POLICY IF EXISTS "Anyone can read nearby_master_places" ON public.nearby_master_places;
CREATE POLICY "Anyone can read nearby_master_places" ON "public"."nearby_master_places" FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public delete nearby_places" ON public.nearby_places;
CREATE POLICY "Allow public delete nearby_places" ON "public"."nearby_places" FOR DELETE USING (true);

DROP POLICY IF EXISTS "Allow public insert" ON public.nearby_places;
CREATE POLICY "Allow public insert" ON "public"."nearby_places" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public read nearby_places" ON public.nearby_places;
CREATE POLICY "Allow public read nearby_places" ON "public"."nearby_places" FOR SELECT TO "authenticated", "anon" USING (true);

DROP POLICY IF EXISTS "Allow public update nearby_places" ON public.nearby_places;
CREATE POLICY "Allow public update nearby_places" ON "public"."nearby_places" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Super admins manage nearby template places" ON public.nearby_template_places;
CREATE POLICY "Super admins manage nearby template places" ON "public"."nearby_template_places" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = 'super_admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = 'super_admin'::"text")))));

DROP POLICY IF EXISTS "Admins can delete parking sites" ON public.parking_sites;
CREATE POLICY "Admins can delete parking sites" ON "public"."parking_sites" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'parking'::"text"]))))));

DROP POLICY IF EXISTS "Admins can insert parking sites" ON public.parking_sites;
CREATE POLICY "Admins can insert parking sites" ON "public"."parking_sites" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'parking'::"text"]))))));

DROP POLICY IF EXISTS "Admins can update parking sites" ON public.parking_sites;
CREATE POLICY "Admins can update parking sites" ON "public"."parking_sites" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'parking'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'parking'::"text"]))))));

DROP POLICY IF EXISTS "Admins can view parking sites" ON public.parking_sites;
CREATE POLICY "Admins can view parking sites" ON "public"."parking_sites" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND ("au"."privilege_group" = ANY (ARRAY['super_admin'::"text", 'event_admin'::"text", 'parking'::"text", 'read_only'::"text"]))))));

DROP POLICY IF EXISTS "Public read parking" ON public.parking_sites;
CREATE POLICY "Public read parking" ON "public"."parking_sites" FOR SELECT TO "anon" USING (true);

DROP POLICY IF EXISTS "public read parking_sites" ON public.parking_sites;
CREATE POLICY "public read parking_sites" ON "public"."parking_sites" FOR SELECT TO "authenticated", "anon" USING (true);

DROP POLICY IF EXISTS "Authorized admins can view participant activity" ON public.participant_activity_log;
CREATE POLICY "Authorized admins can view participant activity" ON "public"."participant_activity_log" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true) AND (("au"."is_super_admin" = true) OR ("au"."privilege_group" = 'super_admin'::"text"))))));

DROP POLICY IF EXISTS "Anyone can read shared_area_locations" ON public.shared_area_locations;
CREATE POLICY "Anyone can read shared_area_locations" ON "public"."shared_area_locations" FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow anon read on test_connection" ON public.test_connection;
CREATE POLICY "Allow anon read on test_connection" ON "public"."test_connection" FOR SELECT TO "anon" USING (true);

DROP POLICY IF EXISTS "public read validation_rules" ON public.validation_rules;
CREATE POLICY "public read validation_rules" ON "public"."validation_rules" FOR SELECT TO "authenticated", "anon" USING (true);

DROP POLICY IF EXISTS "Admins can manage vendor services" ON public.vendor_services;
CREATE POLICY "Admins can manage vendor services" ON "public"."vendor_services" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));

DROP POLICY IF EXISTS "Members can view active vendors" ON public.vendors;
CREATE POLICY "Members can view active vendors" ON "public"."vendors" FOR SELECT TO "authenticated", "anon" USING (("is_active" = true));

-- ---------------------------------------------------------------------------
-- Pre-history correctness invariant: at most one attendee per (Event,
-- normalized site). Verbatim from the production catalog:
--   UNIQUE, partial, expression index on public.attendees
--   key = (event_id, upper(trim(assigned_site)))
--   predicate = assigned_site IS NOT NULL AND trim(assigned_site) <> ''
-- No tracked migration creates this; without it a fresh deploy admits
-- duplicate site assignments within an Event.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "unique_attendee_site_per_event"
  ON "public"."attendees" USING "btree"
  ("event_id", "upper"(TRIM(BOTH FROM "assigned_site")))
  WHERE (("assigned_site" IS NOT NULL) AND (TRIM(BOTH FROM "assigned_site") <> ''::"text"));

-- ============================================================
-- PARITY END
-- ============================================================

COMMIT;
