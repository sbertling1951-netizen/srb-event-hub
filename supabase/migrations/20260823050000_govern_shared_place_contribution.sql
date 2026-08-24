-- Nearby Event/Tenant/Shared Scope Model -- Stage 0: Shared-place
-- provenance + shared-contribution authority correction.
--
-- Implements exactly the two architectural changes approved for Stage 0
-- of "Nearby Scope Model" (Event Only / Tenant / Shared, accepted
-- 2026-08-23): preserve which Tenant contributed a Shared place, and let
-- an authorized Tenant Admin propose one, without touching approval,
-- Tenant-scoped behavior, or any raw-write/RLS surface. Stage 1
-- (governed update/retire RPCs), Stage 2 (per-place Event association),
-- and the unified editor are explicitly NOT part of this migration.
--
-- ---------------------------------------------------------------------------
-- 1. public.nearby_master.contributed_by_tenant_id -- provenance,
--    deliberately separate from tenant_id.
-- ---------------------------------------------------------------------------
--
-- tenant_id already means "exclusive owner" for a tenant_specific row,
-- and nearby_master_scope_tenant_consistency (20260811120000) already
-- correctly forces it NULL for shared_public -- that CHECK is untouched
-- here, not weakened, not rewritten. The consequence of that (correct)
-- constraint is that tenant_id can never also carry "which Tenant
-- proposed this" once a place is shared_public -- the two questions
-- ("who exclusively owns this" and "who originally contributed this")
-- need two columns, not one overloaded one.
--
-- contributed_by_tenant_id is nullable, has no default, and is added
-- with no backfill: every existing row (tenant_specific or shared_public)
-- gets NULL, because no existing row's true original contributor can be
-- deterministically proven from stored data alone -- fabricating one
-- would be inventing provenance, which the approved design explicitly
-- forbids. NULL here means "contributor not recorded," not "platform-
-- authored" or any other implied fact.
--
-- Tenant-scoped (tenant_specific) rows deliberately do NOT stamp this
-- column going forward either (enforced by the CHECK below, not just by
-- convention). tenant_id already unambiguously answers "who contributed
-- this" for a tenant_specific row -- there is no gap to fill, and
-- duplicating that value into a second column would be a new invariant
-- to keep in sync for zero additional information, which is exactly the
-- "broaden scope merely for symmetry" the approved design says to avoid.
-- contributed_by_tenant_id exists solely to fill the one real gap:
-- shared_public rows, where tenant_id is (correctly) always NULL.

ALTER TABLE public.nearby_master
  ADD COLUMN contributed_by_tenant_id uuid REFERENCES public.tenants(id);

ALTER TABLE public.nearby_master
  ADD CONSTRAINT nearby_master_contributed_by_tenant_scope_check CHECK (
    contributed_by_tenant_id IS NULL OR scope = 'shared_public'
  );

-- Matches the existing tenant_id_idx precedent immediately above it in
-- the schema's history (nearby_master_tenant_id_idx, 20260811120000):
-- partial, non-NULL-only, for the same "which places did this Tenant
-- touch" query shape.
CREATE INDEX nearby_master_contributed_by_tenant_id_idx
  ON public.nearby_master (contributed_by_tenant_id)
  WHERE contributed_by_tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. public.record_tenant_place -- shared_public proposal authority only.
-- ---------------------------------------------------------------------------
--
-- Only the shared_public branch's authority check and the INSERT's
-- column list change. Every other line -- signature, the tenant_specific
-- branch (authority check, its own dedicated tenant_id-required guard),
-- validation, review_status derivation, created_by/reviewed_by/
-- reviewed_at behavior -- is byte-identical to the live function
-- (20260811120000).
--
-- Authority: has_platform_admin_authority(auth.uid()) ->
-- has_tenant_admin_authority(auth.uid(), p_tenant_id). Verified against
-- the live definition (20260810110000) before this change: that function
-- already returns true for an active Super Admin as its first branch,
-- before ever consulting admin_tenant_access -- so Super Admin continues
-- to propose shared_public candidates through the exact same hierarchy
-- primitive, not a second/parallel check. No new authority helper is
-- introduced; no raw grant is broadened; RLS is untouched (nearby_master
-- carries none, and none is added here -- that remains Stage 1+
-- territory).
--
-- p_tenant_id was already this function's own parameter -- the Tenant
-- being proposed on behalf of -- so contributed_by_tenant_id derives
-- from it directly. No new client-supplied parameter was needed or
-- added.
--
-- Publication is unaffected: v_review_status still forces 'pending_review'
-- for shared_public (unchanged expression), tenant_id is still forced
-- NULL for shared_public (unchanged expression), and
-- public.review_shared_place -- the only legal review-state transition --
-- is not modified by this migration at all: it keeps its own
-- has_platform_admin_authority(auth.uid()) gate exactly as before. A
-- Tenant Admin proposing a candidate can never thereby approve it.
CREATE OR REPLACE FUNCTION public.record_tenant_place(
  p_scope text,
  p_name text,
  p_tenant_id uuid DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_place_id uuid;
  v_review_status text;
BEGIN
  IF p_scope = 'shared_public' THEN
    IF NOT public.has_tenant_admin_authority(auth.uid(), p_tenant_id) THEN
      RAISE EXCEPTION 'record_tenant_place: caller is not an active Tenant Admin (or Super Admin) for tenant %', p_tenant_id;
    END IF;
  ELSIF p_scope = 'tenant_specific' THEN
    IF NOT public.has_tenant_admin_authority(auth.uid(), p_tenant_id) THEN
      RAISE EXCEPTION 'record_tenant_place: caller is not an active Tenant Admin (or Super Admin) for tenant %', p_tenant_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'record_tenant_place: scope must be shared_public or tenant_specific, got %', p_scope;
  END IF;

  IF p_scope = 'tenant_specific' AND p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'record_tenant_place: tenant_specific places require a tenant_id';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'record_tenant_place: name is required';
  END IF;

  v_review_status := CASE WHEN p_scope = 'shared_public' THEN 'pending_review' ELSE 'approved' END;

  INSERT INTO public.nearby_master (
    name, address, category, category_id, description, lat, lng, link, phone,
    status, scope, tenant_id, contributed_by_tenant_id, source_type, evidence_quality,
    review_status, reviewed_by, reviewed_at, created_by
  ) VALUES (
    p_name, p_address, p_category, p_category_id, p_notes, p_lat, p_lng, p_website, p_phone,
    'active', p_scope,
    CASE WHEN p_scope = 'tenant_specific' THEN p_tenant_id ELSE NULL END,
    CASE WHEN p_scope = 'shared_public' THEN p_tenant_id ELSE NULL END,
    'tenant_submitted', 'external', v_review_status,
    CASE WHEN v_review_status = 'approved' THEN auth.uid()::text ELSE NULL END,
    CASE WHEN v_review_status = 'approved' THEN now() ELSE NULL END,
    auth.uid()::text
  )
  RETURNING id INTO v_place_id;

  RETURN v_place_id;
END;
$function$;

-- CREATE OR REPLACE FUNCTION preserves the existing grant state for an
-- unchanged signature -- REVOKE ALL FROM ... / GRANT EXECUTE TO
-- authenticated (20260811120000) already holds and is not reissued here,
-- so this migration cannot be misread as changing who may call this
-- function versus who may merely read its new authority behavior.
