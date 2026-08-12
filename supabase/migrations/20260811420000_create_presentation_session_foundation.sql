-- Presentation Stage 4: Shared Live Session & Governed Control Foundation.
-- Adds the durable, database-authoritative live-session model that will
-- replace the current browser-local epix-presentation-state localStorage
-- control channel in a later UI stage. Backend/schema only: no UI is
-- rebuilt, no Realtime subscription is wired, and the existing
-- /admin/slideshow + /slideshow/view flow is untouched and keeps working
-- exactly as it does today, beside this new model.
BEGIN;

-- ============================================================
-- 1. presentation_sessions. One row per live (or now-ended) audience
-- presentation for an Event. event_id is stored (not merely derivable
-- via deck_id -> presentation_decks.event_id) per this stage's own
-- required minimal field set -- but it is write-once: set only at
-- INSERT from the deck's own event_id (itself immutable post-creation
-- per Stage 3), never accepted as an RPC parameter, never updated
-- afterward. That keeps it a safe cached derivation rather than a
-- second independently-writable source of truth, while letting RLS
-- policies and every control RPC avoid a join against
-- presentation_decks on every read of a table that audience viewers
-- will poll frequently.
--
-- current_index is the single canonical position representation
-- (Part 4): there is no separate current_item_id column. The current
-- item is always resolved by joining presentation_session_items on
-- (session_id, sequence_number = current_index) -- storing both would
-- create two values that could drift out of sync.
--
-- status (live|ended) is session lifecycle. playback_state
-- (playing|paused) is independent and only meaningful while status is
-- live -- kept as two fields rather than one overloaded status enum,
-- per Part 12's explicit instruction.
--
-- state_version is the monotonic optimistic-concurrency counter
-- (Part 14): every successful control mutation increments it by
-- exactly one; every control RPC's UPDATE is gated by
-- `WHERE id = ... AND state_version = p_expected_version` so a stale
-- caller's write is atomically rejected rather than silently
-- clobbering a newer command -- not a courtesy pre-check, the WHERE
-- clause itself is the concurrency guarantee.
--
-- One active session per Event (Part 16, v1 preference) is enforced
-- structurally by a partial unique index on (event_id) WHERE
-- status = 'live', not merely checked in application/RPC logic.
-- ============================================================

CREATE TABLE public.presentation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  deck_id uuid NOT NULL REFERENCES public.presentation_decks(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'live',
  playback_state text NOT NULL DEFAULT 'playing',
  current_index integer NOT NULL DEFAULT 0,
  state_version bigint NOT NULL DEFAULT 1,
  started_by_auth_user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_by_auth_user_id uuid,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT presentation_sessions_status_check CHECK (status IN ('live', 'ended')),
  CONSTRAINT presentation_sessions_playback_state_check CHECK (playback_state IN ('playing', 'paused')),
  CONSTRAINT presentation_sessions_current_index_check CHECK (current_index >= 0),
  CONSTRAINT presentation_sessions_ended_shape_check CHECK (
    (status = 'live' AND ended_at IS NULL AND ended_by_auth_user_id IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX presentation_sessions_one_active_per_event_key
  ON public.presentation_sessions (event_id)
  WHERE status = 'live';

CREATE INDEX presentation_sessions_deck_idx ON public.presentation_sessions (deck_id);

-- ============================================================
-- 2. presentation_session_items. The deterministic, immutable snapshot
-- of what this session will play, materialized once and atomically by
-- start_presentation_session (Part 7's chosen architecture: snapshot,
-- not dynamic reference). Once written, no RPC in this migration ever
-- updates or deletes a row here -- the immutability trigger below
-- enforces that as a real invariant, not just a convention, because
-- "one deterministic list for a session's lifetime" is this table's
-- entire reason to exist. source_deck_item_id is provenance-only
-- (nullable, ON DELETE SET NULL): an all_approved snapshot has no deck
-- item to point at, and a manual deck's item can later be removed by
-- Stage 3's own remove_presentation_deck_item without invalidating an
-- already-materialized session (the session already copied
-- content_type/content_ref_id/duration_ms, so it does not depend on
-- the deck item row surviving). content_ref_id reuses Stage 3's direct
-- FK strategy to event_photos(id) for exactly the same reason (only
-- one content type carries a reference today).
-- ============================================================

CREATE TABLE public.presentation_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.presentation_sessions(id) ON DELETE CASCADE,
  source_deck_item_id uuid REFERENCES public.presentation_deck_items(id) ON DELETE SET NULL,
  content_type text NOT NULL,
  content_ref_id uuid REFERENCES public.event_photos(id) ON DELETE RESTRICT,
  sequence_number integer NOT NULL,
  duration_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT presentation_session_items_content_type_check CHECK (content_type IN ('photo', 'blank')),
  CONSTRAINT presentation_session_items_content_ref_shape_check CHECK (
    (content_type = 'photo' AND content_ref_id IS NOT NULL)
    OR (content_type = 'blank' AND content_ref_id IS NULL)
  ),
  CONSTRAINT presentation_session_items_duration_ms_check CHECK (duration_ms BETWEEN 1000 AND 300000),
  CONSTRAINT presentation_session_items_sequence_number_check CHECK (sequence_number >= 0),
  CONSTRAINT presentation_session_items_session_sequence_key UNIQUE (session_id, sequence_number)
);

CREATE INDEX presentation_session_items_session_idx ON public.presentation_session_items (session_id, sequence_number);

CREATE OR REPLACE FUNCTION public.prevent_presentation_session_item_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  RAISE EXCEPTION 'presentation_session_items is immutable once written';
END;
$$;

CREATE TRIGGER prevent_presentation_session_item_mutation_trigger
  BEFORE UPDATE OR DELETE ON public.presentation_session_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_presentation_session_item_mutation();

-- ============================================================
-- 3. RLS + closed direct-write posture. Same posture as Stage 3:
-- mutation closed to direct browser access from the moment these
-- tables exist; only a governed SELECT policy is granted, scoped by
-- has_event_task_authority, for the Admin/presenter surface. No anon
-- grant on either table -- the audience contract is the narrow
-- read_public_presentation_session RPC below (Part 18), never direct
-- table access.
-- ============================================================

ALTER TABLE public.presentation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presentation_session_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.presentation_sessions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.presentation_session_items FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.presentation_sessions TO authenticated;
GRANT SELECT ON TABLE public.presentation_session_items TO authenticated;

CREATE POLICY presentation_sessions_admin_select_policy
  ON public.presentation_sessions
  FOR SELECT
  TO authenticated
  USING (public.has_event_task_authority('event.slideshow.manage', event_id));

CREATE POLICY presentation_session_items_admin_select_policy
  ON public.presentation_session_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.presentation_sessions s
      WHERE s.id = presentation_session_items.session_id
        AND public.has_event_task_authority('event.slideshow.manage', s.event_id)
    )
  );

