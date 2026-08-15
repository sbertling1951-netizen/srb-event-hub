import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the ADR-006 §3.2 initial-establishment
// / current active Event bootstrap RPC.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814190000_create_current_active_event_context_rpc.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260814190000_create_current_active_event_context_rpc.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("creates exactly one function, get_current_active_event()", () => {
  const creates = executableSql.match(/CREATE OR REPLACE FUNCTION public\.\w+/g) || [];
  assert.equal(creates.length, 1);
  assert.match(executableSql, /CREATE OR REPLACE FUNCTION public\.get_current_active_event\(\)/);
});

test("SECURITY DEFINER with a fixed, safe search_path", () => {
  assert.match(executableSql, /SECURITY DEFINER/);
  assert.match(executableSql, /SET search_path TO 'public'/);
});

test("no SELECT * -- explicit column list only", () => {
  assert.equal(/SELECT\s+\*/i.test(executableSql), false);
});

test("projects exactly the 8 columns proven needed by locations.tsx and getActiveEvent.ts's fallback, no more", () => {
  const returnsMatch = executableSql.match(/RETURNS TABLE\(([\s\S]*?)\)\n(?=LANGUAGE)/);
  assert.ok(returnsMatch);
  const columns = returnsMatch[1]
    .split(",")
    .map((c) => c.trim().split(/\s+/)[0])
    .filter(Boolean);
  assert.deepEqual(columns, [
    "id",
    "name",
    "location",
    "start_date",
    "end_date",
    "map_image_url",
    "master_map_id",
    "locations_map_open_scale",
  ]);
});

test("predicate is is_active = true only -- no visible_to_members or status denylist, no is_master_map", () => {
  const whereClauses = executableSql.match(/WHERE[\s\S]*?;/g) || [];
  assert.equal(whereClauses.length, 1);
  assert.match(whereClauses[0], /WHERE\s+e\.is_active\s*=\s*true;/);
  assert.equal(/visible_to_members/.test(whereClauses[0]), false);
  assert.equal(/\bstatus\b/.test(whereClauses[0]), false);
  assert.equal(/is_master_map/.test(whereClauses[0]), false);
});

test("no ORDER BY or LIMIT inside the function -- matches both consumers' current unordered .limit(1) behavior", () => {
  assert.equal(/ORDER BY/i.test(executableSql), false);
  assert.equal(/\bLIMIT\b/i.test(executableSql), false);
});

test("function ACLs are exactly intentional: PUBLIC denied, anon+authenticated granted, service_role explicitly revoked", () => {
  assert.match(executableSql, /REVOKE ALL ON FUNCTION public\.get_current_active_event\(\) FROM PUBLIC;/);
  assert.match(executableSql, /GRANT EXECUTE ON FUNCTION public\.get_current_active_event\(\) TO anon, authenticated;/);
  assert.match(executableSql, /REVOKE EXECUTE ON FUNCTION public\.get_current_active_event\(\) FROM service_role;/);
});

test("does not touch Public read events or any other existing policy/grant on public.events", () => {
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ALTER TABLE public\.events/.test(executableSql), false);
  assert.equal(/ON TABLE public\.events/.test(executableSql), false);
});

test("does not touch the other two governed functions", () => {
  assert.equal(/get_public_discoverable_events/.test(executableSql), false);
  assert.equal(/get_event_continuity_context/.test(executableSql), false);
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
