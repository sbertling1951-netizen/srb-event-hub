import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Vendor Admission Lifecycle Stage 3
// migration. This migration drops two RLS policies, replaces one, and
// revokes four table privileges -- its entire shape is provable from its
// SQL text. Live pre/post state (policy content, grant matrix,
// authority resolution, application-code call sites) was independently
// verified against the linked database and repository as part of this
// change's validation and is reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814140000_retire_event_vendors_direct_write_bypass.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814140000_retire_event_vendors_direct_write_bypass.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("statement is wrapped in a single transaction", () => {
  assert.match(executableSql.trim(), /^BEGIN;/);
  assert.match(executableSql.trim(), /COMMIT;$/);
});

test("the undocumented permissive admin-write policy is dropped and never recreated", () => {
  assert.match(executableSql, /DROP POLICY IF EXISTS "Admins can manage event vendors" ON public\.event_vendors;/);
  assert.equal(/CREATE POLICY "Admins can manage event vendors"/.test(executableSql), false);
});

test("the tracked broad admin-write policy is dropped and never recreated -- no replacement direct-write policy of any kind is added", () => {
  assert.match(executableSql, /DROP POLICY IF EXISTS event_vendors_admin_write_policy ON public\.event_vendors;/);
  assert.equal(/CREATE POLICY event_vendors_admin_write_policy/.test(executableSql), false);
  // No new INSERT/UPDATE/DELETE/ALL policy is created at all -- mutation is RPC-only.
  const creates = executableSql.match(/CREATE POLICY[\s\S]*?;/g) || [];
  assert.equal(creates.length, 1, "expected exactly one CREATE POLICY statement (the reconciled SELECT policy)");
  assert.match(creates[0], /FOR SELECT/);
});

test("is_active_admin no longer appears anywhere in this migration -- the admin SELECT branch is fully replaced", () => {
  assert.equal(/is_active_admin/.test(executableSql), false);
});

test("event_vendors_select_policy is reconciled to has_event_task_authority('event.vendors.view', ...), preserving the other two branches verbatim", () => {
  assert.match(executableSql, /DROP POLICY IF EXISTS event_vendors_select_policy ON public\.event_vendors;/);
  assert.match(
    executableSql,
    /CREATE POLICY event_vendors_select_policy[\s\S]*?FOR SELECT[\s\S]*?TO authenticated[\s\S]*?USING \(\s*\n\s*public\.has_event_task_authority\('event\.vendors\.view', event_vendors\.event_id\)/,
  );
  assert.match(executableSql, /voa\.vendor_id = event_vendors\.vendor_id/);
  assert.match(executableSql, /voa\.status = 'active'/);
  assert.match(executableSql, /is_visible_to_members IS NOT FALSE/);
});

test("\"Members can view visible event vendors\" is never referenced -- left completely unchanged", () => {
  assert.equal(/Members can view visible event vendors/.test(executableSql), false);
});

test("grants: INSERT/UPDATE/DELETE/TRUNCATE revoked from anon, authenticated, and service_role together; SELECT/REFERENCES/TRIGGER untouched", () => {
  assert.match(
    executableSql,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE\s*\nON TABLE public\.event_vendors\s*\nFROM anon, authenticated, service_role;/,
  );
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  assert.equal(revokeStatements.length, 1);
  assert.equal(/\bSELECT\b/.test(revokeStatements[0]), false);
  assert.equal(/\bREFERENCES\b/.test(revokeStatements[0]), false);
  assert.equal(/\bTRIGGER\b/.test(revokeStatements[0]), false);
});

test("no GRANT statement exists, no schema change, no other table is touched", () => {
  assert.equal(/\bGRANT\b/.test(executableSql), false);
  assert.equal(/CREATE TABLE|ALTER TABLE|DROP TABLE/.test(executableSql), false);
  const tableRefs = executableSql.match(/ON (?:TABLE )?public\.(\w+)/g) || [];
  for (const ref of tableRefs) {
    assert.match(ref, /public\.event_vendors$/);
  }
});
