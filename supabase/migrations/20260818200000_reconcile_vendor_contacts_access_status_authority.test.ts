import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural proof for the vendor_contacts / vendor_org_access /
// vendor_event_status Admin authority reconciliation. Same convention as
// 20260818190000_reconcile_agenda_items_admin_read_authority.test.ts and
// its siblings: no live-Postgres test harness exists in this environment
// (no Docker/local Supabase), so this file proves invariants by reading
// the migration's own SQL source. The live-database access-delta and
// caller-matrix claims this migration's header makes were separately
// verified against the linked project directly (Candidate #3 Vendor
// authority architecture/governance audit); this file proves the SQL
// text matches what that inspection concluded was safe, not the live
// database state itself. Run with:
//   npx tsx --test supabase/migrations/20260818200000_reconcile_vendor_contacts_access_status_authority.test.ts

const SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "./20260818200000_reconcile_vendor_contacts_access_status_authority.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const SOURCE_NO_COMMENTS = SOURCE.replace(/--.*$/gm, "");

function policyBlock(name: string): string {
  const idx = SOURCE.indexOf(`CREATE POLICY ${name}`);
  assert.ok(idx > -1, `expected to find CREATE POLICY ${name}`);
  const end = SOURCE.indexOf(";", idx);
  return SOURCE.slice(idx, end + 1);
}

// ---- 1. is_active_admin is fully retired from all three tables. ----

