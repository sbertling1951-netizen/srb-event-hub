import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADMIN_ATTENDEE_TARGET_PARAM,
  buildAdminAttendeeTargetHref,
  readAdminAttendeeTarget,
  resolveAdminAttendeeTarget,
} from "./adminAttendeeTarget";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./adminAttendeeTarget.ts", import.meta.url)),
  "utf8",
);

test("buildAdminAttendeeTargetHref carries only the attendee id -- no Event field of any kind", () => {
  const href = buildAdminAttendeeTargetHref("/admin/checkin", "attendee-1");
  assert.equal(href, "/admin/checkin?attendee=attendee-1");
  assert.equal(/event/i.test(href), false);
});

test("buildAdminAttendeeTargetHref is the same shape for every destination -- one contract, not per-page schemes", () => {
  const checkinHref = buildAdminAttendeeTargetHref("/admin/checkin", "a-1");
  const parkingHref = buildAdminAttendeeTargetHref("/admin/parking", "a-1");
  assert.equal(
    checkinHref.split("?")[1],
    parkingHref.split("?")[1],
    "both destinations must receive the identical query string shape",
  );
});

test("readAdminAttendeeTarget reads the canonical parameter and trims it", () => {
  const params = new URLSearchParams(`${ADMIN_ATTENDEE_TARGET_PARAM}=  a-1  `);
  assert.equal(readAdminAttendeeTarget(params), "a-1");
});

test("readAdminAttendeeTarget returns null when absent, blank, or searchParams is null", () => {
  assert.equal(readAdminAttendeeTarget(new URLSearchParams("")), null);
  assert.equal(readAdminAttendeeTarget(new URLSearchParams("attendee=   ")), null);
  assert.equal(readAdminAttendeeTarget(null), null);
  assert.equal(readAdminAttendeeTarget(undefined), null);
});

test("resolveAdminAttendeeTarget: no parameter present is 'none', not 'invalid'", () => {
  const result = resolveAdminAttendeeTarget(null, [{ id: "a-1" }]);
  assert.deepEqual(result, { status: "none" });
});

test("resolveAdminAttendeeTarget: a target present in the loaded roster is valid", () => {
  const result = resolveAdminAttendeeTarget("a-2", [{ id: "a-1" }, { id: "a-2" }]);
  assert.deepEqual(result, { status: "valid", attendeeId: "a-2" });
});

test("resolveAdminAttendeeTarget: a target absent from the loaded (already Event-scoped) roster is invalid, never silently ignored", () => {
  const result = resolveAdminAttendeeTarget("cross-event-attendee", [{ id: "a-1" }]);
  assert.deepEqual(result, { status: "invalid", attendeeId: "cross-event-attendee" });
});

test("resolveAdminAttendeeTarget: an empty roster (still loading, or Event has no attendees) never treats the target as valid", () => {
  const result = resolveAdminAttendeeTarget("a-1", []);
  assert.deepEqual(result, { status: "invalid", attendeeId: "a-1" });
});

test("resolveAdminAttendeeTarget performs no I/O of any kind -- pure function over the array it is given", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("export function resolveAdminAttendeeTarget"),
  );
  assert.equal(/supabase|fetch\(|\.rpc\(/.test(fn), false);
});
