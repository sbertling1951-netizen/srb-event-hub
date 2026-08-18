import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural proof for the Self-Scoped Vendor Catalog Admin Authority
// migration. This repository has no live-Postgres test harness for any
// migration (no Docker/local Supabase in this environment) -- every
// sibling migration test proves invariants by reading the migration's
// own SQL source and asserting the required properties are structurally
// present, exactly as this file does (see
// 20260818090000_create_self_scoped_tenant_admin_authority.test.ts for
// the precedent this file mirrors). Run with:
//   npx tsx --test supabase/migrations/20260818110000_create_self_scoped_vendor_catalog_admin_authority.test.ts

const SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "./20260818110000_create_self_scoped_vendor_catalog_admin_authority.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

// Strips -- line comments before checking for a code-level reference, so
// the header's own explanatory prose (which necessarily names the
// rejected arbitrary-uid shape) doesn't trip a check for actual SQL
// statements.
const SOURCE_NO_COMMENTS = SOURCE.replace(/--.*$/gm, "");

test("the function is genuinely self-scoped: zero parameters, no uid argument through which a caller could probe another user's identity", () => {
  assert.match(
    SOURCE,
    /CREATE OR REPLACE FUNCTION public\.has_my_vendor_catalog_admin_authority\(\)/,
    "expected a zero-argument function signature",
  );
  assert.equal(
    /has_my_vendor_catalog_admin_authority\([^)]+\)/.test(SOURCE_NO_COMMENTS),
    false,
    "found a parameterized overload -- the function must take no arguments",
  );
});

test("the caller is derived exclusively from auth.uid(), never from a parameter -- no p_uid/p_auth_user_id/_uid parameter exists on this new function", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf(
      "CREATE OR REPLACE FUNCTION public.has_my_vendor_catalog_admin_authority",
    ),
  );
  assert.match(fn, /RETURN public\.has_vendor_catalog_admin_authority\(auth\.uid\(\)\);/);
  assert.equal(/\(\s*p_auth_user_id|\(\s*p_uid|\(\s*p_user_id/.test(fn), false);
});

test("delegates entirely to the existing has_vendor_catalog_admin_authority(uid) primitive -- no reimplementation of the super_admin/event_admin/override logic", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf(
      "CREATE OR REPLACE FUNCTION public.has_my_vendor_catalog_admin_authority",
    ),
  );
  const body = fn.slice(fn.indexOf("AS $$") + "AS $$".length, fn.indexOf("$$;"));
  assert.equal(/privilege_group/.test(body), false);
  assert.equal(/admin_privilege_group_permissions/.test(body), false);
  assert.equal(/admin_users/.test(body), false);
  // Exactly one statement inside BEGIN/END: delegate and return.
  const statements = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== "BEGIN" && line !== "END;");
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^RETURN public\.has_vendor_catalog_admin_authority\(auth\.uid\(\)\);$/);
});

test("the existing uid-taking has_vendor_catalog_admin_authority(uuid) is never replaced, redefined, or altered by this migration", () => {
  assert.equal(
    /CREATE OR REPLACE FUNCTION public\.has_vendor_catalog_admin_authority\(/.test(
      SOURCE_NO_COMMENTS,
    ),
    false,
  );
  assert.equal(/DROP FUNCTION/.test(SOURCE_NO_COMMENTS), false);
});

test("only a boolean is ever returned -- no row, uid, or other admin's identity is exposed", () => {
  assert.match(SOURCE, /RETURNS boolean/);
  const fn = SOURCE.slice(
    SOURCE.indexOf(
      "CREATE OR REPLACE FUNCTION public.has_my_vendor_catalog_admin_authority",
    ),
  );
  assert.equal(/RETURN QUERY/.test(fn), false);
  assert.equal(/RETURNS TABLE/.test(fn), false);
});

test("SECURITY DEFINER with a controlled search_path, matching the existing convention", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf(
      "CREATE OR REPLACE FUNCTION public.has_my_vendor_catalog_admin_authority",
    ),
  );
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /SET search_path TO 'pg_catalog'/);
});

test("minimum EXECUTE privileges: revoked from PUBLIC and anon, granted only to authenticated -- no service_role grant on this client-facing wrapper", () => {
  assert.match(
    SOURCE,
    /REVOKE ALL ON FUNCTION public\.has_my_vendor_catalog_admin_authority\(\) FROM PUBLIC;/,
  );
  assert.match(
    SOURCE,
    /REVOKE ALL ON FUNCTION public\.has_my_vendor_catalog_admin_authority\(\) FROM anon;/,
  );
  assert.match(
    SOURCE,
    /GRANT EXECUTE ON FUNCTION public\.has_my_vendor_catalog_admin_authority\(\) TO authenticated;/,
  );
  assert.equal(/TO service_role/.test(SOURCE), false);
});

test("no table, policy, grant, or revoke outside the one new function is touched -- vendors_insert_policy/vendors_update_policy/vendors_select_policy and their existing authority are untouched", () => {
  assert.equal(/CREATE TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/ALTER TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/CREATE POLICY|DROP POLICY|ALTER POLICY/.test(SOURCE_NO_COMMENTS), false);
  const aclStatements = SOURCE_NO_COMMENTS.match(/^(REVOKE|GRANT)\b.*$/gm) || [];
  assert.ok(aclStatements.length > 0, "expected at least the new function's own grants");
  for (const statement of aclStatements) {
    assert.match(
      statement,
      /has_my_vendor_catalog_admin_authority/,
      `unexpected ACL statement outside the new function: ${statement}`,
    );
  }
});

test("exactly one function is defined in this migration", () => {
  const matches = SOURCE.match(/CREATE OR REPLACE FUNCTION/g) || [];
  assert.equal(matches.length, 1);
});
