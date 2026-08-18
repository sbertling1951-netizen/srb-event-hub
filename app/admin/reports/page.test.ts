import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

test("Reports has one guarded canonical render path", () => {
  assert.ok(source.includes('AdminRouteGuard requiredPermission="can_manage_reports"'));
  assert.ok(source.includes('<AdminShellAdapter pageTitle="Reports">'));
  assert.ok(!source.includes("useSearchParams"));
  assert.ok(!source.includes("isEmbedded"));
  assert.ok(!source.includes("AdminReportsPageContent"));
});

test("Reports no longer has an embedded shell bypass", () => {
  assert.ok(!source.includes("admin-embedded-shell"));
  assert.ok(!source.includes("ReportsPrintStyles"));
  assert.ok(!source.includes("<PageNavigation"));
  assert.ok(!source.includes("<PageHeader"));
});

test("Reports preserves its data and task actions", () => {
  for (const needle of [
    'from("attendees")',
    'from("attendee_activities")',
    'from("parking_sites")',
    "buildExportRows({",
    "printReportPack({",
    "loadStoredReportPresets()",
  ]) {
    assert.ok(source.includes(needle), `Reports must retain ${needle}`);
  }
});

// Canonical Event Operational Summary Read Contract reconciliation --
// docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md, "Consumer
// implications" for Reports.

test("Reports obtains operational summary values through the canonical governed layer, not a page-local recomputation", () => {
  assert.match(
    source,
    /import\s*{[^}]*fetchEventOperationalSummary[^}]*}\s*from\s*"@\/lib\/eventOperationalSummary"/,
  );
  assert.ok(source.includes("fetchEventOperationalSummary(activeEventId)"));
});

test("Unassigned Parking Needed no longer derives placement from attendees.assigned_site", () => {
  assert.ok(
    !source.includes("!row.assigned_site"),
    "Reports must not test attendees.assigned_site for placement/unplacement",
  );
  assert.ok(source.includes("canonicallyPlacedAttendeeIds"));
  assert.match(source, /site\.assigned_attendee_id/);
});

test("Reports no longer labels a registration-row grouping as a Participant Breakdown", () => {
  assert.ok(!source.includes("participantBreakdown"));
  assert.ok(source.includes("registrationTypeBreakdown"));
});

// Reports detail/preview reconciliation with canonical Active headline
// scope -- docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md,
// Canonical Event Operational Summary Read Contract: Active means
// registration_status != 'cancelled' AND is_active = true.

test("Reports loads registration_status so Active scope can be enforced", () => {
  assert.match(source, /registration_status: string \| null;/);
  assert.match(source, /^\s{12}registration_status,\s*$/m);
});

test("Reports defines one canonical Active Registration predicate, not is_active alone", () => {
  assert.match(
    source,
    /function isActiveRegistration\(row: AttendeeRow\) {\s*return row\.registration_status !== "cancelled" && row\.is_active;\s*}/,
  );
});

test("Arrived detail rows require canonical Active Registration scope plus has_arrived", () => {
  const arrivedFilters = [
    ...source.matchAll(
      /\.filter\(\(row\) => isActiveRegistration\(row\) && !!row\.has_arrived\)/g,
    ),
  ];
  // Once for the Arrived report type's roster rows, once for the
  // Summary/Print-Pack-feeding arrivedRows preview list.
  assert.equal(arrivedFilters.length, 2);
  assert.ok(!source.includes('.filter((row) => !!row.has_arrived)'));
});

test("Not Arrived detail rows require canonical Active Registration scope plus !has_arrived", () => {
  const notArrivedFilters = [
    ...source.matchAll(
      /\.filter\(\(row\) => isActiveRegistration\(row\) && !row\.has_arrived\)/g,
    ),
  ];
  assert.equal(notArrivedFilters.length, 2);
  assert.ok(!source.includes('.filter((row) => !row.has_arrived)'));
});

test("Needs-Parking/Unassigned detail rows require canonical Active Registration scope", () => {
  const needsParkingFilters = [
    ...source.matchAll(
      /isActiveRegistration\(row\) &&\s*row\.needs_parking &&\s*!canonicallyPlacedAttendeeIds\.has\(row\.id\)/g,
    ),
  ];
  // Once for the report type's roster rows, once for the Summary/Print-Pack
  // unassignedParkingRows preview list.
  assert.equal(needsParkingFilters.length, 2);
  assert.ok(
    !source.includes(
      "row.needs_parking && !canonicallyPlacedAttendeeIds.has(row.id)",
    ),
    "needs_parking filtering must not run without the Active Registration guard",
  );
});

