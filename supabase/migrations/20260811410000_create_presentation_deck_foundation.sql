-- Presentation Stage 3: Durable Deck & Slide Model Foundation. Adds the
-- Event-scoped durable configuration schema for the future PowerPoint-style
-- Presentation Viewer, governed exclusively by the event.slideshow.manage
-- Task Authority Stage 2 already established (20260811400000). This stage
-- is schema/RPC only: no live session state, no Realtime, no UI cutover.
-- The existing /admin/slideshow + /slideshow/view localStorage-driven
-- flow (epix-presentation-state) is untouched and keeps working exactly
-- as before, beside this new durable model.
BEGIN;

-- ============================================================
-- 1. presentation_decks. One row per saved, reusable, Event-scoped
-- presentation. event_id is the sole ownership anchor (Tenant/Platform
-- authority flows through has_event_task_authority, not a duplicated
-- tenant_id column, per this stage's own governing-architecture section
-- 6). selection_mode picks between an "always show every approved
-- photo" deck (no stored items, matches current viewer behavior with
-- zero curation effort) and a "manual" deck with explicit
-- presentation_deck_items ordering -- Part 14's preferred architecture.
-- lifecycle_status is active/archived only: archiving (not hard-
-- deleting) protects Stage 4's future session references from pointing
-- at a vanished deck, without importing Agenda's revision/publish
-- complexity, which this domain's evidence does not justify.
-- default_duration_ms defaults to 8000 to match the existing viewer's
-- hard-coded 8-second auto-advance timer (app/slideshow/view/page.tsx),
-- now made durable and overridable instead of hard-coded. Duplicate
-- deck names within the same Event are deliberately allowed -- a deck is
-- identified by id, not name, and there is no evidence a uniqueness
-- constraint protects anything real.
-- ============================================================

CREATE TABLE public.presentation_decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  default_duration_ms integer NOT NULL DEFAULT 8000,
  selection_mode text NOT NULL DEFAULT 'all_approved',
  lifecycle_status text NOT NULL DEFAULT 'active',
  created_by_auth_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT presentation_decks_name_not_blank_check CHECK (btrim(name) <> ''),
  CONSTRAINT presentation_decks_selection_mode_check CHECK (selection_mode IN ('all_approved', 'manual')),
  CONSTRAINT presentation_decks_lifecycle_status_check CHECK (lifecycle_status IN ('active', 'archived')),
  CONSTRAINT presentation_decks_default_duration_ms_check CHECK (default_duration_ms BETWEEN 1000 AND 300000)
);

CREATE INDEX presentation_decks_event_idx ON public.presentation_decks (event_id);

-- ============================================================
-- 2. presentation_deck_items. Manual-mode slide rows only -- an
-- all_approved deck stores zero rows here by construction (enforced in
-- update_presentation_deck below, part 4). content_type is the
-- extensible discriminator Part 8 asks Stage 3 to reserve, but only
-- 'photo' and 'blank' are implemented now; no other domain is wired.
-- content_ref_id uses a direct FK to event_photos(id) rather than a
-- polymorphic reference (Part 10's option A): every content_type this
-- stage implements that carries a reference points at exactly one
-- table, so a real FK is possible today and is stronger than RPC-only
-- validation. 'blank' rows have no reference by construction (CHECK
-- below). When a future content_type (agenda_item, announcement,
-- vendor, ...) is added, this column will need to become generic and
-- validated only through governed RPCs -- that is expected schema
-- evolution, not evidence that this stage's model was wrong for v1.
-- ON DELETE RESTRICT (not CASCADE): no photo-delete workflow exists yet
-- (event.photos.delete is registered but unassigned per
-- 20260811390000), so this is currently unreachable in practice: a
-- rejected photo's row still exists and playback-time revalidation
-- (Stage 4+) is what "fails safely," not a disappearing deck item.
-- sort_order is a plain integer with a deferrable unique constraint per
-- deck, so reorder_presentation_deck_items below can rewrite an entire
-- deck's ordering atomically in one statement-visible pass without a
-- transient duplicate-key error mid-loop.
-- ============================================================

CREATE TABLE public.presentation_deck_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id uuid NOT NULL REFERENCES public.presentation_decks(id) ON DELETE CASCADE,
  content_type text NOT NULL,
  content_ref_id uuid REFERENCES public.event_photos(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT presentation_deck_items_content_type_check CHECK (content_type IN ('photo', 'blank')),
  CONSTRAINT presentation_deck_items_content_ref_shape_check CHECK (
    (content_type = 'photo' AND content_ref_id IS NOT NULL)
    OR (content_type = 'blank' AND content_ref_id IS NULL)
  ),
  CONSTRAINT presentation_deck_items_duration_ms_check CHECK (
    duration_ms IS NULL OR duration_ms BETWEEN 1000 AND 300000
  ),
  CONSTRAINT presentation_deck_items_deck_sort_order_key UNIQUE (deck_id, sort_order) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX presentation_deck_items_deck_idx ON public.presentation_deck_items (deck_id, sort_order);

-- A photo may appear at most once per deck. Partial (content_ref_id IS
-- NOT NULL) so multiple 'blank' rows, which never carry a reference,
-- are never compared against each other by this index.
CREATE UNIQUE INDEX presentation_deck_items_deck_photo_unique
  ON public.presentation_deck_items (deck_id, content_ref_id)
  WHERE content_ref_id IS NOT NULL;

-- ============================================================
-- 3. RLS + closed direct-write posture. Unlike event_photos (which
-- started with an open Admin UPDATE policy that 20260811390000 had to
-- close after the fact), these are brand-new tables: mutation is
-- closed to direct browser access from the moment they exist. Only a
-- governed SELECT policy is granted (mirrors the Photo/Agenda read
-- pattern), scoped by has_event_task_authority so an admin only ever
-- sees decks for Events they hold event.slideshow.manage on. No anon
-- access at all -- Presentation configuration is an Admin-only surface;
-- audience/viewer reads belong to a later stage's own read contract,
-- not this one (Part 16).
-- ============================================================

ALTER TABLE public.presentation_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presentation_deck_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.presentation_decks FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.presentation_deck_items FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.presentation_decks TO authenticated;
GRANT SELECT ON TABLE public.presentation_deck_items TO authenticated;

CREATE POLICY presentation_decks_admin_select_policy
  ON public.presentation_decks
  FOR SELECT
  TO authenticated
  USING (public.has_event_task_authority('event.slideshow.manage', event_id));

CREATE POLICY presentation_deck_items_admin_select_policy
  ON public.presentation_deck_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.presentation_decks d
      WHERE d.id = presentation_deck_items.deck_id
        AND public.has_event_task_authority('event.slideshow.manage', d.event_id)
    )
  );

