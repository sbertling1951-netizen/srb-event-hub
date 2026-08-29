import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260910000000_repair_member_checkin_temporary_capability.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

test("replaces the duplicated Check-In identity branch with the canonical resolver", () => {
  assert.match(
    SQL,
    /v_verified_attendee_id := public\.resolve_temporary_or_authenticated_attendee\(/,
  );
  assert.match(SQL, /p_event_id, p_event_code, p_registration_identifier/);
  assert.match(SQL, /p_event_id, NULL, NULL/);
  assert.doesNotMatch(SQL, /primary_matches|household_matches|v_normalized_phone/);
});

test("invalid capability errors have a stable non-sensitive machine code", () => {
  assert.match(SQL, /ERRCODE = 'P0002'/);
  assert.match(SQL, /Temporary Event Access session is no longer valid/);
  assert.doesNotMatch(SQL, /capability_hash.*MESSAGE|MESSAGE.*capability_hash/i);
});

test("preserves the existing Check-In function contract and grants", () => {
  assert.match(SQL, /ALTER FUNCTION public\.submit_member_checkin\(uuid, uuid, boolean, boolean, text, uuid, text, text\)/);
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.submit_member_checkin/);
  assert.match(SQL, /GRANT EXECUTE ON FUNCTION public\.submit_member_checkin[\s\S]*TO anon, authenticated;/);
});