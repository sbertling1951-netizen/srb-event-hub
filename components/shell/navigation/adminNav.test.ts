import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAdminNavSections, getAdminNavItemChildren } from "@/components/shell/navigation/adminNav";
import type { AdminAccessResult } from "@/lib/getCurrentAdminAccess";

// Central Navigation Batch 1: buildAdminNavSections() rebuilt around
// Pap's approved plain-language Admin map -- one flat top-level list (no
// "Operations"/"Content"/"Intelligence"/"Staff & Setup" section buckets),
// with related destinations nested as `ShellNavItem.children`. Every
// existing gate below is reused byte-for-byte from the prior flat model;
// these tests re-prove each one under the new nested shape, plus cover
// the four destinations (Validation Rules, Export, Reports, Vendor
// Access) and the new Admin workspace parent that had no nav presence at
// all before this batch. Run with:
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

type Sections = ReturnType<typeof buildAdminNavSections>;

/** Finds an item anywhere in the tree (top-level or nested one level), returning it plus its top-level owner's id (its own id, if it is itself top-level). */
function findItem(sections: Sections, id: string): { item: Sections[number]["items"][number]; ownerId: string } | null {
  for (const section of sections) {
    for (const item of section.items) {
      if (item.id === id) {
        return { item, ownerId: item.id };
      }
      for (const child of item.children ?? []) {
        if (child.id === id) {
          return { item: child, ownerId: item.id };
        }
      }
    }
  }
  return null;
}

function topLevelIds(sections: Sections): string[] {
  return sections.flatMap((s) => s.items.map((i) => i.id));
}

test("the nav model is one flat, untitled top-level list -- no abstract section buckets", () => {
  const admin = buildAdmin({ isSuperAdmin: true, privilege_group: "super_admin" });
  const sections = buildAdminNavSections(admin, { status: "allowed" });

  assert.equal(sections.length, 1);
  assert.equal(sections[0].id, "admin");
  assert.equal(sections[0].title, undefined);
});

test("only a Super Admin sees Tenant Administration, nested under the Admin workspace parent", () => {
  const superAdmin = buildAdmin({ isSuperAdmin: true });
  const tenantAdmin = buildAdmin({ permissionMap: { can_manage_admins: true } });

  const found = findItem(buildAdminNavSections(superAdmin), "tenants");
  assert.ok(found);
  assert.equal(found.item.label, "Tenant Administration");
  assert.equal(found.item.href, "/admin/tenants");
  assert.equal(found.ownerId, "admin-workspace");
  assert.equal(findItem(buildAdminNavSections(tenantAdmin), "tenants"), null);
  assert.equal(findItem(buildAdminNavSections(null), "tenants"), null);
});

test("only a Super Admin sees Passport Refunds, nested under the Admin workspace parent", () => {
  const superAdmin = buildAdmin({ isSuperAdmin: true });
  const tenantAdmin = buildAdmin({ permissionMap: { can_manage_admins: true } });

  const found = findItem(buildAdminNavSections(superAdmin), "passport-refunds");
  assert.ok(found);
  assert.equal(found.item.label, "Passport Refunds");
  assert.equal(found.item.href, "/admin/passport-refunds");
  assert.equal(found.ownerId, "admin-workspace");
  assert.equal(findItem(buildAdminNavSections(tenantAdmin), "passport-refunds"), null);
  assert.equal(findItem(buildAdminNavSections(null), "passport-refunds"), null);
});

test("Passport Refunds shows a pending-approval count only for a Super Admin and only when nonzero", () => {
  const superAdmin = buildAdmin({ isSuperAdmin: true });

  assert.equal(findItem(buildAdminNavSections(superAdmin, null, 0), "passport-refunds")?.item.badgeCount, undefined);
  assert.equal(findItem(buildAdminNavSections(superAdmin, null, 3), "passport-refunds")?.item.badgeCount, 3);
  assert.equal(findItem(buildAdminNavSections(buildAdmin(), null, 3), "passport-refunds"), null);
});

