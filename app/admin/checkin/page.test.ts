import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Source-level assertions for Site Placement Inventory Materialization
// Governance on the Admin Check-In page: the last direct parking_sites
// INSERT (materializing inventory from a master-map template site)
// inside saveCheckin now goes through
// public.materialize_event_parking_site, and its returned id feeds the
// same public.record_site_placement call already used for
// already-materialized sites -- a single shared code path, not a
// parallel branch.
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

test("no direct parking_sites INSERT or occupancy UPDATE remains in saveCheckin's placement path -- materialization and placement are both governed RPC calls", () => {
  const fn = extractSaveCheckin();
  const placementBranch = fn.match(/if \(matchedSite\?\.id \|\| matchedSite\?\.master_site_id\) \{[\s\S]*?\n      \} else if \(!normalizedSite/);
  assert.ok(placementBranch, "expected the unified placement branch");
  assert.equal(/\.from\("parking_sites"\)/.test(placementBranch![0]), false);
});

test("an unmaterialized site (matchedSite.id falsy) is materialized via materialize_event_parking_site before record_site_placement is called", () => {
  const fn = extractSaveCheckin();
  assert.match(fn, /let resolvedSiteId = matchedSite\.id;\s*\n\s*\n\s*if \(!resolvedSiteId\) \{[\s\S]*?supabase\.rpc\("materialize_event_parking_site", \{/);
  const iMaterializeCall = fn.indexOf('supabase.rpc("materialize_event_parking_site"');
  const iPlacementCall = fn.indexOf('supabase.rpc(\n          "record_site_placement",');
  assert.ok(iMaterializeCall >= 0 && iPlacementCall > iMaterializeCall);
});

test("materialize_event_parking_site's rejection throws (surfaced by the enclosing try/catch) and short-circuits before record_site_placement is ever called", () => {
  const fn = extractSaveCheckin();
  const materializeBlock = fn.slice(fn.indexOf("if (!resolvedSiteId)"), fn.indexOf('supabase.rpc(\n          "record_site_placement",'));
  assert.match(materializeBlock, /materializeResult\.outcome === "rejected"/);
  assert.match(materializeBlock, /throw new Error\(/);
});

test("record_site_placement always receives resolvedSiteId -- the same variable regardless of whether the site was already materialized or just materialized", () => {
  const fn = extractSaveCheckin();
  assert.match(fn, /p_site_id: resolvedSiteId,/);
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
  assert.equal(/\.from\("parking_sites"\)/.test(clearBranch![0]), false);
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
