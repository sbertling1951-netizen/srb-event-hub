import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(new URL("./20261023000000_repair_legacy_stored_area_template_parent_links.sql", import.meta.url)),
  "utf8",
);
const FIXTURE = readFileSync(
  fileURLToPath(new URL("../integration-tests/20261023000000_legacy_stored_area_template_parent_links_rollback.sql", import.meta.url)),
  "utf8",
);

function parityBlock(source: string) {
  const start = source.indexOf("-- PARITY START:");
  const end = source.indexOf("-- PARITY END", start);
  assert.notEqual(start, -1, "missing parity start");
  assert.notEqual(end, -1, "missing parity end");
  return source.slice(start, end + "-- PARITY END".length).trim();
}

test("linked rollback fixture installs the exact pending Stored Area parent-link repair inside one outer rollback", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("the repair function only ever targets nearby_area_id IS NULL rows -- a non-null link is never selected as an update target", () => {
  // Both UPDATE statements on nearby_area_templates must carry the
  // "AND nearby_area_id IS NULL" guard in their own WHERE clause.
  const updates = [...SQL.matchAll(/UPDATE public\.nearby_area_templates[\s\S]*?;/g)].map((m) => m[0]);
  assert.equal(updates.length, 2, "expected exactly two UPDATE statements (approved-mapping link, fresh-parent link)");
  for (const stmt of updates) {
    assert.match(stmt, /AND nearby_area_id IS NULL/);
  }
  // Every SELECT that resolves rows to act on is scoped the same way.
  assert.match(SQL, /FROM public\.nearby_area_templates\s+WHERE nearby_area_id IS NULL/);
});

test("the two approved mappings are named explicitly, not inferred from a general name-match rule", () => {
  assert.match(SQL, /ARRAY\['branson, mo', 'saint george, ut'\]/);
  // The unexpected-collision guard explicitly excludes exactly these two
  // names from the "any collision aborts" rule -- no other name is ever
  // exempted.
  assert.match(SQL, /NOT IN \('branson, mo', 'saint george, ut'\)/);
});

test("fail-closed guards exist for blank names, duplicate names, unexpected collisions, and an ambiguous/missing approved parent", () => {
  assert.match(SQL, /stored_area_parent_link_repair_blank_name/);
  assert.match(SQL, /stored_area_parent_link_repair_duplicate_name/);
  assert.match(SQL, /stored_area_parent_link_repair_unexpected_collision/);
  assert.match(SQL, /stored_area_parent_link_repair_approved_mapping_ambiguous/);
  // Each guard is a real RAISE EXCEPTION, not merely a comment.
  for (const code of [
    "stored_area_parent_link_repair_blank_name",
    "stored_area_parent_link_repair_duplicate_name",
    "stored_area_parent_link_repair_unexpected_collision",
    "stored_area_parent_link_repair_approved_mapping_ambiguous",
  ]) {
    const idx = SQL.indexOf(code);
    const nearby = SQL.slice(Math.max(0, idx - 200), idx);
    assert.match(nearby, /RAISE EXCEPTION/);
  }
});

test("fresh-parent creation copies only the template's own normalized name and description, matching create_stored_area's own normalization", () => {
  assert.match(SQL, /INSERT INTO public\.nearby_areas \(name, description\)\s*\n\s*VALUES \(\s*\n\s*nullif\(btrim\(v_fresh_row\.name\), ''\),\s*\n\s*nullif\(btrim\(v_fresh_row\.description\), ''\)/);
});

test("this migration never touches events, event_map_settings, parking_sites, nearby_master, nearby_master_places, nearby_event, or master_map_sites", () => {
  const forbidden = [
    /UPDATE public\.events\b/,
    /INSERT INTO public\.events\b/,
    /DELETE FROM public\.events\b/,
    /public\.event_map_settings\b/,
    /public\.parking_sites\b/,
    /public\.nearby_master\b/,
    /public\.nearby_master_places\b/,
    /public\.nearby_event\b/,
    /public\.master_map_sites\b/,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(SQL, pattern, `migration must not reference ${pattern}`);
  }
});

test("the existing FK, RLS, and grant posture on nearby_area_templates are not modified", () => {
  assert.doesNotMatch(SQL, /DROP CONSTRAINT nearby_area_templates_nearby_area_id_fkey/);
  assert.doesNotMatch(SQL, /ALTER TABLE public\.nearby_area_templates[\s\S]*?ON DELETE/);
  assert.doesNotMatch(SQL, /CREATE POLICY|DROP POLICY|ALTER TABLE.*ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(SQL, /GRANT [A-Z, ]+ ON TABLE public\.nearby_area(s|_templates)?\b/);
});

test("the repair function is revoked from PUBLIC and dropped again before commit -- no new persistent, browser-reachable surface", () => {
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.repair_legacy_stored_area_template_parent_links\(\) FROM PUBLIC;/);
  assert.match(SQL, /DROP FUNCTION public\.repair_legacy_stored_area_template_parent_links\(\);/);
  assert.doesNotMatch(SQL, /GRANT EXECUTE ON FUNCTION public\.repair_legacy_stored_area_template_parent_links/);
});

test("the whole repair is one atomic transaction -- no nested COMMIT, no savepoint release inside the migration itself", () => {
  assert.equal((SQL.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((SQL.match(/^COMMIT;$/gm) || []).length, 1);
  assert.doesNotMatch(SQL, /SAVEPOINT/);
});
