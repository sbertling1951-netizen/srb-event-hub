-- Admin Check-In / Parking Ownership Cutover -- Stage A.
--
-- Forward-repairs complete_admin_checkin to Arrival-only, per the settled
-- architecture (docs/architecture/EPICENTRAX_SITE_PLACEMENT_IMPLEMENTATION_SPECIFICATION.md
-- §9.1; docs/architecture/EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md §4.1;
-- accepted at commit f8ddf4a "Clarify Check-In and Parking ownership"). Check-In
-- owns Arrival; Parking owns spatial placement; event.checkin.manage no
-- longer authorizes any placement action, direct or composed.
--
-- Every placement parameter (p_placement_action, p_site_id,
-- p_placement_idempotency_key, p_override_occupied_site) is removed --
-- complete_admin_checkin never calls public.record_site_placement again,
-- never writes public.attendees.assigned_site, and never accepts a
-- placement instruction of any shape. It updates Arrival-owned columns only
-- (has_arrived, arrival_status, share_with_attendees).
--
-- Arrival is now also subject to the canonical Event lifecycle mutability
-- guard, public.assert_event_lifecycle_mutable, evaluated after Authority is
-- fully established -- the same position this pattern already uses for
-- record_site_placement (see 20260814050000_enforce_site_placement_lifecycle.sql).
--
-- Signature change: the old 8-parameter overload (uuid, uuid, boolean,
-- boolean, text, uuid, uuid, boolean) is dropped rather than preserved as a
-- compatibility wrapper. A wrapper that still accepted placement parameters
-- would leave open exactly the doorway this cutover exists to close, so
-- app/admin/checkin/page.tsx is migrated to the new 4-parameter signature in
-- the same change.

BEGIN;

DROP FUNCTION IF EXISTS public.complete_admin_checkin(uuid, uuid, boolean, boolean, text, uuid, uuid, boolean);

CREATE FUNCTION public.complete_admin_checkin(
  p_attendee_id uuid,
  p_expected_event_id uuid,
  p_has_arrived boolean,
  p_share_with_attendees boolean
)
RETURNS TABLE(
  outcome text,
  event_id uuid,
  attendee_id uuid,
  share_with_attendees boolean,
  has_arrived boolean,
  arrival_status text,
  rejection_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event_id uuid;
BEGIN
  IF v_actor IS NULL OR p_attendee_id IS NULL OR p_expected_event_id IS NULL
     OR p_has_arrived IS NULL OR p_share_with_attendees IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT a.event_id INTO v_event_id
  FROM public.attendees AS a
  WHERE a.id = p_attendee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendee_not_found';
  END IF;

  -- Check-In owns Arrival. event.checkin.manage is the sole authorization
  -- basis for this operation -- event.parking.manage is deliberately not an
  -- alternate basis here: each module's task authority governs only its own
  -- operation (Site Assignment Governance Architecture §4.1). A user who
  -- holds both permissions still uses each module under its own authority.
  IF NOT public.has_event_task_authority('event.checkin.manage', v_event_id) THEN
    RAISE EXCEPTION 'authorization_denied';
  END IF;

  IF v_event_id <> p_expected_event_id THEN
    RAISE EXCEPTION 'event_scope_mismatch';
  END IF;

  -- Lifecycle. Authority is fully established above; evaluated after it,
  -- never before, matching every other gated domain (record_site_placement
  -- included). operational/post_event pass; archived raises
  -- 'event_archived'; an indeterminate Lifecycle raises
  -- 'event_lifecycle_indeterminate'.
  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  RETURN QUERY
  UPDATE public.attendees AS a
  SET share_with_attendees = p_share_with_attendees,
      has_arrived = p_has_arrived,
      arrival_status = CASE
        WHEN p_has_arrived AND a.arrival_status = 'parked' THEN 'parked'
        WHEN p_has_arrived THEN 'arrived'
        ELSE 'not_arrived'
      END
  WHERE a.id = p_attendee_id
  RETURNING
    'applied'::text, a.event_id, a.id, a.share_with_attendees, a.has_arrived,
    a.arrival_status, NULL::text;
END;
$$;

ALTER FUNCTION public.complete_admin_checkin(uuid, uuid, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_admin_checkin(uuid, uuid, boolean, boolean)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.complete_admin_checkin(uuid, uuid, boolean, boolean)
TO authenticated;

COMMIT;
