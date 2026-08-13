import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused tests for the Event Context Single-Owner Integrity pass
// (docs/architecture/ADR-006 Event Context Architecture.md §3.4):
// AdminAccessResult.currentEventId / currentEventAccess were a fifth,
// disconnected notion of "current Event" -- computed as
// admin_event_access order's eventIds[0], never consumed by any page's
// rendering, routing, or Event-context decision, and never used by
// canAccessEvent() (which reads eventAccessRows independently). This
// file proves the dead fields and their computation are gone, and that
// real authorization (canAccessEvent, eventAccessRows) is untouched.
// Run with:
//   npx tsx --test lib/getCurrentAdminAccess.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./getCurrentAdminAccess.ts", import.meta.url)),
  "utf8",
);

test("AdminAccessResult no longer declares currentEventId or currentEventAccess", () => {
  const typeIdx = SOURCE.indexOf("export type AdminAccessResult = {");
  assert.notEqual(typeIdx, -1);
  const typeEndIdx = SOURCE.indexOf("};", typeIdx);
  const typeBody = SOURCE.slice(typeIdx, typeEndIdx);

  assert.equal(/currentEventId/.test(typeBody), false);
  assert.equal(/currentEventAccess/.test(typeBody), false);
});

test("the retired eventIds[0]-as-current-Event computation is gone", () => {
  assert.equal(/let currentEventId/.test(SOURCE), false);
  assert.equal(/currentEventId = eventIds\[0\]/.test(SOURCE), false);
});

test("real authorization is untouched: canAccessEvent still checks eventAccessRows directly, not the retired fields", () => {
  const fnIdx = SOURCE.indexOf("export function canAccessEvent(");
  assert.notEqual(fnIdx, -1);
  const fnBody = SOURCE.slice(fnIdx, fnIdx + 400);

  assert.match(fnBody, /admin\.eventAccessRows\.some\(/);
  assert.equal(/currentEventId/.test(fnBody), false);
});

test("eventIds/event_ids (legitimate authorization data) are still computed and returned independently of the retired fields", () => {
  assert.match(SOURCE, /const eventIds = unique\(/);
  assert.match(SOURCE, /eventIds,/);
  assert.match(SOURCE, /event_ids: eventIds,/);
});
