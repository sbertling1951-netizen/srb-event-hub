import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for Member Event Context Stage 2's
// MemberRouteGuard: an Account session must pass governed established-
// context validation to be allowed; Temporary Event Access is unchanged.
//
// Run with:
//   npx tsx --test components/auth/MemberRouteGuard.test.ts

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(HERE));

const SOURCE = readFileSync(
  fileURLToPath(new URL("./MemberRouteGuard.tsx", import.meta.url)),
  "utf8",
);
const CODE = SOURCE.replace(/^\s*\/\/.*$/gm, "");

const PROVIDER_SOURCE = readFileSync(
  `${REPO_ROOT}/lib/memberWorkspace/MemberWorkspaceProvider.tsx`,
  "utf8",
);

test("consumes MemberWorkspaceProvider's governed context, not a second identity/context source", () => {
  assert.match(CODE, /useMemberWorkspace\(\)/);
});

test("Temporary Event Access (isAccountSession === false) keeps the prior localStorage-sufficient contract", () => {
  assert.match(
    CODE,
    /if \(workspace\.isAccountSession === false\) \{[\s\S]{0,300}?setStatus\("allowed"\);/,
  );
});

test("an Account session is allowed only once contextStatus is valid/error AND the shared identity is resolved (never merely from localStorage)", () => {
  assert.match(
    CODE,
    /\(workspace\.contextStatus === "valid" \|\|\s*\n\s*workspace\.contextStatus === "error"\) &&\s*\n\s*workspace\.identityStatus === "resolved"\s*\n\s*\) \{[\s\S]{0,200}?setStatus\("allowed"\);/,
  );
});

test("Member Workspace Continuity: a member is admitted ONLY when the shared identityStatus is resolved -- resolving holds, recovery_required routes to explicit recovery", () => {
  // resolving -> checking
  assert.match(
    CODE,
    /if \(workspace\.identityStatus === "resolving"\) \{[\s\S]{0,120}?setStatus\("checking"\);/,
  );
  // recovery_required -> denied + deliberate redirect to an existing
  // recovery surface (never a silent null-identity workspace)
  const recoveryIdx = CODE.indexOf(
    'if (workspace.identityStatus === "recovery_required") {',
  );
  assert.ok(recoveryIdx >= 0, "expected the recovery_required branch");
  const teaAllowIdx = CODE.indexOf(
    'if (workspace.isAccountSession === false) {',
  );
  assert.ok(
    recoveryIdx < teaAllowIdx,
    "recovery_required must be decided before the Temporary Access allow",
  );
  const branch = CODE.slice(recoveryIdx, teaAllowIdx);
  assert.match(branch, /setStatus\("denied"\)/);
  assert.match(branch, /clearMemberLocalState\(\)/);
  assert.match(branch, /"\/member\/account\?contextInvalid=1"/);
  assert.match(branch, /"\/member\/login\?sessionExpired=1"/);
  assert.equal(/setStatus\("allowed"\)/.test(branch), false);
});

test("the Temporary Event Access allow is now gated: reached only after resolving / recovery_required have returned", () => {
  const teaIdx = CODE.indexOf('if (workspace.isAccountSession === false) {');
  const resolvingIdx = CODE.indexOf(
    'if (workspace.identityStatus === "resolving") {',
  );
  const recoveryIdx = CODE.indexOf(
    'if (workspace.identityStatus === "recovery_required") {',
  );
  assert.ok(resolvingIdx >= 0 && recoveryIdx >= 0 && teaIdx >= 0);
  assert.ok(recoveryIdx < teaIdx && resolvingIdx < teaIdx);
});

test("an Account session is never optimistically allowed pre-paint from localStorage alone", () => {
  const preLayoutEffect = CODE.slice(
    0,
    CODE.indexOf("useEffect(() => {\n    let mounted"),
  );
  assert.match(
    preLayoutEffect,
    /workspace\.isAccountSession === false/,
  );
});

test("does not re-derive attendee identity or Event choice independently -- no direct RPC calls in this component", () => {
  assert.equal(/\.rpc\(/.test(CODE), false);
});

test("the Provider still owns the invalid-established-context navigation; the Guard's only redirect-with-reason is the shared identity recovery_required case", () => {
  // The Guard does not re-run the Provider's established-context "invalid"
  // redirect. It DOES own the shared attendee-identity recovery redirect
  // (recovery_required) -- a distinct state the Provider does not act on.
  const recoveryIdx = CODE.indexOf(
    'if (workspace.identityStatus === "recovery_required") {',
  );
  assert.ok(recoveryIdx >= 0);
  // contextInvalid appears ONLY inside that recovery branch, as a
  // destination (reusing the existing account recovery surface).
  const firstContextInvalid = CODE.indexOf("contextInvalid");
  assert.ok(firstContextInvalid > recoveryIdx);
  assert.doesNotMatch(
    CODE,
    /contextStatus === "invalid"/,
  );
});

// ---------------------------------------------------------------------------
// Lapsed Account session (account-origin marker present, Supabase Auth
// session gone). Must NOT be reclassified as Temporary Event Access and
// must NOT render protected children -- route to re-authentication instead.
// ---------------------------------------------------------------------------

test("account-vs-temporary is decided by the existing fcoc-member-auth-user-id marker, read via the shared helper (no new MemberSession origin field)", () => {
  assert.match(CODE, /getStoredMemberAuthUserId/);
  assert.match(CODE, /const accountOriginMarker = getStoredMemberAuthUserId\(\);/);
});

test("a lapsed Account session is denied and routed to sign-in BEFORE the Temporary Event Access allow path", () => {
  const lapsedIdx = CODE.indexOf(
    "if (accountOriginMarker && workspace.isAccountSession === false) {",
  );
  const tempAllowIdx = CODE.indexOf(
    "if (workspace.isAccountSession === false) {",
  );
  assert.ok(lapsedIdx >= 0, "expected the lapsed-account branch");
  assert.ok(tempAllowIdx >= 0, "expected the Temporary Access allow branch");
  assert.ok(
    lapsedIdx < tempAllowIdx,
    "the lapsed-account check must run before the Temporary Access allow",
  );

  const branch = CODE.slice(lapsedIdx, tempAllowIdx);
  assert.match(branch, /setStatus\("denied"\)/);
  assert.match(branch, /clearMemberLocalState\(\)/);
  assert.match(branch, /router\.replace\("\/member\/login\?sessionExpired=1"\)/);
  assert.match(branch, /return;/);
  // never "allowed" for this state
  assert.equal(/setStatus\("allowed"\)/.test(branch), false);
});

test("a lapsed Account session is never optimistically painted as allowed pre-paint", () => {
  const preLayoutEffect = CODE.slice(
    0,
    CODE.indexOf("useEffect(() => {\n    let mounted"),
  );
  // the optimistic allow explicitly excludes the account-origin marker
  assert.match(
    preLayoutEffect,
    /!accountOriginMarker &&\s*\n\s*workspace\.isAccountSession === false/,
  );
});

test("re-auth navigation cannot loop: the lapsed branch returns immediately and the effect's deps do not include anything clearMemberLocalState mutates", () => {
  // single router.replace to the sign-in path in the lapsed branch
  const matches = CODE.match(
    /router\.replace\("\/member\/login\?sessionExpired=1"\)/g,
  );
  assert.equal(matches?.length, 1);
  // the verification effect still keys only off router + workspace signals,
  // never off a localStorage value the clear would change
  assert.match(
    CODE,
    /\}, \[\s*\n\s*router,\s*\n\s*workspace\.isAccountSession,\s*\n\s*workspace\.contextStatus,\s*\n\s*workspace\.identityStatus,\s*\n\s*\]\);/,
  );
  // the recovery_required redirect also runs at most once per firing and
  // its destinations are fixed strings, not derived from cleared state
  const recoveryRedirects = CODE.match(
    /router\.replace\(\s*\n?\s*sessionData\?\.session\s*\n?\s*\? "\/member\/account\?contextInvalid=1"\s*\n?\s*: "\/member\/login\?sessionExpired=1"/,
  );
  assert.ok(recoveryRedirects, "expected the single fixed-destination recovery redirect");
});

test("still no direct identity/context RPC in this component after the repair", () => {
  assert.equal(/\.rpc\(/.test(CODE), false);
});

test("Member Workspace Continuity: PROTECTED_MEMBER_WORKSPACE_ROUTE_PREFIXES covers every route tree that actually renders <MemberRouteGuard>", () => {
  // the provider's protected-route set that gates both the recovery effect
  // and the established-context validation effect
  const listMatch = PROVIDER_SOURCE.match(
    /PROTECTED_MEMBER_WORKSPACE_ROUTE_PREFIXES = \[([\s\S]*?)\] as const/,
  );
  assert.ok(listMatch, "expected the protected-route prefix list");
  const prefixes = [...listMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...prefixes].sort(),
    ["/activities", "/announcements", "/coach-map", "/member"],
  );

  // every file that renders <MemberRouteGuard> must sit under one of those
  // prefixes (derived from its app/ route path)
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
      if (entry.name !== "page.tsx") continue;
      const src = readFileSync(full, "utf8");
      if (!/useMemberWorkspace\(/.test(src)) continue;
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
    // the member dashboard self-enforces: it consumes identityStatus and
    // routes to explicit recovery on recovery_required (it is not
    // <MemberRouteGuard>-wrapped by design -- it IS the recovery landing
    // decision surface).
    const selfEnforces =
      route === "/member" &&
      /workspace\.identityStatus === "recovery_required"/.test(src) &&
      /router\.replace\(/.test(src);
    assert.ok(
      wrapped || selfEnforces,
      `${route} consumes useMemberWorkspace() but neither renders <MemberRouteGuard> nor self-enforces the shared identity state -- a recovery_required workspace could render through with null identity`,
    );
  }
});
