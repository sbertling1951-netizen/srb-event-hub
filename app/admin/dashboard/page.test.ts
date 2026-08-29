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

test("no local operational statistics or JS breakpoint state remain in the page source", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  for (const forbidden of [
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

test("Production Status is isolated to the canonical Super Admin path and existing API", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  assert.match(source, /adminAccess\?\.isSuperAdmin/);
  assert.match(source, /fetch\("\/api\/admin\/system-status"/);
  assert.match(source, /Production Status/);
  assert.match(source, /Production status is currently unavailable/);
  assert.equal(/import AdminTrustIndicator/.test(source), false);
  assert.equal(/<AdminTrustIndicator\s*\/>/.test(source), false);
  assert.equal(source.includes("Status check not yet connected"), false);
  assert.equal(source.includes("dashboard-trust-heading"), false);
});

test("the page still queries only the events table directly -- no attendees table read remains", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.ok(source.includes('.from("events")'));
  assert.ok(!source.includes('.from("attendees")'));
});

// Event Context Invariant regression coverage
// (docs/architecture/ADR-006 Event Context Architecture.md), written
// against the Amana -> Branson production defect: this page's mount
// effect used to silently discard an inactive stored/current Event and
// substitute `activeEvents[0]`. It must now resolve through the shared
// resolveAdminWorkingEvent() instead of reimplementing that fallback.

test("loadPage resolves the working Event through the shared resolveAdminWorkingEvent(), not a page-local fallback", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /import\s*\{[^}]*resolveAdminWorkingEvent[^}]*\}\s*from\s*["']@\/lib\/adminWorkspaceContext["']/,
  );

  const callMatch = source.match(
    /resolveAdminWorkingEvent\(\s*\n?\s*([a-zA-Z0-9_]+)\s*,/,
  );
  assert.ok(callMatch, "expected a resolveAdminWorkingEvent(...) call");
  assert.equal(
    callMatch![1],
    "loadedEvents",
    "resolveAdminWorkingEvent must be given the full loaded Event set, not a status-filtered list",
  );
});

test("the retired 'fall back to the first active event when the current one is not active' pattern is gone", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(
    /isActiveEventStatus\(\s*(currentEvent|storedEvent)\?\.status\s*\)/.test(
      source,
    ),
    false,
    "found the retired inactive-is-invalid branch this page used to reimplement",
  );
});

test("an invalid stored context (Event no longer exists) surfaces its own explicit message distinct from 'no events at all'", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(source, /invalidStoredContext/);
  assert.match(source, /no longer available/i);
});

test("explicit user selection (handleSwitchEvent) is unconditional and unaffected by the resolver", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const fnIdx = source.indexOf("async function handleSwitchEvent(");
  assert.notEqual(fnIdx, -1);
  const fnBody = source.slice(fnIdx, fnIdx + 700);

  assert.match(fnBody, /setCurrentAdminEvent\(\{/);
  assert.equal(/resolveAdminWorkingEvent/.test(fnBody), false);
});

// Archived-Event continuity regression coverage (Stage 2 D1: the
// Dashboard's own loadEvents() used to exclude archived Events from the
// set before that set ever reached resolveAdminWorkingEvent -- an
// authorized-but-archived stored working Event was therefore reported as
// "no longer available" even though it still existed and the admin was
// still authorized for it. ADR-006 §2.1 names "archived" explicitly as
// an example of lifecycle status that must never gate context validity.
// app/admin/events/page.tsx already carries the correct pattern
// (accessibleEvents, authorization-only, passed to
// resolveAdminWorkingEvent; a separately-filtered list for display only)
// -- these tests hold the Dashboard to the same standard.

test("loadEvents (the accessible-Event source for context resolution) does not filter by lifecycle status", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const fnIdx = source.indexOf("async function loadEvents(");
  assert.notEqual(fnIdx, -1, "expected an async function loadEvents(...) definition");

  const fnEndIdx = source.indexOf("\n  const loadPage = useCallback", fnIdx);
  assert.notEqual(fnEndIdx, -1);

  const fnBody = source.slice(fnIdx, fnEndIdx);

  assert.equal(
    /archived/i.test(fnBody),
    false,
    "loadEvents must return the admin's full accessible Event set -- lifecycle-status filtering (including archived) must never happen inside the function that produces resolveAdminWorkingEvent's input (ADR-006 §2.1/§4)",
  );
  assert.equal(
    /normalizeEventStatus/.test(fnBody),
    false,
    "loadEvents must not reference lifecycle status at all -- it is an authorization-only accessible-Event source",
  );
});

test("archived-status filtering exists only as a separate, display-only picker list, never as resolveAdminWorkingEvent's input", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const resolveCallMatch = source.match(
    /resolveAdminWorkingEvent\(\s*\n?\s*([a-zA-Z0-9_]+)\s*,/,
  );
  assert.ok(resolveCallMatch, "expected a resolveAdminWorkingEvent(...) call");
  const resolutionInputName = resolveCallMatch![1];

  const pickerDeclMatch = source.match(
    /const\s+(pickerEvents)\s*=\s*events\.filter\(/,
  );
  assert.ok(
    pickerDeclMatch,
    "expected a pickerEvents list derived from the full events state, for the switcher's own display only",
  );
  assert.notEqual(
    pickerDeclMatch![1],
    resolutionInputName,
    "the archived-filtered picker list must never be the same variable resolveAdminWorkingEvent is called with",
  );

  const pickerIdx = source.indexOf("const pickerEvents = events.filter(");
  const pickerBody = source.slice(pickerIdx, pickerIdx + 300);
  assert.match(
    pickerBody,
    /evt\.id === selectedEventId/,
    "the current working Event must always remain in the picker's own option list, even when archived, so an archived selection is never invisible in the UI",
  );
});

test("the working Event always renders visibly, even when archived, independent of the picker's own filtered list", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(source, /Working Event:/);
  assert.match(
    source,
    /const selectedEvent = events\.find\(/,
    "the Working Event line must read from the full accessible events state, not the archived-filtered picker list",
  );
});
