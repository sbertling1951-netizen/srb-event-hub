import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the attendees / attendee_household_
// members / event_nearby_places anon Grant Hygiene migration. This is a
// grant-only migration -- no RLS policy, no RPC body, no schema change --
// so its entire effect is provable from its SQL text. The live grant
// matrix, the anon-consumer audit for event_nearby_places SELECT
// (including the resolve_effective_nearby_places SECURITY DEFINER
// isolation), and the zero-anon-policy confirmation for attendees/
// attendee_household_members were independently verified against the
// linked project and by repository-wide grep as part of this change's
// validation, and are reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260819090000_harden_attendees_nearby_places_anon_grants.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260819090000_harden_attendees_nearby_places_anon_grants.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("no GRANT statement exists -- this migration only removes privileges", () => {
  assert.equal(/\bGRANT\b/.test(executableSql), false);
});

test("exactly three REVOKE statements total, one per targeted table", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  assert.equal(revokeStatements.length, 3);
});

test("attendees: anon loses TRUNCATE only", () => {
  assert.match(
    executableSql,
    /REVOKE TRUNCATE\s*\nON TABLE public\.attendees\s*\nFROM anon;/,
  );
});

test("attendee_household_members: anon loses TRUNCATE only", () => {
  assert.match(
    executableSql,
    /REVOKE TRUNCATE\s*\nON TABLE public\.attendee_household_members\s*\nFROM anon;/,
  );
});

test("event_nearby_places: anon loses SELECT, INSERT, UPDATE, DELETE, TRUNCATE", () => {
  assert.match(
    executableSql,
    /REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE\s*\nON TABLE public\.event_nearby_places\s*\nFROM anon;/,
  );
});

test("every REVOKE statement names anon and only anon -- authenticated and service_role are never touched", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  assert.equal(revokeStatements.length, 3);
  for (const stmt of revokeStatements) {
    assert.match(stmt, /FROM anon;\s*$/);
    assert.equal(/\bauthenticated\b/.test(stmt), false);
    assert.equal(/\bservice_role\b/.test(stmt), false);
  }
});

test("REFERENCES, TRIGGER, and MAINTAIN are never named -- only the mutation/read set is touched", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  for (const stmt of revokeStatements) {
    assert.equal(/\bREFERENCES\b/.test(stmt), false, `must not revoke REFERENCES: ${stmt}`);
    assert.equal(/\bTRIGGER\b/.test(stmt), false, `must not revoke TRIGGER: ${stmt}`);
    assert.equal(/\bMAINTAIN\b/.test(stmt), false, `must not revoke MAINTAIN: ${stmt}`);
  }
});

test("attendees and attendee_household_members REVOKE statements never name SELECT/INSERT/UPDATE/DELETE -- those were already closed for anon", () => {
  const attendeesStmt = executableSql.match(/REVOKE[^;]*ON TABLE public\.attendees\s*\nFROM anon;/);
  const hmStmt = executableSql.match(
    /REVOKE[^;]*ON TABLE public\.attendee_household_members\s*\nFROM anon;/,
  );
  assert.ok(attendeesStmt);
  assert.ok(hmStmt);
  for (const stmt of [attendeesStmt[0], hmStmt[0]]) {
    for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert.equal(
        new RegExp(`\\b${priv}\\b`).test(stmt),
        false,
        `must not name ${priv}: ${stmt}`,
      );
    }
  }
});

test("no table outside the three targeted tables is referenced", () => {
  const tableRefs = executableSql.match(/ON TABLE public\.(\w+)/g) || [];
  assert.equal(tableRefs.length, 3, "expected exactly three ON TABLE clauses");
  const normalized = tableRefs.map((ref) => ref.replace(/^ON TABLE public\./, ""));
  assert.deepEqual(
    new Set(normalized),
    new Set(["attendees", "attendee_household_members", "event_nearby_places"]),
  );
});

test("no RLS policy is touched: no DROP POLICY, CREATE POLICY, or ALTER TABLE ... ROW LEVEL SECURITY statement", () => {
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ROW LEVEL SECURITY/.test(executableSql), false);
});

test("no helper/RPC or schema change is introduced", () => {
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(executableSql), false);
  assert.equal(/DROP FUNCTION/.test(executableSql), false);
  assert.equal(/CREATE TABLE/.test(executableSql), false);
  assert.equal(/ALTER TABLE/.test(executableSql), false);
  assert.equal(/DROP TABLE/.test(executableSql), false);
});

test("no Temporary Event Access resolver, Participation, or continuity-context surface is referenced", () => {
  assert.equal(/resolve_temporary_or_authenticated_attendee/.test(executableSql), false);
  assert.equal(/person_event_participations/.test(executableSql), false);
  assert.equal(/resolve_auth_person_link/.test(executableSql), false);
  assert.equal(/get_my_member_event_continuity_context/.test(executableSql), false);
  assert.equal(/resolve_effective_nearby_places/.test(executableSql), false);
});

test("no Lifecycle guard or Authority task key is introduced", () => {
  assert.equal(/assert_event_lifecycle_mutable/.test(executableSql), false);
  assert.equal(/has_event_task_authority/.test(executableSql), false);
  assert.equal(/admin_task_registry/.test(executableSql), false);
});

test("no other domain is touched: no vendor/agenda/announcement/map/parking table reference", () => {
  for (const forbidden of [
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
