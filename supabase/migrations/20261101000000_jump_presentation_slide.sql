BEGIN;

-- Presenter slide dots: move a live session directly to one of its existing
-- session items. The item order fixed at start (including the all_approved
-- shuffle) is unchanged; only current_index moves. Authority, draft-Event,
-- lifecycle, live-session and optimistic-version checks match
-- next_presentation_slide. playback_state is preserved, and the selected slide
-- receives its full duration. Photo eligibility remains enforced by the
-- governed read and image resolution, exactly as for Next/Previous.
CREATE OR REPLACE FUNCTION public.jump_presentation_slide(
  p_session_id uuid,
  p_expected_version bigint,
  p_sequence_number integer
)
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
  v_row public.presentation_sessions%ROWTYPE;
BEGIN
  SELECT event_id, status, current_index INTO v_event_id, v_status, v_current_index
  FROM public.presentation_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  IF public.is_self_service_private_draft_event(v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'session_not_live';
  END IF;

  SELECT count(*) INTO v_item_count FROM public.presentation_session_items WHERE session_id = p_session_id;
  IF p_sequence_number IS NULL OR p_sequence_number < 0 OR p_sequence_number >= v_item_count THEN
    RAISE EXCEPTION 'invalid_slide';
  END IF;

  IF p_sequence_number = v_current_index THEN
    SELECT * INTO v_row FROM public.presentation_sessions WHERE id = p_session_id;
    IF v_row.state_version <> p_expected_version THEN
      RAISE EXCEPTION 'stale_version';
    END IF;
    RETURN v_row;
  END IF;

  UPDATE public.presentation_sessions
  SET current_index = p_sequence_number, current_item_started_at = now(), state_version = state_version + 1, updated_at = now()
  WHERE id = p_session_id AND status = 'live' AND state_version = p_expected_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_version';
  END IF;

  RETURN v_row;
END;
$$;

ALTER FUNCTION public.jump_presentation_slide(uuid, bigint, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.jump_presentation_slide(uuid, bigint, integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.jump_presentation_slide(uuid, bigint, integer) TO authenticated;

COMMIT;
