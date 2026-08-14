import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Source-level assertions for the Site Placement Consumer Migration:
// the Admin Parking page's ordinary placement writes now go through
// public.record_site_placement rather than direct parking_sites
// mutation. The one deliberately-retained direct-write branch (a site
// with no materialized parking_sites row yet -- inventory
// materialization is a separately-scoped prerequisite, per the Site
// Placement Governed Mutation Foundation report) is asserted to exist
// only inside its documented else-branch, not on the ordinary path.
//
// Run with:
//   npx tsx --test app/admin/parking/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("assignAttendeeToSite calls record_site_placement when the target site is already materialized", () => {
  const fn = SOURCE.match(/async function assignAttendeeToSite\(\{[\s\S]*?\n  \}\n/);
  assert.ok(fn, "expected to find assignAttendeeToSite");
  assert.match(fn![0], /if \(site\.id\) \{[\s\S]*?supabase\.rpc\(\s*\n\s*"record_site_placement",/);
});

test("assignAttendeeToSite maps to assign/confirm/reassign based on the attendee's current site, never a fixed action", () => {
  const fn = SOURCE.match(/async function assignAttendeeToSite\(\{[\s\S]*?\n  \}\n/);
  assert.match(fn![0], /const action = !currentSiteKey\s*\n\s*\? "assign"\s*\n\s*: currentSiteKey === siteKey\s*\n\s*\? "confirm"\s*\n\s*: "reassign";/);
});

test("clearSite calls record_site_placement with action 'clear', not a direct parking_sites update", () => {
  const fn = SOURCE.match(/async function clearSite\([\s\S]*?\n  \}\n/);
  assert.ok(fn, "expected to find clearSite");
  assert.match(fn![0], /p_action: "clear",/);
  assert.equal(
    /\.from\("parking_sites"\)\s*\n\s*\.update\(\{ assigned_attendee_id: null \}\)/.test(fn![0]),
    false,
    "clearSite must not directly UPDATE parking_sites anymore",
  );
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

test("the only remaining direct parking_sites INSERT/UPDATE for placement is inside the documented unmaterialized-site branch", () => {
  const fn = SOURCE.match(/async function assignAttendeeToSite\(\{[\s\S]*?\n  \}\n/);
  const elseBranch = fn![0].match(/\} else \{[\s\S]*?\n    \}\n/);
  assert.ok(elseBranch, "expected the unmaterialized-site else branch");
  assert.match(elseBranch![0], /inventory\s*\n\s*\/\/ materialization is a deferred prerequisite/);
  assert.match(elseBranch![0], /await supabase\.from\("parking_sites"\)\.insert\(\{/);

  // Outside that branch (the rest of the function), no direct parking_sites
  // INSERT/UPDATE for placement should remain.
  const rest = fn![0].replace(elseBranch![0], "");
  assert.equal(/\.from\("parking_sites"\)\s*\n\s*\.update\(\{ assigned_attendee_id/.test(rest), false);
  assert.equal(/\.from\("parking_sites"\)\.insert\(/.test(rest), false);
});

test("a returned displaced_attendee_id clears that attendee's display projection after the RPC call, not before", () => {
  const fn = SOURCE.match(/async function assignAttendeeToSite\(\{[\s\S]*?\n  \}\n/);
  const iRpc = fn![0].indexOf('supabase.rpc(\n        "record_site_placement"');
  const iDisplacedClear = fn![0].indexOf("if (result.displaced_attendee_id)");
  assert.ok(iRpc >= 0 && iDisplacedClear > iRpc);
});

test("no second Authority definition is introduced -- client-side permission checks are not duplicated as a security boundary in these functions", () => {
  const fn = (SOURCE.match(/async function assignAttendeeToSite\(\{[\s\S]*?\n  \}\n/) || [""])[0]
    + (SOURCE.match(/async function clearSite\([\s\S]*?\n  \}\n/) || [""])[0];
  assert.equal(/hasPermission\(/.test(fn), false);
  assert.equal(/privilege_group/.test(fn), false);
});
