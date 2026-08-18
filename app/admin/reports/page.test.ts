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
