import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canOptimisticallyPaintAllow,
  evaluateMemberRouteAccess,
  type MemberRouteAccessInputs,
} from "@/lib/memberWorkspace/memberRouteAccess";
import type {
  EstablishedContextStatus,
  MemberIdentityStatus,
} from "@/lib/memberWorkspace/types";

// M2 — executable behavioural coverage for the MemberRouteGuard bootstrap /
// admission state machine (Option A: the legacy fcoc-member-attendee-id key
// is retired and is not an input here).
//
// Run with:  npm test    (tsx --test)

// The auth surfaces evaluateMemberRouteAccess can redirect to. Neither
// /member/login nor /member/account renders <MemberRouteGuard> (verified by
// MemberRouteGuard.test.ts's fs walk of <MemberRouteGuard> usage), so a
// redirect to either terminates the Guard — no re-evaluation, no loop.
const NON_GUARDED_AUTH_SURFACES = new Set(["/member/login", "/member/account"]);
function isNonGuardedAuthSurface(dest: string): boolean {
  return NON_GUARDED_AUTH_SURFACES.has(dest.split("?")[0]);
}

function inputs(
  over: Partial<MemberRouteAccessInputs> = {},
): MemberRouteAccessInputs {
  return {
    mode: "member",
    hasEvent: true,
    accountOriginMarker: null,
    hasLiveAuthSession: true,
    isAccountSession: true,
    identityStatus: "resolved",
    contextStatus: "valid",
    ...over,
  };
}

const ALL_IDENTITY: MemberIdentityStatus[] = [
  "idle",
  "resolving",
  "resolved",
  "recovery_required",
];
const ALL_CONTEXT: EstablishedContextStatus[] = [
  "idle",
  "checking",
  "valid",
  "invalid",
  "error",
];
const ALL_ACCOUNT: (boolean | null)[] = [true, false, null];

// ---------------------------------------------------------------------------
// T1 — Account, coherent MemberSession, NO fcoc-member-attendee-id, live Auth.
// (AK is not an input to this function — its absence is structural.)
// ---------------------------------------------------------------------------
test("T1: authenticated Account, resolved identity + valid context -> allow (no attendee-id key involved)", () => {
  assert.deepEqual(
    evaluateMemberRouteAccess(
      inputs({ isAccountSession: true, identityStatus: "resolved", contextStatus: "valid" }),
    ),
    { action: "allow" },
  );
  // "error" fails open the same way.
  assert.deepEqual(
    evaluateMemberRouteAccess(
      inputs({ isAccountSession: true, identityStatus: "resolved", contextStatus: "error" }),
    ),
    { action: "allow" },
  );
  // Not yet resolved context -> still checking, never allow.
  for (const contextStatus of ["idle", "checking"] as EstablishedContextStatus[]) {
    assert.deepEqual(
      evaluateMemberRouteAccess(inputs({ isAccountSession: true, identityStatus: "resolved", contextStatus })),
      { action: "checking" },
    );
  }
});

// ---------------------------------------------------------------------------
// T2 / T5 — TEA, coherent MemberSession, capability hash, NO AK.
// ---------------------------------------------------------------------------
test("T2/T5: Temporary Event Access with resolved identity -> allow, regardless of context status", () => {
  for (const contextStatus of ALL_CONTEXT) {
    assert.deepEqual(
      evaluateMemberRouteAccess(inputs({ isAccountSession: false, identityStatus: "resolved", contextStatus })),
      { action: "allow" },
    );
  }
});

// ---------------------------------------------------------------------------
// T3 — MemberSession absent, live Auth, Event-context hint present, no AK.
// The DECISION must NOT bounce to /member/account: with mode==="member" and
// hasEvent (from the hint) the pre-gate passes, so the Guard holds
// "checking" while the shared recovery runs. (The RPC half is in
// recoverMemberIdentity.behavior.test.ts.)
// ---------------------------------------------------------------------------
test("T3: absent MemberSession + live Auth + Event hint (hasEvent=true) is NOT bounced to /member/account; it holds checking while recovery runs", () => {
  // hint makes hasEvent true; identity not yet coherent -> idle/resolving
  for (const identityStatus of ["idle", "resolving"] as MemberIdentityStatus[]) {
    for (const isAccountSession of [null, true] as (boolean | null)[]) {
      const d = evaluateMemberRouteAccess(
        inputs({ hasEvent: true, mode: "member", identityStatus, isAccountSession, contextStatus: "idle" }),
      );
      assert.deepEqual(d, { action: "checking" }, `identity=${identityStatus} account=${isAccountSession}`);
    }
  }
  // and once recovery succeeds:
  assert.deepEqual(
    evaluateMemberRouteAccess(
      inputs({ hasEvent: true, isAccountSession: true, identityStatus: "resolved", contextStatus: "valid" }),
    ),
    { action: "allow" },
  );
});

