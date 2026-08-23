-- Agenda Governed Imports: row correction linked-database rollback fixture.
-- The pending RPC definitions are installed only inside this outer
-- transaction. The migration structural test proves exact definition parity.
BEGIN;

CREATE TABLE public.import_run_row_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_row_id uuid NOT NULL REFERENCES public.import_run_rows(id) ON DELETE RESTRICT,
  import_run_id uuid NOT NULL REFERENCES public.import_runs(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  corrected_candidate jsonb NOT NULL CHECK (jsonb_typeof(corrected_candidate) = 'object'),
  validation_state text NOT NULL CHECK (validation_state IN ('valid', 'invalid')),
  validation_details jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_details) = 'array'),
  prior_row_state text NOT NULL,
  prior_validation_state text NOT NULL,
  prior_validation_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  correction_reason_code text NULL CHECK (correction_reason_code IS NULL OR correction_reason_code IN (
    'data_entry_error', 'source_file_error', 'ambiguous_date_resolved', 'duplicate_conflict_resolved', 'other'
  )),
  corrected_by_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  corrected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_run_row_id, revision)
);

CREATE INDEX import_run_row_corrections_row_revision_idx
  ON public.import_run_row_corrections (import_run_row_id, revision DESC);
CREATE INDEX import_run_row_corrections_run_idx
  ON public.import_run_row_corrections (import_run_id);

ALTER TABLE public.import_run_row_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.import_run_row_corrections FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prevent_import_run_row_corrections_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  RAISE EXCEPTION 'import row correction evidence is immutable';
END;
$$;

CREATE TRIGGER import_run_row_corrections_immutable
BEFORE UPDATE OR DELETE ON public.import_run_row_corrections
FOR EACH ROW EXECUTE FUNCTION public.prevent_import_run_row_corrections_mutation();

