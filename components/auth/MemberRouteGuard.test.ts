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