test("Admin Users and Permissions are nested under the Admin workspace parent, gated on can_manage_admins", () => {
  const admin = buildAdmin({ permissionMap: { can_manage_admins: true } });
  const workspace = findItem(buildAdminNavSections(admin), "admin-workspace");
  assert.ok(workspace);
  assert.equal(workspace.item.label, "Admin");
  assert.equal(workspace.item.href, "/admin/admin");

  const adminUsers = findItem(buildAdminNavSections(admin), "admin-users");
  const permissions = findItem(buildAdminNavSections(admin), "permissions");
  assert.equal(adminUsers?.ownerId, "admin-workspace");
  assert.equal(permissions?.ownerId, "admin-workspace");
});

test("the Admin workspace parent itself disappears entirely when every one of its children is hidden -- a dead parent never renders", () => {
  const noAdminAccess = buildAdmin({ permissionMap: {} });
  assert.equal(findItem(buildAdminNavSections(noAdminAccess), "admin-workspace"), null);
  assert.equal(findItem(buildAdminNavSections(noAdminAccess), "admin-users"), null);
});

test("Registry Provider Catalog is nested under the Catalogs parent, never under the Admin workspace parent, gated on isSuperAdmin verbatim", () => {
  const superAdmin = buildAdmin({ isSuperAdmin: true });
  const tenantAdmin = buildAdmin({ permissionMap: { can_manage_admins: true } });

  const found = findItem(buildAdminNavSections(superAdmin), "registry-providers");
  assert.ok(found);
  assert.equal(found.item.label, "Registry Provider Catalog");
  assert.equal(found.item.href, "/admin/registry-providers");
  assert.equal(found.ownerId, "catalogs");
  assert.notEqual(found.ownerId, "admin-workspace");
  assert.equal(findItem(buildAdminNavSections(tenantAdmin), "registry-providers"), null);
  assert.equal(findItem(buildAdminNavSections(null), "registry-providers"), null);
});

test("the Catalogs parent renders with its href/label and is absent entirely when every one of its children is hidden -- a dead parent never renders", () => {
  const superAdmin = buildAdmin({ isSuperAdmin: true });
  const nonSuperAdmin = buildAdmin({ permissionMap: { can_manage_admins: true } });

  const catalogs = findItem(buildAdminNavSections(superAdmin), "catalogs");
  assert.ok(catalogs);
  assert.equal(catalogs.item.label, "Catalogs");
  assert.equal(catalogs.item.href, "/admin/catalogs");

  assert.equal(findItem(buildAdminNavSections(nonSuperAdmin), "catalogs"), null);
  assert.equal(findItem(buildAdminNavSections(null), "catalogs"), null);
});

test("Catalogs derives its links from the canonical Admin nav model, not a copied visibility list -- getAdminNavItemChildren('catalogs') matches buildAdminNavSections() exactly", () => {
  const superAdmin = buildAdmin({ isSuperAdmin: true });
  const nonSuperAdmin = buildAdmin({ permissionMap: { can_manage_admins: true } });

  const direct = findItem(buildAdminNavSections(superAdmin), "catalogs");
  const viaHelper = getAdminNavItemChildren(superAdmin, null, "catalogs");
  assert.deepEqual(viaHelper, direct?.item.children);
  assert.deepEqual(viaHelper.map((c) => c.id), ["registry-providers"]);

  assert.deepEqual(getAdminNavItemChildren(nonSuperAdmin, null, "catalogs"), []);
  assert.deepEqual(getAdminNavItemChildren(null, null, "catalogs"), []);
});

test("canonical Tenant authority exposes Add Event, nested under the Event parent, without any working-Event access", () => {
  const zeroEventTenantAdmin = buildAdmin({
    eventAccessRows: [],
    eventIds: [],
    event_ids: [],
    permissionMap: { can_manage_events: true },
  });

  const found = findItem(buildAdminNavSections(zeroEventTenantAdmin, { status: "allowed" }), "add-event");

  assert.ok(found);
  assert.equal(found.item.label, "Add Event");
  assert.equal(found.item.href, "/admin/events/new");
  assert.equal(found.ownerId, "events");
});

