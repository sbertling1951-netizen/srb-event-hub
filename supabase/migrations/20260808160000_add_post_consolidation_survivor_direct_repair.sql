-- Accepted Repair Plan §10.1: conditional Post-Consolidation Survivor Direct
-- Repair. This is additive support only; it does not change candidate
-- classification, ordinary Direct Repair proof/mutation helpers, duplicate
-- retirement revalidation, detector behavior, or quiescence.

ALTER TABLE public.parking_repair_manifest_entry
  ADD COLUMN post_consolidation_action text;

ALTER TABLE public.parking_repair_manifest_entry
  ADD CONSTRAINT parking_repair_manifest_entry_post_consolidation_action_check
  CHECK (
    post_consolidation_action IS NULL
    OR (classification = 'duplicate_survivor'
        AND post_consolidation_action = 'direct_repair')
  );

COMMENT ON COLUMN public.parking_repair_manifest_entry.post_consolidation_action IS
  'Explicitly approved, conditional post-consolidation action for a Duplicate Survivor. It is not a second classification and never stores a target master_site_id.';

-- The existing action enum is retained unchanged; this one additive audit
-- value records the required fail-closed non-attempt when sibling retirement
-- success is not proven.
ALTER TABLE public.parking_repair_audit
  DROP CONSTRAINT parking_repair_audit_action_taken_check;

ALTER TABLE public.parking_repair_audit
  ADD CONSTRAINT parking_repair_audit_action_taken_check CHECK (action_taken IN (
    'direct_repair_applied',
    'retirement_applied',
    'revalidation_failed_excluded',
    'post_consolidation_not_attempted',
    'identity_conflict_recorded',
    'metadata_conflict_recorded',
    'occupied_conflict_recorded',
    'anomaly_excluded'
  ));

