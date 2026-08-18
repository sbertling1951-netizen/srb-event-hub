import { supabase } from "@/lib/supabase";

// Canonical Admin Tenant Authority client wrapper -- Tenant Admin Route
// Authority Foundation, Part B. Mirrors lib/adminTaskAuthority.ts's own
// checkAdminEventTaskAuthority exactly in spirit: one shared client entry
// point for the coarse question "does the current admin hold Tenant
// Admin authority for at least one Tenant, or Platform Admin authority,"
// reusing the already-governed, self-scoped
// public.has_any_tenant_admin_authority() RPC verbatim
// (20260818090000_create_self_scoped_tenant_admin_authority.sql). This
// module adds no authority logic of its own: it does not resolve,
// cache, retry, or reinterpret the RPC's answer, and it never widens a
// "false" or an error into "allowed."
//
// Unlike checkAdminEventTaskAuthority, there is no "no_event"-equivalent
// state: this check has no Event dimension and nothing analogous to
// require before it can run. It also never client-side short-circuits on
// admin.isSuperAdmin, deliberately matching checkAdminEventTaskAuthority's
// own precedent (which does not short-circuit either) rather than
// hasPermission()'s synchronous permission-map bypass -- Platform
// inheritance is resolved authoritatively server-side, inside
// has_any_tenant_admin_authority() itself (via
// has_platform_admin_authority), every time.
//
// No target Tenant is ever supplied to or resolved by this function. It
// answers only the coarse route-reachability question; authorizing a
// specific operation against a specific Tenant remains, unchanged, the
// job of the existing has_tenant_admin_authority(uid, tenant_id)
// primitive called by each Tenant-scoped RPC with its own selected
// Tenant.

export type AdminTenantAuthorityResult =
  | { status: "allowed" }
  | { status: "denied" }
  | { status: "check_failed"; message: string };

/**
 * Asks the governed database resolver whether the current admin holds
 * Tenant Admin authority for at least one Tenant, or Platform Admin
 * authority. Never establishes, selects, or infers a specific Tenant --
 * callers that need a specific-Tenant answer must use the existing
 * has_tenant_admin_authority(uid, tenant_id) primitive server-side
 * instead, not this function.
 */
export async function checkAdminTenantAuthority(): Promise<AdminTenantAuthorityResult> {
  const { data, error } = await supabase.rpc("has_any_tenant_admin_authority");

  // Fail closed: a check that could not be completed is never treated
  // as granted, mirroring checkAdminEventTaskAuthority's own
  // COALESCE(...,false)-equivalent discipline at the client boundary.
  if (error) {
    return { status: "check_failed", message: error.message };
  }

  return data ? { status: "allowed" } : { status: "denied" };
}
