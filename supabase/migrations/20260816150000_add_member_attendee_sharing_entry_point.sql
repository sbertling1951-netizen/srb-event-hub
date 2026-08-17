-- Closes the member self-service seam left open by
-- 20260816140000_create_attendee_sharing_governed_foundation.sql: that
-- migration built the governed preference model and an Admin Check-In
-- entry point, but Member Check-In (submit_member_checkin) still wrote
-- only the legacy attendees.share_with_attendees boolean. This adds the
-- member-authority entry point the internal helper was always shaped to
-- support, without touching submit_member_checkin itself and without
-- creating a second preference model: it validates identity through the
-- same resolve_temporary_or_authenticated_attendee boundary every other
-- member-facing attendee RPC already uses, then calls the identical
-- _apply_attendee_sharing_preferences helper Admin Check-In calls, tagged
-- source = 'member_self_service'.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_member_attendee_sharing_preferences(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL,
  p_shared_field_keys text[] DEFAULT ARRAY[]::text[]
)
RETURNS TABLE(
  outcome text,
  attendee_id uuid,
  shared_field_keys text[],
  rejection_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_attendee_id uuid;
BEGIN
  v_attendee_id := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier
  );

  IF v_attendee_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT * FROM public._apply_attendee_sharing_preferences(
    v_attendee_id, p_shared_field_keys, 'member_self_service', NULL, auth.uid()
  );
END;
$$;

ALTER FUNCTION public.set_member_attendee_sharing_preferences(uuid, text, text, text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_attendee_sharing_preferences(uuid, text, text, text[])
FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.set_member_attendee_sharing_preferences(uuid, text, text, text[])
TO anon, authenticated;

COMMIT;
