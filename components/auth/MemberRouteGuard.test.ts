import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for MemberRouteGuard. As of M2 the full
// bootstrap + admission decision lives in the pure function
// lib/memberWorkspace/memberRouteAccess.ts; its BEHAVIOUR (the A–L state
// matrix, no-flash, redirect-loop safety, Option A) is proven executably in
// lib/memberWorkspace/memberRouteAccess.test.ts and
// lib/memberWorkspace/recoverMemberIdentity.behavior.test.ts. This file
// asserts only that the component delegates to that decision correctly,
// performs no identity resolution of its own, and that the protected-route
// wiring is complete.
//
// Run with:  npm run test:member-workspace

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(HERE));

const SOURCE = readFileSync(
  fileURLToPath(new URL("./MemberRouteGuard.tsx", import.meta.url)),
  "utf8",
);
const CODE = SOURCE.replace(/^\s*\/\/.*$/gm, "");

const ACCESS_SOURCE = readFileSync(
  `${REPO_ROOT}/lib/memberWorkspace/memberRouteAccess.ts`,
  "utf8",
);
const ACCESS_CODE = ACCESS_SOURCE.replace(/^\s*\/\/.*$/gm, "");

const PROVIDER_SOURCE = readFileSync(
  `${REPO_ROOT}/lib/memberWorkspace/MemberWorkspaceProvider.tsx`,
  "utf8",
);

// ---------------------------------------------------------------------------
// Delegation to the pure decision.
// ---------------------------------------------------------------------------

