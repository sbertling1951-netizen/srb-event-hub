-- Repair forward: 20260813170000 (Lifecycle Mutation Enforcement Pilot)
-- re-created create/update/delete_event_agenda_item by rebasing onto the
-- ORIGINAL 20260811310000 function bodies instead of the already-fixed
-- 20260811320000 versions, silently reintroducing the exact bug 320000
-- had already repaired: each function inserted its agenda_command_ledger
-- row via _agenda_ledger_log(), then ran a follow-up
-- `UPDATE agenda_command_ledger SET agenda_item_id = ...` to stamp the
-- item id on afterward. agenda_command_ledger's own immutability trigger
-- (20260811290000) fires BEFORE UPDATE OR DELETE on every row
-- unconditionally and rejects that follow-up UPDATE outright, so every
-- call to any of these three RPCs failed with "agenda command ledger
-- entries are immutable" -- confirmed live via pg_get_functiondef against
-- the linked project before this fix, and reproduced identically for
-- every Event (the trigger has no event-scoped or data-dependent
-- condition; nothing about Branson specifically was involved). Because
-- the RAISE EXCEPTION is never caught, the whole function invocation's
-- transaction rolled back atomically every time -- the preceding
-- agenda_items INSERT and the agenda_items_state version advance were
-- always undone with it, so no Event was ever left with a partially
-- created agenda item or an orphaned ledger row from this failure
-- (verified: zero agenda_items rows exist for Branson).
--
-- This migration reapplies 320000's already-proven fix (write
-- agenda_item_id directly in the ledger row's initial INSERT, bypassing
-- _agenda_ledger_log for these three functions only, exactly as 320000
-- did -- that helper has no agenda_item_id parameter and is intentionally
-- not modified) on top of 20260813170000's actual new capability, the
-- assert_event_lifecycle_mutable() guard call, which is real and is kept
-- exactly where 20260813170000 placed it (after has_event_task_authority,
-- before any other post-authority logic). No other behavior changes:
-- same authority check, same Event-scope resolution, same validation,
-- same version/concurrency handling, same error codes, same ledger
-- action/outcome values, same RLS/grants. reorder_event_agenda_items and
-- import_event_agenda_items already write their ledger row with a single
-- PERFORM/no follow-up UPDATE and were never affected -- not touched
-- here.
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

  PERFORM public.assert_event_lifecycle_mutable(p_event_id);

  IF NOT EXISTS (SELECT 1 FROM public.events AS e WHERE e.id = p_event_id) THEN
    RAISE EXCEPTION 'wrong_event';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'malformed_row';
  END IF;

  IF p_start_time IS NULL THEN
    RAISE EXCEPTION 'malformed_row';
  END IF;

  -- create has no prior state to conflict with -- concurrency is
  -- intentionally not required here (see report Stage 5 justification).
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

  -- Event scope is derived from the existing row, never accepted as a
  -- parameter -- structurally prevents moving an item across Events.
  SELECT ai.event_id INTO v_event_id FROM public.agenda_items AS ai WHERE ai.id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found';
  END IF;

  IF NOT public.has_event_task_authority('event.agenda.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

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

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

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

-- Grants are unaffected by CREATE OR REPLACE (ACLs are preserved across
-- a function body replacement), but reasserted explicitly here to match
-- this codebase's established convention of every migration that touches
-- a governed RPC's body also re-stating its own grant.
REVOKE ALL ON FUNCTION public.create_event_agenda_item(
  uuid, text, text, text, text, text, text, date, time, time, boolean, integer, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_event_agenda_item(
  uuid, text, text, text, text, text, text, date, time, time, boolean, integer, text
) TO authenticated;

REVOKE ALL ON FUNCTION public.update_event_agenda_item(
  uuid, integer, text, text, text, text, text, text, date, time, time, boolean, integer
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_event_agenda_item(
  uuid, integer, text, text, text, text, text, text, date, time, time, boolean, integer
) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_event_agenda_item(uuid, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_event_agenda_item(uuid, integer) TO authenticated;

COMMIT;
