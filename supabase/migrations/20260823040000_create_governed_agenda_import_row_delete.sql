-- Agenda Governed Imports Stage D: governed deletion of a staged row before
-- commit, superseding Stage D's original abandonment-based "skip" concept
-- for Agenda. New operator model: Edit Row to correct a staged row, Delete
-- Row if it does not belong in the import at all. A deleted staging
-- mistake does not need its row contents preserved anywhere -- it is
-- working data, not evidence, until the moment it commits.
--
-- Architecture audit conclusion (see the reconciliation review this
-- migration implements):
--
-- 1. An uncommitted import_run_row can be physically deleted safely. No
--    other table has a forward reference to it except
--    import_run_row_corrections (see below); canonical_target_id is a
--    plain uuid column, not a foreign key, and is always NULL for a
--    non-committed row, so deleting a row can never orphan or dangle a
--    canonical Agenda/Attendee/Vendor record.
-- 2. import_run_row_corrections.import_run_row_id currently REFERENCES
--    import_run_rows(id) ON DELETE RESTRICT -- deleting a row with
--    correction history would fail outright without a change. This
--    migration switches that one FK to ON DELETE CASCADE, but the FK
--    change alone is NOT sufficient: import_run_row_corrections also
--    carries an unconditional immutability trigger
--    (prevent_import_run_row_corrections_mutation, 20260823010000,
--    BEFORE UPDATE OR DELETE) that has no way to distinguish a
--    cascade-originated DELETE from a direct one, and rejects both --
--    proven by real-Postgres execution: FK CASCADE alone made
--    delete_agenda_import_run_row fail on every row that had ever been
--    corrected, exactly the case the feature exists for. The trigger is
--    therefore narrowly revised below (not disabled, not weakened for
--    UPDATE) to permit DELETE only inside a transaction-local, row-scoped
--    authorization set by delete_agenda_import_run_row immediately before
--    the one DELETE it authorizes -- see that revision's own comment
--    below for the full safety argument. Preserving correction
--    immutability for every RETAINED row, while allowing its removal only
--    as a strict consequence of its own parent row's already-fully-
--    governed deletion, is what makes the cascade safe.
-- 3. Yes: commit_agenda_import_run's own staging-completeness check
--    (`v_staged_count <> v_expected_row_count`) implicitly assumed the
--    live row count could never shrink below the immutable
--    source_metadata.row_count captured at run creation. Deletion breaks
--    that assumption unless reconciled (see below).
-- 4. source_metadata.row_count is, and remains, immutable evidence of how
--    many rows were originally staged from the source file -- it is never
--    rewritten by this migration. A new import_runs.deleted_row_count
--    column (generic, defaulting to 0, incremented only by the delete RPC
--    below) tracks how many of those originally-staged rows have since
--    been intentionally removed, so the completeness check can be
--    reconciled as `live_row_count + deleted_row_count = original
--    row_count` without ever touching the immutable source figure.
-- 5. Recovery, correction summaries, finalize's open-row check, and
--    shared History all already query the *current* import_run_rows set
--    (never a cached or remembered count) -- a deleted row is therefore
--    automatically and correctly absent from every one of them with zero
--    further code change. Only commit_agenda_import_run's own
--    completeness check needed reconciling (item 3/4 above).
-- 6. Yes: committed rows and finalized runs remain fully protected --
--    the delete RPC below refuses both unconditionally, before ever
--    reaching a DELETE statement, exactly mirroring every other governed
--    Stage D/Stage B mutation's own authority-then-lifecycle-then-state
--    gating order.
--
-- Stage D's own narrow, now-superseded extension to the two SHARED
-- abandonment RPCs (abandon_import_run_row / abandon_import_run_open_rows)
-- -- which let a validation_failed row be abandoned once it carried
-- correction history -- is reverted to its exact pre-Stage-D body here.
-- Delete Row replaces the need that extension existed for; reverting
-- restores the exact original, already-correct, already-shared Attendee/
-- Vendor/Agenda behavior (a bare validation_failed row was never, and
-- remains never, abandonable -- that was always correct, since deletion is
-- now the governed path for "this staged row does not belong"). The
-- shared import_run_rows_abandonment_open_row_check CHECK constraint is
-- not touched.
--
-- 20260822170000, 20260823010000, 20260823020000, and 20260823030000 are
-- all left unmodified; this is an additive migration only.
BEGIN;

-- ============================================================
-- Row-count reconciliation: an immutable "how many were originally staged"
-- figure (source_metadata.row_count, untouched) plus a mutable "how many
-- have since been intentionally deleted" counter -- not deleted-row
-- contents, per the explicit decision not to retain them for audit.
-- ============================================================

ALTER TABLE public.import_runs
  ADD COLUMN deleted_row_count integer NOT NULL DEFAULT 0 CHECK (deleted_row_count >= 0);