test("Platform and single- or multi-Tenant administrators use the same canonical Add Event entry", () => {
  for (const admin of [
    buildAdmin({ isSuperAdmin: true, permissionMap: { can_manage_events: true } }),
    buildAdmin({ eventIds: ["event-1"], event_ids: ["event-1"], permissionMap: { can_manage_events: true } }),
    buildAdmin({
      eventIds: ["event-1", "event-2"],
      event_ids: ["event-1", "event-2"],
      permissionMap: { can_manage_events: true },
    }),
  ]) {
    const found = findItem(buildAdminNavSections(admin, { status: "allowed" }), "add-event");
    assert.equal(found?.item.href, "/admin/events/new");
  }
});

test("direct Event authority alone never exposes Add Event", () => {
  const directEventAdmin = buildAdmin({
    eventAccessRows: [{ id: "access-1", event_id: "event-1", admin_user_id: "admin-1", role: "event_admin" }],
    eventIds: ["event-1"],
    event_ids: ["event-1"],
    permissionMap: { can_manage_events: true },
  });

  assert.ok(findItem(buildAdminNavSections(directEventAdmin), "events"));
  assert.equal(findItem(buildAdminNavSections(directEventAdmin), "add-event"), null);
  assert.equal(findItem(buildAdminNavSections(directEventAdmin, { status: "denied" }), "add-event"), null);
});

test("unresolved and failed Tenant-authority checks fail closed to no Add Event entry", () => {
  const admin = buildAdmin({ isSuperAdmin: true, permissionMap: { can_manage_events: true } });

  assert.equal(findItem(buildAdminNavSections(admin), "add-event"), null);
  assert.equal(
    findItem(buildAdminNavSections(admin, { status: "check_failed", message: "unavailable" }), "add-event"),
    null,
  );
  assert.equal(findItem(buildAdminNavSections(null, { status: "allowed" }), "add-event"), null);
});

test("an admin granted can_manage_imports sees the Imports link, nested under Attendees", () => {
  const admin = buildAdmin({ permissionMap: { can_manage_attendees: true, can_manage_imports: true } });
  const found = findItem(buildAdminNavSections(admin), "imports");

  assert.ok(found, "expected an 'imports' nav item to be present");
  assert.equal(found!.item.label, "Imports");
  assert.equal(found!.item.href, "/admin/imports");
  assert.equal(found!.ownerId, "attendees");
});

test("an admin without can_manage_imports (and no other permission) does not see the Imports link", () => {
  const admin = buildAdmin({ permissionMap: {} });
  assert.equal(findItem(buildAdminNavSections(admin), "imports"), null);
});

test("granting an unrelated permission alone does not surface the Imports link", () => {
  for (const key of ["can_manage_attendees", "can_manage_checkin", "can_manage_parking"]) {
    const admin = buildAdmin({ permissionMap: { [key]: true } });
    assert.equal(findItem(buildAdminNavSections(admin), "imports"), null, `granting only "${key}" must not surface the Imports link`);
  }
});

test("a super admin sees the Imports link via the same isSuperAdmin bypass every other nav item already uses", () => {
  const admin = buildAdmin({ isSuperAdmin: true, permissionMap: {} });
  const found = findItem(buildAdminNavSections(admin), "imports");
  assert.ok(found, "expected super_admin to see the Imports link");
  assert.equal(found!.item.href, "/admin/imports");
});

test("a null admin (access not yet resolved) fails closed to no Imports link", () => {
  assert.equal(findItem(buildAdminNavSections(null), "imports"), null);
});

// ---- NEW destinations added by this batch: Validation Rules, Export,
// Reports, Vendor Access -- none existed in the nav before. ----

test("Validation Rules is nested under Attendees, visible only to a Super Admin (task event.validation_rules.manage is manual-grant-only)", () => {
  const superAdmin = buildAdmin({ isSuperAdmin: true });
  const eventAdmin = buildAdmin({ permissionMap: { can_manage_attendees: true } });

  const found = findItem(buildAdminNavSections(superAdmin), "validation-rules");
  assert.ok(found);
  assert.equal(found.item.href, "/admin/validation-rules");
  assert.equal(found.ownerId, "attendees");
  assert.equal(findItem(buildAdminNavSections(eventAdmin), "validation-rules"), null);
});

