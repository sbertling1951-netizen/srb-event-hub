-- Repair forward: save_event_agenda_as_tenant_template (20260811290000)
-- inserted every derived agenda_template_revision_sections row with a
-- hardcoded sort_order of 0, violating
-- agenda_template_revision_sections_revision_sort_unique whenever an
-- Event's agenda spans more than one distinct category. Assign each
-- section an incrementing sort_order instead. No other behavior changes.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_event_agenda_as_tenant_template(
  p_event_id uuid, p_title text, p_description text, p_publish boolean DEFAULT false,
  p_idempotency_key uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_item_count integer;
  v_new_root_id uuid;
  v_new_revision_id uuid;
  v_fingerprint text;
  v_prior record;
  v_category text;
  v_new_section_id uuid;
  v_section_sort_order integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.agenda.manage', p_event_id) THEN
    RAISE EXCEPTION 'unauthorized_event_agenda';
  END IF;

  SELECT e.tenant_id INTO v_tenant_id FROM public.events AS e WHERE e.id = p_event_id;
  IF NOT FOUND OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'wrong_event';
  END IF;

  IF NOT public.has_tenant_agenda_template_authority(v_tenant_id) THEN
    RAISE EXCEPTION 'unauthorized_tenant_template';
  END IF;

  PERFORM 1 FROM public.event_agenda_state WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.event_agenda_state(event_id, version) VALUES (p_event_id, 0)
    ON CONFLICT (event_id) DO NOTHING;
    PERFORM 1 FROM public.event_agenda_state WHERE event_id = p_event_id FOR UPDATE;
  END IF;

  v_fingerprint := md5(p_event_id::text || '|' || coalesce(p_title, '') || '|' || coalesce(p_description, '') || '|' || coalesce(p_publish::text, ''));

  SELECT l.template_root_id, l.request_fingerprint INTO v_prior
  FROM public.agenda_command_ledger AS l
  WHERE l.action = 'event_agenda_saved_as_template' AND l.actor_auth_user_id = v_actor AND l.idempotency_key = p_idempotency_key
  ORDER BY l.occurred_at DESC LIMIT 1;

  IF FOUND THEN
    IF v_prior.request_fingerprint = v_fingerprint THEN
      RETURN v_prior.template_root_id;
    ELSE
      RAISE EXCEPTION 'duplicate_idempotency_key_conflict';
    END IF;
  END IF;

  SELECT count(*) INTO v_item_count FROM public.agenda_items AS ai WHERE ai.event_id = p_event_id;
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'empty_source_agenda';
  END IF;

  INSERT INTO public.agenda_template_roots(scope, tenant_id, title, description, created_by_auth_user_id)
  VALUES ('tenant', v_tenant_id, p_title, p_description, v_actor)
  RETURNING id INTO v_new_root_id;

  INSERT INTO public.agenda_template_revisions(template_root_id, revision_number, revision_status, created_by_auth_user_id)
  VALUES (v_new_root_id, 1, 'draft', v_actor)
  RETURNING id INTO v_new_revision_id;

  FOR v_category IN
    SELECT DISTINCT ai.category FROM public.agenda_items AS ai
    WHERE ai.event_id = p_event_id AND ai.category IS NOT NULL
  LOOP
    v_section_sort_order := v_section_sort_order + 1;

    INSERT INTO public.agenda_template_revision_sections(revision_id, title, sort_order, created_by_auth_user_id)
    VALUES (v_new_revision_id, v_category, v_section_sort_order, v_actor)
    RETURNING id INTO v_new_section_id;

    INSERT INTO public.agenda_template_revision_items(
      revision_id, section_id, title, description, location, speaker, category, color,
      start_time, end_time, is_published, sort_order, external_id, created_by_auth_user_id
    )
    SELECT v_new_revision_id, v_new_section_id, ai.title, ai.description, ai.location, ai.speaker, ai.category, ai.color,
           ai.start_time, ai.end_time, coalesce(ai.is_published, true), coalesce(ai.sort_order, 0), ai.external_id, v_actor
    FROM public.agenda_items AS ai
    WHERE ai.event_id = p_event_id AND ai.category = v_category;
  END LOOP;

  INSERT INTO public.agenda_template_revision_items(
    revision_id, section_id, title, description, location, speaker, category, color,
    start_time, end_time, is_published, sort_order, external_id, created_by_auth_user_id
  )
  SELECT v_new_revision_id, NULL, ai.title, ai.description, ai.location, ai.speaker, ai.category, ai.color,
         ai.start_time, ai.end_time, coalesce(ai.is_published, true), coalesce(ai.sort_order, 0), ai.external_id, v_actor
  FROM public.agenda_items AS ai
  WHERE ai.event_id = p_event_id AND ai.category IS NULL;

  INSERT INTO public.agenda_template_derivations(
    derived_template_root_id, derived_revision_id, source_event_id, derivation_type, actor_auth_user_id, reason
  ) VALUES (
    v_new_root_id, v_new_revision_id, p_event_id, 'event_agenda_to_tenant_template', v_actor, NULL
  );

  PERFORM public._agenda_ledger_log(
    'event_agenda_saved_as_template', v_actor, 'compound', 'tenant.agenda_templates.manage',
    v_tenant_id, p_event_id, v_new_root_id, v_new_revision_id, NULL, p_idempotency_key, v_fingerprint,
    gen_random_uuid(), NULL, jsonb_build_object('new_root_id', v_new_root_id, 'item_count', v_item_count), NULL
  );

  IF p_publish THEN
    PERFORM public.publish_agenda_template_revision(v_new_revision_id, 'published on save-as-template');
  END IF;

  RETURN v_new_root_id;
END;
$$;

COMMIT;
