import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Known-Context Tenant Ownership
// Validation RPC used by lib/server/workspaceContextResolver.ts.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814200000_create_tenant_owned_event_ids_rpc.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260814200000_create_tenant_owned_event_ids_rpc.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("creates exactly one function, get_tenant_owned_event_ids(uuid[], uuid)", () => {
  const creates = executableSql.match(/CREATE OR REPLACE FUNCTION public\.\w+/g) || [];
  assert.equal(creates.length, 1);
  assert.match(
    executableSql,
    /CREATE OR REPLACE FUNCTION public\.get_tenant_owned_event_ids\(\s*p_event_ids uuid\[\],\s*p_tenant_id uuid\s*\)/,
  );
});

test("SECURITY DEFINER with a fixed, safe search_path", () => {
  assert.match(executableSql, /SECURITY DEFINER/);
  assert.match(executableSql, /SET search_path TO 'public'/);
});

test("no SELECT * -- explicit column list only", () => {
  assert.equal(/SELECT\s+\*/i.test(executableSql), false);
});

test("projects id only, no other column", () => {
  const returnsMatch = executableSql.match(/RETURNS TABLE\(([\s\S]*?)\)\n(?=LANGUAGE)/);
  assert.ok(returnsMatch);
  const columns = returnsMatch[1]
    .split(",")
    .map((c) => c.trim().split(/\s+/)[0])
    .filter(Boolean);
  assert.deepEqual(columns, ["id"]);

  const selectMatch = executableSql.match(/SELECT\s+([\s\S]*?)\s+FROM public\.events e/);
  assert.ok(selectMatch);
  const selected = selectMatch[1]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  assert.deepEqual(selected, ["e.id"]);
});

test("predicate is id = ANY(p_event_ids) AND tenant_id = p_tenant_id only -- no visibility/lifecycle filter", () => {
  const whereClauses = executableSql.match(/WHERE[\s\S]*?;/g) || [];
  assert.equal(whereClauses.length, 1);
  assert.match(whereClauses[0], /WHERE\s+e\.id\s*=\s*ANY\(p_event_ids\)\s*\n?\s*AND\s+e\.tenant_id\s*=\s*p_tenant_id;/);
  assert.equal(/visible_to_members/.test(whereClauses[0]), false);
  assert.equal(/is_active/.test(whereClauses[0]), false);
  assert.equal(/\bstatus\b/.test(whereClauses[0]), false);
});

test("no ORDER BY or LIMIT inside the function -- matches the resolver's prior unordered, unlimited set read", () => {
  assert.equal(/ORDER BY/i.test(executableSql), false);
  assert.equal(/\bLIMIT\b/i.test(executableSql), false);
});

test("function ACLs are exactly intentional: PUBLIC denied, authenticated granted, anon and service_role never granted", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.get_tenant_owned_event_ids\(uuid\[\], uuid\) FROM PUBLIC;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.get_tenant_owned_event_ids\(uuid\[\], uuid\) TO authenticated;/,
  );
  assert.match(
    executableSql,
    /REVOKE EXECUTE ON FUNCTION public\.get_tenant_owned_event_ids\(uuid\[\], uuid\) FROM service_role;/,
  );
  assert.equal(/GRANT EXECUTE[\s\S]*?\banon\b/.test(executableSql), false);
});

test("does not touch Public read events or any other existing policy/grant on public.events", () => {
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ALTER TABLE public\.events/.test(executableSql), false);
  assert.equal(/\bON TABLE public\.events\b/.test(executableSql), false);
});

test("does not touch the other three governed Event read functions", () => {
  assert.equal(/get_public_discoverable_events/.test(executableSql), false);
  assert.equal(/get_event_continuity_context/.test(executableSql), false);
  assert.equal(/get_current_active_event/.test(executableSql), false);
});

test("no other domain is touched", () => {
  for (const forbidden of [
    "vendors",
    "parking_sites",
    "event_map_settings",
    "event_evaluations",
    "announcements",
    "attendees",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope`,
    );
  }
});
