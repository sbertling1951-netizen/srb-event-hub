import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Reports registration-type terminology reconciliation --
// docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md, Canonical
// Event Operational Summary Read Contract, Consumer implications for
// Reports: groupings derived from registration-row participant_type
// describe registration classification, not people/headcount, and must
// say "Registration Type" on user-facing surfaces. Internal identifiers
// (participantTypeFilter, ParticipantTypeFilter, participant_type,
// participantType) are preserved deliberately -- this is a labeling fix,
// not a rename. Run with:
//   npx tsx --test components/admin/reports/reportTerminology.test.ts

function readSource(relativePath: string) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return readFileSync(path, "utf8");
}

const controlsSource = readSource("./ReportControlsPanel.tsx");
const panelSource = readSource("./ReportsPanel.tsx");
const exportSource = readSource("./reportExport.ts");

test("ReportControlsPanel's filter label says Registration Type, not Participant Type", () => {
  assert.match(controlsSource, /<Field label="Registration Type">/);
  assert.ok(!controlsSource.includes("Participant Type"));
});

test("ReportsPanel's summary line says Registration type, not Participant type", () => {
  assert.match(panelSource, /Registration type:/);
  assert.ok(!panelSource.includes("Participant type:"));
});

test("reportExport's filter row and column header say Registration Type, not Participant Type", () => {
  const registrationTypeFilterRows = [
    ...exportSource.matchAll(/\["Registration Type Filter", participantTypeFilter\]/g),
  ];
  // Once for the activity_summary export branch, once for the roster branch.
  assert.equal(registrationTypeFilterRows.length, 2);
  assert.match(exportSource, /"Registration Type",\s*\n\s*"Pilot",/);
  assert.ok(!exportSource.includes("Participant Type"));
});

test("internal identifiers are preserved -- this is a label fix, not a rename", () => {
  assert.ok(controlsSource.includes("participantTypeFilter"));
  assert.ok(controlsSource.includes("ParticipantTypeFilter"));
  assert.ok(exportSource.includes("participantTypeFilter"));
  assert.ok(exportSource.includes("row.participantType"));
});
