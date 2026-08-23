-- Corrective migration for Agenda Governed Imports Stage D
-- (20260823010000_create_agenda_import_row_correction.sql).
--
-- get_agenda_import_row_corrections(uuid) fails at runtime with
-- "column reference \"id\" is ambiguous": its own RETURNS TABLE(id uuid, ...)
-- exposes `id` as an implicit PL/pgSQL output variable, which collides with
-- the unqualified `id` column predicates in its two lookup queries
-- (`WHERE id = p_import_run_row_id` against import_run_rows, and
-- `WHERE id = v_row.import_run_id` against import_runs). This was found by
-- actually executing the Stage D linked-database proof fixture, not by
-- static review -- the earlier structural tests could not have caught it,
-- since PL/pgSQL only resolves this ambiguity at execution time.
--
-- Fix only: alias each source table and qualify its own `id` predicate.
-- Nothing else changes -- same signature, same RETURNS TABLE shape
-- (including the `id` output column name, which is not renamed), same
-- SECURITY DEFINER/owner/search_path, same authority check, same grants.
-- 20260823010000 itself is intentionally left unmodified; this is an
-- additive CREATE OR REPLACE only.
BEGIN;

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

  SELECT * INTO v_row FROM public.import_run_rows AS r WHERE r.id = p_import_run_row_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import_row_not_found' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM public.import_runs AS rn WHERE rn.id = v_row.import_run_id;
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

COMMIT;
