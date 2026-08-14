import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Vendor Catalog Authority Canonical
// Reconciliation migration. This migration creates one narrowly-scoped
// SQL helper and replaces three RLS policies -- its entire shape is
// provable from its SQL text. Live authority proofs (non-admin denied,
// checkin denied by default, event_admin allowed by default, override
// rows correctly flipping both directions, super_admin unconditional,
// vendor-self branch preserved, empty-name still denied once the old ALL
// policy is gone, "Members can view active vendors" and grants unchanged)
// were independently verified against the linked database inside
// rollback-contained transactions with zero residue, and are reported
// separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814080000_reconcile_vendors_catalog_authority.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814080000_reconcile_vendors_catalog_authority.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("creates exactly one function: has_vendor_catalog_admin_authority(uuid)", () => {
  const creates = executableSql.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g) || [];
  assert.equal(creates.length, 1);
  assert.match(creates[0], /CREATE OR REPLACE FUNCTION public\.has_vendor_catalog_admin_authority\(_uid uuid\)/);
});

test("the helper is SECURITY DEFINER (required: admin_privilege_group_permissions RLS is super_admin-only)", () => {
  const fnMatch = executableSql.match(/CREATE OR REPLACE FUNCTION public\.has_vendor_catalog_admin_authority[\s\S]*?\$\$;/);
  assert.ok(fnMatch, "function definition not found");
  assert.match(fnMatch[0], /SECURITY DEFINER/);
});

test("the helper checks super_admin unconditionally before any override lookup", () => {
  const fnMatch = executableSql.match(/CREATE OR REPLACE FUNCTION public\.has_vendor_catalog_admin_authority[\s\S]*?\$\$;/)[0];
  const superAdminIdx = fnMatch.indexOf("v_privilege_group = 'super_admin'");
  const overrideIdx = fnMatch.indexOf("admin_privilege_group_permissions");
  assert.ok(superAdminIdx > -1, "super_admin branch not found");
  assert.ok(overrideIdx > -1, "override lookup not found");
  assert.ok(superAdminIdx < overrideIdx, "super_admin bypass must be checked before the override lookup");
});

test("the helper reads only the can_manage_vendors permission_key -- no other key, no full preset table", () => {
  const fnMatch = executableSql.match(/CREATE OR REPLACE FUNCTION public\.has_vendor_catalog_admin_authority[\s\S]*?\$\$;/)[0];
  assert.match(fnMatch, /permission_key = 'can_manage_vendors'/);
  const permissionKeyLiterals = fnMatch.match(/permission_key = '([^']*)'/g) || [];
  assert.equal(permissionKeyLiterals.length, 1, "expected exactly one permission_key comparison");
});

test("the helper defaults to event_admin=true, everything else false, when no override row exists", () => {
  const fnMatch = executableSql.match(/CREATE OR REPLACE FUNCTION public\.has_vendor_catalog_admin_authority[\s\S]*?\$\$;/)[0];
  assert.match(fnMatch, /RETURN v_privilege_group = 'event_admin';/);
});

test("EXECUTE is granted to authenticated only, revoked from PUBLIC and anon", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.has_vendor_catalog_admin_authority\(uuid\)\s+FROM PUBLIC;/,
  );
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.has_vendor_catalog_admin_authority\(uuid\)\s+FROM anon;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.has_vendor_catalog_admin_authority\(uuid\)\s+TO authenticated;/,
  );
});

test("\"Admins can manage vendors\" is dropped and never recreated", () => {
  const drops = executableSql.match(/DROP POLICY[^;]*"Admins can manage vendors"[^;]*;/g) || [];
  assert.equal(drops.length, 1);
  assert.equal(/CREATE POLICY "Admins can manage vendors"/.test(executableSql), false);
});

