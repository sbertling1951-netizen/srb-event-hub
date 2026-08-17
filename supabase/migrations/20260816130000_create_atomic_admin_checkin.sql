-- Atomic Admin Check-In: pairs the existing governed Site Placement
-- operation with the attendee's Check-In state in one database transaction.
-- Site Placement remains owned by record_site_placement; this function only
-- composes that established operation with the fields Check-In already owns.

BEGIN;

CREATE OR REPLACE FUNCTION public.complete_admin_checkin(
  p_attendee_id uuid,
  p_expected_event_id uuid,
  p_has_arrived boolean,
  p_share_with_attendees boolean,
  p_placement_action text DEFAULT NULL,
  p_site_id uuid DEFAULT NULL,
  p_placement_idempotency_key uuid DEFAULT NULL,
  p_override_occupied_site boolean DEFAULT false
)
RETURNS TABLE(
  outcome text,
  event_id uuid,
  attendee_id uuid,
  assigned_site text,
  share_with_attendees boolean,
  has_arrived boolean,
  arrival_status text,
  displaced_attendee_id uuid,
  rejection_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event_id uuid;
  v_placement record;
  v_assigned_site text;
  v_arrival_status text;
  v_displaced_attendee_id uuid := NULL;
BEGIN
  IF v_actor IS NULL OR p_attendee_id IS NULL OR p_expected_event_id IS NULL
     OR p_has_arrived IS NULL OR p_share_with_attendees IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT a.event_id, a.assigned_site
  INTO v_event_id, v_assigned_site
  FROM public.attendees AS a
  WHERE a.id = p_attendee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendee_not_found';
  END IF;

  -- Check-In authority is derived server-side for the attendee's Event;
  -- parking managers retain the authority that record_site_placement already
  -- grants them for the same governed placement action.
  IF NOT public.has_event_task_authority('event.checkin.manage', v_event_id)
     AND NOT public.has_event_task_authority('event.parking.manage', v_event_id) THEN
    RAISE EXCEPTION 'authorization_denied';
  END IF;

  IF v_event_id <> p_expected_event_id THEN
    RAISE EXCEPTION 'event_scope_mismatch';
  END IF;

  IF p_placement_action IS NULL THEN
    IF p_site_id IS NOT NULL OR p_placement_idempotency_key IS NOT NULL
       OR p_override_occupied_site THEN
      RAISE EXCEPTION 'action_state_invalid';
    END IF;
  ELSIF p_placement_action NOT IN ('assign', 'reassign', 'correct', 'clear', 'confirm')
     OR p_placement_idempotency_key IS NULL
     OR (p_placement_action <> 'clear' AND p_site_id IS NULL) THEN
    RAISE EXCEPTION 'action_state_invalid';
  END IF;

  IF p_placement_action IS NOT NULL THEN
    SELECT * INTO v_placement
    FROM public.record_site_placement(
      p_attendee_id,
      p_placement_action,
      p_placement_idempotency_key,
      p_site_id,
      'checkin_staff',
      NULL,
      p_override_occupied_site
    );

    -- A governed placement rejection deliberately returns without touching
    -- arrival/share state, preserving its rejected history row.
    IF v_placement.outcome = 'rejected' THEN
      RETURN QUERY SELECT
        'rejected'::text, v_event_id, p_attendee_id, v_assigned_site,
        NULL::boolean, NULL::boolean, NULL::text,
        v_placement.displaced_attendee_id, v_placement.rejection_code;
      RETURN;
    END IF;

    v_assigned_site := v_placement.resulting_site_label;
    v_displaced_attendee_id := v_placement.displaced_attendee_id;
  END IF;

  UPDATE public.attendees AS a
  SET assigned_site = v_assigned_site,
      share_with_attendees = p_share_with_attendees,
      has_arrived = p_has_arrived,
      arrival_status = CASE
        WHEN p_has_arrived AND a.arrival_status = 'parked' THEN 'parked'
        WHEN p_has_arrived THEN 'arrived'
        ELSE 'not_arrived'
      END
  WHERE a.id = p_attendee_id
  RETURNING a.assigned_site, a.share_with_attendees, a.has_arrived, a.arrival_status
  INTO v_assigned_site, share_with_attendees, has_arrived, v_arrival_status;

  IF v_displaced_attendee_id IS NOT NULL THEN
    UPDATE public.attendees
    SET assigned_site = NULL
    WHERE id = v_displaced_attendee_id;
  END IF;

  RETURN QUERY SELECT
    'applied'::text, v_event_id, p_attendee_id, v_assigned_site,
    share_with_attendees, has_arrived, v_arrival_status,
    v_displaced_attendee_id, NULL::text;
END;
$$;

ALTER FUNCTION public.complete_admin_checkin(uuid, uuid, boolean, boolean, text, uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_admin_checkin(uuid, uuid, boolean, boolean, text, uuid, uuid, boolean)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.complete_admin_checkin(uuid, uuid, boolean, boolean, text, uuid, uuid, boolean)
TO authenticated;

COMMIT;
