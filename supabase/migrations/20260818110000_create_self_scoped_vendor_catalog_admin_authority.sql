-- Self-Scoped Vendor Catalog Admin Authority -- Canonical Vendor Catalog
-- Route-Authority Foundation.
--
-- Context: Final G-01 Authority Endgame Inventory identified
-- /admin/vendors/access as neither Event-scoped nor Tenant-scoped -- it
-- administers vendor-org/catalog access across the shared vendor catalog,
-- and still uses the legacy requiredPermission="can_manage_vendors" route
-- guard. The database-side authority already exists and is already live:
-- public.has_vendor_catalog_admin_authority(_uid uuid)
-- (20260814080000_reconcile_vendors_catalog_authority.sql), a narrowly-
-- scoped, proven-equivalent reproduction of legacy can_manage_vendors
-- semantics, already governing vendors_insert_policy/vendors_update_policy/
-- vendors_select_policy.
--
-- SECURITY REVIEW (explicitly required before any client exposure): that
-- existing function takes a uid PARAMETER with no internal check that
-- _uid = auth.uid(). It is already GRANT EXECUTE ... TO authenticated
-- (needed so RLS USING/WITH CHECK clauses, which call it with
-- auth.uid(), work under the querying role's own privileges -- see that
-- migration's SECURITY DEFINER rationale). That same authenticated grant
-- means any authenticated browser client can, TODAY, already call
-- supabase.rpc("has_vendor_catalog_admin_authority", { _uid: "<any
-- uuid>" }) and learn whether an ARBITRARY OTHER admin holds vendor-
-- catalog authority -- an authorization-oracle leak, exactly the same
-- class of defect the Self-Scoped Tenant Admin Authority migration
-- (20260818090000) found and closed for has_tenant_admin_authority(uid,
-- tenant_id) before building any client wrapper. That is why this
-- migration exists, and why lib/adminVendorCatalogAuthority.ts (the new
-- client wrapper) calls this new zero-argument function, never the
-- existing uid-taking one.
--
-- The existing has_vendor_catalog_admin_authority(uuid) is NOT replaced,
-- weakened, or reimplemented here -- it remains exactly as
-- 20260814080000 left it, still the sole authority behind every vendors_*
-- RLS policy, still callable with an explicit uid by any code path that
-- legitimately needs that (RLS USING/WITH CHECK clauses, which always
-- pass auth.uid() at the point of use, and any future server-side caller
-- that resolves its own trusted actor identity before calling it). This
-- migration adds one new, additive, self-scoped wrapper on top of it,
-- exactly mirroring 20260818090000's own shape:
--
--   * zero parameters -- the caller is derived exclusively from
--     auth.uid() inside the function body; there is no argument through
--     which a client could substitute another user's identity, so
--     arbitrary-user probing is structurally impossible, not merely
--     discouraged.
--   * reveals only a boolean -- no privilege_group, override row, or
--     other admin's identity is exposed.
--   * delegates its entire logic to the existing
--     has_vendor_catalog_admin_authority(auth.uid()) call -- no
--     reimplementation of the super_admin/event_admin/override logic
--     exists in this file, unlike 20260818090000's own Tenant EXISTS
--     query (which had no existing single-uid "any Tenant" primitive to
--     delegate to). This function's entire body is one function call.

BEGIN;

CREATE OR REPLACE FUNCTION public.has_my_vendor_catalog_admin_authority()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  RETURN public.has_vendor_catalog_admin_authority(auth.uid());
END;
$$;

ALTER FUNCTION public.has_my_vendor_catalog_admin_authority() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.has_my_vendor_catalog_admin_authority() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_my_vendor_catalog_admin_authority() FROM anon;
GRANT EXECUTE ON FUNCTION public.has_my_vendor_catalog_admin_authority() TO authenticated;

COMMIT;
