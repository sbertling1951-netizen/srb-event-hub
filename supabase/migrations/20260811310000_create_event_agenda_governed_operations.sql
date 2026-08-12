-- Governed Event Agenda manual CRUD/reorder/import operations, plus a
-- forward repair to template apply/replace's external_id handling. This
-- migration is additive/repair-forward only -- it does NOT touch
-- agenda_items RLS/ACL (that closure lands in a later migration, only
-- after these RPCs are validated, per governing sequencing).
BEGIN;

-- ============================================================
-- Command-ledger taxonomy extension (deliberate, not overload -- see
-- report: existing generic columns (event_id, actor, task_key,
-- before/after_state, correlation_id) already fit Event Agenda item
-- mutations; only a precise item-reference column is added).
-- ============================================================

ALTER TABLE public.agenda_command_ledger
  ADD COLUMN agenda_item_id uuid;
-- No FK: a 'deleted' entry must be able to reference an item id that no
-- longer exists in agenda_items by the time the ledger row is written.

ALTER TABLE public.agenda_command_ledger
  DROP CONSTRAINT agenda_command_ledger_action_check;

ALTER TABLE public.agenda_command_ledger
  ADD CONSTRAINT agenda_command_ledger_action_check CHECK (action IN (
    'root_created', 'revision_created', 'revision_published', 'revision_superseded',
    'root_archived', 'template_duplicated', 'template_promoted',
    'event_agenda_saved_as_template', 'template_applied', 'agenda_replaced',
    'revision_content_edited',
    'event_agenda_item_created', 'event_agenda_item_updated', 'event_agenda_item_deleted',
    'event_agenda_items_reordered', 'event_agenda_items_imported'
  ));

-- ============================================================
-- Internal helper: lock the Event's agenda-state row (self-healing if
-- missing), optionally require an exact expected version, advance by
-- exactly one, and return the new version. Shared by every mutating RPC
-- below. p_expected_version = NULL means "no concurrency check" (used
-- only by create, per the documented contract).
-- ============================================================

