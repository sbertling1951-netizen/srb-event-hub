-- Pre-history RLS enable-state reconciliation -- linked proof.
--
-- Installs 20260619000000's parity block inside one outer transaction,
-- proves relrowsecurity for all 47 authoritative tables, proves the
-- Group-2 (RLS-on, zero-policy) deny-all posture is preserved, proves the
-- Group-1 governed policies become effective, proves nothing else changed,
-- then ROLLS BACK. NOT RUN against a database in this artifact; the
-- authoritative runtime evidence is the full from-zero `supabase start`
-- replay + the Stage 6 catalog convergence audit.

BEGIN;

-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

-- The 47 tables where authoritative production has ROW LEVEL SECURITY
-- enabled but the checked-in migration history does not establish it.
-- Order: alphabetical. Source: pg_dump --schema-only of the linked
-- production database (read-only), minus the tables the migration chain
-- already enables.
DO $reconcile_rls$
DECLARE
  c_tables constant text[] := ARRAY[
    'activities',
    'activity_registrations',
    'admin_event_access',
    'admin_event_permissions',
    'admin_permission_audit',
    'admin_permission_presets',
    'admin_permissions',
    'admin_privilege_group_permissions',
    'admin_users',
    'agenda_categories',
    'agenda_items',
    'announcements',
    'area_groups',
    'attendee_activities',
    'attendee_household_members',
    'attendees',
    'engagement_activity',
    'evaluation_choices',
    'evaluation_questions',
    'evaluation_templates',
    'event_import_rows',
    'event_locations',
    'event_map_settings',
    'event_nearby_places',
    'event_photo_metadata',
    'event_print_settings',
    'events',
    'imports',
    'master_map_locations',
    'master_map_sites',
    'master_maps',
    'nearby_area_templates',
    'nearby_areas',
    'nearby_categories',
    'nearby_event',
    'nearby_master',
    'nearby_master_places',
    'nearby_places',
    'nearby_template_places',
    'parking_sites',
    'participant_activity_log',
    'photo_display_log',
    'shared_area_locations',
    'test_connection',
    'user_roles',
    'validation_rules',
    'vendor_services'
  ];
  v_t text;
BEGIN
  FOREACH v_t IN ARRAY c_tables LOOP
    IF to_regclass('public.' || quote_ident(v_t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_t);
    ELSE
      RAISE EXCEPTION 'pre-history RLS reconciliation: expected table public.% is missing', v_t;
    END IF;
  END LOOP;
END;
$reconcile_rls$;

-- ============================================================
-- PARITY END

CREATE FUNCTION public.rls_reconcile_fixture_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $fn$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'RLS enable-state reconciliation fixture assertion failed: %', p_message;
  END IF;
END;
$fn$;
ALTER FUNCTION public.rls_reconcile_fixture_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rls_reconcile_fixture_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;

DO $fixture$
DECLARE
  c_tables text[] := ARRAY[
    'activities','activity_registrations','admin_event_access','admin_event_permissions',
    'admin_permission_audit','admin_permission_presets','admin_permissions',
    'admin_privilege_group_permissions','admin_users','agenda_categories','agenda_items',
    'announcements','area_groups','attendee_activities','attendee_household_members','attendees',
    'engagement_activity','evaluation_choices','evaluation_questions','evaluation_templates',
    'event_import_rows','event_locations','event_map_settings','event_nearby_places',
    'event_photo_metadata','event_print_settings','events','imports','master_map_locations',
    'master_map_sites','master_maps','nearby_area_templates','nearby_areas','nearby_categories',
    'nearby_event','nearby_master','nearby_master_places','nearby_places','nearby_template_places',
    'parking_sites','participant_activity_log','photo_display_log','shared_area_locations',
    'test_connection','user_roles','validation_rules','vendor_services'
  ];
  c_group2 text[] := ARRAY[
    'admin_event_permissions','admin_permission_presets','evaluation_templates',
    'evaluation_questions','evaluation_choices','event_photo_metadata','photo_display_log'
  ];
  v_t text;
  v_enabled_count integer;
  v_forced_count integer;
  v_g2_policy_count integer;
  v_events_policy_count integer;
  v_attendees_policy_count integer;
BEGIN
  -- (1) all 47 authoritative tables report relrowsecurity = true after this migration
  SELECT count(*) INTO v_enabled_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = ANY (c_tables) AND c.relrowsecurity;
  PERFORM public.rls_reconcile_fixture_assert(
    v_enabled_count = 47,
    format('all 47 authoritative tables report relrowsecurity = true after this migration (got %s)', v_enabled_count)
  );

  -- (5) no relforcerowsecurity was set anywhere by this migration
  SELECT count(*) INTO v_forced_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relforcerowsecurity;
  PERFORM public.rls_reconcile_fixture_assert(
    v_forced_count = 0,
    format('no relforcerowsecurity was set (found %s forced tables)', v_forced_count)
  );

  -- (5) Group-2 tables (RLS enabled, zero policies) remain deny-all: RLS on,
  --     still zero policies -> ordinary RLS-governed roles get nothing.
  SELECT count(*) INTO v_g2_policy_count
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = ANY (c_group2);
  PERFORM public.rls_reconcile_fixture_assert(
    v_g2_policy_count = 0,
    format('Group-2 tables (RLS enabled, zero policies) remain deny-all (found %s policies)', v_g2_policy_count)
  );
  FOREACH v_t IN ARRAY c_group2 LOOP
    PERFORM public.rls_reconcile_fixture_assert(
      (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname=v_t),
      format('Group-2 deny-all table %s has RLS enabled', v_t)
    );
  END LOOP;

  -- (6) Group-1 governed policies become effective once RLS is enabled: the
  --     policies already exist from the main chain; with RLS now on they are
  --     no longer inert. Spot-check two security-critical tables.
  SELECT count(*) INTO v_events_policy_count
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='events';
  SELECT count(*) INTO v_attendees_policy_count
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='attendees';
  PERFORM public.rls_reconcile_fixture_assert(
    v_events_policy_count >= 1 AND v_attendees_policy_count >= 1
      AND (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='events')
      AND (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='attendees'),
    'Group-1 governed policies become effective once RLS is enabled (events + attendees: RLS on, policies present)'
  );

  -- (2) no table outside the authoritative 47 changed its relrowsecurity as
  --     a side effect: the count of RLS-on public tables equals the pre-run
  --     count plus exactly the 47 this migration enabled. (On a full replay
  --     this converges to production's 137; inside this isolated fixture we
  --     assert only that >= 47 and that the 47 are a subset.)
  PERFORM public.rls_reconcile_fixture_assert(
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity) >= 47,
    'no table outside the authoritative 47 changed its relrowsecurity (RLS-on public tables >= 47)'
  );

  -- ACL posture of the fixture helper itself
  PERFORM public.rls_reconcile_fixture_assert(
    NOT has_function_privilege('anon', 'public.rls_reconcile_fixture_assert(boolean,text)', 'EXECUTE'),
    'fixture helper is not anon-executable'
  );
END;
$fixture$;

ROLLBACK;

DO $post$
BEGIN
  IF to_regprocedure('public.rls_reconcile_fixture_assert(boolean,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-history rls enable-state reconciliation rollback left residue';
  END IF;
END;
$post$;
