import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

// Print Center registration-selection reconciliation --
// docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md, Canonical
// Event Operational Summary Read Contract, Consumer implications for Print:
// "If Print calls a queue 'Active,' it must use the canonical
// active-registration definition."

test("Print's default queue excludes cancelled registrations regardless of the inactive toggle", () => {
  assert.match(
    source,
    /\[\.\.\.attendees, \.\.\.manualAttendees\]\.filter\(\s*\(row\) => row\.registration_status !== "cancelled",\s*\)/,
  );
});

test("Print's default queue matches the canonical Active Registration definition (not cancelled AND is_active)", () => {
  assert.match(
    source,
    /if \(!includeInactive\) {\s*rows = rows\.filter\(\(row\) => row\.is_active\);\s*}/,
  );
});

test("Print no longer mislabels its default queue as attendees", () => {
  assert.ok(!source.includes("All Active Attendees"));
  assert.ok(source.includes('<option value="all">All Active Registrations</option>'));
});

test("Manual print-queue rows stay operational queue records, not canonical registrations", () => {
  // Manual rows are visually flagged and independently deletable -- they
  // are never routed through fetchEventOperationalSummary or any other
  // canonical-aggregate surface.
  assert.ok(source.includes('row.id.startsWith("manual-")'));
  assert.ok(!source.includes("fetchEventOperationalSummary"));
});

test("Print does not duplicate a canonical aggregate registration count", () => {
  // Print's own "N of M filtered" text is a page-local queue count, not a
  // claimed canonical aggregate, so it may keep its own arithmetic; it must
  // not import the canonical summary types/labels used for that purpose.
  assert.ok(!source.includes("CanonicalEventOperationalSummary"));
  assert.ok(!source.includes("toEventOperationalSummaryCards"));
});

// Row-level Site display reconciliation --
// docs/architecture/EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md,
// EPICENTRAX_CANONICAL_PARKING_READ_MIGRATION_PLAN.md §6.2: Print's queue
// Site value must derive from canonical parking_sites occupancy, never
// attendees.assigned_site.

test("Print no longer declares, selects, or reads attendees.assigned_site", () => {
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
});

test("Print loads canonical parking_sites occupancy alongside attendees", () => {
  assert.ok(source.includes('from("parking_sites")'));
  assert.match(
    source,
    /\.select\("id,event_id,site_number,display_label,assigned_attendee_id"\)/,
  );
  assert.ok(source.includes("setParkingSites(parkingRows)"));
});

test("Print's queue Site display derives from canonical placement, not attendees.assigned_site", () => {
  assert.ok(
    source.includes(
      "Site: {canonicalSiteLabelByAttendeeId.get(row.id) || \"—\"}",
    ),
  );
  assert.match(
    source,
    /const canonicalSiteLabelByAttendeeId = useMemo\(\(\) => \{\s*const labels = new Map<string, string>\(\);\s*for \(const site of parkingSites\) \{\s*if \(site\.assigned_attendee_id\) \{\s*labels\.set\(site\.assigned_attendee_id, siteLabel\(site\)\);/,
  );
});

test("manual print entries never carry assigned_site and are never keyed into canonical placement", () => {
  // createEmptyManualAttendee's id is "manual-<kind>-<uuid>", which can
  // never match a real attendee_id in parking_sites.assigned_attendee_id,
  // so canonicalSiteLabelByAttendeeId.get(row.id) is always undefined for
  // a manual row -- it falls through to the existing "—" display exactly
  // as attendees.assigned_site (always null for manual rows) did before.
  assert.ok(source.includes('id: `manual-${kind}-${uniqueId}`,'));
  assert.ok(!source.includes("assigned_site: null,"));
});
