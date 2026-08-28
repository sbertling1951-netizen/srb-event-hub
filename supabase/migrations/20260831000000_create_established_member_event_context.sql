-- Member Event Context Stage 2: governed established-context validation.
--
-- Stage 1 (20260830000000) made resolve_temporary_or_authenticated_attendee's
-- authenticated branch correctly stop treating events.is_active/
-- visible_to_members as established-context revocation. Stage 2 promotes a
-- governed server-side check of "is my persisted Event still a valid
-- established workspace" into the live Member route/workspace path, so
-- browser localStorage stops being the final authority on that question.
--
-- The existing get_my_member_event_continuity_context already implements the
-- correct established-context predicate (Event exists via its JOIN, eligible
-- participation, Tenant active -- no lifecycle/visibility read at all), but
-- it answers only "found or not," which is enough for its one existing
-- caller (getActiveEvent()) but not enough to distinguish, for the new
-- route-guard/workspace-provider caller, between the Event genuinely not
-- existing and this Person's participation no longer being valid -- two
-- different outcomes this stage's client-side UX must be able to tell apart
-- (per the Stage 2 handoff's explicit outcome set: VALID /
-- INVALID_AUTHORIZATION / EVENT_MISSING / NO_CONTEXT / error). NO_CONTEXT
-- (no persisted Event selection at all) is a client-side fact checked before
-- this function is ever called and is not one of this function's outcomes.
--
-- This function is purpose-built for that one governed check, callable only
-- by an authenticated Member (there is no Temporary Event Access use case
-- for it -- Temporary Access continues to re-derive its own authority via
-- resolve_temporary_or_authenticated_attendee's unauthenticated branch,
-- unchanged and untouched by this migration).

CREATE FUNCTION public.get_my_established_event_context(
  p_event_id uuid
)
RETURNS TABLE(
  outcome text,
  id uuid,
  name text,
  venue_name text,
  location text,
  start_date date,
  end_date date,
  lat numeric,
  lng numeric,
  map_image_url text,
  master_map_id uuid,
  coach_map_open_scale numeric,
  short_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_link_status text;
  v_person_id uuid;
  v_event_exists boolean;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN QUERY SELECT 'invalid_authorization'::text,
      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::date, NULL::date,
      NULL::numeric, NULL::numeric, NULL::text, NULL::uuid, NULL::numeric, NULL::text;
    RETURN;
  END IF;

  SELECT r.status, r.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(auth.uid()) AS r;

  -- No resolved Person link at all (unauthenticated, no link, or an
  -- ambiguous account state) is a fail-closed authorization condition here,
  -- not a distinct outcome this function's callers need to branch on
  -- separately -- resolve_current_auth_person_link already gives the caller
  -- its own account-level diagnosis before this function is ever reached.
  IF v_link_status IS DISTINCT FROM 'resolved' THEN
    RETURN QUERY SELECT 'invalid_authorization'::text,
      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::date, NULL::date,
      NULL::numeric, NULL::numeric, NULL::text, NULL::uuid, NULL::numeric, NULL::text;
    RETURN;
  END IF;

  -- Existence check deliberately ignores events.is_active,
  -- events.visible_to_members, and events.status -- Stage 1's governing
  -- rule. Only genuine non-existence (or the owning Tenant itself being
  -- deactivated under ADR-014) makes an Event "missing" here.
  SELECT EXISTS (
    SELECT 1
    FROM public.events AS e
    JOIN public.tenants AS t ON t.id = e.tenant_id
    WHERE e.id = p_event_id
      AND t.is_active = true
  ) INTO v_event_exists;

  IF NOT v_event_exists THEN
    RETURN QUERY SELECT 'event_missing'::text,
      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::date, NULL::date,
      NULL::numeric, NULL::numeric, NULL::text, NULL::uuid, NULL::numeric, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    'valid'::text,
    e.id,
    e.name,
    e.venue_name,
    e.location,
    e.start_date,
    e.end_date,
    e.lat,
    e.lng,
    e.map_image_url,
    e.master_map_id,
    e.coach_map_open_scale,
    e.short_name
  FROM public.person_event_participations AS pep
  JOIN public.events AS e ON e.id = pep.event_id
  JOIN public.tenants AS t ON t.id = e.tenant_id
  WHERE pep.person_id = v_person_id
    AND pep.event_id = p_event_id
    AND pep.participation_state = 'eligible'
    AND t.is_active = true;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid_authorization'::text,
      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::date, NULL::date,
      NULL::numeric, NULL::numeric, NULL::text, NULL::uuid, NULL::numeric, NULL::text;
  END IF;
END;
$function$;

ALTER FUNCTION public.get_my_established_event_context(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_my_established_event_context(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_established_event_context(uuid)
  TO authenticated;
