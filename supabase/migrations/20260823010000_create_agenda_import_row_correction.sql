-- Agenda Governed Imports: in-place operator correction of a staged
-- validation_failed (or previously corrected) row, without leaving
-- EpicentraX or reuploading the source file.
--
-- Additive only. import_runs / import_run_rows and every existing governed
-- RPC keep their current shape and CHECK constraints unchanged; a corrected
-- row reuses row_state/validation_state/review_state combinations the
-- import_run_rows_state_consistency CHECK already allowed before this
-- migration ('validation_failed' <-> invalid/unreviewed, 'approved' <->
-- valid/approved). Nothing here rewrites import_run_rows.normalized_candidate,
-- .source_payload, or .source_fingerprint, and the existing
-- prevent_import_run_row_source_mutation trigger that protects them is not
-- touched -- a correction is a new, permanent, append-only overlay row in
-- the new table below, never a rewrite of original staged evidence.
--
-- Stage A interpretation ("11/4/26" -> "2026-11-04", alias resolution,
-- color derivation, etc.) is not reimplemented here. The browser recomputes
-- a corrected candidate with the exact same, unchanged
-- lib/agendaImportContract.ts#interpretAgendaImportRow used for original
-- ingestion (see lib/agendaImportOrchestration.ts's correctAgendaImportRow),
-- and submits the resulting canonical candidate plus its validation
-- outcome. This governed RPC's own job is narrower and non-evolving: a
-- structural/type well-formedness check (extracted from
-- commit_agenda_import_run's own pre-existing inline check into the shared
-- _agenda_import_candidate_is_well_formed helper below, so the shape rule
-- now lives in exactly one place, reused by both commit and correction --
-- strictly less duplication than before this migration, not more),
-- authority/lifecycle/state gating, and atomic persistence of the
-- correction plus its resulting row disposition.
BEGIN;

-- ============================================================
-- Correction overlay. Generic table name/shape (any import type could
-- reuse it the same way import_run_rows.normalized_candidate is already a
-- generic jsonb column shared across import types) even though only the
-- Agenda correction RPC below writes to it today. Append-only: every
-- correction attempt, valid or not, keeps its own permanent row, so the
-- table itself is the full revision history and the audit trail --
-- "latest by revision" is the effective correction; nothing is ever
-- overwritten or deleted, so revision 1's prior_validation_state /
-- prior_validation_details is permanently the untouched original Stage A
-- outcome (nothing else can have changed import_run_rows between original
-- staging and the first correction attempt).
-- ============================================================

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

-- Same discipline as import_runs/import_run_rows: no direct browser-role
-- privilege of any kind. Only governed, SECURITY DEFINER RPCs below reach
-- this table.
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

-- ============================================================
-- Shared structural/type well-formedness check. Internal only (zero direct
-- grants, matching the established "_agenda_event_version_advance" /
-- "assert_event_lifecycle_mutable" pattern) -- reachable solely from within
-- another SECURITY DEFINER function's body. This is exactly
-- commit_agenda_import_run's pre-existing inline malformed-candidate check,
-- extracted verbatim plus one strengthening: it now also attempts the same
-- ::date/::time casts import_event_agenda_items itself already relies on,
-- so a syntactically invalid date/time is caught here -- at correction-save
-- time, with an immediate bounded answer -- instead of only surfacing much
-- later as a whole-batch commit rollback. It is not a reimplementation of
-- Stage A's human-friendly parsing, alias resolution, or duplicate
-- detection; those remain exclusively client-side and unchanged.
-- ============================================================

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

-- ============================================================
-- Governed correction RPC. Requires the same composed authority as
-- commit_agenda_import_run (event.imports.manage AND event.agenda.manage),
-- scoped from the trusted run's own event_id -- never a client-supplied
-- Event ID. Eligible starting row_state is exactly ('validation_failed',
-- 'approved') -- committed, commit_failed, and abandoned rows are refused,
-- and finalized runs are refused outright. A row that fails this RPC's own
-- well-formedness check, or whose caller-reported validation_state is
-- 'invalid', is persisted as still validation_failed with the corrected
-- validation_details visible for the next attempt; only a caller-reported
-- 'valid' outcome that also passes the well-formedness check becomes
-- row_state = 'approved' (commit-eligible, exactly like an originally-valid
-- row). p_expected_revision fences concurrent corrections: a stale caller
-- (editing from an outdated snapshot) is rejected outright rather than
-- silently overwriting a newer correction.
-- ============================================================

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

-- ============================================================
-- Correction history read. event.imports.manage only (matching
-- get_managed_import_run_recovery's own single-authority gate) -- reading
-- Imports-owned correction evidence is an Imports-domain concern, not an
-- Agenda-domain one, exactly like recovery's own normalized_candidate
-- exposure. Works regardless of run status (including finalized), matching
-- get_managed_import_run_recovery's own "finalized runs remain readable by
-- exact authorized ID" precedent -- this is audit detail for an authorized
-- Imports manager, not the History browser (event.imports.view) surface.
-- ============================================================

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

-- ============================================================
-- Run-scoped correction summary read, for one-call recovery instead of a
-- per-row N+1 pattern. Same authority/visibility rule as
-- get_agenda_import_row_corrections above (event.imports.manage, any run
-- status). Returns exactly one row per corrected import_run_row_id --
-- rows with zero corrections are simply absent, so the client's own
-- recovery merge treats "no row here" as "not corrected" without a
-- separate flag.
-- ============================================================

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

-- ============================================================
-- Narrow abandonment extension, shared (Attendee/Vendor call these same
-- two RPCs). Zero behavior change for any row without correction history --
-- a bare validation_failed row (no correction ever attempted, any import
-- type) remains exactly as terminal/unabandonable as before this
-- migration. The only new allowance: a validation_failed row that has been
-- through at least one correction attempt (necessarily an Agenda row,
-- since only correct_agenda_import_run_row writes to
-- import_run_row_corrections today) may now be abandoned -- an operator
-- who tried to fix a row and still cannot must be able to skip it rather
-- than being stuck. committed rows remain unconditionally terminal.
-- ============================================================

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

-- ============================================================
-- commit_agenda_import_run: compute the effective candidate per eligible
-- row as the latest valid correction overlay if one exists, otherwise the
-- row's own immutable normalized_candidate -- everywhere the function
-- reads a candidate (malformed check, duplicate check, the canonical
-- batch, and the post-commit external_id join), so the commit path cannot
-- be tricked into using stale/original invalid data once a valid
-- correction exists. The malformed-candidate check itself now calls the
-- shared _agenda_import_candidate_is_well_formed helper instead of
-- repeating the same checks inline. Every other invariant (one atomic
-- batch, the expected-version fence, rollback semantics, composed
-- authority, already-committed retry, run-row locking) is unchanged.
-- ============================================================

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

-- ============================================================
-- Shared History: add a generic, non-Agenda-specific "was this row's
-- committed disposition based on an operator correction" flag. Reads a
-- generically-named table (import_run_row_corrections), so this is
-- extending shared History safely, not creating Agenda-specific History --
-- the shape is available to any future import type's correction feature
-- without another History migration. Every existing field/redaction
-- behavior is unchanged; only one new boolean is added per row.
-- ============================================================

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

COMMIT;
