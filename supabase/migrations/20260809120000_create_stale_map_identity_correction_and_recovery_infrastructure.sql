-- Implements, additively, the now-Accepted:
--   docs/architecture/EPICENTRAX_STALE_MASTER_MAP_IDENTITY_CORRECTION_ARCHITECTURE.md
--   docs/architecture/EPICENTRAX_PARKING_REPAIR_PARTIAL_RECOVERY_ADDENDUM.md
--
-- This migration creates no correction record, no recovery record, and
-- mutates no existing row of any kind. It defines the two new tables and
-- the governed functions a future, separately authorized invocation would
-- call against a specific named parking_sites row and a specific named
-- parking_inventory_quiescence row. Until such an invocation happens, every
-- function below is dead code with no caller -- identical in spirit to the
-- original parking-repair infrastructure migration's own inertness
-- guarantee (20260808100000).
--
-- Two tables, matching the Accepted architecture's own derived minimum
-- (Stale Map Identity Correction Architecture, Appendix B; Partial Recovery
-- Addendum, Appendix):
--   1. master_site_identity_correction -- one row per proposed/approved/
--      applied/excluded correction of a single vacant parking_sites row's
--      stale master_site_id. Frozen at approval; a single permitted
--      terminal transition (approved -> applied | excluded) records the
--      outcome and nothing else, enforced by trigger, not convention
--      (Correction Architecture §8.1).
--   2. parking_repair_recovery -- one row per recovery/release attempt
--      against one exact, named parking_inventory_quiescence row. Never
--      writes parking_repair_execution or parking_repair_audit (Recovery
--      Addendum §2, §4).
--
-- Both tables are RLS-enabled with all grants revoked from PUBLIC, anon,
-- authenticated, and service_role -- the same deny-by-default pattern
-- already established for every other repair-adjacent table. Every new
-- function is owner-only: EXECUTE revoked from every application role,
-- reachable only through the same documented, audited, direct-database
-- maintenance procedure that already governs manifest approval and
-- execution (Repair Plan §5).
--
-- Nothing here modifies any previously applied migration, any existing
-- table, any existing function, or any existing grant. In particular,
-- execute_parking_repair, _repair_release_quiescence,
-- _repair_final_identity_verification, and _repair_retained_reference_absent
-- are reused unchanged by cross-reference -- never wrapped, never edited.

-- ---------------------------------------------------------------------------
-- 1. master_site_identity_correction
-- ---------------------------------------------------------------------------

