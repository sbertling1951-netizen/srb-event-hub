-- Stage 3.1: Imports-owned, post-rollback failure outcome recording.
-- This function never touches attendee-domain tables. It only records the
-- latest canonical-commit outcome after a separate Stage 3 transaction fails.
BEGIN;

CREATE OR REPLACE FUNCTION public.record_attendee_import_run_row_commit_failure(
  p_import_run_row_id uuid,
  p_failure_code text
)
RETURNS public.import_run_rows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_row public.import_run_rows%ROWTYPE;
  v_run public.import_runs%ROWTYPE;
  v_message text;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_row_id IS NULL OR p_failure_code IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.import_run_rows
  WHERE id = p_import_run_row_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_row_not_found' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_run
  FROM public.import_runs
  WHERE id = v_row.import_run_id
  FOR UPDATE;

  IF v_run.import_type <> 'attendee_roster' THEN
    RAISE EXCEPTION 'import_row_not_attendee_roster' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_event_task_authority('event.imports.manage', v_row.event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_run.status NOT IN ('staging', 'ready_for_review') THEN
    RAISE EXCEPTION 'import_run_not_committable' USING ERRCODE = '22023';
  END IF;
  PERFORM public.assert_event_lifecycle_mutable(v_row.event_id);

  v_message := CASE p_failure_code
    WHEN 'canonical_commit_failed' THEN 'The attendee commit did not complete. Retry after correcting the underlying issue.'
    WHEN 'canonical_commit_denied' THEN 'The attendee commit was denied by a governed authority or lifecycle check.'
    WHEN 'canonical_commit_conflict' THEN 'The attendee commit encountered a governed data conflict.'
    WHEN 'canonical_commit_unavailable' THEN 'The attendee commit could not be completed. Retry later.'
    ELSE NULL
  END;
  IF v_message IS NULL THEN RAISE EXCEPTION 'invalid_failure_code' USING ERRCODE = '22023'; END IF;

  IF v_row.row_state = 'commit_failed' THEN
    IF v_row.commit_error ->> 'code' = p_failure_code THEN
      RETURN v_row;
    END IF;
    RAISE EXCEPTION 'commit_failure_already_recorded' USING ERRCODE = '22023';
  END IF;
  IF v_row.row_state <> 'approved' THEN
    RAISE EXCEPTION 'import_row_not_approved' USING ERRCODE = '22023';
  END IF;

  UPDATE public.import_run_rows
  SET row_state = 'commit_failed',
      commit_state = 'failed',
      commit_error = jsonb_build_object('code', p_failure_code, 'message', v_message),
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

ALTER FUNCTION public.record_attendee_import_run_row_commit_failure(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_attendee_import_run_row_commit_failure(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_attendee_import_run_row_commit_failure(uuid, text) TO authenticated;

COMMIT;