CREATE OR REPLACE FUNCTION public._agenda_import_candidate_is_well_formed(
  p_candidate jsonb, p_expected_source_row_number integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF jsonb_typeof(p_candidate) <> 'object' THEN RETURN false; END IF;
  IF (p_candidate ->> 'source_row_number') !~ '^[0-9]+$'
    OR (p_candidate ->> 'source_row_number')::numeric <> p_expected_source_row_number THEN
    RETURN false;
  END IF;
  IF nullif(btrim(p_candidate ->> 'title'), '') IS NULL THEN RETURN false; END IF;
  IF nullif(btrim(p_candidate ->> 'agenda_date'), '') IS NULL THEN RETURN false; END IF;
  IF nullif(btrim(p_candidate ->> 'start_time'), '') IS NULL THEN RETURN false; END IF;
  IF nullif(btrim(p_candidate ->> 'external_id'), '') IS NULL THEN RETURN false; END IF;
  IF jsonb_typeof(p_candidate -> 'is_published') <> 'boolean' THEN RETURN false; END IF;

  BEGIN
    PERFORM (p_candidate ->> 'agenda_date')::date;
    PERFORM (p_candidate ->> 'start_time')::time;
    IF nullif(p_candidate ->> 'end_time', '') IS NOT NULL THEN
      PERFORM (p_candidate ->> 'end_time')::time;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  RETURN true;
END;
$$;

ALTER FUNCTION public._agenda_import_candidate_is_well_formed(jsonb, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._agenda_import_candidate_is_well_formed(jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.correct_agenda_import_run_row(
  p_import_run_row_id uuid,
  p_expected_revision integer,
  p_corrected_candidate jsonb,
  p_validation_state text,
  p_validation_details jsonb,
  p_correction_reason_code text DEFAULT NULL
)
RETURNS TABLE(
  import_run_row_id uuid,
  row_state text,
  validation_state text,
  review_state text,
  revision integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_row public.import_run_rows%ROWTYPE;
  v_run public.import_runs%ROWTYPE;
  v_current_revision integer;
  v_new_revision integer;
  v_next_row_state text;
  v_next_review_state text;
  v_next_validation_state text;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_row_id IS NULL OR p_corrected_candidate IS NULL
    OR p_validation_state IS NULL OR p_validation_details IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;
  IF p_validation_state NOT IN ('valid', 'invalid') THEN
    RAISE EXCEPTION 'invalid_correction_validation_state' USING ERRCODE = '22023';
  END IF;
  IF p_correction_reason_code IS NOT NULL AND p_correction_reason_code NOT IN (
    'data_entry_error', 'source_file_error', 'ambiguous_date_resolved', 'duplicate_conflict_resolved', 'other'
  ) THEN
    RAISE EXCEPTION 'invalid_correction_reason_code' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.import_run_rows WHERE id = p_import_run_row_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import_row_not_found' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM public.import_runs WHERE id = v_row.import_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import_run_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_run.import_type <> 'agenda' THEN
    RAISE EXCEPTION 'import_run_not_agenda' USING ERRCODE = '22023';
  END IF;
  IF v_run.status = 'finalized' THEN
    RAISE EXCEPTION 'import_run_not_correctable' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_event_task_authority('event.imports.manage', v_row.event_id)
    OR NOT public.has_event_task_authority('event.agenda.manage', v_row.event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_row.event_id);

  IF v_row.abandoned_at IS NOT NULL THEN
    RAISE EXCEPTION 'import_row_already_abandoned' USING ERRCODE = '22023';
  END IF;
  IF v_row.row_state NOT IN ('validation_failed', 'approved') THEN
    RAISE EXCEPTION 'import_row_not_correctable' USING ERRCODE = '22023';
  END IF;

  SELECT max(c.revision) INTO v_current_revision
  FROM public.import_run_row_corrections AS c
  WHERE c.import_run_row_id = v_row.id;
  v_current_revision := coalesce(v_current_revision, 0);

  IF coalesce(p_expected_revision, 0) <> v_current_revision THEN
    RAISE EXCEPTION 'stale_correction_conflict' USING ERRCODE = '40001';
  END IF;
  v_new_revision := v_current_revision + 1;

  v_next_validation_state := CASE WHEN p_validation_state = 'valid' THEN 'valid' ELSE 'invalid' END;

  IF p_validation_state = 'valid' THEN
    IF NOT public._agenda_import_candidate_is_well_formed(p_corrected_candidate, v_row.source_row_number) THEN
      RAISE EXCEPTION 'corrected_candidate_malformed' USING ERRCODE = '22023';
    END IF;
    v_next_row_state := 'approved';
    v_next_review_state := 'approved';
  ELSE
    v_next_row_state := 'validation_failed';
    v_next_review_state := 'unreviewed';
  END IF;

  INSERT INTO public.import_run_row_corrections (
    import_run_row_id, import_run_id, event_id, revision, corrected_candidate,
    validation_state, validation_details, prior_row_state, prior_validation_state,
    prior_validation_details, correction_reason_code, corrected_by_auth_user_id
  ) VALUES (
    v_row.id, v_row.import_run_id, v_row.event_id, v_new_revision, p_corrected_candidate,
    v_next_validation_state, coalesce(p_validation_details, '[]'::jsonb), v_row.row_state,
    v_row.validation_state, v_row.validation_details, p_correction_reason_code, auth.uid()
  );

  UPDATE public.import_run_rows
  SET validation_state = v_next_validation_state,
      validation_details = coalesce(p_validation_details, '[]'::jsonb),
      review_state = v_next_review_state,
      row_state = v_next_row_state,
      updated_at = now()
  WHERE id = v_row.id;

  RETURN QUERY SELECT v_row.id, v_next_row_state, v_next_validation_state, v_next_review_state, v_new_revision;
END;
$$;

ALTER FUNCTION public.correct_agenda_import_run_row(uuid, integer, jsonb, text, jsonb, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.correct_agenda_import_run_row(uuid, integer, jsonb, text, jsonb, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.correct_agenda_import_run_row(uuid, integer, jsonb, text, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_agenda_import_row_corrections(p_import_run_row_id uuid)
RETURNS TABLE(
  id uuid,
  revision integer,
  corrected_candidate jsonb,
  validation_state text,
  validation_details jsonb,
  prior_row_state text,
  prior_validation_state text,
  prior_validation_details jsonb,
  correction_reason_code text,
  corrected_by_auth_user_id uuid,
  corrected_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_row public.import_run_rows%ROWTYPE;
  v_run public.import_runs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_row_id IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.import_run_rows WHERE id = p_import_run_row_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import_row_not_found' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM public.import_runs WHERE id = v_row.import_run_id;
  IF NOT FOUND OR v_run.import_type <> 'agenda' THEN
    RAISE EXCEPTION 'import_run_not_agenda' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_event_task_authority('event.imports.manage', v_row.event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT c.id, c.revision, c.corrected_candidate, c.validation_state, c.validation_details,
         c.prior_row_state, c.prior_validation_state, c.prior_validation_details,
         c.correction_reason_code, c.corrected_by_auth_user_id, c.corrected_at
  FROM public.import_run_row_corrections AS c
  WHERE c.import_run_row_id = v_row.id
  ORDER BY c.revision ASC;
END;
$$;

ALTER FUNCTION public.get_agenda_import_row_corrections(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_agenda_import_row_corrections(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_agenda_import_row_corrections(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_agenda_import_row_correction_summaries(p_import_run_id uuid)
RETURNS TABLE(
  import_run_row_id uuid,
  correction_count integer,
  latest_revision integer,
  latest_corrected_candidate jsonb,
  latest_validation_state text,
  latest_validation_details jsonb,
  latest_corrected_by_auth_user_id uuid,
  latest_corrected_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_run public.import_runs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_id IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM public.import_runs WHERE id = p_import_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import_run_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_run.import_type <> 'agenda' THEN
    RAISE EXCEPTION 'import_run_not_agenda' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_event_task_authority('event.imports.manage', v_run.event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (c.import_run_row_id)
    c.import_run_row_id,
    count(*) OVER (PARTITION BY c.import_run_row_id) AS correction_count,
    c.revision,
    c.corrected_candidate,
    c.validation_state,
    c.validation_details,
    c.corrected_by_auth_user_id,
    c.corrected_at
  FROM public.import_run_row_corrections AS c
  WHERE c.import_run_id = v_run.id
  ORDER BY c.import_run_row_id, c.revision DESC;
END;
$$;

ALTER FUNCTION public.list_agenda_import_row_correction_summaries(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_agenda_import_row_correction_summaries(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_agenda_import_row_correction_summaries(uuid) TO authenticated;

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
  IF v_row.row_state = 'committed' THEN
    RAISE EXCEPTION 'import_row_terminal' USING ERRCODE = '22023';
  END IF;
  IF v_row.row_state = 'validation_failed' AND NOT EXISTS (
    SELECT 1 FROM public.import_run_row_corrections WHERE import_run_row_id = v_row.id
  ) THEN
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
  UPDATE public.import_run_rows AS r
  SET abandoned_at = now(),
      abandoned_by_auth_user_id = auth.uid(),
      abandonment_reason_code = p_abandonment_reason_code,
      updated_at = now()
  WHERE r.import_run_id = v_run.id
    AND r.abandoned_at IS NULL
    AND r.row_state <> 'committed'
    AND (
      r.row_state <> 'validation_failed'
      OR EXISTS (SELECT 1 FROM public.import_run_row_corrections c WHERE c.import_run_row_id = r.id)
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER FUNCTION public.abandon_import_run_row(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.abandon_import_run_open_rows(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.abandon_import_run_row(uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.abandon_import_run_open_rows(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.abandon_import_run_row(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_import_run_open_rows(uuid, text) TO authenticated;

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

  -- Effective candidate per eligible row: the latest *valid* correction
  -- overlay if one exists for this row, otherwise the row's own immutable
  -- normalized_candidate. was_corrected records which source was used, for
  -- audit evidence in commit_result below.
  IF EXISTS (
    SELECT 1
    FROM public.import_run_rows AS r
    LEFT JOIN LATERAL (
      SELECT c.corrected_candidate
      FROM public.import_run_row_corrections AS c
      WHERE c.import_run_row_id = r.id AND c.validation_state = 'valid'
      ORDER BY c.revision DESC
      LIMIT 1
    ) AS lc ON true
    WHERE r.import_run_id = v_run.id
      AND r.abandoned_at IS NULL
      AND r.row_state IN ('approved', 'commit_failed')
      AND NOT public._agenda_import_candidate_is_well_formed(
        coalesce(lc.corrected_candidate, r.normalized_candidate), r.source_row_number
      )
  ) THEN
    RAISE EXCEPTION 'staged_agenda_candidate_malformed' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT coalesce(lc.corrected_candidate, r.normalized_candidate) ->> 'external_id'
    FROM public.import_run_rows AS r
    LEFT JOIN LATERAL (
      SELECT c.corrected_candidate
      FROM public.import_run_row_corrections AS c
      WHERE c.import_run_row_id = r.id AND c.validation_state = 'valid'
      ORDER BY c.revision DESC
      LIMIT 1
    ) AS lc ON true
    WHERE r.import_run_id = v_run.id
      AND r.abandoned_at IS NULL
      AND r.row_state IN ('approved', 'commit_failed')
    GROUP BY coalesce(lc.corrected_candidate, r.normalized_candidate) ->> 'external_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_agenda_external_id_in_commit_batch' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(coalesce(lc.corrected_candidate, r.normalized_candidate) ORDER BY r.source_row_number)
  INTO v_rows
  FROM public.import_run_rows AS r
  LEFT JOIN LATERAL (
    SELECT c.corrected_candidate
    FROM public.import_run_row_corrections AS c
    WHERE c.import_run_row_id = r.id AND c.validation_state = 'valid'
    ORDER BY c.revision DESC
    LIMIT 1
  ) AS lc ON true
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

  WITH effective AS (
    SELECT
      r.id AS row_id,
      r.source_fingerprint,
      coalesce(lc.corrected_candidate, r.normalized_candidate) AS effective_candidate,
      (lc.corrected_candidate IS NOT NULL) AS was_corrected
    FROM public.import_run_rows AS r
    LEFT JOIN LATERAL (
      SELECT c.corrected_candidate
      FROM public.import_run_row_corrections AS c
      WHERE c.import_run_row_id = r.id AND c.validation_state = 'valid'
      ORDER BY c.revision DESC
      LIMIT 1
    ) AS lc ON true
    WHERE r.import_run_id = v_run.id
      AND r.abandoned_at IS NULL
      AND r.row_state IN ('approved', 'commit_failed')
  ),
  targets AS (
    SELECT effective.row_id, effective.source_fingerprint, effective.was_corrected, ai.id AS agenda_item_id
    FROM effective
    JOIN public.agenda_items AS ai
      ON ai.event_id = v_run.event_id
     AND ai.external_id = effective.effective_candidate ->> 'external_id'
  )
  UPDATE public.import_run_rows AS r
  SET row_state = 'committed',
      commit_state = 'committed',
      canonical_target_id = targets.agenda_item_id,
      commit_result = jsonb_build_object(
        'agenda_item_id', targets.agenda_item_id,
        'source_row_fingerprint', targets.source_fingerprint,
        'agenda_version', v_new_version,
        'batch_row_count', v_imported,
        'source', CASE WHEN targets.was_corrected THEN 'correction' ELSE 'original' END
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

CREATE OR REPLACE FUNCTION public.get_finalized_import_run_history_detail(p_import_run_id uuid)
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
        'was_corrected', c.import_run_row_id IS NOT NULL,
        'created_at', r.created_at, 'updated_at', r.updated_at,
        'committed_at', r.committed_at, 'abandoned_at', r.abandoned_at
      ) ORDER BY r.source_row_number)
      FROM public.import_run_rows r
      LEFT JOIN (
        SELECT DISTINCT import_run_row_id FROM public.import_run_row_corrections
      ) c ON c.import_run_row_id = r.id
      WHERE r.import_run_id = v_run.id
    ), '[]'::jsonb)
  );
END;
$$;

ALTER FUNCTION public.get_finalized_import_run_history_detail(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_finalized_import_run_history_detail(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_finalized_import_run_history_detail(uuid) TO authenticated;

-- ===================== fixture-only helpers =====================

CREATE FUNCTION public.corr_fixture_assert(p_ok boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'corr_fixture_assertion_failed: %', p_message;
  END IF;
END;
$$;

CREATE FUNCTION public.corr_fixture_candidate(
  p_source_row_number integer,
  p_title text,
  p_agenda_date text,
  p_start_time text,
  p_external_id text
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'source_row_number', p_source_row_number,
    'title', p_title,
    'description', 'Fixture description ' || p_source_row_number,
    'location', 'Fixture location',
    'speaker', 'Fixture speaker',
    'agenda_date', p_agenda_date,
    'start_time', p_start_time,
    'end_time', '10:00',
    'category', 'Fixture category',
    'color', '#ABCDEF',
    'is_published', false,
    'sort_order', p_source_row_number,
    'external_id', p_external_id
  );
$$;

-- ===================== fixture data + proofs =====================

DO $$
DECLARE
  v_tenant uuid := 'c0770000-0000-0000-0000-000000000001';
  v_event_a uuid := 'c0770000-0000-0000-0000-000000000002';
  v_event_b uuid := 'c0770000-0000-0000-0000-000000000003';
  v_both uuid := 'c0770000-0000-0000-0000-000000000011';
  v_imports uuid := 'c0770000-0000-0000-0000-000000000012';
  v_agenda uuid := 'c0770000-0000-0000-0000-000000000013';
  v_neither uuid := 'c0770000-0000-0000-0000-000000000014';
  v_run uuid;
  v_row1 uuid; -- originally invalid (missing title); the correction protagonist
  v_row2 uuid; -- originally valid, staged approved, never corrected
  v_row3 uuid; -- originally invalid, never corrected (negative control)
  v_cross_event_run_id uuid;
  v_vendors_run uuid;
  v_original_payload jsonb;
  v_original_candidate jsonb;
  v_original_fingerprint text;
  v_outcome text;
  v_imported integer;
  v_version integer;
  v_revision integer;
  v_row_state text;
  v_failed boolean;
  v_recovery jsonb;
  v_corrections jsonb;
  v_summaries jsonb;
  v_history_detail jsonb;
BEGIN
  INSERT INTO public.tenants(
    id, organization_code, slug, organization_name, display_name, app_title
  ) VALUES (
    v_tenant, 'AGENDA-CORR', 'agenda-correction-fixture',
    'Agenda Correction Fixture', 'Agenda Correction Fixture', 'Agenda Correction Fixture'
  );

  INSERT INTO public.events(id, tenant_id, name, start_date, end_date, timezone, lifecycle_state)
  VALUES
    (v_event_a, v_tenant, 'agenda-correction-event-a', current_date, current_date + 30, 'UTC', 'operational'),
    (v_event_b, v_tenant, 'agenda-correction-event-b', current_date, current_date + 30, 'UTC', 'operational');

  INSERT INTO auth.users(id, email) VALUES
    (v_both, 'agenda-correction-both@fixture.invalid'),
    (v_imports, 'agenda-correction-imports@fixture.invalid'),
    (v_agenda, 'agenda-correction-agenda@fixture.invalid'),
    (v_neither, 'agenda-correction-neither@fixture.invalid');

  INSERT INTO public.admin_users(user_id, email, display_name) VALUES
    (v_both, 'agenda-correction-both@fixture.invalid', 'Agenda Correction Both'),
    (v_imports, 'agenda-correction-imports@fixture.invalid', 'Agenda Correction Imports'),
    (v_agenda, 'agenda-correction-agenda@fixture.invalid', 'Agenda Correction Agenda'),
    (v_neither, 'agenda-correction-neither@fixture.invalid', 'Agenda Correction Neither');

  INSERT INTO public.admin_event_access(admin_user_id, event_id, role)
  SELECT id, v_event_a, 'event_admin'
  FROM public.admin_users
  WHERE user_id IN (v_both, v_imports, v_agenda, v_neither);

  INSERT INTO public.admin_event_permissions(admin_event_access_id, permission_key)
  SELECT access.id, task.task_key
  FROM public.admin_event_access AS access
  JOIN public.admin_users AS admin ON admin.id = access.admin_user_id
  CROSS JOIN (VALUES ('event.imports.manage'), ('event.imports.view'), ('event.agenda.manage')) AS task(task_key)
  WHERE admin.user_id = v_both AND access.event_id = v_event_a;

  INSERT INTO public.admin_event_permissions(admin_event_access_id, permission_key)
  SELECT access.id, 'event.imports.manage'
  FROM public.admin_event_access AS access
  JOIN public.admin_users AS admin ON admin.id = access.admin_user_id
  WHERE admin.user_id = v_imports AND access.event_id = v_event_a;

  INSERT INTO public.admin_event_permissions(admin_event_access_id, permission_key)
  SELECT access.id, 'event.agenda.manage'
  FROM public.admin_event_access AS access
  JOIN public.admin_users AS admin ON admin.id = access.admin_user_id
  WHERE admin.user_id = v_agenda AND access.event_id = v_event_a;

  PERFORM set_config('request.jwt.claim.sub', v_both::text, true);

  -- Stage a run: row1 invalid (blank title), row2 valid, row3 invalid
  -- (never corrected, the negative control for abandonment).
  SELECT id INTO v_run
  FROM public.create_import_run(
    v_event_a, 'agenda', 'agenda-correction.csv',
    jsonb_build_object('row_count', 3, 'expected_agenda_version', 0)
  );

  SELECT id INTO v_row1
  FROM public.stage_import_run_row(
    v_run, 2, jsonb_build_object('Title', ''),
    public.corr_fixture_candidate(2, NULL, '2026-10-01', '09:00', NULL),
    'agenda-correction-row1'
  );
  PERFORM public.set_import_run_row_review_state(
    v_row1, 'invalid', '[{"code":"missing_agenda_title","message":"Missing Title","severity":"error"}]'::jsonb, 'unreviewed'
  );

  SELECT id INTO v_row2
  FROM public.stage_import_run_row(
    v_run, 3, jsonb_build_object('Title', 'Untouched Valid Row'),
    public.corr_fixture_candidate(3, 'Untouched Valid Row', '2026-10-01', '10:00', 'agenda-correction-row2'),
    'agenda-correction-row2'
  );
  PERFORM public.set_import_run_row_review_state(v_row2, 'valid', '[]'::jsonb, 'approved');

  SELECT id INTO v_row3
  FROM public.stage_import_run_row(
    v_run, 4, jsonb_build_object('Title', ''),
    public.corr_fixture_candidate(4, NULL, '2026-10-01', '11:00', NULL),
    'agenda-correction-row3'
  );
  PERFORM public.set_import_run_row_review_state(
    v_row3, 'invalid', '[{"code":"missing_agenda_title","message":"Missing Title","severity":"error"}]'::jsonb, 'unreviewed'
  );

  SELECT source_payload, normalized_candidate, source_fingerprint
  INTO v_original_payload, v_original_candidate, v_original_fingerprint
  FROM public.import_run_rows WHERE id = v_row1;

  -- Authority composition: imports-only, agenda-only, neither, cross-Event,
  -- wrong-type all denied with zero mutation.
  PERFORM set_config('request.jwt.claim.sub', v_imports::text, true);
  v_failed := false;
  BEGIN
    PERFORM public.correct_agenda_import_run_row(
      v_row1, 0, public.corr_fixture_candidate(2, 'Fixed Title', '2026-10-01', '09:00', 'agenda-correction-row1-fixed'),
      'valid', '[]'::jsonb, NULL
    );
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'not_authorized'; END;
  PERFORM public.corr_fixture_assert(v_failed, 'imports-only correction denied');

  PERFORM set_config('request.jwt.claim.sub', v_agenda::text, true);
  v_failed := false;
  BEGIN
    PERFORM public.correct_agenda_import_run_row(
      v_row1, 0, public.corr_fixture_candidate(2, 'Fixed Title', '2026-10-01', '09:00', 'agenda-correction-row1-fixed'),
      'valid', '[]'::jsonb, NULL
    );
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'not_authorized'; END;
  PERFORM public.corr_fixture_assert(v_failed, 'agenda-only correction denied');

  PERFORM set_config('request.jwt.claim.sub', v_neither::text, true);
  v_failed := false;
  BEGIN
    PERFORM public.correct_agenda_import_run_row(
      v_row1, 0, public.corr_fixture_candidate(2, 'Fixed Title', '2026-10-01', '09:00', 'agenda-correction-row1-fixed'),
      'valid', '[]'::jsonb, NULL
    );
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'not_authorized'; END;
  PERFORM public.corr_fixture_assert(v_failed, 'neither-authority correction denied');

  -- Cross-Event: v_both has authority only on event_a; a run truly on
  -- event_b is untouchable even by the same person.
  INSERT INTO public.import_runs(id, event_id, import_type, source_metadata, created_by_auth_user_id)
  VALUES (gen_random_uuid(), v_event_b, 'agenda', '{"row_count":0,"expected_agenda_version":0}', v_both)
  RETURNING id INTO v_cross_event_run_id;
  PERFORM set_config('request.jwt.claim.sub', v_both::text, true);
  v_failed := false;
  DECLARE v_cross_row uuid;
  BEGIN
    INSERT INTO public.import_run_rows(
      import_run_id, event_id, source_row_number, source_payload, normalized_candidate, source_fingerprint,
      validation_state, review_state, row_state
    ) VALUES (
      v_cross_event_run_id, v_event_b, 2, '{}'::jsonb,
      public.corr_fixture_candidate(2, 'Cross Event', '2026-10-01', '09:00', 'agenda-correction-cross'),
      'agenda-correction-cross', 'invalid', 'unreviewed', 'validation_failed'
    ) RETURNING id INTO v_cross_row;
    BEGIN
      PERFORM public.correct_agenda_import_run_row(
        v_cross_row, 0, public.corr_fixture_candidate(2, 'Cross Event Fixed', '2026-10-01', '09:00', 'agenda-correction-cross-fixed'),
        'valid', '[]'::jsonb, NULL
      );
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'not_authorized'; END;
  END;
  PERFORM public.corr_fixture_assert(v_failed, 'cross-Event correction denied');

  -- Wrong import type: correcting a row that belongs to a non-agenda run.
  DECLARE v_vendors_row uuid;
  BEGIN
    INSERT INTO public.import_runs(id, event_id, import_type, source_metadata, created_by_auth_user_id)
    VALUES (gen_random_uuid(), v_event_a, 'vendors', '{}'::jsonb, v_both)
    RETURNING id INTO v_vendors_run;
    INSERT INTO public.import_run_rows(
      import_run_id, event_id, source_row_number, source_payload, normalized_candidate, source_fingerprint,
      validation_state, review_state, row_state
    ) VALUES (
      v_vendors_run, v_event_a, 2, '{}'::jsonb, '{}'::jsonb, 'agenda-correction-vendors-row',
      'invalid', 'unreviewed', 'validation_failed'
    ) RETURNING id INTO v_vendors_row;
    v_failed := false;
    BEGIN
      PERFORM public.correct_agenda_import_run_row(
        v_vendors_row, 0, '{}'::jsonb, 'valid', '[]'::jsonb, NULL
      );
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'import_run_not_agenda'; END;
    PERFORM public.corr_fixture_assert(v_failed, 'wrong import type correction denied');
  END;

  -- Original evidence untouched by every denied attempt.
  PERFORM public.corr_fixture_assert(
    (SELECT source_payload = v_original_payload AND normalized_candidate = v_original_candidate
       AND source_fingerprint = v_original_fingerprint
     FROM public.import_run_rows WHERE id = v_row1),
    'denied correction attempts left row1 source evidence untouched'
  );

  -- A genuine, both-authority correction: fix the title, become valid.
  PERFORM set_config('request.jwt.claim.sub', v_both::text, true);
  SELECT row_state, revision INTO v_row_state, v_revision
  FROM public.correct_agenda_import_run_row(
    v_row1, 0, public.corr_fixture_candidate(2, 'Fixed Title', '2026-10-01', '09:00', 'agenda-correction-row1-fixed'),
    'valid', '[]'::jsonb, 'data_entry_error'
  );
  PERFORM public.corr_fixture_assert(v_row_state = 'approved' AND v_revision = 1, 'valid correction becomes approved at revision 1');

  -- Original evidence is STILL untouched after a successful correction --
  -- the whole point of the additive-overlay model.
  PERFORM public.corr_fixture_assert(
    (SELECT source_payload = v_original_payload AND normalized_candidate = v_original_candidate
       AND source_fingerprint = v_original_fingerprint
     FROM public.import_run_rows WHERE id = v_row1),
    'original source_payload/normalized_candidate/source_fingerprint remain immutable after a successful correction'
  );

  -- The correction record itself: actor, timestamp, prior state preserved.
  v_corrections := (SELECT jsonb_agg(row_to_json(c)) FROM public.get_agenda_import_row_corrections(v_row1) AS c);
  PERFORM public.corr_fixture_assert(
    jsonb_array_length(v_corrections) = 1
      AND v_corrections #>> '{0,corrected_by_auth_user_id}' = v_both::text
      AND v_corrections #>> '{0,corrected_at}' IS NOT NULL
      AND v_corrections #>> '{0,prior_row_state}' = 'validation_failed'
      AND v_corrections #>> '{0,prior_validation_state}' = 'invalid'
      AND v_corrections #>> '{0,correction_reason_code}' = 'data_entry_error',
    'correction actor/timestamp/prior-state evidence persists and matches the true original'
  );

  -- Stale concurrent correction (still claiming revision 0) is rejected
  -- deterministically rather than silently overwriting revision 1.
  v_failed := false;
  BEGIN
    PERFORM public.correct_agenda_import_run_row(
      v_row1, 0, public.corr_fixture_candidate(2, 'Stale Overwrite Attempt', '2026-10-01', '09:00', 'agenda-correction-row1-stale'),
      'valid', '[]'::jsonb, NULL
    );
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'stale_correction_conflict'; END;
  PERFORM public.corr_fixture_assert(v_failed, 'stale correction (wrong expected_revision) rejected deterministically');
  PERFORM public.corr_fixture_assert(
    (SELECT row_state = 'approved' FROM public.import_run_rows WHERE id = v_row1),
    'the stale rejection did not disturb the real revision-1 state'
  );

  -- Correct again (revision 1 -> 2), this time still invalid: proves a
  -- still-invalid correction remains non-committable and the row returns to
  -- Needs Attention with fresh validation evidence, while revision 1's
  -- audit trail is preserved (full revision history, not overwritten).
  SELECT row_state, revision INTO v_row_state, v_revision
  FROM public.correct_agenda_import_run_row(
    v_row1, 1, public.corr_fixture_candidate(2, '', '2026-10-01', '09:00', NULL),
    'invalid', '[{"code":"missing_agenda_title","message":"Still missing","severity":"error"}]'::jsonb, 'other'
  );
  PERFORM public.corr_fixture_assert(v_row_state = 'validation_failed' AND v_revision = 2, 'a still-invalid correction remains non-committable (back to validation_failed)');
  v_corrections := (SELECT jsonb_agg(row_to_json(c) ORDER BY (row_to_json(c)->>'revision')::int) FROM public.get_agenda_import_row_corrections(v_row1) AS c);
  PERFORM public.corr_fixture_assert(
    jsonb_array_length(v_corrections) = 2
      AND v_corrections #>> '{0,revision}' = '1' AND v_corrections #>> '{1,revision}' = '2'
      AND v_corrections #>> '{1,prior_row_state}' = 'approved',
    'full revision history is kept, not overwritten -- revision 1 remains readable after revision 2 is recorded'
  );

  -- The run-scoped bulk summary RPC (what recovery actually calls) agrees:
  -- exactly one corrected row (row1, at its latest revision), nothing for
  -- the never-corrected row2/row3.
  v_summaries := (SELECT jsonb_agg(row_to_json(s)) FROM public.list_agenda_import_row_correction_summaries(v_run) AS s);
  PERFORM public.corr_fixture_assert(
    jsonb_array_length(v_summaries) = 1
      AND v_summaries #>> '{0,import_run_row_id}' = v_row1::text
      AND (v_summaries #>> '{0,correction_count}')::int = 2
      AND (v_summaries #>> '{0,latest_revision}')::int = 2
      AND v_summaries #>> '{0,latest_validation_state}' = 'invalid',
    'run-scoped correction summary reports exactly the one corrected row at its latest revision'
  );

  -- A never-corrected validation_failed row (row3) still cannot be
  -- abandoned -- the pre-existing invariant is unchanged.
  v_failed := false;
  BEGIN
    PERFORM public.abandon_import_run_row(v_row3, 'cannot_resolve');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'import_row_terminal'; END;
  PERFORM public.corr_fixture_assert(v_failed, 'a bare never-corrected validation_failed row remains unabandonable');

  -- But row1, now validation_failed WITH correction history, CAN be
  -- skipped -- proving the narrow abandonment extension. Do it, then
  -- immediately assert that saving a correction on an abandoned row is
  -- rejected ("operator saves a correction after the row was skipped").
  PERFORM public.abandon_import_run_row(v_row1, 'cannot_resolve');
  v_failed := false;
  BEGIN
    PERFORM public.correct_agenda_import_run_row(
      v_row1, 2, public.corr_fixture_candidate(2, 'Too Late', '2026-10-01', '09:00', 'agenda-correction-row1-too-late'),
      'valid', '[]'::jsonb, NULL
    );
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'import_row_already_abandoned'; END;
  PERFORM public.corr_fixture_assert(v_failed, 'a corrected-but-still-invalid row can be skipped once corrected, and correcting an abandoned row is refused');

  -- Recovery reflects skipped truth; row1 is out of the commit picture now.
  v_recovery := public.get_managed_import_run_recovery(v_run);
  PERFORM public.corr_fixture_assert(
    (v_recovery -> 'rows' -> 0 ->> 'abandoned_at') IS NOT NULL,
    'recovery reflects row1 as abandoned'
  );

  -- Commit the run: only row2 (original valid) is eligible now. Proves an
  -- ordinary, uncorrected row commits normally alongside the correction
  -- machinery's existence.
  PERFORM public.close_import_run_staging(v_run);
  SELECT outcome, imported_count, new_version INTO v_outcome, v_imported, v_version
  FROM public.commit_agenda_import_run(v_run);
  PERFORM public.corr_fixture_assert(v_outcome = 'committed' AND v_imported = 1 AND v_version = 1, 'commit succeeds for the one remaining eligible (never-corrected) row');

  -- row3 is validation_failed (resolved-enough for finalize); row1 is
  -- abandoned; row2 is committed. Finalize should now succeed.
  PERFORM public.finalize_import_run(v_run);
  PERFORM public.corr_fixture_assert(
    (SELECT status = 'finalized' FROM public.import_runs WHERE id = v_run),
    'finalize succeeds once every row is committed, validation-failed, or abandoned'
  );

  v_history_detail := public.get_finalized_import_run_history_detail(v_run);
  PERFORM public.corr_fixture_assert(
    (SELECT bool_and((row->>'was_corrected')::boolean = false)
       FROM jsonb_array_elements(v_history_detail -> 'rows') row
      WHERE (row->>'source_row_number')::int = 3),
    'History correctly marks the never-corrected row3 as not corrected'
  );
  PERFORM public.corr_fixture_assert(
    (SELECT (row->>'was_corrected')::boolean = true
       FROM jsonb_array_elements(v_history_detail -> 'rows') row
      WHERE (row->>'source_row_number')::int = 2) IS NOT TRUE,
    'History correctly marks the never-corrected row2 as not corrected'
  );

  -- ============================================================
  -- Second run: prove the commit path uses the CORRECTED candidate, not
  -- the stale original invalid one, and that this survives an atomic
  -- multi-row batch with a stale-version guard still active.
  -- ============================================================
  DECLARE
    v_run2 uuid;
    v_run2_row1 uuid;
    v_run2_row2 uuid;
    v_before_items integer;
  BEGIN
    SELECT id INTO v_run2
    FROM public.create_import_run(
      v_event_a, 'agenda', 'agenda-correction-2.csv',
      jsonb_build_object('row_count', 2, 'expected_agenda_version', 1)
    );
    SELECT id INTO v_run2_row1
    FROM public.stage_import_run_row(
      v_run2, 2, jsonb_build_object('Title', ''),
      public.corr_fixture_candidate(2, NULL, '2026-10-02', '09:00', NULL),
      'agenda-correction-run2-row1'
    );
    PERFORM public.set_import_run_row_review_state(
      v_run2_row1, 'invalid', '[{"code":"missing_agenda_title","message":"Missing Title","severity":"error"}]'::jsonb, 'unreviewed'
    );
    SELECT id INTO v_run2_row2
    FROM public.stage_import_run_row(
      v_run2, 3, jsonb_build_object('Title', 'Run2 Valid'),
      public.corr_fixture_candidate(3, 'Run2 Valid', '2026-10-02', '10:00', 'agenda-correction-run2-row2'),
      'agenda-correction-run2-row2'
    );
    PERFORM public.set_import_run_row_review_state(v_run2_row2, 'valid', '[]'::jsonb, 'approved');

    -- Correct row1 to a real title distinct from the frozen original NULL.
    PERFORM public.correct_agenda_import_run_row(
      v_run2_row1, 0, public.corr_fixture_candidate(2, 'Corrected Title Wins', '2026-10-02', '09:00', 'agenda-correction-run2-row1-fixed'),
      'valid', '[]'::jsonb, NULL
    );

    SELECT count(*) INTO v_before_items FROM public.agenda_items WHERE event_id = v_event_a;
    SELECT outcome, imported_count, new_version INTO v_outcome, v_imported, v_version
    FROM public.commit_agenda_import_run(v_run2);
    PERFORM public.corr_fixture_assert(
      v_outcome = 'committed' AND v_imported = 2,
      'atomic batch with one corrected + one original row commits both together'
    );
    PERFORM public.corr_fixture_assert(
      (SELECT title FROM public.agenda_items WHERE event_id = v_event_a AND external_id = 'agenda-correction-run2-row1-fixed') = 'Corrected Title Wins',
      'commit used the CORRECTED candidate -- the original invalid (blank-title, NULL-external-id) candidate could not have produced this row at all'
    );
    PERFORM public.corr_fixture_assert(
      (SELECT count(*) FROM public.agenda_items WHERE event_id = v_event_a) = v_before_items + 2,
      'exactly two new canonical Agenda rows were inserted, matching the eligible count'
    );
    PERFORM public.corr_fixture_assert(
      (SELECT commit_result ->> 'source' FROM public.import_run_rows WHERE id = v_run2_row1) = 'correction',
      'commit_result records that row1''s committed data came from a correction'
    );
    PERFORM public.corr_fixture_assert(
      (SELECT commit_result ->> 'source' FROM public.import_run_rows WHERE id = v_run2_row2) = 'original',
      'commit_result records that row2''s committed data came from the original candidate'
    );
    -- Original evidence for run2's corrected row remains exactly the
    -- pre-correction frozen candidate even after a successful commit.
    PERFORM public.corr_fixture_assert(
      (SELECT normalized_candidate ->> 'title' FROM public.import_run_rows WHERE id = v_run2_row1) IS NULL,
      'the original normalized_candidate.title (NULL) remains exactly as staged, even after commit used the corrected value'
    );
  END;

  -- ============================================================
  -- Third run: a stale Agenda version blocks commit even when the run's
  -- one row carries a valid correction -- the version fence cannot be
  -- bypassed through the correction path.
  -- ============================================================
  DECLARE
    v_run3 uuid;
    v_run3_row uuid;
    v_before_version integer;
    v_before_items3 integer;
  BEGIN
    SELECT id INTO v_run3
    FROM public.create_import_run(
      v_event_a, 'agenda', 'agenda-correction-3.csv',
      jsonb_build_object('row_count', 1, 'expected_agenda_version', 0) -- already stale: real version is now 2
    );
    SELECT id INTO v_run3_row
    FROM public.stage_import_run_row(
      v_run3, 2, jsonb_build_object('Title', ''),
      public.corr_fixture_candidate(2, NULL, '2026-10-03', '09:00', NULL),
      'agenda-correction-run3-row'
    );
    PERFORM public.set_import_run_row_review_state(
      v_run3_row, 'invalid', '[{"code":"missing_agenda_title","message":"Missing Title","severity":"error"}]'::jsonb, 'unreviewed'
    );
    PERFORM public.correct_agenda_import_run_row(
      v_run3_row, 0, public.corr_fixture_candidate(2, 'Stale Version Correction', '2026-10-03', '09:00', 'agenda-correction-run3-fixed'),
      'valid', '[]'::jsonb, NULL
    );

    SELECT version INTO v_before_version FROM public.event_agenda_state WHERE event_id = v_event_a;
    SELECT count(*) INTO v_before_items3 FROM public.agenda_items WHERE event_id = v_event_a;
    v_failed := false;
    BEGIN
      PERFORM public.commit_agenda_import_run(v_run3);
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'stale_agenda_version'; END;
    PERFORM public.corr_fixture_assert(
      v_failed
        AND (SELECT version = v_before_version FROM public.event_agenda_state WHERE event_id = v_event_a)
        AND (SELECT count(*) = v_before_items3 FROM public.agenda_items WHERE event_id = v_event_a)
        AND (SELECT row_state = 'approved' FROM public.import_run_rows WHERE id = v_run3_row),
      'a stale Agenda version still blocks commit even with a valid correction overlay present -- the correction path cannot bypass the version fence'
    );
  END;

  -- Minimum EXECUTE surface for the new/replaced functions.
  PERFORM public.corr_fixture_assert(
    has_function_privilege('authenticated', 'public.correct_agenda_import_run_row(uuid,integer,jsonb,text,jsonb,text)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.get_agenda_import_row_corrections(uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.list_agenda_import_row_correction_summaries(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.correct_agenda_import_run_row(uuid,integer,jsonb,text,jsonb,text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.get_agenda_import_row_corrections(uuid)', 'EXECUTE')
      AND NOT has_table_privilege('authenticated', 'public.import_run_row_corrections', 'SELECT'),
    'authenticated has only the intended correction RPC surface; no direct table privilege on the new table exists for any browser role'
  );
END;
$$;

ROLLBACK;

-- Post-rollback residue proof.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tenants WHERE id = 'c0770000-0000-0000-0000-000000000001'::uuid
  ) THEN
    RAISE EXCEPTION 'corr_fixture_residue: tenant';
  END IF;
  IF to_regclass('public.import_run_row_corrections') IS NOT NULL THEN
    RAISE EXCEPTION 'corr_fixture_residue: import_run_row_corrections table';
  END IF;
  IF to_regprocedure('public.corr_fixture_assert(boolean,text)') IS NOT NULL
    OR to_regprocedure('public.corr_fixture_candidate(integer,text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'corr_fixture_residue: helper function';
  END IF;
  IF (
    SELECT count(*) FROM supabase_migrations.schema_migrations
    WHERE version = '20260823010000'
  ) <> 1 THEN
    RAISE EXCEPTION 'corr_fixture_residue: migration history drift';
  END IF;
END;
$$;