-- ============================================================
-- 4. Governed mutation RPCs. Every function resolves its own Event
-- scope from stored rows (never from a caller-supplied event_id used
-- as a bare trust boundary) and calls has_event_task_authority itself
-- -- the same shape as manage_event_photo (20260811390000). None of
-- these expose a way to change a deck's event_id after creation, so
-- "Event ownership cannot be changed across Events" holds structurally,
-- not just by convention.
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

ALTER FUNCTION public.create_presentation_deck(uuid, text, text, integer, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_presentation_deck(uuid, text, text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_presentation_deck(uuid, text, text, integer, text) TO authenticated;

-- Switching into all_approved while manual items still exist is
-- rejected rather than silently deleting them -- Part 14's invariant
-- ("all_approved mode requires zero stored photo items") is enforced
-- here, and the caller must explicitly remove items first via
-- remove_presentation_deck_item. No path in this migration ever
-- deletes deck items as a side effect of an unrelated update.
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

ALTER FUNCTION public.update_presentation_deck(uuid, text, text, integer, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_presentation_deck(uuid, text, text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_presentation_deck(uuid, text, text, integer, text) TO authenticated;

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

  UPDATE public.presentation_decks
  SET lifecycle_status = 'archived', updated_at = now()
  WHERE id = p_deck_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

ALTER FUNCTION public.archive_presentation_deck(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.archive_presentation_deck(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.archive_presentation_deck(uuid) TO authenticated;

-- Photo eligibility is enforced here, not duplicated as stored state:
-- the photo must belong to the same Event as the deck and currently be
-- 'approved'. Eligibility is re-checked only at add time -- Part 9's
-- "fail safely at playback, revalidate later" is explicitly a Stage 4+
-- concern, not this stage's. Always appends at the current max
-- sort_order + 1 rather than trusting a caller-supplied position, so
-- concurrent adds cannot collide; reordering afterward is
-- reorder_presentation_deck_items's job, not this function's.
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

ALTER FUNCTION public.add_presentation_deck_photo(uuid, uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.add_presentation_deck_photo(uuid, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_presentation_deck_photo(uuid, uuid, integer) TO authenticated;

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

  DELETE FROM public.presentation_deck_items WHERE id = p_item_id;
END;
$$;

ALTER FUNCTION public.remove_presentation_deck_item(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_presentation_deck_item(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_presentation_deck_item(uuid) TO authenticated;

-- Atomic reorder: p_item_ids must be exactly the deck's current item set
-- (same members, any order) or the whole call is rejected -- prevents
-- a stale client from silently dropping an item, and prevents an item
-- from another deck being smuggled in. Relies on
-- presentation_deck_items_deck_sort_order_key being DEFERRABLE INITIALLY
-- DEFERRED so the position-by-position rewrite below never trips a
-- transient duplicate-sort_order violation mid-loop; SET CONSTRAINTS is
-- issued explicitly rather than relying only on the column default, so
-- this function's atomicity does not depend on the caller's transaction
-- not having already forced it immediate.
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

ALTER FUNCTION public.reorder_presentation_deck_items(uuid, uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reorder_presentation_deck_items(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reorder_presentation_deck_items(uuid, uuid[]) TO authenticated;

COMMIT;
