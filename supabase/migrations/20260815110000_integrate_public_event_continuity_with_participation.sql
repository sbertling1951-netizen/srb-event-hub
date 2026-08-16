-- Public Event Continuity integration on canonical Person x Event Participation.
--
-- Splits public known-ID continuity from authenticated Member continuity and
-- binds tenant ownership validation to the caller's canonical Participation.
-- Event lifecycle and registration state intentionally do not appear in the
-- Member or tenant-ownership predicates.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_member_event_continuity_context(
  p_event_id uuid
)
RETURNS TABLE(
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
SET search_path TO pg_catalog
AS $$
DECLARE
  v_link_status text;
  v_person_id uuid;
BEGIN
  SELECT r.status, r.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(auth.uid()) r;

  IF v_link_status IS DISTINCT FROM 'resolved' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
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
  FROM public.person_event_participations pep
  JOIN public.events e ON e.id = pep.event_id
  WHERE pep.person_id = v_person_id
    AND pep.event_id = p_event_id
    AND pep.participation_state = 'eligible';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_event_continuity_context(
  p_event_id uuid
)
RETURNS TABLE(
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
SET search_path TO pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
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
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true
    AND lower(trim(coalesce(e.status, ''))) NOT IN (
      'inactive', 'archived', 'complete', 'completed', 'closed', 'draft'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tenant_owned_event_ids(
  p_event_ids uuid[],
  p_tenant_id uuid
)
RETURNS TABLE(id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_link_status text;
  v_person_id uuid;
BEGIN
  IF p_event_ids IS NULL OR p_tenant_id IS NULL THEN
    RETURN;
  END IF;

  SELECT r.status, r.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(auth.uid()) r;

  IF v_link_status IS DISTINCT FROM 'resolved' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT e.id
  FROM public.person_event_participations pep
  JOIN public.events e ON e.id = pep.event_id
  WHERE pep.person_id = v_person_id
    AND pep.participation_state = 'eligible'
    AND e.id = ANY(p_event_ids)
    AND e.tenant_id = p_tenant_id;
END;
$$;

ALTER FUNCTION public.get_my_member_event_continuity_context(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_event_continuity_context(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_tenant_owned_event_ids(uuid[], uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_my_member_event_continuity_context(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_event_continuity_context(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_tenant_owned_event_ids(uuid[], uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_my_member_event_continuity_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_continuity_context(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_owned_event_ids(uuid[], uuid) TO authenticated;

COMMIT;
