-- Nearby Category Authority Stage B, Part 3: add canonical category
-- identity to the one governed member-facing read path.
--
-- public.resolve_effective_nearby_places(event_id) is the sole function
-- app/member/nearby/page.tsx calls (Nearby Knowledge + Tenant Curation
-- Foundation, §9) -- SECURITY DEFINER, owned by postgres, so it already
-- reads public.place_categories (SELECT revoked from every ordinary role,
-- including service_role) via table ownership, not a grant. No table
-- grant, RLS policy, or authority check changes here -- purely additive
-- output columns joined inside the already-governed function body.
--
-- Additive by construction: every existing output column keeps its exact
-- name/position; category_id/category_code/category_label are appended
-- after the existing `origin` column. The WHERE clause (event_id match,
-- is_hidden = false) is byte-for-byte unchanged -- member authorization
-- and TEA (anon) visibility semantics are untouched. The previously
-- disabled shared/Tenant central-catalog UNION branch stays disabled,
-- exactly as this function already was -- not re-enabled here.
--
-- LEFT JOIN, not INNER JOIN: event_nearby_places.category_id is nullable
-- (Stage A, and still nullable after Stage B -- see that migration's
-- companion report on why). An INNER JOIN would silently drop any place
-- with no category assigned, narrowing member-visible results -- an
-- authorization/visibility change this migration must not make.
--
-- CREATE OR REPLACE cannot change an existing function's RETURNS TABLE
-- column list, so this DROPs and recreates -- which also drops its
-- grants, reapplied identically below. Live-verified before writing this
-- migration: EXECUTE was held by both `authenticated` and `anon` (the
-- anon grant exists specifically for Temporary Event Access, added by
-- 20260819100000_grant_anon_execute_resolve_effective_nearby_places.sql)
-- and NOT by `service_role` -- all three reapplied to match exactly.

BEGIN;

DROP FUNCTION IF EXISTS public.resolve_effective_nearby_places(uuid);

CREATE FUNCTION public.resolve_effective_nearby_places(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  address text,
  phone text,
  website text,
  category text,
  notes text,
  distance_miles numeric,
  location_code text,
  is_hidden boolean,
  lat numeric,
  lng numeric,
  sort_order integer,
  origin text,
  category_id uuid,
  category_code text,
  category_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT enp.id, enp.name, enp.address, enp.phone, enp.website, enp.category, enp.notes,
         enp.distance_miles, enp.location_code, enp.is_hidden, enp.lat, enp.lng, enp.sort_order,
         'event_specific'::text AS origin,
         enp.category_id, pc.code AS category_code, pc.label AS category_label
  FROM public.event_nearby_places AS enp
  LEFT JOIN public.place_categories AS pc ON pc.id = enp.category_id
  WHERE enp.event_id = p_event_id
    AND enp.is_hidden = false;
END;
$function$;

ALTER FUNCTION public.resolve_effective_nearby_places(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_effective_nearby_places(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_effective_nearby_places(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_effective_nearby_places(uuid) TO anon;

COMMIT;
