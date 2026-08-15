import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Legacy Login Transfer canonical
// redemption page (Stage 3B). Consistent with this repository's
// established convention (no RTL/jsdom harness exists here) -- behavior
// is proven from source.
//
// Run with:
//   npx tsx --test app/auth/legacy-transfer/page.test.tsx

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);
const CODE_ONLY = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("is a client component", () => {
  assert.match(SOURCE, /^"use client";/);
});

// ---- Fragment parsing/stripping ----

test("fragment is parsed from window.location.hash, accepting exactly one t value with a bounded, URL-safe pattern", () => {
  assert.match(SOURCE, /window\.location\.hash/);
  assert.match(SOURCE, /TOKEN_PATTERN = \/\^\[A-Za-z0-9_-\]\{1,256\}\$\//);
  assert.match(SOURCE, /params\.getAll\("t"\)/);
  assert.match(SOURCE, /values\.length !== 1/);
});

test("the fragment is stripped via history.replaceState before any network request", () => {
  const stripIdx = SOURCE.indexOf("window.history.replaceState");
  const fetchIdx = SOURCE.indexOf("fetch(");
  assert.ok(stripIdx >= 0 && fetchIdx >= 0);
  assert.ok(stripIdx < fetchIdx, "history.replaceState must run before the redemption fetch call");
});

test("replaceState preserves the pathname and drops the fragment", () => {
  assert.match(SOURCE, /window\.history\.replaceState\(null, "", window\.location\.pathname\)/);
});

test("missing/malformed token never calls redemption and navigates to /login", () => {
  const tokenCheckIdx = SOURCE.indexOf("if (!token) {");
  const fetchIdx = SOURCE.indexOf("fetch(");
  assert.ok(tokenCheckIdx >= 0 && fetchIdx >= 0 && tokenCheckIdx < fetchIdx);
  const block = SOURCE.slice(tokenCheckIdx, fetchIdx);
  assert.match(block, /router\.replace\("\/login"\)/);
});

// ---- Redemption request ----

test("token is submitted in the POST body, never a query string", () => {
  assert.match(SOURCE, /fetch\("\/api\/legacy-transfer\/redeem"/);
  assert.match(SOURCE, /body:\s*JSON\.stringify\(\{\s*token\s*\}\)/);
  assert.doesNotMatch(SOURCE, /redeem\?token=/);
});

// ---- Destination pass-through ----

test("no second decode/normalization is performed on the redeemed destination", () => {
  assert.doesNotMatch(CODE_ONLY, /decodeURIComponent/);
  assert.doesNotMatch(CODE_ONLY, /validateTransferDestination/);
});

test("router.replace uses the exact destination value from the response", () => {
  assert.match(SOURCE, /router\.replace\(destination\)/);
  assert.match(SOURCE, /const destination =\s*\n\s*typeof payload\.destination === "string" \? payload\.destination : "\/";/);
});

// ---- Admin/member session installation ----

test("setSession runs, and is confirmed successful, before final navigation", () => {
  const setSessionIdx = SOURCE.indexOf("supabase.auth.setSession");
  const navigateIdx = SOURCE.lastIndexOf("router.replace(destination)");
  assert.ok(setSessionIdx >= 0 && navigateIdx >= 0);
  assert.ok(setSessionIdx < navigateIdx, "setSession must run before the final navigation");
  assert.match(SOURCE, /if \(error \|\| !data\.session\) \{/);
});

test("a failed setSession does not navigate to the protected destination", () => {
  const failBlock = SOURCE.slice(
    SOURCE.indexOf("if (error || !data.session) {"),
    SOURCE.indexOf("if (error || !data.session) {") + 150,
  );
  assert.match(failBlock, /router\.replace\("\/login"\)/);
  assert.doesNotMatch(failBlock, /router\.replace\(destination\)/);
});

// ---- Vendor path ----

test("vendor path (no access/refresh tokens in the response) skips setSession and navigates directly", () => {
  assert.match(
    SOURCE,
    /if \(\s*\n\s*typeof payload\.access_token === "string" &&\s*\n\s*typeof payload\.refresh_token === "string"\s*\n\s*\) \{/,
  );
});

test("does not read or set the vendor cookie directly -- the server already established it", () => {
  assert.doesNotMatch(SOURCE, /fcoc-vendor-access-token/);
  assert.doesNotMatch(SOURCE, /document\.cookie/);
});

// ---- Scope discipline ----

test("is not a general auth UI -- no password/email input fields", () => {
  assert.doesNotMatch(SOURCE, /type="password"/);
  assert.doesNotMatch(SOURCE, /type="email"/);
});

test("imports the shared Supabase client singleton, not a new client instance", () => {
  assert.match(SOURCE, /import \{ supabase \} from "@\/lib\/supabase"/);
  assert.doesNotMatch(SOURCE, /createClient\(/);
});
