import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Vendor Contacts / Vendor Org
// Access / Vendor Event Status anon Grant Hygiene migration. This is a
// grant-only migration -- no RLS policy, no RPC body, no schema change --
// so its entire effect is provable from its SQL text. The live grant
// matrix, the anon-consumer audit (including the Temporary Event Access
// browser-anon-role finding), and the SECURITY DEFINER dependency check
// were independently verified against the linked project and by
// repository-wide grep as part of this change's validation, and are
// reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260818210000_harden_vendor_contacts_access_status_anon_grants.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260818210000_harden_vendor_contacts_access_status_anon_grants.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

const TARGET_TABLES = [
  "vendor_contacts",
  "vendor_org_access",
  "vendor_event_status",
];

test("no GRANT statement exists -- this migration only removes privileges", () => {
  assert.equal(/\bGRANT\b/.test(executableSql), false);
});

test("exactly three REVOKE statements total, one per targeted table", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  assert.equal(revokeStatements.length, 3);
});

for (const table of TARGET_TABLES) {
  test(`${table}: anon loses SELECT, INSERT, UPDATE, DELETE, TRUNCATE only`, () => {
    assert.match(
      executableSql,
      new RegExp(
        `REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE\\s*\\nON TABLE public\\.${table}\\s*\\nFROM anon;`,
      ),
    );
  });
}

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

test("no table outside the three targeted vendor tables is referenced", () => {
  const tableRefs = executableSql.match(/ON TABLE public\.(\w+)/g) || [];
  assert.equal(tableRefs.length, 3, "expected exactly three ON TABLE clauses");
  const normalized = tableRefs.map((ref) => ref.replace(/^ON TABLE public\./, ""));
  assert.deepEqual(new Set(normalized), new Set(TARGET_TABLES));
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
  assert.equal(/has_my_vendor_catalog_admin_authority/.test(executableSql), false);
  assert.equal(/admin_task_registry/.test(executableSql), false);
});

test("Candidate #3's Admin-authority predicates are not re-touched by this migration", () => {
  assert.equal(/is_active_admin/.test(executableSql), false);
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
    "vendors",
    "vendor_service_requests",
    "event_vendors",
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