-- ============================================================
-- 4. start_presentation_session. Event is derived solely from the
-- deck (no p_event_id parameter exists to mistrust -- Part 6's "never
-- trust caller-supplied Event + deck combinations" is structural, not
-- a runtime check). Archived decks cannot start new sessions; an
-- already-live session tied to a deck that is later archived is left
-- alone (nothing in this migration re-checks deck lifecycle after
-- start), matching Part 6's preferred behavior exactly. The whole
-- function body is one implicit transaction: if the materialized
-- snapshot ends up with zero playable items, the RAISE EXCEPTION below
-- aborts everything inserted so far (session row included), so a
-- rejected start leaves zero rows behind -- snapshot creation is
-- atomic by construction, not by extra bookkeeping.
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

  IF v_lifecycle_status <> 'active' THEN
    RAISE EXCEPTION 'deck_archived';
  END IF;

  IF EXISTS (SELECT 1 FROM public.presentation_sessions WHERE event_id = v_event_id AND status = 'live') THEN
    RAISE EXCEPTION 'session_already_active';
  END IF;

  INSERT INTO public.presentation_sessions
    (event_id, deck_id, status, playback_state, current_index, state_version, started_by_auth_user_id)
  VALUES
    (v_event_id, p_deck_id, 'live', 'playing', 0, 1, auth.uid())
  RETURNING id INTO v_session_id;

  IF v_selection_mode = 'manual' THEN
    -- Re-validates photo eligibility at snapshot time (Event match +
    -- approved), not merely trusting Stage 3's add-time check -- a
    -- photo can be un-approved after being added to a manual deck, and
    -- Part 10 requires eligibility to hold at the moment a session is
    -- actually started.
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
    -- Deterministic seeded shuffle (Part 9, option B): sort key is
    -- md5(session_id || photo_id), so the order is fully determined by
    -- which session is starting and which photos are eligible right
    -- now -- reproducible, requires no legacy weighted-random state,
    -- and is not featured_level-weighted (simplicity preferred over
    -- preserving the current viewer's weighting per this stage's own
    -- instruction; featured_level remains on event_photos for a later
    -- stage to weight the seeded key if ever wanted).
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

