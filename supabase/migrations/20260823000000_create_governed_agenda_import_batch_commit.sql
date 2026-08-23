-- Agenda Governed Imports Stage B: compose the generic governed import-run
-- lifecycle with the existing atomic/version-fenced Agenda batch writer.
-- The generic staging and lifecycle RPCs remain authoritative for source
-- evidence, validation, abandonment, finalization, recovery, and History.
-- This migration adds only the Agenda-specific canonical commit boundary and
-- its bounded failure recorder.
BEGIN;

CREATE OR REPLACE FUNCTION public.commit_agenda_import_run(p_import_run_id uuid)
RETURNS TABLE(outcome text, import_run_id uuid, imported_count integer, new_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_run public.import_runs%ROWTYPE;
  v_expected_row_count integer;
  v_expected_version integer;
  v_staged_count integer;
  v_eligible_count integer;
  v_committed_count integer;
  v_updated_count integer;
  v_rows jsonb;
  v_imported integer;
  v_new_version integer;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_id IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run
  FROM public.import_runs
  WHERE id = p_import_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'import_run_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_run.import_type <> 'agenda' THEN
    RAISE EXCEPTION 'import_run_not_agenda' USING ERRCODE = '22023';
  END IF;
  IF v_run.status NOT IN ('staging', 'ready_for_review') THEN
    RAISE EXCEPTION 'import_run_not_committable' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_event_task_authority('event.imports.manage', v_run.event_id)
    OR NOT public.has_event_task_authority('event.agenda.manage', v_run.event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_run.event_id);

  IF jsonb_typeof(v_run.source_metadata -> 'row_count') <> 'number'
    OR (v_run.source_metadata ->> 'row_count') !~ '^[0-9]+$'
    OR (v_run.source_metadata ->> 'row_count')::numeric > 2147483647 THEN
    RAISE EXCEPTION 'agenda_import_run_invalid_source_metadata' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_run.source_metadata -> 'expected_agenda_version') <> 'number'
    OR (v_run.source_metadata ->> 'expected_agenda_version') !~ '^[0-9]+$'
    OR (v_run.source_metadata ->> 'expected_agenda_version')::numeric > 2147483647 THEN
    RAISE EXCEPTION 'agenda_import_run_invalid_source_metadata' USING ERRCODE = '22023';
  END IF;

  v_expected_row_count := (v_run.source_metadata ->> 'row_count')::integer;
  v_expected_version := (v_run.source_metadata ->> 'expected_agenda_version')::integer;

  SELECT count(*) INTO v_staged_count
  FROM public.import_run_rows
  WHERE import_run_rows.import_run_id = v_run.id;

  IF v_staged_count <> v_expected_row_count THEN
    RAISE EXCEPTION 'agenda_import_run_staging_incomplete' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.import_run_rows AS r
    WHERE r.import_run_id = v_run.id
      AND r.abandoned_at IS NULL
      AND r.row_state NOT IN ('validation_failed', 'approved', 'committed', 'commit_failed')
  ) THEN
    RAISE EXCEPTION 'agenda_import_run_has_unresolved_rows' USING ERRCODE = '22023';
  END IF;

  SELECT
    count(*) FILTER (
      WHERE r.abandoned_at IS NULL AND r.row_state IN ('approved', 'commit_failed')
    ),
    count(*) FILTER (
      WHERE r.abandoned_at IS NULL AND r.row_state = 'committed'
    )
  INTO v_eligible_count, v_committed_count
  FROM public.import_run_rows AS r
  WHERE r.import_run_id = v_run.id;

  IF v_committed_count > 0 AND v_eligible_count > 0 THEN
    RAISE EXCEPTION 'agenda_import_partial_commit_state' USING ERRCODE = '22023';
  END IF;

  IF v_eligible_count = 0 THEN
    IF v_committed_count > 0 THEN
      SELECT s.version INTO v_new_version
      FROM public.event_agenda_state AS s
      WHERE s.event_id = v_run.event_id;

      RETURN QUERY
      SELECT 'already_committed'::text, v_run.id, v_committed_count, v_new_version;
      RETURN;
    END IF;

    RETURN QUERY
    SELECT 'no_eligible_rows'::text, v_run.id, 0, v_expected_version;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.import_run_rows AS r
    WHERE r.import_run_id = v_run.id
      AND r.abandoned_at IS NULL
      AND r.row_state IN ('approved', 'commit_failed')
      AND (
        jsonb_typeof(r.normalized_candidate) <> 'object'
        OR (r.normalized_candidate ->> 'source_row_number') !~ '^[0-9]+$'
        OR (r.normalized_candidate ->> 'source_row_number')::numeric <> r.source_row_number
        OR nullif(btrim(r.normalized_candidate ->> 'title'), '') IS NULL
        OR nullif(btrim(r.normalized_candidate ->> 'agenda_date'), '') IS NULL
        OR nullif(btrim(r.normalized_candidate ->> 'start_time'), '') IS NULL
        OR nullif(btrim(r.normalized_candidate ->> 'external_id'), '') IS NULL
        OR jsonb_typeof(r.normalized_candidate -> 'is_published') <> 'boolean'
      )
  ) THEN
    RAISE EXCEPTION 'staged_agenda_candidate_malformed' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT r.normalized_candidate ->> 'external_id'
    FROM public.import_run_rows AS r
    WHERE r.import_run_id = v_run.id
      AND r.abandoned_at IS NULL
      AND r.row_state IN ('approved', 'commit_failed')
    GROUP BY r.normalized_candidate ->> 'external_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_agenda_external_id_in_commit_batch' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(r.normalized_candidate ORDER BY r.source_row_number)
  INTO v_rows
  FROM public.import_run_rows AS r
  WHERE r.import_run_id = v_run.id
    AND r.abandoned_at IS NULL
    AND r.row_state IN ('approved', 'commit_failed');

  -- This is a normal nested PostgreSQL function call, so the proven Agenda
  -- batch writer, version advance, Agenda ledger write, and the staging
  -- result updates below are one transaction. Any later exception rolls all
  -- of them back together.
  SELECT committed.imported_count, committed.new_version
  INTO v_imported, v_new_version
  FROM public.import_event_agenda_items(
    v_run.event_id,
    v_expected_version,
    v_rows
  ) AS committed;

  WITH targets AS (
    SELECT r.id AS row_id, r.source_fingerprint, ai.id AS agenda_item_id
    FROM public.import_run_rows AS r
    JOIN public.agenda_items AS ai
      ON ai.event_id = v_run.event_id
     AND ai.external_id = r.normalized_candidate ->> 'external_id'
    WHERE r.import_run_id = v_run.id
      AND r.abandoned_at IS NULL
      AND r.row_state IN ('approved', 'commit_failed')
  )
  UPDATE public.import_run_rows AS r
  SET row_state = 'committed',
      commit_state = 'committed',
      canonical_target_id = targets.agenda_item_id,
      commit_result = jsonb_build_object(
        'agenda_item_id', targets.agenda_item_id,
        'source_row_fingerprint', targets.source_fingerprint,
        'agenda_version', v_new_version,
        'batch_row_count', v_imported
      ),
      commit_error = NULL,
      committed_at = now(),
      updated_at = now()
  FROM targets
  WHERE r.id = targets.row_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> v_eligible_count OR v_imported <> v_eligible_count THEN
    RAISE EXCEPTION 'agenda_import_commit_result_mismatch';
  END IF;

  RETURN QUERY
  SELECT 'committed'::text, v_run.id, v_imported, v_new_version;
