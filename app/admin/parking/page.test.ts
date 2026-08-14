import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Source-level assertions for Site Placement Inventory Materialization
// Governance on the Admin Parking page: the last direct parking_sites
// INSERT (materializing inventory from a master-map template site) now
// goes through public.materialize_event_parking_site, and its returned
// id feeds the same public.record_site_placement call already used for
// already-materialized sites -- a single shared code path, not a
// parallel branch.
//
// Run with:
//   npx tsx --test app/admin/parking/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

function extractAssignAttendeeToSite(): string {
  const match = SOURCE.match(/async function assignAttendeeToSite\(\{[\s\S]*?\n  \}\n/);
  assert.ok(match, "expected to find assignAttendeeToSite");
  return match![0];
}

test("no direct parking_sites INSERT or occupancy UPDATE remains in assignAttendeeToSite -- materialization and placement are both governed RPC calls", () => {
  const fn = extractAssignAttendeeToSite();
  assert.equal(/\.from\("parking_sites"\)/.test(fn), false);
});

test("an unmaterialized site (site.id falsy) is materialized via materialize_event_parking_site before record_site_placement is called", () => {
  const fn = extractAssignAttendeeToSite();
  assert.match(fn, /let resolvedSiteId = site\.id;\s*\n\s*\n\s*if \(!resolvedSiteId\) \{[\s\S]*?supabase\.rpc\("materialize_event_parking_site", \{/);
  const iMaterializeCall = fn.indexOf('supabase.rpc("materialize_event_parking_site"');
  const iPlacementCall = fn.indexOf('supabase.rpc(\n      "record_site_placement",');
  assert.ok(iMaterializeCall >= 0 && iPlacementCall > iMaterializeCall);
});

test("materialize_event_parking_site's rejection is surfaced as an error and short-circuits before record_site_placement is ever called", () => {
  const fn = extractAssignAttendeeToSite();
  const materializeBlock = fn.slice(fn.indexOf("if (!resolvedSiteId)"), fn.indexOf('supabase.rpc(\n      "record_site_placement",'));
  assert.match(materializeBlock, /materializeResult\.outcome === "rejected"/);
  assert.match(materializeBlock, /return false;/);
});

test("record_site_placement always receives resolvedSiteId -- the same variable regardless of whether the site was already materialized or just materialized", () => {
  const fn = extractAssignAttendeeToSite();
  assert.match(fn, /p_site_id: resolvedSiteId,/);
});

test("assignAttendeeToSite maps to assign/confirm/reassign based on the attendee's current site, never a fixed action", () => {
  const fn = extractAssignAttendeeToSite();
  assert.match(fn, /const action = !currentSiteKey\s*\n\s*\? "assign"\s*\n\s*: currentSiteKey === siteKey\s*\n\s*\? "confirm"\s*\n\s*: "reassign";/);
});

test("clearSite calls record_site_placement with action 'clear', not a direct parking_sites update", () => {
  const fn = SOURCE.match(/async function clearSite\([\s\S]*?\n  \}\n/);
  assert.ok(fn, "expected to find clearSite");
  assert.match(fn![0], /p_action: "clear",/);
  assert.equal(/\.from\("parking_sites"\)/.test(fn![0]), false);
});

test("evidence_source is 'parking_staff' for every record_site_placement call on this page", () => {
  const calls = SOURCE.match(/p_evidence_source: "[a-z_]+"/g) || [];
  assert.ok(calls.length >= 2, "expected at least two record_site_placement calls with an evidence source");
  for (const call of calls) {
    assert.equal(call, 'p_evidence_source: "parking_staff"');
  }
});

test("every record_site_placement call supplies a fresh idempotency key, never a fixed or reused value", () => {
  const calls = SOURCE.match(/p_idempotency_key: [^,\n]+/g) || [];
  assert.ok(calls.length >= 2);
  for (const call of calls) {
    assert.equal(call, "p_idempotency_key: newSitePlacementIdempotencyKey()");
  }
});

test("a returned displaced_attendee_id clears that attendee's display projection after the placement RPC call, not before", () => {
  const fn = extractAssignAttendeeToSite();
  const iRpc = fn.indexOf('supabase.rpc(\n      "record_site_placement",');
  const iDisplacedClear = fn.indexOf("if (result.displaced_attendee_id)");
  assert.ok(iRpc >= 0 && iDisplacedClear > iRpc);
});

test("no second Authority definition is introduced -- client-side permission checks are not duplicated as a security boundary in these functions", () => {
  const fn = extractAssignAttendeeToSite()
    + (SOURCE.match(/async function clearSite\([\s\S]*?\n  \}\n/) || [""])[0];
  assert.equal(/hasPermission\(/.test(fn), false);
  assert.equal(/privilege_group/.test(fn), false);
});
