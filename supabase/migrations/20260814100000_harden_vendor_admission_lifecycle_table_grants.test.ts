import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Vendor Admission Lifecycle Stage 1
// grant-correction migration. This is a grant-only migration -- no RLS
// policy, no RPC body, no schema change -- so its entire effect is
// provable from its SQL text. Current live grant state (pre-apply,
// unaffected by this unapplied migration) was independently verified by
// direct catalog query as part of this change's validation and is
// reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814100000_harden_vendor_admission_lifecycle_table_grants.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814100000_harden_vendor_admission_lifecycle_table_grants.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

const TABLES = ["vendor_disposition_reason_codes", "vendor_event_applications", "vendor_event_dispositions"];

test("no GRANT statement exists -- this migration only removes privileges", () => {
  assert.equal(/\bGRANT\b/.test(executableSql), false);
});

test("exactly nine REVOKE statements, three per new table", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  assert.equal(revokeStatements.length, 9);
});

for (const table of TABLES) {
  test(`${table}: anon loses everything (SELECT/INSERT/UPDATE/DELETE/TRUNCATE)`, () => {
    assert.match(
      executableSql,
      new RegExp(`REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE\\s*\\nON TABLE public\\.${table}\\s*\\nFROM anon;`),
    );
  });

  test(`${table}: authenticated loses only INSERT/UPDATE/DELETE/TRUNCATE -- SELECT is preserved`, () => {
    assert.match(
      executableSql,
      new RegExp(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE\\s*\\nON TABLE public\\.${table}\\s*\\nFROM authenticated;`),
    );
    const authenticatedRevokes = executableSql.match(
      new RegExp(`REVOKE[^;]*ON TABLE public\\.${table}[^;]*FROM authenticated;`, "g"),
    ) || [];
    assert.equal(authenticatedRevokes.length, 1);
    assert.equal(/\bSELECT\b/.test(authenticatedRevokes[0]), false, "authenticated's required SELECT must not be touched");
  });

  test(`${table}: service_role loses everything -- no live consumer yet, future RPCs are SECURITY DEFINER`, () => {
    assert.match(
      executableSql,
      new RegExp(`REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE\\s*\\nON TABLE public\\.${table}\\s*\\nFROM service_role;`),
    );
  });
}

test("REFERENCES and TRIGGER are never named -- only mutation/SELECT privileges are touched, matching established precedent", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  for (const stmt of revokeStatements) {
    assert.equal(/\bREFERENCES\b/.test(stmt), false, `must not revoke REFERENCES: ${stmt}`);
    assert.equal(/\bTRIGGER\b/.test(stmt), false, `must not revoke TRIGGER: ${stmt}`);
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

test("no other table is referenced beyond the three new lifecycle tables", () => {
  const tableRefs = executableSql.match(/ON TABLE public\.(\w+)/g) || [];
  assert.equal(tableRefs.length, 9, "expected exactly nine ON TABLE clauses");
  for (const ref of tableRefs) {
    const name = ref.replace("ON TABLE public.", "");
    assert.ok(TABLES.includes(name), `unexpected table referenced: ${name}`);
  }
});

test("statement is wrapped in a single transaction", () => {
  assert.match(executableSql.trim(), /^BEGIN;/);
  assert.match(executableSql.trim(), /COMMIT;$/);
});
