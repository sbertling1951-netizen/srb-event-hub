import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the event_import_rows anon Grant
// Hygiene migration. This is a grant-only migration -- no RLS policy, no
// RPC body, no schema change -- so its entire effect is provable from its
// SQL text. The live grant matrix, the repository-wide event_import_rows
// consumer audit (including the zero-live-call-site confirmation for the
// removed AddEventParticipantModal.tsx and the zero-RPC-dependency
// confirmation), and the 147-row/zero-manual_participant historical-data
// count were independently verified against the linked project and by
// repository-wide grep as part of this change's validation, and are
// reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260822160000_harden_event_import_rows_anon_grants.test.ts

const SQL = readFileSync(
  fileURLToPath(new URL("./20260822160000_harden_event_import_rows_anon_grants.sql", import.meta.url)),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("no GRANT statement exists -- this migration only removes privileges", () => {
  assert.equal(/\bGRANT\b/.test(executableSql), false);
});

test("exactly one REVOKE statement, targeting exactly one table", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  assert.equal(revokeStatements.length, 1);
  const tableRefs = executableSql.match(/ON TABLE public\.(\w+)/g) || [];
  assert.deepEqual(tableRefs, ["ON TABLE public.event_import_rows"]);
});

test("event_import_rows: anon loses exactly SELECT, INSERT, UPDATE, DELETE, TRUNCATE", () => {
  assert.match(
    executableSql,
    /REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE\s*\nON TABLE public\.event_import_rows\s*\nFROM anon;/,
  );
});

test("the REVOKE statement names anon and only anon -- authenticated and service_role are never touched", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  assert.equal(revokeStatements.length, 1);
  assert.match(revokeStatements[0], /FROM anon;\s*$/);
  assert.equal(/\bauthenticated\b/.test(revokeStatements[0]), false);
  assert.equal(/\bservice_role\b/.test(revokeStatements[0]), false);
});

test("REFERENCES, TRIGGER, and MAINTAIN are never named -- only the mutation/read set is touched", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  for (const stmt of revokeStatements) {
    assert.equal(/\bREFERENCES\b/.test(stmt), false, `must not revoke REFERENCES: ${stmt}`);
    assert.equal(/\bTRIGGER\b/.test(stmt), false, `must not revoke TRIGGER: ${stmt}`);
    assert.equal(/\bMAINTAIN\b/.test(stmt), false, `must not revoke MAINTAIN: ${stmt}`);
  }
});

test("no RLS policy is touched: no DROP POLICY, CREATE POLICY, or ALTER TABLE ... ROW LEVEL SECURITY statement", () => {
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ROW LEVEL SECURITY/.test(executableSql), false);
});

test("no helper/RPC or schema/data change is introduced -- no DDL besides the REVOKE, no DML at all", () => {
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(executableSql), false);
  assert.equal(/DROP FUNCTION/.test(executableSql), false);
  assert.equal(/CREATE TABLE/.test(executableSql), false);
  assert.equal(/ALTER TABLE/.test(executableSql), false);
  assert.equal(/DROP TABLE/.test(executableSql), false);
  assert.equal(/\bTRUNCATE\s+(TABLE\s+)?public\./.test(executableSql), false);
  assert.equal(/\bDELETE\s+FROM\s+public\./.test(executableSql), false);
  assert.equal(/\bUPDATE\s+public\./.test(executableSql), false);
  assert.equal(/\bINSERT\s+INTO\s+public\./.test(executableSql), false);
});

test("no task authority or lifecycle guard is introduced -- this is a grant-only migration", () => {
  assert.equal(/assert_event_lifecycle_mutable/.test(executableSql), false);
  assert.equal(/has_event_task_authority/.test(executableSql), false);
  assert.equal(/admin_task_registry/.test(executableSql), false);
});

test("no other domain/table is touched: no vendor/agenda/attendee/announcement/map/parking/import-run table reference", () => {
  for (const forbidden of [
    "vendors",
    "vendor_contacts",
    "vendor_org_access",
    "vendor_event_status",
    "event_vendors",
    "agenda_items",
    "announcements",
    "event_map_settings",
    "master_maps",
    "parking_sites",
    "event_locations",
    "attendees",
    "attendee_household_members",
    "import_runs",
    "import_run_rows",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this hardening pass`,
    );
  }
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
});
