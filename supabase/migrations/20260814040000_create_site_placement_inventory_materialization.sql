-- Site Placement Inventory Materialization Governance.
--
-- Governs the last ordinary-placement bypass identified by the Site
-- Placement Consumer Migration: when an admin targets a
-- master_map_sites template site that has no materialized
-- public.parking_sites row yet, app/admin/parking/page.tsx and
-- app/admin/checkin/page.tsx both still INSERT directly.
--
-- Preflight (LEM Inventory Materialization audit, 2026-08-14) confirmed
-- both pages create the identical logical row shape today --
-- `{event_id, master_site_id, assigned_attendee_id}` only, no
-- site_number/display_label/map_x/map_y, combining creation and
-- occupancy in one INSERT -- and that public.parking_sites has zero
-- live rows sharing an (event_id, master_site_id) pair where
-- master_site_id is not null, so the uniqueness backstop below is safe
-- to add now. event_map_settings and master_map_sites carry no NULL-
-- master_site_id-style data gap (unlike parking_sites itself), so this
-- migration can fully validate that a site belongs to the Event's
-- currently selected master map -- closing one of the two deferred
-- validations noted in the Site Placement Governed Mutation Foundation
-- report.
--
-- This migration does not add a Lifecycle guard, does not touch
-- parking_repair_*/master_site_identity_correction/quiescence, and does
-- not narrow parking_sites INSERT/UPDATE/DELETE grants -- other map/
-- master-map flows still write parking_sites directly and are out of
-- scope here, per the accompanying report.

BEGIN;

-- ============================================================
-- 1. Stable-identity backstop. Zero live violations confirmed by
--    preflight. Partial (master_site_id IS NOT NULL) because
--    parking_sites still carries legacy free-text-only rows with no
--    master_site_id at all -- an unlimited number of those must remain
--    permitted; this constraint only governs rows that do reference a
--    master site.
-- ============================================================

CREATE UNIQUE INDEX parking_sites_event_master_site_unique
  ON public.parking_sites (event_id, master_site_id)
  WHERE master_site_id IS NOT NULL;

-- ============================================================
-- 2. materialize_event_parking_site. Governed, idempotent creation of
--    exactly one Event parking-inventory row from an existing
--    master-map site. Authority-gated the same way as
--    record_site_placement (event.parking.manage or
--    event.checkin.manage -- both existing consumer workflows need to
--    reach this operation); creates a vacant row only, never assigns an
--    attendee, and never calls record_site_placement -- the Accepted
--    specification does not require a combined operation, and the two
--    remain separate governed steps per the consumer-migration plan.
-- ============================================================

CREATE OR REPLACE FUNCTION public.materialize_event_parking_site(
  p_event_id uuid,
  p_master_site_id uuid
)
RETURNS TABLE(
  outcome text,
  parking_site_id uuid,
  rejection_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_has_full boolean;
  v_has_restricted boolean;
  v_master_site public.master_map_sites%ROWTYPE;
  v_selected_master_map_id uuid;
  v_existing_id uuid;
  v_new_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Authority. Canonical Event-scoped task authority only -- never
  -- client-side can_assign_parking or a raw privilege_group check.
  -- Covers a nonexistent Event too: resolve_task_authority requires a
  -- real Event/Tenant lookup before any inherit branch, so an unknown
  -- p_event_id fails closed here with the same 'authorization_denied'
  -- a caller without Event access would see -- no separate existence
  -- probe is needed or wanted.
  v_has_full := public.has_event_task_authority('event.parking.manage', p_event_id);
  v_has_restricted := public.has_event_task_authority('event.checkin.manage', p_event_id);

  IF NOT v_has_full AND NOT v_has_restricted THEN
    RAISE EXCEPTION 'authorization_denied';
  END IF;

  SELECT * INTO v_master_site FROM public.master_map_sites WHERE id = p_master_site_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'rejected'::text, NULL::uuid, 'master_site_not_found'::text;
    RETURN;
  END IF;

  SELECT ems.selected_master_map_id INTO v_selected_master_map_id
  FROM public.event_map_settings AS ems WHERE ems.event_id = p_event_id;

  IF v_selected_master_map_id IS NULL OR v_selected_master_map_id <> v_master_site.master_map_id THEN
    RETURN QUERY SELECT 'rejected'::text, NULL::uuid, 'site_not_in_selected_map'::text;
    RETURN;
  END IF;

  -- Idempotent: a concurrent duplicate attempt is resolved atomically by
  -- the unique index -- ON CONFLICT DO NOTHING never raises, and the
  -- loser simply reselects the winner's row below.
  INSERT INTO public.parking_sites (
    event_id, master_site_id, site_number, display_label, map_x, map_y
  ) VALUES (
    p_event_id, p_master_site_id, v_master_site.site_number, v_master_site.display_label,
    v_master_site.map_x, v_master_site.map_y
  )
  ON CONFLICT (event_id, master_site_id) WHERE master_site_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN QUERY SELECT 'materialized'::text, v_new_id, NULL::text;
    RETURN;
  END IF;

  SELECT id INTO v_existing_id FROM public.parking_sites
  WHERE event_id = p_event_id AND master_site_id = p_master_site_id;

  RETURN QUERY SELECT 'already_materialized'::text, v_existing_id, NULL::text;
END;
$$;

ALTER FUNCTION public.materialize_event_parking_site(uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.materialize_event_parking_site(uuid, uuid)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.materialize_event_parking_site(uuid, uuid)
TO authenticated;

COMMIT;
