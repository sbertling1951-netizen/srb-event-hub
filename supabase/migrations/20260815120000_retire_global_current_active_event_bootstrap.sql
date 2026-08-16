BEGIN;

CREATE FUNCTION public.get_public_discoverable_events_for_tenant(p_tenant_id uuid)
RETURNS TABLE(
  id uuid, name text, venue_name text, location text, start_date date, end_date date,
  map_image_url text, master_map_id uuid, locations_map_open_scale numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public
AS $$
BEGIN
  RETURN QUERY SELECT e.id, e.name, e.venue_name, e.location, e.start_date, e.end_date,
    e.map_image_url, e.master_map_id, e.locations_map_open_scale
  FROM public.events e
  WHERE e.tenant_id = p_tenant_id
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true
    AND lower(trim(coalesce(e.status, ''))) NOT IN ('inactive', 'archived', 'complete', 'completed', 'closed', 'draft')
  ORDER BY e.start_date ASC NULLS LAST;
END;
$$;

ALTER FUNCTION public.get_public_discoverable_events_for_tenant(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_public_discoverable_events_for_tenant(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_discoverable_events_for_tenant(uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_current_active_event() FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.get_current_active_event();

COMMIT;
