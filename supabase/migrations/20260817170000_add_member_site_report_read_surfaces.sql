-- Member Check-In Site-Reporting Cutover -- Stage B, read surfaces.
--
-- Two narrow governed reads, per the settled architecture
-- (docs/architecture/EPICENTRAX_SITE_PLACEMENT_IMPLEMENTATION_SPECIFICATION.md
-- §9.2 items 8-9):
--
-- 1. get_my_confirmed_site_placement: lets Member Check-In display a
--    "Confirmed site" sourced only from canonical parking_sites occupancy
--    (joined to master_map_sites for its label) -- never from
--    attendees.assigned_site and never from a member report. It reuses
--    the same public.resolve_temporary_or_authenticated_attendee identity
--    boundary get_my_attendee_record and get_my_household_members already
--    use for member self-service reads, with the identical grant shape
--    (anon, authenticated). It returns zero rows when the attendee is
--    unplaced or verification fails -- it never invents a placement.
-- 2. get_member_site_reports_for_event: the narrowest authorized Parking
--    surface for staff to see relevant Member-reported site evidence
--    (§9.2 item 8). It is a pure read: it authorizes on
--    event.parking.manage only -- the same authority record_site_placement
--    itself requires -- and returns evidence rows only. It cannot write,
--    confirm, or correct placement; any staff action that does so must
--    still separately invoke record_site_placement.

BEGIN;

CREATE FUNCTION public.get_my_confirmed_site_placement(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(
  parking_site_id uuid,
  master_site_id uuid,
  site_number text,
  display_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_verified_attendee_id uuid;
BEGIN
  v_verified_attendee_id := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier
  );

  IF v_verified_attendee_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ps.id,
    ps.master_site_id,
    mms.site_number,
    mms.display_label
  FROM public.parking_sites AS ps
  LEFT JOIN public.master_map_sites AS mms
    ON mms.id = ps.master_site_id
  WHERE ps.event_id = p_event_id
    AND ps.assigned_attendee_id = v_verified_attendee_id;
END;
$$;

ALTER FUNCTION public.get_my_confirmed_site_placement(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_confirmed_site_placement(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_confirmed_site_placement(uuid, text, text) TO anon, authenticated;

CREATE FUNCTION public.get_member_site_reports_for_event(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  attendee_id uuid,
  raw_reported_value text,
  normalized_reported_value text,
  matched_master_site_id uuid,
  matched_site_label text,
  authorization_basis text,
  reported_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- event.parking.manage only -- the identical authority
  -- record_site_placement itself requires (Admin Check-In / Parking
  -- ownership cutover Stage A). This read never substitutes for it: it
  -- returns evidence rows only, and no caller can use this function's
  -- result to establish, change, or confirm placement.
  IF NOT public.has_event_task_authority('event.parking.manage', p_event_id) THEN
    RAISE EXCEPTION 'authorization_denied';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.attendee_id,
    r.raw_reported_value,
    r.normalized_reported_value,
    r.matched_master_site_id,
    coalesce(mms.display_label, mms.site_number),
    r.authorization_basis,
    r.reported_at
  FROM public.member_site_reports AS r
  LEFT JOIN public.master_map_sites AS mms
    ON mms.id = r.matched_master_site_id
  WHERE r.event_id = p_event_id
  ORDER BY r.reported_at DESC;
END;
$$;

ALTER FUNCTION public.get_member_site_reports_for_event(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_member_site_reports_for_event(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_member_site_reports_for_event(uuid) TO authenticated;

COMMIT;
