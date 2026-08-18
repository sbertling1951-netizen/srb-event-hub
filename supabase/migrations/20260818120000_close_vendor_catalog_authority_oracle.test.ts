import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural proof for closing the Vendor Catalog arbitrary-uid
// authority oracle. This repository has no live-Postgres test harness
// for any migration (no Docker/local Supabase in this environment) --
// every sibling migration test proves invariants by reading the
// migration's own SQL source and asserting the required properties are
// structurally present, exactly as
// 20260814080000_reconcile_vendors_catalog_authority.test.ts and
// 20260818110000_create_self_scoped_vendor_catalog_admin_authority.test.ts
// already do. Run with:
//   npx tsx --test supabase/migrations/20260818120000_close_vendor_catalog_authority_oracle.test.ts

const SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "./20260818120000_close_vendor_catalog_authority_oracle.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

// Strips -- line comments so the header's own explanatory prose (which
// necessarily names the old has_vendor_catalog_admin_authority(auth.uid())
// call shape it replaces) doesn't trip a check for actual SQL statements.
const SOURCE_NO_COMMENTS = SOURCE.replace(/--.*$/gm, "");

// ---- 1. authenticated cannot directly invoke the arbitrary-uid helper after hardening. ----

test("authenticated's EXECUTE on the arbitrary-uid function is explicitly revoked", () => {
  assert.match(
    SOURCE,
    /REVOKE EXECUTE ON FUNCTION public\.has_vendor_catalog_admin_authority\(uuid\)\s*\nFROM authenticated;/,
  );
});

test("no service_role grant is added -- no proven server-side caller requires one", () => {
  assert.equal(/GRANT.*TO service_role/.test(SOURCE_NO_COMMENTS), false);
});

test("no grant to authenticated (or any role) is (re)added for the arbitrary-uid function -- only the revoke appears", () => {
  const grants = SOURCE_NO_COMMENTS.match(
    /GRANT[^;]*has_vendor_catalog_admin_authority[^;]*;/g,
  ) || [];
  assert.equal(grants.length, 0);
});

// ---- 2. authenticated can still invoke has_my_vendor_catalog_admin_authority(). ----

test("the self-scoped wrapper's own grant is untouched by this migration -- no REVOKE/GRANT ACL statement targets it here (it is only ever called, in policy bodies, never re-granted)", () => {
  const aclStatements = SOURCE_NO_COMMENTS.match(/^(REVOKE|GRANT)\b.*$/gm) || [];
  for (const statement of aclStatements) {
    assert.equal(
      /has_my_vendor_catalog_admin_authority/.test(statement),
      false,
      `unexpected ACL statement touching the wrapper's own grant: ${statement}`,
    );
  }
});

// ---- 3 & 4. Vendor Catalog RLS still uses canonical authority, self-scoped semantics equivalent to the old auth.uid() call. ----

test("vendors_insert_policy is dropped and recreated using the self-scoped wrapper, with the unchanged non-empty-name check", () => {
  assert.match(SOURCE, /DROP POLICY IF EXISTS vendors_insert_policy ON public\.vendors;/);
  assert.match(
    SOURCE,
    /CREATE POLICY vendors_insert_policy[\s\S]*?FOR INSERT[\s\S]*?TO authenticated[\s\S]*?WITH CHECK \(\s*\n\s*public\.has_my_vendor_catalog_admin_authority\(\)\s*\n\s*AND length\(trim\(coalesce\(business_name, name, ''\)\)\) > 0\s*\n\s*\);/,
  );
});

test("vendors_update_policy is dropped and recreated with the self-scoped wrapper OR the unchanged vendor-self-management branch, in both USING and WITH CHECK", () => {
  assert.match(SOURCE, /DROP POLICY IF EXISTS vendors_update_policy ON public\.vendors;/);
  const updateBlockMatch = SOURCE.match(
    /CREATE POLICY vendors_update_policy[\s\S]*?(?=DROP POLICY IF EXISTS vendors_select_policy)/,
  );
  assert.ok(updateBlockMatch, "vendors_update_policy CREATE block not found");
  const block = updateBlockMatch[0];
  assert.match(block, /FOR UPDATE/);
  assert.match(block, /access_role = 'vendor_admin'/);
  const helperCount = (block.match(/public\.has_my_vendor_catalog_admin_authority\(\)/g) || []).length;
  assert.equal(helperCount, 2, "expected the self-scoped wrapper in both USING and WITH CHECK");
  assert.equal(/has_vendor_catalog_admin_authority\(auth\.uid\(\)\)/.test(block), false);
});

