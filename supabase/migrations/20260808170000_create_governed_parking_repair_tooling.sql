-- Owner-only operational tooling for the Accepted governed repair plan.
-- No function here mutates parking inventory; execute_parking_repair remains
-- the sole executor.

ALTER TABLE public.parking_repair_manifest_entry
  ADD CONSTRAINT parking_repair_manifest_entry_duplicate_group_check CHECK (
    classification NOT IN ('duplicate_survivor', 'duplicate_retirement')
    OR group_id IS NOT NULL
  );

ALTER TABLE public.parking_repair_manifest_entry
  ADD CONSTRAINT parking_repair_manifest_entry_manifest_id_id_key UNIQUE (manifest_id, id);

ALTER TABLE public.parking_repair_manifest_entry
  ADD CONSTRAINT parking_repair_manifest_entry_same_manifest_survivor_fkey
  FOREIGN KEY (manifest_id, survivor_entry_id)
  REFERENCES public.parking_repair_manifest_entry (manifest_id, id);

-- Shared, fail-closed version of the retained-reference semantics from the
-- accepted duplicate-retirement revalidation. Any catalog/probe failure is
-- not absence of a reference.
CREATE FUNCTION public._repair_retained_reference_absent(p_parking_site_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE fk record; found_reference boolean;
BEGIN
  BEGIN
    FOR fk IN SELECT ns.nspname schema_name,rel.relname table_name,c.conname,
      string_agg(format('child.%I IS NOT DISTINCT FROM parent.%I',ca.attname,pa.attname),' AND ' ORDER BY ck.ordinality) predicate
      FROM pg_constraint c JOIN pg_class rel ON rel.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      JOIN LATERAL unnest(c.conkey) WITH ORDINALITY ck(attnum,ordinality) ON true
      JOIN LATERAL unnest(c.confkey) WITH ORDINALITY pk(attnum,ordinality) ON pk.ordinality=ck.ordinality
      JOIN pg_attribute ca ON ca.attrelid=c.conrelid AND ca.attnum=ck.attnum
      JOIN pg_attribute pa ON pa.attrelid=c.confrelid AND pa.attnum=pk.attnum
      WHERE c.contype='f' AND c.confrelid='public.parking_sites'::regclass
      GROUP BY ns.nspname,rel.relname,c.conname
    LOOP
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I child JOIN public.parking_sites parent ON %s WHERE parent.id=$1)',fk.schema_name,fk.table_name,fk.predicate) INTO found_reference USING p_parking_site_id;
      IF found_reference THEN RETURN jsonb_build_object('passed',false,'reason','foreign_key_reference_exists','constraint',fk.conname); END IF;
    END LOOP;
    IF to_regclass('public.site_placement_history') IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.site_placement_history
                 WHERE previous_site_id=p_parking_site_id OR resulting_site_id=p_parking_site_id) THEN
        RETURN jsonb_build_object('passed',false,'reason','governed_retained_reference_exists');
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('passed',false,'reason','retained_reference_check_unproven','error',SQLERRM); END;
  RETURN jsonb_build_object('passed',true);
