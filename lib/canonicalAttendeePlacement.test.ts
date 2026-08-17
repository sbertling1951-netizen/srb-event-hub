import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { reduceCanonicalAttendeePlacement } from "./canonicalAttendeePlacement";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./canonicalAttendeePlacement.ts", import.meta.url)),
  "utf8",
);

// ---- Pure reducer: unit-testable with plain data, no network. ----

test("reduceCanonicalAttendeePlacement: attendee not found in the requested Event is reported, not treated as Unassigned", () => {
  const result = reduceCanonicalAttendeePlacement(null, null);
  assert.deepEqual(result, { ok: false, reason: "attendee_not_found_in_event" });
});

test("reduceCanonicalAttendeePlacement: attendee found, no parking_sites row -> Unassigned (ok:true, site:null)", () => {
  const result = reduceCanonicalAttendeePlacement({ id: "a-1" }, null);
  assert.deepEqual(result, { ok: true, site: null });
});

test("reduceCanonicalAttendeePlacement: attendee found with a placement row prefers the master site's display_label", () => {
  const result = reduceCanonicalAttendeePlacement(
    { id: "a-1" },
    {
      id: "ps-1",
      master_site_id: "ms-1",
      master_map_sites: { site_number: "12", display_label: "Row A - 12" },
    },
  );
  assert.deepEqual(result, {
    ok: true,
    site: { parkingSiteId: "ps-1", masterSiteId: "ms-1", label: "Row A - 12" },
  });
});

test("reduceCanonicalAttendeePlacement: falls back to site_number when display_label is absent, and to masterSiteId only as a last resort", () => {
  const withNumber = reduceCanonicalAttendeePlacement(
    { id: "a-1" },
    { id: "ps-1", master_site_id: "ms-1", master_map_sites: { site_number: "12", display_label: null } },
  );
  assert.equal(withNumber.ok && withNumber.site?.label, "12");

  const withNeither = reduceCanonicalAttendeePlacement(
    { id: "a-1" },
    { id: "ps-1", master_site_id: "ms-1", master_map_sites: null },
  );
  assert.equal(withNeither.ok && withNeither.site?.label, "ms-1");
});

test("reduceCanonicalAttendeePlacement never reads or derives from an assigned_site field -- it doesn't accept one", () => {
  // The reducer's own parameter shape has no assigned_site field at all;
  // this proves that structurally rather than by convention.
  const result = reduceCanonicalAttendeePlacement(
    { id: "a-1" },
    // @ts-expect-error -- assigned_site is intentionally not part of the
    // governed placement row shape.
    { id: "ps-1", master_site_id: "ms-1", assigned_site: "99", master_map_sites: null },
  );
  assert.equal(result.ok && result.site?.label, "ms-1");
});

// ---- Structural proof for the impure fetch wrapper. ----

test("fetchCanonicalAttendeePlacement never selects or filters by attendees.assigned_site", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("export async function fetchCanonicalAttendeePlacement"));
  assert.equal(/assigned_site/.test(fn), false);
});

test("fetchCanonicalAttendeePlacement derives placement only from parking_sites, joined to master_map_sites", () => {
  assert.match(SOURCE, /\.from\("parking_sites"\)/);
  assert.match(SOURCE, /master_map_sites\(site_number,display_label\)/);
});

test("fetchCanonicalAttendeePlacement is Event-scoped on both the attendee-exists check and the placement query", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("export async function fetchCanonicalAttendeePlacement"));
  const eqEventIdCount = (fn.match(/\.eq\("event_id", eventId\)/g) || []).length;
  assert.equal(eqEventIdCount, 2);
});

test("fetchCanonicalAttendeePlacement verifies the attendee belongs to the requested Event before ever reading placement -- a cross-Event id cannot return a site", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("export async function fetchCanonicalAttendeePlacement"));
  const attendeeCheckIndex = fn.indexOf('.from("attendees")');
  const placementCheckIndex = fn.indexOf('.from("parking_sites")');
  assert.ok(attendeeCheckIndex >= 0 && placementCheckIndex > attendeeCheckIndex);
  assert.match(fn, /if \(!attendeeRow\) \{\s*return \{ ok: false, reason: "attendee_not_found_in_event" \};/);
});

test("fetchCanonicalAttendeePlacement introduces no new RPC, and performs a plain client read (no service-role / admin client import)", () => {
  assert.equal(/\.rpc\(/.test(SOURCE), false);
  assert.equal(/service_role|createAdminClient|SUPABASE_SERVICE/i.test(SOURCE), false);
});
