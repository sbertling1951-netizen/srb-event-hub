-- Governed Attendee Name Tag and Coach Plate operational-need mutations.
--
-- `attendees.needs_name_tag` and `attendees.needs_coach_plate` remain the
-- canonical durable requirement facts. Unlike parking intent, neither field
-- owns nor conflicts with a separate canonical assignment relationship.
-- Each explicit command derives Event scope from the locked attendee row and
-- changes exactly one requirement field.

BEGIN;

-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

CREATE FUNCTION public.set_attendee_name_tag_need(
  p_attendee_id uuid,
  p_needs_name_tag boolean
)
RETURNS TABLE(
  outcome text,
  event_id uuid,
  attendee_id uuid,
  needs_name_tag boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_event_id uuid;
  v_current_needs_name_tag boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_attendee_id IS NULL OR p_needs_name_tag IS NULL THEN
    RAISE EXCEPTION 'name_tag_need_required' USING ERRCODE = '22023';
  END IF;

  -- Lock and derive scope from the canonical attendee row. The browser never
  -- supplies Event identity, so it cannot redirect this command across Events.
  SELECT a.event_id, a.needs_name_tag
    INTO v_event_id, v_current_needs_name_tag
  FROM public.attendees AS a
  WHERE a.id = p_attendee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendee_not_found' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_event_task_authority('event.attendees.manage', v_event_id) THEN
    RAISE EXCEPTION 'authorization_denied' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  -- Idempotent retries report the persisted state without an unnecessary
  -- attendee UPDATE or any other side effect.
  IF v_current_needs_name_tag IS NOT DISTINCT FROM p_needs_name_tag THEN
    RETURN QUERY
    SELECT 'unchanged'::text, v_event_id, p_attendee_id, v_current_needs_name_tag;
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.attendees AS a
  SET needs_name_tag = p_needs_name_tag
  WHERE a.id = p_attendee_id
  RETURNING 'updated'::text, a.event_id, a.id, a.needs_name_tag;
END;
$function$;

ALTER FUNCTION public.set_attendee_name_tag_need(uuid, boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_attendee_name_tag_need(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.set_attendee_name_tag_need(uuid, boolean)
  TO authenticated;

CREATE FUNCTION public.set_attendee_coach_plate_need(
  p_attendee_id uuid,
  p_needs_coach_plate boolean
)
RETURNS TABLE(
  outcome text,
  event_id uuid,
  attendee_id uuid,
  needs_coach_plate boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_event_id uuid;
  v_current_needs_coach_plate boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_attendee_id IS NULL OR p_needs_coach_plate IS NULL THEN
    RAISE EXCEPTION 'coach_plate_need_required' USING ERRCODE = '22023';
  END IF;

  -- Lock and derive scope from the canonical attendee row. The browser never
  -- supplies Event identity, so it cannot redirect this command across Events.
  SELECT a.event_id, a.needs_coach_plate
    INTO v_event_id, v_current_needs_coach_plate
  FROM public.attendees AS a
  WHERE a.id = p_attendee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendee_not_found' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_event_task_authority('event.attendees.manage', v_event_id) THEN
    RAISE EXCEPTION 'authorization_denied' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  -- Idempotent retries report the persisted state without an unnecessary
  -- attendee UPDATE or any other side effect.
  IF v_current_needs_coach_plate IS NOT DISTINCT FROM p_needs_coach_plate THEN
    RETURN QUERY
    SELECT 'unchanged'::text, v_event_id, p_attendee_id, v_current_needs_coach_plate;
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.attendees AS a
  SET needs_coach_plate = p_needs_coach_plate
  WHERE a.id = p_attendee_id
  RETURNING 'updated'::text, a.event_id, a.id, a.needs_coach_plate;
END;
$function$;

ALTER FUNCTION public.set_attendee_coach_plate_need(uuid, boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_attendee_coach_plate_need(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.set_attendee_coach_plate_need(uuid, boolean)
  TO authenticated;

-- ============================================================
-- PARITY END

COMMIT;
