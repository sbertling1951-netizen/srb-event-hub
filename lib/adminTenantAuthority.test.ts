import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Tenant Admin Route Authority Foundation, Part B. Run with:
//   npx tsx --test lib/adminTenantAuthority.test.ts
//
// Following the same split lib/adminTaskAuthority.test.ts already
// establishes: this repository has no HTTP/Supabase mocking
// infrastructure anywhere, so the RPC-dependent branches are proven
// structurally against source, not executed against a live client.

const SOURCE = readFileSync(
  fileURLToPath(new URL("./adminTenantAuthority.ts", import.meta.url)),
  "utf8",
);

// Strips // line comments before checking for a code-level reference, so
// the module's own explanatory comments (which necessarily name the
// no_event/isSuperAdmin concepts to explain their deliberate absence)
// don't trip a check for actual code usage.
const SOURCE_NO_COMMENTS = SOURCE.replace(/\/\/.*$/gm, "");

// ---- Structural proof for the RPC-dependent branches. ----

test("calls exactly the existing governed self-scoped RPC, with no arguments, and no other table or function", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("export async function checkAdminTenantAuthority"));
  assert.match(fn, /\.rpc\("has_any_tenant_admin_authority"\)/);
  assert.equal((fn.match(/\.rpc\(/g) || []).length, 1);
  assert.equal(/\.from\(/.test(SOURCE), false);
});

test("no target Tenant ID is ever passed to the RPC -- this is the coarse, Tenant-agnostic check only", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("export async function checkAdminTenantAuthority"));
  assert.equal(/p_tenant_id|tenantId/.test(fn), false);
});

test("the function takes no parameters -- it never accepts or forwards a caller-supplied identity or Tenant", () => {
  assert.match(SOURCE, /export async function checkAdminTenantAuthority\(\): Promise<AdminTenantAuthorityResult> \{/);
});

test("an RPC error resolves to check_failed, checked before the data branch -- never treated as allowed", () => {
  const errorBranch = SOURCE.slice(
    SOURCE.indexOf("if (error)"),
    SOURCE.indexOf("return data ?"),
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
  const errorIdx = SOURCE.indexOf("if (error)");
  const ternaryIdx = SOURCE.indexOf("return data ?");
  assert.ok(errorIdx > -1 && ternaryIdx > -1);
  assert.ok(errorIdx < ternaryIdx);
});

test("there is no no_event-equivalent status -- this check has no Event dimension", () => {
  assert.equal(/no_event/.test(SOURCE_NO_COMMENTS), false);
});

test("no client-side admin.isSuperAdmin short-circuit exists -- Platform inheritance is resolved authoritatively server-side, matching checkAdminEventTaskAuthority's own precedent", () => {
  assert.equal(/isSuperAdmin/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/hasPermission/.test(SOURCE_NO_COMMENTS), false);
});

test("no alternative/duplicate authority implementation exists in the function body -- exactly one code path produces each outcome, beyond the type declaration", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("export async function checkAdminTenantAuthority"));
  assert.equal((fn.match(/status: "allowed"/g) || []).length, 1);
  assert.equal((fn.match(/status: "denied"/g) || []).length, 1);
  assert.equal((fn.match(/status: "check_failed"/g) || []).length, 1);
  assert.equal((fn.match(/\.rpc\(/g) || []).length, 1);
});

test("the function is exported as an async function returning the documented result union, per its own type signature", () => {
  assert.match(
    SOURCE,
    /export async function checkAdminTenantAuthority\(\): Promise<AdminTenantAuthorityResult> \{/,
  );
  assert.match(
    SOURCE,
    /export type AdminTenantAuthorityResult =\s*\n\s*\| \{ status: "allowed" \}\s*\n\s*\| \{ status: "denied" \}\s*\n\s*\| \{ status: "check_failed"; message: string \};/,
  );
});
