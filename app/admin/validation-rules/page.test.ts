import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

// G-03D: Validation Rules route-authority migration.
//
// Unlike the other G-03 routes, event.validation_rules.manage is
// deliberately excluded from the default event_admin per-Event task
// bundle (20260811170000_create_scoped_task_authority_foundation.sql:81
// -- the one event-scope task singled out by name in that exclusion) --
// an ordinary Event Admin does not get it just by being an Event Admin.
// It still carries tenant_inherits = true like every other event.* task,
// so a Tenant Administrator (has_tenant_admin_authority: an active
// super_admin, or an explicit admin_tenant_access row for the Tenant --
// not the broad "admin"/"event_admin" privilege_group tier) holds it
// automatically. This is the intended governance model, confirmed before
// implementation: a read-only check of the live
// admin_privilege_group_permissions table found zero rows for
// can_manage_validation_rules under any privilege_group -- today only
// super_admin (via the isSuperAdmin bypass) can reach this route, so the
// migration is a pure widening to Tenant Administrators, with no existing
// ordinary-Event-Admin grant at risk of being removed. Run with:
//   npx tsx --test app/admin/validation-rules/page.test.ts

test("route requires event.validation_rules.manage, not the legacy can_manage_validation_rules permission", () => {
  assert.match(
    PAGE_SOURCE,
    /<AdminRouteGuard requiredTask="event\.validation_rules\.manage">/,
  );
  assert.equal(/requiredPermission/.test(PAGE_SOURCE), false);
  assert.equal(/can_manage_validation_rules/.test(PAGE_SOURCE), false);
});

test("no direct has_event_task_authority RPC call is introduced -- authority is owned entirely by AdminRouteGuard", () => {
  assert.equal(/has_event_task_authority/.test(PAGE_SOURCE), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(PAGE_SOURCE), false);
});

test("the unreachable inner legacy gate (can_manage_admins / can_manage_validation_rules) is removed -- it solely duplicated whole-route access under the old guard, and would have wrongly blocked Tenant Admins who hold the new task without ever having held the legacy permission", () => {
  assert.equal(/hasPermission/.test(PAGE_SOURCE), false);
  assert.equal(/You do not have permission to manage validation rules\./.test(PAGE_SOURCE), false);
});

test("Event-membership (canAccessEvent) remains as a page-local check, unrelated to the migrated permission", () => {
  assert.match(PAGE_SOURCE, /canAccessEvent\(resolvedAdmin, event\.id\)/);
});

test("Event context handling is unchanged: reads getCurrentAdminEvent and re-syncs on Admin workspace change", () => {
  assert.match(PAGE_SOURCE, /const event = getCurrentAdminEvent\(\);/);
  assert.match(PAGE_SOURCE, /subscribeToAdminWorkspace\(/);
  assert.equal(/setCurrentAdminEvent/.test(PAGE_SOURCE), false);
});

test("validation-rule CRUD and rule-evaluation behavior is unchanged", () => {
  for (const needle of ['from("validation_rules")', "setCurrentEvent", "loadPage"]) {
    assert.ok(PAGE_SOURCE.includes(needle), `Validation Rules must retain ${needle}`);
  }
});
