import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Vendor Admission Lifecycle Stage 1
// least-privilege closeout migration. Grant-only -- no RLS policy, no
// RPC, no schema change -- so its entire effect is provable from its SQL
// text. The dependency evidence (zero application-code reference, zero
// non-Stage-1 FK into these tables) was gathered by direct repository
// grep before this migration was written and is reported separately,
// not re-asserted here. Live pre/post ACL state was independently
// verified against the linked database as part of this change's
// validation.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814110000_minimize_vendor_admission_lifecycle_table_grants.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814110000_minimize_vendor_admission_lifecycle_table_grants.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

const TABLES = ["vendor_disposition_reason_codes", "vendor_event_applications", "vendor_event_dispositions"];

test("no GRANT statement exists -- this migration only removes privileges", () => {
  assert.equal(/\bGRANT\b/.test(executableSql), false);
});

test("exactly three REVOKE statements, one per Stage 1 table", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  assert.equal(revokeStatements.length, 3);
});

for (const table of TABLES) {
  test(`${table}: REFERENCES and TRIGGER revoked from anon, authenticated, and service_role together`, () => {
    assert.match(
      executableSql,
      new RegExp(`REVOKE REFERENCES, TRIGGER\\s*\\nON TABLE public\\.${table}\\s*\\nFROM anon, authenticated, service_role;`),
    );
  });
}

test("SELECT, INSERT, UPDATE, DELETE, and TRUNCATE are never named -- only REFERENCES/TRIGGER are touched", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  for (const stmt of revokeStatements) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      assert.equal(new RegExp(`\\b${privilege}\\b`).test(stmt), false, `must not revoke ${privilege}: ${stmt}`);
    }
  }
});

test("no RLS policy, schema, or function is touched", () => {
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ROW LEVEL SECURITY/.test(executableSql), false);
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(executableSql), false);
  assert.equal(/CREATE TABLE/.test(executableSql), false);
  assert.equal(/ALTER TABLE/.test(executableSql), false);
});

test("no other table is referenced beyond the three Stage 1 lifecycle tables", () => {
  const tableRefs = executableSql.match(/ON TABLE public\.(\w+)/g) || [];
  assert.equal(tableRefs.length, 3);
  for (const ref of tableRefs) {
    const name = ref.replace("ON TABLE public.", "");
    assert.ok(TABLES.includes(name), `unexpected table referenced: ${name}`);
  }
});

test("statement is wrapped in a single transaction", () => {
  assert.match(executableSql.trim(), /^BEGIN;/);
  assert.match(executableSql.trim(), /COMMIT;$/);
});
