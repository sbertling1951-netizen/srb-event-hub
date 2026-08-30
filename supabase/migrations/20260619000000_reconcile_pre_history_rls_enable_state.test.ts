import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(new URL("./20260619000000_reconcile_pre_history_rls_enable_state.sql", import.meta.url)),
  "utf8",
);
const FIXTURE = readFileSync(
  fileURLToPath(
    new URL("../integration-tests/20260619000000_pre_history_rls_enable_state_rollback.sql", import.meta.url),
  ),
  "utf8",
);
const MIGRATIONS_DIR = fileURLToPath(new URL(".", import.meta.url));
const CODE = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

// AUTHORITATIVE 47-table list -- tables where the read-only production
// schema dump shows RLS enabled and the migration history does not.
const AUTHORITATIVE_47 = [
  "activities", "activity_registrations", "admin_event_access", "admin_event_permissions",
  "admin_permission_audit", "admin_permission_presets", "admin_permissions",
  "admin_privilege_group_permissions", "admin_users", "agenda_categories", "agenda_items",
  "announcements", "area_groups", "attendee_activities", "attendee_household_members", "attendees",
  "engagement_activity", "evaluation_choices", "evaluation_questions", "evaluation_templates",
  "event_import_rows", "event_locations", "event_map_settings", "event_nearby_places",
  "event_photo_metadata", "event_print_settings", "events", "imports", "master_map_locations",
  "master_map_sites", "master_maps", "nearby_area_templates", "nearby_areas", "nearby_categories",
  "nearby_event", "nearby_master", "nearby_master_places", "nearby_places", "nearby_template_places",
  "parking_sites", "participant_activity_log", "photo_display_log", "shared_area_locations",
  "test_connection", "user_roles", "validation_rules", "vendor_services",
];
// GROUP 2 -- production: RLS enabled AND zero policies -> deny-all.
const GROUP_2_DENY_ALL = [
  "admin_event_permissions", "admin_permission_presets", "evaluation_templates",
  "evaluation_questions", "evaluation_choices", "event_photo_metadata", "photo_display_log",
];

function parityBlock(s: string) {
  const a = s.indexOf("-- PARITY START:");
  const b = s.indexOf("-- PARITY END", a);
  assert.notEqual(a, -1);
  assert.notEqual(b, -1);
  return s.slice(a, b + "-- PARITY END".length).trim();
}
function tableArray() {
  const start = SQL.indexOf("c_tables constant text[] := ARRAY[");
  const end = SQL.indexOf("];", start);
  return [...SQL.slice(start, end).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

test("1. the fixed table list is exactly the 47 authoritative production tables", () => {
  const list = tableArray();
  assert.equal(list.length, 47, `expected 47 tables, got ${list.length}`);
  assert.deepEqual([...list].sort(), [...AUTHORITATIVE_47].sort());
  assert.deepEqual(list, [...list].sort(), "list must be deterministic (alphabetical)");
});

test("2. no extra table is added by inference", () => {
  for (const t of tableArray()) {
    assert.ok(AUTHORITATIVE_47.includes(t), `public.${t} not in the authoritative 47`);
  }
  assert.equal(new Set(tableArray()).size, 47);
});

test("the loop only issues ENABLE ROW LEVEL SECURITY, existence-guarded, and fails closed if a table is missing", () => {
  assert.match(CODE, /FOREACH v_t IN ARRAY c_tables LOOP/);
  assert.match(CODE, /IF to_regclass\('public\.' \|\| quote_ident\(v_t\)\) IS NOT NULL THEN\s*\n\s*EXECUTE format\('ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY', v_t\);/);
  assert.match(CODE, /RAISE EXCEPTION 'pre-history RLS reconciliation: expected table public\.% is missing'/);
});

test("3. never DISABLEs RLS", () => {
  assert.doesNotMatch(SQL, /DISABLE ROW LEVEL SECURITY/i);
});

test("4. never introduces FORCE ROW LEVEL SECURITY", () => {
  assert.doesNotMatch(CODE, /FORCE ROW LEVEL SECURITY/i);
});

test("5+7. changes NO policy, function, grant, constraint, table structure, or authority predicate", () => {
  assert.doesNotMatch(CODE, /CREATE POLICY|DROP POLICY|ALTER POLICY/);
  assert.doesNotMatch(CODE, /CREATE (OR REPLACE )?FUNCTION public\.|DROP FUNCTION|ALTER FUNCTION/);
  assert.doesNotMatch(CODE, /\bGRANT\b|\bREVOKE\b/);
  assert.doesNotMatch(CODE, /CREATE TABLE|DROP TABLE|ADD COLUMN|DROP COLUMN|ADD CONSTRAINT|DROP CONSTRAINT|CREATE INDEX|DROP INDEX/);
  assert.doesNotMatch(CODE, /has_platform_admin_authority|has_event_task_authority|is_current_admin|is_super_admin|auth\.uid/);
  assert.doesNotMatch(CODE, /INSERT INTO|UPDATE .* SET|DELETE FROM|'[0-9a-f]{8}-[0-9a-f]{4}-/);
});

test("serial 20260619000000 sorts immediately after 20260618_add_evaluations", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const idx = files.indexOf("20260619000000_reconcile_pre_history_rls_enable_state.sql");
  assert.ok(idx >= 0);
  assert.equal(files[idx - 1], "20260618_add_evaluations.sql");
});

test("header forbids production execution and points at the ledger-only reconciliation", () => {
  assert.match(SQL, /DO NOT EXECUTE THIS HISTORICAL RECONCILIATION MIGRATION AGAINST THE/);
  assert.match(SQL, /ESTABLISHED PRODUCTION DATABASE/);
  assert.match(SQL, /migration repair --linked --status applied 20260619000000/);
  assert.match(SQL, /Do NOT do that now/);
});

test("linked rollback fixture carries the byte-identical parity block inside one outer ROLLBACK", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("linked proof fixture proves relrowsecurity, the deny-all Group-2 posture, and Group-1 activation", () => {
  for (const t of GROUP_2_DENY_ALL) assert.ok(FIXTURE.includes(t), `fixture must reference Group-2 table ${t}`);
  for (const evidence of [
    "all 47 authoritative tables report relrowsecurity = true after this migration",
    "Group-2 tables (RLS enabled, zero policies) remain deny-all",
    "Group-1 governed policies become effective once RLS is enabled",
    "no table outside the authoritative 47 changed its relrowsecurity",
    "no relforcerowsecurity was set",
    "pre-history rls enable-state reconciliation rollback left residue",
  ]) {
    assert.ok(FIXTURE.includes(evidence), `fixture must prove: ${evidence}`);
  }
});
