import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural proof for the Self-Scoped Tenant Administration Read
// Surface migration. This repository has no live-Postgres test harness
// for any migration (no Docker/local Supabase in this environment) --
// every sibling migration test proves invariants by reading the
// migration's own SQL source and asserting the required properties are
// structurally present, exactly as this file does. Run with:
//   npx tsx --test supabase/migrations/20260818100000_create_self_scoped_tenant_admin_access_list.test.ts

const SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "./20260818100000_create_self_scoped_tenant_admin_access_list.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

// Strips -- line comments before checking for a code-level reference, so
// the header's own explanatory prose doesn't trip a check for actual SQL
// statements.
const SOURCE_NO_COMMENTS = SOURCE.replace(/--.*$/gm, "");

const FUNCTION_START = "CREATE OR REPLACE FUNCTION public.list_my_tenant_admin_access()";

test("the function is genuinely self-scoped: zero parameters, no uid argument through which a caller could probe another admin's assignments", () => {
  assert.match(
    SOURCE,
    /CREATE OR REPLACE FUNCTION public\.list_my_tenant_admin_access\(\)/,
    "expected a zero-argument function signature",
  );
  assert.equal(
    /list_my_tenant_admin_access\([^)]+\)/.test(SOURCE_NO_COMMENTS),
    false,
    "found a parameterized overload -- the function must take no arguments",
  );
});

test("the caller is derived exclusively from auth.uid(), never from a parameter", () => {
  const fn = SOURCE.slice(SOURCE.indexOf(FUNCTION_START));
  assert.match(fn, /v_uid := auth\.uid\(\);/);
  assert.equal(/p_auth_user_id|p_uid|p_user_id|p_admin_id|p_tenant_id/.test(fn), false);
});

test("a null caller (anonymous/unauthenticated) returns zero rows, checked before any other branch", () => {
  const fn = SOURCE.slice(SOURCE.indexOf(FUNCTION_START));
  const nullCheckIdx = fn.indexOf("IF v_uid IS NULL THEN");
  const platformCheckIdx = fn.indexOf("has_platform_admin_authority(v_uid)");
  const assignmentQueryIdx = fn.lastIndexOf("RETURN QUERY");

  assert.ok(nullCheckIdx > -1, "expected an explicit null-caller check");
  assert.match(fn.slice(nullCheckIdx, nullCheckIdx + 40), /RETURN;/);
  assert.ok(
    nullCheckIdx < platformCheckIdx && platformCheckIdx < assignmentQueryIdx,
    "the null check must precede the platform-admin branch, which must precede the Tenant Admin assignment query",
  );
});

test("Platform Admin inherits via the existing has_platform_admin_authority primitive, no reimplementation, and returns every active Tenant directly -- no fake admin_tenant_access row is invented", () => {
  const fn = SOURCE.slice(SOURCE.indexOf(FUNCTION_START));
  assert.match(fn, /IF public\.has_platform_admin_authority\(v_uid\) THEN/);
  assert.equal(/privilege_group\s*=\s*'super_admin'/.test(SOURCE), false);

  const platformIdx = fn.indexOf("IF public.has_platform_admin_authority(v_uid) THEN");
  const nextReturnIdx = fn.indexOf("RETURN;", platformIdx);
  const platformBlock = fn.slice(platformIdx, nextReturnIdx);

  assert.match(platformBlock, /FROM public\.tenants AS t/);
  assert.match(platformBlock, /WHERE t\.is_active = true/);
  assert.equal(
    /admin_tenant_access/.test(platformBlock),
    false,
    "the Platform Admin branch must not touch admin_tenant_access -- no fake assignment is invented",
  );
});

test("an active Tenant Admin assignment succeeds only when the admin_users row, the admin_tenant_access row, and the Tenant are all active", () => {
  const fn = SOURCE.slice(SOURCE.indexOf(FUNCTION_START));
  const assignmentQueryIdx = fn.lastIndexOf("RETURN QUERY");
  const assignmentBlock = fn.slice(assignmentQueryIdx);

  assert.match(assignmentBlock, /FROM public\.admin_tenant_access AS ata/);
  assert.match(assignmentBlock, /JOIN public\.admin_users AS au ON au\.id = ata\.admin_user_id/);
  assert.match(assignmentBlock, /JOIN public\.tenants AS t ON t\.id = ata\.tenant_id/);
  assert.match(assignmentBlock, /au\.user_id = v_uid/);
  assert.match(assignmentBlock, /au\.is_active = true/);
  assert.match(assignmentBlock, /ata\.is_active = true/);
  assert.match(assignmentBlock, /t\.is_active = true/);
});

test("only the minimum Tenant selector fields are returned -- tenant_id and display_name, nothing from admin_tenant_access itself", () => {
  assert.match(SOURCE, /RETURNS TABLE \(\s*\n\s*tenant_id uuid,\s*\n\s*display_name text\s*\n\s*\)/);
  // admin_tenant_access.admin_user_id is referenced only inside the JOIN
  // ON condition (to find the caller's own rows), never selected as an
  // output column -- both RETURN QUERY SELECT lists name only t.id/t.display_name.
  const selectLists = [...SOURCE.matchAll(/RETURN QUERY\s*\n\s*SELECT ([^\n]+)/g)].map(
    (m) => m[1],
  );
  assert.equal(selectLists.length, 2, "expected exactly two RETURN QUERY SELECT statements");
  for (const selectList of selectLists) {
    assert.match(selectList, /^t\.id, t\.display_name$/);
  }
  assert.equal(/ata\.id\b|ata\.created_at|ata\.created_by/.test(SOURCE), false);
});

test("SECURITY DEFINER with a controlled search_path, matching has_any_tenant_admin_authority's convention", () => {
  const fn = SOURCE.slice(SOURCE.indexOf(FUNCTION_START));
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /SET search_path TO 'pg_catalog'/);
});

test("minimum EXECUTE privileges: revoked from PUBLIC, anon, and service_role, granted only to authenticated", () => {
  assert.match(
    SOURCE,
    /REVOKE ALL ON FUNCTION public\.list_my_tenant_admin_access\(\) FROM PUBLIC;/,
  );
  assert.match(
    SOURCE,
    /REVOKE ALL ON FUNCTION public\.list_my_tenant_admin_access\(\) FROM anon;/,
  );
  assert.match(
    SOURCE,
    /REVOKE ALL ON FUNCTION public\.list_my_tenant_admin_access\(\) FROM service_role;/,
  );
  assert.match(
    SOURCE,
    /GRANT EXECUTE ON FUNCTION public\.list_my_tenant_admin_access\(\) TO authenticated;/,
  );
});

test("no other function, table, RLS policy, or grant/revoke is touched -- admin_tenant_access's existing ACL boundary and the assignment-management RPCs are untouched", () => {
  assert.equal(/CREATE TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/ALTER TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/CREATE POLICY|DROP POLICY|ALTER POLICY/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(
    /set_tenant_admin_access|list_tenant_admin_access\(/.test(SOURCE_NO_COMMENTS),
    false,
  );

  const aclStatements = SOURCE_NO_COMMENTS.match(/^(REVOKE|GRANT)\b.*$/gm) || [];
  assert.ok(aclStatements.length > 0, "expected at least the new function's own grants");
  for (const statement of aclStatements) {
    assert.match(
      statement,
      /list_my_tenant_admin_access/,
      `unexpected ACL statement outside the new function: ${statement}`,
    );
  }
});

test("exactly one function is defined in this migration", () => {
  const matches = SOURCE.match(/CREATE OR REPLACE FUNCTION/g) || [];
  assert.equal(matches.length, 1);
});
