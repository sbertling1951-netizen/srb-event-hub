-- Stage 5B.2 linked-database integration fixture. It installs the pending
-- RPC definitions only inside this outer transaction and always rolls
-- everything back.
-- PARITY: the two RPC blocks below are byte-for-byte copied from the
-- pending migration (the structural parity test in
-- 20260822140000_create_governed_vendor_import_row_commit.test.ts compares
-- the normalized blocks before this fixture is trusted).
BEGIN;

CREATE OR REPLACE FUNCTION public.commit_vendor_import_run_row(p_import_run_row_id uuid)
RETURNS TABLE(outcome text, vendor_id uuid, import_run_row_id uuid, reason_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE r public.import_run_rows%ROWTYPE; run public.import_runs%ROWTYPE; c jsonb; v public.vendors%ROWTYPE;
  n text; total_count integer; active_count integer; conflict_fields text[]:=ARRAY[]::text[]; admit boolean; metadata jsonb:='{}'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_row_id IS NULL THEN RAISE EXCEPTION 'missing_input' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM public.import_run_rows WHERE id=p_import_run_row_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_row_not_found' USING ERRCODE='22023'; END IF;
  SELECT * INTO run FROM public.import_runs WHERE id=r.import_run_id FOR UPDATE;
  IF run.import_type<>'vendors' OR r.row_state NOT IN ('approved','committed','commit_failed') THEN RAISE EXCEPTION 'import_row_not_approved' USING ERRCODE='22023'; END IF;
  IF NOT public.has_event_task_authority('event.imports.manage',r.event_id) OR NOT public.has_event_task_authority('event.vendors.manage',r.event_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF r.row_state='committed' THEN RETURN QUERY SELECT 'already_committed',r.canonical_target_id,r.id,NULL::text; RETURN; END IF;
  IF run.status NOT IN ('staging','ready_for_review') THEN RAISE EXCEPTION 'import_run_not_committable' USING ERRCODE='22023'; END IF;
  PERFORM public.assert_event_lifecycle_mutable(r.event_id); c:=r.normalized_candidate; n:=nullif(lower(regexp_replace(btrim(c#>>'{identity_evidence,business_name}'),'\s+',' ','g')),'');
  IF n IS NULL THEN RAISE EXCEPTION 'staged_candidate_missing_identity' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.import_run_rows x WHERE x.import_run_id=r.import_run_id AND x.id<>r.id AND lower(regexp_replace(btrim(x.normalized_candidate#>>'{identity_evidence,business_name}'),'\s+',' ','g'))=n) THEN
    UPDATE public.import_run_rows SET validation_details=validation_details||jsonb_build_array(jsonb_build_object('code','vendor_duplicate_in_import')),review_state='needs_review',row_state='needs_review',commit_state='not_started',commit_error=NULL,updated_at=now() WHERE id=r.id;
    RETURN QUERY SELECT 'needs_review',NULL::uuid,r.id,'vendor_duplicate_in_import'; RETURN;
  END IF;
  SELECT count(*),count(*) FILTER(WHERE is_active) INTO total_count,active_count FROM public.vendors WHERE lower(regexp_replace(btrim(coalesce(business_name,name,'')),'\s+',' ','g'))=n;
  IF total_count=0 THEN UPDATE public.import_run_rows SET validation_details=validation_details||jsonb_build_array(jsonb_build_object('code','vendor_not_found')),review_state='needs_review',row_state='needs_review',commit_state='not_started',commit_error=NULL,updated_at=now() WHERE id=r.id; RETURN QUERY SELECT 'needs_review',NULL::uuid,r.id,'vendor_not_found'; RETURN; END IF;
  IF total_count>1 THEN UPDATE public.import_run_rows SET validation_details=validation_details||jsonb_build_array(jsonb_build_object('code','vendor_identity_ambiguous')),review_state='needs_review',row_state='needs_review',commit_state='not_started',commit_error=NULL,updated_at=now() WHERE id=r.id; RETURN QUERY SELECT 'needs_review',NULL::uuid,r.id,'vendor_identity_ambiguous'; RETURN; END IF;
  SELECT * INTO v FROM public.vendors WHERE lower(regexp_replace(btrim(coalesce(business_name,name,'')),'\s+',' ','g'))=n FOR UPDATE;
  IF NOT v.is_active THEN UPDATE public.import_run_rows SET validation_details=validation_details||jsonb_build_array(jsonb_build_object('code','vendor_inactive')),review_state='needs_review',row_state='needs_review',commit_state='not_started',commit_error=NULL,updated_at=now() WHERE id=r.id; RETURN QUERY SELECT 'needs_review',NULL::uuid,r.id,'vendor_inactive'; RETURN; END IF;
  IF c#>>'{identity_evidence,contact_name}' IS NOT NULL AND v.contact_name IS NOT NULL AND lower(regexp_replace(btrim(c#>>'{identity_evidence,contact_name}'),'\s+',' ','g'))<>lower(regexp_replace(btrim(v.contact_name),'\s+',' ','g')) THEN conflict_fields:=array_append(conflict_fields,'contact_name'); END IF;
  IF c#>>'{identity_evidence,email}' IS NOT NULL AND v.email IS NOT NULL AND lower(btrim(c#>>'{identity_evidence,email}'))<>lower(btrim(v.email)) THEN conflict_fields:=array_append(conflict_fields,'email'); END IF;
  IF c#>>'{identity_evidence,phone}' IS NOT NULL AND v.phone IS NOT NULL AND regexp_replace(c#>>'{identity_evidence,phone}','\D','','g')<>regexp_replace(v.phone,'\D','','g') THEN conflict_fields:=array_append(conflict_fields,'phone'); END IF;
  IF c#>>'{identity_evidence,website}' IS NOT NULL AND v.website IS NOT NULL AND regexp_replace(lower(btrim(c#>>'{identity_evidence,website}')),'(#.*|/+$)','','g')<>regexp_replace(lower(btrim(v.website)),'(#.*|/+$)','','g') THEN conflict_fields:=array_append(conflict_fields,'website'); END IF;
  IF c#>>'{identity_evidence,business_description}' IS NOT NULL AND v.business_description IS NOT NULL AND lower(regexp_replace(btrim(c#>>'{identity_evidence,business_description}'),'\s+',' ','g'))<>lower(regexp_replace(btrim(v.business_description),'\s+',' ','g')) THEN conflict_fields:=array_append(conflict_fields,'business_description'); END IF;
  IF c#>>'{identity_evidence,preferred_contact_method}' IS NOT NULL AND v.preferred_contact_method IS NOT NULL AND lower(btrim(c#>>'{identity_evidence,preferred_contact_method}'))<>lower(btrim(v.preferred_contact_method)) THEN conflict_fields:=array_append(conflict_fields,'preferred_contact_method'); END IF;
  IF cardinality(conflict_fields)>0 THEN UPDATE public.import_run_rows SET validation_details=validation_details||jsonb_build_array(jsonb_build_object('code','vendor_identity_conflict','fields',conflict_fields)),review_state='needs_review',row_state='needs_review',commit_state='not_started',commit_error=NULL,updated_at=now() WHERE id=r.id; RETURN QUERY SELECT 'needs_review',NULL::uuid,r.id,'vendor_identity_conflict'; RETURN; END IF;
  admit:=CASE WHEN c#>'{event_intent,admit}' IS NULL THEN NULL ELSE (c#>>'{event_intent,admit}')::boolean END;
  IF admit IS TRUE THEN PERFORM public.admit_vendor_for_event(v.id,r.event_id); END IF;
  FOREACH n IN ARRAY ARRAY['is_featured','is_visible_to_members','action_type','signup_url','booth_location','event_note','display_order','show_on_member_dashboard','allow_service_requests'] LOOP IF c->'event_intent' ? n THEN metadata:=metadata||jsonb_build_object(n,c->'event_intent'->>n); END IF; END LOOP;
  IF metadata<>'{}'::jsonb THEN
    IF NOT EXISTS(SELECT 1 FROM public.event_vendors ev WHERE ev.vendor_id=v.id AND ev.event_id=r.event_id AND ev.admission_state='admitted') THEN UPDATE public.import_run_rows SET validation_details=validation_details||jsonb_build_array(jsonb_build_object('code','vendor_not_admitted')),review_state='needs_review',row_state='needs_review',commit_state='not_started',commit_error=NULL,updated_at=now() WHERE id=r.id; RETURN QUERY SELECT 'needs_review',NULL::uuid,r.id,'vendor_not_admitted'; RETURN; END IF;
    PERFORM public.update_event_vendor_metadata(v.id,r.event_id,metadata);
  END IF;
  UPDATE public.import_run_rows SET row_state='committed',commit_state='committed',canonical_target_id=v.id,commit_result=jsonb_build_object('vendor_id',v.id,'source_row_fingerprint',r.source_fingerprint),commit_error=NULL,committed_at=now(),updated_at=now() WHERE id=r.id;
  RETURN QUERY SELECT 'committed',v.id,r.id,NULL::text;
END; $$;
ALTER FUNCTION public.commit_vendor_import_run_row(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commit_vendor_import_run_row(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.commit_vendor_import_run_row(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_vendor_import_run_row_commit_failure(p_import_run_row_id uuid,p_failure_code text)
RETURNS public.import_run_rows LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE r public.import_run_rows%ROWTYPE; run public.import_runs%ROWTYPE; m text;
BEGIN
 IF auth.uid() IS NULL OR p_import_run_row_id IS NULL OR p_failure_code IS NULL THEN RAISE EXCEPTION 'missing_input' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.import_run_rows WHERE id=p_import_run_row_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'import_row_not_found' USING ERRCODE='22023'; END IF;
 SELECT * INTO run FROM public.import_runs WHERE id=r.import_run_id FOR UPDATE; IF run.import_type<>'vendors' THEN RAISE EXCEPTION 'import_row_not_vendor' USING ERRCODE='22023'; END IF;
 IF NOT public.has_event_task_authority('event.imports.manage',r.event_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
 IF run.status NOT IN ('staging','ready_for_review') THEN RAISE EXCEPTION 'import_run_not_committable' USING ERRCODE='22023'; END IF; PERFORM public.assert_event_lifecycle_mutable(r.event_id);
 m:=CASE p_failure_code WHEN 'vendor_commit_failed' THEN 'The Vendor commit did not complete. Retry after correcting the underlying issue.' WHEN 'vendor_commit_denied' THEN 'The Vendor commit was denied by a governed authority or lifecycle check.' WHEN 'vendor_commit_conflict' THEN 'The Vendor commit encountered a governed data conflict.' WHEN 'vendor_commit_unavailable' THEN 'The Vendor commit could not be completed. Retry later.' ELSE NULL END;
 IF m IS NULL THEN RAISE EXCEPTION 'invalid_failure_code' USING ERRCODE='22023'; END IF;
 IF r.row_state='commit_failed' THEN IF r.commit_error->>'code'=p_failure_code THEN RETURN r; END IF; RAISE EXCEPTION 'commit_failure_already_recorded' USING ERRCODE='22023'; END IF;
 IF r.row_state<>'approved' THEN RAISE EXCEPTION 'import_row_not_approved' USING ERRCODE='22023'; END IF;
 UPDATE public.import_run_rows SET row_state='commit_failed',commit_state='failed',commit_error=jsonb_build_object('code',p_failure_code,'message',m),updated_at=now() WHERE id=r.id RETURNING * INTO r; RETURN r;
END; $$;
ALTER FUNCTION public.record_vendor_import_run_row_commit_failure(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_vendor_import_run_row_commit_failure(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_vendor_import_run_row_commit_failure(uuid,text) TO authenticated;

-- ===================== fixture-only helpers (never survive ROLLBACK) =====================

CREATE FUNCTION public.stage5b2_fixture_assert(p_ok boolean,p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'stage5b2_fixture_assertion_failed: %',p_message; END IF; END $$;

CREATE FUNCTION public.stage5b2_fixture_candidate(p_business_name text,p_identity jsonb DEFAULT '{}'::jsonb,p_intent jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('identity_evidence',jsonb_build_object('business_name',p_business_name)||p_identity,'event_intent',p_intent);
$$;

CREATE FUNCTION public.stage5b2_fixture_recovery_row(p_recovery jsonb,p_row_id uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT elem FROM jsonb_array_elements(p_recovery->'rows') elem WHERE (elem->>'id')::uuid=p_row_id;
$$;

CREATE FUNCTION public.stage5b2_fixture_fail_dispositions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('stage5b2.fail_dispositions',true)='true' THEN RAISE EXCEPTION 'stage5b2_forced_dispositions_failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER stage5b2_fixture_fail_dispositions_trigger BEFORE INSERT ON public.vendor_event_dispositions FOR EACH ROW EXECUTE FUNCTION public.stage5b2_fixture_fail_dispositions();

CREATE FUNCTION public.stage5b2_fixture_fail_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('stage5b2.fail_metadata',true)='true' THEN RAISE EXCEPTION 'stage5b2_forced_metadata_failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER stage5b2_fixture_fail_metadata_trigger BEFORE UPDATE ON public.event_vendors FOR EACH ROW EXECUTE FUNCTION public.stage5b2_fixture_fail_metadata();

CREATE FUNCTION public.stage5b2_fixture_fail_stage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('stage5b2.fail_stage',true)='true' THEN RAISE EXCEPTION 'stage5b2_forced_stage_failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER stage5b2_fixture_fail_stage_trigger BEFORE UPDATE ON public.import_run_rows FOR EACH ROW EXECUTE FUNCTION public.stage5b2_fixture_fail_stage();

CREATE FUNCTION public.stage5b2_fixture_expect_failure(p_row uuid,p_user uuid,p_setting text,p_expected_error text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('request.jwt.claim.sub',p_user::text,true); PERFORM set_config(p_setting,'true',true);
 BEGIN PERFORM public.commit_vendor_import_run_row(p_row); RAISE EXCEPTION 'fixture did not force failure for %',p_setting;
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>p_expected_error THEN RAISE; END IF; END;
 PERFORM set_config(p_setting,'',true);
END $$;

-- ===================== fixture data + proofs =====================

DO $$
DECLARE
 t uuid:=gen_random_uuid(); ea uuid:=gen_random_uuid(); eb uuid:=gen_random_uuid(); ec uuid:=gen_random_uuid();
 v_both uuid:=gen_random_uuid(); v_imports uuid:=gen_random_uuid(); v_vendors uuid:=gen_random_uuid(); v_neither uuid:=gen_random_uuid();
 runa uuid:=gen_random_uuid(); runb uuid:=gen_random_uuid(); runc uuid:=gen_random_uuid(); rf uuid:=gen_random_uuid();
 v_active uuid; v_multi_a uuid; v_multi_b uuid; v_inactive uuid; v_conflict uuid; v_dup uuid;
 v_unadmitted_meta uuid; v_meta_omit uuid; v_admit_idem uuid; v_admit_norevoke uuid; v_admitfalse uuid; v_admitomit uuid;
 v_fail_admission uuid; v_fail_metadata uuid; v_fail_stage uuid; v_failrec uuid; v_authtest uuid; v_cross uuid; v_final uuid; v_lifecycle uuid; v_retry_review uuid;
 fixture_vendor_ids uuid[];
 r_success uuid:=gen_random_uuid(); r_zero uuid:=gen_random_uuid(); r_multi uuid:=gen_random_uuid(); r_inactive uuid:=gen_random_uuid(); r_conflict uuid:=gen_random_uuid();
 r_dup1 uuid:=gen_random_uuid(); r_dup2 uuid:=gen_random_uuid(); r_unadmitted_meta uuid:=gen_random_uuid(); r_meta_omit uuid:=gen_random_uuid();
 r_admit_idem uuid:=gen_random_uuid(); r_admit_norevoke uuid:=gen_random_uuid(); r_admitfalse uuid:=gen_random_uuid(); r_admitomit uuid:=gen_random_uuid();
 r_fail_admission uuid:=gen_random_uuid(); r_fail_metadata uuid:=gen_random_uuid(); r_fail_stage uuid:=gen_random_uuid(); r_failrec uuid:=gen_random_uuid();
 r_authtest uuid:=gen_random_uuid(); r_cross uuid:=gen_random_uuid(); r_final uuid:=gen_random_uuid(); r_lifecycle uuid:=gen_random_uuid();
 r_retry_review uuid:=gen_random_uuid(); r_retry_review_dup uuid:=gen_random_uuid();
 v_out text; v_reason text; v_vendor_id uuid; v_before_count integer; v_snapshot_before text; v_snapshot_after text;
 v_ev record; v_ev_before record; v_recovery jsonb; v_row jsonb; v_updated_at_1 timestamptz; v_updated_at_2 timestamptz;
 v_app_count integer; v_disp_count integer; v_ev_count integer;
BEGIN
 -- ---------- Tenant / Events / Callers ----------
 INSERT INTO public.tenants(id,organization_code,slug,organization_name,display_name,app_title)
   VALUES(t,'S5B2-'||left(t::text,8),'s5b2-'||left(t::text,8),'Stage 5B.2 Fixture','Stage 5B.2 Fixture','Stage 5B.2 Fixture');
 INSERT INTO public.events(id,tenant_id,name,start_date,end_date,timezone,lifecycle_state) VALUES
   (ea,t,'stage5b2-fixture-a-'||t::text,current_date,current_date+30,'UTC','operational'),
   (eb,t,'stage5b2-fixture-b-'||t::text,current_date,current_date+30,'UTC','operational'),
   (ec,t,'stage5b2-fixture-c-'||t::text,current_date,current_date+30,'UTC','archived');
 INSERT INTO auth.users(id,email) VALUES
   (v_both,'both-'||v_both||'@fixture.invalid'),(v_imports,'imports-'||v_imports||'@fixture.invalid'),
   (v_vendors,'vendors-'||v_vendors||'@fixture.invalid'),(v_neither,'neither-'||v_neither||'@fixture.invalid');
 INSERT INTO public.admin_users(user_id,email,display_name) VALUES
   (v_both,'both-'||v_both||'@fixture.invalid','both'),(v_imports,'imports-'||v_imports||'@fixture.invalid','imports'),
   (v_vendors,'vendors-'||v_vendors||'@fixture.invalid','vendors'),(v_neither,'neither-'||v_neither||'@fixture.invalid','neither');
 -- v_both: full authority on ea and ec, deliberately NOT on eb (cross-event denial proof).
 INSERT INTO public.admin_event_access(admin_user_id,event_id,role)
   SELECT id,ea,'event_admin' FROM public.admin_users WHERE user_id IN (v_both,v_imports,v_vendors,v_neither);
 INSERT INTO public.admin_event_access(admin_user_id,event_id,role) SELECT id,ec,'event_admin' FROM public.admin_users WHERE user_id=v_both;
 INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key)
   SELECT a.id,p.task FROM public.admin_event_access a JOIN public.admin_users u ON u.id=a.admin_user_id
   CROSS JOIN (VALUES ('event.imports.manage'),('event.vendors.manage')) p(task) WHERE a.event_id IN (ea,ec) AND u.user_id=v_both;
 INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key)
   SELECT a.id,'event.imports.manage' FROM public.admin_event_access a JOIN public.admin_users u ON u.id=a.admin_user_id WHERE a.event_id=ea AND u.user_id=v_imports;
 INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key)
   SELECT a.id,'event.vendors.manage' FROM public.admin_event_access a JOIN public.admin_users u ON u.id=a.admin_user_id WHERE a.event_id=ea AND u.user_id=v_vendors;

 -- ---------- Canonical Vendor fixtures (never mutated by the RPC under test) ----------
 INSERT INTO public.vendors(id,name,business_name,contact_name,email,phone,website,business_description,preferred_contact_method,is_active) VALUES
   (gen_random_uuid(),'Acme Tents Co','Acme Tents Co','Ann Acme','ann@acmetents.invalid','555-0101','https://acmetents.invalid','Tents and canopies','email',true)
   RETURNING id INTO v_active;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Multi Match Co','Multi Match Co',true) RETURNING id INTO v_multi_a;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Multi Match Co','Multi Match Co',true) RETURNING id INTO v_multi_b;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Inactive Vendor Co','Inactive Vendor Co',false) RETURNING id INTO v_inactive;
 INSERT INTO public.vendors(id,name,business_name,email,is_active) VALUES (gen_random_uuid(),'Conflict Vendor Co','Conflict Vendor Co','canon@conflictvendor.invalid',true) RETURNING id INTO v_conflict;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Dup Vendor Co','Dup Vendor Co',true) RETURNING id INTO v_dup;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Unadmitted Meta Co','Unadmitted Meta Co',true) RETURNING id INTO v_unadmitted_meta;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Metadata Omit Co','Metadata Omit Co',true) RETURNING id INTO v_meta_omit;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Admit Idem Co','Admit Idem Co',true) RETURNING id INTO v_admit_idem;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Admit NoRevoke Co','Admit NoRevoke Co',true) RETURNING id INTO v_admit_norevoke;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'AdmitFalse Fresh Co','AdmitFalse Fresh Co',true) RETURNING id INTO v_admitfalse;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'AdmitOmit Fresh Co','AdmitOmit Fresh Co',true) RETURNING id INTO v_admitomit;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Fail Admission Co','Fail Admission Co',true) RETURNING id INTO v_fail_admission;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Fail Metadata Co','Fail Metadata Co',true) RETURNING id INTO v_fail_metadata;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Fail Stage Co','Fail Stage Co',true) RETURNING id INTO v_fail_stage;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Failrec Retry Co','Failrec Retry Co',true) RETURNING id INTO v_failrec;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Authority Test Co','Authority Test Co',true) RETURNING id INTO v_authtest;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Cross Event Co','Cross Event Co',true) RETURNING id INTO v_cross;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Finalized Run Co','Finalized Run Co',true) RETURNING id INTO v_final;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Lifecycle Co','Lifecycle Co',true) RETURNING id INTO v_lifecycle;
 INSERT INTO public.vendors(id,name,business_name,is_active) VALUES (gen_random_uuid(),'Retry Review Co','Retry Review Co',true) RETURNING id INTO v_retry_review;

 fixture_vendor_ids:=ARRAY[v_active,v_multi_a,v_multi_b,v_inactive,v_conflict,v_dup,v_unadmitted_meta,v_meta_omit,v_admit_idem,v_admit_norevoke,
   v_admitfalse,v_admitomit,v_fail_admission,v_fail_metadata,v_fail_stage,v_failrec,v_authtest,v_cross,v_final,v_lifecycle,v_retry_review];

 SELECT string_agg(v.id::text||'|'||coalesce(v.business_name,'')||'|'||coalesce(v.name,'')||'|'||coalesce(v.contact_name,'')||'|'||coalesce(v.email,'')||'|'||coalesce(v.phone,'')||'|'||coalesce(v.website,'')||'|'||coalesce(v.logo_url,'')||'|'||coalesce(v.business_description,'')||'|'||coalesce(v.preferred_contact_method,'')||'|'||v.is_active::text||'|'||coalesce(v.services,'')||'|'||coalesce(v.notes,''),',' ORDER BY v.id)
   INTO v_snapshot_before FROM public.vendors v WHERE v.id=ANY(fixture_vendor_ids);

 -- Structural proof: the installed RPC never writes to public.vendors.
 PERFORM public.stage5b2_fixture_assert(pg_get_functiondef('public.commit_vendor_import_run_row(uuid)'::regprocedure) !~* 'INSERT INTO public\.vendors|UPDATE public\.vendors|DELETE FROM public\.vendors','structural: commit RPC never mutates public.vendors');
 PERFORM public.stage5b2_fixture_assert(pg_get_functiondef('public.commit_vendor_import_run_row(uuid)'::regprocedure) !~* 'revoke_vendor_admission','structural: commit RPC has no revoke path');
 PERFORM public.stage5b2_fixture_assert(pg_get_functiondef('public.commit_vendor_import_run_row(uuid)'::regprocedure) !~* 'vendor_org_access|access_token|logo_url\s*=','structural: commit RPC never touches portal/token/logo state');

 -- ---------- Pre-existing admission state, seeded through the real governed RPCs ----------
 PERFORM set_config('request.jwt.claim.sub',v_both::text,true);
 PERFORM public.admit_vendor_for_event(v_meta_omit,ea);
 PERFORM public.update_event_vendor_metadata(v_meta_omit,ea,jsonb_build_object('is_featured',true,'display_order',42,'booth_location','Original Booth','event_note','Original note','signup_url','https://original.invalid/signup','action_type','info_only','is_visible_to_members',false,'show_on_member_dashboard',false,'allow_service_requests',true));
 PERFORM public.admit_vendor_for_event(v_admit_idem,ea);
 PERFORM public.admit_vendor_for_event(v_admit_norevoke,ea);
 PERFORM public.admit_vendor_for_event(v_fail_metadata,ea);

 -- ---------- Stage the import rows (direct insert, mirrors the established fixture idiom) ----------
 INSERT INTO public.import_runs(id,event_id,import_type,created_by_auth_user_id) VALUES
   (runa,ea,'vendors',v_both),(runb,eb,'vendors',v_both),(runc,ec,'vendors',v_both),(rf,ea,'vendors',v_both);

 INSERT INTO public.import_run_rows(id,import_run_id,event_id,source_row_number,source_payload,normalized_candidate,source_fingerprint,validation_state,review_state,row_state) VALUES
  (r_success,runa,ea,1,'{}',public.stage5b2_fixture_candidate('Acme Tents Co',jsonb_build_object('contact_name','Ann Acme','email','ann@acmetents.invalid'),jsonb_build_object('admit',true,'is_featured',true,'is_visible_to_members',false,'action_type','external_signup','signup_url','https://example.invalid/signup','booth_location','Booth 12','event_note','Fixture event note','display_order',0,'show_on_member_dashboard',false,'allow_service_requests',true)),'s5b2-success-'||r_success,'valid','approved','approved'),
  (r_zero,runa,ea,2,'{}',public.stage5b2_fixture_candidate('Ghost Vendor Co'),'s5b2-zero-'||r_zero,'valid','approved','approved'),
  (r_multi,runa,ea,3,'{}',public.stage5b2_fixture_candidate('Multi Match Co'),'s5b2-multi-'||r_multi,'valid','approved','approved'),
  (r_inactive,runa,ea,4,'{}',public.stage5b2_fixture_candidate('Inactive Vendor Co'),'s5b2-inactive-'||r_inactive,'valid','approved','approved'),
  (r_conflict,runa,ea,5,'{}',public.stage5b2_fixture_candidate('Conflict Vendor Co',jsonb_build_object('email','imported@conflictvendor.invalid')),'s5b2-conflict-'||r_conflict,'valid','approved','approved'),
  (r_dup1,runa,ea,6,'{}',public.stage5b2_fixture_candidate('Dup Vendor Co'),'s5b2-dup1-'||r_dup1,'valid','approved','approved'),
  (r_dup2,runa,ea,7,'{}',public.stage5b2_fixture_candidate('Dup Vendor Co'),'s5b2-dup2-'||r_dup2,'valid','approved','approved'),
  (r_unadmitted_meta,runa,ea,8,'{}',public.stage5b2_fixture_candidate('Unadmitted Meta Co',jsonb_build_object(),jsonb_build_object('booth_location','Somewhere')),'s5b2-unadmitmeta-'||r_unadmitted_meta,'valid','approved','approved'),
  (r_meta_omit,runa,ea,9,'{}',public.stage5b2_fixture_candidate('Metadata Omit Co',jsonb_build_object(),jsonb_build_object('booth_location','Updated Booth','display_order',99)),'s5b2-metaomit-'||r_meta_omit,'valid','approved','approved'),
  (r_admit_idem,runa,ea,10,'{}',public.stage5b2_fixture_candidate('Admit Idem Co',jsonb_build_object(),jsonb_build_object('admit',true)),'s5b2-admitidem-'||r_admit_idem,'valid','approved','approved'),
  (r_admit_norevoke,runa,ea,11,'{}',public.stage5b2_fixture_candidate('Admit NoRevoke Co',jsonb_build_object(),jsonb_build_object('admit',false)),'s5b2-admitnorevoke-'||r_admit_norevoke,'valid','approved','approved'),
  (r_admitfalse,runa,ea,12,'{}',public.stage5b2_fixture_candidate('AdmitFalse Fresh Co',jsonb_build_object(),jsonb_build_object('admit',false)),'s5b2-admitfalse-'||r_admitfalse,'valid','approved','approved'),
  (r_admitomit,runa,ea,13,'{}',public.stage5b2_fixture_candidate('AdmitOmit Fresh Co'),'s5b2-admitomit-'||r_admitomit,'valid','approved','approved'),
  (r_fail_admission,runa,ea,14,'{}',public.stage5b2_fixture_candidate('Fail Admission Co',jsonb_build_object(),jsonb_build_object('admit',true)),'s5b2-failadm-'||r_fail_admission,'valid','approved','approved'),
  (r_fail_metadata,runa,ea,15,'{}',public.stage5b2_fixture_candidate('Fail Metadata Co',jsonb_build_object(),jsonb_build_object('is_featured',true,'display_order',55)),'s5b2-failmeta-'||r_fail_metadata,'valid','approved','approved'),
  (r_fail_stage,runa,ea,16,'{}',public.stage5b2_fixture_candidate('Fail Stage Co',jsonb_build_object(),jsonb_build_object('admit',true,'booth_location','Stage Fail Booth')),'s5b2-failstage-'||r_fail_stage,'valid','approved','approved'),
  (r_failrec,runa,ea,17,'{}',public.stage5b2_fixture_candidate('Failrec Retry Co',jsonb_build_object(),jsonb_build_object('admit',true)),'s5b2-failrec-'||r_failrec,'valid','approved','approved'),
  (r_authtest,runa,ea,18,'{}',public.stage5b2_fixture_candidate('Authority Test Co'),'s5b2-authtest-'||r_authtest,'valid','approved','approved'),
  (r_retry_review,runa,ea,19,'{}',public.stage5b2_fixture_candidate('Retry Review Co'),'s5b2-retryreview-'||r_retry_review,'valid','approved','approved');

 INSERT INTO public.import_run_rows(id,import_run_id,event_id,source_row_number,source_payload,normalized_candidate,source_fingerprint,validation_state,review_state,row_state) VALUES
  (r_cross,runb,eb,1,'{}',public.stage5b2_fixture_candidate('Cross Event Co'),'s5b2-cross-'||r_cross,'valid','approved','approved'),
  (r_final,rf,ea,1,'{}',public.stage5b2_fixture_candidate('Finalized Run Co'),'s5b2-final-'||r_final,'valid','approved','approved'),
  (r_lifecycle,runc,ec,1,'{}',public.stage5b2_fixture_candidate('Lifecycle Co'),'s5b2-lifecycle-'||r_lifecycle,'valid','approved','approved');

 PERFORM set_config('request.jwt.claim.sub',v_both::text,true);

 -- ================= 4. Matching / persisted review proof + golden-path commit =================
 SELECT outcome,vendor_id INTO v_out,v_vendor_id FROM public.commit_vendor_import_run_row(r_success);
 PERFORM public.stage5b2_fixture_assert(v_out='committed' AND v_vendor_id=v_active,'single active exact match commits');
 PERFORM public.stage5b2_fixture_assert((SELECT row_state='committed' AND canonical_target_id=v_active FROM public.import_run_rows WHERE id=r_success),'staging result persisted for success');
 PERFORM public.stage5b2_fixture_assert((SELECT ev.is_featured=true AND ev.is_visible_to_members=false AND ev.action_type='external_signup' AND ev.signup_url='https://example.invalid/signup' AND ev.booth_location='Booth 12' AND ev.event_note='Fixture event note' AND ev.display_order=0 AND ev.show_on_member_dashboard=false AND ev.allow_service_requests=true AND ev.admission_state='admitted' FROM public.event_vendors ev WHERE ev.vendor_id=v_active AND ev.event_id=ea),'explicit false/0 metadata and admission persisted together');

 SELECT outcome,reason_code INTO v_out,v_reason FROM public.commit_vendor_import_run_row(r_zero);
 PERFORM public.stage5b2_fixture_assert(v_out='needs_review' AND v_reason='vendor_not_found','zero match -> needs_review');
 PERFORM public.stage5b2_fixture_assert((SELECT row_state='needs_review' AND commit_state='not_started' AND canonical_target_id IS NULL FROM public.import_run_rows WHERE id=r_zero),'zero match persisted, no target guessed');

 SELECT outcome,reason_code INTO v_out,v_reason FROM public.commit_vendor_import_run_row(r_multi);
 PERFORM public.stage5b2_fixture_assert(v_out='needs_review' AND v_reason='vendor_identity_ambiguous','multiple matches -> needs_review');
 PERFORM public.stage5b2_fixture_assert((SELECT row_state='needs_review' AND commit_state='not_started' FROM public.import_run_rows WHERE id=r_multi),'ambiguous match persisted');

 SELECT outcome,reason_code INTO v_out,v_reason FROM public.commit_vendor_import_run_row(r_inactive);
 PERFORM public.stage5b2_fixture_assert(v_out='needs_review' AND v_reason='vendor_inactive','inactive match -> needs_review');
 PERFORM public.stage5b2_fixture_assert((SELECT is_active=false FROM public.vendors WHERE id=v_inactive),'inactive vendor never reactivated');

 SELECT outcome,reason_code INTO v_out,v_reason FROM public.commit_vendor_import_run_row(r_conflict);
 PERFORM public.stage5b2_fixture_assert(v_out='needs_review' AND v_reason='vendor_identity_conflict','supporting identity conflict -> needs_review');
 PERFORM public.stage5b2_fixture_assert((SELECT validation_details @> '[{"code":"vendor_identity_conflict","fields":["email"]}]'::jsonb FROM public.import_run_rows WHERE id=r_conflict),'conflicting field named as email');

 SELECT outcome,reason_code INTO v_out,v_reason FROM public.commit_vendor_import_run_row(r_dup1);
 PERFORM public.stage5b2_fixture_assert(v_out='needs_review' AND v_reason='vendor_duplicate_in_import','same-file duplicate row 1 -> needs_review');
 SELECT outcome,reason_code INTO v_out,v_reason FROM public.commit_vendor_import_run_row(r_dup2);
 PERFORM public.stage5b2_fixture_assert(v_out='needs_review' AND v_reason='vendor_duplicate_in_import','same-file duplicate row 2 -> needs_review');
 PERFORM public.stage5b2_fixture_assert((SELECT count(*)=0 FROM public.event_vendors WHERE vendor_id=v_dup),'duplicate vendor never admitted from either row');

 -- Recovery mid-fixture: needs_review rows report truthfully.
 v_recovery:=public.get_managed_import_run_recovery(runa);
 v_row:=public.stage5b2_fixture_recovery_row(v_recovery,r_zero); PERFORM public.stage5b2_fixture_assert(v_row->>'row_state'='needs_review' AND v_row->>'commit_state'='not_started','recovery reports zero-match truthfully');
 v_row:=public.stage5b2_fixture_recovery_row(v_recovery,r_multi); PERFORM public.stage5b2_fixture_assert(v_row->>'row_state'='needs_review','recovery reports ambiguous truthfully');
 v_row:=public.stage5b2_fixture_recovery_row(v_recovery,r_inactive); PERFORM public.stage5b2_fixture_assert(v_row->>'row_state'='needs_review','recovery reports inactive truthfully');
 v_row:=public.stage5b2_fixture_recovery_row(v_recovery,r_conflict); PERFORM public.stage5b2_fixture_assert(v_row->>'row_state'='needs_review','recovery reports conflict truthfully');
 v_row:=public.stage5b2_fixture_recovery_row(v_recovery,r_success); PERFORM public.stage5b2_fixture_assert(v_row->>'row_state'='committed' AND (v_row->'commit_result'->>'vendor_id')=v_active::text,'recovery reports committed success truthfully');

 -- ================= 6/7. Admission + metadata semantics =================
 SELECT outcome,reason_code INTO v_out,v_reason FROM public.commit_vendor_import_run_row(r_unadmitted_meta);
 PERFORM public.stage5b2_fixture_assert(v_out='needs_review' AND v_reason='vendor_not_admitted','metadata without admission on an unadmitted vendor -> needs_review, non-destructive');
 PERFORM public.stage5b2_fixture_assert((SELECT count(*)=0 FROM public.event_vendors WHERE vendor_id=v_unadmitted_meta),'no event_vendors row created for unadmitted metadata-only row');

 SELECT ev.is_featured,ev.display_order,ev.booth_location,ev.event_note,ev.signup_url,ev.action_type,ev.is_visible_to_members,ev.show_on_member_dashboard,ev.allow_service_requests,ev.notes,ev.admission_state,ev.admitted_at,ev.application_id,ev.current_disposition_id,ev.status
   INTO v_ev_before FROM public.event_vendors ev WHERE ev.vendor_id=v_meta_omit AND ev.event_id=ea;
 SELECT outcome INTO v_out FROM public.commit_vendor_import_run_row(r_meta_omit);
 PERFORM public.stage5b2_fixture_assert(v_out='committed','metadata-omit commit succeeds');
 SELECT ev.is_featured,ev.display_order,ev.booth_location,ev.event_note,ev.signup_url,ev.action_type,ev.is_visible_to_members,ev.show_on_member_dashboard,ev.allow_service_requests,ev.notes,ev.admission_state,ev.admitted_at,ev.application_id,ev.current_disposition_id,ev.status
   INTO v_ev FROM public.event_vendors ev WHERE ev.vendor_id=v_meta_omit AND ev.event_id=ea;
 PERFORM public.stage5b2_fixture_assert(v_ev.booth_location='Updated Booth' AND v_ev.display_order=99,'requested fields updated');
 PERFORM public.stage5b2_fixture_assert(v_ev.is_featured=v_ev_before.is_featured AND v_ev.event_note=v_ev_before.event_note AND v_ev.signup_url=v_ev_before.signup_url AND v_ev.action_type=v_ev_before.action_type AND v_ev.is_visible_to_members=v_ev_before.is_visible_to_members AND v_ev.show_on_member_dashboard=v_ev_before.show_on_member_dashboard AND v_ev.allow_service_requests=v_ev_before.allow_service_requests,'omitted fields preserved exactly');
 PERFORM public.stage5b2_fixture_assert(v_ev.notes IS NOT DISTINCT FROM v_ev_before.notes AND v_ev.admission_state=v_ev_before.admission_state AND v_ev.admitted_at=v_ev_before.admitted_at AND v_ev.application_id=v_ev_before.application_id AND v_ev.current_disposition_id=v_ev_before.current_disposition_id AND v_ev.status=v_ev_before.status,'no field outside the metadata allowlist changed');

 SELECT count(*) INTO v_app_count FROM public.vendor_event_applications WHERE vendor_id=v_admit_idem AND event_id=ea;
 SELECT count(*) INTO v_disp_count FROM public.vendor_event_dispositions WHERE vendor_id=v_admit_idem AND event_id=ea;
 SELECT outcome INTO v_out FROM public.commit_vendor_import_run_row(r_admit_idem);
 PERFORM public.stage5b2_fixture_assert(v_out='committed','admit=true against an already-admitted vendor still commits the row');
 PERFORM public.stage5b2_fixture_assert((SELECT count(*) FROM public.vendor_event_applications WHERE vendor_id=v_admit_idem AND event_id=ea)=v_app_count AND (SELECT count(*) FROM public.vendor_event_dispositions WHERE vendor_id=v_admit_idem AND event_id=ea)=v_disp_count,'admit=true idempotent: no duplicate application/disposition');
 PERFORM public.stage5b2_fixture_assert((SELECT count(*) FROM public.event_vendors WHERE vendor_id=v_admit_idem AND event_id=ea)=1,'admit=true idempotent: exactly one event_vendors row');

 SELECT outcome INTO v_out FROM public.commit_vendor_import_run_row(r_admit_norevoke);
 PERFORM public.stage5b2_fixture_assert(v_out='committed' AND (SELECT admission_state='admitted' FROM public.event_vendors WHERE vendor_id=v_admit_norevoke AND event_id=ea),'admit=false on an already-admitted vendor leaves admission intact, no implicit revoke');

 SELECT outcome INTO v_out FROM public.commit_vendor_import_run_row(r_admitfalse);
 PERFORM public.stage5b2_fixture_assert(v_out='committed' AND (SELECT count(*)=0 FROM public.event_vendors WHERE vendor_id=v_admitfalse),'admit=false on a fresh vendor commits with no admission mutation');

 SELECT outcome INTO v_out FROM public.commit_vendor_import_run_row(r_admitomit);
 PERFORM public.stage5b2_fixture_assert(v_out='committed' AND (SELECT count(*)=0 FROM public.event_vendors WHERE vendor_id=v_admitomit),'admit omitted on a fresh vendor commits with no admission mutation');

 -- ================= 8. Authority matrix =================
 SELECT count(*) INTO v_before_count FROM public.event_vendors WHERE vendor_id=v_authtest;
 FOREACH v_vendor_id IN ARRAY ARRAY[v_imports,v_vendors,v_neither] LOOP
   PERFORM set_config('request.jwt.claim.sub',v_vendor_id::text,true);
   BEGIN PERFORM public.commit_vendor_import_run_row(r_authtest); RAISE EXCEPTION 'authority denial missing for %',v_vendor_id;
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub',v_both::text,true);
 BEGIN PERFORM public.commit_vendor_import_run_row(r_cross); RAISE EXCEPTION 'cross-event denial missing';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN PERFORM public.commit_vendor_import_run_row(r_authtest); RAISE EXCEPTION 'anon denial missing';
 EXCEPTION WHEN OTHERS THEN PERFORM public.stage5b2_fixture_assert(SQLERRM='missing_input','anon denied'); END;
 PERFORM public.stage5b2_fixture_assert((SELECT count(*) FROM public.event_vendors WHERE vendor_id=v_authtest)=v_before_count,'authority denials mutate nothing');

 -- ================= 9. Lifecycle proof =================
 PERFORM set_config('request.jwt.claim.sub',v_both::text,true);
 BEGIN PERFORM public.commit_vendor_import_run_row(r_lifecycle); RAISE EXCEPTION 'archived-event denial missing';
 EXCEPTION WHEN OTHERS THEN PERFORM public.stage5b2_fixture_assert(SQLERRM='event_archived','archived Event denied even for a fully-authorized caller'); END;

 -- Finalized run cannot begin a new commit.
 UPDATE public.import_runs SET status='finalized',finalized_at=now() WHERE id=rf;
 BEGIN PERFORM public.commit_vendor_import_run_row(r_final); RAISE EXCEPTION 'finalized-run denial missing';
 EXCEPTION WHEN OTHERS THEN PERFORM public.stage5b2_fixture_assert(SQLERRM='import_run_not_committable','finalized run denied'); END;

 -- ================= 9 (atomicity). Nested-RPC rollback at three forced-failure points =================
 PERFORM public.stage5b2_fixture_expect_failure(r_fail_admission,v_both,'stage5b2.fail_dispositions','stage5b2_forced_dispositions_failure');
 PERFORM public.stage5b2_fixture_assert(NOT EXISTS(SELECT 1 FROM public.event_vendors WHERE vendor_id=v_fail_admission) AND NOT EXISTS(SELECT 1 FROM public.vendor_event_dispositions WHERE vendor_id=v_fail_admission) AND NOT EXISTS(SELECT 1 FROM public.vendor_event_applications WHERE vendor_id=v_fail_admission),'admission/application/disposition fully rolled back');
 PERFORM public.stage5b2_fixture_assert((SELECT row_state='approved' FROM public.import_run_rows WHERE id=r_fail_admission),'staging row untouched after admission-phase rollback');

 SELECT is_featured,display_order INTO v_ev_before FROM public.event_vendors WHERE vendor_id=v_fail_metadata AND event_id=ea;
 PERFORM public.stage5b2_fixture_expect_failure(r_fail_metadata,v_both,'stage5b2.fail_metadata','stage5b2_forced_metadata_failure');
 PERFORM public.stage5b2_fixture_assert((SELECT is_featured=v_ev_before.is_featured AND display_order=v_ev_before.display_order FROM public.event_vendors WHERE vendor_id=v_fail_metadata AND event_id=ea),'metadata rolled back to pre-call values');
 PERFORM public.stage5b2_fixture_assert((SELECT row_state='approved' FROM public.import_run_rows WHERE id=r_fail_metadata),'staging row untouched after metadata-phase rollback');

 PERFORM public.stage5b2_fixture_expect_failure(r_fail_stage,v_both,'stage5b2.fail_stage','stage5b2_forced_stage_failure');
 PERFORM public.stage5b2_fixture_assert(NOT EXISTS(SELECT 1 FROM public.event_vendors WHERE vendor_id=v_fail_stage) AND NOT EXISTS(SELECT 1 FROM public.vendor_event_dispositions WHERE vendor_id=v_fail_stage) AND NOT EXISTS(SELECT 1 FROM public.vendor_event_applications WHERE vendor_id=v_fail_stage),'admission+metadata rolled back when the final staging-result update fails');
 PERFORM public.stage5b2_fixture_assert((SELECT row_state='approved' FROM public.import_run_rows WHERE id=r_fail_stage),'staging row itself unchanged after its own update failed');

 -- ================= 10/11. Failure recorder + retry/idempotency =================
 PERFORM public.record_vendor_import_run_row_commit_failure(r_failrec,'vendor_commit_failed');
 PERFORM public.stage5b2_fixture_assert((SELECT row_state='commit_failed' AND commit_state='failed' AND commit_error->>'code'='vendor_commit_failed' AND commit_error->>'message'='The Vendor commit did not complete. Retry after correcting the underlying issue.' FROM public.import_run_rows WHERE id=r_failrec),'bounded failure code and stable message persisted, no raw error text');
 SELECT updated_at INTO v_updated_at_1 FROM public.import_run_rows WHERE id=r_failrec;
 PERFORM public.record_vendor_import_run_row_commit_failure(r_failrec,'vendor_commit_failed');
 SELECT updated_at INTO v_updated_at_2 FROM public.import_run_rows WHERE id=r_failrec;
 PERFORM public.stage5b2_fixture_assert(v_updated_at_1=v_updated_at_2,'exact same-code replay is a no-op, not a new mutation');
 BEGIN PERFORM public.record_vendor_import_run_row_commit_failure(r_failrec,'vendor_commit_conflict'); RAISE EXCEPTION 'different-code replay allowed';
 EXCEPTION WHEN OTHERS THEN PERFORM public.stage5b2_fixture_assert(SQLERRM='commit_failure_already_recorded','different-code replay denied'); END;
 BEGIN PERFORM public.record_vendor_import_run_row_commit_failure(r_failrec,'not_a_real_code'); RAISE EXCEPTION 'invalid replacement code allowed';
 EXCEPTION WHEN OTHERS THEN PERFORM public.stage5b2_fixture_assert(SQLERRM='invalid_failure_code','invalid replacement code denied'); END;

 v_recovery:=public.get_managed_import_run_recovery(runa);
 v_row:=public.stage5b2_fixture_recovery_row(v_recovery,r_failrec);
 PERFORM public.stage5b2_fixture_assert(v_row->>'row_state'='commit_failed' AND v_row->'commit_error'->>'code'='vendor_commit_failed','recovery reports commit_failed truthfully');

 -- Retry (no forced failure active): succeeds, clears the failure, admits, applies metadata-free commit.
 SELECT outcome,vendor_id INTO v_out,v_vendor_id FROM public.commit_vendor_import_run_row(r_failrec);
 PERFORM public.stage5b2_fixture_assert(v_out='committed' AND v_vendor_id=v_failrec,'commit_failed row retries to committed');
 PERFORM public.stage5b2_fixture_assert((SELECT row_state='committed' AND commit_state='committed' AND commit_error IS NULL FROM public.import_run_rows WHERE id=r_failrec),'failure state cleared on successful retry');
 PERFORM public.stage5b2_fixture_assert((SELECT count(*)=1 FROM public.event_vendors WHERE vendor_id=v_failrec AND event_id=ea AND admission_state='admitted'),'exactly one Event-Vendor relationship after retry');
 SELECT count(*) INTO v_app_count FROM public.vendor_event_applications WHERE vendor_id=v_failrec AND event_id=ea;
 SELECT count(*) INTO v_disp_count FROM public.vendor_event_dispositions WHERE vendor_id=v_failrec AND event_id=ea;
 PERFORM public.stage5b2_fixture_assert(v_app_count=1 AND v_disp_count=1,'exactly one application and one disposition after retry');

 -- Committed retry: idempotent, no duplicates.
 SELECT outcome INTO v_out FROM public.commit_vendor_import_run_row(r_failrec);
 PERFORM public.stage5b2_fixture_assert(v_out='already_committed','committed retry reports already_committed');
 PERFORM public.stage5b2_fixture_assert((SELECT count(*) FROM public.vendor_event_applications WHERE vendor_id=v_failrec AND event_id=ea)=v_app_count AND (SELECT count(*) FROM public.vendor_event_dispositions WHERE vendor_id=v_failrec AND event_id=ea)=v_disp_count AND (SELECT count(*) FROM public.event_vendors WHERE vendor_id=v_failrec AND event_id=ea)=1,'already_committed retry creates no duplicate evidence');

 v_recovery:=public.get_managed_import_run_recovery(runa);
 v_row:=public.stage5b2_fixture_recovery_row(v_recovery,r_failrec);
 PERFORM public.stage5b2_fixture_assert(v_row->>'row_state'='committed' AND v_row->>'commit_error' IS NULL AND (v_row->'commit_result'->>'vendor_id')=v_failrec::text,'recovery reports the successful retry truthfully');

 -- ================= Defect probe: retry from commit_failed into a needs_review outcome =================
 -- A row that failed once must be able to resolve into needs_review on retry (e.g. a same-file
 -- duplicate staged after the failure was recorded) without violating import_run_rows' state
 -- consistency CHECK constraint. This is the scenario the fixture is required to prove clean.
 PERFORM public.record_vendor_import_run_row_commit_failure(r_retry_review,'vendor_commit_failed');
 PERFORM public.stage5b2_fixture_assert((SELECT row_state='commit_failed' AND commit_state='failed' FROM public.import_run_rows WHERE id=r_retry_review),'retry-review row recorded as commit_failed');
 INSERT INTO public.import_run_rows(id,import_run_id,event_id,source_row_number,source_payload,normalized_candidate,source_fingerprint,validation_state,review_state,row_state) VALUES
   (r_retry_review_dup,runa,ea,20,'{}',public.stage5b2_fixture_candidate('Retry Review Co'),'s5b2-retryreviewdup-'||r_retry_review_dup,'valid','approved','approved');
 SELECT outcome,reason_code INTO v_out,v_reason FROM public.commit_vendor_import_run_row(r_retry_review);
 PERFORM public.stage5b2_fixture_assert(v_out='needs_review' AND v_reason='vendor_duplicate_in_import','commit_failed row retries cleanly into needs_review');
 PERFORM public.stage5b2_fixture_assert((SELECT row_state='needs_review' AND commit_state='not_started' AND commit_error IS NULL FROM public.import_run_rows WHERE id=r_retry_review),'retry-into-review clears the prior commit_failed state instead of violating state consistency');

 -- ================= Global Vendor immutability: final snapshot =================
 SELECT string_agg(v.id::text||'|'||coalesce(v.business_name,'')||'|'||coalesce(v.name,'')||'|'||coalesce(v.contact_name,'')||'|'||coalesce(v.email,'')||'|'||coalesce(v.phone,'')||'|'||coalesce(v.website,'')||'|'||coalesce(v.logo_url,'')||'|'||coalesce(v.business_description,'')||'|'||coalesce(v.preferred_contact_method,'')||'|'||v.is_active::text||'|'||coalesce(v.services,'')||'|'||coalesce(v.notes,''),',' ORDER BY v.id)
   INTO v_snapshot_after FROM public.vendors v WHERE v.id=ANY(fixture_vendor_ids);
 PERFORM public.stage5b2_fixture_assert(v_snapshot_before=v_snapshot_after,'every canonical Vendor fixture row is byte-identical before and after the full proof run');
END $$;

ROLLBACK;
SELECT 'stage5b2 fixture PASS: outer rollback completed' AS result;
