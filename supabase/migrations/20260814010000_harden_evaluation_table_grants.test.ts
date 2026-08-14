import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Evaluations Grant Hardening
// migration. This is a grant-only migration -- no RLS policy, no RPC,
// no Lifecycle guard, no Authority task key -- so its entire effect is
// provable from its SQL text: which REVOKE statements exist, which
// tables/roles/privileges they name, and the absence of anything this
// pass was explicitly told not to add. Current live grant/policy state
// (pre-apply, unaffected by this unapplied migration) was independently
// verified by direct catalog query as part of this change's validation
// and is reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814010000_harden_evaluation_table_grants.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814010000_harden_evaluation_table_grants.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

const EVALUATION_TABLES = [
  "event_evaluations",
  "event_evaluation_answers",
  "evaluation_templates",
  "evaluation_questions",
  "evaluation_choices",
];

test("exactly five REVOKE statements exist, one per Evaluation table, and no other REVOKE/GRANT statement", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  assert.equal(revokeStatements.length, 5);
  assert.equal(/\bGRANT\b/.test(executableSql), false, "this migration must only remove privileges, never add one");
});

test("event_evaluations and event_evaluation_answers: only service_role loses mutation privileges -- anon/authenticated are not named", () => {
  for (const table of ["event_evaluations", "event_evaluation_answers"]) {
    const pattern = new RegExp(
      `REVOKE INSERT, UPDATE, DELETE, TRUNCATE\\s*\\nON TABLE public\\.${table}\\s*\\nFROM service_role;`,
    );
    assert.match(executableSql, pattern, `expected the exact service_role-only REVOKE for ${table}`);
  }
  const participantTableRevokes = executableSql.match(
    /REVOKE[^;]*ON TABLE public\.event_evaluations?[^;]*;|REVOKE[^;]*ON TABLE public\.event_evaluation_answers[^;]*;/g,
  ) || [];
  for (const stmt of participantTableRevokes) {
    assert.equal(/\banon\b/.test(stmt), false, "anon must not be named in a participant-table REVOKE -- it never had the privilege to begin with");
    assert.equal(/\bauthenticated\b/.test(stmt), false, "authenticated's required SELECT/INSERT/UPDATE must not be touched");
  }
});

test("the three config tables: anon, authenticated, and service_role all lose mutation privileges", () => {
  for (const table of ["evaluation_templates", "evaluation_questions", "evaluation_choices"]) {
    const pattern = new RegExp(
      `REVOKE INSERT, UPDATE, DELETE, TRUNCATE\\s*\\nON TABLE public\\.${table}\\s*\\nFROM anon, authenticated, service_role;`,
    );
    assert.match(executableSql, pattern, `expected the exact anon/authenticated/service_role REVOKE for ${table}`);
  }
});

test("SELECT, REFERENCES, and TRIGGER are never named -- only mutation privileges are touched", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  for (const stmt of revokeStatements) {
    assert.equal(/\bSELECT\b/.test(stmt), false, `must not revoke SELECT: ${stmt}`);
    assert.equal(/\bREFERENCES\b/.test(stmt), false, `must not revoke REFERENCES: ${stmt}`);
    assert.equal(/\bTRIGGER\b/.test(stmt), false, `must not revoke TRIGGER: ${stmt}`);
  }
});

test("no RLS policy is touched: no DROP POLICY, CREATE POLICY, or ALTER TABLE ... ROW LEVEL SECURITY statement", () => {
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ROW LEVEL SECURITY/.test(executableSql), false);
});

test("no Lifecycle guard, Authority task key, or RPC is introduced", () => {
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(executableSql), false);
  assert.equal(/assert_event_lifecycle_mutable/.test(executableSql), false);
  assert.equal(/has_event_task_authority/.test(executableSql), false);
  assert.equal(/admin_task_registry/.test(executableSql), false);
  assert.equal(/event\.evaluations\./.test(executableSql), false);
});

test("no table outside the five Evaluation tables is referenced", () => {
  const tableRefs = executableSql.match(/ON TABLE public\.(\w+)/g) || [];
  assert.equal(tableRefs.length, 5, "expected exactly five ON TABLE clauses");
  for (const ref of tableRefs) {
    const name = ref.replace("ON TABLE public.", "");
    assert.ok(EVALUATION_TABLES.includes(name), `unexpected table referenced: ${name}`);
  }
});

test("no other domain is touched: no Agenda/Photo/Presentation/Event Staff/Announcements table reference", () => {
  for (const forbidden of [
    "agenda_items",
    "event_photos",
    "presentation_decks",
    "admin_event_access",
    "announcements",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this repair`,
    );
  }
});