test("vendors_select_policy is dropped and recreated with the self-scoped wrapper OR the unchanged own-vendor_org_access and event_vendors-visibility branches", () => {
  assert.match(SOURCE, /DROP POLICY IF EXISTS vendors_select_policy ON public\.vendors;/);
  const selectBlockMatch = SOURCE.match(
    /CREATE POLICY vendors_select_policy[\s\S]*?(?=-- =+\n-- Close the arbitrary-uid oracle)/,
  );
  assert.ok(selectBlockMatch, "vendors_select_policy CREATE block not found");
  const block = selectBlockMatch[0];
  assert.match(block, /FOR SELECT/);
  assert.match(block, /public\.has_my_vendor_catalog_admin_authority\(\)/);
  assert.match(block, /voa\.status = 'active'/);
  assert.match(block, /ev\.is_visible_to_members IS NOT FALSE/);
  assert.equal(/has_vendor_catalog_admin_authority\(auth\.uid\(\)\)/.test(block), false);
});

test("the arbitrary-uid call shape (auth.uid() as an argument) no longer appears in any policy definition -- every RLS call site now uses the zero-argument wrapper", () => {
  const policyText = SOURCE.slice(
    SOURCE.indexOf("CREATE POLICY vendors_insert_policy"),
    SOURCE.indexOf("REVOKE EXECUTE"),
  );
  assert.equal(/has_vendor_catalog_admin_authority\(/.test(policyText), false);
});

// ---- 5 & 6. super_admin / event_admin / override behavior unchanged (delegated, not reimplemented). ----

test("has_vendor_catalog_admin_authority(uuid) itself is never redefined, reimplemented, or altered -- semantics (super_admin/event_admin/override) are untouched, only its direct reachability changes", () => {
  assert.equal(
    /CREATE OR REPLACE FUNCTION public\.has_vendor_catalog_admin_authority\(/.test(
      SOURCE_NO_COMMENTS,
    ),
    false,
  );
  assert.equal(/DROP FUNCTION/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/privilege_group/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/admin_privilege_group_permissions/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 7. unauthorized admins remain denied -- no widening anywhere. ----

test("no OR-widening is introduced into any of the three policies -- exactly the same number of authority branches as before, just with the authority call swapped", () => {
  const insertBlock = SOURCE.match(
    /CREATE POLICY vendors_insert_policy[\s\S]*?(?=DROP POLICY IF EXISTS vendors_update_policy)/,
  )![0];
  assert.equal((insertBlock.match(/public\.has_my_vendor_catalog_admin_authority\(\)/g) || []).length, 1);
  assert.equal((insertBlock.match(/ OR /g) || []).length, 0);
});

// ---- 8. no policy falls back to is_active_admin or legacy can_manage_vendors. ----

test("no policy falls back to is_active_admin or the legacy can_manage_vendors permission key", () => {
  assert.equal(/is_active_admin/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/can_manage_vendors/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 9. no broad grants are introduced. ----

test("no table grant, no PUBLIC/anon grant, no DELETE policy is introduced -- only the one targeted REVOKE plus the three unchanged-shape policy recreations", () => {
  assert.equal(/GRANT.*ON TABLE public\.vendors/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/TO PUBLIC/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/TO anon/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/FOR DELETE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/vendors_delete_policy/.test(SOURCE_NO_COMMENTS), false);
});

test("no other table's RLS, grants, or schema is touched -- every policy target is public.vendors", () => {
  const policyRefs = SOURCE_NO_COMMENTS.match(/\bON\s+public\.(\w+)/g) || [];
  const normalizedRefs = policyRefs.map((ref) => ref.replace(/\s+/g, " "));
  assert.ok(normalizedRefs.length > 0, "expected at least one policy target");
  for (const ref of normalizedRefs) {
    assert.equal(ref, "ON public.vendors", `unexpected policy target: ${ref}`);
  }
  assert.equal(/CREATE TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/ALTER TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/DROP TABLE/.test(SOURCE_NO_COMMENTS), false);
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SOURCE, /^BEGIN;/m);
  assert.match(SOURCE, /^COMMIT;/m);
});

test("no \"Admins can manage vendors\" bypass policy is reintroduced", () => {
  assert.equal(/Admins can manage vendors/.test(SOURCE_NO_COMMENTS), false);
});
