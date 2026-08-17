import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Admin Permission Mutation
// Governance migration (Stage 2 D6). No live database connection is
// available in this environment, so this migration's shape is verified
// from its SQL text -- the same convention already established for this
// repository's other RPC/grant migrations (see e.g.
// 20260814100000_harden_vendor_admission_lifecycle_table_grants.test.ts).
// Live application/execution is a separate, later step outside this
// session. Run with:
//   npx tsx --test supabase/migrations/20260816120000_create_admin_permission_mutation_governance.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260816120000_create_admin_permission_mutation_governance.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("statement is wrapped in a single transaction", () => {
  assert.match(executableSql.trim(), /^BEGIN;/);
  assert.match(executableSql.trim(), /COMMIT;$/);
});

test("defines exactly one new function: set_admin_privilege_group_permission", () => {
  const defs = executableSql.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) || [];
  assert.deepEqual(defs, [
    "CREATE OR REPLACE FUNCTION public.set_admin_privilege_group_permission",
  ]);
});

test("the function is SECURITY DEFINER with search_path pinned, matching this repository's governed-RPC precedent", () => {
  assert.match(executableSql, /SECURITY DEFINER/);
  assert.match(executableSql, /SET search_path TO pg_catalog/);
});

test("authority check preserves the existing can_manage_admins/super_admin semantic -- no new authority concept is introduced", () => {
  const fnStart = executableSql.indexOf("CREATE OR REPLACE FUNCTION public.set_admin_privilege_group_permission");
  const fnBody = executableSql.slice(fnStart);

  assert.match(fnBody, /v_caller_privilege_group = 'super_admin'/);
  assert.match(fnBody, /permission_key = 'can_manage_admins'/);
  assert.match(fnBody, /agp\.is_enabled = true/);
  assert.match(fnBody, /not_authorized/);
  // No second/different permission key or privilege-group value is ever
  // checked -- the boundary is exactly can_manage_admins, once.
  const permissionKeyLiterals = [...fnBody.matchAll(/permission_key\s*=\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(new Set(permissionKeyLiterals), new Set(["can_manage_admins"]));
});

test("permission write and audit insert happen inside the same function body, gated by an actual-change check, not an unconditional write", () => {
  const fnStart = executableSql.indexOf("CREATE OR REPLACE FUNCTION public.set_admin_privilege_group_permission");
  const fnBody = executableSql.slice(fnStart);

  assert.match(fnBody, /INSERT INTO public\.admin_privilege_group_permissions/);
  assert.match(fnBody, /UPDATE public\.admin_privilege_group_permissions/);
  assert.match(fnBody, /INSERT INTO public\.admin_permission_audit/);
  assert.match(fnBody, /IF v_old_value IS DISTINCT FROM p_is_enabled THEN/);

  // The audit INSERT must appear textually after (i.e. inside) the
  // IS DISTINCT FROM guard, not before it / unconditionally.
  const guardIdx = fnBody.indexOf("IF v_old_value IS DISTINCT FROM p_is_enabled THEN");
  const auditIdx = fnBody.indexOf("INSERT INTO public.admin_permission_audit");
  assert.ok(guardIdx !== -1 && auditIdx !== -1 && auditIdx > guardIdx);
});

test("row is locked with FOR UPDATE before old_value is read -- concurrent-mutation safe", () => {
  assert.match(executableSql, /FOR UPDATE;/);
});

test("no direct INSERT/UPDATE/DELETE grant remains on either governed table for any client-facing role", () => {
  assert.match(
    executableSql,
    /REVOKE INSERT, UPDATE, DELETE\s*\nON TABLE public\.admin_privilege_group_permissions\s*\nFROM authenticated, anon, service_role;/,
  );
  assert.match(
    executableSql,
    /REVOKE INSERT, UPDATE, DELETE\s*\nON TABLE public\.admin_permission_audit\s*\nFROM authenticated, anon, service_role;/,
  );
});

test("SELECT is never revoked on either table -- existing read paths (page.tsx's load(), lib/server/adminAuthz.ts) are preserved untouched", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  const tableRevokes = revokeStatements.filter((s) => /ON TABLE/.test(s));
  for (const stmt of tableRevokes) {
    assert.equal(/\bSELECT\b/.test(stmt), false, `SELECT must not be revoked: ${stmt}`);
  }
});

test("admin_permission_presets (a snapshot, not a live authority grant) is never referenced -- out of this migration's scope", () => {
  assert.equal(/admin_permission_presets/.test(executableSql), false);
});

test("only authenticated may EXECUTE the new RPC -- anon and service_role are explicitly revoked", () => {
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.set_admin_privilege_group_permission\(text, text, boolean, uuid\)\s*\nTO authenticated;/,
  );
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.set_admin_privilege_group_permission\(text, text, boolean, uuid\)\s*\nFROM anon;/,
  );
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.set_admin_privilege_group_permission\(text, text, boolean, uuid\)\s*\nFROM service_role;/,
  );
});

test("no unrelated schema object (table, RLS policy) is created or altered", () => {
  assert.equal(/CREATE TABLE/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ALTER TABLE public\.admin_privilege_group_permissions\s+ADD/.test(executableSql), false);
  assert.equal(/ROW LEVEL SECURITY/.test(executableSql), false);
});
