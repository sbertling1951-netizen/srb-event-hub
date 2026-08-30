-- Pre-history RLS policy + placement-integrity reconciliation -- linked proof.
--
-- Installs 20260619010000's parity block inside one outer transaction,
-- proves all 67 reconstructed policies exist with the expected command and
-- roles, proves the deny-all Group-2 tables gained nothing, exercises the
-- unique_attendee_site_per_event invariant with real inserts, then ROLLS
-- BACK. The authoritative runtime evidence is the full from-zero
-- `supabase start` replay + the Stage 6 policy-by-policy catalog
-- convergence audit against the production dump.

BEGIN;

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

CREATE FUNCTION public.rls_policy_fixture_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $fn$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'pre-history RLS policy reconciliation fixture assertion failed: %', p_message;
  END IF;
END;
$fn$;
ALTER FUNCTION public.rls_policy_fixture_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rls_policy_fixture_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;

DO $fixture$
DECLARE
  v_n integer;
  v_event uuid := 'aa000000-0000-4000-8000-0000000000f1';
  v_a1 uuid := 'aa000000-0000-4000-8000-0000000000a1';
  v_a2 uuid := 'aa000000-0000-4000-8000-0000000000a2';
  v_dup_rejected boolean := false;
  v_ci_rejected boolean := false;
  v_cross_event_ok boolean := false;