test("no is_active_admin reference remains anywhere in the migration", () => {
  assert.equal(/is_active_admin/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 2. vendor_contacts: catalog-wide authority, self-management branch untouched. ----

for (const name of [
  "vendor_contacts_insert_policy",
  "vendor_contacts_select_policy",
  "vendor_contacts_update_policy",
]) {
  test(`${name} uses has_my_vendor_catalog_admin_authority() and preserves the vendor_org_access self-management branch`, () => {
    const block = policyBlock(name);
    assert.match(block, /public\.has_my_vendor_catalog_admin_authority\(\)/);
    assert.match(
      block,
      /voa\.vendor_id = vendor_contacts\.vendor_id/,
    );
    assert.equal(/has_event_task_authority/.test(block), false);
  });
}

for (const name of ["vendor_contacts_insert_policy", "vendor_contacts_update_policy"]) {
  test(`${name} self-branch is restricted to access_role='vendor_admin'`, () => {
    const block = policyBlock(name);
    assert.match(block, /voa\.access_role = 'vendor_admin'/);
  });
}

test("vendor_contacts_select_policy self-branch has no access_role restriction", () => {
  const block = policyBlock("vendor_contacts_select_policy");
  assert.equal(/access_role/.test(block), false);
});

// ---- 3. vendor_org_access: catalog-wide authority, self-access branches untouched. ----

test("vendor_org_access_admin_insert_policy uses has_my_vendor_catalog_admin_authority() alone", () => {
  const block = policyBlock("vendor_org_access_admin_insert_policy");
  assert.match(
    block,
    /WITH CHECK \(public\.has_my_vendor_catalog_admin_authority\(\)\)/,
  );
});

test("vendor_org_access_select_policy preserves both self-access branches", () => {
  const block = policyBlock("vendor_org_access_select_policy");
  assert.match(block, /public\.has_my_vendor_catalog_admin_authority\(\)/);
  assert.match(block, /auth_user_id = auth\.uid\(\)/);
  assert.match(block, /public\.is_vendor_org_admin\(vendor_id, auth\.uid\(\)\)/);
});

test("vendor_org_access_admin_update_policy uses has_my_vendor_catalog_admin_authority() in USING and WITH CHECK, no self-branch added", () => {
  const block = policyBlock("vendor_org_access_admin_update_policy");
  const usingMatches = block.match(
    /public\.has_my_vendor_catalog_admin_authority\(\)/g,
  );
  assert.ok(usingMatches && usingMatches.length === 2);
  assert.equal(/auth_user_id/.test(block), false);
});

// ---- 4. vendor_event_status: Event-scoped canonical task authority. ----

for (const name of [
  "vendor_event_status_delete_policy",
  "vendor_event_status_insert_policy",
  "vendor_event_status_update_policy",
  "vendor_event_status_select_policy",
]) {
  test(`${name} uses has_event_task_authority('event.vendors.manage', event_id) against the row's own event_id`, () => {
    const block = policyBlock(name);
    assert.match(
      block,
      /public\.has_event_task_authority\('event\.vendors\.manage', event_id\)/,
    );
    assert.equal(/has_my_vendor_catalog_admin_authority/.test(block), false);
    assert.equal(/has_vendor_catalog_admin_authority/.test(block), false);
  });

  test(`${name} preserves the vendor self-service branch (active vendor_org_access, no access_role restriction)`, () => {
    const block = policyBlock(name);
    assert.match(block, /voa\.vendor_id = vendor_event_status\.vendor_id/);
    assert.match(block, /voa\.auth_user_id = auth\.uid\(\)/);
    assert.match(block, /voa\.status = 'active'/);
    assert.equal(/access_role/.test(block), false);
  });
}

test("vendor_event_status_select_policy preserves the event_vendors member-visibility branch verbatim", () => {
  const block = policyBlock("vendor_event_status_select_policy");
  assert.match(
    block,
    /ev\.vendor_id = vendor_event_status\.vendor_id/,
  );
  assert.match(block, /ev\.event_id = vendor_event_status\.event_id/);
  assert.match(block, /ev\.is_visible_to_members IS NOT FALSE/);
});

test("vendor_event_status_select_policy keys off event.vendors.manage specifically, never event.vendors.view", () => {
  assert.equal(
    /event\.vendors\.view/.test(SOURCE_NO_COMMENTS),
    false,
  );
});

// ---- 5. No inline legacy predicate logic remains anywhere. ----

test("no privilege_group, is_super_admin, admin_event_access, or platform/tenant helper is referenced inline", () => {
  assert.equal(/privilege_group/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/is_super_admin/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/admin_event_access/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(
    /has_platform_admin_authority|has_tenant_admin_authority/.test(
      SOURCE_NO_COMMENTS,
    ),
    false,
  );
});

// ---- 6. Pure RLS-policy predicate swap: no RPC, table, grant, or other table touched. ----

test("exactly ten CREATE POLICY statements (3 vendor_contacts + 3 vendor_org_access + 4 vendor_event_status)", () => {
  const creates = SOURCE_NO_COMMENTS.match(/CREATE POLICY \S+/g) || [];
  assert.equal(creates.length, 10);
});

test("every policy target is one of the three targeted tables", () => {
  const policyRefs = SOURCE_NO_COMMENTS.match(/\bON\s+public\.(\w+)/g) || [];
  const normalizedRefs = policyRefs.map((ref) => ref.replace(/\s+/g, " "));
  assert.ok(normalizedRefs.length > 0, "expected at least one policy target");
  const allowed = new Set([
    "ON public.vendor_contacts",
    "ON public.vendor_org_access",
    "ON public.vendor_event_status",
  ]);
  for (const ref of normalizedRefs) {
    assert.ok(allowed.has(ref), `unexpected policy target: ${ref}`);
  }
});

test("no CREATE/ALTER/DROP TABLE and no function definition is present", () => {
  assert.equal(/CREATE TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/ALTER TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/DROP TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(
    /CREATE OR REPLACE FUNCTION|CREATE FUNCTION/.test(SOURCE_NO_COMMENTS),
    false,
  );
});

test("no ACL (GRANT/REVOKE) statement is present -- this migration is a pure policy-predicate swap", () => {
  const aclStatements = SOURCE_NO_COMMENTS.match(/^(REVOKE|GRANT)\b.*$/gm) || [];
  assert.equal(aclStatements.length, 0);
});

test("every dropped policy name is recreated exactly once", () => {
  const dropped = [
    ...SOURCE_NO_COMMENTS.matchAll(/DROP POLICY IF EXISTS (\S+) ON/g),
  ].map((m) => m[1]);
  assert.equal(dropped.length, 10);
  for (const name of dropped) {
    const createCount = (
      SOURCE_NO_COMMENTS.match(
        new RegExp(`CREATE POLICY ${name}\\b`, "g"),
      ) || []
    ).length;
    assert.equal(createCount, 1, `expected exactly one CREATE POLICY ${name}`);
  }
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SOURCE, /^BEGIN;/m);
  assert.match(SOURCE, /^COMMIT;/m);
});
