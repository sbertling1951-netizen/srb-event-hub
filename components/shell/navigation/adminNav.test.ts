import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAdminNavSections } from "@/components/shell/navigation/adminNav";
import type { AdminAccessResult } from "@/lib/getCurrentAdminAccess";

// Focused tests for the /admin/imports navigation-discoverability fix
// (2026-08-22). Root cause: /admin/imports (née "Attendee Management")
// was dropped from Sidebar.tsx's Admin nav array in commit 730252f
// ("Add attendee management back links and clean sidebar navigation",
// 2026-04-25) when four related tools were folded toward the new
// consolidated /admin/attendees page; the cross-navigation that removal
// implied never materialized, and the later canonical-shell nav model
// (this file) faithfully reproduced Sidebar's already-gapped state
// rather than reintroducing it. The route itself
// (app/admin/imports/page.test.ts) was never affected -- only
// discoverability was missing. Run with:
//   npx tsx --test components/shell/navigation/adminNav.test.ts

function buildAdmin(overrides: Partial<AdminAccessResult> = {}): AdminAccessResult {
  return {
    adminUser: {
      id: "admin-1",
      email: "admin@example.com",
      display_name: "Admin",
      is_active: true,
      privilege_group: "event_admin",
      user_id: "user-1",
    },
    eventAccessRows: [],
    permissionKeys: [],
    permissionMap: {},
    rolePermissions: [],
    eventPermissionKeys: [],
    privilegeGroup: "event_admin",
    isSuperAdmin: false,
    email: "admin@example.com",
    display_name: "Admin",
    privilege_group: "event_admin",
    eventIds: [],
    event_ids: [],
    ...overrides,
  };
}

function findItem(sections: ReturnType<typeof buildAdminNavSections>, id: string) {
  for (const section of sections) {
    const item = section.items.find((i) => i.id === id);
    if (item) {
      return { item, section };
    }
  }
  return null;
}

test("only a Super Admin sees the canonical Tenant Administration navigation item", () => {
  const superAdmin = buildAdmin({ isSuperAdmin: true });
  const tenantAdmin = buildAdmin({ permissionMap: { can_manage_admins: true } });

  const found = findItem(buildAdminNavSections(superAdmin), "tenants");
  assert.ok(found);
  assert.equal(found.item.label, "Tenant Administration");
  assert.equal(found.item.href, "/admin/tenants");
  assert.equal(found.section.id, "admin");
  assert.equal(findItem(buildAdminNavSections(tenantAdmin), "tenants"), null);
  assert.equal(findItem(buildAdminNavSections(null), "tenants"), null);
});

test("an admin granted can_manage_imports sees the Imports link, pointed at /admin/imports, in the Operations section", () => {
  const admin = buildAdmin({ permissionMap: { can_manage_imports: true } });
  const found = findItem(buildAdminNavSections(admin), "imports");

  assert.ok(found, "expected an 'imports' nav item to be present");
  // Stage 5A: renamed from "Attendee Imports" now that /admin/imports is a
  // shared Service Center for Attendee Roster, Agenda, and Vendors, not an
  // Attendee-only tool.
  assert.equal(found!.item.label, "Imports");
  assert.equal(found!.item.href, "/admin/imports");
  assert.equal(found!.section.id, "operations");
});

test("an admin without can_manage_imports (and no other permission) does not see the Imports link", () => {
  const admin = buildAdmin({ permissionMap: {} });
  const found = findItem(buildAdminNavSections(admin), "imports");

  assert.equal(found, null);
});

test("granting an unrelated permission alone does not surface the Imports link -- it is not accidentally coupled to Attendees/Check-In/Parking visibility", () => {
  for (const key of ["can_manage_attendees", "can_manage_checkin", "can_manage_parking"]) {
    const admin = buildAdmin({ permissionMap: { [key]: true } });
    const found = findItem(buildAdminNavSections(admin), "imports");
    assert.equal(found, null, `granting only "${key}" must not surface the Imports link`);
  }
});

test("a super admin sees the Imports link via the same isSuperAdmin bypass every other nav item already uses", () => {
  const admin = buildAdmin({ isSuperAdmin: true, permissionMap: {} });
  const found = findItem(buildAdminNavSections(admin), "imports");

  assert.ok(found, "expected super_admin to see the Imports link");
  assert.equal(found!.item.href, "/admin/imports");
});

test("a null admin (access not yet resolved) fails closed to no Imports link, same as every other item", () => {
  const found = findItem(buildAdminNavSections(null), "imports");
  assert.equal(found, null);
});

test("granting can_manage_imports adds exactly one new item and leaves every other Operations item's visibility rule untouched", () => {
  const baseline = buildAdminNavSections(
    buildAdmin({
      permissionMap: {
        can_manage_attendees: true,
        can_manage_checkin: true,
        can_manage_parking: true,
        can_manage_reports: true,
        can_manage_vendors: true,
      },
    }),
  );
  const withImports = buildAdminNavSections(
    buildAdmin({
      permissionMap: {
        can_manage_attendees: true,
        can_manage_checkin: true,
        can_manage_parking: true,
        can_manage_reports: true,
        can_manage_vendors: true,
        can_manage_imports: true,
      },
    }),
  );

  const baselineOps = baseline.find((s) => s.id === "operations")!.items.map((i) => i.id);
  const withImportsOps = withImports.find((s) => s.id === "operations")!.items.map((i) => i.id);

  assert.deepEqual(
    withImportsOps.filter((id) => id !== "imports"),
    baselineOps,
    "adding can_manage_imports must not reorder or remove any existing Operations item",
  );
  assert.ok(withImportsOps.includes("imports"));
  assert.equal(withImportsOps.length, baselineOps.length + 1);
});

test("every other existing nav item and section is unchanged for a full-access admin -- the fix is additive only", () => {
  // Engagement's section is gated directly on privilege_group ===
  // "super_admin" (a documented, deliberate exception to the
  // hasPermission() convention every other item uses), so both fields
  // must be set to see the complete section list.
  const admin = buildAdmin({ isSuperAdmin: true, privilege_group: "super_admin" });
  const sections = buildAdminNavSections(admin);

  const sectionIds = sections.map((s) => s.id);
  assert.deepEqual(sectionIds, ["admin", "operations", "content", "intelligence", "staff-setup"]);

  const allItemIds = sections.flatMap((s) => s.items.map((i) => i.id));
  for (const expectedId of [
    "dashboard",
    "events",
    "admin-users",
    "tenants",
    "permissions",
    "attendees",
    "checkin",
    "parking",
    "print",
    "vendors",
    "agenda",
    "announcements",
    "photos",
    "map-admin",
    "engagement",
    "event-staff",
    "checklist",
  ]) {
    assert.ok(allItemIds.includes(expectedId), `expected pre-existing nav item "${expectedId}" to still be present`);
  }
});
