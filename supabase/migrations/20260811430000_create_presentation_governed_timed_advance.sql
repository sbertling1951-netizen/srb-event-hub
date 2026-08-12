-- Presentation Stage 6A: Governed Timed Advance. Closes the one
-- load-bearing gap Stage 6 identified: unattended timed slideshow
-- advancement, without putting playback authority or an independent
-- clock into the anonymous audience viewer.
--
-- Repository evidence checked before choosing a model: no pg_cron
-- extension is installed (confirmed via pg_extension), no Supabase
-- Edge Functions directory exists, and no application-level
-- scheduler/heartbeat mechanism exists anywhere in this repository.
-- Option A (database/server scheduled advancement) is therefore not
-- available without introducing new, untracked infrastructure, which
-- is explicitly out of scope. Option B (presenter-owned heartbeat) was
-- evaluated and rejected as the SOLE mechanism because it would make
-- auto-advance presenter-required, contradicting "unattended
-- operation" -- it is instead layered on ADDITIONALLY (see Part 8
-- below), not relied upon alone.
--
-- Chosen: Option C, advance-on-authoritative-read. The audience
-- viewer's own necessary ~1s poll of read_public_presentation_session
-- (Stage 6) is already the one thing that MUST happen continuously for
-- an audience to see anything at all -- it is not a new dependency,
-- merely a new side effect on an existing, already-anon-executable
-- entry point. The internal advance check is a pure, atomic,
-- server-computed reconciliation against elapsed wall-clock time: the
-- calling role supplies no data that influences the outcome beyond the
-- mere act of asking "what time is it now," so granting it no new
-- privilege is both correct and sufficient (Part 5).
BEGIN;

-- ============================================================
-- 1. Durable timing origin. One new column is sufficient:
-- current_item_started_at, the timestamp the CURRENT item became
-- current. "Is this item due to advance" is always derivable as
-- current_item_started_at + duration_ms > now() -- no separate
-- next_advance_at column is needed, since duration_ms already lives on
-- presentation_session_items and storing a second, redundant timestamp
-- would only create a value that could drift out of sync with the
-- first (the same reasoning Stage 4 already applied to current_index
-- vs a separate current_item_id).
--
-- Timing-origin semantics (defined explicitly, per Part 3):
--   - session start: current_item_started_at = now().
--   - manual Next/Previous that actually moves: reset to now().
--   - manual Next/Previous at a boundary (no-op clamp): untouched.
--   - Resume: reset to now() -- an explicit resume gives the current
--     slide a fresh full duration. This is a deliberate choice, not an
--     omission: Pause freezes the clock (the advance check simply
--     never fires while playback_state <> 'playing', so no elapsed-
--     during-pause bookkeeping is needed at all), and an explicit
--     Resume click is a real user action, not a passive reconnect --
--     "do not silently restart... after arbitrary reconnect" (Part 3)
--     is about RECONNECT (a bare read must never mutate this column),
--     which this migration never does; it says nothing about an
--     explicit Resume command, which legitimately may.
--   - Automatic advance: reset to now() for the newly-current item.
--   - Reconnect (any read, presenter or viewer): never touches this
--     column by itself.
-- ============================================================

ALTER TABLE public.presentation_sessions
  ADD COLUMN current_item_started_at timestamptz NOT NULL DEFAULT now();

-- ============================================================
-- 2. Internal advance resolver. Not exposed to any role (see the
-- REVOKE below) -- reachable only from within another postgres-owned
-- SECURITY DEFINER function's body, where Postgres evaluates EXECUTE
-- privilege against the DEFINER (postgres, which always has implicit
-- privilege on objects it owns), not the original caller. This is the
-- same "internal helper, zero direct grants" shape Stage 3's
-- prevent_presentation_session_item_mutation trigger function and
-- Stage 4's has_event_task_authority -> resolve_task_authority chain
-- already use.
--
-- Concurrency: `SELECT ... FOR UPDATE` takes a row lock on the session
-- for the duration of the current transaction (one RPC call). A second
-- concurrent invocation for the SAME session blocks until the first
-- commits, then re-reads the now-current row -- if the first call just
-- advanced and reset current_item_started_at, the second call's own
-- "is it due" check correctly evaluates false and it returns without
-- mutating. Two simultaneous eligible calls therefore produce exactly
-- one logical advance, never two (Part 8 item 4) -- this is enforced
-- by Postgres row-level locking, not by an application-level mutex.
--
-- End-of-deck (Part 4): reaching the final item's due time does not
-- wrap and does not silently do nothing forever either -- it makes
-- exactly one further transition, into playback_state = 'paused', an
-- explicit, observable stable state. Every later invocation then finds
-- playback_state <> 'playing' and returns immediately, so this
-- transition fires exactly once (state_version increments exactly
-- once for it), never repeatedly.
-- ============================================================

