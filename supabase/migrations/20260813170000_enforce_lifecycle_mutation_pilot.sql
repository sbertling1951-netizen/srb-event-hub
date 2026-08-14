-- Lifecycle Foundation Stage 3A: Mutation Enforcement Pilot (ADR-013 §12
-- stage 6, first cohort). Gates the already-RPC-choke-pointed Agenda,
-- Photos, and Presentation/Slideshow domains on
-- event_effective_lifecycle_state() -- the resolver established in Stage
-- 1 (20260813150000). No other domain (Attendees, Household, Check-in,
-- Parking, Vendor, Nearby, Maps, Imports) is touched; those remain
-- Stage 3B+ per the audit's own blast-radius ordering.
--
-- Every gated function already resolves its own Event scope and calls
-- has_event_task_authority before any state change -- that authority
-- check is untouched and unmoved. Exactly one line is added immediately
-- after it in each function: a call to the new shared guard below.
-- Nothing else in any function body changes -- same validation, same
-- idempotency/versioning, same audit/ledger writes, same return shape,
-- same error messages for every pre-existing failure mode.
--
-- Reads are not touched: no SELECT/read RPC in any of these three domains
-- is modified (read_public_presentation_session and
-- advance_presentation_session_if_due_internal, both anon-reachable/
-- read-adjacent and neither authority-gated to begin with, are
-- deliberately left alone -- there is no authority checkpoint in either
-- to attach a mutation guard to, and "do not change read behavior" rules
-- out adding one). Historical-photo read/download authorization
-- (event_photos SELECT policies, the event-photos storage bucket
-- functions) is untouched.
--
-- Event Staff / Authority RPCs (20260811170000) are reproduced below
-- unchanged, with no guard call. ADR-013 draws Lifecycle and Authority as
-- distinct axes: Lifecycle governs whether ordinary Event *content* may
-- be mutated; Authority governs who may govern an Event, independent of
-- its Lifecycle state. An archived Event must still permit its
-- authorized governors to assign, grant, revoke, and reprofile Authority
-- -- Lifecycle transition does not revoke, suspend, or narrow Event Admin
-- authority. These five RPCs therefore keep only their existing
-- assert_event_authority_governor check and are deliberately left
-- ungated here.

BEGIN;

-- ============================================================
-- Shared guard. One reusable helper, not a new authority abstraction: it
-- consults only event_effective_lifecycle_state() (Stage 1's resolver)
-- and never reads admin_users/admin_event_access/auth.uid() itself, so it
-- cannot be mistaken for -- or drift into -- an Authority check. Internal
-- only (zero direct grants, matching the established "_agenda_event_
-- version_advance" / "advance_presentation_session_if_due_internal"
-- pattern): reachable solely from within another SECURITY DEFINER
-- function's body, where Postgres evaluates EXECUTE against the definer
-- (postgres), never the original caller.
--
-- Stable, distinct error codes/messages for the two denial causes, per
-- this codebase's exception-message-as-error-code convention (matching
-- 'unauthorized', 'stale_agenda_version', 'session_not_live', etc.):
--   'event_archived'                -- Lifecycle resolved to 'archived'.
--   'event_lifecycle_indeterminate' -- resolver returned NULL (nonexistent
--                                       Event, missing end_date, or
--                                       missing/invalid timezone) --
--                                       fails closed, never silently
--                                       treated as mutable.
-- Called only after each function's own pre-existing authority check has
-- already passed -- Lifecycle enforcement never substitutes for, reorders
-- ahead of, or weakens Authority.
-- ============================================================

