import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Legacy Login Transfer Stage 1
// migration. This migration creates one server-only table and two
// SECURITY DEFINER RPCs -- their grant/RLS posture, trust-boundary
// documentation, and token-storage model are all provable from the SQL
// text. Live proofs (creation, redemption, single-use, expiry,
// concurrency, anon/authenticated denial, zero fixture residue) were
// independently verified against the linked database and are reported
// separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260815000000_create_legacy_login_transfers.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260815000000_create_legacy_login_transfers.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

function tableBody(): string {
  const m = executableSql.match(/CREATE TABLE public\.legacy_login_transfers \(([\s\S]*?)\n\);/);
  assert.ok(m, "table body not found");
  return m[1];
}

function functionBody(name: "create_legacy_login_transfer" | "redeem_legacy_login_transfer"): string {
  const m = executableSql.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`),
  );
  assert.ok(m, `${name} function body not found`);
  return m[0];
}

test("statement is wrapped in a single transaction", () => {
  assert.match(executableSql.trim(), /^BEGIN;/);
  assert.match(executableSql.trim(), /COMMIT;$/);
});

test("creates exactly one table and exactly two functions", () => {
  const tables = executableSql.match(/CREATE TABLE public\.(\w+)/g) || [];
  assert.deepEqual(tables, ["CREATE TABLE public.legacy_login_transfers"]);

  const functions = executableSql.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) || [];
  assert.deepEqual(functions, [
    "CREATE OR REPLACE FUNCTION public.create_legacy_login_transfer",
    "CREATE OR REPLACE FUNCTION public.redeem_legacy_login_transfer",
  ]);
});

test("no legacy_login_transfer_audit table or any other object is created", () => {
  assert.equal(/legacy_login_transfer_audit/.test(executableSql), false);
  assert.equal((executableSql.match(/CREATE TABLE/g) || []).length, 1);
});

// ---- Table shape ----

test("table has every required column", () => {
  const body = tableBody();
  const requiredColumns = [
    "id uuid PRIMARY KEY DEFAULT gen_random_uuid()",
    "created_at timestamptz NOT NULL DEFAULT now()",
    "transfer_token_hash text NOT NULL",
    "auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE",
    "person_id uuid REFERENCES public.people(id) ON DELETE SET NULL",
    "role_class text NOT NULL CHECK (role_class IN ('admin', 'member', 'vendor'))",
    "supabase_hashed_token text NOT NULL",
    "status text NOT NULL DEFAULT 'pending'",
    "expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 seconds')",
    "consumed_at timestamptz",
    "request_ip_hash text",
    "user_agent_hash text",
  ];
  for (const column of requiredColumns) {
    assert.ok(body.includes(column), `missing column definition: ${column}`);
  }
});

test("destination_path is NOT NULL, defaults to '/', and is constrained to a relative path", () => {
  const body = tableBody();
  assert.match(body, /destination_path text NOT NULL DEFAULT '\/'\s*\n\s*CHECK \(destination_path LIKE '\/%'\)/);
});

test("expires_at defaults to exactly now() + 90 seconds at the schema level", () => {
  const body = tableBody();
  assert.match(body, /expires_at timestamptz NOT NULL DEFAULT \(now\(\) \+ interval '90 seconds'\)/);
});

test("consumed status and consumed_at are constrained to agree in both directions", () => {
  const body = tableBody();
  assert.match(
    body,
    /CONSTRAINT legacy_login_transfers_consumed_consistency CHECK \(\s*\n\s*\(status = 'consumed' AND consumed_at IS NOT NULL\)\s*\n\s*OR \(status <> 'consumed' AND consumed_at IS NULL\)\s*\n\s*\)/,
  );
});

test("expiry must be after creation", () => {
  const body = tableBody();
  assert.match(body, /CONSTRAINT legacy_login_transfers_expiry_after_creation CHECK \(expires_at > created_at\)/);
});

test("role_class is constrained to exactly admin/member/vendor", () => {
  const body = tableBody();
  assert.match(body, /role_class text NOT NULL CHECK \(role_class IN \('admin', 'member', 'vendor'\)\)/);
});

test("status is constrained to exactly pending/consumed/expired", () => {
  const body = tableBody();
  assert.match(body, /status text NOT NULL DEFAULT 'pending'\s*\n\s*CHECK \(status IN \('pending', 'consumed', 'expired'\)\)/);
});

test("transfer_token_hash has a unique index and no separate plain-uniqueness column constraint duplicating it", () => {
  assert.match(
    executableSql,
    /CREATE UNIQUE INDEX legacy_login_transfers_token_hash_unique_idx\s*\n\s*ON public\.legacy_login_transfers \(transfer_token_hash\);/,
  );
});

test("status and auth_user_id indexes exist; no speculative expires_at-only index is added", () => {
  assert.match(executableSql, /CREATE INDEX legacy_login_transfers_status_idx\s*\n\s*ON public\.legacy_login_transfers \(status\);/);
  assert.match(executableSql, /CREATE INDEX legacy_login_transfers_auth_user_id_idx\s*\n\s*ON public\.legacy_login_transfers \(auth_user_id\);/);
  const indexCount = (executableSql.match(/CREATE (UNIQUE )?INDEX/g) || []).length;
  assert.equal(indexCount, 3, "expected exactly three indexes: token hash (unique), status, auth_user_id");
});

test("no raw transfer token column exists anywhere in the schema -- only its hash is stored", () => {
  const body = tableBody();
  assert.equal(/\btransfer_token\b(?!_hash)/.test(body), false, "a raw transfer_token column must never exist");
  assert.equal(/public_transfer_token/.test(executableSql), false);
});

test("supabase_hashed_token is stored verbatim (not re-hashed) and its rationale is documented", () => {
  assert.match(executableSql, /supabase_hashed_token text NOT NULL/);
  assert.match(
    SQL,
    /supabase_hashed_token stores the verbatim `hashed_token`/,
    "the schema-vs-Supabase-token distinction must be documented in SQL comments",
  );
});

// ---- RLS / grants on the table ----

test("RLS is enabled on the table", () => {
  assert.match(executableSql, /ALTER TABLE public\.legacy_login_transfers ENABLE ROW LEVEL SECURITY;/);
});

test("anon and authenticated each have an explicit deny-all policy", () => {
  assert.match(
    executableSql,
    /CREATE POLICY deny_all_anonymous_legacy_login_transfers\s*\n\s*ON public\.legacy_login_transfers\s*\n\s*FOR ALL\s*\n\s*TO anon\s*\n\s*USING \(false\)\s*\n\s*WITH CHECK \(false\);/,
  );
  assert.match(
    executableSql,
    /CREATE POLICY deny_all_authenticated_legacy_login_transfers\s*\n\s*ON public\.legacy_login_transfers\s*\n\s*FOR ALL\s*\n\s*TO authenticated\s*\n\s*USING \(false\)\s*\n\s*WITH CHECK \(false\);/,
  );
});

test("table-level grants are explicitly revoked from PUBLIC, anon, and authenticated", () => {
  assert.match(executableSql, /REVOKE ALL ON TABLE public\.legacy_login_transfers FROM PUBLIC;/);
  assert.match(executableSql, /REVOKE ALL ON TABLE public\.legacy_login_transfers FROM anon;/);
  assert.match(executableSql, /REVOKE ALL ON TABLE public\.legacy_login_transfers FROM authenticated;/);
});

test("no direct table GRANT is issued to any role", () => {
  assert.equal(/GRANT (SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)\s[\s\S]*ON TABLE public\.legacy_login_transfers/.test(executableSql), false);
});

// ---- Functions: SECURITY DEFINER, search_path, grants ----

for (const name of ["create_legacy_login_transfer", "redeem_legacy_login_transfer"] as const) {
  test(`${name} is SECURITY DEFINER with a fixed, safe search_path`, () => {
    const body = functionBody(name);
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path TO 'public'/);
  });

  test(`${name} EXECUTE is revoked from PUBLIC/anon/authenticated and granted only to service_role`, () => {
    assert.match(executableSql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC;`));
    assert.match(executableSql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM anon;`));
    assert.match(executableSql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM authenticated;`));
    assert.match(executableSql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO service_role;`));
    assert.equal(
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO (anon|authenticated|PUBLIC);`).test(executableSql),
      false,
    );
  });

  test(`${name} has a durable COMMENT documenting it is service_role only`, () => {
    const commentPattern = new RegExp(`COMMENT ON FUNCTION public\\.${name} IS\\s*\\n\\s*'service_role only\\.`);
    assert.match(executableSql, commentPattern);
  });
}

