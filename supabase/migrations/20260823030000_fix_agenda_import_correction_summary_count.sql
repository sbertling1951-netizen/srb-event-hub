-- Second corrective migration for Agenda Governed Imports Stage D
-- (20260823010000_create_agenda_import_row_correction.sql).
--
-- list_agenda_import_row_correction_summaries(uuid) fails on every call
-- (regardless of whether any correction rows exist) with:
--   ERROR: structure of query does not match function result type
--   DETAIL: Returned type bigint does not match expected type integer
--           in column 2.
-- Its RETURNS TABLE declares `correction_count integer`, but the
-- RETURN QUERY's `count(*) OVER (PARTITION BY c.import_run_row_id)` is
-- always `bigint` in Postgres -- PL/pgSQL's RETURN QUERY requires an exact
-- column-type match, not implicit narrowing. This RPC is on a live client
-- path (lib/agendaImportOrchestration.ts#recoverAgendaImportRun calls it on
-- every Agenda import-run recovery), so this defect breaks Agenda
-- recovery/resume entirely as shipped.
--
-- Fix only: cast the window aggregate to integer at the query site, per
-- the RPC's own already-bounded correction-count domain (a run's staged
-- row count is already integer-bounded everywhere else in this schema).
-- Nothing else changes -- same signature, same RETURNS TABLE shape
-- (correction_count stays integer, not widened to bigint), same
-- SECURITY DEFINER/owner/search_path, same authority check, same grants,
-- same ordering/semantics. 20260823010000 and 20260823020000 are
-- intentionally left unmodified; this is an additive CREATE OR REPLACE
-- only.
BEGIN;

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
    (count(*) OVER (PARTITION BY c.import_run_row_id))::integer AS correction_count,
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

COMMIT;
