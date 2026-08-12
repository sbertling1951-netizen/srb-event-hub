-- Repair forward: create/update/delete_event_agenda_item (20260811310000)
-- attempted to stamp agenda_item_id onto the just-inserted ledger row via
-- a follow-up UPDATE. agenda_command_ledger's own immutability trigger
-- (added in 20260811290000) correctly rejects ANY UPDATE, including this
-- same-transaction follow-up, causing every one of these three RPCs to
-- fail with "agenda command ledger entries are immutable" instead of
-- succeeding. Fixed by writing agenda_item_id directly in the initial
-- INSERT (bypassing the shared _agenda_ledger_log helper, which has no
-- agenda_item_id parameter and is not modified here) rather than
-- patching it in afterward. No other behavior changes.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_event_agenda_item(
  p_event_id uuid, p_title text, p_description text DEFAULT NULL, p_location text DEFAULT NULL,
  p_speaker text DEFAULT NULL, p_category text DEFAULT NULL, p_color text DEFAULT NULL,
  p_agenda_date date DEFAULT NULL, p_start_time time DEFAULT NULL, p_end_time time DEFAULT NULL,
  p_is_published boolean DEFAULT true, p_sort_order integer DEFAULT NULL, p_external_id text DEFAULT NULL
)
RETURNS TABLE(item public.agenda_items, new_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_item public.agenda_items%ROWTYPE;
  v_new_version integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.agenda.manage', p_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.events AS e WHERE e.id = p_event_id) THEN
    RAISE EXCEPTION 'wrong_event';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'malformed_row';
  END IF;

  IF p_start_time IS NULL THEN
    RAISE EXCEPTION 'malformed_row';
  END IF;

  v_new_version := public._agenda_event_version_advance(p_event_id, NULL);

  INSERT INTO public.agenda_items(
    event_id, title, description, location, speaker, category, color,
    agenda_date, start_time, end_time, is_published, sort_order, external_id, source
  ) VALUES (
    p_event_id, p_title, p_description, p_location, p_speaker, p_category, p_color,
    p_agenda_date, p_start_time, p_end_time, coalesce(p_is_published, true), p_sort_order, p_external_id, 'manual'
  ) RETURNING * INTO v_item;

  INSERT INTO public.agenda_command_ledger(
    action, actor_auth_user_id, resolved_authority_branch, task_key, event_id,
    agenda_item_id, correlation_id, after_state, outcome
  ) VALUES (
    'event_agenda_item_created', v_actor, 'event', 'event.agenda.manage', p_event_id,
    v_item.id, gen_random_uuid(), to_jsonb(v_item), 'success'
  );

  RETURN QUERY SELECT v_item, v_new_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_event_agenda_item(
  p_item_id uuid, p_expected_agenda_version integer,
  p_title text, p_description text DEFAULT NULL, p_location text DEFAULT NULL,
  p_speaker text DEFAULT NULL, p_category text DEFAULT NULL, p_color text DEFAULT NULL,
  p_agenda_date date DEFAULT NULL, p_start_time time DEFAULT NULL, p_end_time time DEFAULT NULL,
  p_is_published boolean DEFAULT true, p_sort_order integer DEFAULT NULL
)
RETURNS TABLE(item public.agenda_items, new_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event_id uuid;
  v_item public.agenda_items%ROWTYPE;
  v_new_version integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT ai.event_id INTO v_event_id FROM public.agenda_items AS ai WHERE ai.id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found';
  END IF;

  IF NOT public.has_event_task_authority('event.agenda.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'malformed_row';
  END IF;

  IF p_start_time IS NULL THEN
    RAISE EXCEPTION 'malformed_row';
  END IF;

  v_new_version := public._agenda_event_version_advance(v_event_id, p_expected_agenda_version);

  UPDATE public.agenda_items AS ai
  SET title = p_title, description = p_description, location = p_location, speaker = p_speaker,
      category = p_category, color = p_color, agenda_date = p_agenda_date, start_time = p_start_time,
      end_time = p_end_time, is_published = coalesce(p_is_published, true), sort_order = p_sort_order
  WHERE ai.id = p_item_id
  RETURNING * INTO v_item;

  INSERT INTO public.agenda_command_ledger(
    action, actor_auth_user_id, resolved_authority_branch, task_key, event_id,
    agenda_item_id, correlation_id, after_state, outcome
  ) VALUES (
    'event_agenda_item_updated', v_actor, 'event', 'event.agenda.manage', v_event_id,
    p_item_id, gen_random_uuid(), to_jsonb(v_item), 'success'
  );

  RETURN QUERY SELECT v_item, v_new_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_event_agenda_item(
  p_item_id uuid, p_expected_agenda_version integer
)
RETURNS TABLE(deleted_id uuid, new_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event_id uuid;
  v_new_version integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT ai.event_id INTO v_event_id FROM public.agenda_items AS ai WHERE ai.id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found';
  END IF;

  IF NOT public.has_event_task_authority('event.agenda.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  v_new_version := public._agenda_event_version_advance(v_event_id, p_expected_agenda_version);

  DELETE FROM public.agenda_items AS ai WHERE ai.id = p_item_id;

  INSERT INTO public.agenda_command_ledger(
    action, actor_auth_user_id, resolved_authority_branch, task_key, event_id,
    agenda_item_id, correlation_id, outcome
  ) VALUES (
    'event_agenda_item_deleted', v_actor, 'event', 'event.agenda.manage', v_event_id,
    p_item_id, gen_random_uuid(), 'success'
  );

  RETURN QUERY SELECT p_item_id, v_new_version;
END;
$$;

COMMIT;
