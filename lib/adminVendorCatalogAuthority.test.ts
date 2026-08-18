import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Vendor Catalog Authority Client Foundation. Run with:
//   npx tsx --test lib/adminVendorCatalogAuthority.test.ts
//
// Following the same split lib/adminTenantAuthority.test.ts already
// establishes: this repository has no HTTP/Supabase mocking
// infrastructure anywhere, so the RPC-dependent branches are proven
// structurally against source, not executed against a live client.

const SOURCE = readFileSync(
  fileURLToPath(new URL("./adminVendorCatalogAuthority.ts", import.meta.url)),
  "utf8",
);

// Strips // line comments before checking for a code-level reference, so
// the module's own explanatory comments don't trip a check for actual
// code usage.
const SOURCE_NO_COMMENTS = SOURCE.replace(/\/\/.*$/gm, "");

const CHECK_FN = SOURCE.slice(
  SOURCE.indexOf("export async function checkAdminVendorCatalogAuthority"),
);

test("calls exactly the self-scoped RPC, with no arguments, and no other table or function", () => {
  assert.match(CHECK_FN, /\.rpc\(\s*\n?\s*"has_my_vendor_catalog_admin_authority",?\s*\n?\s*\);/);
  assert.equal((CHECK_FN.match(/\.rpc\(/g) || []).length, 1);
  assert.equal(/\.from\(/.test(SOURCE), false);
});

test("the arbitrary-uid-taking RPC is never called from the client -- only the self-scoped, zero-argument wrapper is referenced", () => {
  assert.equal(
    /\.rpc\(\s*"has_vendor_catalog_admin_authority"/.test(SOURCE),
    false,
  );
  assert.equal(/_uid|p_uid/.test(SOURCE_NO_COMMENTS), false);
});

test("the function takes no parameters -- it never accepts or forwards a caller-supplied identity", () => {
  assert.match(
    SOURCE,
    /export async function checkAdminVendorCatalogAuthority\(\): Promise<AdminVendorCatalogAuthorityResult> \{/,
  );
});

test("an RPC error resolves to check_failed, checked before the data branch -- never treated as allowed", () => {
  const errorBranch = CHECK_FN.slice(
    CHECK_FN.indexOf("if (error)"),
    CHECK_FN.indexOf("return data ?"),
  );
  assert.match(errorBranch, /status: "check_failed"/);
  assert.equal(/"allowed"/.test(errorBranch), false);
});

test("RPC true maps to allowed, RPC false maps to denied, in one ternary with no third path", () => {
  assert.match(
    SOURCE,
    /return data \? \{ status: "allowed" \} : \{ status: "denied" \};/,
  );
});

test("the error check comes before the data ternary in source order -- an error can never fall through to allowed/denied", () => {
  const errorIdx = CHECK_FN.indexOf("if (error)");
  const ternaryIdx = CHECK_FN.indexOf("return data ?");
  assert.ok(errorIdx > -1 && ternaryIdx > -1);
  assert.ok(errorIdx < ternaryIdx);
});

test("no Event dimension exists -- no no_event-equivalent status, no Event ID parameter or reference", () => {
  assert.equal(/no_event/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/eventId|event_id|getCurrentAdminEvent/.test(SOURCE_NO_COMMENTS), false);
});

test("no Tenant dimension exists -- no Tenant ID parameter or reference", () => {
  assert.equal(/tenantId|tenant_id|p_tenant_id/.test(SOURCE_NO_COMMENTS), false);
});

test("no client-side admin.isSuperAdmin short-circuit exists -- Super Admin inheritance is resolved authoritatively server-side", () => {
  assert.equal(/isSuperAdmin/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/hasPermission/.test(SOURCE_NO_COMMENTS), false);
});

test("no alternative/duplicate authority implementation exists in the function body -- exactly one code path produces each outcome, beyond the type declaration", () => {
  assert.equal((CHECK_FN.match(/status: "allowed"/g) || []).length, 1);
  assert.equal((CHECK_FN.match(/status: "denied"/g) || []).length, 1);
  assert.equal((CHECK_FN.match(/status: "check_failed"/g) || []).length, 1);
  assert.equal((CHECK_FN.match(/\.rpc\(/g) || []).length, 1);
});

test("the function is exported as an async function returning the documented result union, per its own type signature", () => {
  assert.match(
    SOURCE,
    /export async function checkAdminVendorCatalogAuthority\(\): Promise<AdminVendorCatalogAuthorityResult> \{/,
  );
  assert.match(
    SOURCE,
    /export type AdminVendorCatalogAuthorityResult =\s*\n\s*\| \{ status: "allowed" \}\s*\n\s*\| \{ status: "denied" \}\s*\n\s*\| \{ status: "check_failed"; message: string \};/,
  );
});
