import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Source-level proof for Check-In's consumption of the canonical
// Admin attendee-target handoff (lib/adminAttendeeTarget) -- the
// Attendees Stage A prerequisite. Run with:
//   npx tsx --test app/admin/checkin/attendeeTargetHandoff.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

function extractTargetEffect(): string {
  const start = SOURCE.indexOf(
    "// Canonical attendee-target handoff (lib/adminAttendeeTarget):",
  );
  assert.ok(start >= 0, "expected to find the target-handoff effect");
  const end = SOURCE.indexOf("function closeSelectedAttendee", start);
  return SOURCE.slice(start, end);
}

test("Check-In consumes the shared canonical attendee-target contract, not a page-local scheme", () => {
  assert.match(SOURCE, /import \{\s*readAdminAttendeeTarget,\s*resolveAdminAttendeeTarget,\s*\} from "@\/lib\/adminAttendeeTarget";/);
  assert.match(SOURCE, /useSearchParams\(\)/);
  assert.match(SOURCE, /readAdminAttendeeTarget\(searchParams\)/);
});

test("a valid target selects the attendee through Check-In's own existing selectAttendee -- no separate selection path", () => {
  const fn = extractTargetEffect();
  assert.match(fn, /resolveAdminAttendeeTarget\(attendeeTarget, attendees\)/);
  assert.match(fn, /resolution\.status === "valid"/);
  assert.match(fn, /selectAttendee\(resolution\.attendeeId\)/);
});

test("an invalid or cross-Event target shows a visible error and never touches selection", () => {
  const fn = extractTargetEffect();
  assert.match(fn, /showError\(/);
  assert.match(fn, /could not be found in the current Check-In event/i);
  // The error branch must not itself call selectAttendee.
  const errorBranch = fn.slice(fn.indexOf('resolution.status === "valid"'));
  const showErrorIndex = errorBranch.indexOf("showError(");
  const selectAgainIndex = errorBranch.indexOf(
    "selectAttendee(",
    showErrorIndex,
  );
  assert.equal(selectAgainIndex, -1);
});

test("the handoff performs no Arrival mutation of any kind -- it never calls complete_admin_checkin or any attendees write", () => {
  const fn = extractTargetEffect();
  assert.equal(/complete_admin_checkin/.test(fn), false);
  assert.equal(/\.from\("attendees"\)/.test(fn), false);
  assert.equal(/\.update\(/.test(fn), false);
});

test("the handoff never reads or writes Admin Event context -- ADR-006 continuity is untouched", () => {
  const fn = extractTargetEffect();
  assert.equal(/setCurrentAdminEvent/.test(fn), false);
  assert.equal(/getCurrentAdminEvent/.test(fn), false);
  assert.equal(/resolveAdminWorkingEvent/.test(fn), false);
});

test("the target is consumed exactly once per value -- a realtime reload cannot re-select or re-error", () => {
  const fn = extractTargetEffect();
  assert.match(fn, /consumedAttendeeTargetRef\.current === attendeeTarget/);
  assert.match(fn, /consumedAttendeeTargetRef\.current = attendeeTarget/);
});

test("resolution is against attendees already loaded for the current Event, never a fresh or cross-Event fetch", () => {
  const fn = extractTargetEffect();
  assert.equal(/supabase\s*\n?\s*\.from\(/.test(fn), false);
  assert.equal(/\.rpc\(/.test(fn), false);
});

test("existing direct Check-In navigation (no target param) still no-ops through the handoff", () => {
  const fn = extractTargetEffect();
  assert.match(fn, /if \(!attendeeTarget \|\| loading\) \{\s*return;\s*\}/);
});

test("the existing Check-In -> Parking site-focus handoff (fcoc-parking-focus-site) is untouched -- a separate, legitimate, site-number-based mechanism this task does not migrate", () => {
  assert.match(SOURCE, /localStorage\.setItem\(\s*"fcoc-parking-focus-site"/);
  assert.match(SOURCE, /window\.dispatchEvent\(new Event\("fcoc-parking-focus-site"\)\)/);
});
