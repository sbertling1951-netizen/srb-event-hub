import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for adding short_name to
// get_event_continuity_context. 20260814160000 (the function's original
// creation) is already applied and immutable, so its own test continues
// to describe its original 11-column shape unchanged; this file
// describes the current, drop-and-recreated definition. CREATE OR
// REPLACE was attempted first and rejected live by PostgreSQL
// ("cannot change return type of existing function", SQLSTATE 42P13) --
// this migration uses DROP FUNCTION + CREATE FUNCTION instead, and must
// therefore re-state the full ACL DROP FUNCTION erases.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814180000_add_short_name_to_event_continuity_context.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260814180000_add_short_name_to_event_continuity_context.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("drops then recreates exactly get_event_continuity_context(uuid), no other function", () => {
  assert.match(executableSql, /DROP FUNCTION public\.get_event_continuity_context\(uuid\);/);
  const creates = executableSql.match(/CREATE FUNCTION public\.\w+/g) || [];
  assert.equal(creates.length, 1);
  assert.match(executableSql, /CREATE FUNCTION public\.get_event_continuity_context\(\s*p_event_id uuid\s*\)/);
  assert.equal(/CREATE OR REPLACE/.test(executableSql), false, "CREATE OR REPLACE is rejected by Postgres for this exact change -- must not be reintroduced");
});

test("DROP precedes CREATE", () => {
  assert.ok(executableSql.indexOf("DROP FUNCTION") < executableSql.indexOf("CREATE FUNCTION"));
});

test("short_name is appended as the last column -- every prior column and its order is unchanged", () => {
  const returnsMatch = executableSql.match(/RETURNS TABLE\(([\s\S]*?)\)\n(?=LANGUAGE)/);
  assert.ok(returnsMatch);
  const columns = returnsMatch[1]
    .split(",")
    .map((c) => c.trim().split(/\s+/)[0])
    .filter(Boolean);
  assert.deepEqual(columns, [
    "id",
    "name",
    "venue_name",
    "location",
    "start_date",
    "end_date",
    "lat",
    "lng",
    "map_image_url",
    "master_map_id",
    "coach_map_open_scale",
    "short_name",
  ]);
});

test("SELECT list appends e.short_name last, matching the RETURNS TABLE order", () => {
  const selectMatch = executableSql.match(/SELECT\s+([\s\S]*?)\s+FROM public\.events e/);
  assert.ok(selectMatch);
  const selected = selectMatch[1]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  assert.deepEqual(selected, [
    "e.id",
    "e.name",
    "e.venue_name",
    "e.location",
    "e.start_date",
    "e.end_date",
    "e.lat",
    "e.lng",
    "e.map_image_url",
    "e.master_map_id",
    "e.coach_map_open_scale",
    "e.short_name",
  ]);
});

test("predicate is unchanged: WHERE id = p_event_id only, no visibility/lifecycle filter added", () => {
  const whereClauses = executableSql.match(/WHERE[\s\S]*?;/g) || [];
  assert.equal(whereClauses.length, 1);
  assert.match(whereClauses[0], /WHERE\s+e\.id\s*=\s*p_event_id;/);
  assert.equal(/visible_to_members/.test(whereClauses[0]), false);
  assert.equal(/is_active/.test(whereClauses[0]), false);
});

test("SECURITY DEFINER and search_path are unchanged", () => {
  assert.match(executableSql, /SECURITY DEFINER/);
  assert.match(executableSql, /SET search_path TO 'public'/);
});

test("full ACL is explicitly re-stated: PUBLIC denied, anon+authenticated granted, service_role revoked", () => {
  assert.match(executableSql, /REVOKE ALL ON FUNCTION public\.get_event_continuity_context\(uuid\) FROM PUBLIC;/);
  assert.match(executableSql, /GRANT EXECUTE ON FUNCTION public\.get_event_continuity_context\(uuid\) TO anon, authenticated;/);
  assert.match(executableSql, /REVOKE EXECUTE ON FUNCTION public\.get_event_continuity_context\(uuid\) FROM service_role;/);
});

test("no other function, table, policy, or grant is touched", () => {
  assert.equal(/get_public_discoverable_events/.test(executableSql), false);
  assert.equal(/get_current_active_event/.test(executableSql), false);
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ON TABLE/.test(executableSql), false);
});