CREATE OR REPLACE FUNCTION public._agenda_event_version_advance(
  p_event_id uuid, p_expected_version integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_current integer;
BEGIN
  PERFORM 1 FROM public.event_agenda_state WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.event_agenda_state(event_id, version) VALUES (p_event_id, 0)
    ON CONFLICT (event_id) DO NOTHING;
    PERFORM 1 FROM public.event_agenda_state WHERE event_id = p_event_id FOR UPDATE;
  END IF;

  SELECT s.version INTO v_current FROM public.event_agenda_state AS s WHERE s.event_id = p_event_id;

  IF p_expected_version IS NOT NULL AND v_current <> p_expected_version THEN
    RAISE EXCEPTION 'stale_agenda_version';
  END IF;

  UPDATE public.event_agenda_state AS s
  SET version = v_current + 1, updated_at = now()
  WHERE s.event_id = p_event_id;

  RETURN v_current + 1;
END;
$$;

REVOKE ALL ON FUNCTION public._agenda_event_version_advance(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- Create
-- ============================================================

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
  v_command_id uuid;
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

  SELECT public._agenda_ledger_log(
    'event_agenda_item_created', v_actor, 'event', 'event.agenda.manage',
    NULL, p_event_id, NULL, NULL, NULL, NULL, NULL,
    gen_random_uuid(), NULL, to_jsonb(v_item), NULL
  ) INTO v_command_id;
  UPDATE public.agenda_command_ledger SET agenda_item_id = v_item.id WHERE command_id = v_command_id;

  RETURN QUERY SELECT v_item, v_new_version;
END;
$$;

-- ============================================================
-- Update
-- ============================================================

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
  v_command_id uuid;
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

  SELECT public._agenda_ledger_log(
    'event_agenda_item_updated', v_actor, 'event', 'event.agenda.manage',
    NULL, v_event_id, NULL, NULL, NULL, NULL, NULL,
    gen_random_uuid(), NULL, to_jsonb(v_item), NULL
  ) INTO v_command_id;
  UPDATE public.agenda_command_ledger SET agenda_item_id = p_item_id WHERE command_id = v_command_id;

  RETURN QUERY SELECT v_item, v_new_version;
END;
$$;

-- ============================================================
-- Delete
-- ============================================================

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
  v_command_id uuid;
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

  SELECT public._agenda_ledger_log(
    'event_agenda_item_deleted', v_actor, 'event', 'event.agenda.manage',
    NULL, v_event_id, NULL, NULL, NULL, NULL, NULL,
    gen_random_uuid(), NULL, NULL, NULL
  ) INTO v_command_id;
  UPDATE public.agenda_command_ledger SET agenda_item_id = p_item_id WHERE command_id = v_command_id;

  RETURN QUERY SELECT p_item_id, v_new_version;
END;
$$;

-- ============================================================
-- Reorder (single atomic command over a batch)
-- p_item_orders: jsonb array of {"id": uuid, "sort_order": integer}
-- ============================================================

CREATE OR REPLACE FUNCTION public.reorder_event_agenda_items(
  p_event_id uuid, p_expected_agenda_version integer, p_item_orders jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_new_version integer;
  v_supplied_count integer;
  v_distinct_count integer;
  v_matching_count integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.agenda.manage', p_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT count(*) INTO v_supplied_count FROM jsonb_array_elements(p_item_orders);
  IF v_supplied_count = 0 THEN
    RAISE EXCEPTION 'malformed_row';
  END IF;

  SELECT count(DISTINCT (elem ->> 'id')) INTO v_distinct_count
  FROM jsonb_array_elements(p_item_orders) AS elem;
  IF v_distinct_count <> v_supplied_count THEN
    RAISE EXCEPTION 'duplicate_item_id';
  END IF;

  SELECT count(*) INTO v_matching_count
  FROM jsonb_array_elements(p_item_orders) AS elem
  JOIN public.agenda_items AS ai ON ai.id = (elem ->> 'id')::uuid AND ai.event_id = p_event_id;
  IF v_matching_count <> v_supplied_count THEN
    RAISE EXCEPTION 'foreign_or_missing_item';
  END IF;

  v_new_version := public._agenda_event_version_advance(p_event_id, p_expected_agenda_version);

  UPDATE public.agenda_items AS ai
  SET sort_order = (elem.value ->> 'sort_order')::integer
  FROM jsonb_array_elements(p_item_orders) AS elem
  WHERE ai.id = (elem.value ->> 'id')::uuid AND ai.event_id = p_event_id;

  PERFORM public._agenda_ledger_log(
    'event_agenda_items_reordered', v_actor, 'event', 'event.agenda.manage',
    NULL, p_event_id, NULL, NULL, NULL, NULL, NULL,
    gen_random_uuid(), NULL, jsonb_build_object('item_count', v_supplied_count), NULL
  );

  RETURN v_new_version;
END;
$$;

-- ============================================================
-- Bulk import -- governed contract:
--   * upsert identity is (event_id, external_id), matching both existing
--     browser implementations, explicitly selected (not inherited by
--     accident) -- see report Stage 7/8.
--   * rows with no external_id always insert as new (never matched
--     against any existing row), consistent with the partial unique
--     index's own semantics (WHERE external_id IS NOT NULL).
--   * all-or-nothing: every row is structurally validated before any
--     write; a single malformed row fails the whole batch.
-- p_rows: jsonb array of row objects, same field shape as create.
-- ============================================================

CREATE OR REPLACE FUNCTION public.import_event_agenda_items(
  p_event_id uuid, p_expected_agenda_version integer, p_rows jsonb
)
RETURNS TABLE(imported_count integer, new_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_new_version integer;
  v_row_count integer;
  v_imported integer;
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

  SELECT count(*) INTO v_row_count FROM jsonb_array_elements(p_rows);
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'malformed_row';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) AS elem
    WHERE coalesce(btrim(elem ->> 'title'), '') = '' OR (elem ->> 'start_time') IS NULL
  ) THEN
    RAISE EXCEPTION 'malformed_row';
  END IF;

  v_new_version := public._agenda_event_version_advance(p_event_id, p_expected_agenda_version);

  WITH incoming AS (
    SELECT
      p_event_id AS event_id,
      elem ->> 'title' AS title,
      elem ->> 'description' AS description,
      elem ->> 'location' AS location,
      elem ->> 'speaker' AS speaker,
      elem ->> 'category' AS category,
      elem ->> 'color' AS color,
      nullif(elem ->> 'agenda_date', '')::date AS agenda_date,
      (elem ->> 'start_time')::time AS start_time,
      nullif(elem ->> 'end_time', '')::time AS end_time,
      coalesce((elem ->> 'is_published')::boolean, true) AS is_published,
      nullif(elem ->> 'sort_order', '')::integer AS sort_order,
      nullif(elem ->> 'external_id', '') AS external_id
    FROM jsonb_array_elements(p_rows) AS elem
  )
  INSERT INTO public.agenda_items(
    event_id, title, description, location, speaker, category, color,
    agenda_date, start_time, end_time, is_published, sort_order, external_id, source
  )
  SELECT event_id, title, description, location, speaker, category, color,
         agenda_date, start_time, end_time, is_published, sort_order, external_id, 'import'
  FROM incoming
  ON CONFLICT (event_id, external_id) WHERE external_id IS NOT NULL
  DO UPDATE SET
    title = EXCLUDED.title, description = EXCLUDED.description, location = EXCLUDED.location,
    speaker = EXCLUDED.speaker, category = EXCLUDED.category, color = EXCLUDED.color,
    agenda_date = EXCLUDED.agenda_date, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
    is_published = EXCLUDED.is_published, sort_order = EXCLUDED.sort_order, source = 'import';

  GET DIAGNOSTICS v_imported = ROW_COUNT;

  PERFORM public._agenda_ledger_log(
    'event_agenda_items_imported', v_actor, 'event', 'event.agenda.manage',
    NULL, p_event_id, NULL, NULL, NULL, NULL, NULL,
    gen_random_uuid(), NULL, jsonb_build_object('row_count', v_imported), NULL
  );

  RETURN QUERY SELECT v_imported, v_new_version;
END;
$$;

-- ============================================================
-- Stage 8 repair-forward: template-derived copies must not inherit the
-- source template item's external_id. external_id is an Event-scoped,
-- import-retry identity (event_id, external_id) -- it has no meaning
-- across Events, and copying it verbatim risks colliding with an
-- unrelated import-sourced row already present in the target Event
-- (identified by this assignment's audit). Template-derived rows already
-- carry strictly superior lineage via template_application_id /
-- source_template_revision_id / source_template_item_id, so external_id
-- is set to NULL on every copy. This is the only functional change to
-- the previously-shipped apply/replace behavior.
-- ============================================================

CREATE OR REPLACE FUNCTION public._agenda_apply_copy_items(
  p_event_id uuid, p_application_id uuid, p_source_revision_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_start_date date;
  v_copied integer;
BEGIN
  SELECT e.start_date INTO v_event_start_date FROM public.events AS e WHERE e.id = p_event_id;

  INSERT INTO public.agenda_items(
    event_id, title, description, location, category, color, agenda_date, start_time, end_time,
    sort_order, is_published, speaker, external_id, source,
    template_application_id, source_template_revision_id, source_template_item_id
  )
  SELECT
    p_event_id, it.title, it.description, it.location, it.category, it.color,
    CASE WHEN it.agenda_day_offset IS NULL OR v_event_start_date IS NULL THEN NULL
         ELSE v_event_start_date + (it.agenda_day_offset * interval '1 day') END,
    coalesce(it.start_time, '00:00:00'::time), it.end_time,
    it.sort_order, it.is_published, it.speaker, NULL, 'template',
    p_application_id, p_source_revision_id, it.id
  FROM public.agenda_template_revision_items AS it
  WHERE it.revision_id = p_source_revision_id;

  GET DIAGNOSTICS v_copied = ROW_COUNT;
  RETURN v_copied;
END;
$$;

-- ============================================================
-- EXECUTE grants -- authenticated-only, matching every other governed
-- Agenda RPC's ACL convention.
-- ============================================================

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

REVOKE ALL ON FUNCTION public.reorder_event_agenda_items(uuid, integer, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reorder_event_agenda_items(uuid, integer, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.import_event_agenda_items(uuid, integer, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.import_event_agenda_items(uuid, integer, jsonb) TO authenticated;

COMMIT;
