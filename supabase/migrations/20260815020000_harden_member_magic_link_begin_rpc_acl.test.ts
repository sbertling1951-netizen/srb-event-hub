import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the begin_member_identity_claim_magic_link
// ACL hardening fix -- the same anon/authenticated default-privilege drift
// 20260814170000/20260814220000 already precedented elsewhere in this
// repository. Live proofs (pre-repair anon/authenticated execution,
// post-repair denial via catalog inspection and genuine RPC calls, a real
// authenticated session, service_role continued execution, full begin-flow
// regression, zero fixture residue) were independently verified against
// the linked database and are reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260815020000_harden_member_magic_link_begin_rpc_acl.test.ts

const SQL = readFileSync(
  fileURLToPath(new URL("./20260815020000_harden_member_magic_link_begin_rpc_acl.sql", import.meta.url)),
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

test("revokes anon and authenticated EXECUTE on the exact target signature, nothing else", () => {
  assert.match(
    executableSql,
    /REVOKE EXECUTE ON FUNCTION public\.begin_member_identity_claim_magic_link\(text, text, text, text\) FROM anon;/,
  );
  assert.match(
    executableSql,
    /REVOKE EXECUTE ON FUNCTION public\.begin_member_identity_claim_magic_link\(text, text, text, text\) FROM authenticated;/,
  );
  const revokes = executableSql.match(/REVOKE\s+EXECUTE/g) || [];
  assert.equal(revokes.length, 2, "exactly two REVOKE statements -- anon and authenticated -- nothing more");
});

test("does not recreate the function, touch its body/search_path, or issue any GRANT", () => {
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(executableSql), false);
  assert.equal(/SET search_path/.test(executableSql), false);
  assert.equal(/GRANT/.test(executableSql), false);
  assert.equal(/gen_random_bytes/.test(executableSql), false);
});

test("does not touch PUBLIC or service_role -- both already correct on the target function", () => {
  assert.equal(/FROM PUBLIC/.test(executableSql), false);
  assert.equal(/service_role/.test(executableSql), false);
});

test("does not reference any other function -- the three related-but-clean/out-of-scope functions are untouched", () => {
  for (const fn of [
    "begin_member_identity_claim_verification",
    "finalize_member_identity_activation_via_magic_link",
    "finalize_member_identity_activation",
  ]) {
    assert.equal(new RegExp(`REVOKE[\\s\\S]*?public\\.${fn}\\(`).test(executableSql), false, `must not modify ${fn} -- out of this repair's scope`);
  }
});

test("does not edit the historical applied magic-link migration", () => {
  assert.match(
    ORIGINAL_SQL,
    /REVOKE ALL ON FUNCTION public\.begin_member_identity_claim_magic_link\(text, text, text, text\) FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION public\.begin_member_identity_claim_magic_link\(text, text, text, text\) TO service_role;/,
  );
});

test("header documents the pg_default_acl root cause and the proven service-role-only caller", () => {
  assert.match(SQL, /pg_default_acl/);
  assert.match(SQL, /initiate-magic-link\/route\.ts/);
  assert.match(SQL, /service-role-only execution is the proven intended model/);
});

test("header records the out-of-scope finalize_member_identity_activation_via_magic_link finding without touching it", () => {
  assert.match(SQL, /finalize_member_identity_activation_via_magic_link does\s*\n-- carry an unintended anon EXECUTE grant/);
  assert.match(SQL, /recorded separately\s*\n-- as a follow-up concern rather than touched here/);
});