test("cancelled and inactive registrations cannot appear in Active operational detail sets, because isActiveRegistration excludes both", () => {
  // registration_status !== 'cancelled' excludes cancelled rows;
  // && row.is_active excludes inactive rows. Both conjuncts are required
  // in the same predicate, so an Active-scoped filter using it can never
  // admit either.
  assert.match(
    source,
    /return row\.registration_status !== "cancelled" && row\.is_active;/,
  );
});

test("the generic table's Active column reflects the complete canonical predicate, not is_active alone", () => {
  assert.match(source, /active: isActiveRegistration\(row\) \? "YES" : "NO"/);
  assert.ok(!source.includes('active: row.is_active ? "YES" : "NO"'));
  assert.match(
    source,
    /active: assigned\s*\?\s*isActiveRegistration\(assigned\)\s*\?\s*"YES"\s*:\s*"NO"\s*:\s*""/,
  );
});

test("unplaced classification continues to derive solely from parking_sites.assigned_attendee_id", () => {
  assert.match(source, /site\.assigned_attendee_id/);
  assert.ok(
    !source.includes("!row.assigned_site"),
    "attendees.assigned_site must never decide unplaced classification",
  );
  assert.ok(
    !source.includes("!assigned.assigned_site"),
    "attendees.assigned_site must never decide unplaced classification",
  );
});

test("Reports still passes the canonical operational summary through to the Summary cards unmodified", () => {
  assert.match(source, /operationalSummary=\{operationalSummary\}/);
  assert.match(source, /setOperationalSummary\(summaryResult\.summary\)/);
});

// Row-level Site display reconciliation --
// docs/architecture/EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md,
// EPICENTRAX_CANONICAL_PARKING_READ_MIGRATION_PLAN.md §6.2: every generic
// Site column, sort, group, CSV/XLSX row, and print-pack row uses the same
// canonical display_label result, never attendees.assigned_site.

test("Reports no longer selects attendees.assigned_site or reads it off an attendee row", () => {
  assert.ok(
    !source.includes("assigned_site: string | null;"),
    "AttendeeRow must not declare assigned_site",
  );
  assert.ok(
    !/^\s*assigned_site,\s*$/m.test(source),
    "the attendees select list must not include assigned_site",
  );
  assert.ok(
    !source.includes("row.assigned_site"),
    "no row-level read of attendees.assigned_site may remain",
  );
  assert.ok(
    !source.includes("assigned.assigned_site"),
    "no row-level read of attendees.assigned_site may remain",
  );
});

test("attendeeToRosterRow derives its Site value from canonical parking_sites occupancy, not attendees.assigned_site", () => {
  assert.match(
    source,
    /function attendeeToRosterRow\(\s*row: AttendeeRow,\s*canonicalSiteLabelByAttendeeId: Map<string, string>,\s*\): RosterRow \{\s*return \{\s*site: canonicalSiteLabelByAttendeeId\.get\(row\.id\) \|\| "",/,
  );
});

test("every row-level report type routes attendeeToRosterRow through the canonical site label map", () => {
  const calls = [
    ...source.matchAll(
      /\.map\(\(row\) => attendeeToRosterRow\(row, canonicalSiteLabelByAttendeeId\)\)/g,
    ),
  ];
  // all_attendees, household_contact_sheet, arrived, not_arrived,
  // first_timers, volunteers, vendors, staff_hosts_helpers,
  // unassigned_parking_needed, activity_roster (rosterRows) plus
  // unassignedParkingRows, arrivedRows, notArrivedRows, firstTimerRows,
  // vendorStaffRows (Summary/Print-Pack preview lists) = 15.
  assert.equal(calls.length, 15);
  assert.ok(!source.includes(".map(attendeeToRosterRow)"));
});

test("canonicalSiteLabelByAttendeeId derives only from parking_sites.assigned_attendee_id occupancy", () => {
  assert.match(
    source,
    /const canonicalSiteLabelByAttendeeId = useMemo\(\(\) => \{\s*const labels = new Map<string, string>\(\);\s*for \(const site of parkingSites\) \{\s*if \(site\.assigned_attendee_id\) \{\s*labels\.set\(site\.assigned_attendee_id, siteLabel\(site\)\);/,
  );
});
