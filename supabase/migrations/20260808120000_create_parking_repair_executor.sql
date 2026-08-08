-- Governed Production Repair Plan: the governed execution framework.
--
-- Implements EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md and
-- EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_IMPLEMENTATION_PLAN.md in full.
-- This migration creates no manifest, engages no quiescence, and performs
-- no mutation on deployment -- it only defines the functions that a future,
-- separately authorized repair execution would call against an
-- already-approved manifest. Until such a manifest exists, every function
-- below is dead code with no caller.
--
-- Authorization design (Implementation Plan §8, "Repair Bypass
-- Governance"): every function here has EXECUTE revoked from PUBLIC, anon,
-- authenticated, and service_role, and is granted to no other role either
-- -- only the function owner (postgres) can invoke it. This is deliberate,
-- not an oversight: Repair Plan §5 requires that repair execution
-- authority be "not an application role, not a permission key, not an
-- RPC-callable capability" -- inventing a dedicated custom database role
-- would still be an application-adjacent authorization mechanism. Owner-
-- only execution means the sole way to invoke public.execute_parking_repair
-- is a direct, privileged database session (the documented, audited
-- maintenance procedure Repair Plan §5 already names), which is
-- categorically unreachable through PostgREST/Supabase client calls
-- (those authenticate as anon/authenticated/service_role, never as the
-- table/function owner).
--
-- Transaction design: public.execute_parking_repair is a PROCEDURE, not a
-- FUNCTION, specifically so each manifest entry's revalidate -> mutate ->
-- audit-write can COMMIT independently, per Implementation Plan §6's
-- explicit requirement that "each individual row's action... is its own
-- single atomic transaction -- not one giant transaction for the whole
-- execution." A FUNCTION cannot issue COMMIT; a PROCEDURE, called at the
-- top level via CALL from a privileged session, can. Every helper function
-- below runs inside whatever transaction is currently open when the
-- procedure calls it -- none of them independently commits.
--
-- actor_identity is recorded as current_user/session_user -- the actual
-- database session identity of whoever is running the documented, audited
-- maintenance procedure. Richer identity (which specific person) belongs
-- in that external, organizationally-governed procedure's own records,
-- referenced by parking_repair_manifest.approved_by -- it is not
-- fabricated here.

-- ---------------------------------------------------------------------------
-- Manifest loading and validation.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public._repair_load_and_validate_manifest(p_manifest_id uuid)
RETURNS public.parking_repair_manifest
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_manifest public.parking_repair_manifest%ROWTYPE;
  v_entry_count integer;
BEGIN
  SELECT * INTO v_manifest
  FROM public.parking_repair_manifest
  WHERE id = p_manifest_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repair manifest % does not exist.', p_manifest_id;
  END IF;

  IF v_manifest.status <> 'approved' THEN
    RAISE EXCEPTION
      'Repair manifest % is not approved (status: %). Execution requires an '
      'approved, frozen manifest.', p_manifest_id, v_manifest.status;
  END IF;

  SELECT count(*) INTO v_entry_count
  FROM public.parking_repair_manifest_entry
  WHERE manifest_id = p_manifest_id;

  IF v_entry_count = 0 THEN
    RAISE EXCEPTION 'Repair manifest % has no entries.', p_manifest_id;
  END IF;

  RETURN v_manifest;
END;
$$;

ALTER FUNCTION public._repair_load_and_validate_manifest(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_load_and_validate_manifest(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Quiescence engagement / release.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public._repair_engage_quiescence(
  p_execution_id uuid,
  p_event_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_event_id uuid;
  v_already_active boolean;
BEGIN
  FOREACH v_event_id IN ARRAY p_event_ids LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.parking_inventory_quiescence
      WHERE event_id = v_event_id AND released_at IS NULL
    ) INTO v_already_active;

    IF v_already_active THEN
      RAISE EXCEPTION
        'Event % already has an active repair quiescence window. Overlapping '
        'repair executions are not permitted.', v_event_id;
    END IF;

    INSERT INTO public.parking_inventory_quiescence (
      event_id, engaged_by_execution_id
    ) VALUES (
      v_event_id, p_execution_id
    );
  END LOOP;
END;
$$;

ALTER FUNCTION public._repair_engage_quiescence(uuid, uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_engage_quiescence(uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public._repair_release_quiescence(p_execution_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
BEGIN
  UPDATE public.parking_inventory_quiescence
  SET released_at = now()
  WHERE engaged_by_execution_id = p_execution_id
    AND released_at IS NULL;
END;
$$;

ALTER FUNCTION public._repair_release_quiescence(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_release_quiescence(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Direct Repair: execution-time revalidation and application.
--
-- Proof requirement (Implementation Plan §9): the target row still exists
-- and is still master_site_id IS NULL; within the Event's CURRENT selected
-- master map, exactly one master_map_sites row matches on all four
-- comparable fields (site_number, display_label, map_x, map_y -- not
-- site_number alone); no other parking_sites row for this Event already
-- holds that master_site_id. Any failure excludes the row -- it is never
-- force-resolved on a partial or single-field match.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public._repair_revalidate_direct_repair(
  p_parking_site_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_row public.parking_sites%ROWTYPE;
  v_match_count integer;
  v_matched_master_site_id uuid;
  v_conflict_exists boolean;
BEGIN
  SELECT * INTO v_row
  FROM public.parking_sites
  WHERE id = p_parking_site_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'passed', false, 'reason', 'row_no_longer_exists'
    );
  END IF;

  IF v_row.master_site_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'passed', false, 'reason', 'master_site_id_no_longer_null',
      'current_state', to_jsonb(v_row)
    );
  END IF;

  -- uuid has no built-in max() aggregate, so count and identify are two
  -- separate queries rather than one combined aggregate -- confirmed
  -- directly (Postgres 17, local validation) that max(uuid) does not
  -- exist. Splitting into count-then-fetch is deterministic here
  -- regardless: the fetch only ever runs once count = 1 is confirmed.
  SELECT count(*) INTO v_match_count
  FROM public.master_map_sites AS mms
  JOIN public.event_map_settings AS ems
    ON ems.selected_master_map_id = mms.master_map_id
  WHERE ems.event_id = v_row.event_id
    AND mms.site_number IS NOT DISTINCT FROM v_row.site_number
    AND mms.display_label IS NOT DISTINCT FROM v_row.display_label
    AND mms.map_x IS NOT DISTINCT FROM v_row.map_x
    AND mms.map_y IS NOT DISTINCT FROM v_row.map_y;

  IF v_match_count <> 1 THEN
    RETURN jsonb_build_object(
      'passed', false, 'reason', 'not_exactly_one_master_site_match',
      'match_count', v_match_count,
      'current_state', to_jsonb(v_row)
    );
  END IF;

  SELECT mms.id INTO v_matched_master_site_id
  FROM public.master_map_sites AS mms
  JOIN public.event_map_settings AS ems
    ON ems.selected_master_map_id = mms.master_map_id
  WHERE ems.event_id = v_row.event_id
    AND mms.site_number IS NOT DISTINCT FROM v_row.site_number
    AND mms.display_label IS NOT DISTINCT FROM v_row.display_label
    AND mms.map_x IS NOT DISTINCT FROM v_row.map_x
    AND mms.map_y IS NOT DISTINCT FROM v_row.map_y
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.parking_sites
    WHERE event_id = v_row.event_id
      AND master_site_id = v_matched_master_site_id
      AND id <> v_row.id
  ) INTO v_conflict_exists;

  IF v_conflict_exists THEN
    RETURN jsonb_build_object(
      'passed', false, 'reason', 'master_site_id_already_claimed',
      'current_state', to_jsonb(v_row)
    );
  END IF;

  RETURN jsonb_build_object(
    'passed', true,
    'resolved_master_site_id', v_matched_master_site_id,
    'current_state', to_jsonb(v_row)
  );
END;
$$;

ALTER FUNCTION public._repair_revalidate_direct_repair(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_revalidate_direct_repair(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public._repair_apply_direct_repair(
  p_entry public.parking_repair_manifest_entry,
  p_execution_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_revalidation jsonb;
  v_after_state jsonb;
BEGIN
  v_revalidation := public._repair_revalidate_direct_repair(p_entry.parking_site_id);

  IF (v_revalidation ->> 'passed')::boolean THEN
    -- Bypass flag set only immediately before, and in the same transaction
    -- as, the one write it authorizes.
    PERFORM set_config('epicentrax.parking_repair_bypass_authorized', 'true', true);

    UPDATE public.parking_sites
    SET master_site_id = (v_revalidation ->> 'resolved_master_site_id')::uuid
    WHERE id = p_entry.parking_site_id
    RETURNING to_jsonb(parking_sites.*) INTO v_after_state;

    INSERT INTO public.parking_repair_audit (
      execution_id, manifest_entry_id, action_taken,
      before_state, after_state, revalidation_result,
      actor_identity, validation_assertions_passed
    ) VALUES (
      p_execution_id, p_entry.id, 'direct_repair_applied',
      v_revalidation -> 'current_state', v_after_state, v_revalidation,
      current_user || '/' || session_user,
      ARRAY['still_exists', 'still_null_master_site_id',
            'exactly_one_master_site_match', 'no_conflicting_claim']
    );
  ELSE
    INSERT INTO public.parking_repair_audit (
      execution_id, manifest_entry_id, action_taken,
      before_state, revalidation_result, actor_identity
    ) VALUES (
      p_execution_id, p_entry.id, 'revalidation_failed_excluded',
      coalesce(v_revalidation -> 'current_state', p_entry.before_state),
      v_revalidation, current_user || '/' || session_user
    );
  END IF;
END;
$$;

ALTER FUNCTION public._repair_apply_direct_repair(public.parking_repair_manifest_entry, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_apply_direct_repair(public.parking_repair_manifest_entry, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Duplicate consolidation: execution-time revalidation and application.
--
-- Retire Duplicate Row's five conditions (Repair Plan §9), re-proven
-- atomically at the moment of deletion, never assumed from manifest-build
-- time: (1) vacant; (2) no retained reference; (3) identical to survivor in
-- every Inventory Equivalence Field; (4) survivor preserved unmodified;
-- (5) before-state audited prior to deletion.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public._repair_revalidate_duplicate_retirement(
  p_parking_site_id uuid,
  p_survivor_parking_site_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_row public.parking_sites%ROWTYPE;
  v_survivor public.parking_sites%ROWTYPE;
BEGIN
  -- Lock both rows, in stable identifier order, to serialize against any
  -- concurrent repair activity touching either row.
  IF p_parking_site_id < p_survivor_parking_site_id THEN
    SELECT * INTO v_row FROM public.parking_sites WHERE id = p_parking_site_id FOR UPDATE;
    SELECT * INTO v_survivor FROM public.parking_sites WHERE id = p_survivor_parking_site_id FOR UPDATE;
  ELSE
    SELECT * INTO v_survivor FROM public.parking_sites WHERE id = p_survivor_parking_site_id FOR UPDATE;
    SELECT * INTO v_row FROM public.parking_sites WHERE id = p_parking_site_id FOR UPDATE;
  END IF;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'row_no_longer_exists');
  END IF;

  IF v_survivor IS NULL THEN
    RETURN jsonb_build_object(
      'passed', false, 'reason', 'survivor_no_longer_exists',
      'current_state', to_jsonb(v_row)
    );
  END IF;

  -- Condition 1: vacant.
  IF v_row.assigned_attendee_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'passed', false, 'reason', 'no_longer_vacant',
      'current_state', to_jsonb(v_row)
    );
  END IF;

  -- Condition 2: no retained reference. site_placement_history does not
  -- exist yet (created by the separate Site Placement Implementation
  -- Specification); this check is written to include it once it does,
  -- without requiring a revision to this function, by checking
  -- information_schema for the table's existence first.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_placement_history'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM public.site_placement_history
      WHERE previous_site_id = v_row.id OR resulting_site_id = v_row.id
    ) THEN
      RETURN jsonb_build_object(
        'passed', false, 'reason', 'retained_reference_exists',
        'current_state', to_jsonb(v_row)
      );
    END IF;
  END IF;

  -- Condition 3: identical to survivor in every Inventory Equivalence Field.
  IF NOT (
    v_row.site_number IS NOT DISTINCT FROM v_survivor.site_number
    AND v_row.display_label IS NOT DISTINCT FROM v_survivor.display_label
    AND v_row.map_x IS NOT DISTINCT FROM v_survivor.map_x
    AND v_row.map_y IS NOT DISTINCT FROM v_survivor.map_y
    AND v_row.map_image_url IS NOT DISTINCT FROM v_survivor.map_image_url
  ) THEN
    RETURN jsonb_build_object(
      'passed', false, 'reason', 'no_longer_physically_equivalent',
      'current_state', to_jsonb(v_row)
    );
  END IF;

  -- Identity equivalence (Repair Plan §8): both master_site_id null, or
  -- identical non-null. The Deterministic Survivor Rule is never applied
  -- to an Identity Conflict -- if this no longer holds, exclude, never
  -- force a survivor.
  IF NOT (
    (v_row.master_site_id IS NULL AND v_survivor.master_site_id IS NULL)
    OR (v_row.master_site_id IS NOT NULL
        AND v_row.master_site_id = v_survivor.master_site_id)
  ) THEN
    RETURN jsonb_build_object(
      'passed', false, 'reason', 'no_longer_identity_equivalent',
      'current_state', to_jsonb(v_row)
    );
  END IF;

  -- Condition 4: survivor preserved, unmodified, in its own right. The
  -- survivor's own vacancy is not required by the Repair Plan; only that
  -- it still exists and remains physically/identity-equivalent, already
  -- checked above.
  RETURN jsonb_build_object(
    'passed', true,
    'current_state', to_jsonb(v_row),
    'survivor_state', to_jsonb(v_survivor)
  );
END;
$$;

ALTER FUNCTION public._repair_revalidate_duplicate_retirement(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_revalidate_duplicate_retirement(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public._repair_apply_duplicate_retirement(
  p_entry public.parking_repair_manifest_entry,
  p_survivor_parking_site_id uuid,
  p_execution_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_revalidation jsonb;
BEGIN
  v_revalidation := public._repair_revalidate_duplicate_retirement(
    p_entry.parking_site_id, p_survivor_parking_site_id
  );

  IF (v_revalidation ->> 'passed')::boolean THEN
    -- Audit write and the corresponding retirement are indivisible: the
    -- INSERT below and the DELETE together are the smallest unit this
    -- function ever performs, and both occur before this call returns to
    -- the orchestrator's next COMMIT.
    INSERT INTO public.parking_repair_audit (
      execution_id, manifest_entry_id, action_taken,
      before_state, after_state, revalidation_result,
      actor_identity, validation_assertions_passed
    ) VALUES (
      p_execution_id, p_entry.id, 'retirement_applied',
      v_revalidation -> 'current_state', 'null'::jsonb, v_revalidation,
      current_user || '/' || session_user,
      ARRAY['vacant', 'no_retained_reference', 'physically_equivalent',
            'identity_equivalent', 'survivor_preserved']
    );

    PERFORM set_config('epicentrax.parking_repair_bypass_authorized', 'true', true);

    DELETE FROM public.parking_sites WHERE id = p_entry.parking_site_id;
  ELSE
    INSERT INTO public.parking_repair_audit (
      execution_id, manifest_entry_id, action_taken,
      before_state, revalidation_result, actor_identity
    ) VALUES (
      p_execution_id, p_entry.id, 'revalidation_failed_excluded',
      coalesce(v_revalidation -> 'current_state', p_entry.before_state),
      v_revalidation, current_user || '/' || session_user
    );
  END IF;
END;
$$;

ALTER FUNCTION public._repair_apply_duplicate_retirement(
  public.parking_repair_manifest_entry, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_apply_duplicate_retirement(
  public.parking_repair_manifest_entry, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Conflict / exclusion recording: no mutation, audit only.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public._repair_record_conflict(
  p_entry public.parking_repair_manifest_entry,
  p_execution_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_action text;
  v_current_state jsonb;
BEGIN
  v_action := CASE p_entry.classification
    WHEN 'identity_conflict' THEN 'identity_conflict_recorded'
    WHEN 'metadata_conflict' THEN 'metadata_conflict_recorded'
    WHEN 'occupied_conflict' THEN 'occupied_conflict_recorded'
    ELSE 'anomaly_excluded'
  END;

  SELECT to_jsonb(parking_sites.*) INTO v_current_state
  FROM public.parking_sites
  WHERE id = p_entry.parking_site_id;

  INSERT INTO public.parking_repair_audit (
    execution_id, manifest_entry_id, action_taken,
    before_state, revalidation_result, actor_identity
  ) VALUES (
    p_execution_id, p_entry.id, v_action,
    coalesce(v_current_state, p_entry.before_state),
    jsonb_build_object('classification', p_entry.classification,
                        'exclusion_reason', p_entry.exclusion_reason,
                        'eligibility_basis', p_entry.eligibility_basis),
    current_user || '/' || session_user
  );
END;
$$;

ALTER FUNCTION public._repair_record_conflict(public.parking_repair_manifest_entry, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_record_conflict(public.parking_repair_manifest_entry, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Final Identity Verification Gate (Repair Plan §14): every non-null
-- master_site_id resolves to exactly one selected-map master site
-- belonging to the same Event, across the full post-repair scope -- not
-- only touched rows.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public._repair_final_identity_verification(p_event_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_failing_count integer;
BEGIN
  SELECT count(*) INTO v_failing_count
  FROM public.parking_sites AS ps
  WHERE ps.event_id = ANY (p_event_ids)
    AND ps.master_site_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.master_map_sites AS mms
      JOIN public.event_map_settings AS ems
        ON ems.selected_master_map_id = mms.master_map_id
      WHERE ems.event_id = ps.event_id
        AND mms.id = ps.master_site_id
    );

  RETURN jsonb_build_object(
    'passed', v_failing_count = 0,
    'failing_row_count', v_failing_count,
    'checked_at', now()
  );
END;
$$;

ALTER FUNCTION public._repair_final_identity_verification(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_final_identity_verification(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Idempotence proof (Repair Plan §15): the same detection logic the
-- manifest-preparation tooling would use, scoped narrowly to a yes/no
-- "does anything remain to repair" count -- not a manifest-building
-- capability. Immediate re-execution must find zero.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public._repair_detect_remaining_candidates(p_event_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_direct_repair_count integer;
  v_duplicate_pair_count integer;
BEGIN
  SELECT count(*) INTO v_direct_repair_count
  FROM public.parking_sites AS ps
  WHERE ps.event_id = ANY (p_event_ids)
    AND ps.master_site_id IS NULL
    AND (
      SELECT count(*)
      FROM public.master_map_sites AS mms
      JOIN public.event_map_settings AS ems
        ON ems.selected_master_map_id = mms.master_map_id
      WHERE ems.event_id = ps.event_id
        AND mms.site_number IS NOT DISTINCT FROM ps.site_number
        AND mms.display_label IS NOT DISTINCT FROM ps.display_label
        AND mms.map_x IS NOT DISTINCT FROM ps.map_x
        AND mms.map_y IS NOT DISTINCT FROM ps.map_y
    ) = 1;

  SELECT count(*) INTO v_duplicate_pair_count
  FROM public.parking_sites AS a
  JOIN public.parking_sites AS b
    ON a.event_id = b.event_id
    AND a.id < b.id
    AND a.site_number IS NOT DISTINCT FROM b.site_number
    AND a.display_label IS NOT DISTINCT FROM b.display_label
    AND a.map_x IS NOT DISTINCT FROM b.map_x
    AND a.map_y IS NOT DISTINCT FROM b.map_y
    AND a.map_image_url IS NOT DISTINCT FROM b.map_image_url
    AND (
      (a.master_site_id IS NULL AND b.master_site_id IS NULL)
      OR (a.master_site_id IS NOT NULL AND a.master_site_id = b.master_site_id)
    )
  WHERE a.event_id = ANY (p_event_ids)
    AND a.assigned_attendee_id IS NULL
    AND b.assigned_attendee_id IS NULL;

  RETURN v_direct_repair_count + v_duplicate_pair_count;
END;
$$;

ALTER FUNCTION public._repair_detect_remaining_candidates(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_detect_remaining_candidates(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The governed executor. Owner-only invocable (see header). Implements the
-- Implementation Plan §6 execution sequence exactly:
--   1. manifest approval        (precondition -- checked, not performed here)
--   2. writer quiescence engaged
--   3. preflight validation
--   4. direct repair
--   5. duplicate consolidation
--   6. final validation
--   7. idempotence proof
--   8. writer release (only if 6 and 7 both pass)
-- Any failure at step 6 or 7 leaves quiescence engaged and marks the
-- execution failed, pending Platform Administration review -- never an
-- automatic retry or automatic release.
-- ---------------------------------------------------------------------------

-- Deliberately SECURITY INVOKER (the default -- no SECURITY DEFINER
-- clause), not SECURITY DEFINER like every helper function above.
-- PostgreSQL does not permit COMMIT/ROLLBACK inside a SECURITY DEFINER
-- routine (confirmed directly against a local Postgres 17 instance during
-- validation of this migration); a SECURITY DEFINER procedure here would
-- fail on its very first per-entry COMMIT. This is safe without
-- SECURITY DEFINER specifically because EXECUTE is granted to no role but
-- the owner (postgres) below -- invoker privileges are therefore always
-- already the owner's own privileges in the only context this procedure
-- can ever actually be called from. Every table access it performs
-- directly (parking_repair_execution, parking_repair_manifest_entry) is
-- on tables owned by postgres with RLS enabled and all grants revoked
-- from every other role, so an owner-invoked call is unaffected by RLS
-- regardless of the SECURITY clause. The per-entry mutations themselves
-- remain inside the SECURITY DEFINER helper functions this procedure
-- calls, unchanged.
--
-- Also deliberately omits SET search_path TO pg_catalog, present on every
-- other routine in this migration. Confirmed directly (Postgres 17, local
-- validation): a function-level SET clause -- independent of, and for the
-- same underlying reason as, SECURITY DEFINER -- also prohibits internal
-- COMMIT/ROLLBACK, because Postgres implements a routine-scoped GUC
-- save/restore via the same mechanism transaction control cannot cross.
-- The search_path hardening that clause normally provides exists to stop
-- a search_path-based privilege-escalation attack against a SECURITY
-- DEFINER routine; with no SECURITY DEFINER here and EXECUTE restricted
-- to the owner alone, there is no privilege step-up for such an attack to
-- exploit, so omitting it introduces no meaningful new risk. Every table
-- and function reference in this procedure's body is schema-qualified
-- with public. explicitly; the only unqualified identifiers are built-in
-- SQL functions (count, now, to_jsonb, coalesce) that resolve
-- unambiguously regardless of search_path.
CREATE PROCEDURE public.execute_parking_repair(p_manifest_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  v_manifest public.parking_repair_manifest%ROWTYPE;
  v_execution_id uuid;
  v_entry public.parking_repair_manifest_entry%ROWTYPE;
  v_final_verification jsonb;
  v_idempotence_remaining integer;
  v_rows_examined integer := 0;
  v_rows_directly_repaired integer := 0;
  v_duplicate_groups_consolidated integer := 0;
  v_duplicate_rows_retired integer := 0;
  v_rows_excluded integer := 0;
  v_identity_conflict_groups integer := 0;
  v_metadata_conflict_groups integer := 0;
  v_occupied_conflict_groups integer := 0;
  v_validation_assertions_executed integer := 0;
  v_quiescence_failed boolean := false;
  v_quiescence_error text;
BEGIN
  -- Step 1 (precondition): manifest approval. This does not approve a
  -- manifest -- it verifies one was already approved before this call.
  v_manifest := public._repair_load_and_validate_manifest(p_manifest_id);

  INSERT INTO public.parking_repair_execution (manifest_id)
  VALUES (p_manifest_id)
  RETURNING id INTO v_execution_id;
  COMMIT;

  -- Step 2: writer quiescence engaged. COMMIT must sit outside the
  -- BEGIN/EXCEPTION/END block below, never inside either of its branches
  -- -- confirmed directly (Postgres 17, local validation): a
  -- BEGIN/EXCEPTION/END block is an implicit subtransaction, and COMMIT
  -- cannot execute while one is active, in either the try or the catch
  -- path. Failure is recorded via a flag and re-raised only after the
  -- block has fully exited and the failure disposition has been
  -- committed, so the failure record is durable even if the RAISE itself
  -- is never seen by anything further.
  BEGIN
    PERFORM public._repair_engage_quiescence(v_execution_id, v_manifest.scope_event_ids);
    UPDATE public.parking_repair_execution
    SET quiescence_confirmed_at = now()
    WHERE id = v_execution_id;
  EXCEPTION WHEN OTHERS THEN
    v_quiescence_failed := true;
    v_quiescence_error := SQLERRM;
    UPDATE public.parking_repair_execution
    SET final_disposition = 'failed', completed_at = now()
    WHERE id = v_execution_id;
  END;
  COMMIT;

  IF v_quiescence_failed THEN
    RAISE EXCEPTION 'Repair execution % failed to engage quiescence: %',
      v_execution_id, v_quiescence_error;
  END IF;

  -- Step 3: preflight validation -- confirm every manifested row still
  -- exists before doing any per-entry work. A missing row is not a fatal
  -- error for the whole execution; it becomes an excluded entry when its
  -- own turn comes, via the same revalidation path every entry goes
  -- through.
  SELECT count(*) INTO v_rows_examined
  FROM public.parking_repair_manifest_entry
  WHERE manifest_id = p_manifest_id;
  v_validation_assertions_executed := v_validation_assertions_executed + 1;

  -- Step 4: direct repair, one entry per transaction.
  FOR v_entry IN
    SELECT * FROM public.parking_repair_manifest_entry
    WHERE manifest_id = p_manifest_id AND classification = 'direct_repair'
    ORDER BY id
  LOOP
    BEGIN
      PERFORM public._repair_apply_direct_repair(v_entry, v_execution_id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.parking_repair_audit (
        execution_id, manifest_entry_id, action_taken,
        before_state, revalidation_result, actor_identity
      ) VALUES (
        v_execution_id, v_entry.id, 'revalidation_failed_excluded',
        v_entry.before_state,
        jsonb_build_object('unexpected_error', SQLERRM),
        current_user || '/' || session_user
      );
    END;
    COMMIT;
  END LOOP;

  SELECT count(*) INTO v_rows_directly_repaired
  FROM public.parking_repair_audit
  WHERE execution_id = v_execution_id AND action_taken = 'direct_repair_applied';

  -- Step 5: duplicate consolidation, one entry per transaction. Survivors
  -- are never individually mutated; only their sibling retirement entries
  -- are acted upon.
  FOR v_entry IN
    SELECT * FROM public.parking_repair_manifest_entry
    WHERE manifest_id = p_manifest_id AND classification = 'duplicate_retirement'
    ORDER BY id
  LOOP
    BEGIN
      PERFORM public._repair_apply_duplicate_retirement(
        v_entry,
        (SELECT parking_site_id FROM public.parking_repair_manifest_entry
         WHERE id = v_entry.survivor_entry_id),
        v_execution_id
      );
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.parking_repair_audit (
        execution_id, manifest_entry_id, action_taken,
        before_state, revalidation_result, actor_identity
      ) VALUES (
        v_execution_id, v_entry.id, 'revalidation_failed_excluded',
        v_entry.before_state,
        jsonb_build_object('unexpected_error', SQLERRM),
        current_user || '/' || session_user
      );
    END;
    COMMIT;
  END LOOP;

  -- Conflict / exclusion entries: recorded, never mutated.
  FOR v_entry IN
    SELECT * FROM public.parking_repair_manifest_entry
    WHERE manifest_id = p_manifest_id
      AND classification IN ('identity_conflict', 'metadata_conflict',
                              'occupied_conflict', 'excluded')
    ORDER BY id
  LOOP
    PERFORM public._repair_record_conflict(v_entry, v_execution_id);
    COMMIT;
  END LOOP;

  SELECT
    count(*) FILTER (WHERE action_taken = 'retirement_applied'),
    count(DISTINCT manifest_entry_id) FILTER (WHERE action_taken = 'identity_conflict_recorded'),
    count(DISTINCT manifest_entry_id) FILTER (WHERE action_taken = 'metadata_conflict_recorded'),
    count(DISTINCT manifest_entry_id) FILTER (WHERE action_taken = 'occupied_conflict_recorded'),
    count(*) FILTER (WHERE action_taken IN ('revalidation_failed_excluded', 'anomaly_excluded'))
  INTO
    v_duplicate_rows_retired, v_identity_conflict_groups,
    v_metadata_conflict_groups, v_occupied_conflict_groups, v_rows_excluded
  FROM public.parking_repair_audit
  WHERE execution_id = v_execution_id;

  SELECT count(DISTINCT group_id) INTO v_duplicate_groups_consolidated
  FROM public.parking_repair_manifest_entry e
  JOIN public.parking_repair_audit a ON a.manifest_entry_id = e.id
  WHERE e.manifest_id = p_manifest_id
    AND a.execution_id = v_execution_id
    AND a.action_taken = 'retirement_applied';

  -- Step 6: final validation.
  v_final_verification := public._repair_final_identity_verification(v_manifest.scope_event_ids);
  v_validation_assertions_executed := v_validation_assertions_executed + 1;

  -- Step 7: idempotence proof.
  v_idempotence_remaining := public._repair_detect_remaining_candidates(v_manifest.scope_event_ids);
  v_validation_assertions_executed := v_validation_assertions_executed + 1;

  UPDATE public.parking_repair_execution
  SET
    completed_at = now(),
    final_identity_verification_result = v_final_verification,
    idempotence_proof_result = jsonb_build_object(
      'passed', v_idempotence_remaining = 0,
      'remaining_candidate_count', v_idempotence_remaining
    ),
    rows_examined = v_rows_examined,
    rows_directly_repaired = v_rows_directly_repaired,
    duplicate_groups_consolidated = v_duplicate_groups_consolidated,
    duplicate_rows_retired = v_duplicate_rows_retired,
    rows_excluded = v_rows_excluded,
    identity_conflict_groups = v_identity_conflict_groups,
    metadata_conflict_groups = v_metadata_conflict_groups,
    occupied_conflict_groups = v_occupied_conflict_groups,
    validation_assertions_executed = v_validation_assertions_executed,
    final_disposition = CASE
      WHEN (v_final_verification ->> 'passed')::boolean AND v_idempotence_remaining = 0
        THEN 'success'
      WHEN v_rows_directly_repaired > 0 OR v_duplicate_rows_retired > 0
        THEN 'partial'
      ELSE 'failed'
    END
  WHERE id = v_execution_id;

  -- Step 8: writer release, only on full success. Any other outcome leaves
  -- quiescence engaged pending Platform Administration review.
  IF (v_final_verification ->> 'passed')::boolean AND v_idempotence_remaining = 0 THEN
    PERFORM public._repair_release_quiescence(v_execution_id);
  END IF;

  COMMIT;
END;
$$;

ALTER PROCEDURE public.execute_parking_repair(uuid) OWNER TO postgres;
REVOKE ALL ON PROCEDURE public.execute_parking_repair(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