CREATE TABLE public.master_site_identity_correction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Target and frozen identity (Correction Architecture §8.1 "frozen at
  -- approval" list). All FKs reference the target's own identity chain;
  -- this capability never deletes a parking_sites row, so a hard FK here
  -- carries no risk of the cascade/blocking dilemma that made
  -- parking_repair_manifest_entry.parking_site_id deliberately not an FK.
  parking_site_id uuid NOT NULL REFERENCES public.parking_sites(id),
  event_id uuid NOT NULL REFERENCES public.events(id),
  expected_old_master_site_id uuid NOT NULL REFERENCES public.master_map_sites(id),
  expected_old_map_id uuid NOT NULL REFERENCES public.master_maps(id),
  expected_new_map_id uuid NOT NULL REFERENCES public.master_maps(id),
  proposed_new_master_site_id uuid NOT NULL REFERENCES public.master_map_sites(id),
  -- Full parking_sites snapshot at proposal time.
  before_state jsonb NOT NULL,
  -- The complete STALE_MAP_IDENTITY proof (§4 conditions 3-12) as evaluated
  -- at proposal time -- frozen, never recomputed in place.
  proposal_time_proof jsonb NOT NULL,

  status text NOT NULL DEFAULT 'draft',
  approved_by text,
  approved_at timestamptz,

  -- Set only at the single permitted terminal transition (§8.1 "set
  -- exactly once" list).
  execution_time_proof jsonb,
  after_state jsonb,
  exclusion_reason text,
  executed_at timestamptz,
  executed_by text,

  CONSTRAINT master_site_identity_correction_status_check CHECK (
    status IN ('draft', 'approved', 'applied', 'excluded')
  ),
  CONSTRAINT master_site_identity_correction_old_new_map_distinct_check CHECK (
    expected_old_map_id <> expected_new_map_id
  ),
  CONSTRAINT master_site_identity_correction_approval_shape_check CHECK (
    (status = 'draft' AND approved_by IS NULL AND approved_at IS NULL)
    OR (status IN ('approved', 'applied', 'excluded')
        AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
  ),
  CONSTRAINT master_site_identity_correction_outcome_shape_check CHECK (
    (status IN ('draft', 'approved')
      AND execution_time_proof IS NULL AND after_state IS NULL
      AND exclusion_reason IS NULL AND executed_at IS NULL AND executed_by IS NULL)
    OR (status = 'applied'
      AND execution_time_proof IS NOT NULL AND after_state IS NOT NULL
      AND exclusion_reason IS NULL AND executed_at IS NOT NULL AND executed_by IS NOT NULL)
    OR (status = 'excluded'
      AND execution_time_proof IS NOT NULL AND after_state IS NULL
      AND exclusion_reason IS NOT NULL AND executed_at IS NOT NULL AND executed_by IS NOT NULL)
  )
);

COMMENT ON TABLE public.master_site_identity_correction IS
  'One row per proposed/approved/applied/excluded correction of a single '
  'vacant parking_sites row''s stale master_site_id, per '
  'EPICENTRAX_STALE_MASTER_MAP_IDENTITY_CORRECTION_ARCHITECTURE.md. Frozen '
  'field-by-field at approval; exactly one permitted terminal transition.';

-- At most one non-terminal (draft/approved) correction per target row
-- (Correction Architecture §6.2).
CREATE UNIQUE INDEX master_site_identity_correction_one_active_per_row_idx
  ON public.master_site_identity_correction (parking_site_id)
  WHERE status IN ('draft', 'approved');

ALTER TABLE public.master_site_identity_correction OWNER TO postgres;
ALTER TABLE public.master_site_identity_correction ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.master_site_identity_correction
  FROM PUBLIC, anon, authenticated, service_role;

-- Field-level freeze contract (§8.1), enforced by trigger comparison of
-- every frozen column individually -- not merely a status check.
CREATE FUNCTION public.enforce_master_site_identity_correction_immutability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
  IF OLD.status IN ('applied', 'excluded') THEN
    RAISE EXCEPTION
      'Correction % is terminal (%) and permanently immutable.', OLD.id, OLD.status;
  END IF;

  IF OLD.status = 'approved' THEN
    IF NEW.status NOT IN ('applied', 'excluded') THEN
      RAISE EXCEPTION
        'An approved correction may only transition to applied or excluded.';
    END IF;
    IF NEW.parking_site_id IS DISTINCT FROM OLD.parking_site_id
       OR NEW.event_id IS DISTINCT FROM OLD.event_id
       OR NEW.expected_old_master_site_id IS DISTINCT FROM OLD.expected_old_master_site_id
       OR NEW.expected_old_map_id IS DISTINCT FROM OLD.expected_old_map_id
       OR NEW.expected_new_map_id IS DISTINCT FROM OLD.expected_new_map_id
       OR NEW.proposed_new_master_site_id IS DISTINCT FROM OLD.proposed_new_master_site_id
       OR NEW.before_state IS DISTINCT FROM OLD.before_state
       OR NEW.proposal_time_proof IS DISTINCT FROM OLD.proposal_time_proof
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    THEN
      RAISE EXCEPTION 'Frozen fields may never change once a correction is approved.';
    END IF;
    RETURN NEW;
  END IF;

  -- OLD.status = 'draft': only the draft -> approved transition is
  -- permitted, and only approval attribution may be newly set; every
  -- proposal-time field must remain exactly as proposed.
  IF NEW.status <> 'approved' THEN
    RAISE EXCEPTION 'A draft correction may only transition to approved.';
  END IF;
  IF NEW.parking_site_id IS DISTINCT FROM OLD.parking_site_id
     OR NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.expected_old_master_site_id IS DISTINCT FROM OLD.expected_old_master_site_id
     OR NEW.expected_old_map_id IS DISTINCT FROM OLD.expected_old_map_id
     OR NEW.expected_new_map_id IS DISTINCT FROM OLD.expected_new_map_id
     OR NEW.proposed_new_master_site_id IS DISTINCT FROM OLD.proposed_new_master_site_id
     OR NEW.before_state IS DISTINCT FROM OLD.before_state
     OR NEW.proposal_time_proof IS DISTINCT FROM OLD.proposal_time_proof
  THEN
    RAISE EXCEPTION 'Proposal fields may not change when approving a correction.';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_master_site_identity_correction_immutability() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_master_site_identity_correction_immutability()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER master_site_identity_correction_enforce_immutability
  BEFORE UPDATE ON public.master_site_identity_correction
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_master_site_identity_correction_immutability();

-- ---------------------------------------------------------------------------
-- 2. parking_repair_recovery
-- ---------------------------------------------------------------------------

CREATE TABLE public.parking_repair_recovery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Historical context only, per Recovery Addendum §3 -- never the release
  -- key and never written back to.
  original_execution_id uuid NOT NULL REFERENCES public.parking_repair_execution(id),
  -- The exact, individually-named release target (§3/§3a). This, not
  -- original_execution_id, is what a release ever acts against.
  target_quiescence_id uuid NOT NULL REFERENCES public.parking_inventory_quiescence(id),
  event_id uuid NOT NULL REFERENCES public.events(id),
  -- One or more governed remediation/correction record ids relied upon.
  -- A uuid[] array, matching the existing scope_event_ids array-column
  -- pattern already used on parking_repair_manifest, rather than a new
  -- join table for what is always a small, human-named list.
  remediation_correction_ids uuid[] NOT NULL,

  status text NOT NULL DEFAULT 'attempted',
  final_identity_verification_result jsonb,
  failure_reason jsonb,
  released_at timestamptz,

  authorized_by text NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,

  CONSTRAINT parking_repair_recovery_status_check CHECK (
    status IN ('attempted', 'released', 'failed')
  ),
  CONSTRAINT parking_repair_recovery_remediation_nonempty_check CHECK (
    array_length(remediation_correction_ids, 1) > 0
  ),
  CONSTRAINT parking_repair_recovery_outcome_shape_check CHECK (
    (status = 'attempted'
      AND released_at IS NULL AND final_identity_verification_result IS NULL
      AND failure_reason IS NULL)
    OR (status = 'released'
      AND released_at IS NOT NULL AND final_identity_verification_result IS NOT NULL
      AND failure_reason IS NULL)
    OR (status = 'failed'
      AND released_at IS NULL AND failure_reason IS NOT NULL)
  )
);

COMMENT ON TABLE public.parking_repair_recovery IS
  'One row per recovery/release attempt against one exact '
  'parking_inventory_quiescence row, per '
  'EPICENTRAX_PARKING_REPAIR_PARTIAL_RECOVERY_ADDENDUM.md. Never writes '
  'parking_repair_execution or parking_repair_audit; the referenced '
  'original execution''s final_disposition is never altered by this table '
  'or anything that writes to it.';

-- At most one non-terminal (attempted) recovery record per target
-- quiescence window (Recovery Addendum §4.2).
CREATE UNIQUE INDEX parking_repair_recovery_one_attempt_per_window_idx
  ON public.parking_repair_recovery (target_quiescence_id)
  WHERE status = 'attempted';

ALTER TABLE public.parking_repair_recovery OWNER TO postgres;
ALTER TABLE public.parking_repair_recovery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.parking_repair_recovery
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.enforce_parking_repair_recovery_immutability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
  IF OLD.status IN ('released', 'failed') THEN
    RAISE EXCEPTION
      'Recovery attempt % is terminal (%) and permanently immutable.', OLD.id, OLD.status;
  END IF;

  IF NEW.status = 'attempted' THEN
    RAISE EXCEPTION
      'A recovery attempt must resolve to released or failed; it may not remain attempted after an update.';
  END IF;

  IF NEW.original_execution_id IS DISTINCT FROM OLD.original_execution_id
     OR NEW.target_quiescence_id IS DISTINCT FROM OLD.target_quiescence_id
     OR NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.remediation_correction_ids IS DISTINCT FROM OLD.remediation_correction_ids
     OR NEW.authorized_by IS DISTINCT FROM OLD.authorized_by
     OR NEW.authorized_at IS DISTINCT FROM OLD.authorized_at
     OR NEW.reason IS DISTINCT FROM OLD.reason
  THEN
    RAISE EXCEPTION 'Recovery reference fields may never change once recorded.';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_parking_repair_recovery_immutability() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_parking_repair_recovery_immutability()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER parking_repair_recovery_enforce_immutability
  BEFORE UPDATE ON public.parking_repair_recovery
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_parking_repair_recovery_immutability();

-- ---------------------------------------------------------------------------
-- 3. STALE_MAP_IDENTITY evaluation (read-only) and execution-time
--    revalidation. Reused unchanged for both proposal-time proof
--    computation and execution-time re-proof -- Correction Architecture §4
--    and §6 use the identical standard for both.
-- ---------------------------------------------------------------------------

-- Row eligibility, same-venue proof, Generation proof, and site-equivalence
-- proof (§4 conditions 1-12), evaluated against current live state only.
-- No fuzzy matching, no coordinate tolerance, no partial-field credit --
-- every comparison is exact IS NOT DISTINCT FROM, matching the Repair
-- Plan's own Inventory Equivalence discipline (§7) applied one
-- map-generation removed.
CREATE FUNCTION public._stale_map_identity_evaluate(p_parking_site_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE
  v_row public.parking_sites%ROWTYPE;
  v_old_map_id uuid;
  v_new_map_id uuid;
  v_venue_old record;
  v_venue_new record;
  v_gen_archived boolean;
  v_gen_not_selected boolean;
  v_old_site record;
  v_old_match_count integer;
  v_new_match_count integer;
  v_new_target uuid;
  v_new_coord_collision integer;
BEGIN
  SELECT * INTO v_row FROM public.parking_sites WHERE id = p_parking_site_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'row_not_found');
  END IF;
  IF v_row.assigned_attendee_id IS NOT NULL THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'row_occupied', 'current_state', to_jsonb(v_row));
  END IF;
  IF v_row.master_site_id IS NULL THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'master_site_id_is_null', 'current_state', to_jsonb(v_row));
  END IF;

  SELECT ms.master_map_id INTO v_old_map_id
  FROM public.master_map_sites ms WHERE ms.id = v_row.master_site_id;
  IF v_old_map_id IS NULL THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'old_master_site_not_found', 'current_state', to_jsonb(v_row));
  END IF;

  SELECT ms.site_number, ms.display_label, ms.map_x, ms.map_y INTO v_old_site
  FROM public.master_map_sites ms WHERE ms.id = v_row.master_site_id;

  SELECT ems.selected_master_map_id INTO v_new_map_id
  FROM public.event_map_settings ems WHERE ems.event_id = v_row.event_id FOR UPDATE;
  IF v_new_map_id IS NULL THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'event_has_no_selected_map', 'current_state', to_jsonb(v_row));
  END IF;

  -- Condition 7: old and new map ids must differ.
  IF v_old_map_id = v_new_map_id THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'old_map_equals_selected_map', 'current_state', to_jsonb(v_row));
  END IF;

  -- Conditions 3-6: same-venue proof.
  SELECT name, park_name, location, map_group INTO v_venue_old FROM public.master_maps WHERE id = v_old_map_id;
  SELECT name, park_name, location, map_group INTO v_venue_new FROM public.master_maps WHERE id = v_new_map_id;
  IF v_venue_old IS NULL OR v_venue_new IS NULL THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'map_metadata_not_found', 'current_state', to_jsonb(v_row));
  END IF;
  IF NOT (
    v_venue_old.name IS NOT DISTINCT FROM v_venue_new.name
    AND v_venue_old.park_name IS NOT DISTINCT FROM v_venue_new.park_name
    AND v_venue_old.location IS NOT DISTINCT FROM v_venue_new.location
    AND v_venue_old.map_group IS NOT DISTINCT FROM v_venue_new.map_group
  ) THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'same_venue_proof_failed', 'current_state', to_jsonb(v_row));
  END IF;

  -- Condition 8: Generation proof. Deterministic: a map currently selected
  -- by any Event can never qualify as the superseded "old" side, regardless
  -- of same-venue metadata equality.
  SELECT (status = 'archived') INTO v_gen_archived FROM public.master_maps WHERE id = v_old_map_id;
  SELECT NOT EXISTS (
    SELECT 1 FROM public.event_map_settings WHERE selected_master_map_id = v_old_map_id
  ) INTO v_gen_not_selected;
  IF NOT (coalesce(v_gen_archived, false) OR coalesce(v_gen_not_selected, false)) THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'generation_proof_failed', 'current_state', to_jsonb(v_row));
  END IF;

  -- Condition 9: the old reference is not itself ambiguous.
  SELECT count(*) INTO v_old_match_count FROM public.master_map_sites
  WHERE master_map_id = v_old_map_id
    AND site_number IS NOT DISTINCT FROM v_old_site.site_number
    AND display_label IS NOT DISTINCT FROM v_old_site.display_label
    AND map_x IS NOT DISTINCT FROM v_old_site.map_x
    AND map_y IS NOT DISTINCT FROM v_old_site.map_y;
  IF v_old_match_count <> 1 THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'old_reference_ambiguous', 'current_state', to_jsonb(v_row));
  END IF;

  -- Condition 10/12: exactly one exact four-field match on the new map.
  SELECT count(*), min(id::text)::uuid INTO v_new_match_count, v_new_target
  FROM public.master_map_sites
  WHERE master_map_id = v_new_map_id
    AND site_number IS NOT DISTINCT FROM v_old_site.site_number
    AND display_label IS NOT DISTINCT FROM v_old_site.display_label
    AND map_x IS NOT DISTINCT FROM v_old_site.map_x
    AND map_y IS NOT DISTINCT FROM v_old_site.map_y;
  IF v_new_match_count <> 1 THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'no_unique_new_map_match', 'current_state', to_jsonb(v_row));
  END IF;

  -- Condition 11: no coordinate collision under a different site_number.
  SELECT count(*) INTO v_new_coord_collision FROM public.master_map_sites
  WHERE master_map_id = v_new_map_id
    AND map_x IS NOT DISTINCT FROM v_old_site.map_x
    AND map_y IS NOT DISTINCT FROM v_old_site.map_y;
  IF v_new_coord_collision <> 1 THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'ambiguous_coordinate_match_on_new_map', 'current_state', to_jsonb(v_row));
  END IF;

  RETURN jsonb_build_object(
    'passed', true,
    'old_master_site_id', v_row.master_site_id,
    'old_map_id', v_old_map_id,
    'new_map_id', v_new_map_id,
    'proposed_new_master_site_id', v_new_target,
    'current_state', to_jsonb(v_row),
    'venue_evidence', jsonb_build_object(
      'name', v_venue_old.name, 'park_name', v_venue_old.park_name,
      'location', v_venue_old.location, 'map_group', v_venue_old.map_group
    ),
    'generation_evidence', jsonb_build_object(
      'old_map_archived', coalesce(v_gen_archived, false),
      'old_map_not_selected_by_any_event', coalesce(v_gen_not_selected, false)
    )
  );