END $$;
ALTER FUNCTION public._repair_retained_reference_absent(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_retained_reference_absent(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- One retained-reference proof: candidate retirement delegates to the shared
-- helper rather than repeating FK/history discovery.
CREATE OR REPLACE FUNCTION public._repair_revalidate_duplicate_retirement(p_parking_site_id uuid,p_survivor_parking_site_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE v_row public.parking_sites%ROWTYPE; v_survivor public.parking_sites%ROWTYPE; v_retained jsonb;
BEGIN
  IF p_parking_site_id<p_survivor_parking_site_id THEN SELECT * INTO v_row FROM public.parking_sites WHERE id=p_parking_site_id FOR UPDATE; SELECT * INTO v_survivor FROM public.parking_sites WHERE id=p_survivor_parking_site_id FOR UPDATE;
  ELSE SELECT * INTO v_survivor FROM public.parking_sites WHERE id=p_survivor_parking_site_id FOR UPDATE; SELECT * INTO v_row FROM public.parking_sites WHERE id=p_parking_site_id FOR UPDATE; END IF;
  IF v_row IS NULL THEN RETURN jsonb_build_object('passed',false,'reason','row_no_longer_exists'); END IF;
  IF v_survivor IS NULL THEN RETURN jsonb_build_object('passed',false,'reason','survivor_no_longer_exists','current_state',to_jsonb(v_row)); END IF;
  IF v_row.assigned_attendee_id IS NOT NULL THEN RETURN jsonb_build_object('passed',false,'reason','no_longer_vacant','current_state',to_jsonb(v_row)); END IF;
  v_retained:=public._repair_retained_reference_absent(v_row.id);
  IF NOT coalesce((v_retained->>'passed')::boolean,false) THEN RETURN jsonb_build_object('passed',false,'reason',coalesce(v_retained->>'reason','retained_reference_check_unproven'),'retained_reference',v_retained,'current_state',to_jsonb(v_row)); END IF;
  IF NOT(v_row.site_number IS NOT DISTINCT FROM v_survivor.site_number AND v_row.display_label IS NOT DISTINCT FROM v_survivor.display_label AND v_row.map_x IS NOT DISTINCT FROM v_survivor.map_x AND v_row.map_y IS NOT DISTINCT FROM v_survivor.map_y AND v_row.map_image_url IS NOT DISTINCT FROM v_survivor.map_image_url) THEN RETURN jsonb_build_object('passed',false,'reason','no_longer_physically_equivalent','current_state',to_jsonb(v_row)); END IF;
  IF NOT((v_row.master_site_id IS NULL AND v_survivor.master_site_id IS NULL) OR(v_row.master_site_id IS NOT NULL AND v_survivor.master_site_id IS NOT NULL AND v_row.master_site_id=v_survivor.master_site_id)) THEN RETURN jsonb_build_object('passed',false,'reason','no_longer_identity_equivalent','current_state',to_jsonb(v_row)); END IF;
  RETURN jsonb_build_object('passed',true,'current_state',to_jsonb(v_row),'survivor_state',to_jsonb(v_survivor));
END $$;
ALTER FUNCTION public._repair_revalidate_duplicate_retirement(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_revalidate_duplicate_retirement(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Validates the complete, still-draft manifest. It is invoked by the only
-- approval operation below, after human review and before the existing
-- immutability trigger freezes the rows.
CREATE FUNCTION public._repair_validate_manifest_structure(p_manifest_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.parking_repair_manifest m
    WHERE m.id=p_manifest_id
      AND cardinality(m.scope_event_ids)<>cardinality(ARRAY(SELECT DISTINCT x FROM unnest(m.scope_event_ids) x))
  ) THEN RAISE EXCEPTION 'Manifest Event scope contains duplicate identifiers.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.parking_repair_manifest_entry e
    WHERE e.manifest_id=p_manifest_id AND e.classification IN ('duplicate_survivor','duplicate_retirement')
      AND e.group_id IS NULL
  ) THEN RAISE EXCEPTION 'Duplicate manifest entry lacks group_id.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.parking_repair_manifest_entry e
    WHERE e.manifest_id=p_manifest_id AND e.classification='duplicate_retirement'
      AND e.survivor_entry_id IS NULL
  ) THEN RAISE EXCEPTION 'Duplicate retirement lacks survivor_entry_id.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.parking_repair_manifest_entry e
    LEFT JOIN public.parking_repair_manifest_entry s ON s.id=e.survivor_entry_id AND s.manifest_id=e.manifest_id
    WHERE e.manifest_id=p_manifest_id AND e.classification='duplicate_retirement'
      AND (s.id IS NULL OR s.classification<>'duplicate_survivor' OR s.group_id IS DISTINCT FROM e.group_id)
  ) THEN RAISE EXCEPTION 'Duplicate retirement references an invalid or cross-group survivor.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.parking_repair_manifest_entry e
    WHERE e.manifest_id=p_manifest_id AND e.classification='duplicate_survivor'
    GROUP BY e.group_id HAVING count(*)<>1
  ) THEN RAISE EXCEPTION 'Duplicate group lacks exactly one survivor.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.parking_repair_manifest_entry s
    WHERE s.manifest_id=p_manifest_id AND s.classification='duplicate_survivor'
      AND NOT EXISTS(SELECT 1 FROM public.parking_repair_manifest_entry r WHERE r.manifest_id=s.manifest_id AND r.group_id=s.group_id AND r.classification='duplicate_retirement' AND r.survivor_entry_id=s.id)
  ) THEN RAISE EXCEPTION 'Duplicate survivor group has no retirement sibling.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.parking_repair_manifest_entry a JOIN public.parking_repair_manifest_entry b ON b.manifest_id=a.manifest_id AND b.group_id=a.group_id AND b.id>a.id
    WHERE a.manifest_id=p_manifest_id
      AND a.classification IN ('duplicate_survivor','duplicate_retirement')
      AND b.classification IN ('duplicate_survivor','duplicate_retirement')
      AND a.group_id IS NOT NULL
      AND (a.before_state->>'event_id',a.before_state->>'site_number',a.before_state->>'display_label',a.before_state->>'map_x',a.before_state->>'map_y',a.before_state->>'map_image_url')
          IS DISTINCT FROM
          (b.before_state->>'event_id',b.before_state->>'site_number',b.before_state->>'display_label',b.before_state->>'map_x',b.before_state->>'map_y',b.before_state->>'map_image_url')
  ) THEN RAISE EXCEPTION 'Generated group_id collision or malformed mixed group.'; END IF;
  IF EXISTS (
    SELECT 1
    FROM public.parking_repair_manifest m
    LEFT JOIN public.parking_sites ps ON ps.event_id=ANY(m.scope_event_ids)
    LEFT JOIN public.parking_repair_manifest_entry e
      ON e.manifest_id=m.id AND e.parking_site_id=ps.id
    WHERE m.id=p_manifest_id
    GROUP BY ps.id
    HAVING count(e.id)<>1
  ) THEN RAISE EXCEPTION 'Manifest does not represent every scoped parking_sites row exactly once.'; END IF;
  IF EXISTS (
    SELECT 1
    FROM public.parking_repair_manifest_entry e
    LEFT JOIN public.parking_sites ps ON ps.id=e.parking_site_id
    JOIN public.parking_repair_manifest m ON m.id=e.manifest_id
    WHERE e.manifest_id=p_manifest_id
      AND (ps.id IS NULL OR NOT (ps.event_id=ANY(m.scope_event_ids)))
  ) THEN RAISE EXCEPTION 'Manifest entry is missing or outside its Event scope.'; END IF;
  IF EXISTS (
    WITH a AS (
      SELECT * FROM public.analyze_parking_repair_candidates(
        (SELECT scope_event_ids FROM public.parking_repair_manifest WHERE id=p_manifest_id)
      )
    ), e AS (
      SELECT * FROM public.parking_repair_manifest_entry WHERE manifest_id=p_manifest_id
    )
    SELECT 1 FROM e FULL JOIN a ON a.parking_site_id=e.parking_site_id
    WHERE e.id IS NULL OR a.parking_site_id IS NULL
      OR e.classification IS DISTINCT FROM a.classification
      OR e.proposed_action IS DISTINCT FROM a.proposed_action
      OR e.proposed_after_state IS DISTINCT FROM CASE WHEN a.classification='duplicate_survivor' THEN NULL ELSE a.proposed_after_state END
  ) THEN RAISE EXCEPTION 'Manifest entries do not match the current deterministic candidate analysis.'; END IF;
  IF EXISTS (
    SELECT 1
    FROM public.parking_repair_manifest_entry e
    JOIN public.analyze_parking_repair_candidates(
      (SELECT scope_event_ids FROM public.parking_repair_manifest WHERE id=p_manifest_id)
    ) a ON a.parking_site_id=e.parking_site_id
    WHERE e.manifest_id=p_manifest_id
      AND e.post_consolidation_action='direct_repair'
      AND NOT a.post_consolidation_authorized
  ) THEN RAISE EXCEPTION 'Post-consolidation authorization no longer satisfies Repair Plan §10.1.'; END IF;
  IF EXISTS (
    WITH a AS (
      SELECT * FROM public.analyze_parking_repair_candidates(
        (SELECT scope_event_ids FROM public.parking_repair_manifest WHERE id=p_manifest_id)
      )
    ), capable AS (
      SELECT e.id, a.proposed_after_state->>'master_site_id' AS target_master_site_id
      FROM public.parking_repair_manifest_entry e
      JOIN a ON a.parking_site_id=e.parking_site_id
      WHERE e.manifest_id=p_manifest_id
        AND (e.classification='direct_repair'
             OR (e.classification='duplicate_survivor'
                 AND e.post_consolidation_action='direct_repair'))
    )
    SELECT 1 FROM capable
    GROUP BY target_master_site_id
    HAVING target_master_site_id IS NULL OR count(*)>1
  ) THEN RAISE EXCEPTION 'Manifest has missing or competing live-derived Direct Repair targets.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.parking_repair_manifest_entry e
    WHERE e.manifest_id=p_manifest_id AND e.post_consolidation_action IS NOT NULL
      AND (e.classification<>'duplicate_survivor' OR e.group_id IS NULL)
  ) THEN RAISE EXCEPTION 'Post-consolidation authorization is structurally invalid.'; END IF;