test("Export and Reports are nested under Print, gated on the same can_manage_reports proxy as their Print Center parent", () => {
  const admin = buildAdmin({ permissionMap: { can_manage_reports: true } });
  const exportFound = findItem(buildAdminNavSections(admin), "export");
  const reportsFound = findItem(buildAdminNavSections(admin), "reports");

  assert.equal(exportFound?.item.href, "/admin/export");
  assert.equal(exportFound?.ownerId, "print");
  assert.equal(reportsFound?.item.href, "/admin/reports");
  assert.equal(reportsFound?.ownerId, "print");

  const noReports = buildAdmin({ permissionMap: {} });
  assert.equal(findItem(buildAdminNavSections(noReports), "export"), null);
  assert.equal(findItem(buildAdminNavSections(noReports), "reports"), null);
});

test("Vendor Access is nested under Vendors, gated on the same can_manage_vendors proxy as Vendor Requests", () => {
  const admin = buildAdmin({ permissionMap: { can_manage_vendors: true } });
  const found = findItem(buildAdminNavSections(admin), "vendors-access");
  assert.equal(found?.item.href, "/admin/vendors/access");
  assert.equal(found?.ownerId, "vendors");

  const noVendors = buildAdmin({ permissionMap: {} });
  assert.equal(findItem(buildAdminNavSections(noVendors), "vendors-access"), null);
});

// ---- Maps and Parking: Parking is a direct top-level item, deliberately
// NOT nested under Maps, per Pap's approved map. ----

test("Master Maps, Nearby, Nearby Settings, and Locations are nested under Maps with their exact existing gates", () => {
  const admin = buildAdmin({ permissionMap: { can_manage_master_maps: true, can_manage_nearby: true, can_manage_locations: true } });
  const withTenantAuthority = buildAdminNavSections(admin, { status: "allowed" });

  assert.equal(findItem(withTenantAuthority, "master-maps")?.ownerId, "map-admin");
  assert.equal(findItem(withTenantAuthority, "nearby")?.ownerId, "map-admin");
  assert.equal(findItem(withTenantAuthority, "nearby-settings")?.ownerId, "map-admin");
  assert.equal(findItem(withTenantAuthority, "locations")?.ownerId, "map-admin");

  // Nearby Settings uses tenantAuthority, not can_manage_nearby -- the
  // EXACT match to its own route guard, not a proxy.
  const withoutTenantAuthority = buildAdminNavSections(admin, { status: "denied" });
  assert.equal(findItem(withoutTenantAuthority, "nearby-settings"), null);
  assert.ok(findItem(withoutTenantAuthority, "nearby"));
});

test("Parking is a direct top-level item, not nested under Maps", () => {
  const admin = buildAdmin({ permissionMap: { can_manage_parking: true, can_manage_master_maps: true } });
  const found = findItem(buildAdminNavSections(admin), "parking");
  assert.ok(found);
  assert.equal(found.ownerId, "parking", "Parking must be its own top-level item, not a child of any other item");
  assert.equal(found.item.href, "/admin/parking");
  assert.equal(found.item.children, undefined);
});

// ---- Photos, Agenda, Print, Vendors parents ----

test("Photo Library and Slideshow are nested under Photos", () => {
  const admin = buildAdmin({ permissionMap: { can_manage_reports: true } });
  assert.equal(findItem(buildAdminNavSections(admin), "photo-library")?.ownerId, "photos");
  assert.equal(findItem(buildAdminNavSections(admin), "slideshow")?.ownerId, "photos");
});

test("Agenda Categories is nested under Agenda", () => {
  const admin = buildAdmin({ permissionMap: { can_manage_agenda: true } });
  assert.equal(findItem(buildAdminNavSections(admin), "agenda-categories")?.ownerId, "agenda");
});

test("Print Settings is nested under Print", () => {
  const admin = buildAdmin({ permissionMap: { can_manage_reports: true } });
  assert.equal(findItem(buildAdminNavSections(admin), "print-settings")?.ownerId, "print");
});

test("Vendor Requests is nested under Vendors", () => {
  const admin = buildAdmin({ permissionMap: { can_manage_vendors: true } });
  assert.equal(findItem(buildAdminNavSections(admin), "vendor-requests")?.ownerId, "vendors");
});

