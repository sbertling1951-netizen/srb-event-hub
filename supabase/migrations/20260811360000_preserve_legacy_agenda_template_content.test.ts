import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Reconstruction-branch guard test. This migration is a production-data
// preservation historical operation. The 2026-08-29 reproducible-database-
// history reconstruction added a fresh/shadow no-op guard so it replays
// cleanly on a database that never held the legacy Agenda-template content
// it exists to preserve, while remaining fail-closed on partial state.

const SQL = readFileSync(
  fileURLToPath(new URL("./20260811360000_preserve_legacy_agenda_template_content.sql", import.meta.url)),
  "utf8",
);

test("has an explicit fresh/shadow no-op path that RAISE NOTICE + RETURN", () => {
  assert.match(SQL, /FRESH \/ SHADOW-DATABASE REPLAY GUARD/);
  assert.match(
    SQL,
    /IF NOT EXISTS \(SELECT 1 FROM public\.agenda_templates\)\s*\n\s*AND NOT EXISTS \(SELECT 1 FROM public\.agenda_template_sets\)\s*\n\s*AND NOT EXISTS \(SELECT 1 FROM public\.agenda_template_items\)\s*\n\s*AND NOT EXISTS \(SELECT 1 FROM public\.agenda_template_categories\)\s*\n\s*THEN\s*\n\s*RAISE NOTICE[^\n]*replay-safe no-op[\s\S]*?RETURN;\s*\n\s*END IF;/,
  );
});

test("the no-op requires COMPLETE absence of the relevant legacy target set (all four tables)", () => {
  const guard = SQL.slice(SQL.indexOf("FRESH / SHADOW-DATABASE REPLAY GUARD"), SQL.indexOf("RETURN;") + 8);
  for (const t of ["agenda_templates", "agenda_template_sets", "agenda_template_items", "agenda_template_categories"]) {
    assert.match(guard, new RegExp(`NOT EXISTS \\(SELECT 1 FROM public\\.${t}\\)`), `guard must require public.${t} empty`);
  }
  // conjunction, never disjunction -- one populated table blocks the no-op
  assert.doesNotMatch(guard, /\bOR NOT EXISTS\b/);
});

test("partial legacy state does NOT pass through the no-op -- the guard is a plain conjunction of emptiness checks", () => {
  // there is exactly one RETURN inside the DO block (the guard); the rest of
  // the original body is unchanged and still runs when any table has a row
  const doBlock = SQL.slice(SQL.indexOf("BEGIN"), SQL.lastIndexOf("END;"));
  assert.equal((doBlock.match(/\n\s*RETURN;/g) || []).length, 1, "exactly one RETURN -- the fresh/shadow guard");
});

test("the original preservation body is unchanged -- hardcoded ids, inserts, and idempotency guards all still present", () => {
  assert.match(SQL, /v_fcoc_tenant_id uuid := '16c39847-ce1d-43c3-b9bc-75f33e16d711';/);
  assert.match(SQL, /INSERT INTO public\.agenda_template_roots\(scope, tenant_id, title, description, lifecycle_status, created_by_auth_user_id\)/);
  assert.match(SQL, /'Standard FCOC Event Template'/);
  assert.match(SQL, /'Default Rally Agenda'/);
  assert.match(SQL, /'Basic Agenda'/);
  // the original per-source idempotency guards remain
  assert.match(SQL, /IF NOT EXISTS \(\s*\n\s*SELECT 1 FROM public\.agenda_legacy_preservation_record\s*\n\s*WHERE legacy_source_table = 'agenda_template_sets'/);
});

test("no NEW hardcoded production data is inserted to make replay work; no authority/RLS change", () => {
  // the guard adds only NOT EXISTS checks + RAISE NOTICE + RETURN
  const added = SQL.slice(SQL.indexOf("FRESH / SHADOW-DATABASE REPLAY GUARD"), SQL.indexOf("Root A:"));
  assert.doesNotMatch(added, /INSERT INTO|UPDATE .* SET|CREATE POLICY|GRANT|REVOKE|ENABLE ROW LEVEL SECURITY|has_platform_admin_authority/);
  // the guard seeds nothing -- it only reads catalog/table emptiness
  assert.doesNotMatch(added, /'[0-9a-f]{8}-[0-9a-f]{4}-/);
});
