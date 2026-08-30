-- Add geographic Area identity to the Reusable Area List candidate read.
--
-- Problem this solves. `public.list_nearby_master_places_for_area_list`
-- (20260825000000) is the read behind the "Add eligible Stored Place"
-- picker in `components/nearby/NearbyAreaListManager.tsx`. It returns every
-- active + approved canonical `nearby_master` row the caller is authorized
-- to add to the selected Area List, filtered ONLY by scope -- with no
-- organization -- so the picker renders one flat alphabetical dump mixing
-- places from every geographic Area (Amana, Branson, Gulf Shores,
-- Saint George, ...). Admins cannot tell where a candidate belongs.
--
-- What changes. Purely additive output. `nearby_master.area_id` (->
-- `public.nearby_areas`) is the existing, populated geographic-grouping
-- concept in this schema (it is written by `app/admin/nearby/page.tsx`'s
-- Stored Area panel and read there via `WHERE area_id = ...`). This
-- migration surfaces it on the candidate read so the browser can present
-- Area -> marker type -> place, with an "Unassigned" group for rows whose
-- `area_id` is NULL. Two columns are appended AFTER the existing six:
--   area_id   uuid  -- nearby_master.area_id, or NULL
--   area_name text  -- nearby_areas.name for that area_id, or NULL
--
-- What is deliberately NOT changed:
--   * the authority gate -- `assert_nearby_area_list_management_authority`
--     (shared list -> Platform Admin; tenant list -> tenant admin) still
--     runs first and unchanged;
--   * the eligibility / scope predicate -- byte-identical WHERE clause.
--     This migration does NOT narrow what an admin is authorized to see
--     merely because a row belongs to another geographic Area. Cross-Area
--     (and, per the ratified Nearby Scope Model, cross-Tenant shared)
--     visibility stays intentional; the change is display organization,
--     not an authority restriction;
--   * `nearby_area_lists` -- no `nearby_area_id` column, no Area/List M:N,
--     no Area-List geography schema of any kind is introduced. The Area
--     shown is the CANDIDATE PLACE's own `nearby_master.area_id`, never a
--     property of the list;
--   * membership writes -- `set_nearby_area_list_membership` is untouched
--     and remains the only path that adds a place to a list;
--   * the member Nearby resolver, Stored Area contribution/canonical
--     split, Google Place-ID reuse, and Event association model -- none
--     are read or written here.
--
-- `CREATE OR REPLACE FUNCTION` cannot change an existing `RETURNS TABLE`
-- column list, so this is a transactional DROP + CREATE. The owner and the
-- exact REVOKE/GRANT posture 20260825000000 established are reapplied
-- verbatim -- the same approach 20260821230000 used when it appended
-- category identity columns to the member Nearby resolver.
--
-- RUNTIME: verified. A fresh from-zero replay of the entire migration
-- chain (npm run db:verify-replay) applied all 223 migrations including
-- this one with no errors, and the linked BEGIN..ROLLBACK fixture
-- (supabase/integration-tests/20260914000000_area_identity_area_list_
-- candidate_read_rollback.sql) was executed against that disposable local
-- database: the authority gate, the byte-preserved eligibility predicate,
-- the Area identity join, the Unassigned (NULL area_id) row, and the
-- eight-column shape all held, and the fixture rolled back leaving no
-- residue. Production database and production migration ledger were not
-- touched.

BEGIN;

-- ============================================================
-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

DROP FUNCTION public.list_nearby_master_places_for_area_list(uuid);

CREATE FUNCTION public.list_nearby_master_places_for_area_list(
  p_area_list_id uuid
)
RETURNS TABLE (
  nearby_master_id uuid,
  name text,
  category_id uuid,
  category_label text,
  scope text,
  tenant_id uuid,
  area_id uuid,
  area_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_list public.nearby_area_lists%ROWTYPE;
BEGIN
  v_list := public.assert_nearby_area_list_management_authority(p_area_list_id);

  RETURN QUERY
  SELECT nm.id, nm.name, nm.category_id, pc.label, nm.scope, nm.tenant_id,
         na.id, na.name
  FROM public.nearby_master AS nm
  LEFT JOIN public.place_categories AS pc ON pc.id = nm.category_id
  LEFT JOIN public.nearby_areas AS na ON na.id = nm.area_id
  WHERE nm.status = 'active'
    AND nm.review_status = 'approved'
    AND (
      (v_list.scope = 'shared_public' AND nm.scope = 'shared_public')
      OR (
        v_list.scope = 'tenant_specific'
        AND (nm.scope = 'shared_public' OR nm.tenant_id = v_list.tenant_id)
      )
    )
  ORDER BY (na.name IS NULL), na.name, (pc.label IS NULL), pc.label, nm.name;
END;
$function$;

ALTER FUNCTION public.list_nearby_master_places_for_area_list(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_nearby_master_places_for_area_list(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.list_nearby_master_places_for_area_list(uuid)
  TO authenticated;

-- ============================================================
-- PARITY END
-- ============================================================

COMMIT;
