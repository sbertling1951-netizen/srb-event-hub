-- Member Check-In restores the member's last saved report independently of
-- staff-confirmed placement. Reuse the existing verified member identity
-- boundary, including temporary capabilities; accept no attendee ID.
BEGIN;

CREATE FUNCTION public.get_my_latest_site_report(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(raw_reported_value text, reported_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_attendee_id uuid;
BEGIN
  v_attendee_id := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier
  );
  IF v_attendee_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT r.raw_reported_value, r.reported_at
  FROM public.member_site_reports r
  WHERE r.event_id = p_event_id AND r.attendee_id = v_attendee_id
  ORDER BY r.reported_at DESC, r.id DESC
  LIMIT 1;
END;
$$;

ALTER FUNCTION public.get_my_latest_site_report(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_latest_site_report(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_latest_site_report(uuid, text, text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_my_latest_site_report(uuid, text, text) IS
  'Returns only the verified member''s latest site report in the requested Event. Read-only evidence; never confirmed placement.';

COMMIT;
