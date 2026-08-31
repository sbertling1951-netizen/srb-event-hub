import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Source-structure assertions for the canonical MemberSession helpers.
//
// Run with:
//   npx tsx --test lib/memberSession.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./memberSession.ts", import.meta.url)),
  "utf8",
);
const CODE = SOURCE.replace(/^\s*\/\/.*$/gm, "");

test("ensureMemberSessionAttendee persists a governed, server-resolved attendee id onto the canonical MemberSession", () => {
  assert.match(CODE, /export function ensureMemberSessionAttendee\(attendeeId: string\): boolean \{/);
  // no-op when there is nothing coherent to attach to, or the id is already stored
  assert.match(
    CODE,
    /if \(!session\?\.event_id \|\| session\.attendee_id === attendeeId\) \{\s*\n\s*return false;\s*\n\s*\}/,
  );
  // writes through saveMemberSession (which keeps the compat Event pointer
  // and userMode consistent), never a bare localStorage.setItem of the
  // session blob
  assert.match(CODE, /saveMemberSession\(\{ \.\.\.session, attendee_id: attendeeId \}\);/);
});

test("attendee identity readers stay MemberSession-anchored", () => {
  assert.match(CODE, /export function getCurrentAttendeeId\(\): string \| null \{\s*\n\s*return getMemberSession\(\)\?\.attendee_id \?\? null;/);
});
