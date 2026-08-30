-- ===========================================================================
-- PRE-HISTORY RLS ENABLE-STATE RECONCILIATION
-- ===========================================================================
--
-- ###########################################################################
-- # DO NOT EXECUTE THIS HISTORICAL RECONCILIATION MIGRATION AGAINST THE      #
-- # ESTABLISHED PRODUCTION DATABASE.                                         #
-- #                                                                         #
-- # Production already has ROW LEVEL SECURITY enabled on every table listed  #
-- # below (verified from the authoritative read-only schema dump). Running   #
-- # this file there is a no-op, but the correct action on the established    #
-- # production database is LEDGER-MARKED APPLIED ONLY, after separate        #
-- # explicit authorization:                                                  #
-- #   supabase migration repair --linked --status applied 20260619000000    #
-- # Do NOT do that now.                                                      #
-- ###########################################################################
--
-- WHY THIS FILE EXISTS
-- -------------------------------------------------------------------------
-- Companion to 20260617010000_reconcile_pre_history_administrative_drift.
-- The checked-in migration history creates governed RLS *policies* on many
-- tables (task-authority cutovers, platform-authority cutovers, member
-- boundary RPCs, etc.) but NEVER issues `ALTER TABLE ... ENABLE ROW LEVEL
-- SECURITY` for a large set of core application tables. On production RLS
-- was enabled on those tables directly, before the migration history
-- existed -- the same pre-history drift class as the missing
-- is_current_admin() function.
--
-- Consequence on a from-zero rebuild WITHOUT this file: 47 tables end up
-- with RLS DISABLED. Their governed policies (on attendees,
-- attendee_household_members, admin_users, admin_event_access,
-- admin_permissions, events, event_locations, event_nearby_places,
-- event_print_settings, event_import_rows, imports, master_map_locations,
-- agenda_items, nearby_master, nearby_categories, area_groups,
-- shared_area_locations, user_roles, nearby_master_places, and more) are
-- INERT, and every "RLS enabled + zero policies -> deny-all" table
-- (admin_event_permissions, admin_permission_presets, evaluation_templates
-- / _questions / _choices, event_photo_metadata, photo_display_log) is
-- wide open instead. That is a security regression for any fresh
-- deployment. RLS enable-state is security architecture; a policy without
-- its table-level RLS state is not semantically equivalent to production.
--
-- Semantic (not byte) convergence is the objective. This file reconciles
-- ONLY the ENABLE state:
--   * it does NOT touch FORCE ROW LEVEL SECURITY (production has zero
--     forced tables);
--   * it does NOT create, drop, or alter any policy;
--   * it does NOT add permissive policies to the deny-all tables -- those
--     stay deny-all, exactly as production;
--   * it does NOT recreate the separately-classified non-blocking
--     pre-history drift (67 legacy policies, 6 utility functions, 4
--     standalone indexes) -- see docs/DATABASE_HISTORY.md.
--
-- SERIAL POSITION
-- -------------------------------------------------------------------------
-- 20260619000000 sorts immediately after 20260618_add_evaluations.sql and
-- before every other migration. 44 of the 47 tables are created by the
-- 20260617000000 baseline; the remaining 3 (evaluation_templates,
-- evaluation_questions, evaluation_choices) are created by
-- 20260618_add_evaluations.sql -- hence this file runs just after it, when
-- all 47 exist. Nothing between here and the first migration that depends
-- on this state (20260811140000) reads these tables under RLS.
--
-- IDEMPOTENCY / DETERMINISM / SAFETY
-- -------------------------------------------------------------------------
-- The table list is fixed and taken verbatim from the authoritative
-- production catalog (no inference, no application-data dependency, no
-- authority change). Each ENABLE is existence-guarded via to_regclass and
-- `ENABLE ROW LEVEL SECURITY` is itself a no-op when RLS is already on, so
-- re-running this file is safe.

BEGIN;

-- ============================================================
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
-- ============================================================

COMMIT;
