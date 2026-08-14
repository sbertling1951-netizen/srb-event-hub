import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Vendors INSERT Authority Emergency
// Containment migration. This migration replaces exactly one RLS policy
// (vendors_insert_policy) with a version that adds an is_active_admin
// authority branch while preserving the existing non-empty-name check --
// its entire effect is provable from its SQL text. Live authorization
// proofs (ordinary authenticated non-admin denied, active admin allowed,
// register_vendor_self unaffected), pre/post equivalence of every other
// live public.vendors policy, and grant-state preservation were
// independently verified against the linked database as part of this
// change's validation and are reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814070000_close_vendors_insert_authority_gap.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814070000_close_vendors_insert_authority_gap.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("exactly one policy is dropped and recreated -- vendors_insert_policy only", () => {
  const drops = executableSql.match(/DROP POLICY[^;]*;/g) || [];
  const creates = executableSql.match(/CREATE POLICY[^;]*?\)\s*;/gs) || [];
  assert.equal(drops.length, 1);
  assert.match(drops[0], /DROP POLICY IF EXISTS vendors_insert_policy ON public\.vendors;/);
  assert.equal(creates.length, 1);
  assert.match(creates[0], /CREATE POLICY vendors_insert_policy/);
});

test("new policy is FOR INSERT, TO authenticated, same as before", () => {
  assert.match(executableSql, /CREATE POLICY vendors_insert_policy\s*\n\s*ON public\.vendors\s*\n\s*FOR INSERT\s*\n\s*TO authenticated/);
});

test("WITH CHECK requires is_active_admin(auth.uid()) AND the existing non-empty business/name condition", () => {
  assert.match(
    executableSql,
    /WITH CHECK \(\s*\n\s*public\.is_active_admin\(auth\.uid\(\)\)\s*\n\s*AND length\(trim\(coalesce\(business_name, name, ''\)\)\) > 0\s*\n\s*\);/,
  );
});

test("no other table, policy, function, or grant is referenced", () => {
  assert.equal(/\bvendors_update_policy\b/.test(executableSql), false);
  assert.equal(/\bvendors_select_policy\b/.test(executableSql), false);
  assert.equal(/Admins can manage vendors/.test(executableSql), false);
  assert.equal(/Members can view active vendors/.test(executableSql), false);
  assert.equal(/\bGRANT\b/.test(executableSql), false);
  assert.equal(/\bREVOKE\b/.test(executableSql), false);
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(executableSql), false);
  assert.equal(/DROP FUNCTION/.test(executableSql), false);
  const tableRefs = executableSql.match(/ON public\.(\w+)/g) || [];
  for (const ref of tableRefs) {
    assert.equal(ref, "ON public.vendors");
  }
});

test("no schema change, RLS enable/disable, or Lifecycle/task-authority construct is introduced", () => {
  assert.equal(/CREATE TABLE/.test(executableSql), false);
  assert.equal(/ALTER TABLE/.test(executableSql), false);
  assert.equal(/ROW LEVEL SECURITY/.test(executableSql), false);
  assert.equal(/can_manage_vendors/.test(executableSql), false);
  assert.equal(/resolve_task_authority/.test(executableSql), false);
  assert.equal(/has_platform_admin_authority/.test(executableSql), false);
  assert.equal(/has_tenant_admin_authority/.test(executableSql), false);
});

test("statement is wrapped in a single transaction", () => {
  assert.match(executableSql.trim(), /^BEGIN;/);
  assert.match(executableSql.trim(), /COMMIT;$/);
});