CREATE OR REPLACE FUNCTION public.advance_presentation_session_if_due_internal(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_current_index integer;
  v_current_item_started_at timestamptz;
  v_duration_ms integer;
  v_item_count integer;
  v_next_index integer;
BEGIN
  SELECT current_index, current_item_started_at
  INTO v_current_index, v_current_item_started_at
  FROM public.presentation_sessions
  WHERE id = p_session_id AND status = 'live' AND playback_state = 'playing'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT duration_ms INTO v_duration_ms
  FROM public.presentation_session_items
  WHERE session_id = p_session_id AND sequence_number = v_current_index;

  IF v_duration_ms IS NULL THEN
    RETURN;
  END IF;

  IF v_current_item_started_at + (v_duration_ms * interval '1 millisecond') > now() THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_item_count FROM public.presentation_session_items WHERE session_id = p_session_id;
  v_next_index := LEAST(v_current_index + 1, v_item_count - 1);

  IF v_next_index = v_current_index THEN
    UPDATE public.presentation_sessions
    SET playback_state = 'paused', state_version = state_version + 1, updated_at = now()
    WHERE id = p_session_id;
    RETURN;
  END IF;

  UPDATE public.presentation_sessions
  SET current_index = v_next_index,
      current_item_started_at = now(),
      state_version = state_version + 1,
      updated_at = now()
  WHERE id = p_session_id;
END;
$$;

ALTER FUNCTION public.advance_presentation_session_if_due_internal(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.advance_presentation_session_if_due_internal(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 3. Authenticated presenter-triggered wrapper. Not strictly required
-- for unattended operation (the audience viewer's own poll already
-- drives the clock -- see Part 6 in the final report), but layered on
-- so a presenter watching their own console, including with zero
-- audience viewers connected (e.g. rehearsal/setup), also sees timed
-- advancement without waiting on an audience screen. Requires
-- event.slideshow.manage like every other presenter-triggered mutation
-- (Part 5); never granted to anon.
-- ============================================================

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

  PERFORM public.advance_presentation_session_if_due_internal(p_session_id);
END;
$$;

ALTER FUNCTION public.advance_presentation_session_if_due(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.advance_presentation_session_if_due(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.advance_presentation_session_if_due(uuid) TO authenticated;

-- ============================================================
-- 4. start_presentation_session: establishes the timing origin at
-- session creation. Body otherwise identical to Stage 4's; only the
-- INSERT's column list and current_item_started_at = now() change.
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

-- ============================================================
-- 5. resume_presentation_session: an explicit Resume gives the current
-- slide a fresh full duration (see Part 3 discussion above). Pause
-- itself needs no change: the internal helper's WHERE playback_state =
-- 'playing' already makes a paused session immune to advancement with
-- no elapsed-time bookkeeping required.
-- ============================================================

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
  SET playback_state = 'playing', current_item_started_at = now(), state_version = state_version + 1, updated_at = now()
  WHERE id = p_session_id AND state_version = p_expected_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_version';
  END IF;

  RETURN v_row;
END;
$$;

-- ============================================================
-- 6. next_presentation_slide / previous_presentation_slide: reset the
-- timing origin only on the branch that actually moves the position --
-- the no-op boundary-clamp branch (Part 13, preserved unchanged from
-- Stage 4) must not touch it, matching "state_version increments
-- exactly once per successful control" for timing too.
-- ============================================================

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

-- Re-assert ownership/grants for the five functions above defensively
-- (CREATE OR REPLACE preserves existing grants for an unchanged
-- signature, but this makes the final ACL state provable by this
-- migration alone rather than by relying on that behavior implicitly).
ALTER FUNCTION public.start_presentation_session(uuid) OWNER TO postgres;
ALTER FUNCTION public.resume_presentation_session(uuid, bigint) OWNER TO postgres;
ALTER FUNCTION public.next_presentation_slide(uuid, bigint) OWNER TO postgres;
ALTER FUNCTION public.previous_presentation_slide(uuid, bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.start_presentation_session(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resume_presentation_session(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.next_presentation_slide(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.previous_presentation_slide(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.start_presentation_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_presentation_session(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_presentation_slide(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.previous_presentation_slide(uuid, bigint) TO authenticated;

-- ============================================================
-- 7. read_public_presentation_session: now performs the atomic advance
-- check first, as an internal side effect, before building its
-- existing audience-safe response. Signature and every returned column
-- are byte-identical to Stage 6's version; only the new leading PERFORM
-- is added, and existing grants are re-asserted defensively below.
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
  PERFORM public.advance_presentation_session_if_due_internal(p_session_id);

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