test("create_legacy_login_transfer keeps the narrower public-only search_path (it never calls a pgcrypto function)", () => {
  const body = functionBody("create_legacy_login_transfer");
  assert.match(body, /SET search_path TO 'public'\n/);
  assert.equal(/extensions/.test(body), false);
});

test("redeem_legacy_login_transfer's search_path includes 'extensions' because pgcrypto's digest() lives there on this project, not public", () => {
  const body = functionBody("redeem_legacy_login_transfer");
  assert.match(body, /SET search_path TO 'public', 'extensions'/);
});

test("create_legacy_login_transfer's trust-boundary comment names all three trusted parameters explicitly", () => {
  const m = executableSql.match(/COMMENT ON FUNCTION public\.create_legacy_login_transfer IS\s*\n\s*'([\s\S]*?)';/);
  assert.ok(m, "create_legacy_login_transfer comment not found");
  const comment = m[1];
  assert.match(comment, /p_auth_user_id\/p_person_id\/p_role_class are trusted, server-derived inputs/);
  assert.match(comment, /never accepted from or influenceable by a browser request/);
  assert.match(comment, /No anon or authenticated grant exists/);
});

test("create_legacy_login_transfer accepts a pre-hashed token, never a raw one, and never generates one itself", () => {
  const body = functionBody("create_legacy_login_transfer");
  assert.match(body, /p_transfer_token_hash text/);
  assert.equal(/gen_random_bytes/.test(body), false, "creation must not generate raw token material in Postgres");
  assert.equal(/digest\(/.test(body), false, "creation must not hash anything itself -- it receives an already-hashed value");
});

test("create_legacy_login_transfer's parameter list matches the documented trust boundary", () => {
  const body = functionBody("create_legacy_login_transfer");
  const signature = body.match(/CREATE OR REPLACE FUNCTION public\.create_legacy_login_transfer\(([\s\S]*?)\)\s*\nRETURNS/);
  assert.ok(signature, "signature not found");
  const params = signature[1];
  assert.match(params, /p_auth_user_id uuid/);
  assert.match(params, /p_person_id uuid/);
  assert.match(params, /p_role_class text/);
  assert.match(params, /p_supabase_hashed_token text/);
  assert.match(params, /p_transfer_token_hash text/);
  assert.match(params, /p_destination_path text DEFAULT '\/'/);
});

test("create_legacy_login_transfer inserts exactly one row and returns only id/expires_at", () => {
  const body = functionBody("create_legacy_login_transfer");
  assert.equal((body.match(/INSERT INTO public\.legacy_login_transfers/g) || []).length, 1);
  const returns = body.match(/RETURNS TABLE\(([^)]*)\)/);
  assert.ok(returns);
  assert.equal(returns[1].replace(/\s+/g, " ").trim(), "id uuid, expires_at timestamptz");
});

