-- Explicit dual-authority physical-arrival confirmation. Ordinary placement
-- remains Arrival-independent. This audit extension is not current state:
-- one row per combined request; linked placement history records its outcome.
BEGIN;

CREATE TABLE public.arrival_parking_confirmations (
  idempotency_key uuid PRIMARY KEY,
  placement_history_id uuid NOT NULL UNIQUE REFERENCES public.site_placement_history(id),
  requested_site_id uuid,
  requested_master_site_id uuid NOT NULL,
  requested_action text NOT NULL CHECK (requested_action IN ('assign', 'reassign', 'confirm')),
  override_occupied_site boolean NOT NULL,
  -- Prior Arrival is NULL for rejected placement, which never records Arrival.
  previous_has_arrived boolean,
  previous_arrival_status text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.arrival_parking_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arrival_parking_confirmations OWNER TO postgres;
REVOKE ALL ON public.arrival_parking_confirmations FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.confirm_attendee_arrived_and_parked(
  p_attendee_id uuid,
  p_expected_event_id uuid,
  p_action text,
  p_idempotency_key uuid,
  p_master_site_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_override_occupied_site boolean DEFAULT false
)
RETURNS TABLE(outcome text, displaced_attendee_id uuid, rejection_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event_id uuid;
  v_site_id uuid := p_site_id;
  v_existing public.arrival_parking_confirmations%ROWTYPE;
  v_history public.site_placement_history%ROWTYPE;
  v_attendee public.attendees%ROWTYPE;
  v_materialized record;
  v_placement record;
  v_arrival record;
  v_note text := 'Arrived-and-parked request; operation ' || gen_random_uuid()::text;
BEGIN
  IF v_actor IS NULL OR p_attendee_id IS NULL OR p_expected_event_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  SELECT a.event_id INTO v_event_id FROM public.attendees a WHERE a.id = p_attendee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'attendee_not_found'; END IF;
  IF public.has_event_task_authority('event.parking.manage', v_event_id) IS NOT TRUE
     OR public.has_event_task_authority('event.checkin.manage', v_event_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'arrival_parking_authorization_denied';
  END IF;
  IF v_event_id IS DISTINCT FROM p_expected_event_id THEN
    RAISE EXCEPTION 'event_scope_mismatch';
  END IF;
  PERFORM public.assert_event_lifecycle_mutable(v_event_id);
  IF p_action IS NULL OR p_action NOT IN ('assign', 'reassign', 'confirm')
     OR p_idempotency_key IS NULL OR p_master_site_id IS NULL
     OR p_override_occupied_site IS NULL THEN
    RAISE EXCEPTION 'action_state_invalid';
  END IF;

  -- Serialize only retries of this combined request, before any row locks.
  PERFORM pg_advisory_xact_lock(hashtextextended('arrival-parking:' || p_idempotency_key::text, 0));
  SELECT * INTO v_existing FROM public.arrival_parking_confirmations c
    WHERE c.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT * INTO STRICT v_history FROM public.site_placement_history h
      WHERE h.id = v_existing.placement_history_id;
    IF v_history.actor_auth_user_id IS DISTINCT FROM v_actor
       OR v_history.attendee_id IS DISTINCT FROM p_attendee_id
       OR v_history.event_id IS DISTINCT FROM v_event_id
       OR v_existing.requested_action IS DISTINCT FROM p_action
       OR v_existing.requested_site_id IS DISTINCT FROM p_site_id
       OR v_existing.requested_master_site_id IS DISTINCT FROM p_master_site_id
       OR v_existing.override_occupied_site IS DISTINCT FROM p_override_occupied_site THEN
      RAISE EXCEPTION 'idempotency_key_reused_conflict';
    END IF;
    RETURN QUERY SELECT v_history.outcome, v_history.displaced_attendee_id, v_history.rejection_code;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.site_placement_history h WHERE h.idempotency_key = p_idempotency_key) THEN
    RAISE EXCEPTION 'idempotency_key_reused_conflict';
  END IF;

  IF v_site_id IS NULL THEN
    SELECT * INTO v_materialized FROM public.materialize_event_parking_site(v_event_id, p_master_site_id);
    IF v_materialized.parking_site_id IS NULL OR v_materialized.outcome = 'rejected' THEN
      RAISE EXCEPTION '%', coalesce(v_materialized.rejection_code, 'site_not_found');
    END IF;
    v_site_id := v_materialized.parking_site_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.parking_sites s
    WHERE s.id = v_site_id AND s.event_id = v_event_id AND s.master_site_id = p_master_site_id) THEN
    RAISE EXCEPTION 'site_not_found';
  END IF;

  -- Do not lock attendees before placement: preserve its canonical lock order.
  SELECT * INTO v_placement FROM public.record_site_placement(
    p_attendee_id, p_action, p_idempotency_key, v_site_id,
    'parking_staff', v_note, p_override_occupied_site
  );
  IF v_placement.history_id IS NULL OR v_placement.outcome NOT IN ('applied', 'confirmed', 'rejected') THEN
    RAISE EXCEPTION '%', coalesce(v_placement.rejection_code, 'action_state_invalid');
  END IF;
  -- Reject a concurrent ordinary-placement request reusing our key. A replay
  -- from that RPC must not be mistaken for a newly locked combined operation.
  SELECT * INTO STRICT v_history FROM public.site_placement_history h WHERE h.id = v_placement.history_id;
  IF v_history.note IS DISTINCT FROM v_note THEN
    RAISE EXCEPTION 'idempotency_key_reused_conflict';
  END IF;
  -- Preserve governed rejected-attempt history (specification section 8.1).
  -- The private request receipt makes exact rejection retries idempotent.
  IF v_placement.outcome = 'rejected' THEN
    INSERT INTO public.arrival_parking_confirmations (
      idempotency_key, placement_history_id, requested_site_id,
      requested_master_site_id, requested_action, override_occupied_site
    ) VALUES (
      p_idempotency_key, v_placement.history_id, p_site_id, p_master_site_id,
      p_action, p_override_occupied_site
    );
    RETURN QUERY SELECT 'rejected'::text, NULL::uuid, v_placement.rejection_code;
    RETURN;
  END IF;
  SELECT * INTO STRICT v_attendee FROM public.attendees a WHERE a.id = p_attendee_id;
  SELECT * INTO v_arrival FROM public.complete_admin_checkin(
    p_attendee_id, v_event_id, true, coalesce(v_attendee.share_with_attendees, false)
  );
  IF v_arrival.outcome IS DISTINCT FROM 'applied' THEN
    RAISE EXCEPTION '%', coalesce(v_arrival.rejection_code, 'registration_not_current');
  END IF;
  -- This explicit physical-parking decision owns the additional status.
  -- Sharing is restored exactly (including legacy NULL), never inferred.
  UPDATE public.attendees SET arrival_status = 'parked',
    share_with_attendees = v_attendee.share_with_attendees
    WHERE id = p_attendee_id;
  INSERT INTO public.arrival_parking_confirmations (
    idempotency_key, placement_history_id, requested_site_id,
    requested_master_site_id, requested_action, override_occupied_site,
    previous_has_arrived, previous_arrival_status
  ) VALUES (
    p_idempotency_key, v_placement.history_id, p_site_id, p_master_site_id,
    p_action, p_override_occupied_site, v_attendee.has_arrived, v_attendee.arrival_status
  );
  RETURN QUERY SELECT v_placement.outcome, v_placement.displaced_attendee_id, NULL::text;
END;
$$;
ALTER FUNCTION public.confirm_attendee_arrived_and_parked(uuid, uuid, text, uuid, uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_attendee_arrived_and_parked(uuid, uuid, text, uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_attendee_arrived_and_parked(uuid, uuid, text, uuid, uuid, uuid, boolean)
  TO authenticated;

COMMIT;