END;
$$;

ALTER FUNCTION public._stale_map_identity_evaluate(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._stale_map_identity_evaluate(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Execution-time revalidation: re-runs the evaluation live, confirms it
-- still agrees with the frozen correction record exactly (no silent
-- retargeting), confirms the full before_state still matches, confirms the
-- target remains unclaimed, and confirms the retained-reference guard
-- passes -- reusing the Repair Plan's existing dynamic helper unchanged.
CREATE FUNCTION public._repair_revalidate_stale_map_identity(p_correction_id uuid)
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
  -- row, held through the caller's subsequent write (§6.1).
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

  v_retained := public._repair_retained_reference_absent(v_correction.parking_site_id);
  IF NOT coalesce((v_retained ->> 'passed')::boolean, false) THEN
    RETURN jsonb_build_object(
      'passed', false,
      'reason', coalesce(v_retained ->> 'reason', 'retained_reference_check_unproven'),
      'retained_reference', v_retained, 'live_evaluation', v_live
    );
  END IF;

  RETURN jsonb_build_object('passed', true, 'live_evaluation', v_live, 'current_state', to_jsonb(v_row));
END;
$$;

ALTER FUNCTION public._repair_revalidate_stale_map_identity(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_revalidate_stale_map_identity(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Correction lifecycle: propose -> review -> approve -> apply.
--    Mirrors the Repair Plan's own prepare/review/approve/execute pattern
--    (Correction Architecture §5).
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.propose_master_site_identity_correction(p_parking_site_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE
  v_eval jsonb;
  v_row public.parking_sites%ROWTYPE;
  v_id uuid;
BEGIN
  v_eval := public._stale_map_identity_evaluate(p_parking_site_id);
  IF NOT coalesce((v_eval ->> 'passed')::boolean, false) THEN
    RAISE EXCEPTION 'Row % does not satisfy the STALE_MAP_IDENTITY proof: %',
      p_parking_site_id, coalesce(v_eval ->> 'reason', 'unknown');
  END IF;

  SELECT * INTO v_row FROM public.parking_sites WHERE id = p_parking_site_id;

  INSERT INTO public.master_site_identity_correction (
    parking_site_id, event_id,
    expected_old_master_site_id, expected_old_map_id, expected_new_map_id,
    proposed_new_master_site_id, before_state, proposal_time_proof
  ) VALUES (
    p_parking_site_id, v_row.event_id,
    (v_eval ->> 'old_master_site_id')::uuid, (v_eval ->> 'old_map_id')::uuid, (v_eval ->> 'new_map_id')::uuid,
    (v_eval ->> 'proposed_new_master_site_id')::uuid, to_jsonb(v_row), v_eval
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.propose_master_site_identity_correction(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.propose_master_site_identity_correction(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.review_master_site_identity_correction(p_correction_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO pg_catalog STABLE AS $$
  SELECT to_jsonb(c) FROM public.master_site_identity_correction c WHERE c.id = p_correction_id;
$$;

ALTER FUNCTION public.review_master_site_identity_correction(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.review_master_site_identity_correction(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.approve_master_site_identity_correction(p_correction_id uuid, p_approved_by text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE
  v_correction public.master_site_identity_correction%ROWTYPE;
BEGIN
  IF nullif(btrim(p_approved_by), '') IS NULL THEN
    RAISE EXCEPTION 'External approval reference required.';
  END IF;
  SELECT * INTO v_correction FROM public.master_site_identity_correction
  WHERE id = p_correction_id FOR UPDATE;
  IF NOT FOUND OR v_correction.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft correction may be approved.';
  END IF;
  UPDATE public.master_site_identity_correction
  SET status = 'approved', approved_by = btrim(p_approved_by), approved_at = clock_timestamp()
  WHERE id = p_correction_id;
END;
$$;

ALTER FUNCTION public.approve_master_site_identity_correction(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_master_site_identity_correction(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- The governed correction operation (Correction Architecture §6, §6.1, §7).
-- Locks the target row and event_map_settings (via
-- _stale_map_identity_evaluate, called from the revalidation helper),
-- performs live revalidation and mutation in the same transaction, and
-- changes only master_site_id on the one approved vacant row -- nothing
-- else, ever.
CREATE FUNCTION public.apply_master_site_identity_correction(p_correction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE
  v_correction public.master_site_identity_correction%ROWTYPE;
  v_revalidation jsonb;
  v_after jsonb;
BEGIN
  SELECT * INTO v_correction FROM public.master_site_identity_correction
  WHERE id = p_correction_id FOR UPDATE;
  IF NOT FOUND OR v_correction.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved correction may be applied.';
  END IF;

  v_revalidation := public._repair_revalidate_stale_map_identity(p_correction_id);

  IF coalesce((v_revalidation ->> 'passed')::boolean, false) THEN
    -- Bypass flag set only immediately before, and in the same transaction
    -- as, the one write it authorizes -- identical discipline to
    -- _repair_apply_direct_repair.
    PERFORM set_config('epicentrax.parking_repair_bypass_authorized', 'true', true);

    UPDATE public.parking_sites
    SET master_site_id = v_correction.proposed_new_master_site_id
    WHERE id = v_correction.parking_site_id
    RETURNING to_jsonb(parking_sites.*) INTO v_after;

    UPDATE public.master_site_identity_correction
    SET status = 'applied',
        execution_time_proof = v_revalidation,
        after_state = v_after,
        executed_at = clock_timestamp(),
        executed_by = current_user || '/' || session_user
    WHERE id = p_correction_id;
  ELSE
    UPDATE public.master_site_identity_correction
    SET status = 'excluded',
        execution_time_proof = v_revalidation,
        exclusion_reason = coalesce(v_revalidation ->> 'reason', 'revalidation_failed'),
        executed_at = clock_timestamp(),
        executed_by = current_user || '/' || session_user
    WHERE id = p_correction_id;
  END IF;
END;
$$;

ALTER FUNCTION public.apply_master_site_identity_correction(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_master_site_identity_correction(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Recovery/release operation (Recovery Addendum §3, §4, §4.1).
--    A distinct, separate release path -- never a wrapper around the
--    existing execution-scoped _repair_release_quiescence(execution_id),
--    which remains untouched and still used only by execute_parking_repair.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.attempt_parking_repair_recovery(
  p_original_execution_id uuid,
  p_target_quiescence_id uuid,
  p_event_id uuid,
  p_remediation_correction_ids uuid[],
  p_authorized_by text,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE
  v_recovery_id uuid;
  v_quiescence public.parking_inventory_quiescence%ROWTYPE;
  v_fail_reason jsonb;
  v_bad_remediation uuid;
  v_verification jsonb;
BEGIN
  IF nullif(btrim(p_authorized_by), '') IS NULL THEN
    RAISE EXCEPTION 'External authorization reference required.';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required.';
  END IF;
  IF p_remediation_correction_ids IS NULL OR array_length(p_remediation_correction_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one remediation record must be referenced.';
  END IF;

  INSERT INTO public.parking_repair_recovery (
    original_execution_id, target_quiescence_id, event_id,
    remediation_correction_ids, authorized_by, reason
  ) VALUES (
    p_original_execution_id, p_target_quiescence_id, p_event_id,
    p_remediation_correction_ids, btrim(p_authorized_by), btrim(p_reason)
  ) RETURNING id INTO v_recovery_id;

  -- Lock the exact named quiescence row -- never resolved implicitly from
  -- execution_id (§3a).
  SELECT * INTO v_quiescence FROM public.parking_inventory_quiescence
  WHERE id = p_target_quiescence_id FOR UPDATE;

  IF NOT FOUND THEN
    v_fail_reason := jsonb_build_object('reason', 'quiescence_row_not_found');
  ELSIF v_quiescence.released_at IS NOT NULL THEN
    v_fail_reason := jsonb_build_object(
      'reason', 'quiescence_already_released', 'released_at', v_quiescence.released_at
    );
  ELSIF v_quiescence.engaged_by_execution_id IS DISTINCT FROM p_original_execution_id THEN
    v_fail_reason := jsonb_build_object(
      'reason', 'execution_id_mismatch',
      'actual_engaged_by_execution_id', v_quiescence.engaged_by_execution_id
    );
  ELSIF v_quiescence.event_id IS DISTINCT FROM p_event_id THEN
    v_fail_reason := jsonb_build_object(
      'reason', 'event_id_mismatch', 'actual_event_id', v_quiescence.event_id
    );
  ELSE
    -- Every referenced remediation record must independently revalidate:
    -- exists, belongs to the correction capability, terminal status
    -- 'applied', and pertains to the named Event (§4 item 6). Checked
    -- fresh here, every time -- never assumed from the recovery record's
    -- own stored reference.
    SELECT r.id INTO v_bad_remediation
    FROM unnest(p_remediation_correction_ids) r(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.master_site_identity_correction c
      WHERE c.id = r.id AND c.status = 'applied' AND c.event_id = p_event_id
    )
    LIMIT 1;

    IF v_bad_remediation IS NOT NULL THEN
      v_fail_reason := jsonb_build_object(
        'reason', 'remediation_record_not_applied_or_unrelated', 'remediation_id', v_bad_remediation
      );
    ELSE
      v_verification := public._repair_final_identity_verification(ARRAY[p_event_id]);
      IF NOT coalesce((v_verification ->> 'passed')::boolean, false) THEN
        v_fail_reason := jsonb_build_object('reason', 'final_identity_verification_failed', 'result', v_verification);
      END IF;
    END IF;
  END IF;

  IF v_fail_reason IS NOT NULL THEN
    UPDATE public.parking_repair_recovery
    SET status = 'failed', failure_reason = v_fail_reason
    WHERE id = v_recovery_id;
    RETURN v_recovery_id;
  END IF;

  -- Release only the exact named quiescence row. No bypass flag is
  -- involved or needed: parking_inventory_quiescence is not protected by
  -- the quiescence-enforcement trigger (that trigger only guards
  -- parking_sites, attendees, and event_map_settings) -- ownership and
  -- revoked grants alone already make this owner-only.
  UPDATE public.parking_inventory_quiescence
  SET released_at = clock_timestamp()
  WHERE id = p_target_quiescence_id;

  UPDATE public.parking_repair_recovery
  SET status = 'released', released_at = clock_timestamp(),
      final_identity_verification_result = v_verification
  WHERE id = v_recovery_id;

  RETURN v_recovery_id;
END;
$$;

ALTER FUNCTION public.attempt_parking_repair_recovery(uuid, uuid, uuid, uuid[], text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.attempt_parking_repair_recovery(uuid, uuid, uuid, uuid[], text, text)
  FROM PUBLIC, anon, authenticated, service_role;