ALTER FUNCTION public.start_presentation_session(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.start_presentation_session(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_presentation_session(uuid) TO authenticated;

-- ============================================================
-- 5. Control RPCs. Each resolves event_id from the stored session row
-- (never from a caller-supplied value), requires
-- has_event_task_authority, requires status = 'live', and performs its
-- state change as a single `UPDATE ... WHERE id = p_session_id AND
-- state_version = p_expected_version` -- the version match is enforced
-- inside the same statement that writes the new state, which is what
-- makes this real optimistic concurrency rather than a racy
-- check-then-write: two concurrent stale callers cannot both succeed,
-- because only the first UPDATE's WHERE clause can still match by the
-- time the second one runs. A 0-row UPDATE (stale version) raises
-- 'stale_version' and makes no change.
-- ============================================================

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

  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'session_not_live';
  END IF;

  UPDATE public.presentation_sessions
  SET playback_state = 'playing', state_version = state_version + 1, updated_at = now()
  WHERE id = p_session_id AND state_version = p_expected_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_version';
  END IF;

  RETURN v_row;
END;
$$;

-- Boundary rule (Part 13): no implicit wrap. At the final item, next
-- clamps to the last index; at the first item, previous clamps to
-- index 0. A clamped call is not an error (it is a valid, idempotent
-- no-op at the boundary) but it is also not a "successful state
-- change": state_version is only incremented when current_index
-- actually moves, matching Part 14's "version increments exactly once
-- per successful control" precisely -- a no-op boundary call changes
-- nothing, so it advances nothing. No loop/wrap-around exists in this
-- stage (Stage 3's deck model has no loop column); LEAST/GREATEST
-- clamping can become modulo wrap-around later without breaking this
-- contract, so the foundation is loop-capable without inventing loop
-- UI behavior now.
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
  SET current_index = v_next_index, state_version = state_version + 1, updated_at = now()
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
  SET current_index = v_prev_index, state_version = state_version + 1, updated_at = now()
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

ALTER FUNCTION public.pause_presentation_session(uuid, bigint) OWNER TO postgres;
ALTER FUNCTION public.resume_presentation_session(uuid, bigint) OWNER TO postgres;
ALTER FUNCTION public.next_presentation_slide(uuid, bigint) OWNER TO postgres;
ALTER FUNCTION public.previous_presentation_slide(uuid, bigint) OWNER TO postgres;
ALTER FUNCTION public.end_presentation_session(uuid, bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.pause_presentation_session(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resume_presentation_session(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.next_presentation_slide(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.previous_presentation_slide(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.end_presentation_session(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.pause_presentation_session(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_presentation_session(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_presentation_slide(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.previous_presentation_slide(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_presentation_session(uuid, bigint) TO authenticated;

-- ============================================================
-- 6. Public audience read contract (Part 17/18). The session `id`
-- itself is the viewer token (Part 5): a gen_random_uuid() primary key
-- is already a non-enumerable, cryptographically random identifier, so
-- a second dedicated token column would duplicate that guarantee for
-- no benefit. There is deliberately no RPC anywhere that resolves a
-- live session FROM a bare event_id for an unauthenticated caller --
-- "knowing an Event ID alone must not resolve an active presentation"
-- is enforced by that absence, not by a runtime check. Not-found and
-- ended sessions are made indistinguishable to the caller
-- (session_active = false, every other field null) so this RPC never
-- reveals whether a given UUID ever existed. Only currently-approved
-- photo content resolves a storage_path -- re-validated here at read
-- time, independent of whatever was true when the item was
-- snapshotted (Part 11): an item that has since become ineligible
-- returns null renderable content while current_index stays exactly
-- where the presenter left it. That is this stage's chosen meaning of
-- "skipped safely" -- the viewer never silently diverges from the
-- server-authoritative position on its own; only the presenter
-- advancing moves it past an ineligible slide.
-- ============================================================

CREATE OR REPLACE FUNCTION public.read_public_presentation_session(p_session_id uuid)
RETURNS TABLE (
  session_active boolean,
  event_id uuid,
  playback_state text,
  state_version bigint,
  item_count integer,
  sequence_number integer,
  current_content_type text,
  current_content_ref_id uuid,
  current_storage_path text,
  current_duration_ms integer,
  next_content_type text,
  next_content_ref_id uuid,
  next_storage_path text,
  next_duration_ms integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_session public.presentation_sessions%ROWTYPE;
  v_item_count integer;
BEGIN
  SELECT * INTO v_session FROM public.presentation_sessions WHERE id = p_session_id;

  IF NOT FOUND OR v_session.status <> 'live' THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::text, NULL::bigint, NULL::integer, NULL::integer,
      NULL::text, NULL::uuid, NULL::text, NULL::integer,
      NULL::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;

  SELECT count(*) INTO v_item_count FROM public.presentation_session_items WHERE session_id = p_session_id;

  RETURN QUERY
  SELECT
    true,
    v_session.event_id,
    v_session.playback_state,
    v_session.state_version,
    v_item_count,
    v_session.current_index,
    cur.content_type,
    cur.content_ref_id,
    CASE WHEN cur.content_type = 'photo' THEN ep_cur.storage_path ELSE NULL END,
    cur.duration_ms,
    nxt.content_type,
    nxt.content_ref_id,
    CASE WHEN nxt.content_type = 'photo' THEN ep_nxt.storage_path ELSE NULL END,
    nxt.duration_ms
  FROM (SELECT 1) AS dummy
  LEFT JOIN public.presentation_session_items cur
    ON cur.session_id = p_session_id AND cur.sequence_number = v_session.current_index
  LEFT JOIN public.event_photos ep_cur
    ON ep_cur.id = cur.content_ref_id AND ep_cur.photo_status = 'approved'
  LEFT JOIN public.presentation_session_items nxt
    ON nxt.session_id = p_session_id AND nxt.sequence_number = v_session.current_index + 1
  LEFT JOIN public.event_photos ep_nxt
    ON ep_nxt.id = nxt.content_ref_id AND ep_nxt.photo_status = 'approved';
END;
$$;

ALTER FUNCTION public.read_public_presentation_session(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.read_public_presentation_session(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.read_public_presentation_session(uuid) TO anon, authenticated;

COMMIT;