END $$;
ALTER FUNCTION public._repair_validate_manifest_structure(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_validate_manifest_structure(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Read-only deterministic classification. group_key is an analysis identity;
-- preparation converts it to a stable UUID only for manifest grouping.
CREATE FUNCTION public.analyze_parking_repair_candidates(p_event_ids uuid[])
RETURNS TABLE(parking_site_id uuid,event_id uuid,classification text,group_key text,proposed_action text,proposed_after_state jsonb,survivor_parking_site_id uuid,before_state jsonb,eligibility_basis text,exclusion_reason text,post_consolidation_authorized boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE v_scope uuid[];
BEGIN
  SELECT array_agg(DISTINCT x.event_id ORDER BY x.event_id) INTO v_scope FROM unnest(p_event_ids) x(event_id) WHERE x.event_id IS NOT NULL;
  IF v_scope IS NULL OR cardinality(v_scope)<>cardinality(p_event_ids) THEN RAISE EXCEPTION 'Explicit nonempty duplicate-free Event scope required.'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_scope) x(event_id) WHERE NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=x.event_id)) THEN RAISE EXCEPTION 'Unknown Event in scope.'; END IF;
  RETURN QUERY WITH s AS (
    SELECT ps.*,to_jsonb(ps) snapshot FROM public.parking_sites ps WHERE ps.event_id=ANY(v_scope)
  ), pg AS (
    SELECT z.event_id,z.site_number,z.display_label,z.map_x,z.map_y,z.map_image_url,count(*) n,
      count(*) FILTER(WHERE z.master_site_id IS NULL) nulls,count(DISTINCT z.master_site_id::text) FILTER(WHERE z.master_site_id IS NOT NULL) ids,
      bool_or(z.assigned_attendee_id IS NOT NULL) occupied,
      bool_and((public._repair_retained_reference_absent(z.id)->>'passed')::boolean) retained_reference_absent,
      min(z.id::text)::uuid survivor
    FROM s z GROUP BY z.event_id,z.site_number,z.display_label,z.map_x,z.map_y,z.map_image_url HAVING count(*)>=2
  ), mg AS (
    SELECT z.event_id,z.site_number,count(DISTINCT ROW(z.display_label,z.map_x,z.map_y,z.map_image_url))>1 meta,
      bool_or(EXISTS(SELECT 1 FROM pg p WHERE p.event_id=z.event_id AND z.site_number IS NOT DISTINCT FROM p.site_number)) has_pg
    FROM s z WHERE z.site_number IS NOT NULL GROUP BY z.event_id,z.site_number HAVING count(*)>=2
  ), c AS (
    SELECT s.*,p.n,p.nulls,p.ids,p.occupied,p.retained_reference_absent,p.survivor,m.meta,m.has_pg
    FROM s LEFT JOIN pg p ON p.event_id=s.event_id AND s.site_number IS NOT DISTINCT FROM p.site_number AND s.display_label IS NOT DISTINCT FROM p.display_label AND s.map_x IS NOT DISTINCT FROM p.map_x AND s.map_y IS NOT DISTINCT FROM p.map_y AND s.map_image_url IS NOT DISTINCT FROM p.map_image_url
    LEFT JOIN mg m ON m.event_id=s.event_id AND m.site_number=s.site_number
  ), d AS (
    SELECT c.id,q.n qn,q.mid,NOT EXISTS(SELECT 1 FROM public.parking_sites o WHERE o.event_id=c.event_id AND o.id<>c.id AND o.master_site_id=q.mid) free
    FROM c CROSS JOIN LATERAL(SELECT count(*) n,min(ms.id::text)::uuid mid FROM public.master_map_sites ms JOIN public.event_map_settings em ON em.selected_master_map_id=ms.master_map_id WHERE em.event_id=c.event_id AND ms.site_number IS NOT DISTINCT FROM c.site_number AND ms.display_label IS NOT DISTINCT FROM c.display_label AND ms.map_x IS NOT DISTINCT FROM c.map_x AND ms.map_y IS NOT DISTINCT FROM c.map_y)q
  ) SELECT c.id,c.event_id,
    CASE WHEN coalesce(c.meta,false) AND coalesce(c.has_pg,false) THEN 'excluded'
      WHEN c.n IS NOT NULL AND NOT(c.nulls=c.n OR(c.nulls=0 AND c.ids=1)) THEN 'identity_conflict'
      WHEN c.n IS NOT NULL AND c.occupied THEN 'occupied_conflict'
      WHEN c.n IS NOT NULL AND NOT coalesce(c.retained_reference_absent,false) THEN 'excluded'
      WHEN c.n IS NOT NULL AND c.id=c.survivor THEN 'duplicate_survivor'
      WHEN c.n IS NOT NULL THEN 'duplicate_retirement'
      WHEN c.meta THEN 'metadata_conflict'
      WHEN c.master_site_id IS NULL AND d.qn=1 AND d.free THEN 'direct_repair' ELSE 'excluded' END,
    CASE WHEN c.meta THEN 'metadata:'||c.event_id::text||':'||c.site_number WHEN c.n IS NOT NULL THEN 'physical:'||c.event_id::text||':'||md5(jsonb_build_array(c.site_number,c.display_label,c.map_x,c.map_y,c.map_image_url)::text) END,
    CASE WHEN c.n IS NOT NULL AND c.id<>c.survivor
                AND c.retained_reference_absent AND NOT c.occupied
                AND (c.nulls=c.n OR (c.nulls=0 AND c.ids=1)) THEN 'retire'
         WHEN c.n IS NULL AND NOT coalesce(c.meta,false) AND c.master_site_id IS NULL AND d.qn=1 AND d.free THEN 'repair_field'
         ELSE 'none' END,
    CASE WHEN c.n IS NULL AND NOT coalesce(c.meta,false) AND c.master_site_id IS NULL AND d.qn=1 AND d.free THEN jsonb_build_object('master_site_id',d.mid) WHEN c.n IS NOT NULL AND c.id=c.survivor AND c.retained_reference_absent AND c.master_site_id IS NULL AND c.nulls=c.n AND NOT c.occupied AND d.qn=1 AND d.free THEN jsonb_build_object('master_site_id',d.mid) END,
    CASE WHEN c.n IS NOT NULL THEN c.survivor END,c.snapshot,
    CASE WHEN c.meta AND c.has_pg THEN 'structural_or_overlapping_group_membership' WHEN c.n IS NOT NULL AND NOT(c.nulls=c.n OR(c.nulls=0 AND c.ids=1)) THEN 'Identity Conflict precedes retained-reference eligibility' WHEN c.n IS NOT NULL AND c.occupied THEN 'Occupied Conflict precedes retained-reference eligibility' WHEN c.n IS NOT NULL AND NOT coalesce(c.retained_reference_absent,false) THEN 'retained_reference_absence_unproven_for_duplicate_group' WHEN c.n IS NOT NULL THEN 'group classification per Repair Plan §6' WHEN c.meta THEN 'exact same-event non-null site_number Metadata Conflict anchor' WHEN c.master_site_id IS NULL AND d.qn=1 AND d.free THEN 'standalone exact selected-map four-field Direct Repair proof' ELSE 'fail_closed' END,
    CASE WHEN c.meta AND c.has_pg THEN 'structural_or_overlapping_group_membership' WHEN c.n IS NOT NULL AND NOT(c.nulls=c.n OR(c.nulls=0 AND c.ids=1)) THEN 'identity_equivalence_not_proven' WHEN c.n IS NOT NULL AND c.occupied THEN 'group_occupied' WHEN c.n IS NOT NULL AND NOT coalesce(c.retained_reference_absent,false) THEN 'retained_reference_exists_or_unproven' WHEN c.n IS NULL AND NOT coalesce(c.meta,false) THEN CASE WHEN c.master_site_id IS NOT NULL THEN 'master_site_id_not_null' WHEN d.qn=0 THEN 'no_selected_map_match' WHEN d.qn>1 THEN 'multiple_selected_map_matches' ELSE 'master_site_id_already_claimed' END END,
    (c.n IS NOT NULL AND c.id=c.survivor AND c.retained_reference_absent AND c.master_site_id IS NULL AND c.nulls=c.n AND NOT c.occupied AND d.qn=1 AND d.free)
  FROM c LEFT JOIN d ON d.id=c.id ORDER BY c.event_id,c.id;
