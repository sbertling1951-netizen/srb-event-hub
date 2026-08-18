import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural proof for the Self-Scoped Tenant Admin Authority migration.
// This repository has no live-Postgres test harness for any migration
// (no Docker/local Supabase in this environment) -- every sibling
// migration test proves invariants by reading the migration's own SQL
// source and asserting the required properties are structurally present,
// exactly as this file does. Run with:
//   npx tsx --test supabase/migrations/20260818090000_create_self_scoped_tenant_admin_authority.test.ts

const SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "./20260818090000_create_self_scoped_tenant_admin_authority.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

// Strips -- line comments before checking for a code-level reference, so
// the header's own explanatory prose (which necessarily names the
// rejected parameterized shape and the untouched sibling RPCs) doesn't
// trip a check for actual SQL statements.
const SOURCE_NO_COMMENTS = SOURCE.replace(/--.*$/gm, "");

test("the function is genuinely self-scoped: zero parameters, no uid argument through which a caller could probe another user's identity", () => {
  assert.match(
    SOURCE,
    /CREATE OR REPLACE FUNCTION public\.has_any_tenant_admin_authority\(\)/,
    "expected a zero-argument function signature",
  );
  // No sibling two-argument overload (the rejected first-draft shape)
  // is introduced anywhere in this file's actual SQL.
  assert.equal(
    /has_any_tenant_admin_authority\([^)]+\)/.test(SOURCE_NO_COMMENTS),
    false,
    "found a parameterized overload -- the function must take no arguments",
  );
});

test("the caller is derived exclusively from auth.uid(), never from a parameter", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("CREATE OR REPLACE FUNCTION public.has_any_tenant_admin_authority"),
  );
  assert.match(fn, /v_uid := auth\.uid\(\);/);
  // No p_auth_user_id or any other uid-shaped parameter exists to
  // override the auth.uid() derivation.
  assert.equal(/p_auth_user_id|p_uid|p_user_id/.test(fn), false);
});

test("a null caller (anonymous/unauthenticated) returns false, checked before any other branch", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("CREATE OR REPLACE FUNCTION public.has_any_tenant_admin_authority"),
  );
  const nullCheckIdx = fn.indexOf("IF v_uid IS NULL THEN");
  const platformCheckIdx = fn.indexOf("has_platform_admin_authority(v_uid)");
  const existsIdx = fn.indexOf("RETURN EXISTS");

  assert.ok(nullCheckIdx > -1, "expected an explicit null-caller check");
  assert.match(
    fn.slice(nullCheckIdx, nullCheckIdx + 60),
    /RETURN false;/,
  );
  assert.ok(
    nullCheckIdx < platformCheckIdx && platformCheckIdx < existsIdx,
    "the null check must precede the platform-admin check, which must precede the Tenant Admin EXISTS check",
  );
});

test("Platform Admin inherits unconditionally via the existing has_platform_admin_authority primitive, no reimplementation", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("CREATE OR REPLACE FUNCTION public.has_any_tenant_admin_authority"),
  );
  assert.match(
    fn,
    /IF public\.has_platform_admin_authority\(v_uid\) THEN\s*\n\s*RETURN true;/,
  );
  // No inline privilege_group = 'super_admin' reimplementation anywhere
  // in this file -- the existing primitive is reused, not duplicated.
  assert.equal(/privilege_group\s*=\s*'super_admin'/.test(SOURCE), false);
});

test("an active Tenant Admin assignment succeeds only when both the admin_users row and the admin_tenant_access row are active", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("CREATE OR REPLACE FUNCTION public.has_any_tenant_admin_authority"),
  );
  const existsIdx = fn.indexOf("RETURN EXISTS");
  assert.ok(existsIdx > -1);
  const existsBlock = fn.slice(existsIdx);

  assert.match(existsBlock, /FROM public\.admin_tenant_access AS ata/);
  assert.match(existsBlock, /JOIN public\.admin_users AS au ON au\.id = ata\.admin_user_id/);
  assert.match(existsBlock, /au\.user_id = v_uid/);
  assert.match(existsBlock, /au\.is_active = true/);
  assert.match(existsBlock, /ata\.is_active = true/);
});

test("only a boolean is ever returned -- no assignment row, Tenant ID, or other admin's identity is exposed", () => {
  assert.match(SOURCE, /RETURNS boolean/);
  const fn = SOURCE.slice(
    SOURCE.indexOf("CREATE OR REPLACE FUNCTION public.has_any_tenant_admin_authority"),
  );
  assert.equal(/RETURN QUERY/.test(fn), false);
  assert.equal(/RETURNS TABLE/.test(fn), false);
  // Only ever a bare true/false literal is returned -- never a row/column
  // value that could leak assignment data.
  const returns = fn.match(/RETURN\s+[^;]+;/g) || [];
  for (const stmt of returns) {
    assert.match(
      stmt,
      /RETURN\s+(true|false|EXISTS\s*\()/,
      `unexpected return shape: ${stmt}`,
    );
  }
});

test("SECURITY DEFINER with a controlled search_path, matching the existing has_platform_admin_authority/has_tenant_admin_authority convention", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("CREATE OR REPLACE FUNCTION public.has_any_tenant_admin_authority"),
  );
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /SET search_path TO 'pg_catalog'/);
});

test("minimum EXECUTE privileges: revoked from PUBLIC and anon, granted only to authenticated", () => {
  assert.match(
    SOURCE,
    /REVOKE ALL ON FUNCTION public\.has_any_tenant_admin_authority\(\) FROM PUBLIC;/,
  );
  assert.match(
    SOURCE,
    /REVOKE ALL ON FUNCTION public\.has_any_tenant_admin_authority\(\) FROM anon;/,
  );
  assert.match(
    SOURCE,
    /GRANT EXECUTE ON FUNCTION public\.has_any_tenant_admin_authority\(\) TO authenticated;/,
  );
  // No grant to service_role or any other role.
  assert.equal(/TO service_role/.test(SOURCE), false);
});

test("no other function, RLS policy, grant, or revoke is touched -- admin_tenant_access's existing ACL boundary, assignment RPCs, and schema are untouched", () => {
  assert.equal(/CREATE TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/ALTER TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/CREATE POLICY|DROP POLICY|ALTER POLICY/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(
    /set_tenant_admin_access|list_tenant_admin_access/.test(SOURCE_NO_COMMENTS),
    false,
  );
  // The only REVOKE/GRANT statements in the file target the one new
  // function -- none touch the admin_tenant_access table itself.
  const aclStatements = SOURCE_NO_COMMENTS.match(/^(REVOKE|GRANT)\b.*$/gm) || [];
  assert.ok(aclStatements.length > 0, "expected at least the new function's own grants");
  for (const statement of aclStatements) {
    assert.match(
      statement,
      /has_any_tenant_admin_authority/,
      `unexpected ACL statement outside the new function: ${statement}`,
    );
  }
});

test("exactly one function is defined in this migration", () => {
  const matches = SOURCE.match(/CREATE OR REPLACE FUNCTION/g) || [];
  assert.equal(matches.length, 1);
});
