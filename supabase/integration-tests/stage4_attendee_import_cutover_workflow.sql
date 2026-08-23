-- Stage 4 (application-layer) linked-database workflow proof. Stage 4 adds
-- no new SQL objects -- this fixture exercises the already-live Stage 1 /
-- Stage 3 / Stage 3.1 / Stage 1.1 governed RPCs end-to-end, in the exact
-- sequence lib/attendeeImportOrchestration.ts performs, against an isolated
-- tenant/Event that is always rolled back.
BEGIN;

CREATE FUNCTION public.stage4_fixture_assert(p_ok boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'stage4_fixture_assertion_failed: %', p_message; END IF; END $$;

CREATE FUNCTION public.stage4_fixture_candidate(p_entry text, p_email text, p_capacity integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'source_row_number', 1,
    'registration', jsonb_build_object('entry_id', p_entry, 'pilot_first', 'Stage4', 'pilot_last', 'Fixture', 'nickname', '', 'email', p_email, 'membership_number', 'M-STAGE4', 'primary_phone', '', 'cell_phone', '', 'city', '', 'state', '', 'wants_to_volunteer', false, 'is_first_timer', false, 'share_with_attendees', false, 'special_events_raw', '', 'coach_manufacturer', '', 'coach_model', ''),
    'copilot', jsonb_build_object('first', '', 'last', '', 'nickname', '', 'email', '', 'cell_phone', ''),
    'capacity_evidence', jsonb_build_object('imported_capacity', p_capacity, 'structured_participant_minimum', 1),
    'activities', '[]'::jsonb,
    'reference_only', jsonb_build_object('additional_attendees', '')
  );
$$;

CREATE FUNCTION public.stage4_fixture_force_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('stage4.fixture_failure', true) = 'true' THEN RAISE EXCEPTION 'stage4_forced_failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER stage4_fixture_fail_attendee BEFORE INSERT OR UPDATE ON public.attendees FOR EACH ROW EXECUTE FUNCTION public.stage4_fixture_force_failure();

DO $$
DECLARE
  t uuid := gen_random_uuid(); ev uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  run_id uuid; row_valid uuid; row_invalid uuid; row_review uuid; row_ambiguous uuid; row_failure uuid;
  staged public.import_run_rows%ROWTYPE; reviewed public.import_run_rows%ROWTYPE; failed public.import_run_rows%ROWTYPE;
  out_outcome text; out_attendee uuid;
  recovery jsonb; recovered_row jsonb;
  before_attendee_count integer; after_attendee_count integer;
BEGIN
  -- Isolated tenant / Event / authorized caller -------------------------
  INSERT INTO public.tenants(id, organization_code, slug, organization_name, display_name, app_title)
    VALUES (t, 'S4FIX-'||left(t::text, 8), 's4fix-'||left(t::text, 8), 'Stage 4 Fixture', 'Stage 4 Fixture', 'Stage 4 Fixture');
  INSERT INTO public.events(id, tenant_id, name, start_date, end_date, timezone, lifecycle_state)
    VALUES (ev, t, 'stage4-fixture-'||ev::text, current_date, current_date + 30, 'UTC', 'operational');
  INSERT INTO auth.users(id, email) VALUES (u, 'stage4-'||u||'@fixture.invalid');
  INSERT INTO public.admin_users(user_id, email, display_name) VALUES (u, 'stage4-'||u||'@fixture.invalid', 'Stage 4 Fixture Admin');
  INSERT INTO public.admin_event_access(admin_user_id, event_id, role)
    SELECT id, ev, 'event_admin' FROM public.admin_users WHERE user_id = u;
  INSERT INTO public.admin_event_permissions(admin_event_access_id, permission_key)
    SELECT a.id, p.task FROM public.admin_event_access a
    CROSS JOIN (VALUES ('event.imports.manage'), ('event.attendees.manage')) p(task)
    WHERE a.event_id = ev;
  PERFORM set_config('request.jwt.claim.sub', u::text, true);

  -- 1. Stage 1: create_import_run ---------------------------------------
  SELECT id INTO run_id FROM public.create_import_run(ev, 'attendee_roster', 'stage4-fixture.csv', jsonb_build_object('header_count', 4, 'row_count', 5));
  PERFORM public.stage4_fixture_assert(run_id IS NOT NULL, 'run created');

  -- 2. A valid, commit-eligible row ---------------------------------------
  SELECT * INTO staged FROM public.stage_import_run_row(run_id, 1, '{}'::jsonb, public.stage4_fixture_candidate('S4-VALID', 'valid.fixture@example.invalid', 1), 's4-valid-'||run_id);
  row_valid := staged.id;
  SELECT * INTO reviewed FROM public.set_import_run_row_review_state(row_valid, 'valid', '[]'::jsonb, 'approved');
  PERFORM public.stage4_fixture_assert(reviewed.row_state = 'approved', 'valid row approved');

  -- 3. A structurally invalid row (Stage 2 validation_failed) ----------
  SELECT * INTO staged FROM public.stage_import_run_row(run_id, 2, '{}'::jsonb, public.stage4_fixture_candidate('', '', NULL), 's4-invalid-'||run_id);
  row_invalid := staged.id;
  SELECT * INTO reviewed FROM public.set_import_run_row_review_state(row_invalid, 'invalid', jsonb_build_array(jsonb_build_object('code', 'missing_entry_id', 'message', 'Missing Entry ID', 'severity', 'error')), 'unreviewed');
  PERFORM public.stage4_fixture_assert(reviewed.row_state = 'validation_failed', 'invalid row -> validation_failed');

  -- 4. A file-internal-ambiguity review row (Stage 2 classifyFileAmbiguities) --
  SELECT * INTO staged FROM public.stage_import_run_row(run_id, 3, '{}'::jsonb, public.stage4_fixture_candidate('S4-DUP', 'dup.fixture@example.invalid', 1), 's4-review-'||run_id);
  row_review := staged.id;
  SELECT * INTO reviewed FROM public.set_import_run_row_review_state(row_review, 'valid', jsonb_build_array(jsonb_build_object('code', 'duplicate_entry_id_in_file', 'message', 'Duplicate Entry ID in file', 'severity', 'error')), 'needs_review');
  PERFORM public.stage4_fixture_assert(reviewed.row_state = 'needs_review', 'file ambiguity -> needs_review');

  -- 5. A row that will hit Stage 3's own external Entry-ID/email ambiguity --
  INSERT INTO public.attendees(event_id, entry_id, email, pilot_first, pilot_last, participant_capacity)
    VALUES (ev, 'S4-AMB-A', 'amb-a@example.invalid', 'Amb', 'One', 1),
           (ev, 'S4-AMB-B', 'amb-b@example.invalid', 'Amb', 'Two', 1);
  SELECT * INTO staged FROM public.stage_import_run_row(run_id, 4, '{}'::jsonb, public.stage4_fixture_candidate('S4-AMB-A', 'amb-b@example.invalid', 1), 's4-amb-'||run_id);
  row_ambiguous := staged.id;
  PERFORM public.set_import_run_row_review_state(row_ambiguous, 'valid', '[]'::jsonb, 'approved');

  -- 6. A row that will hit a genuine canonical rollback -------------------
  SELECT * INTO staged FROM public.stage_import_run_row(run_id, 5, '{}'::jsonb, public.stage4_fixture_candidate('S4-FAIL', 'fail.fixture@example.invalid', 1), 's4-fail-'||run_id);
  row_failure := staged.id;
  PERFORM public.set_import_run_row_review_state(row_failure, 'valid', '[]'::jsonb, 'approved');

  -- ---- Commit pass: only approved rows may ever reach Stage 3 ----------
  BEGIN
    PERFORM public.commit_attendee_import_run_row(row_invalid);
    RAISE EXCEPTION 'Stage 3 accepted a validation_failed row';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage4_fixture_assert(SQLERRM = 'import_row_not_approved', 'validation_failed row rejected by Stage 3');
  END;
  BEGIN
    PERFORM public.commit_attendee_import_run_row(row_review);
    RAISE EXCEPTION 'Stage 3 accepted a needs_review row';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage4_fixture_assert(SQLERRM = 'import_row_not_approved', 'needs_review row rejected by Stage 3');
  END;

  -- Valid approved row commits.
  SELECT outcome, attendee_id INTO out_outcome, out_attendee FROM public.commit_attendee_import_run_row(row_valid);
  PERFORM public.stage4_fixture_assert(out_outcome = 'committed', 'valid row committed');

  -- Ambiguous row: Stage 3 returns needs_review (never a guessed target);
  -- the orchestration layer then persists that truthfully through Stage 1.
  SELECT outcome INTO out_outcome FROM public.commit_attendee_import_run_row(row_ambiguous);
  PERFORM public.stage4_fixture_assert(out_outcome = 'needs_review', 'ambiguous row -> Stage 3 needs_review, not a guess');
  SELECT * INTO reviewed FROM public.set_import_run_row_review_state(row_ambiguous, 'valid', jsonb_build_array(jsonb_build_object('code', 'registration_identity_ambiguous', 'message', 'Entry ID/email disagreement', 'severity', 'error')), 'needs_review');
  PERFORM public.stage4_fixture_assert(reviewed.row_state = 'needs_review' AND reviewed.canonical_target_id IS NULL, 'ambiguity persisted as needs_review with no canonical target');

  -- Genuine canonical rollback -> Stage 3.1 records commit_failed.
  PERFORM set_config('stage4.fixture_failure', 'true', true);
  BEGIN
    PERFORM public.commit_attendee_import_run_row(row_failure);
    RAISE EXCEPTION 'Stage 3 did not roll back';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage4_fixture_assert(SQLERRM = 'stage4_forced_failure', 'forced Stage 3 rollback');
  END;
  SELECT count(*) INTO before_attendee_count FROM public.attendees WHERE event_id = ev AND entry_id = 'S4-FAIL';
  PERFORM public.stage4_fixture_assert(before_attendee_count = 0, 'failed Stage 3 left no canonical attendee');
  SELECT * INTO failed FROM public.record_attendee_import_run_row_commit_failure(row_failure, 'canonical_commit_failed');
  PERFORM public.stage4_fixture_assert(failed.row_state = 'commit_failed' AND failed.commit_error ->> 'code' = 'canonical_commit_failed', 'Stage 3.1 recorded commit_failed with the classified code');

  -- Retry succeeds once the forced-failure condition is removed.
  PERFORM set_config('stage4.fixture_failure', 'false', true);
  SELECT outcome, attendee_id INTO out_outcome, out_attendee FROM public.commit_attendee_import_run_row(row_failure);
  PERFORM public.stage4_fixture_assert(out_outcome = 'committed', 'retry after recorded failure commits');

  -- Retry of an already-committed row is idempotent -- no duplicate work.
  SELECT outcome INTO out_outcome FROM public.commit_attendee_import_run_row(row_valid);
  PERFORM public.stage4_fixture_assert(out_outcome = 'already_committed', 'already-committed retry is idempotent');
  SELECT count(*) INTO after_attendee_count FROM public.attendees WHERE event_id = ev AND entry_id = 'S4-VALID';
  PERFORM public.stage4_fixture_assert(after_attendee_count = 1, 'idempotent retry created no duplicate attendee');

  -- 8. Stage 1.1 recovery returns the truthful final state of every row --
  recovery := public.get_managed_import_run_recovery(run_id);
  PERFORM public.stage4_fixture_assert(recovery -> 'run' ->> 'status' = 'staging', 'recovery reports run status');
  PERFORM public.stage4_fixture_assert(jsonb_array_length(recovery -> 'rows') = 5, 'recovery reports all five rows');

  FOR recovered_row IN SELECT * FROM jsonb_array_elements(recovery -> 'rows') LOOP
    IF recovered_row ->> 'id' = row_valid::text THEN
      PERFORM public.stage4_fixture_assert(recovered_row ->> 'row_state' = 'committed', 'recovery: valid row committed');
    ELSIF recovered_row ->> 'id' = row_invalid::text THEN
      PERFORM public.stage4_fixture_assert(recovered_row ->> 'row_state' = 'validation_failed', 'recovery: invalid row validation_failed, never sent to Stage 3');
    ELSIF recovered_row ->> 'id' = row_review::text THEN
      PERFORM public.stage4_fixture_assert(recovered_row ->> 'row_state' = 'needs_review', 'recovery: file-ambiguity row needs_review, never sent to Stage 3');
    ELSIF recovered_row ->> 'id' = row_ambiguous::text THEN
      PERFORM public.stage4_fixture_assert(recovered_row ->> 'row_state' = 'needs_review' AND recovered_row -> 'canonical_target_id' = 'null'::jsonb, 'recovery: Stage 3 ambiguity row needs_review, no canonical target');
    ELSIF recovered_row ->> 'id' = row_failure::text THEN
      PERFORM public.stage4_fixture_assert(recovered_row ->> 'row_state' = 'committed' AND recovered_row -> 'commit_error' = 'null'::jsonb, 'recovery: retried failure row committed, failure cleared');
    ELSE
      PERFORM public.stage4_fixture_assert(false, 'unexpected row in recovery result: '||(recovered_row ->> 'id'));
    END IF;
  END LOOP;

  -- Recovery never exposes raw source payload or creator/auth evidence.
  PERFORM public.stage4_fixture_assert(NOT (recovery -> 'rows' -> 0 ? 'source_payload'), 'recovery excludes source_payload');
  PERFORM public.stage4_fixture_assert(NOT (recovery -> 'run' ? 'created_by_auth_user_id'), 'recovery excludes creator identity');

  -- 9. No Person/Participation mutation; the fixture leaves nothing durable.
  PERFORM public.stage4_fixture_assert(
    NOT EXISTS (SELECT 1 FROM public.people p JOIN public.attendees a ON a.person_id = p.id WHERE a.event_id = ev)
    AND NOT EXISTS (SELECT 1 FROM public.person_event_participations pep WHERE pep.event_id = ev),
    'no Person or Participation mutation'
  );
END $$;

ROLLBACK;
SELECT 'stage4 fixture PASS: outer rollback completed' AS result;
