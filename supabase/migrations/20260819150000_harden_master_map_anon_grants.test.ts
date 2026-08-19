import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the master_maps/master_map_sites/
// master_map_locations anon grant-hygiene migration. Grant-only -- no
// RLS policy, no schema change -- so its entire effect is provable from
// its SQL text. Live grant-matrix and RLS-policy evidence, and the live
// anon read/write/TRUNCATE REST proof, are reported separately, not
// re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260819150000_harden_master_map_anon_grants.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260819150000_harden_master_map_anon_grants.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^\s*--.*$/gm, "");

test("no GRANT statement exists -- this migration only removes privileges", () => {
  assert.equal(/\bGRANT\b/.test(executableSql), false);
});

test("exactly three REVOKE statements, one per targeted table", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  assert.equal(revokeStatements.length, 3);
});

test("each table loses exactly DELETE, INSERT, TRUNCATE, UPDATE -- SELECT is preserved", () => {
  for (const table of ["master_maps", "master_map_sites", "master_map_locations"]) {
    assert.match(
      executableSql,
      new RegExp(
        `REVOKE DELETE, INSERT, TRUNCATE, UPDATE\\s*\\nON TABLE public\\.${table}\\s*\\nFROM anon;`,
      ),
    );
  }
});

test("SELECT, REFERENCES, and TRIGGER are never named in any REVOKE -- read access is preserved", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  for (const stmt of revokeStatements) {
    assert.equal(/\bSELECT\b/.test(stmt), false, `must not revoke SELECT: ${stmt}`);
    assert.equal(/\bREFERENCES\b/.test(stmt), false, `must not revoke REFERENCES: ${stmt}`);
    assert.equal(/\bTRIGGER\b/.test(stmt), false, `must not revoke TRIGGER: ${stmt}`);
  }
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

test("no table outside the three targeted tables is referenced", () => {
  const tableRefs = executableSql.match(/ON TABLE public\.(\w+)/g) || [];
  assert.equal(tableRefs.length, 3, "expected exactly three ON TABLE clauses");
  const normalized = tableRefs.map((ref) => ref.replace(/^ON TABLE public\./, ""));
  assert.deepEqual(
    new Set(normalized),
    new Set(["master_maps", "master_map_sites", "master_map_locations"]),
  );
});

test("event_map_settings is not referenced -- not part of this proven defect", () => {
  assert.equal(/event_map_settings/.test(executableSql), false);
});

test("no RLS policy is touched: no DROP POLICY, CREATE POLICY, or ALTER TABLE ... ROW LEVEL SECURITY statement", () => {
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ROW LEVEL SECURITY/.test(executableSql), false);
});

test("no other domain is touched: no announcements, vendor, agenda, or attendee table reference", () => {
  for (const forbidden of [
    "announcements",
    "vendors",
    "event_vendors",
    "vendor_event_status",
    "agenda_items",
    "attendees",
    "event_photos",
    "event_evaluations",
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
