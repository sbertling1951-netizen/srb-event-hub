import { supabase } from "@/lib/supabase";

// Canonical Admin Vendor Catalog Authority client wrapper. Mirrors
// lib/adminTenantAuthority.ts's own checkAdminTenantAuthority exactly in
// spirit: one shared client entry point for the coarse question "does
// the current admin hold Vendor Catalog authority," reusing the
// governed, self-scoped public.has_my_vendor_catalog_admin_authority()
// RPC verbatim
// (20260818110000_create_self_scoped_vendor_catalog_admin_authority.sql).
// This module adds no authority logic of its own: it does not resolve,
// cache, retry, or reinterpret the RPC's answer, and it never widens a
// "false" or an error into "allowed."
//
// This is deliberately NOT an Event task and NOT a Tenant check --
// Vendor Catalog administration (vendor-org/catalog access) is neither
// Event-scoped nor Tenant-scoped, so this has no Event dimension (no
// "no_event"-equivalent state) and no Tenant dimension of any kind. It
// also never client-side short-circuits on admin.isSuperAdmin,
// deliberately matching checkAdminEventTaskAuthority/
// checkAdminTenantAuthority's own precedent -- Super Admin inheritance is
// resolved authoritatively server-side, inside
// has_my_vendor_catalog_admin_authority() itself (via
// has_vendor_catalog_admin_authority's own super_admin branch), every
// time.
//
// The existing uid-taking public.has_vendor_catalog_admin_authority(uuid)
// is never called directly from the client -- only the self-scoped,
// zero-argument wrapper is. Calling the uid-taking function directly
// from a browser client would let an authenticated caller pass an
// arbitrary uuid and learn a different admin's Vendor Catalog authority,
// which is exactly the arbitrary-user-probing risk the self-scoped
// wrapper exists to close.

export type AdminVendorCatalogAuthorityResult =
  | { status: "allowed" }
  | { status: "denied" }
  | { status: "check_failed"; message: string };

/**
 * Asks the governed database resolver whether the current admin holds
 * Vendor Catalog authority (vendor-org/catalog access administration,
 * not any specific Event or Tenant). Never establishes, selects, or
 * infers an Event or Tenant -- callers that need per-Event or per-Tenant
 * authority must use the appropriate existing primitive instead, not
 * this function.
 */
export async function checkAdminVendorCatalogAuthority(): Promise<AdminVendorCatalogAuthorityResult> {
  const { data, error } = await supabase.rpc(
    "has_my_vendor_catalog_admin_authority",
  );

  // Fail closed: a check that could not be completed is never treated
  // as granted, mirroring checkAdminTenantAuthority's own
  // COALESCE(...,false)-equivalent discipline at the client boundary.
  if (error) {
    return { status: "check_failed", message: error.message };
  }

  return data ? { status: "allowed" } : { status: "denied" };
}
