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
