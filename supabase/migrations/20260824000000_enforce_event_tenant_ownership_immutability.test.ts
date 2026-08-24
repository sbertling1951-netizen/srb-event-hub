import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260824000000_enforce_event_tenant_ownership_immutability.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const FIXTURE = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260824000000_event_tenant_boundary_rollback.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

function executable(source: string) {
  return source.replace(/--.*$/gm, "");
}

function pendingDefinitionBlock(source: string) {
  const start = source.indexOf(
    "CREATE FUNCTION public.prevent_event_tenant_ownership_change()",
  );
  assert.notEqual(start, -1);
  const blockEnd = source.indexOf(
    "GRANT EXECUTE ON FUNCTION public.has_event_admin_authority(uuid, uuid)\n  TO service_role;",
    start,
  );
  assert.notEqual(blockEnd, -1);
  const endStatement =
    "GRANT EXECUTE ON FUNCTION public.has_event_admin_authority(uuid, uuid)\n  TO service_role;";
  return source
    .slice(start, blockEnd + endStatement.length)
    .trim();
}

test("the linked rollback fixture installs the exact pending T0 definition", () => {
  assert.equal(pendingDefinitionBlock(FIXTURE), pendingDefinitionBlock(SQL));
});

test("Event Tenant ownership changes are rejected by a role-neutral column trigger", () => {
  const sql = executable(SQL);
  const triggerFunction = sql.slice(
    sql.indexOf("CREATE FUNCTION public.prevent_event_tenant_ownership_change()"),
    sql.indexOf(
      "ALTER FUNCTION public.prevent_event_tenant_ownership_change()",
    ),
  );

  assert.match(
    sql,
    /IF NEW\.tenant_id IS DISTINCT FROM OLD\.tenant_id THEN\s*\n\s*RAISE EXCEPTION 'events\.tenant_id is immutable after insert';/,
  );
  assert.match(
    sql,
    /CREATE TRIGGER prevent_event_tenant_ownership_change\s*\nBEFORE UPDATE OF tenant_id ON public\.events\s*\nFOR EACH ROW\s*\nEXECUTE FUNCTION public\.prevent_event_tenant_ownership_change\(\);/,
  );
  assert.equal(/auth\.uid\(\)/.test(triggerFunction), false);
  assert.equal(/has_.*_authority/.test(triggerFunction), false);
});

test("ordinary Event metadata UPDATE authority remains owned by existing grants and RLS", () => {
  const sql = executable(SQL);

  assert.equal(/ALTER TABLE public\.events/.test(sql), false);
  assert.equal(/CREATE POLICY|DROP POLICY|GRANT .* ON TABLE|REVOKE .* ON TABLE/.test(sql), false);
  assert.equal(/UPDATE public\.events|INSERT INTO public\.events|DELETE FROM public\.events/.test(sql), false);
});

test("the trigger helper follows owner, search_path, and least-privilege conventions", () => {
  assert.match(
    SQL,
    /LANGUAGE plpgsql\s*\nSET search_path TO 'pg_catalog'/,
  );
  assert.match(
    SQL,
    /ALTER FUNCTION public\.prevent_event_tenant_ownership_change\(\) OWNER TO postgres;/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.prevent_event_tenant_ownership_change\(\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.equal(
    /GRANT EXECUTE ON FUNCTION public\.prevent_event_tenant_ownership_change/.test(
      SQL,
    ),
    false,
  );
  assert.equal(/SECURITY DEFINER/.test(SQL), false);
});

test("only the existing server authority predicate gains service-role execution", () => {
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.has_event_admin_authority\(uuid, uuid\)\s*\n\s*TO service_role;/,
  );
  assert.equal(
    /GRANT EXECUTE ON FUNCTION public\.has_event_admin_authority\(uuid, uuid\)\s*\n\s*TO (?:PUBLIC|anon|authenticated)/.test(
      SQL,
    ),
    false,
  );
  assert.equal(/CREATE OR REPLACE FUNCTION public\.has_event_admin_authority/.test(SQL), false);
});

test("T0 introduces no Event transfer or alternative ownership-write operation", () => {
  const sql = executable(SQL);
  const createdFunctions = [
    ...sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION public\.([a-z0-9_]+)\(/g),
  ].map((match) => match[1]);

  assert.deepEqual(createdFunctions, ["prevent_event_tenant_ownership_change"]);
  assert.equal(/transfer_event|move_event|reassign_event|set_event_tenant/.test(sql), false);
});

test("inactive-Tenant policy and arbitrary-user authority predicates remain untouched", () => {
  const sql = executable(SQL);

  assert.equal(/tenants|is_active|public discovery/i.test(sql), false);
  assert.equal(
    /CREATE OR REPLACE FUNCTION public\.(?:has_platform_admin_authority|has_tenant_admin_authority|has_event_admin_authority)/.test(sql),
    false,
  );
  assert.equal(
    /ALTER FUNCTION public\.(?:has_platform_admin_authority|has_tenant_admin_authority|has_event_admin_authority)/.test(sql),
    false,
  );
});

test("fixture covers direct, inherited Tenant, Platform, unauthorized, cross-Tenant, and inactive-Tenant evidence", () => {
  for (const evidence of [
    "direct Event Admin ownership change",
    "Tenant Admin ownership change",
    "Platform raw ownership change",
    "authorized direct Event metadata edit",
    "Tenant Admin inherited metadata edit",
    "unauthorized Event metadata edit",
    "Tenant A Admin must not edit Tenant B Event",
    "direct Event Admin must not inherit Event A2 authority",
    "T0 must not silently change inactive-Tenant authority semantics",
  ]) {
    assert.match(FIXTURE, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(FIXTURE, /^BEGIN;/m);
  assert.match(FIXTURE, /^ROLLBACK;/m);
});
