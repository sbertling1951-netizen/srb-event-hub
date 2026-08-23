-- Stage 5B.2: atomically commit one approved Vendor Import row to its Event.
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
COMMIT;