test("redeem_legacy_login_transfer hashes the presented token with sha256 via pgcrypto digest()", () => {
  const body = functionBody("redeem_legacy_login_transfer");
  assert.match(body, /encode\(digest\(p_presented_token, 'sha256'\), 'hex'\)/);
});

test("redeem_legacy_login_transfer's single UPDATE ... RETURNING is the sole atomic consumption path", () => {
  const body = functionBody("redeem_legacy_login_transfer");
  assert.match(
    body,
    /UPDATE public\.legacy_login_transfers\s*\n\s*SET status = 'consumed',\s*\n\s*consumed_at = now\(\)\s*\n\s*WHERE transfer_token_hash = v_hash\s*\n\s*AND status = 'pending'\s*\n\s*AND expires_at > now\(\)/,
  );
  assert.equal((body.match(/UPDATE public\.legacy_login_transfers/g) || []).length, 1);
});

test("redeem_legacy_login_transfer never writes status = 'expired' itself", () => {
  const body = functionBody("redeem_legacy_login_transfer");
  assert.equal(/SET status = 'expired'/.test(body), false);
});

test("redeem_legacy_login_transfer returns the identical generic rejected outcome for every failure path", () => {
  const body = functionBody("redeem_legacy_login_transfer");
  const rejections = body.match(/RETURN QUERY SELECT 'rejected'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text;/g) || [];
  assert.equal(rejections.length, 2, "expected exactly two identical rejection paths: null/empty input, and no matching row");
});

test("redeem_legacy_login_transfer's success return exposes only the six documented fields", () => {
  const body = functionBody("redeem_legacy_login_transfer");
  const returns = body.match(/RETURNS TABLE\(([\s\S]*?)\)\s*\nLANGUAGE/);
  assert.ok(returns);
  const fields = returns[1].split(",").map((f) => f.trim().split(/\s+/)[0]);
  assert.deepEqual(fields, ["outcome", "auth_user_id", "person_id", "role_class", "supabase_hashed_token", "destination_path"]);
});

test("no service_role EXECUTE is ever revoked (service_role must retain access)", () => {
  assert.equal(/REVOKE ALL ON FUNCTION[\s\S]*?FROM service_role/.test(executableSql), false);
});
