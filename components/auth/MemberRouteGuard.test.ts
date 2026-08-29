import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for Member Event Context Stage 2's
// MemberRouteGuard: an Account session must pass governed established-
// context validation to be allowed; Temporary Event Access is unchanged.
//
// Run with:
//   npx tsx --test components/auth/MemberRouteGuard.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./MemberRouteGuard.tsx", import.meta.url)),
  "utf8",
);
const CODE = SOURCE.replace(/^\s*\/\/.*$/gm, "");

test("consumes MemberWorkspaceProvider's governed context, not a second identity/context source", () => {
  assert.match(CODE, /useMemberWorkspace\(\)/);
});

test("Temporary Event Access (isAccountSession === false) keeps the prior localStorage-sufficient contract", () => {
  assert.match(
    CODE,
    /if \(workspace\.isAccountSession === false\) \{[\s\S]{0,300}?setStatus\("allowed"\);/,
  );
});

test("an Account session is allowed only once contextStatus is valid or a transient error (never merely from localStorage)", () => {
  assert.match(
    CODE,
    /if \(\s*\n\s*workspace\.contextStatus === "valid" \|\|\s*\n\s*workspace\.contextStatus === "error"\s*\n\s*\) \{[\s\S]{0,200}?setStatus\("allowed"\);/,
  );
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

test("invalid established context is not handled by a redirect here -- the Provider owns that navigation exactly once", () => {
  assert.equal(/contextInvalid/.test(CODE), false);
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
    /\}, \[router, workspace\.isAccountSession, workspace\.contextStatus\]\);/,
  );
});

test("still no direct identity/context RPC in this component after the repair", () => {
  assert.equal(/\.rpc\(/.test(CODE), false);
});