-- Reuses the ordinary Direct Repair helper unchanged after proving every
-- approved sibling retirement completed in this execution. A failed proof is
-- an auditable non-attempt, never a fallback mutation.
CREATE FUNCTION public._repair_apply_post_consolidation_survivor(
  p_entry public.parking_repair_manifest_entry,
  p_execution_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_expected_siblings integer;
  v_retired_siblings integer;
  v_current_state jsonb;
BEGIN
  IF p_entry.classification <> 'duplicate_survivor'
     OR p_entry.post_consolidation_action <> 'direct_repair' THEN
    RAISE EXCEPTION 'Post-consolidation action is invalid for manifest entry %.', p_entry.id;
  END IF;

  SELECT count(*) INTO v_expected_siblings
  FROM public.parking_repair_manifest_entry sibling
  WHERE sibling.manifest_id = p_entry.manifest_id
    AND sibling.group_id IS NOT DISTINCT FROM p_entry.group_id
    AND sibling.classification = 'duplicate_retirement';

  SELECT count(DISTINCT sibling.id) INTO v_retired_siblings
  FROM public.parking_repair_manifest_entry sibling
  JOIN public.parking_repair_audit audit
    ON audit.manifest_entry_id = sibling.id
   AND audit.execution_id = p_execution_id
   AND audit.action_taken = 'retirement_applied'
  WHERE sibling.manifest_id = p_entry.manifest_id
    AND sibling.group_id IS NOT DISTINCT FROM p_entry.group_id
    AND sibling.classification = 'duplicate_retirement';

  IF v_expected_siblings = 0 OR v_retired_siblings <> v_expected_siblings THEN
    SELECT to_jsonb(ps) INTO v_current_state
    FROM public.parking_sites ps WHERE ps.id = p_entry.parking_site_id;

    INSERT INTO public.parking_repair_audit (
      execution_id, manifest_entry_id, action_taken, before_state,
      revalidation_result, actor_identity
    ) VALUES (
      p_execution_id, p_entry.id, 'post_consolidation_not_attempted',
      coalesce(v_current_state, p_entry.before_state),
      jsonb_build_object(
        'passed', false,
        'reason', 'sibling_retirements_not_all_applied',
        'expected_sibling_retirements', v_expected_siblings,
        'retirement_applied_siblings', v_retired_siblings
      ),
      current_user || '/' || session_user
    );
    RETURN;
  END IF;

  -- This performs the existing _repair_revalidate_direct_repair proof and,
  -- on success, the existing governed mutation/audit path unchanged.
  PERFORM public._repair_apply_direct_repair(p_entry, p_execution_id);
END;
$$;

ALTER FUNCTION public._repair_apply_post_consolidation_survivor(
  public.parking_repair_manifest_entry, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_apply_post_consolidation_survivor(
  public.parking_repair_manifest_entry, uuid
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._repair_apply_post_consolidation_survivor(
  public.parking_repair_manifest_entry, uuid
) IS
  'Repair Plan §10.1 fail-closed survivor follow-up. It requires all approved sibling retirements to audit retirement_applied, then delegates unchanged Direct Repair proof and mutation.';

-- Existing executor with one step inserted after duplicate consolidation. The
-- metric aggregation deliberately follows this new step so its successful
-- direct_repair_applied audit rows are counted.
CREATE OR REPLACE PROCEDURE public.execute_parking_repair(p_manifest_id uuid)
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
  v_manifest := public._repair_load_and_validate_manifest(p_manifest_id);

  INSERT INTO public.parking_repair_execution (manifest_id)
  VALUES (p_manifest_id) RETURNING id INTO v_execution_id;
  COMMIT;

  BEGIN
    PERFORM public._repair_engage_quiescence(v_execution_id, v_manifest.scope_event_ids);
    UPDATE public.parking_repair_execution
    SET quiescence_confirmed_at = now() WHERE id = v_execution_id;
  EXCEPTION WHEN OTHERS THEN
    v_quiescence_failed := true;
    v_quiescence_error := SQLERRM;
    UPDATE public.parking_repair_execution
    SET final_disposition = 'failed', completed_at = now() WHERE id = v_execution_id;
  END;
  COMMIT;

  IF v_quiescence_failed THEN
    RAISE EXCEPTION 'Repair execution % failed to engage quiescence: %',
      v_execution_id, v_quiescence_error;
  END IF;

  SELECT count(*) INTO v_rows_examined
  FROM public.parking_repair_manifest_entry WHERE manifest_id = p_manifest_id;
  v_validation_assertions_executed := v_validation_assertions_executed + 1;

  -- Ordinary Direct Repair.
  FOR v_entry IN
    SELECT * FROM public.parking_repair_manifest_entry
    WHERE manifest_id = p_manifest_id AND classification = 'direct_repair'
    ORDER BY id
  LOOP
    BEGIN
      PERFORM public._repair_apply_direct_repair(v_entry, v_execution_id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.parking_repair_audit (
        execution_id, manifest_entry_id, action_taken, before_state,
        revalidation_result, actor_identity
      ) VALUES (
        v_execution_id, v_entry.id, 'revalidation_failed_excluded',
        v_entry.before_state, jsonb_build_object('unexpected_error', SQLERRM),
        current_user || '/' || session_user
      );
    END;
    COMMIT;
  END LOOP;

  -- Duplicate consolidation.
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
        execution_id, manifest_entry_id, action_taken, before_state,
        revalidation_result, actor_identity
      ) VALUES (
        v_execution_id, v_entry.id, 'revalidation_failed_excluded',
        v_entry.before_state, jsonb_build_object('unexpected_error', SQLERRM),
        current_user || '/' || session_user
      );
    END;
    COMMIT;
  END LOOP;

  -- Post-Consolidation Survivor Direct Repair: only explicitly authorized
  -- survivors, only after every approved sibling retirement is proven.
  FOR v_entry IN
    SELECT * FROM public.parking_repair_manifest_entry
    WHERE manifest_id = p_manifest_id
      AND classification = 'duplicate_survivor'
      AND post_consolidation_action = 'direct_repair'
    ORDER BY id
  LOOP
    BEGIN
      PERFORM public._repair_apply_post_consolidation_survivor(v_entry, v_execution_id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.parking_repair_audit (
        execution_id, manifest_entry_id, action_taken, before_state,
        revalidation_result, actor_identity
      ) VALUES (
        v_execution_id, v_entry.id, 'post_consolidation_not_attempted',
        v_entry.before_state, jsonb_build_object('unexpected_error', SQLERRM),
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

  -- Aggregation follows post-consolidation processing so successful survivor
  -- fills are included in rows_directly_repaired.
  SELECT
    count(*) FILTER (WHERE action_taken = 'direct_repair_applied'),
    count(*) FILTER (WHERE action_taken = 'retirement_applied'),
    count(DISTINCT manifest_entry_id) FILTER (WHERE action_taken = 'identity_conflict_recorded'),
    count(DISTINCT manifest_entry_id) FILTER (WHERE action_taken = 'metadata_conflict_recorded'),
    count(DISTINCT manifest_entry_id) FILTER (WHERE action_taken = 'occupied_conflict_recorded'),
    count(*) FILTER (WHERE action_taken IN ('revalidation_failed_excluded',
                                              'post_consolidation_not_attempted',
                                              'anomaly_excluded'))
  INTO
    v_rows_directly_repaired, v_duplicate_rows_retired,
    v_identity_conflict_groups, v_metadata_conflict_groups,
    v_occupied_conflict_groups, v_rows_excluded
  FROM public.parking_repair_audit
  WHERE execution_id = v_execution_id;

  SELECT count(DISTINCT group_id) INTO v_duplicate_groups_consolidated
  FROM public.parking_repair_manifest_entry e
  JOIN public.parking_repair_audit a ON a.manifest_entry_id = e.id
  WHERE e.manifest_id = p_manifest_id AND a.execution_id = v_execution_id
    AND a.action_taken = 'retirement_applied';

  v_final_verification := public._repair_final_identity_verification(v_manifest.scope_event_ids);
  v_validation_assertions_executed := v_validation_assertions_executed + 1;
  v_idempotence_remaining := public._repair_detect_remaining_candidates(v_manifest.scope_event_ids);
  v_validation_assertions_executed := v_validation_assertions_executed + 1;

  UPDATE public.parking_repair_execution
  SET completed_at = now(),
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
        WHEN (v_final_verification ->> 'passed')::boolean
             AND v_idempotence_remaining = 0 THEN 'success'
        WHEN v_rows_directly_repaired > 0 OR v_duplicate_rows_retired > 0 THEN 'partial'
        ELSE 'failed'
      END
  WHERE id = v_execution_id;

  IF (v_final_verification ->> 'passed')::boolean AND v_idempotence_remaining = 0 THEN
    PERFORM public._repair_release_quiescence(v_execution_id);
  END IF;
  COMMIT;
END;
$$;

ALTER PROCEDURE public.execute_parking_repair(uuid) OWNER TO postgres;
REVOKE ALL ON PROCEDURE public.execute_parking_repair(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
