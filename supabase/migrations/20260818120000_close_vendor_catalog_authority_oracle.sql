-- Close Vendor Catalog Arbitrary-UID Authority Oracle.
--
-- Context: 20260818110000 added the self-scoped
-- public.has_my_vendor_catalog_admin_authority() wrapper because the
-- existing public.has_vendor_catalog_admin_authority(_uid uuid)
-- (20260814080000) takes an arbitrary uid with no auth.uid() check and
-- is GRANT EXECUTE'd to authenticated -- an authenticated client could
-- already call supabase.rpc("has_vendor_catalog_admin_authority", {
-- _uid: "<any uuid>" }) and learn a different admin's Vendor Catalog
-- authority. Adding the self-scoped wrapper alone does not close that
-- exposure -- the arbitrary-uid function remained directly callable.
-- This migration closes it.
--
-- INVENTORY (repository-wide grep, the same static-evidence standard
-- 20260814020000's own grant-hardening pass used -- "every consumer was
-- inventoried directly"), confirming every live caller of
-- has_vendor_catalog_admin_authority before this migration:
--
--   1. vendors_insert_policy (WITH CHECK), vendors_update_policy (USING
--      and WITH CHECK), vendors_select_policy (USING) -- all four call
--      sites in 20260814080000, and the only RLS usage anywhere --
--      always as has_vendor_catalog_admin_authority(auth.uid()), never
--      any other uid. This is exactly the self-scoped case; swapping to
--      has_my_vendor_catalog_admin_authority() changes zero behavior
--      for every one of the four.
--   2. has_my_vendor_catalog_admin_authority() itself
--      (20260818110000) -- calls has_vendor_catalog_admin_authority(
--      auth.uid()) internally. Both functions are SECURITY DEFINER
--      owned by postgres; a nested function call from inside a running
--      SECURITY DEFINER function is evaluated under the definer's own
--      privileges (postgres), not the original querying role's --
--      postgres, as owner, always retains its own EXECUTE on this
--      function regardless of what is revoked from authenticated below.
--      This call keeps working after this migration with no grant
--      change needed for it.
--   3. No other SQL function, RPC, migration, client module, or
--      server/API route calls has_vendor_catalog_admin_authority
--      anywhere in this repository -- confirmed by repository-wide
--      search. app/api/admin/vendors/invitations (the vendor invitation
--      API) was proven, in the prior workstream, to use the
--      independently-equivalent adminHasPermission(admin,
--      "can_manage_vendors") in-process check instead; it never calls
--      this RPC and is unaffected here.
--
-- Because every legitimate caller either (a) can move to the self-scoped
-- wrapper with zero semantic change, or (b) already runs as the
-- function's own owner and is unaffected by a revoke from authenticated,
-- it is now safe to close the direct authenticated path. No service_role
-- grant is added -- no proven server-side caller needs one, and adding
-- one "for convenience" would be an unjustified new grant.
--
-- Net effect: RLS enforces the exact same Vendor Catalog authority
-- semantics (super_admin unconditional, event_admin default, override
-- table for every other privilege_group) it always has --
-- has_vendor_catalog_admin_authority(uuid) itself is not redefined,
-- reimplemented, or weakened anywhere in this file. Only its direct
-- reachability from an ordinary authenticated client is removed.

BEGIN;

-- ============================================================
-- vendors_insert_policy: identical WITH CHECK, only the authority call
-- swapped to the self-scoped wrapper. Non-empty-name check unchanged.
-- ============================================================

DROP POLICY IF EXISTS vendors_insert_policy ON public.vendors;
CREATE POLICY vendors_insert_policy
  ON public.vendors
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_my_vendor_catalog_admin_authority()
    AND length(trim(coalesce(business_name, name, ''))) > 0
  );

-- ============================================================
-- vendors_update_policy: identical USING/WITH CHECK, only the authority
-- call swapped to the self-scoped wrapper. The vendor-self-management
-- branch (active vendor_org_access, access_role='vendor_admin') is
-- untouched.
-- ============================================================

DROP POLICY IF EXISTS vendors_update_policy ON public.vendors;
CREATE POLICY vendors_update_policy
  ON public.vendors
  FOR UPDATE
  TO authenticated
  USING (
    public.has_my_vendor_catalog_admin_authority()
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendors.id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
        AND voa.access_role = 'vendor_admin'
    )
  )
  WITH CHECK (
    public.has_my_vendor_catalog_admin_authority()
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendors.id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
        AND voa.access_role = 'vendor_admin'
    )
  );

-- ============================================================
-- vendors_select_policy: identical USING, only the authority call
-- swapped to the self-scoped wrapper. own-vendor_org_access and
-- event_vendors-visibility branches unchanged.
-- ============================================================

DROP POLICY IF EXISTS vendors_select_policy ON public.vendors;
CREATE POLICY vendors_select_policy
  ON public.vendors
  FOR SELECT
  TO authenticated
  USING (
    public.has_my_vendor_catalog_admin_authority()
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendors.id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM public.event_vendors ev
      WHERE ev.vendor_id = vendors.id
        AND ev.is_visible_to_members IS NOT FALSE
    )
  );

-- ============================================================
-- Close the arbitrary-uid oracle. PUBLIC and anon are already revoked
-- (20260814080000); this is the one new statement that actually closes
-- the exposure. No service_role grant is added -- no caller requires it.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.has_vendor_catalog_admin_authority(uuid)
FROM authenticated;

COMMIT;