test("the Guard delegates the whole bootstrap + admission decision to evaluateMemberRouteAccess / canOptimisticallyPaintAllow", () => {
  assert.match(
    CODE,
    /import \{[\s\S]*?canOptimisticallyPaintAllow,[\s\S]*?evaluateMemberRouteAccess,[\s\S]*?\} from "@\/lib\/memberWorkspace\/memberRouteAccess"/,
  );
  assert.match(CODE, /const decision = evaluateMemberRouteAccess\(\{/);
  assert.match(CODE, /canOptimisticallyPaintAllow\(\{/);
});

test("the Guard performs exactly the returned action -- setStatus / clearMemberLocalState / router.replace(decision.destination)", () => {
  assert.match(CODE, /if \(decision\.action === "allow"\) \{[\s\S]{0,120}?setStatus\("allowed"\);/);
  assert.match(CODE, /if \(decision\.action === "checking"\) \{[\s\S]{0,120}?setStatus\("checking"\);/);
  assert.match(CODE, /setStatus\("denied"\);/);
  assert.match(CODE, /if \(decision\.clearState\) \{\s*\n\s*clearMemberLocalState\(\);\s*\n\s*\}/);
  assert.match(CODE, /router\.replace\(decision\.destination\);/);
  // the optimistic layout-effect only ever acts on an "allow"
  assert.match(CODE, /canOptimisticallyPaintAllow\(\{[\s\S]{0,400}?\}\)\s*\n?\s*\)\s*\{\s*\n\s*setStatus\("allowed"\);/);
});

test("the Guard does NOT resolve identity or Event choice itself -- no RPC call in this component", () => {
  assert.equal(/\.rpc\(/.test(CODE), false);
});

test("M2: the retired attendee-id key / helper is not referenced anywhere in the Guard", () => {
  assert.doesNotMatch(CODE, /getStoredMemberAttendeeId|memberAttendeeId/);
});

test("hasEvent stays hint-inclusive (!!getCurrentMemberEvent()) in BOTH the layout-effect and the verification effect, and is NEVER getMemberSession()?.event_id", () => {
  assert.doesNotMatch(CODE, /getMemberSession\(\)\?\.event_id/);
  // both the optimistic layout-effect and the async effect derive hasEvent
  // from the hint-inclusive helper
  assert.match(CODE, /hasEvent: !!getCurrentMemberEvent\(\)/); // layout-effect (object literal)
  assert.match(CODE, /const hasEvent = !!getCurrentMemberEvent\(\);/); // verification effect
});

test("account-vs-temporary is still decided by the existing fcoc-member-auth-user-id marker, read via the shared helper", () => {
  assert.match(CODE, /getStoredMemberAuthUserId\(\)/);
  assert.match(CODE, /accountOriginMarker: getStoredMemberAuthUserId\(\)/);
  // the decision function is what compares it against isAccountSession
  assert.match(ACCESS_CODE, /!!i\.accountOriginMarker && i\.isAccountSession === false/);
});

test("hasLiveAuthSession comes from a fresh supabase.auth.getSession() at decision time", () => {
  assert.match(CODE, /const \{ data: sessionData \} = await supabase\.auth\.getSession\(\);/);
  assert.match(CODE, /hasLiveAuthSession: !!sessionData\.session/);
});

test("the verification effect keeps its shared-signal dependency array (no dependency on cleared localStorage values)", () => {
  assert.match(
    CODE,
    /\}, \[\s*\n\s*router,\s*\n\s*workspace\.isAccountSession,\s*\n\s*workspace\.contextStatus,\s*\n\s*workspace\.identityStatus,\s*\n\s*\]\);/,
  );
});

test("the Guard re-verifies on the member session / event / mode storage keys and on pageshow", () => {
  // Stage A: the storage-event key match runs through the shared
  // storageEventMatches() helper, which also accepts the legacy fcoc- names.
  assert.match(CODE, /storageEventMatches\(\s*e\.key,/);
  assert.match(CODE, /STORAGE_KEYS\.memberSession/);
  assert.match(CODE, /STORAGE_KEYS\.memberEventContext/);
  assert.match(CODE, /STORAGE_KEYS\.memberEventChanged/);
  assert.match(CODE, /STORAGE_KEYS\.userMode/);
  assert.match(CODE, /addEventListener\("pageshow", handlePageShow\)/);
});

// ---------------------------------------------------------------------------
// Option A is encoded in the pure decision, not the component.
// ---------------------------------------------------------------------------

test("M2 Option A: the pre-gate is `mode === \"member\" && hasEvent` -- no attendee-id term", () => {
  assert.match(ACCESS_CODE, /const hasLegacySession = i\.mode === "member" && i\.hasEvent;/);
  assert.doesNotMatch(ACCESS_SOURCE, /attendeeId|memberAttendeeId|fcoc-member-attendee-id/);
});

test("M2 invariant: evaluateMemberRouteAccess never returns allow while identityStatus is idle / resolving / recovery_required (idle is an explicit checking branch)", () => {
  assert.match(ACCESS_CODE, /if \(i\.identityStatus === "recovery_required"\) \{/);
  assert.match(ACCESS_CODE, /if \(i\.identityStatus === "resolving"\) \{\s*\n\s*return \{ action: "checking" \};\s*\n\s*\}/);
  assert.match(ACCESS_CODE, /if \(i\.identityStatus === "idle"\) \{[\s\S]{0,320}?return \{ action: "checking" \};/);
  // the two allow returns both sit AFTER those identity guards
  const idleIdx = ACCESS_CODE.indexOf('i.identityStatus === "idle"');
  const firstAllow = ACCESS_CODE.indexOf('return { action: "allow" }');
  assert.ok(idleIdx > 0 && firstAllow > idleIdx);
});

test("M2: canOptimisticallyPaintAllow is TEA-only, non-lapsed, and requires identityStatus === \"resolved\"", () => {
  assert.match(
    ACCESS_CODE,
    /i\.mode === "member" &&\s*\n\s*i\.hasEvent &&\s*\n\s*!i\.accountOriginMarker &&\s*\n\s*i\.isAccountSession === false &&\s*\n\s*i\.identityStatus === "resolved"/,
  );
});

// ---------------------------------------------------------------------------
// Protected-route wiring (unchanged by M2) -- fs walks.
// ---------------------------------------------------------------------------

test("PROTECTED_MEMBER_WORKSPACE_ROUTE_PREFIXES covers every route tree that actually renders <MemberRouteGuard>", () => {
  const listMatch = PROVIDER_SOURCE.match(
    /PROTECTED_MEMBER_WORKSPACE_ROUTE_PREFIXES = \[([\s\S]*?)\] as const/,
  );
  assert.ok(listMatch, "expected the protected-route prefix list");
  const prefixes = [...listMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...prefixes].sort(),
    ["/activities", "/announcements", "/coach-map", "/member"],
  );

  const APP_DIR = join(REPO_ROOT, "app");
  const wrapped: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.name === "page.tsx" &&
        readFileSync(full, "utf8").includes("<MemberRouteGuard")
      ) {
        wrapped.push(
          "/" +
            full
              .slice(APP_DIR.length + 1)
              .replace(/\/page\.tsx$/, "")
              .replace(/\/\([^)]+\)/g, ""),
        );
      }
    }
  };
  walk(APP_DIR);

  assert.ok(wrapped.length > 0, "expected some <MemberRouteGuard>-wrapped routes");
  for (const route of wrapped) {
    const covered = prefixes.some(
      (p) => route === p || route.startsWith(`${p}/`),
    );
    assert.ok(
      covered,
      `route ${route} renders <MemberRouteGuard> but is not covered by PROTECTED_MEMBER_WORKSPACE_ROUTE_PREFIXES -- the provider recovery / validation effects would not run there`,
    );
  }
});

test("INVARIANT: every page that consumes useMemberWorkspace() enforces the shared identity state -- a recovery_required workspace cannot render through with null Event / attendee", () => {
  const APP_DIR = join(REPO_ROOT, "app");
  const consumers: { route: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== "page.tsx") {
        continue;
      }
      const src = readFileSync(full, "utf8");
      if (!/useMemberWorkspace\(/.test(src)) {
        continue;
      }
      consumers.push({
        route:
          "/" +
          full
            .slice(APP_DIR.length + 1)
            .replace(/\/page\.tsx$/, "")
            .replace(/\/\([^)]+\)/g, ""),
        src,
      });
    }
  };
  walk(APP_DIR);

  assert.ok(consumers.length >= 10, "expected the known useMemberWorkspace consumers");
  for (const { route, src } of consumers) {
    const wrapped = src.includes("<MemberRouteGuard");
    const selfEnforces =
      route === "/member" &&
      /workspace\.identityStatus === "recovery_required"/.test(src) &&
      /router\.replace\(/.test(src);
    // The Account chooser is the explicit recovery surface for a
    // recovery_required workspace, not an admitted member workspace page.
    // It may consume the context solely to refresh a newly established
    // session before navigating into a guarded route.
    const isAccountChooserHandoff =
      route === "/member/account" &&
      /workspace\.refresh\(\);/.test(src) &&
      /await enterResolvedRegistration\(/.test(src);
    assert.ok(
      wrapped || selfEnforces || isAccountChooserHandoff,
      `${route} consumes useMemberWorkspace() but neither renders <MemberRouteGuard> nor self-enforces the shared identity state -- a recovery_required workspace could render through with null identity`,
    );
  }
});
