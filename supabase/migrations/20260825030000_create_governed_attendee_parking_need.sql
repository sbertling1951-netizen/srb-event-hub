-- Governed Attendee parking-need mutation.
--
-- `attendees.needs_parking` remains the one canonical parking-intent fact.
-- Arrival remains owned by Check-In and current placement remains owned by
-- Parking through parking_sites.assigned_attendee_id. This command changes
-- only intent and refuses a false transition while Parking has an active
-- canonical assignment; it never clears or alters that assignment.

BEGIN;

-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

CREATE FUNCTION public.set_attendee_parking_need(
  p_attendee_id uuid,
  p_needs_parking boolean
)
RETURNS TABLE(
  outcome text,
  event_id uuid,
  attendee_id uuid,
  needs_parking boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_event_id uuid;
  v_current_needs_parking boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_attendee_id IS NULL OR p_needs_parking IS NULL THEN
    RAISE EXCEPTION 'parking_need_required' USING ERRCODE = '22023';
  END IF;

  -- Lock and derive scope from the canonical attendee row. The browser never
  -- supplies Event identity, so it cannot redirect this command across Events.
  SELECT a.event_id, a.needs_parking
    INTO v_event_id, v_current_needs_parking
  FROM public.attendees AS a
  WHERE a.id = p_attendee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendee_not_found' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_event_task_authority('event.attendees.manage', v_event_id) THEN
    RAISE EXCEPTION 'authorization_denied' USING ERRCODE = '42501';
  END IF;

  -- Operational intent is mutable only in the Event lifecycle states that
  -- allow ordinary governed attendee work. Authority is deliberately checked
  -- first, matching the established Event mutation pattern.
  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  -- Parking owns canonical placement. Never create the contradictory state
  -- "Doesn't Need Parking" plus an assigned parking site by silently clearing
  -- or changing that relationship here.
  IF p_needs_parking = false AND EXISTS (
    SELECT 1
    FROM public.parking_sites AS ps
    WHERE ps.event_id = v_event_id
      AND ps.assigned_attendee_id = p_attendee_id
  ) THEN
    RAISE EXCEPTION 'parking_assignment_must_be_removed_first'
      USING ERRCODE = '23514',
        DETAIL = 'Remove this attendee''s parking assignment in Parking before marking them as not needing parking.';
  END IF;

  -- Idempotent retries report the persisted state without an unnecessary
  -- attendee UPDATE or any other side effect.
  IF v_current_needs_parking IS NOT DISTINCT FROM p_needs_parking THEN
    RETURN QUERY
    SELECT 'unchanged'::text, v_event_id, p_attendee_id, v_current_needs_parking;
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.attendees AS a
  SET needs_parking = p_needs_parking
  WHERE a.id = p_attendee_id
  RETURNING 'updated'::text, a.event_id, a.id, a.needs_parking;
END;
$function$;

ALTER FUNCTION public.set_attendee_parking_need(uuid, boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_attendee_parking_need(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.set_attendee_parking_need(uuid, boolean)
  TO authenticated;

-- ============================================================
-- PARITY END

COMMIT;
