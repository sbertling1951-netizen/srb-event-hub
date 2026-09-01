import { supabase } from "@/lib/supabase";

// Canonical Admin Event Staff delegation-authority client wrapper. Mirrors
// lib/adminTenantAuthority.ts's checkAdminTenantAuthority exactly in
// spirit: one shared client entry point for the coarse question "may the
// current admin reach the Event Staff surface for at least one Event,"
// reusing the already-governed, self-scoped
// public.has_any_event_staff_delegation_authority() RPC verbatim
// (20260918000000_govern_event_staff_downward_delegation.sql).
//
// The RPC answers Platform OR any-Tenant Admin OR Event Admin (role =
// 'event_admin') on any Event under an active Tenant. It is a COARSE,
// Event-agnostic route-reachability hint only -- the authoritative,
// per-Event, per-tier decision still happens server-side inside
// resolve_event_staff_delegation(), which every Event Staff mutation and
// read RPC calls with the actually-selected Event. This module adds no
// authority logic of its own: it does not resolve, cache, retry, or
// reinterpret the RPC's answer, and it never widens a "false" or an error
// into "allowed."
//
// Like checkAdminTenantAuthority, there is no "no_event"-equivalent state
// and no client-side admin.isSuperAdmin short-circuit -- Platform
// inheritance is resolved authoritatively server-side inside the RPC every
// time.

export type AdminEventStaffAuthorityResult =
  | { status: "allowed" }
  | { status: "denied" }
  | { status: "check_failed"; message: string };

/**
 * Asks the governed database resolver whether the current admin holds
 * Event Staff delegation authority for at least one Event (Platform, any
 * Tenant Admin, or Event Admin on any Event). Never establishes, selects,
 * or infers a specific Event -- the per-Event decision remains the job of
 * resolve_event_staff_delegation() called server-side by each RPC.
 */
export async function checkAdminEventStaffDelegationAuthority(): Promise<AdminEventStaffAuthorityResult> {
  const { data, error } = await supabase.rpc(
    "has_any_event_staff_delegation_authority",
  );

  // Fail closed: a check that could not be completed is never treated as
  // granted, mirroring checkAdminTenantAuthority's own discipline.
  if (error) {
    return { status: "check_failed", message: error.message };
  }

  return data ? { status: "allowed" } : { status: "denied" };
}
