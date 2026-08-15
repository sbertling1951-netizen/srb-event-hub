-- Public Event Read Surface Split -- add short_name to the Known-Context
-- Event Continuity contract.
--
-- Classification audit (LEM, 2026-08-14) found one more non-admin direct
-- public.events reader: components/shell/adapters/MemberShellAdapter.tsx,
-- which reads a single supplementary field (short_name) for the Event
-- its Member workspace has already resolved (event.id from
-- useMemberWorkspace()) -- textbook known-context continuity, the same
-- shape already governed by get_event_continuity_context. The only
-- reason it isn't already migrated is that the function doesn't project
-- short_name.
--
-- DROP FUNCTION + CREATE FUNCTION is used, not CREATE OR REPLACE:
-- confirmed live against the linked project that PostgreSQL rejects
-- CREATE OR REPLACE FUNCTION for any RETURNS TABLE column-list change,
-- including a pure append ("cannot change return type of existing
-- function", SQLSTATE 42P13) -- there is no in-place-append allowance for
-- this construct. short_name is added after coach_map_open_scale in the
-- freshly created function; the WHERE id = p_event_id predicate,
-- SECURITY DEFINER, and search_path are otherwise unchanged from
-- 20260814160000's original.
--
-- DROP FUNCTION removes the function object and its ACL entirely, so
-- 20260814160000's REVOKE ALL FROM PUBLIC / GRANT EXECUTE TO anon,
-- authenticated, and 20260814170000's REVOKE ... FROM service_role are
-- explicitly re-stated here rather than assumed to carry forward --
-- unlike a true CREATE OR REPLACE, a drop-and-recreate does not preserve
-- prior grants.
--
-- No consumer is migrated by this migration. MemberShellAdapter.tsx
-- itself is not touched here (out of scope for a read-governance-only
-- change) and is not one of the files ADR-011 §18 lists as
-- implementation-locked.

BEGIN;

DROP FUNCTION public.get_event_continuity_context(uuid);

CREATE FUNCTION public.get_event_continuity_context(p_event_id uuid)
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
SET search_path TO 'public'
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
  WHERE e.id = p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_continuity_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_continuity_context(uuid) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_event_continuity_context(uuid) FROM service_role;

COMMIT;
