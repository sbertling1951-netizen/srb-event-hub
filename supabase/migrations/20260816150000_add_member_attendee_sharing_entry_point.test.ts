import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the member attendee-sharing entry
// point. No live/linked database was used to validate this migration --
// see the closeout report for why.
//
// Run with:
//   npx tsx --test supabase/migrations/20260816150000_add_member_attendee_sharing_entry_point.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260816150000_add_member_attendee_sharing_entry_point.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("identity is resolved through the same shared boundary every other member-facing attendee RPC uses", () => {
  assert.match(
    executableSql,
    /v_attendee_id := public\.resolve_temporary_or_authenticated_attendee\(\s*\n\s*p_event_id, p_event_code, p_registration_identifier\s*\n\s*\);/,
  );
  assert.match(executableSql, /RAISE EXCEPTION 'unauthorized';/);
});

test("writes go through the identical internal helper Admin Check-In uses -- no second preference model", () => {
  assert.match(
    executableSql,
    /SELECT \* FROM public\._apply_attendee_sharing_preferences\(\s*\n\s*v_attendee_id, p_shared_field_keys, 'member_self_service', NULL, auth\.uid\(\)\s*\n\s*\);/,
  );
  assert.equal(/CREATE TABLE/.test(executableSql), false, "no new table -- reuses the existing governed storage");
  assert.equal(/CREATE OR REPLACE FUNCTION public\._apply_attendee_sharing_preferences/.test(executableSql), false, "the internal helper itself is not redefined");
});

test("submit_member_checkin is not touched by this migration", () => {
  assert.equal(/submit_member_checkin/.test(executableSql), false);
});

test("grantable to anon and authenticated -- the same audience get_my_attendee_record already serves for temporary and signed-in members alike", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.set_member_attendee_sharing_preferences\(uuid, text, text, text\[\]\)\s*\nFROM PUBLIC, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.set_member_attendee_sharing_preferences\(uuid, text, text, text\[\]\)\s*\nTO anon, authenticated;/,
  );
});
