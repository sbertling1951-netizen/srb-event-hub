import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the finalize_member_identity_activation_via_magic_link
// ACL hardening fix -- the same anon default-privilege drift already
// precedented three times in this repository (20260814170000,
// 20260814220000, 20260815020000). Live proofs (pre-repair anon
// execution, post-repair denial via a real anon-key RPC call, continued
// authenticated execution via a genuine session, full activation-flow
// regression, zero fixture residue) were independently verified against
// the linked database and are reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260815030000_harden_member_magic_link_finalize_rpc_acl.test.ts

const SQL = readFileSync(
  fileURLToPath(new URL("./20260815030000_harden_member_magic_link_finalize_rpc_acl.sql", import.meta.url)),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

const ORIGINAL_SQL = readFileSync(
  fileURLToPath(new URL("./20260730120000_add_magic_link_activation_support.sql", import.meta.url)),
  "utf8",
);

test("statement is wrapped in a single transaction", () => {
  assert.match(executableSql.trim(), /^BEGIN;/);
  assert.match(executableSql.trim(), /COMMIT;$/);
});

test("revokes anon EXECUTE on the exact target signature, nothing else", () => {
  assert.match(
    executableSql,
    /REVOKE EXECUTE ON FUNCTION public\.finalize_member_identity_activation_via_magic_link\(text\) FROM anon;/,
  );
  const revokes = executableSql.match(/REVOKE\s+EXECUTE/g) || [];
  assert.equal(revokes.length, 1, "exactly one REVOKE statement -- anon only");
});

test("does not touch authenticated, service_role, or PUBLIC", () => {
  assert.equal(/authenticated/.test(executableSql), false);
  assert.equal(/service_role/.test(executableSql), false);
  assert.equal(/FROM PUBLIC/.test(executableSql), false);
});

test("does not recreate the function, touch its body/search_path, or issue any GRANT", () => {
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(executableSql), false);
  assert.equal(/SET search_path/.test(executableSql), false);
  assert.equal(/GRANT/.test(executableSql), false);
  assert.equal(/auth\.uid\(\)/.test(executableSql), false);
});

test("does not reference any other function", () => {
  for (const fn of [
    "begin_member_identity_claim_magic_link",
    "begin_member_identity_claim_verification",
    "finalize_member_identity_activation\\b",
  ]) {
    // finalize_member_identity_activation_via_magic_link legitimately appears (it's the target);
    // exclude that exact match while checking the other three are absent.
    const pattern = new RegExp(`REVOKE[\\s\\S]*?public\\.${fn}\\(`);
    assert.equal(pattern.test(executableSql), false, `must not modify ${fn} -- out of this repair's scope`);
  }
});

test("does not alter pg_default_acl or any global/default privilege", () => {
  assert.equal(/ALTER DEFAULT PRIVILEGES/.test(executableSql), false);
  assert.equal(/pg_default_acl/.test(executableSql), false);
});

test("does not edit the historical applied magic-link migration", () => {
  assert.match(
    ORIGINAL_SQL,
    /REVOKE ALL ON FUNCTION public\.finalize_member_identity_activation_via_magic_link\(text\) FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION public\.finalize_member_identity_activation_via_magic_link\(text\) TO authenticated;/,
  );
});

test("header documents the proven authenticated caller and the pg_default_acl root cause", () => {
  assert.match(SQL, /app\/auth\/callback\/page\.tsx/);
  assert.match(SQL, /pg_default_acl/);
  assert.match(SQL, /EXECUTE is required and intentional/);
});