END $$;
ALTER FUNCTION public.analyze_parking_repair_candidates(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.analyze_parking_repair_candidates(uuid[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.prepare_parking_repair_manifest(p_event_ids uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE m uuid; n_rows integer; n_entries integer;
BEGIN
  LOCK TABLE public.parking_sites,public.master_map_sites,public.event_map_settings IN SHARE MODE;
  INSERT INTO public.parking_repair_manifest(scope_event_ids,frozen_snapshot_taken_at)
  SELECT array_agg(DISTINCT x ORDER BY x),clock_timestamp() FROM unnest(p_event_ids)x RETURNING id INTO m;
  IF m IS NULL THEN RAISE EXCEPTION 'Draft creation requires Event scope.'; END IF;
  INSERT INTO public.parking_repair_manifest_entry(manifest_id,classification,group_id,parking_site_id,before_state,proposed_action,proposed_after_state,eligibility_basis,exclusion_reason,post_consolidation_action)
  SELECT m,a.classification,CASE WHEN a.group_key IS NULL THEN NULL ELSE (substr(md5(a.group_key),1,8)||'-'||substr(md5(a.group_key),9,4)||'-'||substr(md5(a.group_key),13,4)||'-'||substr(md5(a.group_key),17,4)||'-'||substr(md5(a.group_key),21,12))::uuid END,a.parking_site_id,a.before_state,a.proposed_action,CASE WHEN a.classification='duplicate_survivor' THEN NULL ELSE a.proposed_after_state END,a.eligibility_basis,a.exclusion_reason,NULL
  FROM public.analyze_parking_repair_candidates(p_event_ids)a WHERE a.classification<>'duplicate_retirement';
  INSERT INTO public.parking_repair_manifest_entry(manifest_id,classification,group_id,parking_site_id,before_state,proposed_action,survivor_entry_id,eligibility_basis,exclusion_reason)
  SELECT m,a.classification,s.group_id,a.parking_site_id,a.before_state,a.proposed_action,s.id,a.eligibility_basis,a.exclusion_reason
  FROM public.analyze_parking_repair_candidates(p_event_ids)a JOIN public.parking_repair_manifest_entry s ON s.manifest_id=m AND s.parking_site_id=a.survivor_parking_site_id AND s.classification='duplicate_survivor' WHERE a.classification='duplicate_retirement';
  UPDATE public.parking_repair_manifest_entry e SET post_consolidation_action='direct_repair'
  FROM public.analyze_parking_repair_candidates(p_event_ids) a
  WHERE e.manifest_id=m AND e.parking_site_id=a.parking_site_id AND e.classification='duplicate_survivor'
    AND a.post_consolidation_authorized;
  SELECT count(*) INTO n_rows FROM public.parking_sites WHERE event_id=ANY(p_event_ids);
  SELECT count(DISTINCT parking_site_id) INTO n_entries FROM public.parking_repair_manifest_entry WHERE manifest_id=m;
  IF n_rows=0 OR n_rows<>n_entries THEN RAISE EXCEPTION 'Candidate analysis incomplete; draft rejected.'; END IF;
  PERFORM public._repair_validate_manifest_structure(m);
  RETURN m;
END $$;
ALTER FUNCTION public.prepare_parking_repair_manifest(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prepare_parking_repair_manifest(uuid[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.review_parking_repair_manifest(p_manifest_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO pg_catalog STABLE AS $$
 SELECT jsonb_build_object('manifest_id',m.id,'status',m.status,'scope_event_ids',m.scope_event_ids,'rows_examined',(SELECT count(*) FROM public.parking_repair_manifest_entry e WHERE e.manifest_id=m.id),'summary',(SELECT coalesce(jsonb_object_agg(classification,n),'{}'::jsonb) FROM(SELECT classification,count(*)n FROM public.parking_repair_manifest_entry WHERE manifest_id=m.id GROUP BY classification)x),'entries',(SELECT coalesce(jsonb_agg(jsonb_build_object('entry_id',e.id,'parking_site_id',e.parking_site_id,'classification',e.classification,'group_id',e.group_id,'survivor_entry_id',e.survivor_entry_id,'proposed_action',e.proposed_action,'post_consolidation_action',e.post_consolidation_action,'proposed_after_state',e.proposed_after_state,'before_state',e.before_state,'eligibility_basis',e.eligibility_basis,'exclusion_reason',e.exclusion_reason) ORDER BY e.group_id NULLS LAST,e.id),'[]'::jsonb) FROM public.parking_repair_manifest_entry e WHERE e.manifest_id=m.id)) FROM public.parking_repair_manifest m WHERE m.id=p_manifest_id;
$$;
ALTER FUNCTION public.review_parking_repair_manifest(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.review_parking_repair_manifest(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.approve_parking_repair_manifest(p_manifest_id uuid,p_approved_by text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE m public.parking_repair_manifest%ROWTYPE;
BEGIN
 IF nullif(btrim(p_approved_by),'') IS NULL THEN RAISE EXCEPTION 'External approval reference required.'; END IF;
 SELECT * INTO m FROM public.parking_repair_manifest WHERE id=p_manifest_id FOR UPDATE;
 IF NOT FOUND OR m.status<>'draft' THEN RAISE EXCEPTION 'Only a draft manifest may be approved.'; END IF;
 PERFORM public._repair_validate_manifest_structure(p_manifest_id);
 IF EXISTS(SELECT 1 FROM public.parking_repair_manifest_entry e LEFT JOIN public.parking_sites ps ON ps.id=e.parking_site_id WHERE e.manifest_id=p_manifest_id AND(ps.id IS NULL OR to_jsonb(ps) IS DISTINCT FROM e.before_state)) THEN RAISE EXCEPTION 'Draft drifted; create a new reviewed draft.'; END IF;
 UPDATE public.parking_repair_manifest SET status='approved',approved_at=clock_timestamp(),approved_by=btrim(p_approved_by) WHERE id=p_manifest_id;
END $$;
ALTER FUNCTION public.approve_parking_repair_manifest(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_parking_repair_manifest(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- Strengthen §10.1 sibling proof with both group identity and the explicit
-- retirement-to-survivor link. No mutation/revalidation semantics change.
CREATE OR REPLACE FUNCTION public._repair_apply_post_consolidation_survivor(p_entry public.parking_repair_manifest_entry,p_execution_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE expected_count integer; applied_count integer; state jsonb;
BEGIN
 IF p_entry.classification<>'duplicate_survivor' OR p_entry.post_consolidation_action<>'direct_repair' OR p_entry.group_id IS NULL THEN RAISE EXCEPTION 'Invalid post-consolidation entry %',p_entry.id; END IF;
 SELECT count(*) INTO expected_count FROM public.parking_repair_manifest_entry r WHERE r.manifest_id=p_entry.manifest_id AND r.group_id=p_entry.group_id AND r.classification='duplicate_retirement' AND r.survivor_entry_id=p_entry.id;
 SELECT count(DISTINCT r.id) INTO applied_count FROM public.parking_repair_manifest_entry r JOIN public.parking_repair_audit a ON a.manifest_entry_id=r.id AND a.execution_id=p_execution_id AND a.action_taken='retirement_applied' WHERE r.manifest_id=p_entry.manifest_id AND r.group_id=p_entry.group_id AND r.classification='duplicate_retirement' AND r.survivor_entry_id=p_entry.id;
 IF expected_count=0 OR applied_count<>expected_count THEN SELECT to_jsonb(ps) INTO state FROM public.parking_sites ps WHERE ps.id=p_entry.parking_site_id; INSERT INTO public.parking_repair_audit(execution_id,manifest_entry_id,action_taken,before_state,revalidation_result,actor_identity) VALUES(p_execution_id,p_entry.id,'post_consolidation_not_attempted',coalesce(state,p_entry.before_state),jsonb_build_object('passed',false,'reason','sibling_retirements_not_all_applied','expected_sibling_retirements',expected_count,'retirement_applied_siblings',applied_count),current_user||'/'||session_user); RETURN; END IF;
 PERFORM public._repair_apply_direct_repair(p_entry,p_execution_id);
END $$;
ALTER FUNCTION public._repair_apply_post_consolidation_survivor(public.parking_repair_manifest_entry,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_apply_post_consolidation_survivor(public.parking_repair_manifest_entry,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- The Deterministic Survivor Rule itself requires every member to remain
-- unretained. Recheck the preserved survivor under the row locks acquired by
-- the existing retirement revalidation immediately before its sibling can be
-- retired. A failed or unproven check records an exclusion and never deletes.
CREATE OR REPLACE FUNCTION public._repair_apply_duplicate_retirement(
  p_entry public.parking_repair_manifest_entry,
  p_survivor_parking_site_id uuid,
  p_execution_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE v_revalidation jsonb; v_survivor_reference jsonb;
BEGIN
  v_revalidation := public._repair_revalidate_duplicate_retirement(
    p_entry.parking_site_id, p_survivor_parking_site_id
  );
  IF (v_revalidation->>'passed')::boolean THEN
    v_survivor_reference := public._repair_retained_reference_absent(p_survivor_parking_site_id);
    IF NOT coalesce((v_survivor_reference->>'passed')::boolean,false) THEN
      INSERT INTO public.parking_repair_audit(
        execution_id,manifest_entry_id,action_taken,before_state,revalidation_result,actor_identity
      ) VALUES (
        p_execution_id,p_entry.id,'revalidation_failed_excluded',
        coalesce(v_revalidation->'current_state',p_entry.before_state),
        jsonb_build_object('passed',false,'reason','survivor_retained_reference_exists_or_unproven',
                           'survivor_retained_reference',v_survivor_reference,
                           'current_state',v_revalidation->'current_state',
                           'survivor_state',v_revalidation->'survivor_state'),
        current_user||'/'||session_user
      );
      RETURN;
    END IF;
    INSERT INTO public.parking_repair_audit(
      execution_id,manifest_entry_id,action_taken,before_state,after_state,
      revalidation_result,actor_identity,validation_assertions_passed
    ) VALUES (
      p_execution_id,p_entry.id,'retirement_applied',
      v_revalidation->'current_state','null'::jsonb,
      v_revalidation || jsonb_build_object('survivor_retained_reference_absent',true),
      current_user||'/'||session_user,
      ARRAY['vacant','no_retained_reference','physically_equivalent',
            'identity_equivalent','survivor_preserved','survivor_unretained']
    );
    PERFORM set_config('epicentrax.parking_repair_bypass_authorized','true',true);
    DELETE FROM public.parking_sites WHERE id=p_entry.parking_site_id;
  ELSE
    INSERT INTO public.parking_repair_audit(
      execution_id,manifest_entry_id,action_taken,before_state,revalidation_result,actor_identity
    ) VALUES (
      p_execution_id,p_entry.id,'revalidation_failed_excluded',
      coalesce(v_revalidation->'current_state',p_entry.before_state),v_revalidation,
      current_user||'/'||session_user
    );
  END IF;
END $$;
ALTER FUNCTION public._repair_apply_duplicate_retirement(public.parking_repair_manifest_entry,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._repair_apply_duplicate_retirement(public.parking_repair_manifest_entry,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
