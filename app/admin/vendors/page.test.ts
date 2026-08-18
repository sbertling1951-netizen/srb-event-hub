import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

// Strips // line comments before checking for a code-level reference, so
// the explanatory comment about the migration (which necessarily names
// the legacy permission key) doesn't trip a check for actual code usage.
const PAGE_SOURCE_NO_COMMENTS = PAGE_SOURCE.replace(/\/\/.*$/gm, "");

// G-03F: Vendors route-authority migration.
//
// /admin/vendors mixes two genuinely distinct authority domains, both
// already independently governed server-side regardless of the page-level
// route guard:
//   - Event vendor admission lifecycle (register/admit/reject/revoke,
//     update_event_vendor_metadata) -- already requires
//     event.vendors.manage/.view server-side
//     (20260814130000_create_vendor_admission_lifecycle_operations.sql,
//     20260814150000_create_event_vendor_metadata_governance.sql).
//   - Vendor Catalog identity CRUD (public.vendors: saveVendor()) -- a
//     separate authority question, already independently governed by RLS
//     via has_vendor_catalog_admin_authority
//     (20260814080000_reconcile_vendors_catalog_authority.sql), which
//     reproduces can_manage_vendors's exact semantics and is completely
//     unaffected by whichever key gates this route.
// Since catalog-wide mutations are independently protected at the
// backend either way, migrating the route's own visibility gate to
// event.vendors.manage does not broaden the real (RLS/RPC-enforced)
// authority surface -- only page reachability. Run with:
//   npx tsx --test app/admin/vendors/page.test.ts

test("route requires event.vendors.manage, not the legacy can_manage_vendors permission", () => {
  assert.match(
    PAGE_SOURCE,
    /<AdminRouteGuard requiredTask="event\.vendors\.manage">/,
  );
  assert.equal(/requiredPermission/.test(PAGE_SOURCE_NO_COMMENTS), false);
  assert.equal(/can_manage_vendors/.test(PAGE_SOURCE_NO_COMMENTS), false);
  assert.equal(/hasPermission/.test(PAGE_SOURCE_NO_COMMENTS), false);
});

test("no direct has_event_task_authority RPC call is introduced on the page -- authority is owned by AdminRouteGuard plus the already-governed RPCs/RLS", () => {
  assert.equal(/\.rpc\(\s*["']has_event_task_authority["']/.test(PAGE_SOURCE), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(PAGE_SOURCE), false);
});

test("Event-membership (canAccessEvent) remains as a page-local check, unrelated to the migrated permission", () => {
  assert.match(PAGE_SOURCE, /canAccessEvent\(admin, scopedEvent\.id\)/);
});

test("Event vendor admission lifecycle calls are unchanged", () => {
  for (const needle of [
    "registerVendorEventCandidacy",
    "admitVendorForEvent",
    "rejectVendorEventCandidacy",
    "revokeVendorAdmission",
    "updateEventVendorMetadata",
  ]) {
    assert.ok(PAGE_SOURCE.includes(needle), `Vendors must retain ${needle}`);
  }
});

test("Vendor Catalog identity CRUD (public.vendors) is unchanged and untouched by this migration", () => {
  assert.match(PAGE_SOURCE, /\.from\("vendors"\)\s*\n\s*\.update\(payload\)/);
  assert.match(PAGE_SOURCE, /\.from\("vendors"\)\s*\n\s*\.insert\(payload\)/);
});

test("Event context handling is unchanged: reads getCurrentAdminEvent and re-syncs on Admin workspace change", () => {
  assert.match(PAGE_SOURCE, /const adminEvent = getCurrentAdminEvent\(\);/);
  assert.match(PAGE_SOURCE, /subscribeToAdminWorkspace\(/);
  assert.equal(/setCurrentAdminEvent/.test(PAGE_SOURCE), false);
});
