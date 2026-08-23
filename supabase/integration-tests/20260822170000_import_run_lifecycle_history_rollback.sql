-- Stage: Governed Imports lifecycle / abandonment / finalization / History.
-- Linked outer-rollback exhaustive compatibility fixture. Installs the exact
-- pending 20260822170000 migration body inside this same outer transaction
-- (this repository has no separate "runner" that prepends a migration
-- before a fixture -- every prior linked fixture in this repo embeds the
-- pending definitions verbatim itself; see the parity test in the
-- migration's own .test.ts, which asserts this file's installed block is
-- byte-identical to the migration's), then proves it against the already-
-- live, unmodified Attendee (Stage 3/3.1) and Vendor (Stage 5B.2) governed
-- commit paths. Everything -- schema change, functions, fixture data -- is
-- rolled back at the end; nothing here is permanent.
BEGIN;

-- ============================================================
-- PARITY: byte-identical to 20260822170000_govern_import_run_lifecycle_history.sql
-- ============================================================

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

-- ============================================================
-- FIXTURE-ONLY helpers (never survive ROLLBACK)
-- ============================================================

CREATE FUNCTION public.import_lifecycle_fixture_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'import_lifecycle_fixture_assertion_failed: %', p_message; END IF;
END;
$$;

CREATE FUNCTION public.import_lifecycle_fixture_attendee_candidate(p_entry text, p_email text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('registration', jsonb_build_object('entry_id', p_entry, 'email', p_email, 'pilot_first', 'IL', 'pilot_last', 'Fixture'), 'capacity_evidence', jsonb_build_object('imported_capacity', 1, 'structured_participant_minimum', 1), 'activities', '[]'::jsonb);
$$;

CREATE FUNCTION public.import_lifecycle_fixture_vendor_candidate(p_business_name text, p_admit boolean)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('identity_evidence', jsonb_build_object('business_name', p_business_name), 'event_intent', jsonb_build_object('admit', p_admit));
$$;

-- Drives a freshly staged (still 'parsed') row directly to an arbitrary
-- target disposition, satisfying import_run_rows_state_consistency exactly.
-- Used only by the finalization-matrix/outcome-matrix sections below, where
-- the row states under test -- not how a row reached them -- are what is
-- being proven; sections 1/2 exercise the real Attendee/Vendor commit RPCs
-- for the "how a row reaches a disposition" proof instead.
CREATE FUNCTION public.import_lifecycle_fixture_set_row_state(p_row_id uuid, p_target text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_target = 'parsed' THEN
    UPDATE public.import_run_rows SET validation_state='pending', review_state='unreviewed', row_state='parsed', commit_state='not_started' WHERE id=p_row_id;
  ELSIF p_target = 'validation_failed' THEN
    UPDATE public.import_run_rows SET validation_state='invalid', review_state='unreviewed', row_state='validation_failed', commit_state='not_started' WHERE id=p_row_id;
  ELSIF p_target = 'needs_review' THEN
    UPDATE public.import_run_rows SET validation_state='valid', review_state='needs_review', row_state='needs_review', commit_state='not_started' WHERE id=p_row_id;
  ELSIF p_target = 'approved' THEN
    UPDATE public.import_run_rows SET validation_state='valid', review_state='approved', row_state='approved', commit_state='not_started' WHERE id=p_row_id;
  ELSIF p_target = 'commit_failed' THEN
    UPDATE public.import_run_rows SET validation_state='valid', review_state='approved', row_state='commit_failed', commit_state='failed', commit_error=jsonb_build_object('code','fixture_failure','message','fixture') WHERE id=p_row_id;
  ELSIF p_target = 'committed' THEN
    UPDATE public.import_run_rows SET validation_state='valid', review_state='approved', row_state='committed', commit_state='committed', commit_error=NULL, committed_at=now() WHERE id=p_row_id;
  ELSE
    RAISE EXCEPTION 'unknown fixture target state %', p_target;
  END IF;
END;
$$;

CREATE FUNCTION public.import_lifecycle_fixture_fail_attendees() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('il.fail_attendees', true) = 'true' THEN RAISE EXCEPTION 'il_fixture_forced_attendees_failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER import_lifecycle_fixture_fail_attendees_trigger BEFORE INSERT ON public.attendees FOR EACH ROW EXECUTE FUNCTION public.import_lifecycle_fixture_fail_attendees();

CREATE FUNCTION public.import_lifecycle_fixture_fail_vendor_dispositions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('il.fail_vendor_dispositions', true) = 'true' THEN RAISE EXCEPTION 'il_fixture_forced_vendor_dispositions_failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER import_lifecycle_fixture_fail_vendor_dispositions_trigger BEFORE INSERT ON public.vendor_event_dispositions FOR EACH ROW EXECUTE FUNCTION public.import_lifecycle_fixture_fail_vendor_dispositions();

-- ============================================================
-- FIXTURE DATA + PROOFS
-- ============================================================

DO $$
DECLARE
  t uuid := gen_random_uuid(); ea uuid := gen_random_uuid(); eb uuid := gen_random_uuid(); earch uuid := gen_random_uuid();
  u_both uuid := gen_random_uuid(); u_manage_only uuid := gen_random_uuid(); u_view_only uuid := gen_random_uuid();
  u_neither uuid := gen_random_uuid(); u_cross uuid := gen_random_uuid();
  v_active uuid; v_active2 uuid;
  run_id uuid; row_id uuid; row_id2 uuid; row_id3 uuid;
  v_out text; v_vendor_id uuid; v_attendee_id uuid;
  recovery jsonb; hist jsonb; row_obj jsonb; run_row public.import_runs%ROWTYPE; row_row public.import_run_rows%ROWTYPE; status_row record;
  n bigint; before_count integer; before_ts timestamptz; after_ts timestamptz;
  finalized_at_1 timestamptz; finalized_at_2 timestamptz;
BEGIN
  -- ---------- Isolated fixture: tenant, Events, callers, canonical Vendors ----------
  INSERT INTO public.tenants(id, organization_code, slug, organization_name, display_name, app_title)
    VALUES (t, 'IL-' || left(t::text, 8), 'il-' || left(t::text, 8), 'Import Lifecycle Fixture', 'Import Lifecycle Fixture', 'Import Lifecycle Fixture');
  INSERT INTO public.events(id, tenant_id, name, start_date, end_date, timezone, lifecycle_state) VALUES
    (ea, t, 'il-fixture-a-' || t::text, current_date, current_date + 3, 'UTC', 'operational'),
    (eb, t, 'il-fixture-b-' || t::text, current_date, current_date + 3, 'UTC', 'operational'),
    (earch, t, 'il-fixture-archived-' || t::text, current_date, current_date + 3, 'UTC', 'operational');
  INSERT INTO auth.users(id, email) VALUES
    (u_both, 'both-' || u_both || '@fixture.invalid'), (u_manage_only, 'manage-' || u_manage_only || '@fixture.invalid'),
    (u_view_only, 'view-' || u_view_only || '@fixture.invalid'), (u_neither, 'neither-' || u_neither || '@fixture.invalid'),
    (u_cross, 'cross-' || u_cross || '@fixture.invalid');
  INSERT INTO public.admin_users(user_id, email, display_name) VALUES
    (u_both, 'both-' || u_both || '@fixture.invalid', 'Both'), (u_manage_only, 'manage-' || u_manage_only || '@fixture.invalid', 'ManageOnly'),
    (u_view_only, 'view-' || u_view_only || '@fixture.invalid', 'ViewOnly'), (u_neither, 'neither-' || u_neither || '@fixture.invalid', 'Neither'),
    (u_cross, 'cross-' || u_cross || '@fixture.invalid', 'Cross');
  INSERT INTO public.admin_event_access(admin_user_id, event_id, role)
    SELECT a.id, ea, 'event_admin' FROM public.admin_users a WHERE a.user_id IN (u_both, u_manage_only, u_view_only, u_neither);
  INSERT INTO public.admin_event_access(admin_user_id, event_id, role)
    SELECT a.id, earch, 'event_admin' FROM public.admin_users a WHERE a.user_id = u_both;
  INSERT INTO public.admin_event_access(admin_user_id, event_id, role)
    SELECT a.id, eb, 'event_admin' FROM public.admin_users a WHERE a.user_id = u_cross;
  -- u_both: full composed authority (imports.manage+view, attendees.manage, vendors.manage) on ea and earch.
  INSERT INTO public.admin_event_permissions(admin_event_access_id, permission_key)
    SELECT x.id, p.key FROM public.admin_event_access x JOIN public.admin_users a ON a.id = x.admin_user_id
    CROSS JOIN (VALUES ('event.imports.manage'), ('event.imports.view'), ('event.attendees.manage'), ('event.vendors.manage')) p(key)
    WHERE x.event_id IN (ea, earch) AND a.user_id = u_both;
  -- u_manage_only: imports.manage ONLY -- no .view, no Attendee/Vendor authority. Proves manage never implies view, and that the new lifecycle RPCs grant no canonical authority.
  INSERT INTO public.admin_event_permissions(admin_event_access_id, permission_key)
    SELECT x.id, 'event.imports.manage' FROM public.admin_event_access x JOIN public.admin_users a ON a.id = x.admin_user_id
    WHERE x.event_id = ea AND a.user_id = u_manage_only;
  -- u_view_only: imports.view ONLY -- no manage.
  INSERT INTO public.admin_event_permissions(admin_event_access_id, permission_key)
    SELECT x.id, 'event.imports.view' FROM public.admin_event_access x JOIN public.admin_users a ON a.id = x.admin_user_id
    WHERE x.event_id = ea AND a.user_id = u_view_only;
  -- u_cross: full authority, but only on eb (a different Event).
  INSERT INTO public.admin_event_permissions(admin_event_access_id, permission_key)
    SELECT x.id, p.key FROM public.admin_event_access x JOIN public.admin_users a ON a.id = x.admin_user_id
    CROSS JOIN (VALUES ('event.imports.manage'), ('event.imports.view')) p(key)
    WHERE x.event_id = eb AND a.user_id = u_cross;

  INSERT INTO public.vendors(id, name, business_name, is_active) VALUES (gen_random_uuid(), 'IL Vendor Co', 'IL Vendor Co', true) RETURNING id INTO v_active;
  INSERT INTO public.vendors(id, name, business_name, is_active) VALUES (gen_random_uuid(), 'IL Vendor Retry Co', 'IL Vendor Retry Co', true) RETURNING id INTO v_active2;

  PERFORM set_config('request.jwt.claim.sub', u_both::text, true);

  -- ================= 1. ATTENDEE REAL-WORKFLOW COMPATIBILITY =================

  -- Both rows are staged before source closure (staging a NEW row after
  -- closure is denied -- see Section 3); everything after this point
  -- (review, close, commit, retry) happens post-closure.
  SELECT id INTO run_id FROM public.create_import_run(ea, 'attendee_roster', 'il-attendee.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, public.import_lifecycle_fixture_attendee_candidate('IL-ATT-1', 'il-att-1@fixture.invalid'), 'il-att-1-' || run_id);
  SELECT id INTO row_id2 FROM public.stage_import_run_row(run_id, 2, '{}'::jsonb, public.import_lifecycle_fixture_attendee_candidate('IL-ATT-2', 'il-att-2@fixture.invalid'), 'il-att-2-' || run_id);
  PERFORM public.set_import_run_row_review_state(row_id, 'valid', '[]'::jsonb, 'approved');
  PERFORM public.set_import_run_row_review_state(row_id2, 'valid', '[]'::jsonb, 'approved');
  PERFORM public.close_import_run_staging(run_id);

  -- Golden path.
  SELECT outcome, attendee_id INTO v_out, v_attendee_id FROM public.commit_attendee_import_run_row(row_id);
  PERFORM public.import_lifecycle_fixture_assert(v_out = 'committed', 'Attendee golden path commits through the real Stage 3 RPC after source closure');
  PERFORM public.import_lifecycle_fixture_assert((SELECT entry_id = 'IL-ATT-1' AND email = 'il-att-1@fixture.invalid' FROM public.attendees WHERE id = v_attendee_id), 'canonical attendee effects are real');
  recovery := public.get_managed_import_run_recovery(run_id);
  PERFORM public.import_lifecycle_fixture_assert((SELECT elem->>'row_state' FROM jsonb_array_elements(recovery->'rows') elem WHERE (elem->>'id')::uuid = row_id) = 'committed', 'recovery reports committed truthfully');

  -- Failure/retry: force a genuine canonical Stage 3 rollback at the attendees INSERT itself.
  PERFORM set_config('il.fail_attendees', 'true', true);
  BEGIN
    PERFORM public.commit_attendee_import_run_row(row_id2);
    RAISE EXCEPTION 'attendee commit did not fail as forced';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'il_fixture_forced_attendees_failure', 'forced Stage 3 attendees failure occurred');
  END;
  PERFORM public.import_lifecycle_fixture_assert(NOT EXISTS (SELECT 1 FROM public.attendees WHERE entry_id = 'IL-ATT-2'), 'canonical attendee effects fully rolled back');
  PERFORM set_config('il.fail_attendees', '', true);
  PERFORM public.record_attendee_import_run_row_commit_failure(row_id2, 'canonical_commit_failed');
  PERFORM public.import_lifecycle_fixture_assert((SELECT row_state = 'commit_failed' FROM public.import_run_rows WHERE id = row_id2), 'bounded Stage 3.1 failure recorded');
  recovery := public.get_managed_import_run_recovery(run_id);
  PERFORM public.import_lifecycle_fixture_assert((SELECT elem->>'row_state' FROM jsonb_array_elements(recovery->'rows') elem WHERE (elem->>'id')::uuid = row_id2) = 'commit_failed', 'recovery reports commit_failed truthfully');
  SELECT outcome, attendee_id INTO v_out, v_attendee_id FROM public.commit_attendee_import_run_row(row_id2);
  PERFORM public.import_lifecycle_fixture_assert(v_out = 'committed', 'retry of the SAME staged row succeeds once the forced failure is removed');
  PERFORM public.import_lifecycle_fixture_assert((SELECT commit_error IS NULL FROM public.import_run_rows WHERE id = row_id2), 'commit_error cleared on successful retry');
  SELECT count(*) INTO before_count FROM public.attendee_household_members WHERE attendee_id = v_attendee_id;
  SELECT outcome INTO v_out FROM public.commit_attendee_import_run_row(row_id2);
  PERFORM public.import_lifecycle_fixture_assert(v_out = 'already_committed', 'committed retry reports already_committed');
  PERFORM public.import_lifecycle_fixture_assert((SELECT count(*) FROM public.attendee_household_members WHERE attendee_id = v_attendee_id) = before_count, 'no duplicate household evidence from the idempotent retry');
  PERFORM public.import_lifecycle_fixture_assert((SELECT count(*) FROM public.attendees WHERE entry_id = 'IL-ATT-2') = 1, 'no duplicate attendee');

  -- Immutability: committed rows cannot be rewritten through the review-state RPC or abandoned.
  BEGIN PERFORM public.set_import_run_row_review_state(row_id, 'valid', '[]'::jsonb, 'needs_review'); RAISE EXCEPTION 'committed row review-state was rewritable';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_row_terminal_or_retry_owned', 'committed row is closed to review-state RPC'); END;
  BEGIN PERFORM public.abandon_import_run_row(row_id, 'other'); RAISE EXCEPTION 'committed row was abandonable';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_row_terminal', 'committed row cannot be abandoned'); END;

  -- ================= 2. VENDOR REAL-WORKFLOW COMPATIBILITY =================

  SELECT id INTO run_id FROM public.create_import_run(ea, 'vendors', 'il-vendor.csv', '{}'::jsonb);

  -- All three rows staged before source closure; everything after this
  -- point (review, close, commit, retry, needs_review) happens post-closure.
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, public.import_lifecycle_fixture_vendor_candidate('IL Vendor Co', true), 'il-vend-1-' || run_id);
  SELECT id INTO row_id2 FROM public.stage_import_run_row(run_id, 2, '{}'::jsonb, public.import_lifecycle_fixture_vendor_candidate('IL Vendor Retry Co', true), 'il-vend-2-' || run_id);
  SELECT id INTO row_id3 FROM public.stage_import_run_row(run_id, 3, '{}'::jsonb, public.import_lifecycle_fixture_vendor_candidate('IL Ghost Vendor Co', false), 'il-vend-3-' || run_id);
  PERFORM public.set_import_run_row_review_state(row_id, 'valid', '[]'::jsonb, 'approved');
  PERFORM public.set_import_run_row_review_state(row_id2, 'valid', '[]'::jsonb, 'approved');
  PERFORM public.set_import_run_row_review_state(row_id3, 'valid', '[]'::jsonb, 'approved');
  PERFORM public.close_import_run_staging(run_id);

  -- Golden path.
  SELECT outcome, vendor_id INTO v_out, v_vendor_id FROM public.commit_vendor_import_run_row(row_id);
  PERFORM public.import_lifecycle_fixture_assert(v_out = 'committed' AND v_vendor_id = v_active, 'Vendor golden path commits through the real Stage 5B.2 RPC after source closure');
  PERFORM public.import_lifecycle_fixture_assert((SELECT admission_state = 'admitted' FROM public.event_vendors WHERE vendor_id = v_active AND event_id = ea), 'real admission effect');
  PERFORM public.import_lifecycle_fixture_assert((SELECT business_name = 'IL Vendor Co' FROM public.vendors WHERE id = v_active), 'no global Vendor identity mutation');
  recovery := public.get_managed_import_run_recovery(run_id);
  PERFORM public.import_lifecycle_fixture_assert((SELECT elem->>'row_state' FROM jsonb_array_elements(recovery->'rows') elem WHERE (elem->>'id')::uuid = row_id) = 'committed', 'Vendor recovery reports committed truthfully');

  -- Failure/retry: force a genuine canonical rollback inside admit_vendor_for_event's own disposition insert.
  PERFORM set_config('il.fail_vendor_dispositions', 'true', true);
  BEGIN
    PERFORM public.commit_vendor_import_run_row(row_id2);
    RAISE EXCEPTION 'vendor commit did not fail as forced';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'il_fixture_forced_vendor_dispositions_failure', 'forced Stage 5B.2 disposition failure occurred');
  END;
  PERFORM public.import_lifecycle_fixture_assert(NOT EXISTS (SELECT 1 FROM public.event_vendors WHERE vendor_id = v_active2), 'canonical Vendor admission fully rolled back');
  PERFORM set_config('il.fail_vendor_dispositions', '', true);
  PERFORM public.record_vendor_import_run_row_commit_failure(row_id2, 'vendor_commit_failed');
  PERFORM public.import_lifecycle_fixture_assert((SELECT row_state = 'commit_failed' FROM public.import_run_rows WHERE id = row_id2), 'bounded Vendor failure recorded');
  recovery := public.get_managed_import_run_recovery(run_id);
  PERFORM public.import_lifecycle_fixture_assert((SELECT elem->>'row_state' FROM jsonb_array_elements(recovery->'rows') elem WHERE (elem->>'id')::uuid = row_id2) = 'commit_failed', 'Vendor recovery reports commit_failed truthfully');
  SELECT outcome, vendor_id INTO v_out, v_vendor_id FROM public.commit_vendor_import_run_row(row_id2);
  PERFORM public.import_lifecycle_fixture_assert(v_out = 'committed' AND v_vendor_id = v_active2, 'retry of the SAME staged Vendor row succeeds once the forced failure is removed');
  SELECT count(*) INTO before_count FROM public.vendor_event_dispositions WHERE vendor_id = v_active2;
  SELECT outcome INTO v_out FROM public.commit_vendor_import_run_row(row_id2);
  PERFORM public.import_lifecycle_fixture_assert(v_out = 'already_committed', 'Vendor committed retry reports already_committed');
  PERFORM public.import_lifecycle_fixture_assert((SELECT count(*) FROM public.vendor_event_dispositions WHERE vendor_id = v_active2) = before_count, 'no duplicate admission/disposition evidence');

  -- Immutability (proven while the run is still open, so the row-state-
  -- terminal guard itself is what is exercised, not merely the separate
  -- run-status filter a finalized run would also trigger).
  BEGIN PERFORM public.set_import_run_row_review_state(row_id, 'valid', '[]'::jsonb, 'needs_review'); RAISE EXCEPTION 'committed Vendor row was rewritable';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_row_terminal_or_retry_owned', 'committed Vendor row closed to review-state RPC'); END;
  BEGIN PERFORM public.abandon_import_run_row(row_id, 'other'); RAISE EXCEPTION 'committed Vendor row was abandonable';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_row_terminal', 'committed Vendor row cannot be abandoned'); END;

  -- Needs-review: real server-side zero-match outcome.
  SELECT outcome INTO v_out FROM public.commit_vendor_import_run_row(row_id3);
  PERFORM public.import_lifecycle_fixture_assert(v_out = 'needs_review', 'zero-match Vendor row is a real server-side needs_review outcome');
  PERFORM public.import_lifecycle_fixture_assert((SELECT row_state = 'needs_review' AND commit_state = 'not_started' AND abandoned_at IS NULL FROM public.import_run_rows WHERE id = row_id3), 'needs_review persisted and OPEN/non-terminal');
  BEGIN PERFORM public.finalize_import_run(run_id); RAISE EXCEPTION 'run finalized despite an open needs_review row';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_run_has_open_rows', 'open needs_review row blocks finalization'); END;
  PERFORM public.abandon_import_run_row(row_id3, 'cannot_resolve');
  run_row := public.finalize_import_run(run_id);
  PERFORM public.import_lifecycle_fixture_assert(run_row.status = 'finalized', 'finalization proceeds once the needs_review row is resolved via abandonment');

  -- Finalized-run immutability: the SAME committed row, now under a
  -- finalized run, is denied via the run-status filter (a second,
  -- independent guard layer on top of the row-state-terminal one above).
  BEGIN PERFORM public.set_import_run_row_review_state(row_id, 'valid', '[]'::jsonb, 'needs_review'); RAISE EXCEPTION 'finalized-run row was rewritable';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_row_not_mutable', 'finalized run''s rows are closed to the review-state RPC via the run-status filter'); END;
  BEGIN PERFORM public.abandon_import_run_row(row_id, 'other'); RAISE EXCEPTION 'finalized-run row was abandonable';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_run_not_mutable', 'a finalized run denies abandonment via its own run-status guard'); END;

  -- ================= 3. SOURCE CLOSURE =================

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'il-closure.csv', '{}'::jsonb);
  run_row := public.close_import_run_staging(run_id);
  PERFORM public.import_lifecycle_fixture_assert(run_row.status = 'ready_for_review', 'staging closes to ready_for_review');
  run_row := public.close_import_run_staging(run_id);
  PERFORM public.import_lifecycle_fixture_assert(run_row.status = 'ready_for_review', 'exact replay is idempotent, no reversal to staging');
  BEGIN PERFORM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'closed-' || run_id); RAISE EXCEPTION 'staging reopened after closure';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_run_not_staging', 'no new source rows after closure'); END;

  -- Review operations remain allowed after closure for a row staged before closure.
  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'il-closure-review.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'closure-review-' || run_id);
  PERFORM public.close_import_run_staging(run_id);
  row_row := public.set_import_run_row_review_state(row_id, 'valid', '[]'::jsonb, 'approved');
  PERFORM public.import_lifecycle_fixture_assert((SELECT row_state = 'approved' FROM public.import_run_rows WHERE id = row_id), 'review operations remain allowed in ready_for_review');

  -- Finalized run cannot reopen staging.
  PERFORM public.set_import_run_row_review_state(row_id, 'valid', '[]'::jsonb, 'approved');
  UPDATE public.import_run_rows SET row_state = 'committed', commit_state = 'committed', committed_at = now() WHERE id = row_id;
  PERFORM public.finalize_import_run(run_id);
  BEGIN PERFORM public.close_import_run_staging(run_id); RAISE EXCEPTION 'finalized run was re-closable';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_run_not_closable', 'finalized run cannot reopen staging'); END;

  -- Empty-run closure/finalization behavior -- explicitly determined, not invented.
  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'il-empty.csv', '{}'::jsonb);
  PERFORM public.close_import_run_staging(run_id);
  run_row := public.finalize_import_run(run_id);
  PERFORM public.import_lifecycle_fixture_assert(run_row.status = 'finalized', 'EMPTY-RUN FINDING: a zero-row run IS finalizable (finalize''s open-row EXISTS check vacuously passes)');
  PERFORM public.import_lifecycle_fixture_assert(public.import_run_final_outcome(run_id) = 'completed', 'EMPTY-RUN FINDING: its derived outcome is completed (0=0 committed=total, 0 abandoned, 0 validation_failed)');

  -- ================= 4. TERMINALITY =================

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'il-terminality.csv', '{}'::jsonb);
  -- parsed: open, mutable.
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'term-parsed-' || run_id);
  PERFORM public.import_lifecycle_fixture_assert((SELECT row_state = 'parsed' FROM public.import_run_rows WHERE id = row_id), 'freshly staged row is parsed/open');
  row_row := public.set_import_run_row_review_state(row_id, 'invalid', jsonb_build_array(jsonb_build_object('code', 'x')), 'unreviewed');
  PERFORM public.import_lifecycle_fixture_assert((SELECT row_state = 'validation_failed' FROM public.import_run_rows WHERE id = row_id), 'parsed row transitions to validation_failed');
  -- validation_failed: terminal.
  BEGIN PERFORM public.set_import_run_row_review_state(row_id, 'valid', '[]'::jsonb, 'approved'); RAISE EXCEPTION 'validation_failed row was mutable';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_row_terminal_or_retry_owned', 'validation_failed is terminal to review-state RPC'); END;
  BEGIN PERFORM public.abandon_import_run_row(row_id, 'other'); RAISE EXCEPTION 'validation_failed row was abandonable';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_row_terminal', 'validation_failed cannot be abandoned'); END;
  -- commit_failed: open (retry-owned by commit RPCs, but abandonable and not review-state-mutable).
  SELECT id INTO row_id2 FROM public.stage_import_run_row(run_id, 2, '{}'::jsonb, '{}'::jsonb, 'term-cf-' || run_id);
  PERFORM public.import_lifecycle_fixture_set_row_state(row_id2, 'commit_failed');
  BEGIN PERFORM public.set_import_run_row_review_state(row_id2, 'valid', '[]'::jsonb, 'approved'); RAISE EXCEPTION 'commit_failed row was review-state mutable';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_row_terminal_or_retry_owned', 'commit_failed is retry-owned, not review-state mutable'); END;
  row_row := public.abandon_import_run_row(row_id2, 'cannot_resolve');
  PERFORM public.import_lifecycle_fixture_assert((SELECT abandoned_at IS NOT NULL FROM public.import_run_rows WHERE id = row_id2), 'commit_failed IS open -- it is abandonment-eligible');

  -- ================= 5. ROW ABANDONMENT =================

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'il-row-abandon.csv', '{}'::jsonb);
  -- Eligible: parsed.
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'abandon-parsed-' || run_id);
  row_row := public.abandon_import_run_row(row_id, 'operator_declined');
  PERFORM public.import_lifecycle_fixture_assert((SELECT abandoned_at IS NOT NULL AND abandoned_by_auth_user_id = u_both AND abandonment_reason_code = 'operator_declined' AND row_state = 'parsed' FROM public.import_run_rows WHERE id = row_id), 'parsed row abandoned; original row_state preserved as an overlay');
  -- Cannot reopen.
  BEGIN PERFORM public.set_import_run_row_review_state(row_id, 'valid', '[]'::jsonb, 'approved'); RAISE EXCEPTION 'abandoned row reopened';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_row_terminal_or_retry_owned', 'abandoned row is immutable to review-state RPC'); END;
  -- Reason cannot be replaced; exact replay is idempotent.
  BEGIN PERFORM public.abandon_import_run_row(row_id, 'other'); RAISE EXCEPTION 'abandonment reason was replaced';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_row_already_abandoned', 'a different reason on an already-abandoned row is denied'); END;
  row_row := public.abandon_import_run_row(row_id, 'operator_declined');
  PERFORM public.import_lifecycle_fixture_assert(row_row.abandonment_reason_code = 'operator_declined', 'exact-reason replay is idempotent, not an error');
  -- Direct DB-level immutability (the trigger, not just the RPC).
  BEGIN UPDATE public.import_run_rows SET abandonment_reason_code = 'other' WHERE id = row_id; RAISE EXCEPTION 'trigger allowed rewriting abandonment reason';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'abandoned import row is immutable', 'prevent_import_run_row_source_mutation trigger enforces abandonment immutability directly'); END;

  -- Eligible: approved, needs_review already proven in sections 1 (no -- Attendee immutability used committed) and 2 (Vendor needs_review). Prove approved here directly.
  SELECT id INTO row_id2 FROM public.stage_import_run_row(run_id, 2, '{}'::jsonb, '{}'::jsonb, 'abandon-approved-' || run_id);
  PERFORM public.set_import_run_row_review_state(row_id2, 'valid', '[]'::jsonb, 'approved');
  row_row := public.abandon_import_run_row(row_id2, 'source_superseded');
  PERFORM public.import_lifecycle_fixture_assert((SELECT abandoned_at IS NOT NULL AND row_state = 'approved' FROM public.import_run_rows WHERE id = row_id2), 'approved row abandoned; original approved state preserved');

  -- Deny: committed and validation_failed already proven in sections 1, 2, and 4 above.

  -- ================= 6. RUN ABANDONMENT =================

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'il-run-abandon.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'ra-committed-' || run_id);
  PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'committed');
  SELECT id INTO row_id2 FROM public.stage_import_run_row(run_id, 2, '{}'::jsonb, '{}'::jsonb, 'ra-valfail-' || run_id);
  PERFORM public.import_lifecycle_fixture_set_row_state(row_id2, 'validation_failed');
  SELECT id INTO row_id3 FROM public.stage_import_run_row(run_id, 3, '{}'::jsonb, '{}'::jsonb, 'ra-needsreview-' || run_id);
  PERFORM public.import_lifecycle_fixture_set_row_state(row_id3, 'needs_review');
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 4, '{}'::jsonb, '{}'::jsonb, 'ra-commitfailed-' || run_id);
  PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'commit_failed');
  SELECT id INTO row_id2 FROM public.stage_import_run_row(run_id, 5, '{}'::jsonb, '{}'::jsonb, 'ra-approved-' || run_id);
  PERFORM public.import_lifecycle_fixture_set_row_state(row_id2, 'approved');
  SELECT public.abandon_import_run_open_rows(run_id, 'operator_declined') INTO n;
  PERFORM public.import_lifecycle_fixture_assert(n = 3, 'run abandonment reaches exactly the 3 open rows (needs_review, commit_failed, approved)');
  PERFORM public.import_lifecycle_fixture_assert((SELECT count(*) FROM public.import_run_rows WHERE import_run_id = run_id AND row_state = 'committed' AND abandoned_at IS NULL) = 1, 'committed row untouched');
  PERFORM public.import_lifecycle_fixture_assert((SELECT count(*) FROM public.import_run_rows WHERE import_run_id = run_id AND row_state = 'validation_failed' AND abandoned_at IS NULL) = 1, 'validation_failed row untouched');
  SELECT public.abandon_import_run_open_rows(run_id, 'operator_declined') INTO n;
  PERFORM public.import_lifecycle_fixture_assert(n = 0, 'repeated invocation is deterministic -- no more open rows to reach');
  PERFORM public.import_lifecycle_fixture_assert((SELECT count(*) FROM public.import_run_rows WHERE import_run_id = run_id AND row_state = 'committed') = 1, 'run abandonment never reverses a canonical commit disposition');

  -- ================= 7 & 9. FINALIZATION MATRIX + DERIVED OUTCOME MATRIX =================

  -- MUST SUCCEED, with exact derived outcomes.
  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'fm-all-committed.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'fm1-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'committed');
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 2, '{}'::jsonb, '{}'::jsonb, 'fm2-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'committed');
  PERFORM public.close_import_run_staging(run_id); run_row := public.finalize_import_run(run_id);
  PERFORM public.import_lifecycle_fixture_assert(run_row.status = 'finalized' AND public.import_run_final_outcome(run_id) = 'completed', 'all committed -> completed');

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'fm-committed-valfail.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'fm3-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'committed');
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 2, '{}'::jsonb, '{}'::jsonb, 'fm4-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'validation_failed');
  PERFORM public.close_import_run_staging(run_id); run_row := public.finalize_import_run(run_id);
  PERFORM public.import_lifecycle_fixture_assert(run_row.status = 'finalized' AND public.import_run_final_outcome(run_id) = 'completed_with_errors', 'committed + validation_failed -> completed_with_errors');

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'fm-all-valfail.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'fm5-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'validation_failed');
  PERFORM public.close_import_run_staging(run_id); run_row := public.finalize_import_run(run_id);
  PERFORM public.import_lifecycle_fixture_assert(run_row.status = 'finalized' AND public.import_run_final_outcome(run_id) = 'completed_with_errors', 'all validation_failed -> completed_with_errors');

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'fm-all-abandoned.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'fm6-' || run_id);
  PERFORM public.abandon_import_run_row(row_id, 'other');
  PERFORM public.close_import_run_staging(run_id); run_row := public.finalize_import_run(run_id);
  PERFORM public.import_lifecycle_fixture_assert(run_row.status = 'finalized' AND public.import_run_final_outcome(run_id) = 'abandoned', 'all abandoned -> abandoned');

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'fm-committed-abandoned.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'fm7-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'committed');
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 2, '{}'::jsonb, '{}'::jsonb, 'fm8-' || run_id); PERFORM public.abandon_import_run_row(row_id, 'other');
  PERFORM public.close_import_run_staging(run_id); run_row := public.finalize_import_run(run_id);
  PERFORM public.import_lifecycle_fixture_assert(run_row.status = 'finalized' AND public.import_run_final_outcome(run_id) = 'mixed', 'committed + abandoned -> mixed');

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'fm-valfail-abandoned.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'fm9-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'validation_failed');
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 2, '{}'::jsonb, '{}'::jsonb, 'fm10-' || run_id); PERFORM public.abandon_import_run_row(row_id, 'other');
  PERFORM public.close_import_run_staging(run_id); run_row := public.finalize_import_run(run_id);
  PERFORM public.import_lifecycle_fixture_assert(run_row.status = 'finalized' AND public.import_run_final_outcome(run_id) = 'abandoned', 'validation_failed + abandoned (no commits) -> abandoned, per the architecture''s own documented "no committed rows and one or more abandoned" rule -- this is a deliberate simplification, not an ambiguity');

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'fm-all-three.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'fm11-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'committed');
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 2, '{}'::jsonb, '{}'::jsonb, 'fm12-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'validation_failed');
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 3, '{}'::jsonb, '{}'::jsonb, 'fm13-' || run_id); PERFORM public.abandon_import_run_row(row_id, 'other');
  PERFORM public.close_import_run_staging(run_id); run_row := public.finalize_import_run(run_id);
  PERFORM public.import_lifecycle_fixture_assert(run_row.status = 'finalized' AND public.import_run_final_outcome(run_id) = 'mixed', 'committed + validation_failed + abandoned -> mixed');

  -- MUST FAIL: one unresolved (terminal + exactly one open state) row is sufficient to block.
  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'fm-fail-parsed.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'fmf1-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'committed');
  PERFORM public.stage_import_run_row(run_id, 2, '{}'::jsonb, '{}'::jsonb, 'fmf2-' || run_id);
  PERFORM public.close_import_run_staging(run_id);
  BEGIN PERFORM public.finalize_import_run(run_id); RAISE EXCEPTION 'finalized despite a parsed row';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_run_has_open_rows', 'terminal + parsed blocks finalization'); END;

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'fm-fail-approved.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'fmf3-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'committed');
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 2, '{}'::jsonb, '{}'::jsonb, 'fmf4-' || run_id); PERFORM public.set_import_run_row_review_state(row_id, 'valid', '[]'::jsonb, 'approved');
  PERFORM public.close_import_run_staging(run_id);
  BEGIN PERFORM public.finalize_import_run(run_id); RAISE EXCEPTION 'finalized despite an approved row';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_run_has_open_rows', 'terminal + approved blocks finalization'); END;

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'fm-fail-needsreview.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'fmf5-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'committed');
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 2, '{}'::jsonb, '{}'::jsonb, 'fmf6-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'needs_review');
  PERFORM public.close_import_run_staging(run_id);
  BEGIN PERFORM public.finalize_import_run(run_id); RAISE EXCEPTION 'finalized despite a needs_review row';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_run_has_open_rows', 'terminal + needs_review blocks finalization'); END;

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'fm-fail-commitfailed.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'fmf7-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'committed');
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 2, '{}'::jsonb, '{}'::jsonb, 'fmf8-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'commit_failed');
  PERFORM public.close_import_run_staging(run_id);
  BEGIN PERFORM public.finalize_import_run(run_id); RAISE EXCEPTION 'finalized despite a commit_failed row';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'import_run_has_open_rows', 'terminal + commit_failed blocks finalization'); END;
  PERFORM public.import_lifecycle_fixture_assert((SELECT status <> 'finalized' AND finalized_at IS NULL FROM public.import_runs WHERE id = run_id), 'blocked run remains unfinalized, no partial finalization state');

  -- ================= 8. FINALIZER EVIDENCE =================

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'fe-evidence.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'fe1-' || run_id); PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'committed');
  PERFORM public.close_import_run_staging(run_id);
  run_row := public.finalize_import_run(run_id);
  PERFORM public.import_lifecycle_fixture_assert(run_row.status = 'finalized' AND run_row.finalized_at IS NOT NULL AND run_row.finalized_by_auth_user_id = u_both, 'finalizer evidence: status, finalized_at, finalized_by_auth_user_id all recorded for the real actor');
  SELECT finalized_at INTO finalized_at_1 FROM public.import_runs WHERE id = run_id;
  run_row := public.finalize_import_run(run_id);
  SELECT finalized_at INTO finalized_at_2 FROM public.import_runs WHERE id = run_id;
  PERFORM public.import_lifecycle_fixture_assert(finalized_at_1 = finalized_at_2 AND run_row.finalized_by_auth_user_id = u_both, 'exact finalized replay is irreversible/stable -- finalized_at and finalizer never change on replay');

  -- Grandfathered pre-17000-style finalized run: finalized_at set, finalizer NULL.
  DECLARE r_grandfathered uuid := gen_random_uuid(); row_grandfathered uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.import_runs(id, event_id, import_type, source_filename, created_by_auth_user_id, status, finalized_at, finalized_by_auth_user_id)
      VALUES (r_grandfathered, ea, 'other', 'grandfathered.csv', u_both, 'finalized', now() - interval '30 days', NULL);
    INSERT INTO public.import_run_rows(id, import_run_id, event_id, source_row_number, source_payload, normalized_candidate, source_fingerprint, validation_state, review_state, row_state, commit_state, committed_at)
      VALUES (row_grandfathered, r_grandfathered, ea, 1, '{}'::jsonb, '{}'::jsonb, 'grandfathered-' || r_grandfathered, 'valid', 'approved', 'committed', 'committed', now() - interval '30 days');
    hist := public.get_finalized_import_run_history_detail(r_grandfathered);
    PERFORM public.import_lifecycle_fixture_assert(hist->'run'->>'id' = r_grandfathered::text, 'grandfathered null-finalizer run remains readable through History');
    PERFORM public.import_lifecycle_fixture_assert((SELECT count(*) FROM public.list_finalized_import_run_history(ea, NULL, NULL, 100) WHERE import_run_id = r_grandfathered AND finalized_by_display_identity IS NULL) = 1, 'History tolerates grandfathered NULL finalizer evidence without rewriting it');
    PERFORM public.import_lifecycle_fixture_assert((SELECT finalized_by_auth_user_id IS NULL FROM public.import_runs WHERE id = r_grandfathered), 'grandfathered row is not destructively rewritten');
  END;

  -- ================= 10. ACTIVE-RUN DISCOVERY =================

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'active-staging.csv', jsonb_build_object('private', 'never-active-history'));
  PERFORM public.stage_import_run_row(run_id, 1, jsonb_build_object('secret', 'never-active-history'), jsonb_build_object('candidate', 'never-active-history'), 'active-a-' || run_id);
  SELECT id INTO row_id2 FROM public.create_import_run(ea, 'other', 'active-ready.csv', '{}'::jsonb);
  PERFORM public.close_import_run_staging(row_id2);
  PERFORM public.import_lifecycle_fixture_assert((SELECT count(*) FROM public.list_active_import_runs(ea) WHERE import_run_id IN (run_id, row_id2)) = 2, 'multiple active runs (staging + ready_for_review) both discovered');
  PERFORM public.import_lifecycle_fixture_assert(NOT EXISTS (SELECT 1 FROM public.list_active_import_runs(ea) WHERE status = 'finalized'), 'finalized runs are excluded from active discovery');
  row_obj := (SELECT to_jsonb(x) FROM public.list_active_import_runs(ea) x WHERE import_run_id = run_id);
  PERFORM public.import_lifecycle_fixture_assert(row_obj::text !~ 'never-active-history', 'active discovery redacts source_payload/normalized_candidate/source_metadata');
  PERFORM set_config('request.jwt.claim.sub', u_cross::text, true);
  BEGIN PERFORM public.list_active_import_runs(ea); RAISE EXCEPTION 'cross-event caller saw active discovery';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', u_neither::text, true);
  BEGIN PERFORM public.list_active_import_runs(ea); RAISE EXCEPTION 'unauthorized caller saw active discovery';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', u_view_only::text, true);
  BEGIN PERFORM public.list_active_import_runs(ea); RAISE EXCEPTION 'view-only caller saw active discovery (manage required)';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN PERFORM public.list_active_import_runs(ea); RAISE EXCEPTION 'anon saw active discovery';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'missing_input', 'anon denied active discovery'); END;
  PERFORM set_config('request.jwt.claim.sub', u_both::text, true);

  -- ================= 11 & 12. HISTORY LIST + DETAIL =================

  PERFORM set_config('request.jwt.claim.sub', u_both::text, true);
  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'history-all.csv', jsonb_build_object('private', 'never-history-redacted'));
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, jsonb_build_object('secret', 'never-history-redacted'), jsonb_build_object('candidate', 'never-history-redacted'), 'hist-a-' || run_id);
  PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'committed');
  PERFORM public.close_import_run_staging(run_id); run_row := public.finalize_import_run(run_id);

  SELECT id INTO row_id2 FROM public.create_import_run(ea, 'other', 'history-still-active.csv', '{}'::jsonb); -- deliberately left active, must be excluded

  PERFORM set_config('request.jwt.claim.sub', u_view_only::text, true);
  PERFORM public.import_lifecycle_fixture_assert((SELECT count(*) FROM public.list_finalized_import_run_history(ea, NULL, NULL, 100) WHERE import_run_id = run_id) = 1, 'view-only caller sees the finalized run in History');
  PERFORM public.import_lifecycle_fixture_assert(NOT EXISTS (SELECT 1 FROM public.list_finalized_import_run_history(ea, NULL, NULL, 100) WHERE import_run_id = row_id2), 'active (non-finalized) runs excluded from History');
  row_obj := (SELECT to_jsonb(x) FROM public.list_finalized_import_run_history(ea, NULL, NULL, 100) x WHERE import_run_id = run_id);
  PERFORM public.import_lifecycle_fixture_assert(row_obj::text !~ 'never-history-redacted', 'History LIST itself redacts raw source evidence');

  hist := public.get_finalized_import_run_history_detail(run_id);
  PERFORM public.import_lifecycle_fixture_assert(hist::text !~ 'source_payload|normalized_candidate|never-history-redacted', 'History DETAIL redacts raw source_payload/normalized_candidate/source_metadata');
  PERFORM public.import_lifecycle_fixture_assert(hist::text !~ 'ERROR|SQLSTATE|pg_catalog', 'History DETAIL contains no raw SQL/exception internals');
  row_obj := (SELECT elem FROM jsonb_array_elements(hist->'rows') elem WHERE (elem->>'source_row_number')::int = 1);
  PERFORM public.import_lifecycle_fixture_assert(row_obj->>'terminal_disposition' = 'committed' AND row_obj ? 'commit_state' AND row_obj ? 'abandonment_reason_code', 'History DETAIL exposes safe per-row outcome fields (source row number, terminal disposition, bounded evidence)');

  -- manage-only caller (no .view) is denied History -- manage never implies view.
  PERFORM set_config('request.jwt.claim.sub', u_manage_only::text, true);
  BEGIN PERFORM public.list_finalized_import_run_history(ea, NULL, NULL, 100); RAISE EXCEPTION 'manage-only caller saw History (view required, not implied by manage)';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_finalized_import_run_history_detail(run_id); RAISE EXCEPTION 'manage-only caller saw History detail';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- ...but the SAME manage-only caller has no implicit canonical authority either (no broadening from the new lifecycle RPCs).
  PERFORM public.import_lifecycle_fixture_assert(NOT public.has_event_task_authority('event.attendees.manage', ea) AND NOT public.has_event_task_authority('event.vendors.manage', ea), 'imports-only authority grants no canonical Attendee/Vendor authority');

  PERFORM set_config('request.jwt.claim.sub', u_cross::text, true);
  BEGIN PERFORM public.list_finalized_import_run_history(ea, NULL, NULL, 100); RAISE EXCEPTION 'cross-event caller saw History list';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_finalized_import_run_history_detail(run_id); RAISE EXCEPTION 'cross-event caller saw History detail';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN PERFORM public.list_finalized_import_run_history(ea, NULL, NULL, 100); RAISE EXCEPTION 'anon saw History list';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'missing_input', 'anon denied History list'); END;
  BEGIN PERFORM public.get_finalized_import_run_history_detail(run_id); RAISE EXCEPTION 'anon saw History detail';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'missing_input', 'anon denied History detail'); END;

  -- ================= 13. get_import_run_status =================

  PERFORM set_config('request.jwt.claim.sub', u_both::text, true);
  SELECT * INTO status_row FROM public.get_import_run_status(run_id);
  PERFORM public.import_lifecycle_fixture_assert(status_row.import_run_id = run_id AND status_row.final_outcome IS NOT NULL, 'get_import_run_status executes end to end for a finalized run through the real hardened API (zero live application consumers found by repository-wide grep -- see closeout)');

  -- ================= 14. AUTHORITY MATRIX (lifecycle mutation) =================

  SELECT id INTO run_id FROM public.create_import_run(ea, 'other', 'authz-mutation.csv', '{}'::jsonb);
  PERFORM set_config('request.jwt.claim.sub', u_view_only::text, true);
  BEGIN PERFORM public.close_import_run_staging(run_id); RAISE EXCEPTION 'view-only caller performed a lifecycle mutation';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', u_neither::text, true);
  BEGIN PERFORM public.close_import_run_staging(run_id); RAISE EXCEPTION 'unauthorized caller performed a lifecycle mutation';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', u_cross::text, true);
  BEGIN PERFORM public.close_import_run_staging(run_id); RAISE EXCEPTION 'cross-event caller performed a lifecycle mutation';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN PERFORM public.close_import_run_staging(run_id); RAISE EXCEPTION 'anon performed a lifecycle mutation';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'missing_input', 'anon denied lifecycle mutation'); END;
  PERFORM set_config('request.jwt.claim.sub', u_manage_only::text, true);
  run_row := public.close_import_run_staging(run_id);
  PERFORM public.import_lifecycle_fixture_assert(run_row.status = 'ready_for_review', 'manage-only (no .view) caller IS allowed lifecycle mutation');

  -- ================= 15. NON-MUTABLE / ARCHIVED EVENT =================

  PERFORM set_config('request.jwt.claim.sub', u_both::text, true);
  -- A finalized run, to prove History survives archival.
  SELECT id INTO run_id FROM public.create_import_run(earch, 'other', 'archived-history.csv', '{}'::jsonb);
  SELECT id INTO row_id FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, '{}'::jsonb, 'archived-hist-' || run_id);
  PERFORM public.import_lifecycle_fixture_set_row_state(row_id, 'committed');
  PERFORM public.close_import_run_staging(run_id); run_row := public.finalize_import_run(run_id);
  -- A still-open run on the SAME Event, to prove lifecycle mutation is
  -- what fails closed once archived (not merely "already finalized").
  SELECT id INTO row_id2 FROM public.create_import_run(earch, 'other', 'archived-open.csv', '{}'::jsonb);
  UPDATE public.events SET lifecycle_state = 'archived' WHERE id = earch;
  BEGIN PERFORM public.close_import_run_staging(row_id2); RAISE EXCEPTION 'lifecycle mutation allowed on an archived Event';
  EXCEPTION WHEN OTHERS THEN PERFORM public.import_lifecycle_fixture_assert(SQLERRM = 'event_archived', 'lifecycle mutations fail closed once the Event is archived'); END;
  hist := public.get_finalized_import_run_history_detail(run_id);
  PERFORM public.import_lifecycle_fixture_assert(hist->'run'->>'id' = run_id::text, 'finalized History remains readable for an archived Event -- History never calls assert_event_lifecycle_mutable, so no lifecycle guard needed weakening');
  PERFORM public.import_lifecycle_fixture_assert((SELECT count(*) FROM public.list_finalized_import_run_history(earch, NULL, NULL, 50) WHERE import_run_id = run_id) = 1, 'archived-Event History list remains readable');

END $$;

ROLLBACK;
SELECT 'import lifecycle fixture PASS: outer rollback completed' AS result;
