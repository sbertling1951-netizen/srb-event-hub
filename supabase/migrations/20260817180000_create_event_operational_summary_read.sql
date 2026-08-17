-- Canonical Event Operational Summary Read Contract.
--
-- docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md, section
-- "Canonical Event Operational Summary Read Contract" (accepted amendment,
-- August 17, 2026). One governed, Event-ID-scoped database read for the
-- eight settled cross-domain aggregates, so Attendees, Check-In, Parking,
-- and (later) Reports stop each recomputing an identically labelled fact
-- from whichever local rows a page happened to load.
--
-- Authority: public.has_event_task_authority, gated on any of the four
-- existing Event-scoped read capabilities the contract names as its
-- authorized consumers -- event.attendees.view, event.checkin.view,
-- event.parking.view, event.reports.view. No new task key, no client
-- permission cache, no caller-supplied role. Fails closed (RAISE
-- EXCEPTION) for a missing Event id or an Event the caller holds none of
-- those four capabilities on, including an unknown Event id (the shared
-- resolve_task_authority denies with event_or_tenant_not_found before any
-- capability check runs).
--
-- Canonical sources, exactly as the contract states them:
--   * Registration facts (Total/Active/Cancelled/Inactive Registrations)
--     come from attendees.registration_status and attendees.is_active.
--   * Arrival (Active Arrived/Not Arrived) comes from the Check-In-owned
--     attendees.has_arrived boolean.
--   * Placement (Current Placements, Active Needs-Parking/Unplaced) comes
--     only from parking_sites.assigned_attendee_id occupancy.
--     attendees.assigned_site never appears in this function and is never
--     read by it.
--   * No person_event_participations, household-role, or capacity table is
--     read here -- registration counts are attendees rows, not People.
--
-- has_arrived and needs_parking are nullable columns; `IS TRUE` /
-- `IS NOT TRUE` are used instead of boolean equality so a NULL is treated
-- as "not arrived" / "does not need parking" rather than silently
-- disappearing from both sides of a partition.

BEGIN;

CREATE FUNCTION public.get_event_operational_summary(p_event_id uuid)
RETURNS TABLE(
  event_id uuid,
  total_registrations bigint,
  active_registrations bigint,
  cancelled_registrations bigint,
  inactive_registrations bigint,
  active_arrived bigint,
  active_not_arrived bigint,
  current_placements bigint,
  active_needs_parking_unplaced bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Reuse of the existing Attendees/Check-In/Parking/Reports read
  -- vocabulary the contract names, not a new parallel admin-role test.
  IF NOT (
    public.has_event_task_authority('event.attendees.view', p_event_id)
    OR public.has_event_task_authority('event.checkin.view', p_event_id)
    OR public.has_event_task_authority('event.parking.view', p_event_id)
    OR public.has_event_task_authority('event.reports.view', p_event_id)
  ) THEN
    RAISE EXCEPTION 'authorization_denied';
  END IF;

  RETURN QUERY
  SELECT
    p_event_id,
    count(*),
    count(*) FILTER (
      WHERE a.registration_status IS DISTINCT FROM 'cancelled' AND a.is_active
    ),
    count(*) FILTER (WHERE a.registration_status = 'cancelled'),
    count(*) FILTER (
      WHERE a.registration_status IS DISTINCT FROM 'cancelled' AND NOT a.is_active
    ),
    count(*) FILTER (
      WHERE a.registration_status IS DISTINCT FROM 'cancelled'
        AND a.is_active
        AND a.has_arrived IS TRUE
    ),
    count(*) FILTER (
      WHERE a.registration_status IS DISTINCT FROM 'cancelled'
        AND a.is_active
        AND a.has_arrived IS NOT TRUE
    ),
    (
      SELECT count(*)
      FROM public.parking_sites AS ps
      WHERE ps.event_id = p_event_id
        AND ps.assigned_attendee_id IS NOT NULL
    ),
    count(*) FILTER (
      WHERE a.registration_status IS DISTINCT FROM 'cancelled'
        AND a.is_active
        AND a.needs_parking IS TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM public.parking_sites AS ps2
          WHERE ps2.event_id = p_event_id
            AND ps2.assigned_attendee_id = a.id
        )
    )
  FROM public.attendees AS a
  WHERE a.event_id = p_event_id;
END;
$$;

ALTER FUNCTION public.get_event_operational_summary(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_event_operational_summary(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_operational_summary(uuid) TO authenticated;

COMMIT;