-- ============================================================
-- Correction-history immutability, revised to survive Delete Row.
--
-- UPDATE remains unconditionally rejected -- always, with no bypass of any
-- kind. DELETE is rejected UNLESS a transaction-local, row-specific
-- authorization is present that names exactly the correction row's own
-- parent (OLD.import_run_row_id) -- never a bare boolean, never any other
-- row.
--
-- Bypass mechanism: the same idiom already established by
-- enforce_parking_repair_quiescence's epicentrax.parking_repair_bypass_authorized
-- flag (20260808110000_create_parking_repair_quiescence_guard.sql),
-- narrowed one step further -- not "is some repair in progress" but "is
-- THIS EXACT row's parent authorized right now". The flag is:
--   * set only via set_config(..., true) -- transaction-local: it cannot
--     outlive the transaction, cannot be read by any other session/
--     connection, and (because PostgREST executes exactly one statement,
--     the RPC call itself, per transaction) cannot be pre-set by a caller
--     ahead of the RPC's own internal set_config call;
--   * set only inside delete_agenda_import_run_row (below), immediately
--     before the one DELETE it authorizes, to the id of the exact row
--     that function has already run every authority/lifecycle/state check
--     against moments earlier in that same function body -- so the flag
--     can never authorize a row the caller has not already been
--     independently authorized, by the same checks, to delete;
--   * irrelevant to ordinary browser/PostgREST callers regardless:
--     authenticated and anon carry zero table privilege (SELECT, INSERT,
--     UPDATE, or DELETE) on import_run_row_corrections or import_run_rows
--     (unchanged from 20260822170000/20260823010000, RLS enabled with
--     zero policies on both), so this trigger is defense-in-depth on an
--     already fully closed table-grant surface, not the primary boundary
--     -- confirmed directly: has_table_privilege('authenticated',
--     'public.import_run_row_corrections', 'DELETE') = false, and the
--     same for 'UPDATE', and the same for both on import_run_rows.
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_import_run_row_corrections_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('epicentrax.import_run_row_deletion_target_id', true) = OLD.import_run_row_id::text
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'import row correction evidence is immutable';
END;
$$;

ALTER TABLE public.import_run_row_corrections
  DROP CONSTRAINT import_run_row_corrections_import_run_row_id_fkey,
  ADD CONSTRAINT import_run_row_corrections_import_run_row_id_fkey
    FOREIGN KEY (import_run_row_id) REFERENCES public.import_run_rows(id) ON DELETE CASCADE;

-- ============================================================
-- Governed deletion RPC. Same authority composition and Event-scoping
-- discipline as correct_agenda_import_run_row/commit_agenda_import_run
-- (event.imports.manage AND event.agenda.manage, scoped from the trusted
-- row's own event_id). Locks the row and run, requires import_type =
-- 'agenda', refuses a committed row or a finalized run, refuses an
-- already-absent row deterministically (NOT FOUND), and refuses an
-- already-abandoned row (abandonment predates this stage and remains a
-- distinct, terminal overlay for import types that still use it; Agenda
-- rows reaching row_state = 'approved' can still be legitimately
-- abandoned via the unmodified shared RPCs if an operator prefers that
-- path, and this RPC does not attempt to also delete an abandoned row out
-- from under that evidence). No row contents, and no correction history,
-- are preserved -- this is a genuine, permanent deletion of pre-commit
-- working data, not an evidence-preserving overlay.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_agenda_import_run_row(
  p_import_run_row_id uuid,
  p_reason_code text DEFAULT NULL
)
RETURNS void
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
  IF p_reason_code IS NOT NULL AND p_reason_code NOT IN (
    'operator_declined', 'source_superseded', 'duplicate_intentionally_dismissed', 'cannot_resolve', 'other'
  ) THEN
    RAISE EXCEPTION 'invalid_deletion_reason_code' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'import_run_not_mutable' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_event_task_authority('event.imports.manage', v_row.event_id)
    OR NOT public.has_event_task_authority('event.agenda.manage', v_row.event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_row.event_id);

  IF v_row.row_state = 'committed' THEN
    RAISE EXCEPTION 'import_row_committed' USING ERRCODE = '22023';
  END IF;
  IF v_row.abandoned_at IS NOT NULL THEN
    RAISE EXCEPTION 'import_row_already_abandoned' USING ERRCODE = '22023';
  END IF;

  -- Transaction-local, row-specific authorization for the correction-
  -- history cascade this DELETE is about to trigger -- see
  -- prevent_import_run_row_corrections_mutation above for the full safety
  -- argument. Set only here, to exactly this row's own id, immediately
  -- before the one DELETE it authorizes, after every authority/lifecycle/
  -- state check above has already passed for this same row.
  PERFORM set_config('epicentrax.import_run_row_deletion_target_id', v_row.id::text, true);

  DELETE FROM public.import_run_rows WHERE id = v_row.id;

  UPDATE public.import_runs
  SET deleted_row_count = deleted_row_count + 1
  WHERE id = v_run.id;
END;
$$;

ALTER FUNCTION public.delete_agenda_import_run_row(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_agenda_import_run_row(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_agenda_import_run_row(uuid, text) TO authenticated;

-- ============================================================
-- Revert Stage D's now-obsolete abandonment extension to its exact
-- pre-Stage-D (20260822170000) body. Attendee, Vendor, and any bare
-- (never-corrected, never-existed-under-Stage-D) Agenda validation_failed
-- row all see exactly the same behavior as before Stage D existed.
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

ALTER FUNCTION public.abandon_import_run_row(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.abandon_import_run_open_rows(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.abandon_import_run_row(uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.abandon_import_run_open_rows(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.abandon_import_run_row(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_import_run_open_rows(uuid, text) TO authenticated;

-- ============================================================
-- commit_agenda_import_run: the only change is the staging-completeness
-- check, reconciled against deleted_row_count so a deleted row is simply
-- absent from the batch rather than making the run permanently
-- uncommittable. Every other line, including the effective-candidate
-- resolution, malformed/duplicate checks, version fence, and rollback
-- semantics, is byte-for-byte unchanged from 20260823010000.
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

  IF v_staged_count + v_run.deleted_row_count <> v_expected_row_count THEN
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

COMMIT;
