-- Stage 3 linked-database integration fixture.  It installs the pending RPC
-- only inside this outer transaction and always rolls everything back.
-- PARITY: the RPC block below is byte-for-byte copied from the pending migration
-- (the structural test compares the normalized blocks before this fixture runs).
BEGIN;

CREATE OR REPLACE FUNCTION public.commit_attendee_import_run_row(p_import_run_row_id uuid)
RETURNS TABLE(outcome text, attendee_id uuid, import_run_row_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE r public.import_run_rows%ROWTYPE; run public.import_runs%ROWTYPE; c jsonb; a public.attendees%ROWTYPE;
  v_entry text; v_email text; v_email_id uuid; v_entry_id uuid; v_capacity integer; v_min integer; v_activity jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_row_id IS NULL THEN RAISE EXCEPTION 'missing_input' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM public.import_run_rows WHERE id=p_import_run_row_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_row_not_found' USING ERRCODE='22023'; END IF;
  SELECT * INTO run FROM public.import_runs WHERE id=r.import_run_id FOR UPDATE;
  IF run.import_type <> 'attendee_roster' OR r.row_state NOT IN ('approved','committed','commit_failed') THEN RAISE EXCEPTION 'import_row_not_approved' USING ERRCODE='22023'; END IF;
  IF NOT public.has_event_task_authority('event.imports.manage',r.event_id) OR NOT public.has_event_task_authority('event.attendees.manage',r.event_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF r.row_state='committed' THEN RETURN QUERY SELECT 'already_committed',r.canonical_target_id,r.id; RETURN; END IF;
  IF run.status NOT IN ('staging','ready_for_review') THEN RAISE EXCEPTION 'import_run_not_committable' USING ERRCODE='22023'; END IF;
  PERFORM public.assert_event_lifecycle_mutable(r.event_id);
  c:=r.normalized_candidate; v_entry:=nullif(btrim(c#>>'{registration,entry_id}'),''); v_email:=nullif(lower(btrim(c#>>'{registration,email}')),'');
  IF v_entry IS NULL OR v_email IS NULL THEN RAISE EXCEPTION 'staged_candidate_missing_identity' USING ERRCODE='22023'; END IF;
  SELECT id INTO v_entry_id FROM public.attendees WHERE event_id=r.event_id AND entry_id=v_entry FOR UPDATE;
  SELECT id INTO v_email_id FROM public.attendees WHERE event_id=r.event_id AND lower(email)=v_email FOR UPDATE;
  IF v_entry_id IS NOT NULL AND v_email_id IS NOT NULL AND v_entry_id<>v_email_id THEN
    UPDATE public.import_run_rows SET commit_error=jsonb_build_object('code','registration_identity_ambiguous'),updated_at=now() WHERE id=r.id;
    RETURN QUERY SELECT 'needs_review',NULL::uuid,r.id; RETURN;
  END IF;
  SELECT * INTO a FROM public.attendees WHERE id=coalesce(v_entry_id,v_email_id);
  v_min:=greatest(coalesce((c#>>'{capacity_evidence,structured_participant_minimum}')::integer,0),1);
  v_capacity:=greatest(coalesce((c#>>'{capacity_evidence,imported_capacity}')::integer,0),v_min);
  IF a.id IS NULL THEN
    INSERT INTO public.attendees(event_id,entry_id,email,pilot_first,pilot_last,nickname,copilot_first,copilot_last,copilot_nickname,copilot_email,copilot_cell_phone,membership_number,primary_phone,cell_phone,city,state,wants_to_volunteer,is_first_timer,share_with_attendees,special_events_raw,coach_manufacturer,coach_model,participant_type,participant_capacity,source_type)
    VALUES(r.event_id,v_entry,v_email,nullif(c#>>'{registration,pilot_first}',''),nullif(c#>>'{registration,pilot_last}',''),nullif(c#>>'{registration,nickname}',''),nullif(c#>>'{copilot,first}',''),nullif(c#>>'{copilot,last}',''),nullif(c#>>'{copilot,nickname}',''),nullif(c#>>'{copilot,email}',''),nullif(c#>>'{copilot,cell_phone}',''),nullif(c#>>'{registration,membership_number}',''),nullif(c#>>'{registration,primary_phone}',''),nullif(c#>>'{registration,cell_phone}',''),nullif(c#>>'{registration,city}',''),nullif(c#>>'{registration,state}',''),coalesce((c#>>'{registration,wants_to_volunteer}')::boolean,false),coalesce((c#>>'{registration,is_first_timer}')::boolean,false),coalesce((c#>>'{registration,share_with_attendees}')::boolean,false),nullif(c#>>'{registration,special_events_raw}',''),nullif(c#>>'{registration,coach_manufacturer}',''),nullif(c#>>'{registration,coach_model}',''),'attendee',v_capacity,'imported') RETURNING * INTO a;
  ELSE
    UPDATE public.attendees SET pilot_first=coalesce(nullif(c#>>'{registration,pilot_first}',''),pilot_first),pilot_last=coalesce(nullif(c#>>'{registration,pilot_last}',''),pilot_last),nickname=coalesce(nullif(c#>>'{registration,nickname}',''),nickname),copilot_first=coalesce(nullif(c#>>'{copilot,first}',''),copilot_first),copilot_last=coalesce(nullif(c#>>'{copilot,last}',''),copilot_last),copilot_nickname=coalesce(nullif(c#>>'{copilot,nickname}',''),copilot_nickname),copilot_email=coalesce(nullif(c#>>'{copilot,email}',''),copilot_email),copilot_cell_phone=coalesce(nullif(c#>>'{copilot,cell_phone}',''),copilot_cell_phone),membership_number=coalesce(nullif(c#>>'{registration,membership_number}',''),membership_number),primary_phone=coalesce(nullif(c#>>'{registration,primary_phone}',''),primary_phone),cell_phone=coalesce(nullif(c#>>'{registration,cell_phone}',''),cell_phone),city=coalesce(nullif(c#>>'{registration,city}',''),city),state=coalesce(nullif(c#>>'{registration,state}',''),state),special_events_raw=coalesce(nullif(c#>>'{registration,special_events_raw}',''),special_events_raw) WHERE id=a.id RETURNING * INTO a;
    IF v_capacity>coalesce(a.participant_capacity,0) THEN PERFORM public.record_participant_capacity_increase(a.id,v_capacity,'Governed attendee import run row '||r.id::text,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL); SELECT * INTO a FROM public.attendees WHERE id=a.id; END IF;
  END IF;
  PERFORM public.manage_attendee_household_member(a.id,'pilot',false,a.pilot_first,a.pilot_last,a.nickname,a.email,NULL);
  DELETE FROM public.attendee_activities WHERE event_id=r.event_id AND entry_id=a.entry_id;
  FOR v_activity IN SELECT value FROM jsonb_array_elements(coalesce(c->'activities','[]'::jsonb)) LOOP
    INSERT INTO public.attendee_activities(event_id,entry_id,attendee_email,activity_name,quantity,price,raw_name,source_column_prefix) VALUES(r.event_id,a.entry_id,a.email,v_activity->>'activity_name',(v_activity->>'quantity')::integer,nullif(v_activity->>'price','')::numeric,v_activity->>'raw_name',v_activity->>'source_column_prefix');
  END LOOP;
  UPDATE public.import_run_rows SET row_state='committed',commit_state='committed',canonical_target_id=a.id,commit_result=jsonb_build_object('attendee_id',a.id,'source_row_fingerprint',r.source_fingerprint),commit_error=NULL,committed_at=now(),updated_at=now() WHERE id=r.id;
  RETURN QUERY SELECT 'committed',a.id,r.id;
END; $$;
ALTER FUNCTION public.commit_attendee_import_run_row(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commit_attendee_import_run_row(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.commit_attendee_import_run_row(uuid) TO authenticated;

CREATE FUNCTION public.stage3_fixture_assert(p_ok boolean,p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'stage3_fixture_assertion_failed: %',p_message; END IF; END $$;
CREATE FUNCTION public.stage3_fixture_candidate(p_entry text,p_email text,p_capacity integer,p_activities jsonb DEFAULT '[]'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('registration',jsonb_build_object('entry_id',p_entry,'email',p_email,'pilot_first','Pilot','pilot_last','Fixture','nickname','PF','membership_number','M-FIXTURE','wants_to_volunteer',false,'is_first_timer',false,'share_with_attendees',false),'copilot',jsonb_build_object('first','Co','last','Pilot','nickname','CP','email','copilot.fixture@example.invalid','cell_phone','555-0100'),'capacity_evidence',jsonb_build_object('structured_participant_minimum',2,'imported_capacity',p_capacity),'activities',p_activities,'additional_attendees_reference_text','Additional Person; reference only'); $$;
CREATE FUNCTION public.stage3_fixture_force_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('stage3.fixture_failure',true)=TG_TABLE_NAME THEN RAISE EXCEPTION 'stage3_fixture_forced_%',TG_TABLE_NAME; END IF; RETURN NEW; END $$;
CREATE FUNCTION public.stage3_fixture_expect_failure(p_row uuid,p_user uuid,p_table text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('request.jwt.claim.sub',p_user::text,true); PERFORM set_config('stage3.fixture_failure',p_table,true);
 BEGIN PERFORM public.commit_attendee_import_run_row(p_row); RAISE EXCEPTION 'fixture did not force %',p_table;
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'stage3_fixture_forced_'||p_table||'%' THEN RAISE; END IF; END;
 PERFORM set_config('stage3.fixture_failure','',true);
END $$;

DO $$
DECLARE
 t uuid:=gen_random_uuid(); ea uuid:=gen_random_uuid(); eb uuid:=gen_random_uuid(); v_both uuid:=gen_random_uuid(); imports_only uuid:=gen_random_uuid(); attendees_only uuid:=gen_random_uuid(); neither uuid:=gen_random_uuid();
 runa uuid:=gen_random_uuid(); runb uuid:=gen_random_uuid(); rf uuid:=gen_random_uuid(); r_success uuid:=gen_random_uuid(); r_denied uuid:=gen_random_uuid(); r_b uuid:=gen_random_uuid(); r_final uuid:=gen_random_uuid(); r_amb uuid:=gen_random_uuid(); r_existing uuid:=gen_random_uuid(); r_increase uuid:=gen_random_uuid(); r_retry_failed uuid:=gen_random_uuid(); r_fail_attendee uuid:=gen_random_uuid(); r_fail_household uuid:=gen_random_uuid(); r_fail_capacity uuid:=gen_random_uuid(); r_fail_activity uuid:=gen_random_uuid(); r_fail_stage uuid:=gen_random_uuid();
 aid uuid; out text; before_count integer; candidate jsonb:=public.stage3_fixture_candidate('S3-SUCCESS','success.fixture@example.invalid',3,jsonb_build_array(jsonb_build_object('activity_name','Welcome','quantity',1,'price','12.50','raw_name','Welcome','source_column_prefix','Activity')));
BEGIN
 INSERT INTO public.tenants(id,organization_code,slug,organization_name,display_name,app_title) VALUES(t,'S3FIX-'||left(t::text,8),'s3fix-'||left(t::text,8),'Stage 3 Fixture','Stage 3 Fixture','Stage 3 Fixture');
 INSERT INTO public.events(id,tenant_id,name,start_date,end_date,timezone,lifecycle_state) VALUES(ea,t,'stage3-fixture-a-'||t::text,current_date,current_date+30,'UTC','operational'),(eb,t,'stage3-fixture-b-'||t::text,current_date,current_date+30,'UTC','operational');
 INSERT INTO auth.users(id,email) VALUES(v_both,'both-'||v_both||'@fixture.invalid'),(imports_only,'imports-'||imports_only||'@fixture.invalid'),(attendees_only,'attendees-'||attendees_only||'@fixture.invalid'),(neither,'neither-'||neither||'@fixture.invalid');
 INSERT INTO public.admin_users(user_id,email,display_name) VALUES(v_both,'both-'||v_both||'@fixture.invalid','both'),(imports_only,'imports-'||imports_only||'@fixture.invalid','imports'),(attendees_only,'attendees-'||attendees_only||'@fixture.invalid','attendees'),(neither,'neither-'||neither||'@fixture.invalid','neither');
 INSERT INTO public.admin_event_access(admin_user_id,event_id,role) SELECT id,ea,'event_admin' FROM public.admin_users WHERE user_id IN (v_both,imports_only,attendees_only,neither);
 INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key) SELECT a.id,p.task FROM public.admin_event_access a CROSS JOIN (VALUES ('event.imports.manage'),('event.attendees.manage')) p(task) JOIN public.admin_users u ON u.id=a.admin_user_id WHERE a.event_id=ea AND u.user_id=v_both;
 INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key) SELECT a.id,'event.imports.manage' FROM public.admin_event_access a JOIN public.admin_users u ON u.id=a.admin_user_id WHERE a.event_id=ea AND u.user_id=imports_only;
 INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key) SELECT a.id,'event.attendees.manage' FROM public.admin_event_access a JOIN public.admin_users u ON u.id=a.admin_user_id WHERE a.event_id=ea AND u.user_id=attendees_only;
 INSERT INTO public.import_runs(id,event_id,import_type,created_by_auth_user_id) VALUES(runa,ea,'attendee_roster',v_both),(runb,eb,'attendee_roster',v_both),(rf,ea,'attendee_roster',v_both);
 INSERT INTO public.import_run_rows(id,import_run_id,event_id,source_row_number,source_payload,normalized_candidate,source_fingerprint,validation_state,review_state,row_state) VALUES
 (r_success,runa,ea,1,'{}',candidate,'s3-success-'||r_success,'valid','approved','approved'),(r_denied,runa,ea,2,'{}',public.stage3_fixture_candidate('S3-DENIED','denied.fixture@example.invalid',2),'s3-denied-'||r_denied,'valid','approved','approved'),(r_b,runb,eb,1,'{}',public.stage3_fixture_candidate('S3-B','b.fixture@example.invalid',2),'s3-b-'||r_b,'valid','approved','approved'),(r_final,rf,ea,1,'{}',public.stage3_fixture_candidate('S3-FINAL','final.fixture@example.invalid',2),'s3-final-'||r_final,'valid','approved','approved'),(r_amb,runa,ea,3,'{}',public.stage3_fixture_candidate('S3-AMB-A','amb-b@example.invalid',2),'s3-amb-'||r_amb,'valid','approved','approved');
 INSERT INTO public.attendees(event_id,entry_id,email,pilot_first,pilot_last,participant_capacity) VALUES(ea,'S3-AMB-A','amb-a@example.invalid','A','One',1),(ea,'S3-AMB-B','amb-b@example.invalid','B','Two',1),(ea,'S3-EXIST','existing.fixture@example.invalid','Existing','One',3),(ea,'S3-INCREASE','increase.fixture@example.invalid','Increase','One',1),(ea,'S3-ACTIVITY','activity.fixture@example.invalid','Activity','One',2);
 INSERT INTO public.attendee_activities(event_id,entry_id,activity_name,quantity,source_column_prefix) VALUES(ea,'S3-ACTIVITY','Old activity',1,'Activity');
 INSERT INTO public.import_run_rows(id,import_run_id,event_id,source_row_number,source_payload,normalized_candidate,source_fingerprint,validation_state,review_state,row_state) VALUES
 (r_existing,runa,ea,4,'{}',public.stage3_fixture_candidate('S3-EXIST','existing.fixture@example.invalid',1),'s3-existing-'||r_existing,'valid','approved','approved'),(r_increase,runa,ea,5,'{}',public.stage3_fixture_candidate('S3-INCREASE','increase.fixture@example.invalid',3),'s3-increase-'||r_increase,'valid','approved','approved');
 INSERT INTO public.import_run_rows(id,import_run_id,event_id,source_row_number,source_payload,normalized_candidate,source_fingerprint,validation_state,review_state,row_state,commit_state,commit_error) VALUES(r_retry_failed,runa,ea,6,'{}',public.stage3_fixture_candidate('S3-ACTIVITY','activity.fixture@example.invalid',2,jsonb_build_array(jsonb_build_object('activity_name','Replacement','quantity',2,'price','5.00','raw_name','Replacement','source_column_prefix','Activity'))),'s3-retry-'||r_retry_failed,'valid','approved','commit_failed','failed',jsonb_build_object('code','prior_failure'));
 PERFORM set_config('request.jwt.claim.sub',v_both::text,true);
 SELECT outcome,attendee_id INTO out,aid FROM public.commit_attendee_import_run_row(r_success); PERFORM public.stage3_fixture_assert(out='committed','authorized success');
 PERFORM public.stage3_fixture_assert((SELECT copilot_email='copilot.fixture@example.invalid' AND participant_capacity=3 FROM public.attendees WHERE id=aid),'attendee/copilot/capacity persisted');
 PERFORM public.stage3_fixture_assert((SELECT count(*)=0 FROM public.attendee_household_members WHERE attendee_id=aid AND person_role='copilot'),'Policy 1: no copilot household row');
 PERFORM public.stage3_fixture_assert((SELECT count(*)=1 FROM public.attendee_household_members WHERE attendee_id=aid AND person_role='pilot'),'pilot household evidence');
 PERFORM public.stage3_fixture_assert((SELECT count(*)=1 FROM public.attendee_activities WHERE event_id=ea AND entry_id='S3-SUCCESS'),'activities persisted');
 PERFORM public.stage3_fixture_assert((SELECT row_state='committed' AND canonical_target_id=aid FROM public.import_run_rows WHERE id=r_success),'staging result persisted');
 SELECT count(*) INTO before_count FROM public.attendees WHERE event_id=ea AND entry_id='S3-DENIED';
 FOREACH aid IN ARRAY ARRAY[imports_only,attendees_only,neither] LOOP PERFORM set_config('request.jwt.claim.sub',aid::text,true); BEGIN PERFORM public.commit_attendee_import_run_row(r_denied); RAISE EXCEPTION 'authority denial missing'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END LOOP;
 PERFORM set_config('request.jwt.claim.sub',v_both::text,true); BEGIN PERFORM public.commit_attendee_import_run_row(r_b); RAISE EXCEPTION 'cross event denial missing'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','',true); BEGIN PERFORM public.commit_attendee_import_run_row(r_denied); RAISE EXCEPTION 'anon denial missing'; EXCEPTION WHEN OTHERS THEN PERFORM public.stage3_fixture_assert(SQLERRM='missing_input','anon denied'); END;
 PERFORM public.stage3_fixture_assert((SELECT count(*)=before_count FROM public.attendees WHERE event_id=ea AND entry_id='S3-DENIED'),'denials mutate nothing');
 PERFORM set_config('request.jwt.claim.sub',v_both::text,true); UPDATE public.import_runs SET status='finalized',finalized_at=now() WHERE id=rf;
 BEGIN PERFORM public.commit_attendee_import_run_row(r_final); RAISE EXCEPTION 'finalized denial missing'; EXCEPTION WHEN OTHERS THEN PERFORM public.stage3_fixture_assert(SQLERRM='import_run_not_committable','finalized uncommitted denied'); END;
 SELECT outcome INTO out FROM public.commit_attendee_import_run_row(r_success); PERFORM public.stage3_fixture_assert(out='already_committed','exact retry stable');
 SELECT outcome INTO out FROM public.commit_attendee_import_run_row(r_amb); PERFORM public.stage3_fixture_assert(out='needs_review','identity ambiguity'); PERFORM public.stage3_fixture_assert((SELECT row_state='approved' AND canonical_target_id IS NULL FROM public.import_run_rows WHERE id=r_amb),'ambiguity no guessed target');
 SELECT outcome INTO out FROM public.commit_attendee_import_run_row(r_existing); PERFORM public.stage3_fixture_assert(out='committed' AND (SELECT participant_capacity=3 FROM public.attendees WHERE event_id=ea AND entry_id='S3-EXIST'),'lower capacity preserved');
 SELECT outcome INTO out FROM public.commit_attendee_import_run_row(r_increase); PERFORM public.stage3_fixture_assert(out='committed' AND (SELECT participant_capacity=3 FROM public.attendees WHERE event_id=ea AND entry_id='S3-INCREASE'),'governed increase'); PERFORM public.stage3_fixture_assert((SELECT count(*)=1 FROM public.participant_capacity_adjustments p JOIN public.attendees a ON a.id=p.attendee_id WHERE a.event_id=ea AND a.entry_id='S3-INCREASE'),'one capacity audit');
 SELECT outcome INTO out FROM public.commit_attendee_import_run_row(r_increase); PERFORM public.stage3_fixture_assert(out='already_committed' AND (SELECT count(*)=1 FROM public.participant_capacity_adjustments p JOIN public.attendees a ON a.id=p.attendee_id WHERE a.event_id=ea AND a.entry_id='S3-INCREASE'),'retry does not duplicate audit');
 SELECT outcome INTO out FROM public.commit_attendee_import_run_row(r_retry_failed); PERFORM public.stage3_fixture_assert(out='committed' AND (SELECT count(*)=1 FROM public.attendee_activities WHERE event_id=ea AND entry_id='S3-ACTIVITY' AND activity_name='Replacement'),'commit_failed retry and activity replacement');
 CREATE TRIGGER stage3_fixture_fail_attendee BEFORE INSERT OR UPDATE ON public.attendees FOR EACH ROW EXECUTE FUNCTION public.stage3_fixture_force_failure(); CREATE TRIGGER stage3_fixture_fail_household BEFORE INSERT OR UPDATE ON public.attendee_household_members FOR EACH ROW EXECUTE FUNCTION public.stage3_fixture_force_failure(); CREATE TRIGGER stage3_fixture_fail_capacity BEFORE INSERT ON public.participant_capacity_adjustments FOR EACH ROW EXECUTE FUNCTION public.stage3_fixture_force_failure(); CREATE TRIGGER stage3_fixture_fail_activity BEFORE INSERT OR UPDATE ON public.attendee_activities FOR EACH ROW EXECUTE FUNCTION public.stage3_fixture_force_failure(); CREATE TRIGGER stage3_fixture_fail_stage BEFORE UPDATE ON public.import_run_rows FOR EACH ROW EXECUTE FUNCTION public.stage3_fixture_force_failure();
 INSERT INTO public.import_run_rows(id,import_run_id,event_id,source_row_number,source_payload,normalized_candidate,source_fingerprint,validation_state,review_state,row_state) VALUES
 (r_fail_attendee,runa,ea,7,'{}',public.stage3_fixture_candidate('S3-FAIL-A','fail-a@example.invalid',2),'s3-fail-a-'||r_fail_attendee,'valid','approved','approved'),(r_fail_household,runa,ea,8,'{}',public.stage3_fixture_candidate('S3-FAIL-H','fail-h@example.invalid',2),'s3-fail-h-'||r_fail_household,'valid','approved','approved'),(r_fail_capacity,runa,ea,9,'{}',public.stage3_fixture_candidate('S3-FAIL-C','fail-c@example.invalid',3),'s3-fail-c-'||r_fail_capacity,'valid','approved','approved'),(r_fail_activity,runa,ea,10,'{}',public.stage3_fixture_candidate('S3-ACTIVITY','activity.fixture@example.invalid',2,jsonb_build_array(jsonb_build_object('activity_name','Bad replacement','quantity',1,'price','1','raw_name','Bad','source_column_prefix','Activity'))),'s3-fail-act-'||r_fail_activity,'valid','approved','approved'),(r_fail_stage,runa,ea,11,'{}',public.stage3_fixture_candidate('S3-FAIL-S','fail-s@example.invalid',2),'s3-fail-s-'||r_fail_stage,'valid','approved','approved');
 PERFORM public.stage3_fixture_expect_failure(r_fail_attendee,v_both,'attendees'); PERFORM public.stage3_fixture_assert(NOT EXISTS(SELECT 1 FROM public.attendees WHERE event_id=ea AND entry_id='S3-FAIL-A'),'attendee rollback');
 PERFORM public.stage3_fixture_expect_failure(r_fail_household,v_both,'attendee_household_members'); PERFORM public.stage3_fixture_assert(NOT EXISTS(SELECT 1 FROM public.attendees WHERE event_id=ea AND entry_id='S3-FAIL-H'),'household rollback');
 INSERT INTO public.attendees(event_id,entry_id,email,pilot_first,pilot_last,participant_capacity) VALUES(ea,'S3-FAIL-C','fail-c@example.invalid','Capacity','Failure',1); PERFORM public.stage3_fixture_expect_failure(r_fail_capacity,v_both,'participant_capacity_adjustments'); PERFORM public.stage3_fixture_assert((SELECT participant_capacity=1 FROM public.attendees WHERE event_id=ea AND entry_id='S3-FAIL-C') AND NOT EXISTS(SELECT 1 FROM public.participant_capacity_adjustments p JOIN public.attendees a ON a.id=p.attendee_id WHERE a.entry_id='S3-FAIL-C'),'capacity/audit rollback');
 PERFORM public.stage3_fixture_expect_failure(r_fail_activity,v_both,'attendee_activities'); PERFORM public.stage3_fixture_assert((SELECT count(*)=1 FROM public.attendee_activities WHERE event_id=ea AND entry_id='S3-ACTIVITY' AND activity_name='Replacement'),'activity replacement rollback');
 PERFORM public.stage3_fixture_expect_failure(r_fail_stage,v_both,'import_run_rows'); PERFORM public.stage3_fixture_assert(NOT EXISTS(SELECT 1 FROM public.attendees WHERE event_id=ea AND entry_id='S3-FAIL-S') AND (SELECT row_state='approved' FROM public.import_run_rows WHERE id=r_fail_stage),'staging-result rollback');
 PERFORM public.stage3_fixture_assert(NOT EXISTS(SELECT 1 FROM public.people p JOIN public.attendees a ON a.person_id=p.id WHERE a.event_id=ea) AND NOT EXISTS(SELECT 1 FROM public.person_event_participations pep WHERE pep.event_id=ea),'no Person or Participation mutation');
END $$;

ROLLBACK;
SELECT 'stage3 fixture PASS: outer rollback completed' AS result;
