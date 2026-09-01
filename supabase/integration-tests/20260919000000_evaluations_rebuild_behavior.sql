-- Executable local-database behaviour proof for
-- 20260919000000_rebuild_tenant_scoped_evaluations.sql.
--
-- This environment has no live Postgres in CI, so this is a manual proof:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 \
--        -f supabase/integration-tests/20260919000000_evaluations_rebuild_behavior.sql
--
-- Runs inside ONE transaction and ROLLS BACK -- it creates and destroys
-- its own tenants / event / agenda item / attendees and never touches
-- real data. Every check is an ASSERT; the final NOTICE only prints if
-- all passed.
--
-- Covers the post-adversarial-review correctness pass:
--   * BLOCKER 1 -- admin reporting counts ONLY submitted responses
--   * BLOCKER 3 -- a member may edit answers after submitting
--   * DUPLICATE REORDER FIX -- reorder rejects any non-permutation
--   plus the original template/assignment/snapshot/freeze/second-tenant
--   guarantees.

BEGIN;

DO $fix$
DECLARE
  v_admin uuid := '11111111-1111-1111-1111-111111111111';
  v_m1 uuid := '22222222-2222-2222-2222-222222222222';
  v_m2 uuid := '33333333-3333-3333-3333-333333333333';
  v_tenant_a uuid := gen_random_uuid();
  v_tenant_b uuid := gen_random_uuid();
  v_event_a uuid := gen_random_uuid();
  v_event_b uuid := gen_random_uuid();
  v_agenda uuid := gen_random_uuid();
  v_p1 uuid := gen_random_uuid();
  v_p2 uuid := gen_random_uuid();
  v_a1 uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_admin, 'admin@example.test', 'authenticated', 'authenticated'),
    (v_m1, 'm1@example.test', 'authenticated', 'authenticated'),
    (v_m2, 'm2@example.test', 'authenticated', 'authenticated');

  INSERT INTO public.tenants (id, organization_code, slug, organization_name, display_name, app_title, is_active)
  VALUES (v_tenant_a,'TA','ta','TA Org','TA','TA Hub',true),
         (v_tenant_b,'TB','tb','TB Org','TB','TB Hub',true);

  INSERT INTO public.admin_users (id, user_id, email, is_active, privilege_group)
  VALUES (gen_random_uuid(), v_admin, 'admin@example.test', true, 'super_admin');

  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members)
  VALUES (v_event_a,'Event A',v_tenant_a,true,true),
         (v_event_b,'Event B',v_tenant_b,true,true);

  INSERT INTO public.agenda_items (id, event_id, title, start_time, speaker)
  VALUES (v_agenda, v_event_a, 'Chassis Care 101', '10:00', 'Pat Presenter');

  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_p1, v_tenant_a, 'One', 'Member', 'active'),
         (v_p2, v_tenant_a, 'Two', 'Member', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_p1, v_m1, 'active'), (v_p2, v_m2, 'active');

  INSERT INTO public.attendees (id, event_id, person_id, share_with_attendees, is_active, registration_status, login_count)
  VALUES (v_a1, v_event_a, v_p1, false, true, 'registered', 0),
         (v_a2, v_event_a, v_p2, false, true, 'registered', 0);

  INSERT INTO public.person_event_participations (person_id, event_id, participation_state)
  VALUES (v_p1, v_event_a, 'eligible'), (v_p2, v_event_a, 'eligible');
  INSERT INTO public.person_role_instances
    (person_id, tenant_id, event_id, attendee_id, identity_role, source_table, source_record_id,
     attribution_method, evidence_source, source_role_instance_key)
  VALUES (v_p1, v_tenant_a, v_event_a, v_a1, 'PILOT', 'public.attendees', v_a1, 'automatic_backfill', 't', 't-'||v_a1),
         (v_p2, v_tenant_a, v_event_a, v_a2, 'PILOT', 'public.attendees', v_a2, 'automatic_backfill', 't', 't-'||v_a2);

  PERFORM set_config('t.admin', v_admin::text, false);
  PERFORM set_config('t.m1', v_m1::text, false);
  PERFORM set_config('t.m2', v_m2::text, false);
  PERFORM set_config('t.event_a', v_event_a::text, false);
  PERFORM set_config('t.event_b', v_event_b::text, false);
  PERFORM set_config('t.agenda', v_agenda::text, false);
