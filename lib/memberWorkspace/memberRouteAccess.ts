import type {
  EstablishedContextStatus,
  MemberIdentityStatus,
} from "@/lib/memberWorkspace/types";

// M2 — MemberRouteGuard bootstrap / admission decision, extracted as a
// pure function so the full A–L state matrix is executable-testable
// without a React/jsdom harness.
//
// This module contains DECISION LOGIC ONLY. It performs no Supabase call,
// no router mutation, no localStorage mutation, and runs no React effect.
// The component reads the inputs, calls this, and performs the returned
// action.
//
// Approved architecture (Option A):
//
//   hasLegacySession = mode === "member" && hasEvent
//
// where `hasEvent` is derived by the caller from `!!getCurrentMemberEvent()`
// — i.e. the persisted MemberSession Event id first, then the
// member-event-context discovery hint. The hint-inclusive form is a hard
// compatibility requirement: an authenticated old-browser session whose
// MemberSession is absent must still reach the governed recovery path from
// the hint. The retired legacy standalone attendee-id key is not read here
// and contributes nothing.
//
// Bootstrap eligibility is NOT admission. A browser that passes
// `hasLegacySession` is only allowed to stay mounted long enough for the
// shared MemberWorkspace recovery to run — protected content still cannot
// render until `identityStatus === "resolved"` (and, for an Account
// session, `contextStatus ∈ {valid, error}`). `evaluateMemberRouteAccess`
// never returns `action: "allow"` while `identityStatus` is `idle`,
// `resolving`, or `recovery_required`; `canOptimisticallyPaintAllow`
// likewise requires `identityStatus === "resolved"`.

export type MemberRouteAccessInputs = {
  // localStorage-derived, read by the caller (never mutated here):
  mode: string | null; // canonical user-mode key
  hasEvent: boolean; // !!getCurrentMemberEvent()  (MemberSession event, then hint)
  accountOriginMarker: string | null; // canonical member-auth-user-id marker
  // Live Supabase Auth session presence, resolved by the caller from a
  // fresh supabase.auth.getSession() before calling. Used only to pick a
  // redirect destination (account picker vs. sign-in).
  hasLiveAuthSession: boolean;
  // Shared MemberWorkspace context values:
  isAccountSession: boolean | null; // null until the one-time Auth check resolves
  identityStatus: MemberIdentityStatus;
  contextStatus: EstablishedContextStatus;
};

export type MemberRouteAccessDecision =
  | { action: "allow" }
  | { action: "checking" }
  | { action: "redirect"; destination: string; clearState: boolean };

// Full bootstrap + admission decision. Branch order mirrors the pre-M2
// MemberRouteGuard `verifyMember` exactly, with the single Option A change
// (`hasLegacySession` no longer requires the legacy attendee-id key).
export function evaluateMemberRouteAccess(
  i: MemberRouteAccessInputs,
): MemberRouteAccessDecision {
  const hasLegacySession = i.mode === "member" && i.hasEvent;

  if (!hasLegacySession) {
    // No selected-event member session at all. An authenticated Supabase
    // account with no persisted Event goes to the picker to (re-)choose
    // one; anyone else goes to sign-in. State is NOT cleared here.
    return {
      action: "redirect",
      destination: i.hasLiveAuthSession ? "/member/account" : "/member/login",
      clearState: false,
    };
  }

  if (!!i.accountOriginMarker && i.isAccountSession === false) {
    // Lapsed Account session: account-origin marker present, live Auth
    // gone. Not Temporary Event Access. Clear the stale account state and
    // route to re-authentication.
    return {
      action: "redirect",
      destination: "/member/login?sessionExpired=1",
      clearState: true,
    };
  }

  if (i.identityStatus === "recovery_required") {
    // The shared workspace has no coherent identity and it could not be
    // re-derived. Clear local state and route to explicit recovery —
    // never a silent null-identity workspace, never a substitute Event.
    return {
      action: "redirect",
      destination: i.hasLiveAuthSession
        ? "/member/account?contextInvalid=1"
        : "/member/login?sessionExpired=1",
      clearState: true,
    };
  }

  if (i.identityStatus === "resolving") {
    // A governed recovery is in flight — hold the checking state.
    return { action: "checking" };
  }

  if (i.identityStatus === "idle") {
    // Not yet evaluated / a non-coherent MemberSession the recovery effect
    // has not picked up yet. Bootstrap eligibility is NOT admission — hold
    // the checking state until identity resolves. (This also closes a
    // latent pre-M2 window where an incomplete Temporary Event Access
    // MemberSession could be painted "allowed" in the idle tick before the
    // recovery effect set "resolving".)
    return { action: "checking" };
  }

  // identityStatus === "resolved" from here on.

  if (i.isAccountSession === false) {
    // Temporary Event Access with a resolved shared identity. localStorage
    // presence + resolved identity is sufficient; TEA holds no durable
    // Person link for established-context validation and re-verifies
    // per-call server-side.
    return { action: "allow" };
  }

  if (i.isAccountSession === null) {
    // The one-time Auth check hasn't resolved yet — keep checking.
    return { action: "checking" };
  }

  // Authenticated Account session: require governed established-context
  // validation. "error" fails open (a transient validation failure is not
  // authorization revocation). "invalid" is handled by the Provider's own
  // redirect, not here.
  if (
    (i.contextStatus === "valid" || i.contextStatus === "error") &&
    i.identityStatus === "resolved"
  ) {
    return { action: "allow" };
  }

  return { action: "checking" };
}

// Narrow synchronous fast-path used by the Guard's useLayoutEffect to
// avoid a checking-state flash for a Temporary Event Access session whose
// identity is ALREADY resolved (coherent MemberSession). It is
// deliberately TEA-only: an Account session's local presence is never
// optimistically painted (that is the authority Member Event Context
// Stage 2 moved off localStorage), and a lapsed Account session
// (`accountOriginMarker` present) is never painted. It never returns true
// unless `identityStatus === "resolved"`.
export function canOptimisticallyPaintAllow(i: {
  mode: string | null;
  hasEvent: boolean;
  accountOriginMarker: string | null;
  isAccountSession: boolean | null;
  identityStatus: MemberIdentityStatus;
}): boolean {
  return (
    i.mode === "member" &&
    i.hasEvent &&
    !i.accountOriginMarker &&
    i.isAccountSession === false &&
    i.identityStatus === "resolved"
  );
}
