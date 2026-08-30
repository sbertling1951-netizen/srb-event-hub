import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Reconstruction-branch guard test. This migration retires the legacy
// Agenda-template schema after 20260811360000 preserved its content. The
// 2026-08-29 reproducible-database-history reconstruction added a
// fresh/shadow no-op guard to its precondition DO block so it replays
// cleanly on a database that never held that legacy content -- while its
// exact-count assertions still run (unchanged) on the historical
// production path, and the destructive DDL still converges the schema.

const SQL = readFileSync(
  fileURLToPath(new URL("./20260811370000_retire_legacy_agenda_template_schema.sql", import.meta.url)),
  "utf8",
);

test("the precondition DO block has an explicit fresh/shadow no-op path", () => {
  assert.match(SQL, /FRESH \/ SHADOW-DATABASE REPLAY GUARD/);
  assert.match(SQL, /RAISE NOTICE[^\n]*replay-safe no-op on precondition checks[\s\S]*?RETURN;\s*\n\s*END IF;/);
});

test("the no-op requires COMPLETE absence of legacy AND preservation state", () => {
  const guard = SQL.slice(SQL.indexOf("FRESH / SHADOW-DATABASE REPLAY GUARD"), SQL.indexOf("RETURN;") + 8);
  for (const t of [
    "agenda_templates", "agenda_template_sets", "agenda_template_items", "agenda_template_categories",
    "agenda_template_roots", "agenda_template_revisions", "agenda_legacy_preservation_record",
  ]) {
    assert.match(guard, new RegExp(`NOT EXISTS \\(SELECT 1 FROM public\\.${t}\\)`), `guard must require public.${t} empty`);
  }
  assert.match(guard, /NOT EXISTS \(SELECT 1 FROM public\.events WHERE assigned_agenda_template_id IS NOT NULL\)/);
  assert.doesNotMatch(guard, /\bOR NOT EXISTS\b/);
});

test("the original exact-count assertions are UNCHANGED (not weakened to comparisons)", () => {
  assert.match(SQL, /IF v_count <> 1 THEN\s*\n\s*RAISE EXCEPTION 'STOP: expected exactly 1 Event with non-null assigned_agenda_template_id/);
  assert.match(SQL, /IF v_count <> 12 THEN\s*\n\s*RAISE EXCEPTION 'STOP: expected agenda_template_items = 12/);
  assert.match(SQL, /IF v_count <> 5 THEN\s*\n\s*RAISE EXCEPTION 'STOP: expected agenda_template_categories = 5/);
  assert.match(SQL, /IF v_count <> 2 THEN\s*\n\s*RAISE EXCEPTION 'STOP: expected agenda_template_sets = 2/);
  assert.match(SQL, /IF v_count <> 2 THEN\s*\n\s*RAISE EXCEPTION 'STOP: expected agenda_templates = 2/);
  assert.match(SQL, /IF v_count <> 3 THEN\s*\n\s*RAISE EXCEPTION 'STOP: expected 3 canonical roots/);
  assert.match(SQL, /IF v_count <> 17 THEN\s*\n\s*RAISE EXCEPTION 'STOP: expected 17 preservation records/);
  // no assertion was turned into >= / <= / BETWEEN
  assert.doesNotMatch(SQL, /v_count (>=|<=|BETWEEN)/);
});

test("partial state fails closed -- exactly one RETURN, the destructive DDL is unchanged and still runs", () => {
  const doBlock = SQL.slice(SQL.indexOf("DO $$"), SQL.indexOf("$$;"));
  assert.equal((doBlock.match(/\n\s*RETURN;/g) || []).length, 1, "exactly one RETURN -- the fresh/shadow guard");
  // the schema-retirement DDL after the DO block is byte-unchanged
  assert.match(SQL, /ALTER TABLE public\.events DROP CONSTRAINT events_assigned_agenda_template_id_fkey;\s*\nALTER TABLE public\.events DROP COLUMN assigned_agenda_template_id;/);
  assert.match(SQL, /DROP TABLE public\.agenda_template_items;/);
  assert.match(SQL, /DROP TABLE public\.agenda_templates;/);
});

test("no NEW hardcoded data, no authority/RLS change -- the guard only reads emptiness", () => {
  const added = SQL.slice(SQL.indexOf("FRESH / SHADOW-DATABASE REPLAY GUARD"), SQL.indexOf("Step A precondition"));
  assert.doesNotMatch(added, /INSERT INTO|UPDATE .* SET|CREATE POLICY|GRANT|REVOKE|ENABLE ROW LEVEL SECURITY|has_platform_admin_authority/);
  assert.doesNotMatch(added, /'[0-9a-f]{8}-[0-9a-f]{4}-/);
});
