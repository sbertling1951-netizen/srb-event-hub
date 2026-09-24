-- Member roster policy approved by Pap on 2026-09-23.
-- See docs/architecture/EPICENTRAX_MEMBER_ROSTER_VISIBILITY.md.
-- Roster names do not require optional sharing by the viewer or target.
-- Preserve identity resolution, Event eligibility, optional-field masking,
-- return signature, ACLs, and the separate map roster. No consent writes.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_event_attendee_locator(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  pilot_first text,
  pilot_last text,
  email text,
  phone text,
  campsite_location text,
  coach_make text,
  coach_model text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_caller_attendee_id uuid;
BEGIN
  -- (A) Requester has legitimate Event access -- unchanged: the same
  -- identity resolver every attendee-facing RPC already shares.
  v_caller_attendee_id := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier
  );

  IF v_caller_attendee_id IS NULL THEN
    RETURN;
  END IF;

  -- Identity resolution is distinct from current roster eligibility. Verify
  -- the resolved registration belongs to this Event and is still current;
  -- the browser's former own-row check must not be an authorization boundary.
  IF NOT EXISTS (
    SELECT 1 FROM public.attendees AS caller
    WHERE caller.id = v_caller_attendee_id
      AND caller.event_id = p_event_id
      AND coalesce(caller.is_active, true) = true
      AND coalesce(caller.registration_status, '') IN ('active', 'registered')
  ) THEN
    RETURN;
  END IF;

  -- Names are Event roster information. Optional fields remain independently
  -- masked by the target's own preferences; absent preferences grant nothing.
  RETURN QUERY
  SELECT
    a.id,
    a.pilot_first,
    a.pilot_last,
    CASE WHEN email_pref.shared THEN a.email ELSE NULL END,
    CASE WHEN phone_pref.shared THEN coalesce(a.primary_phone, a.cell_phone) ELSE NULL END,
    CASE WHEN campsite_pref.shared THEN site.display_label ELSE NULL END,
    CASE WHEN coach_pref.shared THEN a.coach_manufacturer ELSE NULL END,
    CASE WHEN coach_pref.shared THEN a.coach_model ELSE NULL END
  FROM public.attendees AS a
  JOIN public.events AS e ON e.id = a.event_id
  LEFT JOIN public.attendee_sharing_preferences AS email_pref
    ON email_pref.attendee_id = a.id AND email_pref.field_key = 'email'
  LEFT JOIN public.attendee_sharing_preferences AS phone_pref
    ON phone_pref.attendee_id = a.id AND phone_pref.field_key = 'phone'
  LEFT JOIN public.attendee_sharing_preferences AS campsite_pref
    ON campsite_pref.attendee_id = a.id AND campsite_pref.field_key = 'campsite_location'
  LEFT JOIN public.attendee_sharing_preferences AS coach_pref
    ON coach_pref.attendee_id = a.id AND coach_pref.field_key = 'coach_make_model'
  LEFT JOIN public.parking_sites AS site
    ON site.event_id = a.event_id AND site.assigned_attendee_id = a.id
  WHERE a.event_id = p_event_id
    AND coalesce(a.is_active, true) = true
    AND coalesce(a.registration_status, '') IN ('active', 'registered')
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true;
END;
$$;

ALTER FUNCTION public.get_event_attendee_locator(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_event_attendee_locator(uuid, text, text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_attendee_locator(uuid, text, text) TO anon, authenticated;

COMMIT;