// ---------------------------------------------------------------------------
// T7 (decision half) — stale TEA: recovery returns recovery_required, no live
// Auth -> reason-tagged redirect + state clear, never an allow.
// ---------------------------------------------------------------------------
test("T7: recovery_required + no live Auth -> redirect /member/login?sessionExpired=1 with clearState, never allow", () => {
  const d = evaluateMemberRouteAccess(
    inputs({ identityStatus: "recovery_required", hasLiveAuthSession: false, isAccountSession: false }),
  );
  assert.deepEqual(d, {
    action: "redirect",
    destination: "/member/login?sessionExpired=1",
    clearState: true,
  });
  // recovery_required + live Auth -> the account-side recovery surface
  const d2 = evaluateMemberRouteAccess(
    inputs({ identityStatus: "recovery_required", hasLiveAuthSession: true, isAccountSession: true }),
  );
  assert.deepEqual(d2, {
    action: "redirect",
    destination: "/member/account?contextInvalid=1",
    clearState: true,
  });
});

// ---------------------------------------------------------------------------
// T8 — lapsed Account: marker present, Auth gone, MemberSession present, no AK.
// ---------------------------------------------------------------------------
test("T8: lapsed Account (marker + isAccountSession===false) -> clear + /member/login?sessionExpired=1, and never a TEA allow", () => {
  const d = evaluateMemberRouteAccess(
    inputs({
      mode: "member",
      hasEvent: true,
      accountOriginMarker: "auth-user-123",
      isAccountSession: false,
      identityStatus: "resolved", // even a coherent session must not be admitted
      contextStatus: "valid",
    }),
  );
  assert.deepEqual(d, {
    action: "redirect",
    destination: "/member/login?sessionExpired=1",
    clearState: true,
  });
  // The lapsed branch is decided BEFORE the isAccountSession===false allow:
  // same inputs without the marker WOULD allow.
  assert.deepEqual(
    evaluateMemberRouteAccess(
      inputs({ accountOriginMarker: null, isAccountSession: false, identityStatus: "resolved" }),
    ),
    { action: "allow" },
  );
});

// ---------------------------------------------------------------------------
// T9 — lapsed Account, MemberSession ABSENT, Event hint present, no AK.
// Intentionally-supported old-browser state: still the reason-tagged
// redirect + clear (hasEvent is true via the hint, so the pre-gate passes
// and the lapsed branch is reached).
// ---------------------------------------------------------------------------
test("T9: lapsed Account with no MemberSession but an Event hint -> same reason-tagged redirect + clear (supported old-browser state)", () => {
  const d = evaluateMemberRouteAccess(
    inputs({
      mode: "member",
      hasEvent: true, // from fcoc-member-event-context hint only
      accountOriginMarker: "auth-user-123",
      isAccountSession: false,
      identityStatus: "recovery_required",
      hasLiveAuthSession: false,
    }),
  );
  assert.deepEqual(d, {
    action: "redirect",
    destination: "/member/login?sessionExpired=1",
    clearState: true,
  });
});

