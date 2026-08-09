-- Implements EPICENTRAX_STALE_MASTER_MAP_IDENTITY_CORRECTION_ARCHITECTURE.md
-- Accepted v1.1, §6 condition 8 / §6.3 (Retained-Reference Invariant
-- Amendment). This is a targeted fix to align the Stage 3A deployment
-- (20260809120000) with the amended architecture -- it changes nothing else.
--
-- Background: _repair_revalidate_stale_map_identity previously called the
-- Repair Plan's _repair_retained_reference_absent, which dynamically scans
-- every foreign key referencing public.parking_sites and fails if any row
-- references the target. That scanner protects a different invariant --
-- that a row's id survives an operation that may DELETE it (Duplicate
-- Retirement, Repair Plan §9). Stale-map correction never deletes a row;
-- it only updates master_site_id on a row whose id is preserved throughout.
-- The moment master_site_identity_correction.parking_site_id (itself a
-- foreign key to parking_sites, added in 20260809120000 for its own,
-- unrelated referential-integrity reason) held a row for either proposed
-- Crystal Beach correction, the generic scanner began reporting a
-- "retained reference" against the correction's own target -- a false
-- positive that would exclude every correction, permanently, for any row
-- ever proposed. See Accepted v1.1 §6.3 for the full architectural proof.
--
-- This migration:
--   1. Adds one new, narrowly-scoped, always-true retained-reference
--      determination specific to stale-map correction (§6.3's proof,
--      not a scan).
--   2. Replaces only the retained-reference sub-check inside
--      _repair_revalidate_stale_map_identity to call it instead of
--      _repair_retained_reference_absent.
--
-- It does NOT modify _repair_retained_reference_absent, which remains
-- exactly as deployed and exactly as required for Duplicate Retirement.
-- It does NOT modify master_site_identity_correction's schema, including
-- its parking_site_id foreign key, which Accepted v1.1 §6.3 explicitly
-- says should remain. It does NOT touch any historical migration, any
-- other STOP condition inside _repair_revalidate_stale_map_identity, any
-- correction or recovery record, or any parking_sites row. Deployment of
-- this migration performs no mutation of any kind -- both functions it
-- touches are read-only proof/revalidation helpers; nothing here is
-- invoked automatically.

-- ---------------------------------------------------------------------------
-- 1. Correction-specific retained-reference determination.
--
-- This is a proof, not a scan. It never queries pg_constraint, never
-- inspects any table for a referencing row, never special-cases
-- master_site_identity_correction, and maintains no exemption list. Its
-- result is fixed because the invariant it documents is guaranteed by the
-- structure of the calling operation, not by anything found at query time:
-- stale-map correction (Correction Architecture §6, §6.1) always preserves
-- parking_sites.id, never deletes the row, and changes only master_site_id
-- -- so every reference to parking_sites.id, current or future, remains
-- exactly as valid after the correction as before it. This says nothing
-- about, and does not weaken, the separate question of whether a
-- DELETING operation (Duplicate Retirement) may safely proceed -- that
-- remains _repair_retained_reference_absent's unchanged responsibility.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public._stale_map_identity_retained_reference_proof(p_parking_site_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO pg_catalog
STABLE
AS $$
  SELECT jsonb_build_object(
    'passed', true,
    'row_preserved', true,
    'parking_sites_id_unchanged', true,
    'deletion_attempted', false,
    'parking_site_id', p_parking_site_id
  );
$$;

