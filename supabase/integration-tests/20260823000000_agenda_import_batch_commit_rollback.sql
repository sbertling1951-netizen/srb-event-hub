-- Agenda Governed Imports Stage B linked-database rollback fixture.
-- The pending RPC definitions are installed only inside this outer
-- transaction. The migration structural test proves exact definition parity.
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

-- The legacy canonical writer remains callable by postgres for nested
-- composition but is no longer an independently usable browser surface.
REVOKE ALL ON FUNCTION public.import_event_agenda_items(uuid, integer, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- ===================== fixture-only helpers =====================

CREATE FUNCTION public.agenda_stageb_fixture_assert(p_ok boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'agenda_stageb_fixture_assertion_failed: %', p_message;
  END IF;
END;
$$;

CREATE FUNCTION public.agenda_stageb_fixture_candidate(
  p_source_row_number integer,
  p_title text,
  p_agenda_date text,
  p_start_time text,
  p_external_id text,
  p_sort_order integer DEFAULT 1
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
    'sort_order', p_sort_order,
    'external_id', p_external_id
  );
$$;

CREATE FUNCTION public.agenda_stageb_fixture_fail_staging_result()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('agenda_stageb.fail_staging_result', true) = 'true'
    AND OLD.import_run_id::text = current_setting('agenda_stageb.fail_run_id', true) THEN
    RAISE EXCEPTION 'agenda_stageb_forced_staging_result_failure';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agenda_stageb_fixture_fail_staging_result_trigger
BEFORE UPDATE ON public.import_run_rows
FOR EACH ROW
EXECUTE FUNCTION public.agenda_stageb_fixture_fail_staging_result();

-- ===================== fixture data + proofs =====================

DO $$
DECLARE
  v_tenant uuid := 'b2300000-0000-0000-0000-000000000001';
  v_event_a uuid := 'b2300000-0000-0000-0000-000000000002';
  v_event_b uuid := 'b2300000-0000-0000-0000-000000000003';
  v_event_archived uuid := 'b2300000-0000-0000-0000-000000000004';
  v_both uuid := 'b2300000-0000-0000-0000-000000000011';
  v_imports uuid := 'b2300000-0000-0000-0000-000000000012';
  v_agenda uuid := 'b2300000-0000-0000-0000-000000000013';
  v_neither uuid := 'b2300000-0000-0000-0000-000000000014';
  v_stage_run uuid;
  v_stage_valid_row uuid;
  v_stage_invalid_row uuid;
  v_stage_dup_a uuid;
  v_stage_dup_b uuid;
  v_golden_run uuid;
  v_golden_insert_row uuid;
  v_golden_update_row uuid;
  v_atomic_run uuid := gen_random_uuid();
  v_failure_run uuid := gen_random_uuid();
  v_stale_run uuid := gen_random_uuid();
  v_imports_only_run uuid := gen_random_uuid();
  v_agenda_only_run uuid := gen_random_uuid();
  v_neither_run uuid := gen_random_uuid();
  v_cross_run uuid := gen_random_uuid();
  v_wrong_type_run uuid := gen_random_uuid();
  v_finalized_run uuid := gen_random_uuid();
  v_archived_run uuid := gen_random_uuid();
  v_existing_item uuid;
  v_before_items integer;
  v_before_ledger integer;
  v_before_version integer;
  v_outcome text;
  v_imported integer;
  v_version integer;
  v_failed boolean;
  v_recovery jsonb;
  v_history_detail jsonb;
BEGIN
  -- Tenant, Events, and exact authority compositions.
  INSERT INTO public.tenants(
    id, organization_code, slug, organization_name, display_name, app_title
  ) VALUES (
    v_tenant, 'AGENDA-STAGEB', 'agenda-stageb-fixture',
    'Agenda Stage B Fixture', 'Agenda Stage B Fixture', 'Agenda Stage B Fixture'
  );

  INSERT INTO public.events(id, tenant_id, name, start_date, end_date, timezone, lifecycle_state)
  VALUES
    (v_event_a, v_tenant, 'agenda-stageb-event-a', current_date, current_date + 30, 'UTC', 'operational'),
    (v_event_b, v_tenant, 'agenda-stageb-event-b', current_date, current_date + 30, 'UTC', 'operational'),
    (v_event_archived, v_tenant, 'agenda-stageb-event-archived', current_date - 60, current_date - 30, 'UTC', 'archived');

  INSERT INTO auth.users(id, email) VALUES
    (v_both, 'agenda-stageb-both@fixture.invalid'),
    (v_imports, 'agenda-stageb-imports@fixture.invalid'),
    (v_agenda, 'agenda-stageb-agenda@fixture.invalid'),
    (v_neither, 'agenda-stageb-neither@fixture.invalid');

  INSERT INTO public.admin_users(user_id, email, display_name) VALUES
    (v_both, 'agenda-stageb-both@fixture.invalid', 'Agenda Stage B Both'),
    (v_imports, 'agenda-stageb-imports@fixture.invalid', 'Agenda Stage B Imports'),
    (v_agenda, 'agenda-stageb-agenda@fixture.invalid', 'Agenda Stage B Agenda'),
    (v_neither, 'agenda-stageb-neither@fixture.invalid', 'Agenda Stage B Neither');

  INSERT INTO public.admin_event_access(admin_user_id, event_id, role)
  SELECT id, v_event_a, 'event_admin'
  FROM public.admin_users
  WHERE user_id IN (v_both, v_imports, v_agenda, v_neither);

  INSERT INTO public.admin_event_access(admin_user_id, event_id, role)
  SELECT id, v_event_archived, 'event_admin'
  FROM public.admin_users
  WHERE user_id = v_both;

  INSERT INTO public.admin_event_permissions(admin_event_access_id, permission_key)
  SELECT access.id, task.task_key
  FROM public.admin_event_access AS access
  JOIN public.admin_users AS admin ON admin.id = access.admin_user_id
  CROSS JOIN (
    VALUES
      ('event.imports.manage'),
      ('event.imports.view'),
      ('event.agenda.manage')
  ) AS task(task_key)
  WHERE admin.user_id = v_both
    AND access.event_id IN (v_event_a, v_event_archived);

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

  INSERT INTO public.agenda_items(
    event_id, title, description, location, speaker, category, color,
    agenda_date, start_time, end_time, is_published, sort_order, external_id, source
  ) VALUES (
    v_event_a, 'Existing before Stage B', 'Original description', 'Original location',
    'Original speaker', 'Original category', '#000000', current_date, '08:00',
    '08:30', true, 90, 'agenda-stageb-existing', 'manual'
  ) RETURNING id INTO v_existing_item;

  SELECT count(*) INTO v_before_items
  FROM public.agenda_items WHERE event_id = v_event_a;
  SELECT count(*) INTO v_before_ledger
  FROM public.agenda_command_ledger WHERE event_id = v_event_a;

  -- Generic governed staging: exact candidates, source context, validation
  -- codes, and Stage A duplicate classification persist without Agenda writes.
  SELECT id INTO v_stage_run
  FROM public.create_import_run(
    v_event_a,
    'agenda',
    'agenda-stageb-staging.csv',
    jsonb_build_object('row_count', 4, 'expected_agenda_version', 0)
  );

  SELECT id INTO v_stage_valid_row
  FROM public.stage_import_run_row(
    v_stage_run, 2, jsonb_build_object('Title', 'Stage only valid'),
    public.agenda_stageb_fixture_candidate(2, 'Stage only valid', '2026-09-01', '09:00', 'agenda-stageb-stage-only'),
    'agenda-stageb-stage-valid'
  );
  PERFORM public.set_import_run_row_review_state(v_stage_valid_row, 'valid', '[]'::jsonb, 'approved');

  SELECT id INTO v_stage_invalid_row
  FROM public.stage_import_run_row(
    v_stage_run, 3, jsonb_build_object('Title', ''),
    public.agenda_stageb_fixture_candidate(3, NULL, '2026-09-01', '09:15', NULL),
    'agenda-stageb-stage-invalid'
  );
  PERFORM public.set_import_run_row_review_state(
    v_stage_invalid_row, 'invalid',
    '[{"code":"missing_agenda_title","message":"Missing Title","severity":"error"}]'::jsonb,
    'unreviewed'
  );

  SELECT id INTO v_stage_dup_a
  FROM public.stage_import_run_row(
    v_stage_run, 4, jsonb_build_object('Title', 'Duplicate'),
    public.agenda_stageb_fixture_candidate(4, 'Duplicate', '2026-09-01', '09:30', 'duplicate-2026-09-01-09-30'),
    'agenda-stageb-stage-dup-a'
  );
  PERFORM public.set_import_run_row_review_state(
    v_stage_dup_a, 'invalid',
    '[{"code":"duplicate_agenda_external_id_in_file","message":"Duplicate Agenda item identity in file","severity":"error"}]'::jsonb,
    'unreviewed'
  );

  SELECT id INTO v_stage_dup_b
  FROM public.stage_import_run_row(
    v_stage_run, 5, jsonb_build_object('Title', 'Duplicate'),
    public.agenda_stageb_fixture_candidate(5, 'Duplicate', '2026-09-01', '09:30', 'duplicate-2026-09-01-09-30'),
    'agenda-stageb-stage-dup-b'
  );
  PERFORM public.set_import_run_row_review_state(
    v_stage_dup_b, 'invalid',
    '[{"code":"duplicate_agenda_external_id_in_file","message":"Duplicate Agenda item identity in file","severity":"error"}]'::jsonb,
    'unreviewed'
  );

  PERFORM public.agenda_stageb_fixture_assert(
    (SELECT count(*) = v_before_items FROM public.agenda_items WHERE event_id = v_event_a),
    'staging never mutates agenda_items'
  );
  PERFORM public.agenda_stageb_fixture_assert(
    (SELECT count(*) = v_before_ledger FROM public.agenda_command_ledger WHERE event_id = v_event_a),
    'staging never writes the Agenda ledger'
  );
  PERFORM public.agenda_stageb_fixture_assert(
    NOT EXISTS (SELECT 1 FROM public.event_agenda_state WHERE event_id = v_event_a),
    'staging never creates or advances Agenda version state'
  );

  v_recovery := public.get_managed_import_run_recovery(v_stage_run);
  PERFORM public.agenda_stageb_fixture_assert(
    v_recovery #>> '{run,import_type}' = 'agenda'
      AND (v_recovery #>> '{rows,0,source_row_number}')::integer = 2
      AND v_recovery #> '{rows,0,normalized_candidate}' =
        public.agenda_stageb_fixture_candidate(2, 'Stage only valid', '2026-09-01', '09:00', 'agenda-stageb-stage-only'),
    'recovery preserves Agenda import type, source row, and normalized candidate unchanged'
  );
  PERFORM public.agenda_stageb_fixture_assert(
    v_recovery #>> '{rows,1,row_state}' = 'validation_failed'
      AND v_recovery #>> '{rows,1,validation_details,0,code}' = 'missing_agenda_title'
      AND v_recovery #>> '{rows,2,row_state}' = 'validation_failed'
      AND v_recovery #>> '{rows,2,validation_details,0,code}' = 'duplicate_agenda_external_id_in_file'
      AND v_recovery #>> '{rows,3,validation_details,0,code}' = 'duplicate_agenda_external_id_in_file',
    'invalid and every same-file duplicate row retain deterministic Stage A failure truth'
  );

  PERFORM public.close_import_run_staging(v_stage_run);
  v_failed := false;
  BEGIN
    PERFORM public.finalize_import_run(v_stage_run);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'import_run_has_open_rows';
  END;
  PERFORM public.agenda_stageb_fixture_assert(v_failed, 'open Agenda row prevents finalization');
  PERFORM public.agenda_stageb_fixture_assert(
    EXISTS (
      SELECT 1 FROM public.list_active_import_runs(v_event_a)
      WHERE import_run_id = v_stage_run AND import_type = 'agenda' AND status = 'ready_for_review'
    ),
    'shared active-run discovery recognizes resumable Agenda runs'
  );

  -- Golden batch: one insert + one existing external_id update, committed
  -- together through the exact pending Stage B function.
  SELECT id INTO v_golden_run
  FROM public.create_import_run(
    v_event_a,
    'agenda',
    'agenda-stageb-golden.csv',
    jsonb_build_object('row_count', 2, 'expected_agenda_version', 0)
  );
  SELECT id INTO v_golden_insert_row
  FROM public.stage_import_run_row(
    v_golden_run, 2, '{}'::jsonb,
    public.agenda_stageb_fixture_candidate(2, 'Inserted by Stage B', '2026-09-02', '09:00', 'agenda-stageb-insert', 0),
    'agenda-stageb-golden-insert'
  );
  PERFORM public.set_import_run_row_review_state(v_golden_insert_row, 'valid', '[]'::jsonb, 'approved');
  SELECT id INTO v_golden_update_row
  FROM public.stage_import_run_row(
    v_golden_run, 3, '{}'::jsonb,
    public.agenda_stageb_fixture_candidate(3, 'Updated by Stage B', '2026-09-02', '11:00', 'agenda-stageb-existing', 2),
    'agenda-stageb-golden-update'
  );
  PERFORM public.set_import_run_row_review_state(v_golden_update_row, 'valid', '[]'::jsonb, 'approved');

  SELECT outcome, imported_count, new_version
  INTO v_outcome, v_imported, v_version
  FROM public.commit_agenda_import_run(v_golden_run);

  PERFORM public.agenda_stageb_fixture_assert(
    v_outcome = 'committed' AND v_imported = 2 AND v_version = 1,
    'composed authority commits the entire insert/update batch at version 0 -> 1'
  );
  PERFORM public.agenda_stageb_fixture_assert(
    (SELECT count(*) = v_before_items + 1 FROM public.agenda_items WHERE event_id = v_event_a),
    'exactly one new canonical Agenda row was inserted'
  );
  PERFORM public.agenda_stageb_fixture_assert(
    (SELECT id = v_existing_item AND title = 'Updated by Stage B' AND source = 'import'
       FROM public.agenda_items
      WHERE event_id = v_event_a AND external_id = 'agenda-stageb-existing'),
    'matching external_id updates the existing canonical row in place'
  );
  PERFORM public.agenda_stageb_fixture_assert(
    (SELECT count(*) = 2
       FROM public.import_run_rows
      WHERE import_run_id = v_golden_run
        AND row_state = 'committed'
        AND commit_state = 'committed'
        AND canonical_target_id IS NOT NULL
        AND commit_error IS NULL),
    'every eligible staged row records committed canonical evidence atomically'
  );
  PERFORM public.agenda_stageb_fixture_assert(
    (SELECT count(*) = v_before_ledger + 1
       FROM public.agenda_command_ledger
      WHERE event_id = v_event_a AND action = 'event_agenda_items_imported'),
    'existing Agenda ledger records one batch command'
  );

  -- Lifecycle close/finalize and shared safe History for Agenda.
  PERFORM public.close_import_run_staging(v_golden_run);
  PERFORM public.finalize_import_run(v_golden_run);
  PERFORM public.agenda_stageb_fixture_assert(
    EXISTS (
      SELECT 1 FROM public.list_finalized_import_run_history(v_event_a)
      WHERE import_run_id = v_golden_run AND import_type = 'agenda'
        AND committed_count = 2 AND final_outcome = 'completed'
    ),
    'finalized Agenda run appears in shared Import History'
  );
  v_history_detail := public.get_finalized_import_run_history_detail(v_golden_run);
  PERFORM public.agenda_stageb_fixture_assert(
    v_history_detail #>> '{run,import_type}' = 'agenda'
      AND jsonb_array_length(v_history_detail -> 'rows') = 2
      AND NOT (v_history_detail::text LIKE '%normalized_candidate%')
      AND NOT (v_history_detail::text LIKE '%source_payload%'),
    'shared History detail is complete and retains existing redaction'
  );

  -- Independently failing canonical input: the valid peer, version advance,
  -- ledger, and every staging result all roll back.
  INSERT INTO public.import_runs(
    id, event_id, import_type, source_filename, source_metadata, created_by_auth_user_id
  ) VALUES (
    v_atomic_run, v_event_a, 'agenda', 'agenda-stageb-atomic.csv',
    jsonb_build_object('row_count', 2, 'expected_agenda_version', 1), v_both
  );
  INSERT INTO public.import_run_rows(
    import_run_id, event_id, source_row_number, source_payload, normalized_candidate,
    source_fingerprint, validation_state, review_state, row_state
  ) VALUES
    (v_atomic_run, v_event_a, 2, '{}'::jsonb,
      public.agenda_stageb_fixture_candidate(2, 'Atomic valid peer', '2026-09-03', '09:00', 'agenda-stageb-atomic-valid'),
      'agenda-stageb-atomic-valid', 'valid', 'approved', 'approved'),
    (v_atomic_run, v_event_a, 3, '{}'::jsonb,
      public.agenda_stageb_fixture_candidate(3, 'Atomic failing peer', 'not-a-date', '09:30', 'agenda-stageb-atomic-fail'),
      'agenda-stageb-atomic-fail', 'valid', 'approved', 'approved');

  SELECT version INTO v_before_version FROM public.event_agenda_state WHERE event_id = v_event_a;
  SELECT count(*) INTO v_before_items FROM public.agenda_items WHERE event_id = v_event_a;
  SELECT count(*) INTO v_before_ledger FROM public.agenda_command_ledger WHERE event_id = v_event_a;
  v_failed := false;
  BEGIN
    PERFORM public.commit_agenda_import_run(v_atomic_run);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  PERFORM public.agenda_stageb_fixture_assert(v_failed, 'one malformed canonical row fails the batch');
  PERFORM public.agenda_stageb_fixture_assert(
    (SELECT count(*) = v_before_items FROM public.agenda_items WHERE event_id = v_event_a)
      AND (SELECT version = v_before_version FROM public.event_agenda_state WHERE event_id = v_event_a)
      AND (SELECT count(*) = v_before_ledger FROM public.agenda_command_ledger WHERE event_id = v_event_a)
      AND (SELECT count(*) = 2 FROM public.import_run_rows WHERE import_run_id = v_atomic_run AND row_state = 'approved'),
    'one canonical row failure rolls back all peer, version, ledger, and staging effects'
  );

  -- A trigger fails only the final staging-result persistence. The nested
  -- canonical Agenda RPC has already inserted/advanced/logged at that point;
  -- proving those effects disappear demonstrates same-transaction behavior.
  INSERT INTO public.import_runs(
    id, event_id, import_type, source_filename, source_metadata, created_by_auth_user_id
  ) VALUES (
    v_failure_run, v_event_a, 'agenda', 'agenda-stageb-retry.csv',
    jsonb_build_object('row_count', 1, 'expected_agenda_version', 1), v_both
  );
  INSERT INTO public.import_run_rows(
    import_run_id, event_id, source_row_number, source_payload, normalized_candidate,
    source_fingerprint, validation_state, review_state, row_state
  ) VALUES (
    v_failure_run, v_event_a, 2, '{}'::jsonb,
    public.agenda_stageb_fixture_candidate(2, 'Rollback then retry', '2026-09-04', '09:00', 'agenda-stageb-retry'),
    'agenda-stageb-retry', 'valid', 'approved', 'approved'
  );

  SELECT version INTO v_before_version FROM public.event_agenda_state WHERE event_id = v_event_a;
  SELECT count(*) INTO v_before_items FROM public.agenda_items WHERE event_id = v_event_a;
  SELECT count(*) INTO v_before_ledger FROM public.agenda_command_ledger WHERE event_id = v_event_a;
  PERFORM set_config('agenda_stageb.fail_run_id', v_failure_run::text, true);
  PERFORM set_config('agenda_stageb.fail_staging_result', 'true', true);
  v_failed := false;
  BEGIN
    PERFORM public.commit_agenda_import_run(v_failure_run);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'agenda_stageb_forced_staging_result_failure';
  END;
  PERFORM set_config('agenda_stageb.fail_staging_result', '', true);
  PERFORM public.agenda_stageb_fixture_assert(v_failed, 'final staging-result failure was forced');
  PERFORM public.agenda_stageb_fixture_assert(
    NOT EXISTS (SELECT 1 FROM public.agenda_items WHERE event_id = v_event_a AND external_id = 'agenda-stageb-retry')
      AND (SELECT version = v_before_version FROM public.event_agenda_state WHERE event_id = v_event_a)
      AND (SELECT count(*) = v_before_ledger FROM public.agenda_command_ledger WHERE event_id = v_event_a)
      AND (SELECT row_state = 'approved' AND commit_state = 'not_started' FROM public.import_run_rows WHERE import_run_id = v_failure_run),
    'later staging-result failure rolls back the earlier nested Agenda insert/version/ledger in the same transaction'
  );

  PERFORM public.record_agenda_import_run_commit_failure(v_failure_run, 'agenda_commit_failed');
  v_recovery := public.get_managed_import_run_recovery(v_failure_run);
  PERFORM public.agenda_stageb_fixture_assert(
    v_recovery #>> '{rows,0,row_state}' = 'commit_failed'
      AND v_recovery #>> '{rows,0,commit_state}' = 'failed'
      AND v_recovery #>> '{rows,0,commit_error,code}' = 'agenda_commit_failed'
      AND v_recovery #>> '{rows,0,commit_error,message}' =
        'The Agenda batch commit did not complete. Retry after correcting the underlying issue.'
      AND v_recovery::text NOT LIKE '%agenda_stageb_forced_staging_result_failure%',
    'recovery reports bounded commit_failed truth without raw exception text'
  );

  SELECT outcome, imported_count, new_version
  INTO v_outcome, v_imported, v_version
  FROM public.commit_agenda_import_run(v_failure_run);
  PERFORM public.agenda_stageb_fixture_assert(
    v_outcome = 'committed' AND v_imported = 1 AND v_version = 2
      AND (SELECT row_state = 'committed' AND commit_error IS NULL FROM public.import_run_rows WHERE import_run_id = v_failure_run),
    'same-run retry succeeds and clears failure state'
  );
  SELECT outcome, imported_count, new_version
  INTO v_outcome, v_imported, v_version
  FROM public.commit_agenda_import_run(v_failure_run);
  PERFORM public.agenda_stageb_fixture_assert(
    v_outcome = 'already_committed' AND v_imported = 1 AND v_version = 2
      AND (SELECT count(*) = 1 FROM public.agenda_items WHERE event_id = v_event_a AND external_id = 'agenda-stageb-retry')
      AND (SELECT count(*) = v_before_ledger + 1 FROM public.agenda_command_ledger WHERE event_id = v_event_a),
    'committed retry is idempotent with no duplicate Agenda or ledger effects'
  );

  -- Stale version is a complete rollback and receives only the bounded stale
  -- code in recovery.
  INSERT INTO public.import_runs(
    id, event_id, import_type, source_filename, source_metadata, created_by_auth_user_id
  ) VALUES (
    v_stale_run, v_event_a, 'agenda', 'agenda-stageb-stale.csv',
    jsonb_build_object('row_count', 1, 'expected_agenda_version', 0), v_both
  );
  INSERT INTO public.import_run_rows(
    import_run_id, event_id, source_row_number, source_payload, normalized_candidate,
    source_fingerprint, validation_state, review_state, row_state
  ) VALUES (
    v_stale_run, v_event_a, 2, '{}'::jsonb,
    public.agenda_stageb_fixture_candidate(2, 'Stale candidate', '2026-09-05', '09:00', 'agenda-stageb-stale'),
    'agenda-stageb-stale', 'valid', 'approved', 'approved'
  );
  SELECT version INTO v_before_version FROM public.event_agenda_state WHERE event_id = v_event_a;
  v_failed := false;
  BEGIN
    PERFORM public.commit_agenda_import_run(v_stale_run);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'stale_agenda_version';
  END;
  PERFORM public.agenda_stageb_fixture_assert(
    v_failed
      AND NOT EXISTS (SELECT 1 FROM public.agenda_items WHERE event_id = v_event_a AND external_id = 'agenda-stageb-stale')
      AND (SELECT version = v_before_version FROM public.event_agenda_state WHERE event_id = v_event_a)
      AND (SELECT row_state = 'approved' FROM public.import_run_rows WHERE import_run_id = v_stale_run),
    'stale expected version rejects with no partial canonical or staging mutation'
  );
  PERFORM public.record_agenda_import_run_commit_failure(v_stale_run, 'agenda_commit_stale_version');
  v_recovery := public.get_managed_import_run_recovery(v_stale_run);
  PERFORM public.agenda_stageb_fixture_assert(
    v_recovery #>> '{rows,0,row_state}' = 'commit_failed'
      AND v_recovery #>> '{rows,0,commit_error,code}' = 'agenda_commit_stale_version'
      AND v_recovery::text NOT LIKE '%stale_agenda_version%',
    'stale recovery is truthful and bounded'
  );

  -- Authority, Event, run-type, and lifecycle denials are zero-mutation.
  INSERT INTO public.import_runs(
    id, event_id, import_type, source_metadata, created_by_auth_user_id, status, finalized_at
  ) VALUES
    (v_imports_only_run, v_event_a, 'agenda', '{"row_count":1,"expected_agenda_version":2}', v_imports, 'staging', NULL),
    (v_agenda_only_run, v_event_a, 'agenda', '{"row_count":1,"expected_agenda_version":2}', v_agenda, 'staging', NULL),
    (v_neither_run, v_event_a, 'agenda', '{"row_count":1,"expected_agenda_version":2}', v_neither, 'staging', NULL),
    (v_cross_run, v_event_b, 'agenda', '{"row_count":1,"expected_agenda_version":0}', v_both, 'staging', NULL),
    (v_wrong_type_run, v_event_a, 'vendors', '{"row_count":1,"expected_agenda_version":2}', v_both, 'staging', NULL),
    (v_finalized_run, v_event_a, 'agenda', '{"row_count":1,"expected_agenda_version":2}', v_both, 'finalized', now()),
    (v_archived_run, v_event_archived, 'agenda', '{"row_count":1,"expected_agenda_version":0}', v_both, 'staging', NULL);

  INSERT INTO public.import_run_rows(
    import_run_id, event_id, source_row_number, source_payload, normalized_candidate,
    source_fingerprint, validation_state, review_state, row_state
  )
  SELECT run_id, event_id, 2, '{}'::jsonb,
    public.agenda_stageb_fixture_candidate(2, title, '2026-09-06', '09:00', external_id),
    external_id, 'valid', 'approved', 'approved'
  FROM (VALUES
    (v_imports_only_run, v_event_a, 'Imports only', 'agenda-stageb-auth-imports'),
    (v_agenda_only_run, v_event_a, 'Agenda only', 'agenda-stageb-auth-agenda'),
    (v_neither_run, v_event_a, 'Neither', 'agenda-stageb-auth-neither'),
    (v_cross_run, v_event_b, 'Cross Event', 'agenda-stageb-cross'),
    (v_wrong_type_run, v_event_a, 'Wrong type', 'agenda-stageb-wrong-type'),
    (v_finalized_run, v_event_a, 'Finalized', 'agenda-stageb-finalized'),
    (v_archived_run, v_event_archived, 'Archived', 'agenda-stageb-archived')
  ) AS seeded(run_id, event_id, title, external_id);

  SELECT count(*) INTO v_before_items FROM public.agenda_items;
  SELECT count(*) INTO v_before_ledger FROM public.agenda_command_ledger;

  PERFORM set_config('request.jwt.claim.sub', v_imports::text, true);
  v_failed := false;
  BEGIN PERFORM public.commit_agenda_import_run(v_imports_only_run);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'not_authorized'; END;
  PERFORM public.agenda_stageb_fixture_assert(v_failed, 'Imports-only authority denied');

  PERFORM set_config('request.jwt.claim.sub', v_agenda::text, true);
  v_failed := false;
  BEGIN PERFORM public.commit_agenda_import_run(v_agenda_only_run);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'not_authorized'; END;
  PERFORM public.agenda_stageb_fixture_assert(v_failed, 'Agenda-only authority denied');

  PERFORM set_config('request.jwt.claim.sub', v_neither::text, true);
  v_failed := false;
  BEGIN PERFORM public.commit_agenda_import_run(v_neither_run);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'not_authorized'; END;
  PERFORM public.agenda_stageb_fixture_assert(v_failed, 'caller with neither authority denied');

  PERFORM set_config('request.jwt.claim.sub', v_both::text, true);
  v_failed := false;
  BEGIN PERFORM public.commit_agenda_import_run(v_cross_run);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'not_authorized'; END;
  PERFORM public.agenda_stageb_fixture_assert(v_failed, 'unrelated Event authority denied');

  v_failed := false;
  BEGIN PERFORM public.commit_agenda_import_run(v_wrong_type_run);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'import_run_not_agenda'; END;
  PERFORM public.agenda_stageb_fixture_assert(v_failed, 'incorrect import run type denied');

  v_failed := false;
  BEGIN PERFORM public.commit_agenda_import_run(v_finalized_run);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'import_run_not_committable'; END;
  PERFORM public.agenda_stageb_fixture_assert(v_failed, 'finalized lifecycle state denied');

  v_failed := false;
  BEGIN PERFORM public.commit_agenda_import_run(v_archived_run);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'event_archived'; END;
  PERFORM public.agenda_stageb_fixture_assert(v_failed, 'archived Event lifecycle denied');

  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_failed := false;
  BEGIN PERFORM public.commit_agenda_import_run(v_imports_only_run);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'missing_input'; END;
  PERFORM public.agenda_stageb_fixture_assert(v_failed, 'anonymous caller denied');

  PERFORM public.agenda_stageb_fixture_assert(
    (SELECT count(*) = v_before_items FROM public.agenda_items)
      AND (SELECT count(*) = v_before_ledger FROM public.agenda_command_ledger)
      AND NOT EXISTS (
        SELECT 1 FROM public.import_run_rows
        WHERE import_run_id IN (
          v_imports_only_run, v_agenda_only_run, v_neither_run, v_cross_run,
          v_wrong_type_run, v_finalized_run, v_archived_run
        ) AND row_state <> 'approved'
      ),
    'every authority/type/lifecycle denial has zero canonical and staging mutation'
  );

  -- Minimum EXECUTE surface and fixed owner/search_path while definitions
  -- are present inside the outer transaction.
  PERFORM public.agenda_stageb_fixture_assert(
    has_function_privilege('authenticated', 'public.commit_agenda_import_run(uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.record_agenda_import_run_commit_failure(uuid,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.import_event_agenda_items(uuid,integer,jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.commit_agenda_import_run(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.record_agenda_import_run_commit_failure(uuid,text)', 'EXECUTE'),
    'authenticated has only the intended Stage B commit surface and anon has none'
  );
  PERFORM public.agenda_stageb_fixture_assert(
    (SELECT pg_get_userbyid(p.proowner) = 'postgres'
       AND p.proconfig = ARRAY['search_path=pg_catalog']
     FROM pg_proc AS p
     WHERE p.oid = 'public.commit_agenda_import_run(uuid)'::regprocedure)
      AND
    (SELECT pg_get_userbyid(p.proowner) = 'postgres'
       AND p.proconfig = ARRAY['search_path=pg_catalog']
     FROM pg_proc AS p
     WHERE p.oid = 'public.record_agenda_import_run_commit_failure(uuid,text)'::regprocedure),
    'Stage B functions are postgres-owned with fixed pg_catalog search_path'
  );
END;
$$;

ROLLBACK;

-- Post-rollback residue proof. Fixed fixture identifiers make this check
-- independent of transaction-local variables and helper functions.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tenants
    WHERE id = 'b2300000-0000-0000-0000-000000000001'::uuid
  ) THEN
    RAISE EXCEPTION 'agenda_stageb_fixture_residue: tenant';
  END IF;
  IF to_regprocedure('public.agenda_stageb_fixture_assert(boolean,text)') IS NOT NULL
    OR to_regprocedure('public.agenda_stageb_fixture_candidate(integer,text,text,text,text,integer)') IS NOT NULL
    OR to_regprocedure('public.agenda_stageb_fixture_fail_staging_result()') IS NOT NULL THEN
    RAISE EXCEPTION 'agenda_stageb_fixture_residue: helper function';
  END IF;
  IF (
    SELECT count(*) FROM supabase_migrations.schema_migrations
    WHERE version = '20260823000000'
  ) <> 1 THEN
    RAISE EXCEPTION 'agenda_stageb_fixture_residue: migration history drift';
  END IF;
END;
$$;
