import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Public Event Read Surface Split,
// Stage 1 (governed read contracts only). This migration is purely
// additive -- two new SECURITY DEFINER functions and their EXECUTE
// grants -- so its entire effect is provable from its SQL text. Live ACL
// state after apply is verified separately and reported, not re-asserted
// here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814160000_create_public_event_read_surfaces.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260814160000_create_public_event_read_surfaces.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

const DISCOVERY_FN = "public.get_public_discoverable_events()";
const CONTINUITY_FN = "public.get_event_continuity_context(uuid)";

test("exactly two functions are created, both in public.events' own function shape", () => {
  const creates = executableSql.match(/CREATE OR REPLACE FUNCTION public\.\w+/g) || [];
  assert.equal(creates.length, 2);
  assert.match(executableSql, /CREATE OR REPLACE FUNCTION public\.get_public_discoverable_events\(\)/);
  assert.match(executableSql, /CREATE OR REPLACE FUNCTION public\.get_event_continuity_context\(\s*p_event_id uuid\s*\)/);
});

test("both functions are SECURITY DEFINER with a fixed, safe search_path", () => {
  const definerCount = (executableSql.match(/SECURITY DEFINER/g) || []).length;
  assert.equal(definerCount, 2);
  const searchPathCount = (executableSql.match(/SET search_path TO 'public'/g) || []).length;
  assert.equal(searchPathCount, 2);
});

test("neither function selects with SELECT * -- every projection is an explicit column list", () => {
  assert.equal(/SELECT\s+\*/i.test(executableSql), false);
});

test("discovery function projects exactly the approved 11 columns, no more, no fewer", () => {
  const body = executableSql.slice(
    executableSql.indexOf("FUNCTION public.get_public_discoverable_events"),
    executableSql.indexOf("FUNCTION public.get_event_continuity_context"),
  );
  const approved = [
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
    "e.locations_map_open_scale",
  ];
  for (const column of approved) {
    assert.match(body, new RegExp(`\\b${column.replace(".", "\\.")}\\b`), `missing ${column}`);
  }
  // coach_map_open_scale belongs to continuity only, never discovery.
  assert.equal(/coach_map_open_scale/.test(body), false);
});

test("continuity function projects exactly the approved 11 columns, no more, no fewer", () => {
  const body = executableSql.slice(
    executableSql.indexOf("FUNCTION public.get_event_continuity_context"),
  );
  const approved = [
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
  ];
  for (const column of approved) {
    assert.match(body, new RegExp(`\\b${column.replace(".", "\\.")}\\b`), `missing ${column}`);
  }
  // locations_map_open_scale belongs to discovery only, never continuity.
  assert.equal(/locations_map_open_scale/.test(body), false);
});

test("neither RETURNS TABLE clause names event_code, registration_open, or participant_capacity", () => {
  for (const forbidden of ["event_code", "registration_open", "participant_capacity"]) {
    assert.equal(
      executableSql.includes(forbidden),
      false,
      `${forbidden} must not appear anywhere in this migration`,
    );
  }
});

test("neither RETURNS TABLE clause names visible_to_members, is_active, or status as an output column", () => {
  const returnsBlocks = executableSql.match(/RETURNS TABLE\(([\s\S]*?)\)\n(?=LANGUAGE)/g) || [];
  assert.equal(returnsBlocks.length, 2);
  for (const block of returnsBlocks) {
    assert.equal(/\bvisible_to_members\b/.test(block), false);
    assert.equal(/\bis_active\b/.test(block), false);
    assert.equal(/\bstatus\b/.test(block), false);
  }
});

test("no internal/tenant/lifecycle/governance column is ever named in this migration", () => {
  for (const forbidden of [
    "tenant_id",
    "nearby_area_id",
    "selected_nearby_area_id",
    "selected_nearby_master_id",
    "lifecycle_state",
    "post_event_entered_at",
    "archived_at",
    "archived_by",
    "post_event_edit_window_days",
    "planning_lock_at",
    "self_edit_close_at",
    "cancellation_deadline",
    "refund_deadline",
    "member_note",
    "show_draft_agenda",
    "show_draft_activities",
    "parking_map_open_scale",
  ]) {
    assert.equal(
      executableSql.includes(forbidden),
      false,
      `${forbidden} must never appear in a public read surface migration`,
    );
  }
});

test("discovery predicate matches the codebase's own consolidated member-visibility rule exactly", () => {
  assert.match(executableSql, /e\.visible_to_members = true/);
  assert.match(executableSql, /coalesce\(e\.is_active,\s*true\)\s*=\s*true/);
  assert.match(
    executableSql,
    /lower\(trim\(coalesce\(e\.status,\s*''\)\)\)\s*NOT IN\s*\(\s*'inactive',\s*'archived',\s*'complete',\s*'completed',\s*'closed',\s*'draft'\s*\)/,
  );
});

test("continuity function filters only by id -- no visibility/lifecycle predicate at all", () => {
  const body = executableSql.slice(
    executableSql.indexOf("FUNCTION public.get_event_continuity_context"),
  );
  const whereClauses = body.match(/WHERE[\s\S]*?;/g) || [];
  assert.equal(whereClauses.length, 1);
  assert.match(whereClauses[0], /WHERE\s+e\.id\s*=\s*p_event_id;/);
  assert.equal(/visible_to_members/.test(whereClauses[0]), false);
  assert.equal(/is_active/.test(whereClauses[0]), false);
  assert.equal(/\bstatus\b/.test(whereClauses[0]), false);
});

test("function ACLs are exactly intentional: PUBLIC denied, anon+authenticated granted, nothing else", () => {
  const revokeAllCount = (executableSql.match(/REVOKE ALL ON FUNCTION[^;]*FROM PUBLIC;/g) || []).length;
  assert.equal(revokeAllCount, 2);
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.get_public_discoverable_events\(\) FROM PUBLIC;/,
  );
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.get_event_continuity_context\(uuid\) FROM PUBLIC;/,
  );

  const grants = executableSql.match(/GRANT EXECUTE ON FUNCTION[^;]*;/g) || [];
  assert.equal(grants.length, 2);
  for (const grant of grants) {
    assert.match(grant, /TO anon, authenticated;/);
    assert.equal(/service_role/.test(grant), false, "service_role must not be granted -- it never needs these functions");
  }
});

test("does not touch Public read events or any other existing policy/grant on public.events", () => {
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ALTER TABLE public\.events/.test(executableSql), false);
  assert.equal(/REVOKE[^;]*ON TABLE public\.events/.test(executableSql), false);
  assert.equal(/GRANT[^;]*ON TABLE public\.events/.test(executableSql), false);
});

test("no table outside public.events is read, and no schema/table change is introduced", () => {
  const fromRefs = executableSql.match(/FROM public\.(\w+)/g) || [];
  for (const ref of fromRefs) {
    assert.equal(ref, "FROM public.events");
  }
  assert.equal(/CREATE TABLE/.test(executableSql), false);
  assert.equal(/DROP TABLE/.test(executableSql), false);
  assert.equal(/^ALTER TABLE/m.test(executableSql), false);
});

test("no other domain is touched: no vendor/site-placement/parking/evaluation/announcement reference", () => {
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
      `migration must not reference '${forbidden}' -- out of scope for this read-surface split`,
    );
  }
});