ALTER FUNCTION public._stale_map_identity_retained_reference_proof(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._stale_map_identity_retained_reference_proof(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._stale_map_identity_retained_reference_proof(uuid) IS
  'Correction-specific retained-reference determination for '
  'STALE_MAP_IDENTITY correction (Accepted v1.1 §6.3). Always passes: '
  'the operation preserves parking_sites.id and never deletes the row, so '
  'no reference to that id can be invalidated. Not a foreign-key scan; '
  'does not replace or weaken _repair_retained_reference_absent, which '
  'remains required, unchanged, for Duplicate Retirement.';

-- ---------------------------------------------------------------------------
-- 2. Revalidation: only the retained-reference sub-check changes. Every
--    other proof -- row existence, old master identity, canonical
--    vacancy, old-map identity, Generation proof, currently selected new
--    map, same-venue proof, exact four-field equivalence, bidirectional
--    uniqueness (all inside the unchanged _stale_map_identity_evaluate),
--    frozen-target drift, target-unclaimed, and full before-state
--    equality -- is reproduced exactly as deployed in 20260809120000,
--    including all existing row locking.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._repair_revalidate_stale_map_identity(p_correction_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE
  v_correction public.master_site_identity_correction%ROWTYPE;
  v_live jsonb;
  v_row public.parking_sites%ROWTYPE;
  v_claim_exists boolean;
  v_retained jsonb;
BEGIN
  SELECT * INTO v_correction FROM public.master_site_identity_correction
  WHERE id = p_correction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'correction_not_found');
  END IF;

  -- Locks the target parking_sites row and the event's event_map_settings
  -- row, held through the caller's subsequent write (§6.1) -- unchanged.
  v_live := public._stale_map_identity_evaluate(v_correction.parking_site_id);

  IF NOT coalesce((v_live ->> 'passed')::boolean, false) THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'live_proof_failed', 'live_evaluation', v_live);
  END IF;

  IF (v_live ->> 'old_master_site_id')::uuid IS DISTINCT FROM v_correction.expected_old_master_site_id
     OR (v_live ->> 'old_map_id')::uuid IS DISTINCT FROM v_correction.expected_old_map_id
     OR (v_live ->> 'new_map_id')::uuid IS DISTINCT FROM v_correction.expected_new_map_id
     OR (v_live ->> 'proposed_new_master_site_id')::uuid IS DISTINCT FROM v_correction.proposed_new_master_site_id
  THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'target_drifted_from_frozen_proposal', 'live_evaluation', v_live);
  END IF;

  SELECT * INTO v_row FROM public.parking_sites WHERE id = v_correction.parking_site_id;
  IF (v_correction.before_state - 'master_site_id') IS DISTINCT FROM (to_jsonb(v_row) - 'master_site_id') THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'before_state_drifted', 'live_evaluation', v_live);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.parking_sites o
    WHERE o.event_id = v_correction.event_id AND o.id <> v_correction.parking_site_id
      AND o.master_site_id = v_correction.proposed_new_master_site_id
  ) INTO v_claim_exists;
  IF v_claim_exists THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'target_already_claimed', 'live_evaluation', v_live);
  END IF;

  -- Accepted v1.1 §6.3: correction-specific proof, not the Repair Plan's
  -- deletion-oriented foreign-key scan.
  v_retained := public._stale_map_identity_retained_reference_proof(v_correction.parking_site_id);
  IF NOT coalesce((v_retained ->> 'passed')::boolean, false) THEN
    RETURN jsonb_build_object(
      'passed', false,
      'reason', coalesce(v_retained ->> 'reason', 'retained_reference_check_unproven'),
      'retained_reference', v_retained, 'live_evaluation', v_live
    );
  END IF;

  RETURN jsonb_build_object(
    'passed', true, 'live_evaluation', v_live, 'current_state', to_jsonb(v_row),
    'retained_reference', v_retained
  );
END;
$$;

ALTER FUNCTION public._repair_revalidate_stale_map_identity(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_revalidate_stale_map_identity(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._repair_revalidate_stale_map_identity(uuid) IS
  'Execution-time revalidation for STALE_MAP_IDENTITY correction '
  '(Correction Architecture §6). Retained-reference sub-check uses the '
  'correction-specific proof (§6.3), not the Repair Plan''s deletion-'
  'oriented foreign-key scanner. Every other proof is unchanged from '
  '20260809120000.';
