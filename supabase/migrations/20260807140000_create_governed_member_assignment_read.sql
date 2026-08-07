-- Governed member Assignment read boundary.
--
-- public.assignments was introduced with deny-all RLS posture in
-- 20260804140000_create_responsibility_and_assignment_foundation.sql and no
-- member-facing read path. This migration adds exactly one governed
-- SECURITY DEFINER RPC for self-read of active Assignment summaries.
--
-- Identity + Participation gate:
--   Reuses public.resolve_temporary_or_authenticated_attendee(...) unchanged,
--   exactly as the existing governed member reads do.
--
-- Boundary behavior:
--   1) resolver returns NULL           -> return no rows (wrapping API maps to
--                                        invalid_session)
--   2) attendee.person_id is NULL      -> return one identity_unavailable row
--   3) person resolved, zero active
--      Assignments                     -> return one resolved row with id
--                                        NULL (a governed-confirmed-zero
--                                        sentinel -- a bare zero-row result
--                                        would otherwise be indistinguishable
--                                        from the invalid_session case above)
--   4) person resolved, one or more
--      active Assignments              -> return one resolved row per active
--                                        Assignment summary (label + id +
--                                        attributed_at only)
--
-- No Person/Tenant/Assignment identifiers are accepted from caller input.
-- Tenant is derived from events.tenant_id and independently re-verified
-- against assignments.tenant_id.

CREATE OR REPLACE FUNCTION public.get_my_active_assignments(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(
  status text,
  id uuid,
  responsibility_label text,
  attributed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_verified_attendee_id uuid;
  v_person_id uuid;
  v_event_tenant_id uuid;
  v_assignment_count integer;
BEGIN
  v_verified_attendee_id := public.resolve_temporary_or_authenticated_attendee(
    p_event_id,
    p_event_code,
    p_registration_identifier
  );

  IF v_verified_attendee_id IS NULL THEN
    RETURN;
  END IF;

  SELECT a.person_id
    INTO v_person_id
  FROM public.attendees AS a
  WHERE a.id = v_verified_attendee_id
    AND a.event_id = p_event_id;

  IF v_person_id IS NULL THEN
    RETURN QUERY
    SELECT
      'identity_unavailable'::text,
      NULL::uuid,
      NULL::text,
      NULL::timestamptz;
    RETURN;
  END IF;

  SELECT e.tenant_id
    INTO v_event_tenant_id
  FROM public.events AS e
  WHERE e.id = p_event_id;

  IF v_event_tenant_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*)
    INTO v_assignment_count
  FROM public.assignments AS a
  WHERE a.person_id = v_person_id
    AND a.event_id = p_event_id
    AND a.status = 'active'
    AND a.tenant_id = v_event_tenant_id;

  IF v_assignment_count = 0 THEN
    -- A resolved Person with zero active Assignments is a governed-
    -- confirmed zero, not the same outcome as an unverifiable session.
    -- Without this sentinel row, a bare zero-row result here would be
    -- indistinguishable from the invalid_session branches above.
    RETURN QUERY
    SELECT
      'resolved'::text,
      NULL::uuid,
      NULL::text,
      NULL::timestamptz;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    'resolved'::text AS status,
    a.id,
    r.label AS responsibility_label,
    a.attributed_at
  FROM public.assignments AS a
  JOIN public.responsibilities AS r
    ON r.id = a.responsibility_id
  WHERE a.person_id = v_person_id
    AND a.event_id = p_event_id
    AND a.status = 'active'
    AND a.tenant_id = v_event_tenant_id
    AND r.tenant_id = v_event_tenant_id
  ORDER BY a.attributed_at DESC;
END;
$function$;

ALTER FUNCTION public.get_my_active_assignments(uuid, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_my_active_assignments(uuid, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_my_active_assignments(uuid, text, text)
TO anon, authenticated;
