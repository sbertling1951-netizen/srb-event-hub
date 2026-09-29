BEGIN;

CREATE OR REPLACE FUNCTION public.advance_presentation_session_if_due_internal(
  p_session_id uuid
)
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
  WHERE id = p_session_id
    AND status = 'live'
    AND playback_state = 'playing'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT duration_ms
    INTO v_duration_ms
  FROM public.presentation_session_items
  WHERE session_id = p_session_id
    AND sequence_number = v_current_index;

  IF v_duration_ms IS NULL
    OR v_current_item_started_at + (v_duration_ms * interval '1 millisecond') > now() THEN
    RETURN;
  END IF;

  SELECT count(*)
    INTO v_item_count
  FROM public.presentation_session_items
  WHERE session_id = p_session_id;

  IF v_item_count <= 0 THEN
    RETURN;
  END IF;

  v_next_index := (v_current_index + 1) % v_item_count;

  UPDATE public.presentation_sessions
  SET current_index = v_next_index,
      current_item_started_at = now(),
      state_version = state_version + 1,
      updated_at = now()
  WHERE id = p_session_id;
END;
$$;

ALTER FUNCTION public.advance_presentation_session_if_due_internal(uuid)
  OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.read_public_presentation_session(
  p_session_id uuid
)
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
  v_next_index integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.presentation_sessions AS ps
    JOIN public.events AS e ON e.id = ps.event_id
    JOIN public.tenants AS t ON t.id = e.tenant_id
    WHERE ps.id = p_session_id
      AND t.is_active = true
      AND NOT public.is_self_service_private_draft_event(e.id)
  ) THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::text, NULL::bigint, NULL::integer, NULL::integer,
      NULL::text, NULL::uuid, NULL::text, NULL::integer,
      NULL::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;

  PERFORM public.advance_presentation_session_if_due_internal(p_session_id);

  SELECT *
    INTO v_session
  FROM public.presentation_sessions
  WHERE id = p_session_id;

  IF NOT FOUND OR v_session.status <> 'live' THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::text, NULL::bigint, NULL::integer, NULL::integer,
      NULL::text, NULL::uuid, NULL::text, NULL::integer,
      NULL::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;

  SELECT count(*)
    INTO v_item_count
  FROM public.presentation_session_items
  WHERE session_id = p_session_id;

  IF v_item_count <= 0 THEN
    RETURN QUERY SELECT
      true, v_session.event_id, v_session.playback_state,
      v_session.state_version, 0, v_session.current_index,
      NULL::text, NULL::uuid, NULL::text, NULL::integer,
      NULL::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;

  v_next_index := (v_session.current_index + 1) % v_item_count;

  RETURN QUERY
  SELECT
    true,
    v_session.event_id,
    v_session.playback_state,
    v_session.state_version,
    v_item_count,
    v_session.current_index,
    CASE WHEN cur.content_type = 'photo' AND ep_cur.id IS NULL THEN NULL ELSE cur.content_type END,
    CASE WHEN cur.content_type = 'photo' AND ep_cur.id IS NULL THEN NULL ELSE cur.content_ref_id END,
    NULL::text,
    CASE WHEN cur.content_type = 'photo' AND ep_cur.id IS NULL THEN NULL ELSE cur.duration_ms END,
    CASE WHEN nxt.content_type = 'photo' AND ep_nxt.id IS NULL THEN NULL ELSE nxt.content_type END,
    CASE WHEN nxt.content_type = 'photo' AND ep_nxt.id IS NULL THEN NULL ELSE nxt.content_ref_id END,
    NULL::text,
    CASE WHEN nxt.content_type = 'photo' AND ep_nxt.id IS NULL THEN NULL ELSE nxt.duration_ms END
  FROM (SELECT 1) AS dummy
  LEFT JOIN public.presentation_session_items AS cur
    ON cur.session_id = p_session_id
   AND cur.sequence_number = v_session.current_index
  LEFT JOIN public.event_photos AS ep_cur
    ON ep_cur.id = cur.content_ref_id
   AND ep_cur.photo_status = 'approved'
  LEFT JOIN public.presentation_session_items AS nxt
    ON nxt.session_id = p_session_id
   AND nxt.sequence_number = v_next_index
  LEFT JOIN public.event_photos AS ep_nxt
    ON ep_nxt.id = nxt.content_ref_id
   AND ep_nxt.photo_status = 'approved';
END;
$$;

ALTER FUNCTION public.read_public_presentation_session(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public._resolve_live_presentation_slot_path(
  p_session_id uuid,
  p_slot text
)
RETURNS TABLE(content_ref_id uuid, storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_session public.presentation_sessions%ROWTYPE;
  v_item_count integer;
  v_target_index integer;
BEGIN
  IF p_slot NOT IN ('current', 'next') THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.presentation_sessions AS ps
    JOIN public.events AS e ON e.id = ps.event_id
    JOIN public.tenants AS t ON t.id = e.tenant_id
    WHERE ps.id = p_session_id
      AND t.is_active = true
      AND NOT public.is_self_service_private_draft_event(e.id)
  ) THEN
    RETURN;
  END IF;

  SELECT *
    INTO v_session
  FROM public.presentation_sessions
  WHERE id = p_session_id;

  IF NOT FOUND OR v_session.status <> 'live' THEN
    RETURN;
  END IF;

  SELECT count(*)
    INTO v_item_count
  FROM public.presentation_session_items
  WHERE session_id = p_session_id;

  IF v_item_count <= 0 THEN
    RETURN;
  END IF;

  v_target_index := CASE
    WHEN p_slot = 'current' THEN v_session.current_index
    ELSE (v_session.current_index + 1) % v_item_count
  END;

  RETURN QUERY
  SELECT ep.id, ep.storage_path
  FROM public.presentation_session_items AS psi
  JOIN public.event_photos AS ep
    ON ep.id = psi.content_ref_id
   AND ep.photo_status = 'approved'
   AND public.is_canonical_event_photo_path(ep.event_id, ep.attendee_id, ep.storage_path)
  WHERE psi.session_id = p_session_id
    AND psi.sequence_number = v_target_index
    AND psi.content_type = 'photo';
END;
$$;

ALTER FUNCTION public._resolve_live_presentation_slot_path(uuid, text)
  OWNER TO postgres;

COMMIT;