END;
$$;

ALTER FUNCTION public.commit_agenda_import_run(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commit_agenda_import_run(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.commit_agenda_import_run(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_agenda_import_run_commit_failure(
  p_import_run_id uuid,
  p_failure_code text
)
RETURNS TABLE(recorded_count bigint, failure_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_run public.import_runs%ROWTYPE;
  v_message text;
  v_recorded bigint;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_id IS NULL OR p_failure_code IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run
  FROM public.import_runs
  WHERE id = p_import_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'import_run_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_run.import_type <> 'agenda' THEN
    RAISE EXCEPTION 'import_run_not_agenda' USING ERRCODE = '22023';
  END IF;
  IF v_run.status NOT IN ('staging', 'ready_for_review') THEN
    RAISE EXCEPTION 'import_run_not_committable' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_event_task_authority('event.imports.manage', v_run.event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_run.event_id);

  v_message := CASE p_failure_code
    WHEN 'agenda_commit_failed' THEN
      'The Agenda batch commit did not complete. Retry after correcting the underlying issue.'
    WHEN 'agenda_commit_denied' THEN
      'The Agenda batch commit was denied by a governed authority or lifecycle check.'
    WHEN 'agenda_commit_conflict' THEN
      'The Agenda batch commit encountered a governed data conflict.'
    WHEN 'agenda_commit_unavailable' THEN
      'The Agenda batch commit could not be completed. Retry later.'
    WHEN 'agenda_commit_stale_version' THEN
      'The Event Agenda changed after this import run was staged. Abandon this run and start a new import.'
    ELSE NULL
  END;

  IF v_message IS NULL THEN
    RAISE EXCEPTION 'invalid_failure_code' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.import_run_rows AS r
    WHERE r.import_run_id = v_run.id
      AND r.abandoned_at IS NULL
      AND r.row_state = 'committed'
  ) THEN
    RAISE EXCEPTION 'agenda_import_run_already_committed' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.import_run_rows AS r
    WHERE r.import_run_id = v_run.id
      AND r.abandoned_at IS NULL
      AND r.row_state = 'commit_failed'
      AND r.commit_error ->> 'code' <> p_failure_code
  ) THEN
    RAISE EXCEPTION 'commit_failure_already_recorded' USING ERRCODE = '22023';
  END IF;

  UPDATE public.import_run_rows AS r
  SET row_state = 'commit_failed',
      commit_state = 'failed',
      commit_error = jsonb_build_object('code', p_failure_code, 'message', v_message),
      updated_at = now()
  WHERE r.import_run_id = v_run.id
    AND r.abandoned_at IS NULL
    AND r.row_state = 'approved';

  GET DIAGNOSTICS v_recorded = ROW_COUNT;

  IF v_recorded = 0 AND NOT EXISTS (
    SELECT 1
    FROM public.import_run_rows AS r
    WHERE r.import_run_id = v_run.id
      AND r.abandoned_at IS NULL
      AND r.row_state = 'commit_failed'
      AND r.commit_error ->> 'code' = p_failure_code
  ) THEN
    RAISE EXCEPTION 'agenda_import_run_has_no_eligible_rows' USING ERRCODE = '22023';
  END IF;

  IF v_recorded = 0 THEN
    SELECT count(*) INTO v_recorded
    FROM public.import_run_rows AS r
    WHERE r.import_run_id = v_run.id
      AND r.abandoned_at IS NULL
      AND r.row_state = 'commit_failed'
      AND r.commit_error ->> 'code' = p_failure_code;
  END IF;

  RETURN QUERY SELECT v_recorded, p_failure_code;
END;
$$;

ALTER FUNCTION public.record_agenda_import_run_commit_failure(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_agenda_import_run_commit_failure(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_agenda_import_run_commit_failure(uuid, text) TO authenticated;

-- The proven canonical batch writer remains present for internal
-- composition, but authenticated browsers can no longer call it directly.
-- commit_agenda_import_run is the sole authenticated Agenda import commit
-- surface after this migration.
REVOKE ALL ON FUNCTION public.import_event_agenda_items(uuid, integer, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