test("vendors_insert_policy is dropped and recreated using the new helper AND the unchanged non-empty-name check", () => {
  assert.match(executableSql, /DROP POLICY IF EXISTS vendors_insert_policy ON public\.vendors;/);
  assert.match(
    executableSql,
    /CREATE POLICY vendors_insert_policy[\s\S]*?FOR INSERT[\s\S]*?TO authenticated[\s\S]*?WITH CHECK \(\s*\n\s*public\.has_vendor_catalog_admin_authority\(auth\.uid\(\)\)\s*\n\s*AND length\(trim\(coalesce\(business_name, name, ''\)\)\) > 0\s*\n\s*\);/,
  );
  assert.equal(/is_active_admin/.test(executableSql), false, "the interim is_active_admin branch must be fully replaced, not left alongside the new helper");
});

test("vendors_update_policy is dropped and recreated with the new helper OR the unchanged vendor-self-management branch, in both USING and WITH CHECK", () => {
  assert.match(executableSql, /DROP POLICY IF EXISTS vendors_update_policy ON public\.vendors;/);
  const updateBlockMatch = executableSql.match(
    /CREATE POLICY vendors_update_policy[\s\S]*?(?=DROP POLICY IF EXISTS vendors_select_policy)/,
  );
  assert.ok(updateBlockMatch, "vendors_update_policy CREATE block not found");
  const block = updateBlockMatch[0];
  assert.match(block, /FOR UPDATE/);
  assert.match(block, /access_role = 'vendor_admin'/);
  const helperCount = (block.match(/has_vendor_catalog_admin_authority\(auth\.uid\(\)\)/g) || []).length;
  assert.equal(helperCount, 2, "expected the helper in both USING and WITH CHECK");
});

test("vendors_select_policy is dropped and recreated with the new helper OR the unchanged own-vendor_org_access and event_vendors-visibility branches", () => {
  assert.match(executableSql, /DROP POLICY IF EXISTS vendors_select_policy ON public\.vendors;/);
  const selectBlockMatch = executableSql.match(
    /CREATE POLICY vendors_select_policy[\s\S]*?(?=COMMIT;)/,
  );
  assert.ok(selectBlockMatch, "vendors_select_policy CREATE block not found");
  const block = selectBlockMatch[0];
  assert.match(block, /FOR SELECT/);
  assert.match(block, /has_vendor_catalog_admin_authority\(auth\.uid\(\)\)/);
  assert.match(block, /voa\.status = 'active'/);
  assert.match(block, /ev\.is_visible_to_members IS NOT FALSE/);
});

test("\"Members can view active vendors\" is never referenced -- left completely unchanged", () => {
  assert.equal(/Members can view active vendors/.test(executableSql), false);
});

test("no DELETE policy is created, no table grant is touched", () => {
  assert.equal(/FOR DELETE/.test(executableSql), false);
  assert.equal(/vendors_delete_policy/.test(executableSql), false);
  assert.equal(/GRANT (SELECT|INSERT|UPDATE|DELETE|TRUNCATE).*ON TABLE public\.vendors/.test(executableSql), false);
  assert.equal(/REVOKE.*ON TABLE public\.vendors/.test(executableSql), false);
});

test("no other table's RLS, grants, or schema is touched", () => {
  const policyRefs = executableSql.match(/\bON\s+public\.(\w+)/g) || [];
  const normalizedRefs = policyRefs.map((ref) => ref.replace(/\s+/g, " "));
  assert.ok(normalizedRefs.length > 0, "expected at least one policy target");
  for (const ref of normalizedRefs) {
    assert.equal(ref, "ON public.vendors", `unexpected policy target: ${ref}`);
  }
  assert.equal(/CREATE TABLE/.test(executableSql), false);
  assert.equal(/ALTER TABLE/.test(executableSql), false);
  assert.equal(/DROP TABLE/.test(executableSql), false);
});

test("statement is wrapped in a single transaction", () => {
  assert.match(executableSql.trim(), /^BEGIN;/);
  assert.match(executableSql.trim(), /COMMIT;$/);
});
