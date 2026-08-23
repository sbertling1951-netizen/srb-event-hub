-- Extends Stage 1.1's get_managed_import_run_recovery to surface the row
-- abandonment overlay Stage 20260822170000 added. Recovery predates that
-- stage and its per-row jsonb never included abandoned_at/
-- abandoned_by_auth_user_id/abandonment_reason_code -- discovered while
-- building the Import Run Lifecycle + History UI hookup: resuming an
-- active run whose row was abandoned in a prior session showed that row's
-- stale pre-abandonment row_state, since abandonment is an overlay that
-- never changes row_state itself. Same-session abandonment already
-- displayed correctly (abandon_import_run_row's own return value carries
-- these columns); only the reload/resume path was affected.
--
-- Strictly additive: same signature, same authority
-- (event.imports.manage, matching the caller's existing recovery
-- privilege), same three keys already present, only three new keys added
-- to each row object. No new RPC, no schema change, no other stage's
-- semantics touched.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_managed_import_run_recovery(p_import_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_run public.import_runs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_id IS NULL THEN RAISE EXCEPTION 'missing_input' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_run FROM public.import_runs WHERE id=p_import_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_run_not_found' USING ERRCODE='22023'; END IF;
  IF NOT public.has_event_task_authority('event.imports.manage',v_run.event_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'run',jsonb_build_object('id',v_run.id,'event_id',v_run.event_id,'import_type',v_run.import_type,'source_filename',v_run.source_filename,'status',v_run.status,'created_at',v_run.created_at,'finalized_at',v_run.finalized_at),
    'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'source_row_number',r.source_row_number,'normalized_candidate',r.normalized_candidate,'validation_state',r.validation_state,'validation_details',r.validation_details,'review_state',r.review_state,'row_state',r.row_state,'commit_state',r.commit_state,'canonical_target_id',r.canonical_target_id,'commit_result',r.commit_result,'commit_error',r.commit_error,'created_at',r.created_at,'updated_at',r.updated_at,'committed_at',r.committed_at,'abandoned_at',r.abandoned_at,'abandoned_by_auth_user_id',r.abandoned_by_auth_user_id,'abandonment_reason_code',r.abandonment_reason_code) ORDER BY r.source_row_number) FROM public.import_run_rows r WHERE r.import_run_id=v_run.id),'[]'::jsonb)
  );
END;
$$;

ALTER FUNCTION public.get_managed_import_run_recovery(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_managed_import_run_recovery(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_managed_import_run_recovery(uuid) TO authenticated;
COMMIT;
