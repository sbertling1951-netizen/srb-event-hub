import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Vendor Catalog Authority Client Foundation, /admin/vendors/access
// consumer migration -- from the legacy can_manage_vendors permission to
// the canonical, self-scoped requiredVendorCatalogAuthority route gate.
// No HTTP/Supabase mocking infrastructure exists in this repository, so
// these are structural, source-level assertions -- the same style
// already established for app/admin/nearby-settings/page.test.ts.

const source = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("route uses the canonical, self-scoped Vendor Catalog authority gate, not the legacy permission", () => {
  assert.match(source, /<AdminRouteGuard requiredVendorCatalogAuthority>/);
  assert.equal(/can_manage_vendors/.test(source), false);
  assert.equal(/requiredPermission/.test(source), false);
});

test("this is not an Event task and not a Tenant check -- no requiredTask or requiredTenantAuthority is introduced", () => {
  assert.equal(/requiredTask/.test(source), false);
  assert.equal(/requiredTenantAuthority/.test(source), false);
  assert.equal(/getCurrentAdminEvent|adminEventContext|adminWorkspaceContext/.test(source), false);
});

test("no duplicate in-page permission or authority re-check exists -- the route guard is the only authority gate on this page", () => {
  assert.equal(/hasPermission\(/.test(source), false);
  assert.equal(/checkAdminVendorCatalogAuthority/.test(source), false);
});

test("no direct arbitrary-uid authority RPC is introduced -- the page never calls has_vendor_catalog_admin_authority or has_my_vendor_catalog_admin_authority itself", () => {
  assert.equal(/has_vendor_catalog_admin_authority/.test(source), false);
  assert.equal(/has_my_vendor_catalog_admin_authority/.test(source), false);
});

test("the invite actions use the shared FormActions layout primitive", () => {
  assert.match(source, /import \{ FormActions \} from "@\/components\/ui\/FormActions";/);
  assert.match(source, /<FormActions>[\s\S]*?Send Invitation[\s\S]*?Resend Invitation[\s\S]*?Refresh[\s\S]*?<\/FormActions>/);
  assert.equal(/display: "flex", gap: 8, flexWrap: "wrap"/.test(source), false);
});

test("the page offers a persistent parent-return control via the shell's own backTarget mechanism -- not a page-local link", () => {
  assert.match(
    source,
    /<AdminShellAdapter\s*\n\s*pageTitle="Vendor Access Invitations"\s*\n\s*backTarget=\{\{ href: "\/admin\/vendors", label: "Vendor Management" \}\}\s*\n\s*>/,
  );
});