CREATE OR REPLACE FUNCTION public.assert_event_lifecycle_mutable(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_state text;
BEGIN
  v_state := public.event_effective_lifecycle_state(p_event_id);

  IF v_state IS NULL THEN
    RAISE EXCEPTION 'event_lifecycle_indeterminate';
  END IF;

  IF v_state = 'archived' THEN
    RAISE EXCEPTION 'event_archived';
  END IF;
END;
$$;

ALTER FUNCTION public.assert_event_lifecycle_mutable(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assert_event_lifecycle_mutable(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- Agenda (20260811310000). p_event_id is either the caller-supplied
-- parameter or, for item-scoped calls, the event_id already resolved
-- from the target row -- identical to how each function already sources
-- the value for its own has_event_task_authority call.
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

  SELECT public._agenda_ledger_log(
    'event_agenda_item_created', v_actor, 'event', 'event.agenda.manage',
    NULL, p_event_id, NULL, NULL, NULL, NULL, NULL,
    gen_random_uuid(), NULL, to_jsonb(v_item), NULL
  ) INTO v_command_id;
  UPDATE public.agenda_command_ledger SET agenda_item_id = v_item.id WHERE command_id = v_command_id;

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

  SELECT public._agenda_ledger_log(
    'event_agenda_item_updated', v_actor, 'event', 'event.agenda.manage',
    NULL, v_event_id, NULL, NULL, NULL, NULL, NULL,
    gen_random_uuid(), NULL, to_jsonb(v_item), NULL
  ) INTO v_command_id;
  UPDATE public.agenda_command_ledger SET agenda_item_id = p_item_id WHERE command_id = v_command_id;

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

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

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

  PERFORM public.assert_event_lifecycle_mutable(p_event_id);

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

  PERFORM public.assert_event_lifecycle_mutable(p_event_id);

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

ALTER FUNCTION public.create_event_agenda_item(
  uuid, text, text, text, text, text, text, date, time, time, boolean, integer, text
) OWNER TO postgres;
ALTER FUNCTION public.update_event_agenda_item(
  uuid, integer, text, text, text, text, text, text, date, time, time, boolean, integer
) OWNER TO postgres;
ALTER FUNCTION public.delete_event_agenda_item(uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.reorder_event_agenda_items(uuid, integer, jsonb) OWNER TO postgres;
ALTER FUNCTION public.import_event_agenda_items(uuid, integer, jsonb) OWNER TO postgres;

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

-- ============================================================
-- Photos (20260811390000). manage_event_photo is the sole Admin
-- mutation choke point; Member upload/read/delete-own-pending and public
-- approved-photo viewing are untouched, per this stage's explicit
-- exclusion of historical-photo read/download authorization.
-- ============================================================

CREATE OR REPLACE FUNCTION public.manage_event_photo(
  p_photo_id uuid,
  p_photo_status text,
  p_member_caption text,
  p_admin_caption text,
  p_show_caption boolean,
  p_featured_level integer
)
RETURNS public.event_photos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_before public.event_photos%ROWTYPE;
  v_after public.event_photos%ROWTYPE;
  v_is_featured boolean;
BEGIN
  SELECT * INTO v_before FROM public.event_photos WHERE id = p_photo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'photo_not_found';
  END IF;

  v_event_id := v_before.event_id;

  IF NOT public.has_event_task_authority('event.photos.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF p_photo_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  IF p_featured_level IS NULL OR p_featured_level < 0 OR p_featured_level > 3 THEN
    RAISE EXCEPTION 'invalid_featured_level';
  END IF;

  v_is_featured := p_featured_level > 0;

  UPDATE public.event_photos
  SET
    photo_status = p_photo_status,
    member_caption = p_member_caption,
    admin_caption = p_admin_caption,
    show_caption = coalesce(p_show_caption, show_caption),
    featured_level = p_featured_level,
    is_featured = v_is_featured,
    updated_at = now()
  WHERE id = p_photo_id
  RETURNING * INTO v_after;

  INSERT INTO public.event_photo_command_audit
    (photo_id, event_id, actor_auth_user_id, action, before_state, after_state)
  VALUES (
    p_photo_id, v_event_id, auth.uid(), 'photo_updated',
    jsonb_build_object(
      'photo_status', v_before.photo_status, 'member_caption', v_before.member_caption,
      'admin_caption', v_before.admin_caption, 'show_caption', v_before.show_caption,
      'featured_level', v_before.featured_level, 'is_featured', v_before.is_featured
    ),
    jsonb_build_object(
      'photo_status', v_after.photo_status, 'member_caption', v_after.member_caption,
      'admin_caption', v_after.admin_caption, 'show_caption', v_after.show_caption,
      'featured_level', v_after.featured_level, 'is_featured', v_after.is_featured
    )
  );

  RETURN v_after;
END;
$$;

ALTER FUNCTION public.manage_event_photo(uuid, text, text, text, boolean, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.manage_event_photo(uuid, text, text, text, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manage_event_photo(uuid, text, text, text, boolean, integer) TO authenticated;

-- ============================================================
-- Presentation / Slideshow -- deck management (20260811410000).
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_presentation_deck(
  p_event_id uuid,
  p_name text,
  p_description text,
  p_default_duration_ms integer,
  p_selection_mode text
)
RETURNS public.presentation_decks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_row public.presentation_decks%ROWTYPE;
BEGIN
  IF NOT public.has_event_task_authority('event.slideshow.manage', p_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(p_event_id);

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;

  IF p_selection_mode NOT IN ('all_approved', 'manual') THEN
    RAISE EXCEPTION 'invalid_selection_mode';
  END IF;

  IF p_default_duration_ms IS NULL OR p_default_duration_ms < 1000 OR p_default_duration_ms > 300000 THEN
    RAISE EXCEPTION 'invalid_default_duration_ms';
  END IF;

  INSERT INTO public.presentation_decks
    (event_id, name, description, default_duration_ms, selection_mode, created_by_auth_user_id)
  VALUES
    (p_event_id, btrim(p_name), p_description, p_default_duration_ms, p_selection_mode, auth.uid())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_presentation_deck(
  p_deck_id uuid,
  p_name text,
  p_description text,
  p_default_duration_ms integer,
  p_selection_mode text
)
RETURNS public.presentation_decks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_row public.presentation_decks%ROWTYPE;
BEGIN
  SELECT event_id INTO v_event_id FROM public.presentation_decks WHERE id = p_deck_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deck_not_found';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;

  IF p_selection_mode NOT IN ('all_approved', 'manual') THEN
    RAISE EXCEPTION 'invalid_selection_mode';
  END IF;

  IF p_default_duration_ms IS NULL OR p_default_duration_ms < 1000 OR p_default_duration_ms > 300000 THEN
    RAISE EXCEPTION 'invalid_default_duration_ms';
  END IF;

  IF p_selection_mode = 'all_approved'
     AND EXISTS (SELECT 1 FROM public.presentation_deck_items WHERE deck_id = p_deck_id) THEN
    RAISE EXCEPTION 'deck_has_items';
  END IF;

  UPDATE public.presentation_decks
  SET
    name = btrim(p_name),
    description = p_description,
    default_duration_ms = p_default_duration_ms,
    selection_mode = p_selection_mode,
    updated_at = now()
  WHERE id = p_deck_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_presentation_deck(p_deck_id uuid)
RETURNS public.presentation_decks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_row public.presentation_decks%ROWTYPE;
BEGIN
  SELECT event_id INTO v_event_id FROM public.presentation_decks WHERE id = p_deck_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deck_not_found';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  UPDATE public.presentation_decks
  SET lifecycle_status = 'archived', updated_at = now()
  WHERE id = p_deck_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_presentation_deck_photo(
  p_deck_id uuid,
  p_photo_id uuid,
  p_duration_ms integer
)
RETURNS public.presentation_deck_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_selection_mode text;
  v_photo_event_id uuid;
  v_photo_status text;
  v_next_sort_order integer;
  v_row public.presentation_deck_items%ROWTYPE;
BEGIN
  SELECT event_id, selection_mode INTO v_event_id, v_selection_mode
  FROM public.presentation_decks WHERE id = p_deck_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deck_not_found';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF v_selection_mode <> 'manual' THEN
    RAISE EXCEPTION 'deck_not_manual';
  END IF;

  SELECT event_id, photo_status INTO v_photo_event_id, v_photo_status
  FROM public.event_photos WHERE id = p_photo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'photo_not_found';
  END IF;

  IF v_photo_event_id <> v_event_id THEN
    RAISE EXCEPTION 'photo_event_mismatch';
  END IF;

  IF v_photo_status <> 'approved' THEN
    RAISE EXCEPTION 'photo_not_approved';
  END IF;

  IF p_duration_ms IS NOT NULL AND (p_duration_ms < 1000 OR p_duration_ms > 300000) THEN
    RAISE EXCEPTION 'invalid_duration_ms';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.presentation_deck_items
    WHERE deck_id = p_deck_id AND content_ref_id = p_photo_id
  ) THEN
    RAISE EXCEPTION 'photo_already_in_deck';
  END IF;

  SELECT COALESCE(MAX(sort_order) + 1, 0) INTO v_next_sort_order
  FROM public.presentation_deck_items WHERE deck_id = p_deck_id;

  INSERT INTO public.presentation_deck_items
    (deck_id, content_type, content_ref_id, sort_order, duration_ms)
  VALUES
    (p_deck_id, 'photo', p_photo_id, v_next_sort_order, p_duration_ms)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_presentation_deck_item(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_deck_id uuid;
  v_event_id uuid;
BEGIN
  SELECT deck_id INTO v_deck_id FROM public.presentation_deck_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found';
  END IF;

  SELECT event_id INTO v_event_id FROM public.presentation_decks WHERE id = v_deck_id;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  DELETE FROM public.presentation_deck_items WHERE id = p_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_presentation_deck_items(
  p_deck_id uuid,
  p_item_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_current uuid[];
  v_requested uuid[];
  v_i integer;
BEGIN
  SELECT event_id INTO v_event_id FROM public.presentation_decks WHERE id = p_deck_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deck_not_found';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'empty_item_list';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_current
  FROM public.presentation_deck_items WHERE deck_id = p_deck_id;

  SELECT array_agg(x ORDER BY x) INTO v_requested
  FROM unnest(p_item_ids) x;

  IF v_current IS DISTINCT FROM v_requested THEN
    RAISE EXCEPTION 'item_set_mismatch';
  END IF;

  SET CONSTRAINTS public.presentation_deck_items_deck_sort_order_key DEFERRED;

  FOR v_i IN 1 .. array_length(p_item_ids, 1) LOOP
    UPDATE public.presentation_deck_items
    SET sort_order = v_i, updated_at = now()
    WHERE id = p_item_ids[v_i] AND deck_id = p_deck_id;
  END LOOP;
END;
$$;

ALTER FUNCTION public.create_presentation_deck(uuid, text, text, integer, text) OWNER TO postgres;
ALTER FUNCTION public.update_presentation_deck(uuid, text, text, integer, text) OWNER TO postgres;
ALTER FUNCTION public.archive_presentation_deck(uuid) OWNER TO postgres;
ALTER FUNCTION public.add_presentation_deck_photo(uuid, uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.remove_presentation_deck_item(uuid) OWNER TO postgres;
ALTER FUNCTION public.reorder_presentation_deck_items(uuid, uuid[]) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_presentation_deck(uuid, text, text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_presentation_deck(uuid, text, text, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.update_presentation_deck(uuid, text, text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_presentation_deck(uuid, text, text, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.archive_presentation_deck(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.archive_presentation_deck(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.add_presentation_deck_photo(uuid, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_presentation_deck_photo(uuid, uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.remove_presentation_deck_item(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_presentation_deck_item(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.reorder_presentation_deck_items(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reorder_presentation_deck_items(uuid, uuid[]) TO authenticated;

-- ============================================================
-- Presentation / Slideshow -- live session control (20260811420000,
-- start/resume/next/previous superseded by 20260811430000's timed-advance
-- versions, reproduced here unchanged except the added guard).
-- ============================================================

CREATE OR REPLACE FUNCTION public.start_presentation_session(p_deck_id uuid)
RETURNS public.presentation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_selection_mode text;
  v_lifecycle_status text;
  v_default_duration_ms integer;
  v_session_id uuid;
  v_item_count integer;
  v_row public.presentation_sessions%ROWTYPE;
BEGIN
  SELECT event_id, selection_mode, lifecycle_status, default_duration_ms
  INTO v_event_id, v_selection_mode, v_lifecycle_status, v_default_duration_ms
  FROM public.presentation_decks WHERE id = p_deck_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deck_not_found';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF v_lifecycle_status <> 'active' THEN
    RAISE EXCEPTION 'deck_archived';
  END IF;

  IF EXISTS (SELECT 1 FROM public.presentation_sessions WHERE event_id = v_event_id AND status = 'live') THEN
    RAISE EXCEPTION 'session_already_active';
  END IF;

  INSERT INTO public.presentation_sessions
    (event_id, deck_id, status, playback_state, current_index, state_version, started_by_auth_user_id, current_item_started_at)
  VALUES
    (v_event_id, p_deck_id, 'live', 'playing', 0, 1, auth.uid(), now())
  RETURNING id INTO v_session_id;

  IF v_selection_mode = 'manual' THEN
    INSERT INTO public.presentation_session_items
      (session_id, source_deck_item_id, content_type, content_ref_id, sequence_number, duration_ms)
    SELECT
      v_session_id,
      di.id,
      di.content_type,
      di.content_ref_id,
      (row_number() OVER (ORDER BY di.sort_order))::integer - 1,
      COALESCE(di.duration_ms, v_default_duration_ms)
    FROM public.presentation_deck_items di
    WHERE di.deck_id = p_deck_id
      AND (
        di.content_type = 'blank'
        OR EXISTS (
          SELECT 1 FROM public.event_photos ep
          WHERE ep.id = di.content_ref_id AND ep.event_id = v_event_id AND ep.photo_status = 'approved'
        )
      );
  ELSIF v_selection_mode = 'all_approved' THEN
    INSERT INTO public.presentation_session_items
      (session_id, source_deck_item_id, content_type, content_ref_id, sequence_number, duration_ms)
    SELECT
      v_session_id,
      NULL,
      'photo',
      ep.id,
      (row_number() OVER (ORDER BY md5(v_session_id::text || ep.id::text)))::integer - 1,
      v_default_duration_ms
    FROM public.event_photos ep
    WHERE ep.event_id = v_event_id AND ep.photo_status = 'approved';
  END IF;

  SELECT count(*) INTO v_item_count FROM public.presentation_session_items WHERE session_id = v_session_id;
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'deck_has_no_playable_items';
  END IF;

  SELECT * INTO v_row FROM public.presentation_sessions WHERE id = v_session_id;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.pause_presentation_session(p_session_id uuid, p_expected_version bigint)
RETURNS public.presentation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_status text;
  v_row public.presentation_sessions%ROWTYPE;
BEGIN
  SELECT event_id, status INTO v_event_id, v_status FROM public.presentation_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'session_not_live';
  END IF;

  UPDATE public.presentation_sessions
  SET playback_state = 'paused', state_version = state_version + 1, updated_at = now()
  WHERE id = p_session_id AND state_version = p_expected_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_version';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_presentation_session(p_session_id uuid, p_expected_version bigint)
RETURNS public.presentation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_status text;
  v_row public.presentation_sessions%ROWTYPE;
BEGIN
  SELECT event_id, status INTO v_event_id, v_status FROM public.presentation_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'session_not_live';
  END IF;

  UPDATE public.presentation_sessions
  SET playback_state = 'playing', current_item_started_at = now(), state_version = state_version + 1, updated_at = now()
  WHERE id = p_session_id AND state_version = p_expected_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_version';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_presentation_slide(p_session_id uuid, p_expected_version bigint)
RETURNS public.presentation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_status text;
  v_current_index integer;
  v_item_count integer;
  v_next_index integer;
  v_row public.presentation_sessions%ROWTYPE;
BEGIN
  SELECT event_id, status, current_index INTO v_event_id, v_status, v_current_index
  FROM public.presentation_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'session_not_live';
  END IF;

  SELECT count(*) INTO v_item_count FROM public.presentation_session_items WHERE session_id = p_session_id;
  v_next_index := LEAST(v_current_index + 1, v_item_count - 1);

  IF v_next_index = v_current_index THEN
    SELECT * INTO v_row FROM public.presentation_sessions WHERE id = p_session_id;
    IF v_row.state_version <> p_expected_version THEN
      RAISE EXCEPTION 'stale_version';
    END IF;
    RETURN v_row;
  END IF;

  UPDATE public.presentation_sessions
  SET current_index = v_next_index, current_item_started_at = now(), state_version = state_version + 1, updated_at = now()
  WHERE id = p_session_id AND state_version = p_expected_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_version';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.previous_presentation_slide(p_session_id uuid, p_expected_version bigint)
RETURNS public.presentation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_status text;
  v_current_index integer;
  v_prev_index integer;
  v_row public.presentation_sessions%ROWTYPE;
BEGIN
  SELECT event_id, status, current_index INTO v_event_id, v_status, v_current_index
  FROM public.presentation_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'session_not_live';
  END IF;

  v_prev_index := GREATEST(v_current_index - 1, 0);

  IF v_prev_index = v_current_index THEN
    SELECT * INTO v_row FROM public.presentation_sessions WHERE id = p_session_id;
    IF v_row.state_version <> p_expected_version THEN
      RAISE EXCEPTION 'stale_version';
    END IF;
    RETURN v_row;
  END IF;

  UPDATE public.presentation_sessions
  SET current_index = v_prev_index, current_item_started_at = now(), state_version = state_version + 1, updated_at = now()
  WHERE id = p_session_id AND state_version = p_expected_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_version';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_presentation_session(p_session_id uuid, p_expected_version bigint)
RETURNS public.presentation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_status text;
  v_row public.presentation_sessions%ROWTYPE;
BEGIN
  SELECT event_id, status INTO v_event_id, v_status FROM public.presentation_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'session_not_live';
  END IF;

  UPDATE public.presentation_sessions
  SET status = 'ended', ended_at = now(), ended_by_auth_user_id = auth.uid(),
      state_version = state_version + 1, updated_at = now()
  WHERE id = p_session_id AND state_version = p_expected_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_version';
  END IF;

  RETURN v_row;
END;
$$;

-- advance_presentation_session_if_due (authenticated presenter-triggered
-- wrapper only -- its _internal callee has no authority checkpoint and is
-- deliberately untouched, per the header note above).
CREATE OR REPLACE FUNCTION public.advance_presentation_session_if_due(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  SELECT event_id INTO v_event_id FROM public.presentation_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  PERFORM public.advance_presentation_session_if_due_internal(p_session_id);
END;
$$;

ALTER FUNCTION public.start_presentation_session(uuid) OWNER TO postgres;
ALTER FUNCTION public.pause_presentation_session(uuid, bigint) OWNER TO postgres;
ALTER FUNCTION public.resume_presentation_session(uuid, bigint) OWNER TO postgres;
ALTER FUNCTION public.next_presentation_slide(uuid, bigint) OWNER TO postgres;
ALTER FUNCTION public.previous_presentation_slide(uuid, bigint) OWNER TO postgres;
ALTER FUNCTION public.end_presentation_session(uuid, bigint) OWNER TO postgres;
ALTER FUNCTION public.advance_presentation_session_if_due(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.start_presentation_session(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pause_presentation_session(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resume_presentation_session(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.next_presentation_slide(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.previous_presentation_slide(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.end_presentation_session(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.advance_presentation_session_if_due(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.start_presentation_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_presentation_session(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_presentation_session(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_presentation_slide(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.previous_presentation_slide(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_presentation_session(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_presentation_session_if_due(uuid) TO authenticated;

-- ============================================================
-- Event Staff (20260811170000). Authority here is governance-level
-- (Tenant Admin/Platform Admin via assert_event_authority_governor), not
-- an event.*.manage task grant. Per ADR-013, Lifecycle does not gate
-- Authority operations -- these five functions are reproduced byte-for-
-- byte from 20260811170000 with no guard call and no other change.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_event_authority_assignment(p_target_admin_user_id uuid,p_event_id uuid,p_profile_key text,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid()) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_tenant uuid; v_actor uuid; v_target_auth uuid; v_assignment uuid; v_task text;
BEGIN
 SELECT tenant_id,actor_admin_user_id INTO v_tenant,v_actor FROM public.assert_event_authority_governor(p_event_id);
 SELECT user_id INTO v_target_auth FROM public.admin_users WHERE id=p_target_admin_user_id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'target is not active admin'; END IF;
 IF v_target_auth=auth.uid() THEN RAISE EXCEPTION 'self-elevation is forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.admin_event_profiles WHERE profile_key=p_profile_key AND is_active) THEN RAISE EXCEPTION 'unknown profile'; END IF;
 INSERT INTO public.admin_event_access(admin_user_id,event_id,role) VALUES(p_target_admin_user_id,p_event_id,p_profile_key) RETURNING id INTO v_assignment;
 INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,profile_after,action,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,p_target_admin_user_id,v_tenant,p_event_id,v_assignment,p_profile_key,'assignment_created',jsonb_build_object('profile_key',p_profile_key),p_reason);
 FOR v_task IN SELECT task_key FROM public.admin_event_profile_tasks WHERE profile_key=p_profile_key LOOP
  INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key,granted_by_admin_user_id,grant_source,source_profile_key) VALUES(v_assignment,v_task,v_actor,'profile_materialization',p_profile_key);
  INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,task_key,profile_after,action,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,p_target_admin_user_id,v_tenant,p_event_id,v_assignment,v_task,p_profile_key,'task_granted',jsonb_build_object('source','profile_materialization'),p_reason);
 END LOOP;
 INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,profile_after,action,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,p_target_admin_user_id,v_tenant,p_event_id,v_assignment,p_profile_key,'bundle_materialized',jsonb_build_object('profile_key',p_profile_key),p_reason);
 RETURN v_assignment;
END $$;

CREATE OR REPLACE FUNCTION public.grant_event_authority_task(p_assignment_id uuid,p_task_key text,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid()) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_event uuid;v_target uuid;v_target_auth uuid;v_tenant uuid;v_actor uuid;
BEGIN
 SELECT event_id,admin_user_id INTO v_event,v_target FROM public.admin_event_access WHERE id=p_assignment_id; IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found'; END IF;
 SELECT tenant_id,actor_admin_user_id INTO v_tenant,v_actor FROM public.assert_event_authority_governor(v_event);
 SELECT user_id INTO v_target_auth FROM public.admin_users WHERE id=v_target; IF v_target_auth=auth.uid() THEN RAISE EXCEPTION 'self-elevation is forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.admin_task_registry WHERE task_key=p_task_key AND is_active AND scope='event' AND event_assignment_grantable) THEN RAISE EXCEPTION 'task is not Event-grantable'; END IF;
 INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key,granted_by_admin_user_id,grant_source) VALUES(p_assignment_id,p_task_key,v_actor,'manual') ON CONFLICT(admin_event_access_id,permission_key) DO NOTHING;
 IF FOUND THEN INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,task_key,action,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,v_target,v_tenant,v_event,p_assignment_id,p_task_key,'task_granted',jsonb_build_object('source','manual'),p_reason); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_event_authority_task(p_assignment_id uuid,p_task_key text,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid()) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_event uuid;v_target uuid;v_target_auth uuid;v_tenant uuid;v_actor uuid;
BEGIN
 SELECT event_id,admin_user_id INTO v_event,v_target FROM public.admin_event_access WHERE id=p_assignment_id; IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found'; END IF;
 SELECT tenant_id,actor_admin_user_id INTO v_tenant,v_actor FROM public.assert_event_authority_governor(v_event);
 SELECT user_id INTO v_target_auth FROM public.admin_users WHERE id=v_target; IF v_target_auth=auth.uid() THEN RAISE EXCEPTION 'self-elevation is forbidden'; END IF;
 DELETE FROM public.admin_event_permissions WHERE admin_event_access_id=p_assignment_id AND permission_key=p_task_key;
 IF FOUND THEN INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,task_key,action,previous_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,v_target,v_tenant,v_event,p_assignment_id,p_task_key,'task_revoked',jsonb_build_object('enabled',true),p_reason); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.remove_event_authority_assignment(p_assignment_id uuid,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid()) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_event uuid;v_target uuid;v_target_auth uuid;v_profile text;v_tenant uuid;v_actor uuid;
BEGIN
 SELECT event_id,admin_user_id,role INTO v_event,v_target,v_profile FROM public.admin_event_access WHERE id=p_assignment_id; IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found'; END IF;
 SELECT tenant_id,actor_admin_user_id INTO v_tenant,v_actor FROM public.assert_event_authority_governor(v_event);
 SELECT user_id INTO v_target_auth FROM public.admin_users WHERE id=v_target; IF v_target_auth=auth.uid() THEN RAISE EXCEPTION 'self-elevation is forbidden'; END IF;
 INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,profile_before,action,previous_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,v_target,v_tenant,v_event,p_assignment_id,v_profile,'assignment_revoked',jsonb_build_object('profile_key',v_profile),p_reason);
 DELETE FROM public.admin_event_access WHERE id=p_assignment_id;
END $$;

CREATE OR REPLACE FUNCTION public.change_event_authority_profile(p_assignment_id uuid,p_profile_key text,p_disposition text,p_final_task_keys text[] DEFAULT NULL,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid()) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_event uuid;v_target uuid;v_target_auth uuid;v_old text;v_tenant uuid;v_actor uuid;v_final text[];v_task text;
BEGIN
 SELECT event_id,admin_user_id,role INTO v_event,v_target,v_old FROM public.admin_event_access WHERE id=p_assignment_id; IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found'; END IF;
 SELECT tenant_id,actor_admin_user_id INTO v_tenant,v_actor FROM public.assert_event_authority_governor(v_event);
 SELECT user_id INTO v_target_auth FROM public.admin_users WHERE id=v_target; IF v_target_auth=auth.uid() THEN RAISE EXCEPTION 'self-elevation is forbidden'; END IF;
 IF p_disposition NOT IN ('reset_to_defaults','preserve_exceptions') OR NOT EXISTS(SELECT 1 FROM public.admin_event_profiles WHERE profile_key=p_profile_key AND is_active) THEN RAISE EXCEPTION 'invalid profile change'; END IF;
 IF p_disposition='reset_to_defaults' THEN IF p_final_task_keys IS NOT NULL THEN RAISE EXCEPTION 'reset cannot include final keys'; END IF; SELECT array_agg(task_key ORDER BY task_key) INTO v_final FROM public.admin_event_profile_tasks WHERE profile_key=p_profile_key;
 ELSE IF p_final_task_keys IS NULL THEN RAISE EXCEPTION 'preserve_exceptions needs explicit final keys'; END IF; SELECT array_agg(DISTINCT k ORDER BY k) INTO v_final FROM unnest(p_final_task_keys) k; IF EXISTS(SELECT 1 FROM unnest(v_final) k LEFT JOIN public.admin_task_registry r ON r.task_key=k WHERE r.task_key IS NULL OR NOT r.is_active OR r.scope<>'event' OR NOT r.event_assignment_grantable) THEN RAISE EXCEPTION 'invalid final task'; END IF; END IF;
 DELETE FROM public.admin_event_permissions WHERE admin_event_access_id=p_assignment_id; UPDATE public.admin_event_access SET role=p_profile_key WHERE id=p_assignment_id;
 FOREACH v_task IN ARRAY v_final LOOP INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key,granted_by_admin_user_id,grant_source,source_profile_key) VALUES(p_assignment_id,v_task,v_actor,CASE WHEN p_disposition='reset_to_defaults' THEN 'profile_change' ELSE 'manual' END,p_profile_key); END LOOP;
 INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,profile_before,profile_after,action,previous_state,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,v_target,v_tenant,v_event,p_assignment_id,v_old,p_profile_key,'profile_changed',jsonb_build_object('profile_key',v_old),jsonb_build_object('profile_key',p_profile_key,'final_task_keys',v_final),p_reason);
 INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,profile_before,profile_after,action,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,v_target,v_tenant,v_event,p_assignment_id,v_old,p_profile_key,CASE WHEN p_disposition='reset_to_defaults' THEN 'defaults_reset' ELSE 'exceptions_preserved' END,jsonb_build_object('final_task_keys',v_final),p_reason);
END $$;

ALTER FUNCTION public.create_event_authority_assignment(uuid,uuid,text,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.grant_event_authority_task(uuid,text,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.revoke_event_authority_task(uuid,text,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.remove_event_authority_assignment(uuid,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.change_event_authority_profile(uuid,text,text,text[],text,uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_event_authority_assignment(uuid,uuid,text,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_event_authority_assignment(uuid,uuid,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.grant_event_authority_task(uuid,text,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.grant_event_authority_task(uuid,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_event_authority_task(uuid,text,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.revoke_event_authority_task(uuid,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.remove_event_authority_assignment(uuid,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.remove_event_authority_assignment(uuid,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.change_event_authority_profile(uuid,text,text,text[],text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.change_event_authority_profile(uuid,text,text,text[],text,uuid) TO authenticated;

COMMIT;