test("a top-level parent renders as a plain leaf (no children) when its own gate passes but every child's independent gate fails", () => {
  // can_manage_attendees alone satisfies Attendees' own OR-gate but none
  // of its children's own, independent gates (can_manage_checkin,
  // can_manage_imports, isSuperAdmin) -- proving the parent still renders
  // as its own destination with no dead, empty submenu toggle.
  const admin = buildAdmin({ permissionMap: { can_manage_attendees: true } });
  const found = findItem(buildAdminNavSections(admin), "attendees");
  assert.ok(found, "Attendees must still render as its own destination");
  assert.equal(found!.item.children, undefined);
});

// ---- Full-access snapshot: proves every pre-existing nav item and every
// new one is reachable somewhere in the tree, and the flat top-level
// order matches Pap's approved map exactly. ----

test("a full-access admin sees the complete approved top-level order and every destination somewhere in the tree", () => {
  const admin = buildAdmin({ isSuperAdmin: true, privilege_group: "super_admin" });
  const sections = buildAdminNavSections(admin, { status: "allowed" });

  assert.deepEqual(topLevelIds(sections), [
    "dashboard",
    "admin-workspace",
    "catalogs",
    "events",
    "attendees",
    "agenda",
    "announcements",
    "map-admin",
    "parking",
    "photos",
    "print",
    "vendors",
  ]);

  for (const expectedId of [
    "dashboard",
    "admin-workspace",
    "admin-users",
    "permissions",
    "tenants",
    "passport-refunds",
    "catalogs",
    "registry-providers",
    "events",
    "add-event",
    "checklist",
    "event-staff",
    "engagement",
    "evaluations",
    "attendees",
    "checkin",
    "imports",
    "validation-rules",
    "agenda",
    "agenda-categories",
    "announcements",
    "map-admin",
    "master-maps",
    "nearby",
    "nearby-settings",
    "locations",
    "parking",
    "photos",
    "photo-library",
    "slideshow",
    "print",
    "print-settings",
    "reports",
    "export",
    "vendors",
    "vendor-requests",
    "vendors-access",
  ]) {
    assert.ok(findItem(sections, expectedId), `expected nav item "${expectedId}" to be present somewhere in the tree`);
  }
});

// ---- Event Staff nav visibility (downward delegation, 2026-09-18) --
// unchanged gate, now nested under Event. ----

test("an Event Admin preset admin (can_manage_event_staff) sees Event Staff, nested under Event", () => {
  const eventAdmin = buildAdmin({ permissionMap: { can_manage_events: true, can_manage_event_staff: true } });
  assert.equal(findItem(buildAdminNavSections(eventAdmin), "event-staff")?.ownerId, "events");
});

test("a Super Admin sees Event Staff (via the isSuperAdmin hasPermission bypass)", () => {
  const superAdmin = buildAdmin({ isSuperAdmin: true, permissionMap: {} });
  assert.ok(findItem(buildAdminNavSections(superAdmin), "event-staff"));
});

test("a legitimate Tenant Admin with an unrelated legacy global privilege preset still sees Event Staff -- via canonical tenant authority, not the preset", () => {
  const oddPresetTenantAdmin = buildAdmin({
    privilege_group: "read_only",
    privilegeGroup: "read_only",
    permissionMap: { can_manage_events: true },
  });
  assert.equal(findItem(buildAdminNavSections(oddPresetTenantAdmin), "event-staff"), null);
  assert.ok(findItem(buildAdminNavSections(oddPresetTenantAdmin, { status: "allowed" }), "event-staff"));
});

test("a subordinate-profile admin (no event-staff preset hint, no tenant authority) does NOT see Event Staff", () => {
  for (const group of ["checkin", "parking", "content_admin", "read_only"] as const) {
    const subordinate = buildAdmin({ privilege_group: group, privilegeGroup: group, permissionMap: { can_manage_events: true } });
    assert.equal(
      findItem(buildAdminNavSections(subordinate, { status: "denied" }), "event-staff"),
      null,
      `${group} must not see Event Staff`,
    );
  }
});

