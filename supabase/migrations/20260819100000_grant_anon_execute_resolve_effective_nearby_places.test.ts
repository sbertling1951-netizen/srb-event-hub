import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the resolve_effective_nearby_places
// anon EXECUTE grant repair. This is a grant-only migration -- no RLS
// policy, no function body, no schema change -- so its entire effect is
// provable from its SQL text. The live grant-mismatch evidence (anon
// EXECUTE was false pre-migration despite 79fe0a4 assuming otherwise) and
// the live anon 401/42501 reproduction against both the RPC and the
// still-denied raw table are reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260819100000_grant_anon_execute_resolve_effective_nearby_places.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260819100000_grant_anon_execute_resolve_effective_nearby_places.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("exactly one statement: GRANT EXECUTE on resolve_effective_nearby_places to anon", () => {
  assert.match(
    executableSql,
    /^\s*GRANT EXECUTE ON FUNCTION public\.resolve_effective_nearby_places\(uuid\) TO anon;\s*$/m,
  );
  const grantStatements = executableSql.match(/GRANT[^;]*;/g) || [];
  assert.equal(grantStatements.length, 1);
});

test("no REVOKE statement -- this migration only adds a privilege", () => {
  assert.equal(/\bREVOKE\b/.test(executableSql), false);
});

test("no other role is granted anything", () => {
  const grantStatements = executableSql.match(/GRANT[^;]*;/g) || [];
  for (const stmt of grantStatements) {
    assert.match(stmt, /TO anon;\s*$/);
    assert.equal(/\bauthenticated\b/.test(stmt), false);
    assert.equal(/\bservice_role\b/.test(stmt), false);
    assert.equal(/\bPUBLIC\b/.test(stmt), false);
  }
});

test("no other function, table, or the raw event_nearby_places grant is touched", () => {
  assert.equal(/event_nearby_places/.test(executableSql), false);
  const functionRefs =
    executableSql.match(/FUNCTION public\.(\w+)/g) || [];
  assert.deepEqual(
    new Set(functionRefs),
    new Set(["FUNCTION public.resolve_effective_nearby_places"]),
  );
});

test("no RLS policy, function body, or schema change is introduced", () => {
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ROW LEVEL SECURITY/.test(executableSql), false);
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(executableSql), false);
  assert.equal(/DROP FUNCTION/.test(executableSql), false);
  assert.equal(/ALTER TABLE/.test(executableSql), false);
  assert.equal(/CREATE TABLE/.test(executableSql), false);
  assert.equal(/DROP TABLE/.test(executableSql), false);
});

test("no Temporary Event Access resolver, Participation, or continuity-context surface is referenced", () => {
  assert.equal(/resolve_temporary_or_authenticated_attendee/.test(executableSql), false);
  assert.equal(/person_event_participations/.test(executableSql), false);
  assert.equal(/resolve_auth_person_link/.test(executableSql), false);
  assert.equal(/get_my_member_event_continuity_context/.test(executableSql), false);
  assert.equal(/verify_member_event_login/.test(executableSql), false);
});

test("no other domain is touched: no vendor/agenda/announcement/map/parking/attendees table reference", () => {
  for (const forbidden of [
    "attendees",
    "attendee_household_members",
    "vendor_contacts",
    "vendor_org_access",
    "vendor_event_status",
    "vendors",
    "agenda_items",
    "announcements",
    "event_map_settings",
    "master_maps",
    "master_map_sites",
    "master_map_locations",
    "parking_sites",
    "event_locations",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this repair`,
    );
  }
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
});
