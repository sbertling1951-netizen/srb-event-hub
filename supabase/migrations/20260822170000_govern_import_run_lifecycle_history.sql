-- Governed Imports lifecycle, abandonment, finalization, and safe History.
-- This is prospective: already-finalized runs remain historical evidence.
BEGIN;

ALTER TABLE public.import_runs
  ADD COLUMN finalized_by_auth_user_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT import_runs_finalizer_only_when_finalized
    CHECK (finalized_by_auth_user_id IS NULL OR status = 'finalized');

ALTER TABLE public.import_run_rows
  ADD COLUMN abandoned_at timestamptz NULL,
  ADD COLUMN abandoned_by_auth_user_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN abandonment_reason_code text NULL,
  ADD CONSTRAINT import_run_rows_abandonment_reason_check CHECK (
    abandonment_reason_code IS NULL OR abandonment_reason_code IN (
      'operator_declined', 'source_superseded', 'duplicate_intentionally_dismissed', 'cannot_resolve', 'other'
    )
  ),
  ADD CONSTRAINT import_run_rows_abandonment_evidence_check CHECK (
    (abandoned_at IS NULL AND abandoned_by_auth_user_id IS NULL AND abandonment_reason_code IS NULL)
    OR
    (abandoned_at IS NOT NULL AND abandoned_by_auth_user_id IS NOT NULL AND abandonment_reason_code IS NOT NULL)
  ),
  ADD CONSTRAINT import_run_rows_abandonment_open_row_check CHECK (
    abandoned_at IS NULL OR row_state NOT IN ('committed', 'validation_failed')
  );

CREATE INDEX import_runs_event_finalized_history_idx
  ON public.import_runs (event_id, finalized_at DESC, id DESC)
  WHERE status = 'finalized';

CREATE OR REPLACE FUNCTION public.prevent_import_run_row_source_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF NEW.import_run_id IS DISTINCT FROM OLD.import_run_id
    OR NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.source_row_number IS DISTINCT FROM OLD.source_row_number
    OR NEW.source_payload IS DISTINCT FROM OLD.source_payload
    OR NEW.normalized_candidate IS DISTINCT FROM OLD.normalized_candidate
    OR NEW.source_fingerprint IS DISTINCT FROM OLD.source_fingerprint
    OR NEW.commit_idempotency_key IS DISTINCT FROM OLD.commit_idempotency_key
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'import row source evidence is immutable';
  END IF;

  -- An abandonment is terminal evidence.  It may be recorded once, but no
  -- later operation may rewrite its reason, actor, time, or prior lifecycle.
  IF OLD.abandoned_at IS NOT NULL AND (
    NEW.abandoned_at IS DISTINCT FROM OLD.abandoned_at
    OR NEW.abandoned_by_auth_user_id IS DISTINCT FROM OLD.abandoned_by_auth_user_id
    OR NEW.abandonment_reason_code IS DISTINCT FROM OLD.abandonment_reason_code
    OR NEW.validation_state IS DISTINCT FROM OLD.validation_state
    OR NEW.validation_details IS DISTINCT FROM OLD.validation_details
    OR NEW.review_state IS DISTINCT FROM OLD.review_state
    OR NEW.row_state IS DISTINCT FROM OLD.row_state
    OR NEW.canonical_target_id IS DISTINCT FROM OLD.canonical_target_id
    OR NEW.commit_state IS DISTINCT FROM OLD.commit_state
    OR NEW.commit_result IS DISTINCT FROM OLD.commit_result
    OR NEW.commit_error IS DISTINCT FROM OLD.commit_error
    OR NEW.committed_at IS DISTINCT FROM OLD.committed_at
  ) THEN
    RAISE EXCEPTION 'abandoned import row is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_run_final_outcome(p_import_run_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_total bigint;
  v_committed bigint;
  v_validation_failed bigint;
  v_abandoned bigint;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE row_state = 'committed'),
         count(*) FILTER (WHERE row_state = 'validation_failed'),
         count(*) FILTER (WHERE abandoned_at IS NOT NULL)
  INTO v_total, v_committed, v_validation_failed, v_abandoned
  FROM public.import_run_rows
  WHERE import_run_id = p_import_run_id;

  IF v_abandoned = 0 AND v_validation_failed = 0 AND v_committed = v_total THEN
    RETURN 'completed';
  ELSIF v_abandoned = 0 AND v_validation_failed > 0 THEN
    RETURN 'completed_with_errors';
  ELSIF v_committed = 0 AND v_abandoned > 0 THEN
    RETURN 'abandoned';
  ELSE
    RETURN 'mixed';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_import_run_staging(p_import_run_id uuid)