BEGIN
  -- (a) all 67 reconstructed policies exist with the expected command and roles
  SELECT count(*) INTO v_n
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND (c.relname, p.polname) IN (
      ('activities','Allow authenticated delete activities'),('activities','Allow authenticated insert activities'),
      ('activities','Allow authenticated select activities'),('activities','Allow authenticated update activities'),
      ('activities','Public insert activities'),('activities','Public read activities'),
      ('activity_registrations','Public insert activity registrations'),('activity_registrations','Public read activity registrations'),
      ('admin_event_access','Admins can view assigned events'),
      ('admin_permission_audit','Super admins manage permission audit'),
      ('admin_privilege_group_permissions','Admins can manage privilege permissions'),
      ('admin_users','Admins can read their row'),('admin_users','Admins can view themselves'),
      ('agenda_categories','Anyone can view agenda categories'),('agenda_categories','public read agenda_categories'),
      ('agenda_items','Members can view published agenda items'),
      ('announcements','Admins can delete announcements'),('announcements','Admins can insert announcements'),
      ('announcements','Admins can update announcements'),('announcements','Admins can view announcements'),
      ('announcements','Members can view published announcements'),
      ('area_groups','Anyone can read area_groups'),
      ('attendees','Members can view own attendee row'),
      ('engagement_activity','Authorized admins can view engagement activity'),
      ('event_locations','Anyone can read event_locations'),
      ('event_map_settings','Admins can insert event map settings'),('event_map_settings','Admins can update event map settings'),
      ('event_map_settings','Admins can view event map settings'),('event_map_settings','public read event_map_settings'),
      ('event_nearby_places','Anyone can read event_nearby_places'),
      ('event_vendors','Members can view visible event vendors'),
      ('master_map_locations','Anyone can read master_map_locations'),
      ('master_map_sites','Admins can delete master map sites'),('master_map_sites','Admins can insert master map sites'),
      ('master_map_sites','Admins can update master map sites'),('master_map_sites','Admins can view master map sites'),
      ('master_map_sites','public read master_map_sites'),
      ('master_maps','Admins can insert master maps'),('master_maps','Admins can update master maps'),
      ('master_maps','Admins can view master maps'),('master_maps','public read master_maps'),
      ('nearby_area_templates','Super admins manage nearby templates'),
      ('nearby_areas','Admins can insert nearby areas'),('nearby_areas','Admins can update nearby areas'),
      ('nearby_areas','public read nearby_areas'),
      ('nearby_categories','Anyone can read nearby_categories'),
      ('nearby_event','Admins can manage nearby event'),('nearby_event','Anyone can view nearby event'),
      ('nearby_event','public read nearby_event'),
      ('nearby_master_places','Anyone can read nearby_master_places'),
      ('nearby_places','Allow public delete nearby_places'),('nearby_places','Allow public insert'),
      ('nearby_places','Allow public read nearby_places'),('nearby_places','Allow public update nearby_places'),
      ('nearby_template_places','Super admins manage nearby template places'),
      ('parking_sites','Admins can delete parking sites'),('parking_sites','Admins can insert parking sites'),
      ('parking_sites','Admins can update parking sites'),('parking_sites','Admins can view parking sites'),
      ('parking_sites','Public read parking'),('parking_sites','public read parking_sites'),
      ('participant_activity_log','Authorized admins can view participant activity'),
      ('shared_area_locations','Anyone can read shared_area_locations'),
      ('test_connection','Allow anon read on test_connection'),
      ('validation_rules','public read validation_rules'),
      ('vendor_services','Admins can manage vendor services'),
      ('vendors','Members can view active vendors')
    );
  PERFORM public.rls_policy_fixture_assert(
    v_n = 67, format('all 67 reconstructed policies exist with the expected command and roles (found %s)', v_n)
  );

  -- (b) the member-facing read policies (agenda_items, announcements, attendees, vendors, master maps) are present
  --     with their exact legacy predicate and roles.
  PERFORM public.rls_policy_fixture_assert(
    (SELECT pg_get_expr(p.polqual, p.polrelid) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='agenda_items' AND p.polname='Members can view published agenda items') = '(is_published = true)'
    AND (SELECT pg_get_expr(p.polqual, p.polrelid) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='vendors' AND p.polname='Members can view active vendors') = '(is_active = true)'
    AND EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='attendees' AND p.polname='Members can view own attendee row')
    AND EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='master_maps' AND p.polname='public read master_maps'),
    'the member-facing read policies (agenda_items, announcements, attendees, vendors, master maps) are present'
  );

  -- (c) Group-2 deny-all tables gained no policy
  SELECT count(*) INTO v_n
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN
    ('admin_event_permissions','admin_permission_presets','evaluation_templates','evaluation_questions','evaluation_choices','event_photo_metadata','photo_display_log');
  PERFORM public.rls_policy_fixture_assert(v_n = 0, format('Group-2 deny-all tables gained no policy (found %s)', v_n));

  -- (d) unique_attendee_site_per_event enforces one attendee per normalized site per Event
  INSERT INTO public.events (id, name) VALUES (v_event, 'rls fixture event');
  INSERT INTO public.attendees (id, event_id, assigned_site) VALUES (v_a1, v_event, 'B-12');
  BEGIN
    INSERT INTO public.attendees (id, event_id, assigned_site) VALUES (v_a2, v_event, 'B-12');
  EXCEPTION WHEN unique_violation THEN v_dup_rejected := true;
  END;
  PERFORM public.rls_policy_fixture_assert(v_dup_rejected,
    'unique_attendee_site_per_event enforces one attendee per normalized site per Event');

  -- (e) case/whitespace-equivalent site in the same Event is rejected
  BEGIN
    INSERT INTO public.attendees (id, event_id, assigned_site) VALUES (v_a2, v_event, '  b-12 ');
  EXCEPTION WHEN unique_violation THEN v_ci_rejected := true;
  END;
  PERFORM public.rls_policy_fixture_assert(v_ci_rejected,
    'case/whitespace-equivalent site in the same Event is rejected');

  -- (f) the same site in a different Event is permitted
  INSERT INTO public.events (id, name) VALUES ('aa000000-0000-4000-8000-0000000000f2', 'rls fixture event 2');
  INSERT INTO public.attendees (id, event_id, assigned_site)
  VALUES (v_a2, 'aa000000-0000-4000-8000-0000000000f2', 'B-12');
  v_cross_event_ok := true;
  PERFORM public.rls_policy_fixture_assert(v_cross_event_ok,
    'the same site in a different Event is permitted');

  -- (g) empty/unassigned site is not constrained (partial predicate excludes it)
  INSERT INTO public.attendees (id, event_id, assigned_site) VALUES ('aa000000-0000-4000-8000-0000000000a3', v_event, NULL);
  INSERT INTO public.attendees (id, event_id, assigned_site) VALUES ('aa000000-0000-4000-8000-0000000000a4', v_event, '   ');
  PERFORM public.rls_policy_fixture_assert(true,
    'empty/unassigned sites remain unconstrained per the partial predicate');
END;
$fixture$;

ROLLBACK;

DO $post$
BEGIN
  IF to_regprocedure('public.rls_policy_fixture_assert(boolean,text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.events WHERE id = 'aa000000-0000-4000-8000-0000000000f1') THEN
    RAISE EXCEPTION 'pre-history rls policies reconciliation rollback left residue';
  END IF;
END;
$post$;
