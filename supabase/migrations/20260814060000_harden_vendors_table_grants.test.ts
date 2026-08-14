import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Vendors Grant Hardening
// migration. This is a grant-only migration -- no RLS policy, no RPC
// body, no schema change -- so its entire effect is provable from its
// SQL text. Current live grant state (pre-apply, unaffected by this
// unapplied migration) and the zero-consumer findings for anon/
// authenticated DELETE/TRUNCATE and service_role INSERT/UPDATE/DELETE/
// TRUNCATE were independently verified by direct catalog query and
// repository-wide grep as part of this change's validation and are
// reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814060000_harden_vendors_table_grants.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814060000_harden_vendors_table_grants.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("no GRANT statement exists -- this migration only removes privileges", () => {
  assert.equal(/\bGRANT\b/.test(executableSql), false);
});

test("exactly three REVOKE statements total, all on public.vendors", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  assert.equal(revokeStatements.length, 3);
  for (const stmt of revokeStatements) {
    assert.match(stmt, /ON TABLE public\.vendors/);
  }
});

test("anon loses INSERT, UPDATE, DELETE, TRUNCATE only", () => {
  assert.match(
    executableSql,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE\s*\nON TABLE public\.vendors\s*\nFROM anon;/,
  );
});

test("authenticated loses DELETE, TRUNCATE only -- SELECT/INSERT/UPDATE are not touched", () => {
  assert.match(
    executableSql,
    /REVOKE DELETE, TRUNCATE\s*\nON TABLE public\.vendors\s*\nFROM authenticated;/,
  );
  const authenticatedRevokes = executableSql.match(/REVOKE[^;]*FROM authenticated;/g) || [];
  assert.equal(authenticatedRevokes.length, 1, "expected exactly one REVOKE naming authenticated");
  assert.equal(/\bINSERT\b/.test(authenticatedRevokes[0]), false, "authenticated's required INSERT must not be touched");
  assert.equal(/\bUPDATE\b/.test(authenticatedRevokes[0]), false, "authenticated's required UPDATE must not be touched");
  assert.equal(/\bSELECT\b/.test(authenticatedRevokes[0]), false, "SELECT must not be touched");
});

test("service_role loses INSERT, UPDATE, DELETE, TRUNCATE only -- SELECT is not touched", () => {
  assert.match(
    executableSql,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE\s*\nON TABLE public\.vendors\s*\nFROM service_role;/,
  );
  const serviceRoleRevokes = executableSql.match(/REVOKE[^;]*FROM service_role;/g) || [];
  assert.equal(serviceRoleRevokes.length, 1, "expected exactly one REVOKE naming service_role");
  assert.equal(/\bSELECT\b/.test(serviceRoleRevokes[0]), false, "service_role's required SELECT must not be touched");
});

test("anon is never named alongside authenticated or service_role in the same REVOKE -- each role's statement is independent", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  for (const stmt of revokeStatements) {
    const namedRoles = ["anon", "authenticated", "service_role"].filter((role) =>
      new RegExp(`\\b${role}\\b`).test(stmt),
    );
    assert.equal(namedRoles.length, 1, `expected exactly one role per REVOKE statement, got: ${stmt}`);
  }
});

test("SELECT, REFERENCES, TRIGGER, and MAINTAIN are never named -- only mutation privileges are touched", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  for (const stmt of revokeStatements) {
    assert.equal(/\bSELECT\b/.test(stmt), false, `must not revoke SELECT: ${stmt}`);
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

test("no helper/RPC or schema change is introduced", () => {
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(executableSql), false);
  assert.equal(/DROP FUNCTION/.test(executableSql), false);
  assert.equal(/CREATE TABLE/.test(executableSql), false);
  assert.equal(/ALTER TABLE/.test(executableSql), false);
  assert.equal(/DROP TABLE/.test(executableSql), false);
});

test("no Lifecycle guard or Authority task key is introduced", () => {
  assert.equal(/assert_event_lifecycle_mutable/.test(executableSql), false);
  assert.equal(/has_event_task_authority/.test(executableSql), false);
  assert.equal(/admin_task_registry/.test(executableSql), false);
});

test("no table outside public.vendors is referenced", () => {
  const tableRefs = executableSql.match(/ON TABLE public\.(\w+)/g) || [];
  assert.equal(tableRefs.length, 3, "expected exactly three ON TABLE clauses");
  for (const ref of tableRefs) {
    assert.equal(ref, "ON TABLE public.vendors");
  }
});

test("no other domain is touched: no Agenda/Photo/Presentation/Announcements/Evaluation/Parking table reference", () => {
  for (const forbidden of [
    "agenda_items",
    "event_photos",
    "presentation_decks",
    "announcements",
    "event_evaluations",
    "parking_sites",
    "event_map_settings",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this repair`,
    );
  }
});