RETURNS public.import_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_run public.import_runs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_id IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM public.import_runs WHERE id = p_import_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status = 'finalized' THEN
    RAISE EXCEPTION 'import_run_not_closable' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_event_task_authority('event.imports.manage', v_run.event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_event_lifecycle_mutable(v_run.event_id);
  IF v_run.status = 'ready_for_review' THEN RETURN v_run; END IF;
  UPDATE public.import_runs
  SET status = 'ready_for_review'
  WHERE id = v_run.id
  RETURNING * INTO v_run;
  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_import_run_row_review_state(
  p_import_run_row_id uuid,
  p_validation_state text,
  p_validation_details jsonb DEFAULT '[]'::jsonb,
  p_review_state text DEFAULT 'unreviewed'
)
RETURNS public.import_run_rows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_row public.import_run_rows%ROWTYPE; v_next_state text;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_row_id IS NULL OR p_validation_state IS NULL OR p_review_state IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;
  SELECT r.* INTO v_row
  FROM public.import_run_rows r
  JOIN public.import_runs run ON run.id = r.import_run_id
  WHERE r.id = p_import_run_row_id AND run.status IN ('staging', 'ready_for_review')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_row_not_mutable' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_event_task_authority('event.imports.manage', v_row.event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_event_lifecycle_mutable(v_row.event_id);
  IF v_row.abandoned_at IS NOT NULL OR v_row.row_state IN ('committed', 'validation_failed', 'commit_failed') THEN
    RAISE EXCEPTION 'import_row_terminal_or_retry_owned' USING ERRCODE = '22023';
  END IF;
  IF p_validation_state = 'invalid' AND p_review_state = 'unreviewed' AND v_row.row_state = 'parsed' THEN
    v_next_state := 'validation_failed';
  ELSIF p_validation_state = 'valid' AND p_review_state = 'needs_review'
    AND v_row.row_state IN ('parsed', 'needs_review', 'approved') THEN
    v_next_state := 'needs_review';
  ELSIF p_validation_state = 'valid' AND p_review_state = 'approved'
    AND v_row.row_state IN ('parsed', 'needs_review', 'approved') THEN
    v_next_state := 'approved';
  ELSE
    RAISE EXCEPTION 'invalid_import_row_state_transition' USING ERRCODE = '22023';
  END IF;
  UPDATE public.import_run_rows
  SET validation_state = p_validation_state,
      validation_details = coalesce(p_validation_details, '[]'::jsonb),
      review_state = p_review_state,
      row_state = v_next_state,
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.abandon_import_run_row(
  p_import_run_row_id uuid,
  p_abandonment_reason_code text
)
RETURNS public.import_run_rows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_row public.import_run_rows%ROWTYPE; v_run public.import_runs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_row_id IS NULL OR p_abandonment_reason_code IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.import_run_rows WHERE id = p_import_run_row_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_row_not_found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_run FROM public.import_runs WHERE id = v_row.import_run_id FOR UPDATE;
  IF v_run.status = 'finalized' THEN RAISE EXCEPTION 'import_run_not_mutable' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_event_task_authority('event.imports.manage', v_row.event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_event_lifecycle_mutable(v_row.event_id);
  IF p_abandonment_reason_code NOT IN ('operator_declined', 'source_superseded', 'duplicate_intentionally_dismissed', 'cannot_resolve', 'other') THEN
    RAISE EXCEPTION 'invalid_abandonment_reason_code' USING ERRCODE = '22023';
  END IF;
  IF v_row.abandoned_at IS NOT NULL THEN
    IF v_row.abandonment_reason_code = p_abandonment_reason_code THEN RETURN v_row; END IF;
    RAISE EXCEPTION 'import_row_already_abandoned' USING ERRCODE = '22023';
  END IF;
  IF v_row.row_state IN ('committed', 'validation_failed') THEN
    RAISE EXCEPTION 'import_row_terminal' USING ERRCODE = '22023';
  END IF;
  UPDATE public.import_run_rows
  SET abandoned_at = now(),
      abandoned_by_auth_user_id = auth.uid(),
      abandonment_reason_code = p_abandonment_reason_code,
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.abandon_import_run_open_rows(
  p_import_run_id uuid,
  p_abandonment_reason_code text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_run public.import_runs%ROWTYPE; v_count bigint;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_id IS NULL OR p_abandonment_reason_code IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM public.import_runs WHERE id = p_import_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status = 'finalized' THEN RAISE EXCEPTION 'import_run_not_mutable' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_event_task_authority('event.imports.manage', v_run.event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_event_lifecycle_mutable(v_run.event_id);
  IF p_abandonment_reason_code NOT IN ('operator_declined', 'source_superseded', 'duplicate_intentionally_dismissed', 'cannot_resolve', 'other') THEN
    RAISE EXCEPTION 'invalid_abandonment_reason_code' USING ERRCODE = '22023';
  END IF;
  UPDATE public.import_run_rows
  SET abandoned_at = now(),
      abandoned_by_auth_user_id = auth.uid(),
      abandonment_reason_code = p_abandonment_reason_code,
      updated_at = now()
  WHERE import_run_id = v_run.id
    AND abandoned_at IS NULL
    AND row_state NOT IN ('committed', 'validation_failed');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_import_run(p_import_run_id uuid)
RETURNS public.import_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_run public.import_runs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_id IS NULL THEN RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_run FROM public.import_runs WHERE id = p_import_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_run_not_finalizable' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_event_task_authority('event.imports.manage', v_run.event_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF v_run.status = 'finalized' THEN RETURN v_run; END IF;
  IF v_run.status <> 'ready_for_review' THEN RAISE EXCEPTION 'import_run_not_ready_for_review' USING ERRCODE = '22023'; END IF;
  PERFORM public.assert_event_lifecycle_mutable(v_run.event_id);
  IF EXISTS (
    SELECT 1 FROM public.import_run_rows
    WHERE import_run_id = v_run.id
      AND abandoned_at IS NULL
      AND row_state NOT IN ('committed', 'validation_failed')
  ) THEN
    RAISE EXCEPTION 'import_run_has_open_rows' USING ERRCODE = '22023';
  END IF;
  UPDATE public.import_runs
  SET status = 'finalized', finalized_at = now(), finalized_by_auth_user_id = auth.uid()
  WHERE id = v_run.id
  RETURNING * INTO v_run;
  RETURN v_run;
END;
$$;

DROP FUNCTION IF EXISTS public.get_import_run_status(uuid);
CREATE FUNCTION public.get_import_run_status(p_import_run_id uuid)
RETURNS TABLE (
  import_run_id uuid, event_id uuid, import_type text, source_filename text, status text,
  created_at timestamptz, finalized_at timestamptz, finalized_by_display_identity text,
  row_total bigint, parsed_count bigint, validation_failed_count bigint, needs_review_count bigint,
  approved_count bigint, committed_count bigint, commit_failed_count bigint, abandoned_count bigint,
  final_outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_run public.import_runs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_id IS NULL THEN RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_run FROM public.import_runs WHERE id = p_import_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_run_not_found' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_event_task_authority('event.imports.view', v_run.event_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT v_run.id, v_run.event_id, v_run.import_type, v_run.source_filename, v_run.status,
         v_run.created_at, v_run.finalized_at, coalesce(a.display_name, a.email),
         count(*), count(*) FILTER (WHERE r.row_state = 'parsed'), count(*) FILTER (WHERE r.row_state = 'validation_failed'),
         count(*) FILTER (WHERE r.row_state = 'needs_review'), count(*) FILTER (WHERE r.row_state = 'approved'),
         count(*) FILTER (WHERE r.row_state = 'committed'), count(*) FILTER (WHERE r.row_state = 'commit_failed'),
         count(*) FILTER (WHERE r.abandoned_at IS NOT NULL),
         CASE WHEN v_run.status = 'finalized' THEN public.import_run_final_outcome(v_run.id) ELSE NULL END
  FROM public.import_run_rows r
  LEFT JOIN public.admin_users a ON a.user_id = v_run.finalized_by_auth_user_id
  WHERE r.import_run_id = v_run.id
  GROUP BY v_run.id, a.display_name, a.email;
END;
$$;

CREATE FUNCTION public.list_active_import_runs(p_event_id uuid)
RETURNS TABLE (
  import_run_id uuid, import_type text, source_filename text, created_by_display_identity text,
  created_at timestamptz, status text, row_total bigint, parsed_count bigint,
  validation_failed_count bigint, needs_review_count bigint, approved_count bigint,
  committed_count bigint, commit_failed_count bigint, abandoned_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_event_id IS NULL THEN RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_event_task_authority('event.imports.manage', p_event_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT run.id, run.import_type, run.source_filename, coalesce(a.display_name, a.email), run.created_at, run.status,
         count(r.*), count(*) FILTER (WHERE r.row_state = 'parsed'), count(*) FILTER (WHERE r.row_state = 'validation_failed'),
         count(*) FILTER (WHERE r.row_state = 'needs_review'), count(*) FILTER (WHERE r.row_state = 'approved'),
         count(*) FILTER (WHERE r.row_state = 'committed'), count(*) FILTER (WHERE r.row_state = 'commit_failed'),
         count(*) FILTER (WHERE r.abandoned_at IS NOT NULL)
  FROM public.import_runs run
  LEFT JOIN public.import_run_rows r ON r.import_run_id = run.id
  LEFT JOIN public.admin_users a ON a.user_id = run.created_by_auth_user_id
  WHERE run.event_id = p_event_id AND run.status <> 'finalized'
  GROUP BY run.id, a.display_name, a.email
  ORDER BY run.created_at DESC, run.id DESC;
END;
$$;

CREATE FUNCTION public.list_finalized_import_run_history(
  p_event_id uuid,
  p_before_finalized_at timestamptz DEFAULT NULL,
  p_before_import_run_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  import_run_id uuid, import_type text, source_filename text, created_by_display_identity text,
  finalized_by_display_identity text, created_at timestamptz, finalized_at timestamptz,
  row_total bigint, committed_count bigint, validation_failed_count bigint, abandoned_count bigint,
  final_outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
BEGIN
  IF auth.uid() IS NULL OR p_event_id IS NULL THEN RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_event_task_authority('event.imports.view', p_event_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT run.id, run.import_type, run.source_filename, coalesce(creator.display_name, creator.email),
         coalesce(finalizer.display_name, finalizer.email), run.created_at, run.finalized_at,
         count(r.*), count(*) FILTER (WHERE r.row_state = 'committed'),
         count(*) FILTER (WHERE r.row_state = 'validation_failed'), count(*) FILTER (WHERE r.abandoned_at IS NOT NULL),
         public.import_run_final_outcome(run.id)
  FROM public.import_runs run
  LEFT JOIN public.import_run_rows r ON r.import_run_id = run.id
  LEFT JOIN public.admin_users creator ON creator.user_id = run.created_by_auth_user_id
  LEFT JOIN public.admin_users finalizer ON finalizer.user_id = run.finalized_by_auth_user_id
  WHERE run.event_id = p_event_id
    AND run.status = 'finalized'
    AND (p_before_finalized_at IS NULL OR (run.finalized_at, run.id) < (p_before_finalized_at, coalesce(p_before_import_run_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  GROUP BY run.id, creator.display_name, creator.email, finalizer.display_name, finalizer.email
  ORDER BY run.finalized_at DESC, run.id DESC
  LIMIT v_limit;
END;
$$;

CREATE FUNCTION public.get_finalized_import_run_history_detail(p_import_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_run public.import_runs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_id IS NULL THEN RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_run FROM public.import_runs WHERE id = p_import_run_id AND status = 'finalized';
  IF NOT FOUND THEN RAISE EXCEPTION 'finalized_import_run_not_found' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_event_task_authority('event.imports.view', v_run.event_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'run', jsonb_build_object(
      'id', v_run.id, 'event_id', v_run.event_id, 'import_type', v_run.import_type,
      'source_filename', v_run.source_filename, 'status', v_run.status,
      'created_at', v_run.created_at, 'finalized_at', v_run.finalized_at,
      'final_outcome', public.import_run_final_outcome(v_run.id)
    ),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'source_row_number', r.source_row_number,
        'terminal_disposition', CASE WHEN r.abandoned_at IS NOT NULL THEN 'abandoned' WHEN r.row_state = 'committed' THEN 'committed' WHEN r.row_state = 'validation_failed' THEN 'validation_failed' ELSE 'legacy_unresolved' END,
        'validation_codes', coalesce((SELECT jsonb_agg(jsonb_build_object('code', item->>'code')) FROM jsonb_array_elements(r.validation_details) item WHERE item ? 'code'), '[]'::jsonb),
        'abandonment_reason_code', r.abandonment_reason_code,
        'commit_state', r.commit_state,
        'commit_failure_code', r.commit_error->>'code',
        'canonical_target_id', r.canonical_target_id,
        'created_at', r.created_at, 'updated_at', r.updated_at,
        'committed_at', r.committed_at, 'abandoned_at', r.abandoned_at
      ) ORDER BY r.source_row_number)
      FROM public.import_run_rows r WHERE r.import_run_id = v_run.id
    ), '[]'::jsonb)
  );
END;
$$;

ALTER FUNCTION public.import_run_final_outcome(uuid) OWNER TO postgres;
ALTER FUNCTION public.close_import_run_staging(uuid) OWNER TO postgres;
ALTER FUNCTION public.set_import_run_row_review_state(uuid, text, jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.abandon_import_run_row(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.abandon_import_run_open_rows(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.finalize_import_run(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_import_run_status(uuid) OWNER TO postgres;
ALTER FUNCTION public.list_active_import_runs(uuid) OWNER TO postgres;
ALTER FUNCTION public.list_finalized_import_run_history(uuid, timestamptz, uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.get_finalized_import_run_history_detail(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.import_run_final_outcome(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.close_import_run_staging(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.set_import_run_row_review_state(uuid, text, jsonb, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.abandon_import_run_row(uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.abandon_import_run_open_rows(uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.finalize_import_run(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_import_run_status(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.list_active_import_runs(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.list_finalized_import_run_history(uuid, timestamptz, uuid, integer) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_finalized_import_run_history_detail(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.close_import_run_staging(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_import_run_row_review_state(uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_import_run_row(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_import_run_open_rows(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_import_run(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_import_run_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_import_runs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_finalized_import_run_history(uuid, timestamptz, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_finalized_import_run_history_detail(uuid) TO authenticated;

COMMIT;
