import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Source-level proof for Parking's consumption of the canonical
// Admin attendee-target handoff (lib/adminAttendeeTarget) -- the
// Attendees Stage A prerequisite. Run with:
//   npx tsx --test app/admin/parking/attendeeTargetHandoff.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

function extractTargetEffect(): string {
  const start = SOURCE.indexOf(
    "// Canonical attendee-target handoff (lib/adminAttendeeTarget):",
  );
  assert.ok(start >= 0, "expected to find the target-handoff effect");
  const end = SOURCE.lastIndexOf("}, [attendeeTarget, attendees, loading]);");
  return SOURCE.slice(start, end + "}, [attendeeTarget, attendees, loading]);".length);
}

test("Parking consumes the shared canonical attendee-target contract, not a page-local scheme", () => {
  assert.match(SOURCE, /import \{\s*readAdminAttendeeTarget,\s*resolveAdminAttendeeTarget,\s*\} from "@\/lib\/adminAttendeeTarget";/);
  assert.match(SOURCE, /useSearchParams\(\)/);
  assert.match(SOURCE, /readAdminAttendeeTarget\(searchParams\)/);
});

test("Parking and Check-In import the identical shared helper module -- one contract, not two", () => {
  const checkinSource = readFileSync(
    fileURLToPath(new URL("../checkin/page.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(checkinSource, /from "@\/lib\/adminAttendeeTarget"/);
  assert.match(SOURCE, /from "@\/lib\/adminAttendeeTarget"/);
});

test("a valid target selects the attendee through Parking's own existing selection state -- no separate selection path", () => {
  const fn = extractTargetEffect();
  assert.match(fn, /resolveAdminAttendeeTarget\(attendeeTarget, attendees\)/);
  assert.match(fn, /resolution\.status === "valid"/);
  assert.match(fn, /selectAttendeeAndFocusSite\(resolution\.attendeeId\)/);
});

test("selectAttendeeAndFocusSite only ever focuses an already-canonical site -- it never assigns, reassigns, or clears one", () => {
  const start = SOURCE.indexOf("function selectAttendeeAndFocusSite");
  const end = SOURCE.indexOf("\n  }\n", start);
  const fn = SOURCE.slice(start, end);
  assert.equal(/record_site_placement/.test(fn), false);
  assert.equal(/materialize_event_parking_site/.test(fn), false);
  assert.equal(/setPlacementConfirmation/.test(fn), false);
  // It only ever reads existing canonical occupancy (already-loaded
  // siteLabelByAttendeeId) to decide whether to focus the map.
  assert.match(fn, /siteLabelByAttendeeId\.get\(attendeeId\)/);
});

test("the handoff itself performs no placement mutation of any kind", () => {
  const fn = extractTargetEffect();
  assert.equal(/record_site_placement/.test(fn), false);
  assert.equal(/materialize_event_parking_site/.test(fn), false);
  assert.equal(/\.from\("parking_sites"\)/.test(fn), false);
});

test("an invalid or cross-Event target shows a visible error and never selects or focuses anything", () => {
  const fn = extractTargetEffect();
  assert.match(fn, /showError\(/);
  assert.match(fn, /could not be found in the current Parking event/i);
  const errorBranch = fn.slice(fn.indexOf('resolution.status === "valid"'));
  const showErrorIndex = errorBranch.indexOf("showError(");
  const selectAgainIndex = errorBranch.indexOf(
    "selectAttendeeAndFocusSite(",
    showErrorIndex,
  );
  assert.equal(selectAgainIndex, -1);
});

test("the handoff never reads or writes Admin Event context -- ADR-006 continuity is untouched", () => {
  const fn = extractTargetEffect();
  assert.equal(/setCurrentAdminEvent/.test(fn), false);
});

test("the target is consumed exactly once per value -- a realtime reload cannot re-select or re-error", () => {
  const fn = extractTargetEffect();
  assert.match(fn, /consumedAttendeeTargetRef\.current === attendeeTarget/);
  assert.match(fn, /consumedAttendeeTargetRef\.current = attendeeTarget/);
});

test("the row-click handler and the target handoff now share one selection implementation, not two", () => {
  const occurrences = (SOURCE.match(/selectAttendeeAndFocusSite\(/g) || []).length;
  // Definition (1) + row onClick (1) + handoff effect (1).
  assert.equal(occurrences, 3);
});

test("existing direct Parking navigation (no target param) still no-ops through the handoff", () => {
  const fn = extractTargetEffect();
  assert.match(fn, /if \(!attendeeTarget \|\| loading\) \{\s*return;\s*\}/);
});

test("the pre-existing Check-In -> Parking site-focus handoff remains a registry-owned, non-authoritative device-local handoff", () => {
  assert.match(SOURCE, /localStorage\.getItem\(STORAGE_KEYS\.parkingFocusSite\)/);
  assert.match(SOURCE, /localStorage\.removeItem\(STORAGE_KEYS\.parkingFocusSite\)/);
});