test("can_manage_admins alone no longer reveals Event Staff -- that legacy OR was removed", () => {
  const adminsOnly = buildAdmin({ permissionMap: { can_manage_admins: true, can_manage_events: true } });
  assert.equal(findItem(buildAdminNavSections(adminsOnly, { status: "denied" }), "event-staff"), null);
});

// ---- Central Navigation Batch 2A: getAdminNavItemChildren(), the shared
// projection Event/Attendees workspace entry areas use. ----

test("getAdminNavItemChildren('events') returns exactly the same children buildAdminNavSections() itself nests under Event, for a full-access admin", () => {
  const admin = buildAdmin({ isSuperAdmin: true, privilege_group: "super_admin" });
  const eventChildrenFromSections = findItem(buildAdminNavSections(admin, { status: "allowed" }), "checklist");
  assert.ok(eventChildrenFromSections, "sanity: checklist must be nested under events in the full nav tree");

  const children = getAdminNavItemChildren(admin, { status: "allowed" }, "events");
  const childIds = children.map((c) => c.id).sort();
  assert.deepEqual(childIds, ["add-event", "checklist", "engagement", "event-staff", "evaluations"].sort());
});

test("getAdminNavItemChildren('attendees') returns exactly Check-In, Imports, and Validation Rules for a full-access admin -- never Attendees itself", () => {
  const admin = buildAdmin({ isSuperAdmin: true });
  const children = getAdminNavItemChildren(admin, null, "attendees");
  const childIds = children.map((c) => c.id).sort();
  assert.deepEqual(childIds, ["checkin", "imports", "validation-rules"].sort());
  assert.ok(!childIds.includes("attendees"), "the parent item itself must never appear in its own children list");
});

test("a hidden child is absent from getAdminNavItemChildren()'s result -- exactly matching what the sidebar/drawer itself would hide", () => {
  // can_manage_attendees alone satisfies Attendees' own OR-gate but none
  // of its children's independent gates (can_manage_checkin,
  // can_manage_imports, isSuperAdmin) -- proving hidden children stay
  // hidden in the projection, not just in the full nav tree.
  const attendeesOnlyAdmin = buildAdmin({ permissionMap: { can_manage_attendees: true } });
  assert.deepEqual(getAdminNavItemChildren(attendeesOnlyAdmin, null, "attendees"), []);

  // can_manage_events alone satisfies Event's own gate AND its
  // "checklist" child's identical gate, but none of the other three
  // children's independent gates -- proving the projection is per-child,
  // not all-or-nothing with the parent.
  const eventsOnlyAdmin = buildAdmin({ permissionMap: { can_manage_events: true } });
  assert.deepEqual(getAdminNavItemChildren(eventsOnlyAdmin, null, "events").map((c) => c.id), ["checklist"]);
});

test("getAdminNavItemChildren() for a parent that is not visible at all (or does not exist) returns an empty array, never throws", () => {
  const noAccessAdmin = buildAdmin({ permissionMap: {} });
  assert.deepEqual(getAdminNavItemChildren(noAccessAdmin, null, "events"), []);
  assert.deepEqual(getAdminNavItemChildren(noAccessAdmin, null, "attendees"), []);
  assert.deepEqual(getAdminNavItemChildren(noAccessAdmin, null, "not-a-real-parent-id"), []);
  assert.deepEqual(getAdminNavItemChildren(null, null, "events"), []);
});

test("getAdminNavItemChildren() calls the real buildAdminNavSections() -- adding a permission changes both identically", () => {
  const before = buildAdmin({ permissionMap: { can_manage_events: true } });
  const after = buildAdmin({ permissionMap: { can_manage_events: true, can_manage_reports: true } });

  assert.deepEqual(getAdminNavItemChildren(before, null, "events").map((c) => c.id), ["checklist"]);
  assert.deepEqual(getAdminNavItemChildren(after, null, "events").map((c) => c.id).sort(), ["checklist", "evaluations"].sort());
  // Identical change is visible in the full nav tree too -- same source.
  assert.ok(findItem(buildAdminNavSections(after), "evaluations"));
  assert.equal(findItem(buildAdminNavSections(before), "evaluations"), null);
});
