import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// --- Vendor Workspace Profile Governance Audit (2026-08-15) -- durability
// hardening -----------------------------------------------------------
// The audit found no defect: the route's own public.vendors GET/PATCH is
// already RLS-governed (proven above). The one remaining service-role
// table read in this path is resolveVendorAccessFromCookies()'s
// vendor_org_access lookup (lib/server/vendorAccess.ts), which the audit
// found safe only because it is scoped to the server-verified caller
// (auth_user_id = user.id) and to active access (status = "active") --
// not because of anything the route itself re-checks. The tests below
// protect exactly that seam so a future refactor cannot silently widen
// it without failing here.
//
// Run with:
//   npx tsx --test app/api/vendor/workspace/profile/route.test.ts

const VENDOR_ACCESS_SOURCE = readFileSync(
  fileURLToPath(
    new URL("../../../../../lib/server/vendorAccess.ts", import.meta.url),
  ),
  "utf8",
);

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

test("resolveVendorAccessFromCookies scopes its service-role vendor_org_access read to the verified auth user and active status", () => {
  const fnMatch = VENDOR_ACCESS_SOURCE.match(
    /export async function resolveVendorAccessFromCookies[\s\S]*?\n}/,
  );
  assert.ok(fnMatch, "expected to find resolveVendorAccessFromCookies");
  const fn = fnMatch[0];

  const queryMatch = fn.match(
    /supabaseAdmin\s*\n\s*\.from\("vendor_org_access"\)[\s\S]*?\.order\(/,
  );
  assert.ok(queryMatch, "expected a single chained vendor_org_access query ending in .order(");
  const queryBlock = queryMatch[0];

  assert.match(
    queryBlock,
    /\.eq\("auth_user_id", user\.id\)/,
    "vendor_org_access lookup must be scoped to the token-verified auth user, not any client-supplied id",
  );
  assert.match(
    queryBlock,
    /\.eq\("status", "active"\)/,
    "vendor_org_access lookup must exclude pending/suspended/revoked rows",
  );
});

test("no service-role query directly targets public.vendors in the identity-resolution path", () => {
  assert.equal(
    /\.from\("vendors"\)/.test(VENDOR_ACCESS_SOURCE),
    false,
    "vendors reads/writes must stay behind createVendorTokenBoundClient in the route, not the admin client here",
  );
});

test("VENDOR_SELECTED_COOKIE only selects within the already-scoped rows array, never re-queries the database", () => {
  assert.match(
    VENDOR_ACCESS_SOURCE,
    /rows\.find\(\(row\) => row\.vendorId === selectedFromCookie\)/,
    "the selected-vendor cookie must be matched against the pre-scoped rows array in memory",
  );
  assert.equal(
    /\.eq\([^)]*selectedFromCookie/.test(VENDOR_ACCESS_SOURCE),
    false,
    "the client-supplied selected-vendor cookie must never be used as a database query predicate",
  );
});