END
$fix$;

DO $test$
DECLARE
  admin text := current_setting('t.admin');
  m1 text := current_setting('t.m1');
  m2 text := current_setting('t.m2');
  event_a uuid := current_setting('t.event_a')::uuid;
  event_b uuid := current_setting('t.event_b')::uuid;
  agenda uuid := current_setting('t.agenda')::uuid;
  tpl uuid; tpl_b uuid; tpl_mal uuid;
  r jsonb; q jsonb;
  fq_choice uuid; fq_multi uuid; fq_free uuid; fq_rating uuid;
  fq_sc uuid; fq_ms uuid; fq_yn uuid;
  tq_ids uuid[]; n int; snap_prompt text;
  v_m1_response uuid; v_first_submit timestamptz; v_ts timestamptz; v_bool boolean;
BEGIN
  -- === Build a small template: choice, multi, free, rating (all with comments) ===
  PERFORM set_config('request.jwt.claim.sub', admin, false);
  tpl := public.create_evaluation_template(event_a, 'Behaviour Test Template', false, 'event');
  PERFORM public.upsert_evaluation_template_question(event_a, tpl, NULL, 'Overall?', 'single_choice', true, true, 1, 5, ARRAY['Good','Bad']);
  PERFORM public.upsert_evaluation_template_question(event_a, tpl, NULL, 'Which parts?', 'multi_select', false, true, 1, 5, ARRAY['Talks','Food']);
  PERFORM public.upsert_evaluation_template_question(event_a, tpl, NULL, 'Free thoughts', 'free_text', false, true, 1, 5, NULL);
  PERFORM public.upsert_evaluation_template_question(event_a, tpl, NULL, 'Rate it', 'rating', false, true, 1, 5, NULL);

  SELECT array_agg(id ORDER BY position) INTO tq_ids
  FROM public.tenant_evaluation_template_questions WHERE template_id = tpl;

  -- === DUPLICATE REORDER FIX ===
  BEGIN
    PERFORM public.reorder_evaluation_template_questions(event_a, tpl, ARRAY[tq_ids[1], tq_ids[1], tq_ids[3], tq_ids[4]]);
    RAISE EXCEPTION 'reorder accepted a duplicate id';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%duplicate question id%', SQLERRM; END;
  BEGIN
    PERFORM public.reorder_evaluation_template_questions(event_a, tpl, ARRAY[tq_ids[1], tq_ids[2]]);
    RAISE EXCEPTION 'reorder accepted a short (missing) list';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%every question exactly once%', SQLERRM; END;
  BEGIN
    PERFORM public.reorder_evaluation_template_questions(event_a, tpl, tq_ids || gen_random_uuid());
    RAISE EXCEPTION 'reorder accepted an extra id';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%every question exactly once%' OR SQLERRM LIKE '%not in this template%', SQLERRM; END;
  BEGIN
    PERFORM public.reorder_evaluation_template_questions(event_a, tpl, ARRAY[tq_ids[1], tq_ids[2], tq_ids[3], gen_random_uuid()]);
    RAISE EXCEPTION 'reorder accepted a foreign id';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%not in this template%', SQLERRM; END;
  -- a real permutation still works
  PERFORM public.reorder_evaluation_template_questions(event_a, tpl, ARRAY[tq_ids[4], tq_ids[3], tq_ids[2], tq_ids[1]]);
  ASSERT (SELECT id FROM public.tenant_evaluation_template_questions WHERE template_id = tpl AND position = 0) = tq_ids[4], 'permutation applied';
  PERFORM public.reorder_evaluation_template_questions(event_a, tpl, ARRAY[tq_ids[1], tq_ids[2], tq_ids[3], tq_ids[4]]);

  PERFORM public.assign_evaluation(event_a, 'event', event_a, tpl);

  -- === Two members: m1 COMPLETES, m2 leaves a DRAFT ===
  r := (SELECT public.get_evaluation(event_a,'event',event_a,NULL,NULL));
  SELECT (value->>'id')::uuid INTO fq_choice FROM jsonb_array_elements(r->'form'->'questions') value WHERE value->>'question_type'='single_choice';
  SELECT (value->>'id')::uuid INTO fq_multi FROM jsonb_array_elements(r->'form'->'questions') value WHERE value->>'question_type'='multi_select';
  SELECT (value->>'id')::uuid INTO fq_free FROM jsonb_array_elements(r->'form'->'questions') value WHERE value->>'question_type'='free_text';
  SELECT (value->>'id')::uuid INTO fq_rating FROM jsonb_array_elements(r->'form'->'questions') value WHERE value->>'question_type'='rating';

  -- m1 answers everything and submits
  PERFORM set_config('request.jwt.claim.sub', m1, false);
  PERFORM public.save_evaluation_answer(event_a,'event',event_a,NULL,NULL, fq_choice, NULL, ARRAY['Good'], NULL, 'm1 comment');
  PERFORM public.save_evaluation_answer(event_a,'event',event_a,NULL,NULL, fq_multi, NULL, ARRAY['Talks','Food'], NULL, NULL);
  PERFORM public.save_evaluation_answer(event_a,'event',event_a,NULL,NULL, fq_free, 'm1 free text', NULL, NULL, NULL);
  PERFORM public.save_evaluation_answer(event_a,'event',event_a,NULL,NULL, fq_rating, NULL, NULL, 5, NULL);
  PERFORM public.submit_evaluation(event_a,'event',event_a,NULL,NULL);

  -- m2 autosaves a DRAFT only (never submits)
  PERFORM set_config('request.jwt.claim.sub', m2, false);
  PERFORM public.save_evaluation_answer(event_a,'event',event_a,NULL,NULL, fq_choice, NULL, ARRAY['Bad'], NULL, 'm2 DRAFT comment');
  PERFORM public.save_evaluation_answer(event_a,'event',event_a,NULL,NULL, fq_multi, NULL, ARRAY['Food'], NULL, NULL);
  PERFORM public.save_evaluation_answer(event_a,'event',event_a,NULL,NULL, fq_free, 'm2 DRAFT free text', NULL, NULL, NULL);
  PERFORM public.save_evaluation_answer(event_a,'event',event_a,NULL,NULL, fq_rating, NULL, NULL, 1, NULL);

  -- === BLOCKER 1: report reflects ONLY m1 (the completed response) ===
  PERFORM set_config('request.jwt.claim.sub', admin, false);
  r := public.get_evaluation_report(event_a, 'event', event_a);
  ASSERT (r->>'started')::int = 2, 'started counts both responses';
  ASSERT (r->>'completed')::int = 1, 'completed counts only m1';

  FOR q IN SELECT value FROM jsonb_array_elements(r->'questions') value LOOP
    IF q->>'question_type' = 'single_choice' THEN
      -- A: draft answer "Bad" must NOT appear; only m1's "Good"
      ASSERT q->'choice_breakdown' = '[{"label": "Good", "count": 1}]'::jsonb,
        'B1.A choice_breakdown excludes the draft: ' || (q->'choice_breakdown')::text;
      ASSERT (q->>'answered_count')::int = 1, 'B1.A answered_count is completed-only';
      -- D: draft comment "m2 DRAFT comment" must NOT be exposed
      ASSERT q->'comments' = '["m1 comment"]'::jsonb, 'B1.D draft comment hidden: ' || (q->'comments')::text;
    ELSIF q->>'question_type' = 'multi_select' THEN
      ASSERT q->'choice_breakdown' @> '[{"label":"Talks","count":1}]'::jsonb
         AND q->'choice_breakdown' @> '[{"label":"Food","count":1}]'::jsonb,
        'B1 multi counts only m1: ' || (q->'choice_breakdown')::text;
      -- m2's draft "Food" would make Food count 2 -- prove it is 1
      ASSERT NOT (q->'choice_breakdown' @> '[{"label":"Food","count":2}]'::jsonb), 'B1 multi excludes draft';
    ELSIF q->>'question_type' = 'free_text' THEN
      ASSERT q->'free_text' = '["m1 free text"]'::jsonb, 'B1.D draft free text hidden: ' || (q->'free_text')::text;
    ELSIF q->>'question_type' = 'rating' THEN
      ASSERT (q->'rating_summary'->>'average')::numeric = 5, 'B1 rating avg is m1-only (5), not (5+1)/2';
      ASSERT (q->'rating_summary'->>'count')::int = 1, 'B1 rating count excludes draft';
    END IF;
  END LOOP;

  -- === BLOCKER 1.B: after m2 submits, m2's answers DO appear ===
  PERFORM set_config('request.jwt.claim.sub', m2, false);
  PERFORM public.submit_evaluation(event_a,'event',event_a,NULL,NULL);
  PERFORM set_config('request.jwt.claim.sub', admin, false);
  r := public.get_evaluation_report(event_a, 'event', event_a);
  ASSERT (r->>'completed')::int = 2, 'B1.B both now complete';
  FOR q IN SELECT value FROM jsonb_array_elements(r->'questions') value LOOP
    IF q->>'question_type' = 'rating' THEN
      ASSERT (q->'rating_summary'->>'average')::numeric = 3.00, 'B1.B rating avg now (5+1)/2 = 3';
    ELSIF q->>'question_type' = 'free_text' THEN
      ASSERT jsonb_array_length(q->'free_text') = 2, 'B1.B both free texts now present';
    END IF;
  END LOOP;

  -- === BLOCKER 3: m1 edits an answer AFTER submitting ===
  PERFORM set_config('request.jwt.claim.sub', m1, false);
  r := public.get_evaluation(event_a,'event',event_a,NULL,NULL);
  ASSERT (r->'response'->>'is_complete')::boolean, 'B3 m1 response is complete on reload';
  -- change the single_choice answer Good -> Bad and edit the free text
  PERFORM public.save_evaluation_answer(event_a,'event',event_a,NULL,NULL, fq_choice, NULL, ARRAY['Bad'], NULL, 'm1 revised comment');
  PERFORM public.save_evaluation_answer(event_a,'event',event_a,NULL,NULL, fq_free, 'm1 REVISED free text', NULL, NULL, NULL);
  -- still marked complete (edit did not un-submit)
  ASSERT (SELECT is_complete FROM public.evaluation_responses r2
          JOIN public.attendees a ON a.id = r2.attendee_id
          JOIN public.person_auth_accounts paa ON paa.person_id = a.person_id
          WHERE paa.auth_user_id = m1::uuid), 'B3 response stays complete after edit';
  r := public.submit_evaluation(event_a,'event',event_a,NULL,NULL);
  ASSERT (r->>'updated')::boolean, 'B3 submit reports an update (was already complete)';

  -- report reflects the LATEST submitted answer
  PERFORM set_config('request.jwt.claim.sub', admin, false);
  r := public.get_evaluation_report(event_a, 'event', event_a);
  FOR q IN SELECT value FROM jsonb_array_elements(r->'questions') value LOOP
    IF q->>'question_type' = 'single_choice' THEN
      -- m1 now "Bad", m2 still "Bad" -> Bad count 2, Good gone
      ASSERT q->'choice_breakdown' @> '[{"label":"Bad","count":2}]'::jsonb,
        'B3 report reflects m1 revised answer: ' || (q->'choice_breakdown')::text;
      ASSERT NOT (q->'comments' @> '["m1 comment"]'::jsonb)
         AND q->'comments' @> '["m1 revised comment"]'::jsonb, 'B3 latest comment shown';
    ELSIF q->>'question_type' = 'free_text' THEN
      ASSERT q->'free_text' @> '["m1 REVISED free text"]'::jsonb, 'B3 revised free text in report';
    END IF;
  END LOOP;

  -- assignment snapshot is UNCHANGED by member edits (historical integrity)
  SELECT count(*) INTO n FROM public.evaluation_assignment_questions q
    JOIN public.evaluation_assignments a ON a.id = q.assignment_id
    WHERE a.target_type='event' AND a.target_id = event_a;
  ASSERT n = 4, 'snapshot still has its 4 questions';
  ASSERT (SELECT prompt FROM public.evaluation_assignment_questions q
          JOIN public.evaluation_assignments a ON a.id = q.assignment_id
          WHERE a.target_type='event' AND a.target_id = event_a AND q.position = 0) = 'Overall?',
    'snapshot question text unchanged';

  -- editing the TEMPLATE after responses still cannot rewrite the snapshot
  SELECT prompt INTO snap_prompt FROM public.evaluation_assignment_questions q
    JOIN public.evaluation_assignments a ON a.id = q.assignment_id
    WHERE a.target_type='event' AND a.target_id = event_a AND q.position = 0;
  PERFORM public.upsert_evaluation_template_question(event_a, tpl, tq_ids[1], 'TEMPLATE REWORDED', 'single_choice', true, true, 1, 5, ARRAY['x','y']);
  ASSERT (SELECT prompt FROM public.evaluation_assignment_questions q
          JOIN public.evaluation_assignments a ON a.id = q.assignment_id
          WHERE a.target_type='event' AND a.target_id = event_a AND q.position = 0) = snap_prompt,
    'snapshot immune to later template edit';
  BEGIN
    PERFORM public.assign_evaluation(event_a, 'event', event_a, tpl);
    RAISE EXCEPTION 'expected frozen';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%evaluation_assignment_frozen%', SQLERRM; END;

  -- === Second tenant, completely different form, no code / no copied ids ===
  tpl_b := public.create_evaluation_template(event_b, 'Tenant B Form', false, 'event');
  PERFORM public.upsert_evaluation_template_question(event_b, tpl_b, NULL, 'Tenant B only question', 'yes_no', true, false, 1, 5, NULL);
  r := public.assign_evaluation(event_b, 'event', event_b, tpl_b);
  ASSERT (r->>'assigned')::boolean, 'second tenant assigns its own form';
  BEGIN
    PERFORM public.assign_evaluation(event_a, 'event', event_a, tpl_b);
    RAISE EXCEPTION 'expected cross-tenant refusal';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%does not belong%' OR SQLERRM LIKE '%frozen%', SQLERRM; END;

  -- =====================================================================
  -- COMPLETION INVARIANT LIFECYCLE (server-authoritative, one-way)
  --   is_complete = true  IMPLIES  every required snapshot question
  --   currently has a valid answer.
  -- (The converse does NOT hold: a response with every required answer
  --  valid but not yet re-submitted stays is_complete = false until the
  --  member explicitly presses Update -- see steps F/G below.)
  -- Enforced by save_evaluation_answer (downgrade) + submit_evaluation
  -- (upgrade), both via _evaluation_missing_required.
  -- =====================================================================

  -- Helper to read m1's response row.
  SELECT r2.id INTO v_m1_response
  FROM public.evaluation_responses r2
  JOIN public.attendees a ON a.id = r2.attendee_id
  JOIN public.person_auth_accounts paa ON paa.person_id = a.person_id
  WHERE paa.auth_user_id = m1::uuid
    AND r2.target_type = 'event' AND r2.target_id = event_a;

  -- A: m1's submitted response is complete, with a first-submission stamp.
  SELECT is_complete, submitted_at INTO v_bool, v_first_submit
  FROM public.evaluation_responses WHERE id = v_m1_response;
  ASSERT v_bool, 'INV.A submitted valid response is_complete = true';
  ASSERT v_first_submit IS NOT NULL, 'INV.A submitted_at is set';

  PERFORM set_config('request.jwt.claim.sub', m1, false);

  -- B: edit an OPTIONAL answer only (the multi_select, not required) -> stays complete.
  r := public.save_evaluation_answer(event_a,'event',event_a,NULL,NULL, fq_multi, NULL, ARRAY['Talks'], NULL, NULL);
  ASSERT (r->>'is_complete')::boolean AND NOT (r->>'downgraded')::boolean, 'INV.B optional edit keeps complete';
  ASSERT (SELECT is_complete FROM public.evaluation_responses WHERE id = v_m1_response), 'INV.B row still complete';

  -- C: change a REQUIRED answer from one valid value to another valid value -> stays complete.
  r := public.save_evaluation_answer(event_a,'event',event_a,NULL,NULL, fq_choice, NULL, ARRAY['Bad'], NULL, 'still fine');
  ASSERT (r->>'is_complete')::boolean AND NOT (r->>'downgraded')::boolean, 'INV.C valid->valid required edit keeps complete';

  -- D: clear a REQUIRED answer (empty selection) -> auto-downgrades to incomplete.
  r := public.save_evaluation_answer(event_a,'event',event_a,NULL,NULL, fq_choice, NULL, ARRAY[]::text[], NULL, NULL);
  ASSERT (r->>'downgraded')::boolean AND NOT (r->>'is_complete')::boolean, 'INV.D clearing a required answer downgrades: ' || r::text;
  ASSERT (r->>'missing_required') LIKE '%Overall?%', 'INV.D names the missing question';
  ASSERT NOT (SELECT is_complete FROM public.evaluation_responses WHERE id = v_m1_response), 'INV.D row is now incomplete';
  ASSERT (SELECT submitted_at FROM public.evaluation_responses WHERE id = v_m1_response) = v_first_submit,
    'INV.H submitted_at preserved across the downgrade';

  -- E: an incomplete response is excluded from the submitted report.
  PERFORM set_config('request.jwt.claim.sub', admin, false);
  r := public.get_evaluation_report(event_a, 'event', event_a);
  ASSERT (r->>'completed')::int = 1, 'INV.E only m2 counts as completed now (m1 downgraded)';
  FOR q IN SELECT value FROM jsonb_array_elements(r->'questions') value LOOP
    IF q->>'question_type' = 'single_choice' THEN
      -- m1's contribution is gone; only m2's "Bad"
      ASSERT q->'choice_breakdown' = '[{"label": "Bad", "count": 1}]'::jsonb,
        'INV.E downgraded response left the report: ' || (q->'choice_breakdown')::text;
    END IF;
  END LOOP;

  -- F: restore the required answer via AUTOSAVE alone -> still incomplete.
  PERFORM set_config('request.jwt.claim.sub', m1, false);
  r := public.save_evaluation_answer(event_a,'event',event_a,NULL,NULL, fq_choice, NULL, ARRAY['Good'], NULL, 'restored');
  ASSERT NOT (r->>'is_complete')::boolean AND NOT (r->>'downgraded')::boolean,
    'INV.F autosave restoring the answer does NOT re-complete: ' || r::text;
  ASSERT NOT (SELECT is_complete FROM public.evaluation_responses WHERE id = v_m1_response), 'INV.F row still incomplete';

  -- G: member presses Update -> submit_evaluation re-validates -> complete again.
  r := public.submit_evaluation(event_a,'event',event_a,NULL,NULL);
  ASSERT (r->>'ok')::boolean, 'INV.G re-submit succeeds once required answers restored';
  ASSERT (SELECT is_complete FROM public.evaluation_responses WHERE id = v_m1_response), 'INV.G row complete again';
  -- H: original submitted_at preserved across the whole cycle.
  ASSERT (SELECT submitted_at FROM public.evaluation_responses WHERE id = v_m1_response) = v_first_submit,
    'INV.H submitted_at unchanged after downgrade + re-submit';

  -- I: assignment snapshot untouched throughout.
  ASSERT (SELECT count(*) FROM public.evaluation_assignment_questions q2
          JOIN public.evaluation_assignments a2 ON a2.id = q2.assignment_id
          WHERE a2.target_type='event' AND a2.target_id = event_a) = 4, 'INV.I snapshot still 4 questions';
  ASSERT (SELECT prompt FROM public.evaluation_assignment_questions q2
          JOIN public.evaluation_assignments a2 ON a2.id = q2.assignment_id
          WHERE a2.target_type='event' AND a2.target_id = event_a AND q2.position = 0) = 'Overall?',
    'INV.I snapshot question text unchanged (template was REWORDED earlier)';

  -- E (report reflects revised answer once complete again).
  PERFORM set_config('request.jwt.claim.sub', admin, false);
  r := public.get_evaluation_report(event_a, 'event', event_a);
  ASSERT (r->>'completed')::int = 2, 'INV report: m1 back in the completed set';
  FOR q IN SELECT value FROM jsonb_array_elements(r->'questions') value LOOP
    IF q->>'question_type' = 'single_choice' THEN
      ASSERT q->'choice_breakdown' @> '[{"label":"Good","count":1}]'::jsonb, 'INV report shows m1 restored "Good"';
    END IF;
  END LOOP;

  -- J: another attendee cannot touch m1's completion state.
  PERFORM set_config('request.jwt.claim.sub', m2, false);
  r := public.save_evaluation_answer(event_a,'event',event_a,NULL,NULL, fq_choice, NULL, ARRAY[]::text[], NULL, NULL);
  -- m2 downgraded m2's OWN response, not m1's
  ASSERT (SELECT is_complete FROM public.evaluation_responses WHERE id = v_m1_response),
    'INV.J m1 completion state untouched by m2 editing';
  ASSERT NOT (SELECT is_complete FROM public.evaluation_responses r3
              JOIN public.attendees a ON a.id = r3.attendee_id
              JOIN public.person_auth_accounts paa ON paa.person_id = a.person_id
              WHERE paa.auth_user_id = m2::uuid AND r3.target_type='event' AND r3.target_id = event_a),
    'INV.J m2 downgraded only its own response';

  -- =====================================================================
  -- MALFORMED-CHOICE HARDENING -- write-time rejection via real RPC calls.
  -- Fresh template on the agenda-item target so it is un-frozen.
  -- =====================================================================
  PERFORM set_config('request.jwt.claim.sub', admin, false);
  tpl_mal := public.create_evaluation_template(event_a, 'Malformed Test', false, 'event');
  PERFORM public.upsert_evaluation_template_question(event_a, tpl_mal, NULL, 'Pick one', 'single_choice', true, false, 1, 5, ARRAY['A','B']);
  PERFORM public.upsert_evaluation_template_question(event_a, tpl_mal, NULL, 'Pick many', 'multi_select', true, false, 1, 5, ARRAY['Talks','Food']);
  PERFORM public.upsert_evaluation_template_question(event_a, tpl_mal, NULL, 'Recommend?', 'yes_no', true, false, 1, 5, NULL);
  PERFORM public.assign_evaluation(event_a, 'agenda_item', agenda, tpl_mal);

  r := public.get_evaluation(event_a, 'agenda_item', agenda, NULL, NULL);
  SELECT (value->>'id')::uuid INTO fq_sc FROM jsonb_array_elements(r->'form'->'questions') value WHERE value->>'question_type'='single_choice';
  SELECT (value->>'id')::uuid INTO fq_ms FROM jsonb_array_elements(r->'form'->'questions') value WHERE value->>'question_type'='multi_select';
  SELECT (value->>'id')::uuid INTO fq_yn FROM jsonb_array_elements(r->'form'->'questions') value WHERE value->>'question_type'='yes_no';

  PERFORM set_config('request.jwt.claim.sub', m1, false);

  -- A: single_choice ARRAY[NULL] -> rejected
  BEGIN
    PERFORM public.save_evaluation_answer(event_a,'agenda_item',agenda,NULL,NULL, fq_sc, NULL, ARRAY[NULL]::text[], NULL, NULL);
    RAISE EXCEPTION 'A: ARRAY[NULL] single_choice accepted';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%NULL element%', 'A: ' || SQLERRM; END;

  -- A': single_choice ARRAY['A', NULL] -> rejected
  BEGIN
    PERFORM public.save_evaluation_answer(event_a,'agenda_item',agenda,NULL,NULL, fq_sc, NULL, ARRAY['A', NULL]::text[], NULL, NULL);
    RAISE EXCEPTION 'A2: [valid,NULL] accepted';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%NULL element%', 'A2: ' || SQLERRM; END;

  -- B: single_choice invalid label -> rejected
  BEGIN
    PERFORM public.save_evaluation_answer(event_a,'agenda_item',agenda,NULL,NULL, fq_sc, NULL, ARRAY['not-a-choice'], NULL, NULL);
    RAISE EXCEPTION 'B: invalid label accepted';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%unknown choice%', 'B: ' || SQLERRM; END;

  -- B': single_choice two labels -> rejected
  BEGIN
    PERFORM public.save_evaluation_answer(event_a,'agenda_item',agenda,NULL,NULL, fq_sc, NULL, ARRAY['A','B'], NULL, NULL);
    RAISE EXCEPTION 'B2: two labels accepted';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%at most one selection%', 'B2: ' || SQLERRM; END;

  -- C: multi_select ARRAY['Talks', NULL] -> rejected
  BEGIN
    PERFORM public.save_evaluation_answer(event_a,'agenda_item',agenda,NULL,NULL, fq_ms, NULL, ARRAY['Talks', NULL]::text[], NULL, NULL);
    RAISE EXCEPTION 'C: [valid,NULL] multi accepted';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%NULL element%', 'C: ' || SQLERRM; END;

  -- D: multi_select duplicate labels -> rejected
  BEGIN
    PERFORM public.save_evaluation_answer(event_a,'agenda_item',agenda,NULL,NULL, fq_ms, NULL, ARRAY['Talks','Talks'], NULL, NULL);
    RAISE EXCEPTION 'D: duplicate labels accepted';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%duplicate values%', 'D: ' || SQLERRM; END;

  -- D': multi_select invalid label among valid -> rejected
  BEGIN
    PERFORM public.save_evaluation_answer(event_a,'agenda_item',agenda,NULL,NULL, fq_ms, NULL, ARRAY['Talks','not-a-choice'], NULL, NULL);
    RAISE EXCEPTION 'D3: mixed valid/invalid accepted';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%unknown choice%', 'D3: ' || SQLERRM; END;

  -- F: yes_no ARRAY[NULL] -> rejected
  BEGIN
    PERFORM public.save_evaluation_answer(event_a,'agenda_item',agenda,NULL,NULL, fq_yn, NULL, ARRAY[NULL]::text[], NULL, NULL);
    RAISE EXCEPTION 'F: yes_no ARRAY[NULL] accepted';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%NULL element%', 'F: ' || SQLERRM; END;

  -- F': yes_no bad value / two values -> rejected
  BEGIN
    PERFORM public.save_evaluation_answer(event_a,'agenda_item',agenda,NULL,NULL, fq_yn, NULL, ARRAY['Maybe'], NULL, NULL);
    RAISE EXCEPTION 'F2: yes_no Maybe accepted';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%only Yes or No%', 'F2: ' || SQLERRM; END;
  BEGIN
    PERFORM public.save_evaluation_answer(event_a,'agenda_item',agenda,NULL,NULL, fq_yn, NULL, ARRAY['Yes','No'], NULL, NULL);
    RAISE EXCEPTION 'F3: yes_no two values accepted';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%at most one selection%', 'F3: ' || SQLERRM; END;

  -- E: valid distinct multi-select + valid single + valid yes_no -> succeed
  PERFORM public.save_evaluation_answer(event_a,'agenda_item',agenda,NULL,NULL, fq_sc, NULL, ARRAY['A'], NULL, NULL);
  PERFORM public.save_evaluation_answer(event_a,'agenda_item',agenda,NULL,NULL, fq_ms, NULL, ARRAY['Talks','Food'], NULL, NULL);
  PERFORM public.save_evaluation_answer(event_a,'agenda_item',agenda,NULL,NULL, fq_yn, NULL, ARRAY['Yes'], NULL, NULL);
  r := public.submit_evaluation(event_a,'agenda_item',agenda,NULL,NULL);
  ASSERT (r->>'ok')::boolean, 'E: valid answers submit fine';

  -- G: the rejected attempts persisted nothing; only the 3 valid answers exist,
  --    and the response is legitimately complete.
  ASSERT (SELECT count(*) FROM public.evaluation_response_answers era
          JOIN public.evaluation_responses er ON er.id = era.response_id
          WHERE er.target_type='agenda_item' AND er.target_id = agenda) = 3,
    'G: exactly the 3 valid answers were persisted';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.evaluation_response_answers era
    JOIN public.evaluation_responses er ON er.id = era.response_id
    CROSS JOIN LATERAL unnest(era.selected_labels) AS u(l)
    WHERE er.target_type='agenda_item' AND er.target_id = agenda AND u.l IS NULL),
    'G: no NULL label persisted';
  ASSERT (SELECT is_complete FROM public.evaluation_responses
          WHERE target_type='agenda_item' AND target_id = agenda),
    'G: valid submission is complete; malformed attempts never made it so';

  -- H: report choice counts are exactly the one valid submission, undistorted.
  PERFORM set_config('request.jwt.claim.sub', admin, false);
  r := public.get_evaluation_report(event_a, 'agenda_item', agenda);
  ASSERT (r->>'completed')::int = 1, 'H: exactly one completed agenda response';
  FOR q IN SELECT value FROM jsonb_array_elements(r->'questions') value LOOP
    IF q->>'question_type' = 'multi_select' THEN
      ASSERT q->'choice_breakdown' @> '[{"label":"Talks","count":1}]'::jsonb
         AND q->'choice_breakdown' @> '[{"label":"Food","count":1}]'::jsonb
         AND NOT (q->'choice_breakdown' @> '[{"label":"Talks","count":2}]'::jsonb),
        'H: multi counts undistorted by rejected duplicates: ' || (q->'choice_breakdown')::text;
    ELSIF q->>'question_type' = 'single_choice' THEN
      ASSERT q->'choice_breakdown' = '[{"label": "A", "count": 1}]'::jsonb, 'H: single_choice count clean';
    ELSIF q->>'question_type' = 'yes_no' THEN
      ASSERT q->'choice_breakdown' = '[{"label": "Yes", "count": 1}]'::jsonb, 'H: yes_no count clean';
    END IF;
  END LOOP;

  RAISE NOTICE 'ALL EVALUATION BEHAVIOUR ASSERTIONS PASSED';
END
$test$;

ROLLBACK;
