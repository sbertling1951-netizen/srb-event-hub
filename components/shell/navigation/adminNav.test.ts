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

test("canonical Tenant authority exposes Add Event without any working-Event access", () => {
  const zeroEventTenantAdmin = buildAdmin({
    eventAccessRows: [],
    eventIds: [],
    event_ids: [],
    permissionMap: { can_view_admin_dashboard: true },
  });

  const found = findItem(
    buildAdminNavSections(zeroEventTenantAdmin, { status: "allowed" }),
    "add-event",
  );

  assert.ok(found);
  assert.equal(found.item.label, "Add Event");
  assert.equal(found.item.href, "/admin/events/new");
  assert.equal(found.section.id, "admin");
});

test("Platform and single- or multi-Tenant administrators use the same canonical Add Event entry", () => {
  for (const admin of [
    buildAdmin({ isSuperAdmin: true }),
    buildAdmin({ eventIds: ["event-1"], event_ids: ["event-1"] }),
    buildAdmin({
      eventIds: ["event-1", "event-2"],
      event_ids: ["event-1", "event-2"],
    }),
  ]) {
    const found = findItem(
      buildAdminNavSections(admin, { status: "allowed" }),
      "add-event",
    );
    assert.equal(found?.item.href, "/admin/events/new");
  }
});

test("direct Event authority alone never exposes Add Event", () => {
  const directEventAdmin = buildAdmin({
    eventAccessRows: [
      {
        id: "access-1",
        event_id: "event-1",
        admin_user_id: "admin-1",
        role: "event_admin",
      },
    ],
    eventIds: ["event-1"],
    event_ids: ["event-1"],
    permissionMap: { can_manage_events: true },
  });

  assert.ok(findItem(buildAdminNavSections(directEventAdmin), "events"));
  assert.equal(
    findItem(buildAdminNavSections(directEventAdmin), "add-event"),
    null,
  );
  assert.equal(
    findItem(
      buildAdminNavSections(directEventAdmin, { status: "denied" }),
      "add-event",
    ),
    null,
  );
});

test("unresolved and failed Tenant-authority checks fail closed to no Add Event entry", () => {
  const admin = buildAdmin({ isSuperAdmin: true });

  assert.equal(findItem(buildAdminNavSections(admin), "add-event"), null);
  assert.equal(
    findItem(
      buildAdminNavSections(admin, {
        status: "check_failed",
        message: "unavailable",
      }),
      "add-event",
    ),
    null,
  );
  assert.equal(
    findItem(buildAdminNavSections(null, { status: "allowed" }), "add-event"),
    null,
  );
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
  const sections = buildAdminNavSections(admin, { status: "allowed" });

  const sectionIds = sections.map((s) => s.id);
  assert.deepEqual(sectionIds, ["admin", "operations", "content", "intelligence", "staff-setup"]);

  const allItemIds = sections.flatMap((s) => s.items.map((i) => i.id));
  for (const expectedId of [
    "dashboard",
    "events",
    "add-event",
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

// ---- Event Staff nav visibility (downward delegation, 2026-09-18). ----
// The Event Staff nav gate is a COARSE visibility HINT, never an
// authorization boundary: can_manage_event_staff (the Event-Admin preset
// hint) OR a canonical Tenant/Platform authority ("allowed"). The route's
// own requiredEventStaffDelegationAuthority check is the real gate.

test("an Event Admin preset admin (can_manage_event_staff) sees Event Staff", () => {
  const eventAdmin = buildAdmin({ permissionMap: { can_manage_event_staff: true } });
  assert.ok(findItem(buildAdminNavSections(eventAdmin), "event-staff"));
});

test("a Super Admin sees Event Staff (via the isSuperAdmin hasPermission bypass)", () => {
  const superAdmin = buildAdmin({ isSuperAdmin: true, permissionMap: {} });
  assert.ok(findItem(buildAdminNavSections(superAdmin), "event-staff"));
});

test("a legitimate Tenant Admin with an unrelated legacy global privilege preset still sees Event Staff -- via canonical tenant authority, not the preset", () => {
  const oddPresetTenantAdmin = buildAdmin({
    privilege_group: "read_only",
    privilegeGroup: "read_only",
    permissionMap: {},
  });
  // No preset hint...
  assert.equal(findItem(buildAdminNavSections(oddPresetTenantAdmin), "event-staff"), null);
  // ...but canonical Tenant/Platform authority "allowed" reveals it.
  assert.ok(
    findItem(buildAdminNavSections(oddPresetTenantAdmin, { status: "allowed" }), "event-staff"),
  );
});

test("a subordinate-profile admin (no event-staff preset hint, no tenant authority) does NOT see Event Staff", () => {
  for (const group of ["checkin", "parking", "content_admin", "read_only"] as const) {
    const subordinate = buildAdmin({
      privilege_group: group,
      privilegeGroup: group,
      permissionMap: {},
    });
    assert.equal(
      findItem(buildAdminNavSections(subordinate, { status: "denied" }), "event-staff"),
      null,
      `${group} must not see Event Staff`,
    );
  }
});

test("can_manage_admins alone no longer reveals Event Staff -- that legacy OR was removed", () => {
  const adminsOnly = buildAdmin({ permissionMap: { can_manage_admins: true } });
  assert.equal(findItem(buildAdminNavSections(adminsOnly, { status: "denied" }), "event-staff"), null);
});
