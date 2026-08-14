import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Source-level assertions for the Site Placement Consumer Migration:
// the Admin Check-In page's ordinary placement writes inside
// saveCheckin now go through public.record_site_placement rather than
// direct parking_sites mutation. The one deliberately-retained
// direct-write branch (a site with no materialized parking_sites row
// yet -- inventory materialization is a separately-scoped prerequisite,
// per the Site Placement Governed Mutation Foundation report) is
// asserted to exist only inside its documented else-branch.
//
// Run with:
//   npx tsx --test app/admin/checkin/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

function extractSaveCheckin(): string {
  const match = SOURCE.match(/async function saveCheckin\(attendee: AttendeeRow\) \{[\s\S]*?\n  \}\n/);
  assert.ok(match, "expected to find saveCheckin");
  return match![0];
}

test("saveCheckin calls record_site_placement when the matched site is already materialized", () => {
  const fn = extractSaveCheckin();
  assert.match(fn, /if \(matchedSite\?\.id\) \{[\s\S]*?supabase\.rpc\(\s*\n\s*"record_site_placement",/);
});

test("saveCheckin maps to assign/confirm/reassign based on the attendee's prior site, never a fixed action", () => {
  const fn = extractSaveCheckin();
  assert.match(fn, /const action = !oldAssignedSite\s*\n\s*\? "assign"\s*\n\s*: oldSiteKey === newSiteKey\s*\n\s*\? "confirm"\s*\n\s*: "reassign";/);
});

test("saveCheckin calls record_site_placement with action 'clear' when the site field is blanked out, not a direct parking_sites update", () => {
  const fn = extractSaveCheckin();
  const clearBranch = fn.match(/\} else if \(!normalizedSite && oldAssignedSite\) \{[\s\S]*?\n      \}\n/);
  assert.ok(clearBranch, "expected the explicit-clear branch");
  assert.match(clearBranch![0], /p_action: "clear",/);
  assert.equal(
    /\.from\("parking_sites"\)\s*\n\s*\.update\(\{ assigned_attendee_id: null \}\)/.test(clearBranch![0]),
    false,
  );
});

test("evidence_source is 'checkin_staff' for every record_site_placement call on this page", () => {
  const calls = SOURCE.match(/p_evidence_source: "[a-z_]+"/g) || [];
  assert.ok(calls.length >= 2, "expected at least two record_site_placement calls with an evidence source");
  for (const call of calls) {
    assert.equal(call, 'p_evidence_source: "checkin_staff"');
  }
});

test("every record_site_placement call supplies a fresh idempotency key, never a fixed or reused value", () => {
  const calls = SOURCE.match(/p_idempotency_key: [^,\n]+/g) || [];
  assert.ok(calls.length >= 2);
  for (const call of calls) {
    assert.equal(call, "p_idempotency_key: newSitePlacementIdempotencyKey()");
  }
});

test("the only remaining direct parking_sites INSERT/UPDATE for placement is inside the documented unmaterialized-site branch", () => {
  const fn = extractSaveCheckin();
  const elseBranch = fn.match(/\} else if \(matchedSite\?\.master_site_id\) \{[\s\S]*?\n      \}\n/);
  assert.ok(elseBranch, "expected the unmaterialized-site else-if branch");
  assert.match(elseBranch![0], /inventory\s*\n\s*\/\/ materialization is a deferred prerequisite/);
  assert.match(elseBranch![0], /\.from\("parking_sites"\)\s*\n\s*\.insert\(\{/);

  const rest = fn.replace(elseBranch![0], "");
  assert.equal(/\.update\(\{ assigned_attendee_id: attendee\.id \}\)/.test(rest), false);
  assert.equal(/\.from\("parking_sites"\)\s*\n\s*\.insert\(\{/.test(rest), false);
});

test("a returned displaced_attendee_id clears that attendee's display projection after the attendees-table save, not before", () => {
  const fn = extractSaveCheckin();
  const iAttendeeUpdate = fn.indexOf(".from(\"attendees\")\n        .update({\n          assigned_site: normalizedSite");
  const iDisplacedClear = fn.indexOf("if (placementDisplacedAttendeeId)");
  assert.ok(iAttendeeUpdate >= 0 && iDisplacedClear > iAttendeeUpdate);
});

test("Member Check-In / submit_member_checkin is not referenced -- this migration does not touch member self-report", () => {
  assert.equal(/submit_member_checkin/.test(SOURCE), false);
});

test("no second Authority definition is introduced -- client-side permission checks are not duplicated as a security boundary inside saveCheckin", () => {
  const fn = extractSaveCheckin();
  assert.equal(/hasPermission\(/.test(fn), false);
  assert.equal(/privilege_group/.test(fn), false);
});
