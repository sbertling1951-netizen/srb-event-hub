import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the narrow begin_member_identity_claim_magic_link()
// search_path repair. Proven root cause and required fix are documented in the
// migration header. Live proofs (pre-repair reproduction of the 42883 error,
// post-repair successful invocation, full magic-link -> finalize chain,
// unauthorized-path behavior, zero fixture residue) were independently
// verified against the linked database and are reported separately, not
// re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260815010000_fix_member_magic_link_gen_random_bytes_search_path.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260815010000_fix_member_magic_link_gen_random_bytes_search_path.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

const ORIGINAL_SQL = readFileSync(
  fileURLToPath(new URL("./20260730120000_add_magic_link_activation_support.sql", import.meta.url)),
  "utf8",
);

function functionBody(sql: string): string {
  const m = sql.match(/CREATE OR REPLACE FUNCTION public\.begin_member_identity_claim_magic_link\([\s\S]*?\$\$;/);
  assert.ok(m, "function body not found");
  return m[0];
}

test("does not edit the historical applied migration", () => {
  assert.match(ORIGINAL_SQL, /SET search_path TO 'public'\nAS \$\$\nDECLARE\n  v_placeholder_code text;/);
});

test("statement is wrapped in a single transaction", () => {
  assert.match(executableSql.trim(), /^BEGIN;/);
  assert.match(executableSql.trim(), /COMMIT;$/);
});

test("creates/replaces exactly one function and touches no table, policy, or unrelated object", () => {
  const creates = executableSql.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) || [];
  assert.deepEqual(creates, ["CREATE OR REPLACE FUNCTION public.begin_member_identity_claim_magic_link"]);
  assert.equal(/CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP POLICY|ROW LEVEL SECURITY/.test(executableSql), false);
  assert.equal(/finalize_member_identity_activation\b/.test(executableSql), false, "must not touch the unrelated finalize functions");
  assert.equal(/legacy_login_transfers/.test(executableSql), false, "must not touch Stage 1 objects");
});

test("exact same signature and return type as the original function", () => {
  const original = functionBody(ORIGINAL_SQL);
  const repaired = functionBody(executableSql);
  const sig = /CREATE OR REPLACE FUNCTION public\.begin_member_identity_claim_magic_link\(([\s\S]*?)\)\s*\nRETURNS TABLE\(([\s\S]*?)\)\s*\nLANGUAGE/;
  const origMatch = original.match(sig);
  const repairedMatch = repaired.match(sig);
  assert.ok(origMatch && repairedMatch);
  assert.equal(repairedMatch[1].trim(), origMatch[1].trim(), "parameter list must be unchanged");
  assert.equal(repairedMatch[2].trim(), origMatch[2].trim(), "return table shape must be unchanged");
});

test("remains SECURITY DEFINER", () => {
  const body = functionBody(executableSql);
  assert.match(body, /SECURITY DEFINER/);
});

test("search_path changed from 'public' only to 'public', 'extensions' -- and nothing broader", () => {
  const original = functionBody(ORIGINAL_SQL);
  const repaired = functionBody(executableSql);
  assert.match(original, /SET search_path TO 'public'\nAS \$\$/);
  assert.match(repaired, /SET search_path TO 'public', 'extensions'\nAS \$\$/);
});

test("gen_random_bytes(16) call is preserved verbatim -- token-placeholder generation semantics unchanged", () => {
  const body = functionBody(executableSql);
  assert.match(body, /v_placeholder_code := encode\(gen_random_bytes\(16\), 'hex'\);/);
});

test("delegation to begin_member_identity_claim_verification is preserved verbatim, including all seven positional arguments and the 600-second expiry", () => {
  const body = functionBody(executableSql);
  assert.match(
    body,
    /FROM public\.begin_member_identity_claim_verification\(\s*\n\s*p_attempt_token,\s*\n\s*'email',\s*\n\s*p_destination_hash,\s*\n\s*v_placeholder_code,\s*\n\s*600,\s*\n\s*p_request_ip_hash,\s*\n\s*p_user_agent_hash,\s*\n\s*'member_activation_magic_link_initiate_api'\s*\n\s*\);/,
  );
});

test("verification_method tagging UPDATE is preserved verbatim", () => {
  const body = functionBody(executableSql);
  assert.match(
    body,
    /UPDATE public\.identity_claim_verification_challenges c\s*\n\s*SET verification_method = 'magic_link'\s*\n\s*WHERE c\.attempt_id = v_attempt_id\s*\n\s*AND c\.channel = 'email'\s*\n\s*AND c\.destination_hash = p_destination_hash\s*\n\s*AND c\.status = 'pending';/,
  );
});

test("function body is identical to the original with only the search_path line and one clarifying comment differing", () => {
  const original = functionBody(ORIGINAL_SQL);
  const repaired = functionBody(executableSql);

  const normalize = (s: string) =>
    s
      .replace(/SET search_path TO 'public'(, 'extensions')?/, "SET search_path TO <NORMALIZED>")
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        // Strip both the original's and the repaired migration's own comment
        // lines so only executable structure and non-comment prose is compared.
        return !t.startsWith("--");
      })
      .join("\n")
      .replace(/\s+/g, " ")
      .trim();

  assert.equal(normalize(repaired), normalize(original), "no executable semantics may differ beyond the documented search_path change");
});

test("REVOKE/GRANT are preserved exactly -- service_role only, same as the original migration", () => {
  const originalGrantBlock = ORIGINAL_SQL.match(
    /REVOKE ALL ON FUNCTION public\.begin_member_identity_claim_magic_link\(text, text, text, text\) FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION public\.begin_member_identity_claim_magic_link\(text, text, text, text\) TO service_role;/,
  );
  const repairedGrantBlock = executableSql.match(
    /REVOKE ALL ON FUNCTION public\.begin_member_identity_claim_magic_link\(text, text, text, text\) FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION public\.begin_member_identity_claim_magic_link\(text, text, text, text\) TO service_role;/,
  );
  assert.ok(originalGrantBlock, "original grant block not found -- comparison baseline missing");
  assert.ok(repairedGrantBlock, "repaired migration must restate the identical grant block");
});

test("no additional REVOKE/GRANT statement is introduced (grant posture is restated, not expanded or narrowed)", () => {
  const revokes = executableSql.match(/REVOKE ALL ON FUNCTION/g) || [];
  const grants = executableSql.match(/GRANT EXECUTE ON FUNCTION/g) || [];
  assert.equal(revokes.length, 1);
  assert.equal(grants.length, 1);
});

test("header documents the proven root cause and the live pgcrypto/extensions catalog evidence", () => {
  assert.match(SQL, /gen_random_bytes\(integer\) does not exist/);
  assert.match(SQL, /extensions/);
  assert.match(SQL, /pg_extension/);
});
