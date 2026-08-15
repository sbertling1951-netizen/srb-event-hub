import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Vendor Profile GET governance
// repair -- GET's own public.vendors read moves from the service-role
// admin client to the existing token-bound client, so the read executes
// under the already-live vendors_select_policy instead of bypassing RLS.
//
// This route.ts exports Next.js Route Handlers that use next/headers'
// cookies() and a live Supabase call, matching the pattern already
// established by app/api/member/vendor-requests/
// interpretVendorRequestRpcRows.test.ts: no route-handler test harness
// exists in this repo for that context, so this exercises the route's
// source shape directly rather than invoking GET()/PATCH() at runtime.
//
// What this proves: the wiring change (which client each handler
// constructs, in what order, and what it queries) matches the scoped
// governance repair exactly, and PATCH's already-governed shape is
// untouched.
//
// What this does NOT prove: live RLS behavior (vendor_admin/vendor_member
// visibility, rejection of a foreign/unpermitted vendor id) -- that is
// covered by vendors_select_policy's own live migration test suite
// (20260814080000_reconcile_vendors_catalog_authority.test.ts), which
// this task does not modify because the policy itself is unchanged.
//
// Run with:
//   npx tsx --test app/api/vendor/workspace/profile/route.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);

function section(name: "GET" | "PATCH") {
  const startMarker = `export async function ${name}`;
  const start = SOURCE.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find ${startMarker}`);
  const nextExportStart = SOURCE.indexOf(
    "\nexport async function ",
    start + startMarker.length,
  );
  return nextExportStart === -1
    ? SOURCE.slice(start)
    : SOURCE.slice(start, nextExportStart);
}

test("route.ts no longer imports getSupabaseAdminClient", () => {
  assert.equal(/getSupabaseAdminClient/.test(SOURCE), false);
});

test("GET obtains the vendor access token from VENDOR_AUTH_COOKIE before querying vendors", () => {
  const get = section("GET");
  const tokenIdx = get.indexOf("cookieStore.get(VENDOR_AUTH_COOKIE)");
  const queryIdx = get.indexOf('.from("vendors")');
  assert.ok(tokenIdx !== -1, "expected GET to read VENDOR_AUTH_COOKIE");
  assert.ok(queryIdx !== -1, "expected GET to query vendors");
  assert.ok(tokenIdx < queryIdx, "token must be obtained before the vendors query");
});

test("GET preserves missing-session error semantics", () => {
  const get = section("GET");
  assert.match(get, /reason:\s*"missing_vendor_session"/);
  assert.match(get, /status:\s*401/);
});

test("GET constructs the token-bound client and queries vendors through it, not the admin client", () => {
  const get = section("GET");
  assert.match(get, /createVendorTokenBoundClient\(accessToken\)/);
  const clientIdx = get.indexOf("createVendorTokenBoundClient(accessToken)");
  const queryIdx = get.indexOf('.from("vendors")');
  assert.ok(clientIdx !== -1 && queryIdx !== -1 && clientIdx < queryIdx);
  assert.equal(/supabaseAdmin/.test(get), false);
  assert.match(get, /supabaseVendor\s*\n?\s*\.from\("vendors"\)/);
});

test("GET preserves the exact selected columns, filter, and single-row shape", () => {
  const get = section("GET");
  assert.match(
    get,
    /"id,business_name,contact_name,email,phone,website,logo_url,business_description,preferred_contact_method,is_active"/,
  );
  assert.match(get, /\.eq\("id", selectedVendor\.vendorId\)/);
  assert.match(get, /\.maybeSingle\(\)/);
});

test("GET preserves the existing response shape (ok, canEdit, vendor)", () => {
  const get = section("GET");
  assert.match(get, /canEdit:\s*selectedVendor\.role === "vendor_admin"/);
  assert.match(get, /vendor:\s*vendor \|\| null/);
});

test("PATCH remains on the token-bound client and vendors_update_policy governance, unchanged", () => {
  const patch = section("PATCH");
  assert.match(patch, /createVendorTokenBoundClient\(accessToken\)/);
  assert.match(patch, /vendors_update_policy/);
  assert.match(patch, /\.update\(updatePayload\)/);
  assert.equal(/supabaseAdmin/.test(patch), false);
});

test("resolveVendorAccessFromCookies is still the sole session-resolution entry point for both handlers", () => {
  const occurrences = SOURCE.match(/resolveVendorAccessFromCookies\(cookieStore\)/g) || [];
  assert.equal(occurrences.length, 2);
});
