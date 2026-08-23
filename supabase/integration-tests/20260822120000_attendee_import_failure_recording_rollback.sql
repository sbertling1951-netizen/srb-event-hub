-- Stage 3.1 linked integration fixture. Every object and row is rolled back.
BEGIN;

CREATE OR REPLACE FUNCTION public.record_attendee_import_run_row_commit_failure(p_import_run_row_id uuid,p_failure_code text)
RETURNS public.import_run_rows LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_row public.import_run_rows%ROWTYPE; v_run public.import_runs%ROWTYPE; v_message text;
BEGIN
 IF auth.uid() IS NULL OR p_import_run_row_id IS NULL OR p_failure_code IS NULL THEN RAISE EXCEPTION 'missing_input' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_row FROM public.import_run_rows WHERE id=p_import_run_row_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'import_row_not_found' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_run FROM public.import_runs WHERE id=v_row.import_run_id FOR UPDATE;
 IF v_run.import_type <> 'attendee_roster' THEN RAISE EXCEPTION 'import_row_not_attendee_roster' USING ERRCODE='22023'; END IF;
 IF NOT public.has_event_task_authority('event.imports.manage',v_row.event_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
 IF v_run.status NOT IN ('staging','ready_for_review') THEN RAISE EXCEPTION 'import_run_not_committable' USING ERRCODE='22023'; END IF;
 PERFORM public.assert_event_lifecycle_mutable(v_row.event_id);
 v_message:=CASE p_failure_code WHEN 'canonical_commit_failed' THEN 'The attendee commit did not complete. Retry after correcting the underlying issue.' WHEN 'canonical_commit_denied' THEN 'The attendee commit was denied by a governed authority or lifecycle check.' WHEN 'canonical_commit_conflict' THEN 'The attendee commit encountered a governed data conflict.' WHEN 'canonical_commit_unavailable' THEN 'The attendee commit could not be completed. Retry later.' ELSE NULL END;
 IF v_message IS NULL THEN RAISE EXCEPTION 'invalid_failure_code' USING ERRCODE='22023'; END IF;
 IF v_row.row_state='commit_failed' THEN IF v_row.commit_error->>'code'=p_failure_code THEN RETURN v_row; END IF; RAISE EXCEPTION 'commit_failure_already_recorded' USING ERRCODE='22023'; END IF;
 IF v_row.row_state <> 'approved' THEN RAISE EXCEPTION 'import_row_not_approved' USING ERRCODE='22023'; END IF;
 UPDATE public.import_run_rows SET row_state='commit_failed',commit_state='failed',commit_error=jsonb_build_object('code',p_failure_code,'message',v_message),updated_at=now() WHERE id=v_row.id RETURNING * INTO v_row;
 RETURN v_row;
END; $$;
ALTER FUNCTION public.record_attendee_import_run_row_commit_failure(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_attendee_import_run_row_commit_failure(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_attendee_import_run_row_commit_failure(uuid,text) TO authenticated;

CREATE FUNCTION public.stage31_fixture_assert(p_ok boolean,p_message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'stage31_fixture_assertion_failed: %',p_message; END IF; END $$;
CREATE FUNCTION public.stage31_fixture_fail_attendee() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('stage31.fixture_fail',true)='true' THEN RAISE EXCEPTION 'stage31_forced_stage3_failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER stage31_fixture_fail_attendee BEFORE INSERT OR UPDATE ON public.attendees FOR EACH ROW EXECUTE FUNCTION public.stage31_fixture_fail_attendee();

DO $$
DECLARE
 t uuid:=gen_random_uuid(); ea uuid:=gen_random_uuid(); eb uuid:=gen_random_uuid(); v_both uuid:=gen_random_uuid(); v_imports uuid:=gen_random_uuid();
 ra uuid:=gen_random_uuid(); rb uuid:=gen_random_uuid(); rf uuid:=gen_random_uuid(); r_retry uuid:=gen_random_uuid(); r_denied uuid:=gen_random_uuid(); r_cross uuid:=gen_random_uuid(); r_invalid uuid:=gen_random_uuid(); r_review uuid:=gen_random_uuid(); r_committed uuid:=gen_random_uuid(); r_final uuid:=gen_random_uuid(); v_count integer; v_out text;
 c jsonb:=jsonb_build_object('registration',jsonb_build_object('entry_id','S31-RETRY','email','retry.fixture@example.invalid','pilot_first','Retry','pilot_last','Fixture','nickname','','membership_number','','primary_phone','','cell_phone','','city','','state','','wants_to_volunteer',false,'is_first_timer',false,'share_with_attendees',false,'special_events_raw','','coach_manufacturer','','coach_model',''),'copilot',jsonb_build_object('first','','last','','nickname','','email','','cell_phone',''),'capacity_evidence',jsonb_build_object('imported_capacity',1,'structured_participant_minimum',1),'activities','[]'::jsonb,'reference_only',jsonb_build_object('additional_attendees','reference only'));
BEGIN
 INSERT INTO public.tenants(id,organization_code,slug,organization_name,display_name,app_title) VALUES(t,'S31-'||left(t::text,8),'s31-'||left(t::text,8),'Stage 3.1 Fixture','Stage 3.1 Fixture','Stage 3.1 Fixture');
 INSERT INTO public.events(id,tenant_id,name,start_date,end_date,timezone,lifecycle_state) VALUES(ea,t,'stage31-fixture-a-'||t::text,current_date,current_date+30,'UTC','operational'),(eb,t,'stage31-fixture-b-'||t::text,current_date,current_date+30,'UTC','operational');
 INSERT INTO auth.users(id,email) VALUES(v_both,'both-'||v_both||'@fixture.invalid'),(v_imports,'imports-'||v_imports||'@fixture.invalid');
 INSERT INTO public.admin_users(user_id,email) VALUES(v_both,'both-'||v_both||'@fixture.invalid'),(v_imports,'imports-'||v_imports||'@fixture.invalid');
 INSERT INTO public.admin_event_access(admin_user_id,event_id,role) SELECT id,ea,'event_admin' FROM public.admin_users WHERE user_id IN(v_both,v_imports);
 INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key) SELECT a.id,p.task FROM public.admin_event_access a JOIN public.admin_users u ON u.id=a.admin_user_id CROSS JOIN(VALUES('event.imports.manage'),('event.attendees.manage')) p(task) WHERE a.event_id=ea AND u.user_id=v_both;
 INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key) SELECT a.id,'event.imports.manage' FROM public.admin_event_access a JOIN public.admin_users u ON u.id=a.admin_user_id WHERE a.event_id=ea AND u.user_id=v_imports;
 INSERT INTO public.import_runs(id,event_id,import_type,created_by_auth_user_id) VALUES(ra,ea,'attendee_roster',v_both),(rb,eb,'attendee_roster',v_both),(rf,ea,'attendee_roster',v_both);
 INSERT INTO public.import_run_rows(id,import_run_id,event_id,source_row_number,source_payload,normalized_candidate,source_fingerprint,validation_state,review_state,row_state) VALUES(r_retry,ra,ea,1,'{}',c,'s31-retry-'||r_retry,'valid','approved','approved'),(r_denied,ra,ea,2,'{}',c||jsonb_build_object('registration',c->'registration'||jsonb_build_object('entry_id','S31-DENIED','email','denied.fixture@example.invalid')),'s31-denied-'||r_denied,'valid','approved','approved'),(r_cross,rb,eb,1,'{}',c||jsonb_build_object('registration',c->'registration'||jsonb_build_object('entry_id','S31-CROSS','email','cross.fixture@example.invalid')),'s31-cross-'||r_cross,'valid','approved','approved'),(r_invalid,ra,ea,3,'{}',c,'s31-invalid-'||r_invalid,'invalid','unreviewed','validation_failed'),(r_review,ra,ea,4,'{}',c,'s31-review-'||r_review,'valid','needs_review','needs_review');
 INSERT INTO public.import_run_rows(id,import_run_id,event_id,source_row_number,source_payload,normalized_candidate,source_fingerprint,validation_state,review_state,row_state,commit_state,committed_at) VALUES(r_committed,ra,ea,5,'{}',c,'s31-committed-'||r_committed,'valid','approved','committed','committed',now());
 INSERT INTO public.import_run_rows(id,import_run_id,event_id,source_row_number,source_payload,normalized_candidate,source_fingerprint,validation_state,review_state,row_state) VALUES(r_final,rf,ea,1,'{}',c,'s31-final-'||r_final,'valid','approved','approved');
 PERFORM set_config('request.jwt.claim.sub',v_both::text,true); PERFORM set_config('stage31.fixture_fail','true',true);
 BEGIN PERFORM public.commit_attendee_import_run_row(r_retry); RAISE EXCEPTION 'Stage 3 did not fail'; EXCEPTION WHEN OTHERS THEN PERFORM public.stage31_fixture_assert(SQLERRM='stage31_forced_stage3_failure','real Stage 3 rollback'); END;
 SELECT count(*) INTO v_count FROM public.attendees WHERE event_id=ea; PERFORM public.stage31_fixture_assert(v_count=0,'failed Stage 3 made no canonical attendee');
 PERFORM set_config('stage31.fixture_fail','',true); PERFORM public.record_attendee_import_run_row_commit_failure(r_retry,'canonical_commit_failed');
 PERFORM public.stage31_fixture_assert((SELECT row_state='commit_failed' AND commit_state='failed' AND commit_error->>'code'='canonical_commit_failed' FROM public.import_run_rows WHERE id=r_retry),'authorized failure recorded');
 SELECT count(*) INTO v_count FROM public.attendees WHERE event_id=ea; PERFORM public.record_attendee_import_run_row_commit_failure(r_retry,'canonical_commit_failed'); PERFORM public.stage31_fixture_assert((SELECT count(*)=v_count FROM public.attendees WHERE event_id=ea),'idempotent replay has no canonical mutation');
 BEGIN PERFORM public.record_attendee_import_run_row_commit_failure(r_retry,'canonical_commit_conflict'); RAISE EXCEPTION 'different replay allowed'; EXCEPTION WHEN OTHERS THEN PERFORM public.stage31_fixture_assert(SQLERRM='commit_failure_already_recorded','different replay denied'); END;
 PERFORM set_config('request.jwt.claim.sub',v_imports::text,true); BEGIN PERFORM public.record_attendee_import_run_row_commit_failure(r_denied,'canonical_commit_failed'); RAISE EXCEPTION 'Imports authority should be enough'; EXCEPTION WHEN OTHERS THEN PERFORM public.stage31_fixture_assert(SQLERRM<>'not_authorized','Imports-only allowed'); END;
 PERFORM set_config('request.jwt.claim.sub',v_both::text,true); BEGIN PERFORM public.record_attendee_import_run_row_commit_failure(r_cross,'canonical_commit_failed'); RAISE EXCEPTION 'cross-event allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','',true); BEGIN PERFORM public.record_attendee_import_run_row_commit_failure(r_denied,'canonical_commit_failed'); RAISE EXCEPTION 'anon allowed'; EXCEPTION WHEN OTHERS THEN PERFORM public.stage31_fixture_assert(SQLERRM='missing_input','anon denied'); END;
 PERFORM set_config('request.jwt.claim.sub',v_both::text,true); FOREACH r_retry IN ARRAY ARRAY[r_invalid,r_review,r_committed] LOOP BEGIN PERFORM public.record_attendee_import_run_row_commit_failure(r_retry,'canonical_commit_failed'); RAISE EXCEPTION 'invalid state allowed'; EXCEPTION WHEN OTHERS THEN PERFORM public.stage31_fixture_assert(SQLERRM='import_row_not_approved','nonapproved denied'); END; END LOOP;
 UPDATE public.import_runs SET status='finalized',finalized_at=now() WHERE id=rf; BEGIN PERFORM public.record_attendee_import_run_row_commit_failure(r_final,'canonical_commit_failed'); RAISE EXCEPTION 'finalized allowed'; EXCEPTION WHEN OTHERS THEN PERFORM public.stage31_fixture_assert(SQLERRM='import_run_not_committable','finalized denied'); END;
 SELECT outcome INTO v_out FROM public.commit_attendee_import_run_row((SELECT id FROM public.import_run_rows WHERE source_fingerprint LIKE 's31-retry-%')); PERFORM public.stage31_fixture_assert(v_out='committed' AND (SELECT row_state='committed' AND commit_error IS NULL FROM public.import_run_rows WHERE source_fingerprint LIKE 's31-retry-%'),'Stage 3 retry succeeds and clears failure');
END $$;

ROLLBACK;
SELECT 'stage3.1 fixture PASS: outer rollback completed' AS result;