// ---------------------------------------------------------------------------
// T10 — no optimistic protected-content flash.
// `allow` is unreachable unless identityStatus === "resolved"; while idle /
// resolving / recovery_required the decision is checking or a redirect,
// never allow. Brute-forced over the full input space.
// ---------------------------------------------------------------------------
test("T10: evaluateMemberRouteAccess NEVER returns allow unless identityStatus === 'resolved'", () => {
  let checked = 0;
  for (const mode of ["member", "admin", null] as (string | null)[]) {
    for (const hasEvent of [true, false]) {
      for (const accountOriginMarker of [null, "u1"] as (string | null)[]) {
        for (const hasLiveAuthSession of [true, false]) {
          for (const isAccountSession of ALL_ACCOUNT) {
            for (const identityStatus of ALL_IDENTITY) {
              for (const contextStatus of ALL_CONTEXT) {
                checked++;
                const d = evaluateMemberRouteAccess({
                  mode,
                  hasEvent,
                  accountOriginMarker,
                  hasLiveAuthSession,
                  isAccountSession,
                  identityStatus,
                  contextStatus,
                });
                if (d.action === "allow") {
                  assert.equal(
                    identityStatus,
                    "resolved",
                    `allow returned with identityStatus=${identityStatus} (mode=${mode} hasEvent=${hasEvent} marker=${accountOriginMarker} account=${isAccountSession} ctx=${contextStatus})`,
                  );
                }
              }
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 500, "expected a full sweep of the input space");
});

test("T10: canOptimisticallyPaintAllow NEVER returns true unless identityStatus === 'resolved' AND it is a non-lapsed TEA session", () => {
  for (const mode of ["member", "admin", null] as (string | null)[]) {
    for (const hasEvent of [true, false]) {
      for (const accountOriginMarker of [null, "u1"] as (string | null)[]) {
        for (const isAccountSession of ALL_ACCOUNT) {
          for (const identityStatus of ALL_IDENTITY) {
            const ok = canOptimisticallyPaintAllow({
              mode,
              hasEvent,
              accountOriginMarker,
              isAccountSession,
              identityStatus,
            });
            if (ok) {
              assert.equal(identityStatus, "resolved");
              assert.equal(isAccountSession, false);
              assert.equal(accountOriginMarker, null);
              assert.equal(mode, "member");
              assert.equal(hasEvent, true);
            }
          }
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// T11 — fresh browser: no member state.
// ---------------------------------------------------------------------------
test("T11: fresh browser (mode absent, no member state) -> /member/login (no Auth) or /member/account (stray Auth); never allow, never clearState", () => {
  const noAuth = evaluateMemberRouteAccess(
    inputs({ mode: null, hasEvent: false, hasLiveAuthSession: false, isAccountSession: null, identityStatus: "idle", contextStatus: "idle" }),
  );
  assert.deepEqual(noAuth, { action: "redirect", destination: "/member/login", clearState: false });

  const strayAuth = evaluateMemberRouteAccess(
    inputs({ mode: null, hasEvent: false, hasLiveAuthSession: true, isAccountSession: true, identityStatus: "idle", contextStatus: "idle" }),
  );
  assert.deepEqual(strayAuth, { action: "redirect", destination: "/member/account", clearState: false });

  // mode present but no Event at all (not even a hint) is still "not a member session".
  assert.deepEqual(
    evaluateMemberRouteAccess(inputs({ mode: "member", hasEvent: false, hasLiveAuthSession: false })),
    { action: "redirect", destination: "/member/login", clearState: false },
  );
});

// ---------------------------------------------------------------------------
// T14 — redirect-loop safety: after clearMemberLocalState() the re-evaluated
// inputs (mode/marker/event all gone) reach a terminal, NON-guarded login
// destination — not another guarded member route.
// ---------------------------------------------------------------------------
test("T14: after a state-clearing redirect, re-evaluation with the cleared inputs terminates at a non-guarded login route", () => {
  // A clearing redirect happened (lapsed or recovery_required). clearMemberLocalState
  // removes fcoc-member-session, fcoc-member-event-context, fcoc-member-event-changed,
  // fcoc-user-mode, fcoc-member-has-arrived, fcoc-member-auth-user-id.
  const afterClear = evaluateMemberRouteAccess({
    mode: null,
    hasEvent: false,
    accountOriginMarker: null,
    hasLiveAuthSession: false,
    isAccountSession: false,
    identityStatus: "idle",
    contextStatus: "idle",
  });
  assert.equal(afterClear.action, "redirect");
  assert.equal(afterClear.action === "redirect" && afterClear.clearState, false);
  assert.equal(afterClear.action === "redirect" && afterClear.destination, "/member/login");
  assert.equal(
    isNonGuardedAuthSurface((afterClear as { destination: string }).destination),
    true,
    "post-clear destination must be a non-<MemberRouteGuard> auth surface (no re-evaluation, no loop)",
  );

  // Even if a stray Supabase session survives the local clear, the
  // destination (/member/account) is still not a <MemberRouteGuard>-wrapped
  // page (the account picker renders no Guard) -> no loop.
  const afterClearStrayAuth = evaluateMemberRouteAccess({
    mode: null,
    hasEvent: false,
    accountOriginMarker: null,
    hasLiveAuthSession: true,
    isAccountSession: true,
    identityStatus: "idle",
    contextStatus: "idle",
  });
  assert.equal((afterClearStrayAuth as { destination: string }).destination, "/member/account");
  assert.equal(
    isNonGuardedAuthSurface((afterClearStrayAuth as { destination: string }).destination),
    true,
  );
});

// ---------------------------------------------------------------------------
// Branch-order fidelity vs. the pre-M2 verifyMember (Option A only change).
// ---------------------------------------------------------------------------
test("branch order: !hasLegacySession is decided before the lapsed / recovery / allow branches", () => {
  // mode !== "member" wins even with a coherent-looking workspace + marker.
  assert.deepEqual(
    evaluateMemberRouteAccess(
      inputs({ mode: "admin", accountOriginMarker: "u1", isAccountSession: false, identityStatus: "recovery_required" }),
    ),
    { action: "redirect", destination: "/member/account", clearState: false },
  );
});

test("branch order: recovery_required is decided before the resolving hold and before the TEA/Account allow", () => {
  assert.equal(
    evaluateMemberRouteAccess(inputs({ identityStatus: "recovery_required", isAccountSession: false })).action,
    "redirect",
  );
  assert.equal(
    evaluateMemberRouteAccess(inputs({ identityStatus: "resolving", isAccountSession: false })).action,
    "checking",
  );
});

test("Account session with unresolved isAccountSession (null) holds checking, not allow", () => {
  assert.deepEqual(
    evaluateMemberRouteAccess(inputs({ isAccountSession: null, identityStatus: "resolved", contextStatus: "valid" })),
    { action: "checking" },
  );
});

// ---------------------------------------------------------------------------
// Supported historical compatibility states C / D / F / K2 — decision layer.
// (RPC/recovery behaviour for C/D/F/K is proven in
// recoverMemberIdentity.behavior.test.ts.)
// ---------------------------------------------------------------------------
test("supported state C: authed, MemberSession absent, hint present, no AK -> not bounced; checking while recovery runs", () => {
  assert.deepEqual(
    evaluateMemberRouteAccess(
      inputs({ mode: "member", hasEvent: true, isAccountSession: true, identityStatus: "resolving", contextStatus: "idle" }),
    ),
    { action: "checking" },
  );
});

test("supported state D: same as C with no AK at all -> identical decision (AK is not an input)", () => {
  // There is no AK parameter; C and D collapse to the same call. This test
  // documents that equivalence.
  const c = evaluateMemberRouteAccess(
    inputs({ mode: "member", hasEvent: true, isAccountSession: true, identityStatus: "resolving", contextStatus: "idle" }),
  );
  const d = evaluateMemberRouteAccess(
    inputs({ mode: "member", hasEvent: true, isAccountSession: true, identityStatus: "resolving", contextStatus: "idle" }),
  );
  assert.deepEqual(c, d);
  assert.deepEqual(c, { action: "checking" });
});

test("supported state F: incomplete MemberSession (event, no attendee), authed, no AK -> checking while recovery, then allow", () => {
  assert.deepEqual(
    evaluateMemberRouteAccess(inputs({ hasEvent: true, isAccountSession: true, identityStatus: "resolving" })),
    { action: "checking" },
  );
  assert.deepEqual(
    evaluateMemberRouteAccess(inputs({ hasEvent: true, isAccountSession: true, identityStatus: "resolved", contextStatus: "valid" })),
    { action: "allow" },
  );
});

test("supported state K2: lapsed Account, MemberSession absent, hint present -> reason-tagged redirect + clear", () => {
  assert.deepEqual(
    evaluateMemberRouteAccess(
      inputs({ mode: "member", hasEvent: true, accountOriginMarker: "u1", isAccountSession: false, identityStatus: "recovery_required", hasLiveAuthSession: false }),
    ),
    { action: "redirect", destination: "/member/login?sessionExpired=1", clearState: true },
  );
});
