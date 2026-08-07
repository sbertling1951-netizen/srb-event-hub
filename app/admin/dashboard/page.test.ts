import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADMIN_LEVEL1_SUMMARY_LINKS,
  visibleAdminSummaryLinks,
} from "@/app/admin/dashboard/page";
import type { AdminAccessResult } from "@/lib/getCurrentAdminAccess";

// Focused tests for the Stage 3 Admin Dashboard simplification
// (docs/architecture/EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md,
// docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md). Run with:
//   npx tsx --test app/admin/dashboard/page.test.ts

const LEVEL1_TITLES = [
  "Attendees",
  "Check-In",
  "Parking",
  "Agenda",
  "Communications",
  "Media",
  "Vendors",
  "Reporting",
];

// The Level-2 modules that must never appear as equal Level-1 Summary
// Links on the dashboard (Admin Module Architecture, "Which modules
// deserve direct (Level 1) navigation").
const LEVEL2_TITLES = [
  "Event Configuration",
  "Maps & Locations",
  "Admin Governance",
  "Engagement",
  "Intelligence",
];

function buildAdmin(
  overrides: Partial<AdminAccessResult> = {},
): AdminAccessResult {
  return {
    adminUser: {
      id: "admin-1",
      email: "admin@example.com",
      display_name: "Admin",
      is_active: true,
      privilege_group: "event_admin",
      user_id: "user-1",
    },
    currentEventId: "event-1",
    currentEventAccess: null,
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

test("exactly the 8 Level-1 modules are defined, with no Level-2 module mixed in", () => {
  const titles = ADMIN_LEVEL1_SUMMARY_LINKS.map((link) => link.title);

  assert.deepEqual(titles, LEVEL1_TITLES);
  for (const level2 of LEVEL2_TITLES) {
    assert.ok(
      !titles.includes(level2),
      `Level-2 module "${level2}" must not appear as a Level-1 Summary Link`,
    );
  }
});

test("each Summary Link points directly at its module's existing canonical route", () => {
  const hrefByTitle = Object.fromEntries(
    ADMIN_LEVEL1_SUMMARY_LINKS.map((link) => [link.title, link.href]),
  );

  assert.equal(hrefByTitle["Attendees"], "/admin/attendees");
  assert.equal(hrefByTitle["Check-In"], "/admin/checkin");
  assert.equal(hrefByTitle["Parking"], "/admin/parking");
  assert.equal(hrefByTitle["Agenda"], "/admin/agenda");
  assert.equal(hrefByTitle["Communications"], "/admin/announcements");
  assert.equal(hrefByTitle["Media"], "/admin/photos");
  assert.equal(hrefByTitle["Vendors"], "/admin/vendors");
  assert.equal(hrefByTitle["Reporting"], "/admin/print");
});

test("visibility is governed by hasPermission: a permission-less admin sees no links", () => {
  const admin = buildAdmin({ permissionMap: {} });

  assert.deepEqual(visibleAdminSummaryLinks(admin), []);
});

test("visibility is governed by hasPermission: a super admin sees every Level-1 link", () => {
  const admin = buildAdmin({ isSuperAdmin: true });

  const visible = visibleAdminSummaryLinks(admin);
  assert.equal(visible.length, ADMIN_LEVEL1_SUMMARY_LINKS.length);
});

test("visibility is governed by hasPermission: only the specifically-granted module's link appears", () => {
  const admin = buildAdmin({
    permissionMap: { can_manage_agenda: true },
  });

  const visible = visibleAdminSummaryLinks(admin).map((link) => link.title);
  assert.deepEqual(visible, ["Agenda"]);
});

test("Attendees uses the same three-way permission OR as Sidebar.tsx's own Attendees link", () => {
  for (const key of [
    "can_manage_attendees",
    "can_manage_checkin",
    "can_manage_parking",
  ]) {
    const admin = buildAdmin({ permissionMap: { [key]: true } });
    const visible = visibleAdminSummaryLinks(admin).map((link) => link.title);
    assert.ok(
      visible.includes("Attendees"),
      `granting "${key}" alone must make the Attendees Summary Link visible`,
    );
  }
});

test("visibleAdminSummaryLinks is pure and deterministic for identical inputs", () => {
  const admin = buildAdmin({ permissionMap: { can_manage_agenda: true } });

  const first = visibleAdminSummaryLinks(admin);
  const second = visibleAdminSummaryLinks(admin);

  assert.deepEqual(first, second);
});

test("a null admin (access not yet resolved) fails closed to no visible links", () => {
  assert.deepEqual(visibleAdminSummaryLinks(null), []);
});

test("no local operational statistics, no ad hoc system-status fetch, and no JS breakpoint state remain in the page source", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  for (const forbidden of [
    "fetch(",
    "registeredCoaches",
    "peopleArrived",
    "parkedPercent",
    "addEventListener(\"resize\"",
    "isWide",
    "isNarrow",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `app/admin/dashboard/page.tsx must not contain "${forbidden}" -- the Dashboard no longer recomputes module statistics or polls services directly`,
    );
  }
});

test("the page still queries only the events table directly -- no attendees table read remains", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.ok(source.includes('.from("events")'));
  assert.ok(!source.includes('.from("attendees")'));
});
