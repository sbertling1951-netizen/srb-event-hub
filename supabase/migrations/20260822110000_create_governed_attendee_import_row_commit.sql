-- Stage 3: Attendee-domain atomic commit of one approved Imports row.
-- Co-Pilot evidence remains solely on public.attendees.copilot_*.
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
COMMIT;
