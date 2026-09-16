import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(new URL("./20261024000000_retire_branson_legacy_duplicate_parking_site.sql", import.meta.url)),
  "utf8",
);
const FIXTURE = readFileSync(
  fileURLToPath(new URL("../integration-tests/20261024000000_retire_branson_legacy_duplicate_parking_site_rollback.sql", import.meta.url)),
  "utf8",
);

function parityBlock(source: string) {
  const start = source.indexOf("-- PARITY START:");
  const end = source.indexOf("-- PARITY END", start);
  assert.notEqual(start, -1, "missing parity start");
  assert.notEqual(end, -1, "missing parity end");
  return source.slice(start, end + "-- PARITY END".length).trim();
}

test("linked rollback fixture installs the exact pending Branson parking retirement inside one outer rollback", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("the retirement targets exactly one hardcoded production row -- not a broad name, label, or all-null-links heuristic", () => {
  // Exactly four uuid literals: event, target, survivor, canonical site.
  const uuidLiterals = SQL.match(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/g) || [];
  assert.equal(uuidLiterals.length, 4, `expected exactly 4 hardcoded uuid literals, found ${uuidLiterals.length}`);
  assert.match(SQL, /v_event_id CONSTANT uuid :=/);
  assert.match(SQL, /v_target_id CONSTANT uuid :=/);
  assert.match(SQL, /v_survivor_id CONSTANT uuid :=/);
  assert.match(SQL, /v_canonical_master_site_id CONSTANT uuid :=/);
  // No name/display-label/site_number driven WHERE clause selects the target.
  assert.doesNotMatch(SQL, /WHERE\s+name\s+(ilike|like|=)/i);
  assert.doesNotMatch(SQL, /WHERE\s+display_label\s+(ilike|like|=)/i);
  // The only DELETE in the file targets the id constant, never a broader predicate.
  const deletes = [...SQL.matchAll(/DELETE FROM public\.parking_sites[\s\S]*?;/g)].map((m) => m[0]);
  assert.equal(deletes.length, 1, "expected exactly one DELETE statement");
  assert.match(deletes[0], /WHERE id = v_target_id;/);
});

test("the function is idempotent -- absent target is a harmless RETURN, not an error", () => {
  assert.match(SQL, /IF NOT FOUND THEN\s*\n\s*RETURN;\s*\n\s*END IF;/);
});

test("every fail-closed guard exists as a real RAISE EXCEPTION, not merely a comment", () => {
  const codes = [
    "branson_parking_duplicate_retirement_event_mismatch",
    "branson_parking_duplicate_retirement_target_occupied",
    "branson_parking_duplicate_retirement_target_linked",
    "branson_parking_duplicate_retirement_survivor_missing",
    "branson_parking_duplicate_retirement_survivor_event_mismatch",
    "branson_parking_duplicate_retirement_survivor_occupied",
    "branson_parking_duplicate_retirement_survivor_relink",
    "branson_parking_duplicate_retirement_canonical_site_unresolved",
    "branson_parking_duplicate_retirement_metadata_mismatch",
    "branson_parking_duplicate_retirement_history_reference",
    "branson_parking_duplicate_retirement_identity_correction_reference",
  ];
  for (const code of codes) {
    const idx = SQL.indexOf(code);
    assert.notEqual(idx, -1, `missing guard code ${code}`);
    const nearby = SQL.slice(Math.max(0, idx - 200), idx);
    assert.match(nearby, /RAISE EXCEPTION/, `guard ${code} must be a real RAISE EXCEPTION`);
  }
});

test("the history guard checks all four site_placement_history parking-site columns", () => {
  const historyBlock = SQL.slice(
    SQL.indexOf("Guard 11"),
    SQL.indexOf("Guard 12"),
  );
  for (const column of ["previous_site_id", "resulting_site_id", "requested_site_id", "displaced_previous_site_id"]) {
    assert.match(historyBlock, new RegExp(`sph\\.${column} = v_target_id`));
  }
});

test("the identity-correction guard checks master_site_identity_correction.parking_site_id", () => {
  const guardBlock = SQL.slice(SQL.indexOf("Guard 12"));
  assert.match(guardBlock, /FROM public\.master_site_identity_correction AS msc/);
  assert.match(guardBlock, /msc\.parking_site_id = v_target_id/);
});

test("the metadata guard requires all four fields (site_number, display_label, map_x, map_y) to match the canonical site", () => {
  const guardBlock = SQL.slice(SQL.indexOf("Guard 10"), SQL.indexOf("Guard 11"));
  for (const field of ["site_number", "display_label", "map_x", "map_y"]) {
    assert.match(guardBlock, new RegExp(`mms\\.${field} IS NOT DISTINCT FROM v_target\\.${field}`));
  }
});

test("the canonical-site guard re-resolves the site against the Event's currently-selected map, never assumed from the survivor link alone", () => {
  const guardBlock = SQL.slice(SQL.indexOf("Guard 9"), SQL.indexOf("Guard 10"));
  assert.match(guardBlock, /JOIN public\.event_map_settings AS ems ON ems\.selected_master_map_id = mms\.master_map_id/);
  assert.match(guardBlock, /ems\.event_id = v_event_id/);
});

test("exactly one row is ever deleted, and only after every guard passes", () => {
  assert.equal((SQL.match(/DELETE FROM/g) || []).length, 1);
  assert.doesNotMatch(SQL, /INSERT INTO/);
  assert.doesNotMatch(SQL, /UPDATE public\./);
});

test("this migration never touches Master Maps, master_map_sites (write), event_map_settings (write), Nearby data, or attendees", () => {
  // Read-only references to master_map_sites/event_map_settings (the
  // guards) are expected and allowed; only a write would be a violation.
  assert.doesNotMatch(SQL, /INSERT INTO public\.master_map_sites/);
  assert.doesNotMatch(SQL, /UPDATE public\.master_map_sites/);
  assert.doesNotMatch(SQL, /DELETE FROM public\.master_map_sites/);
  assert.doesNotMatch(SQL, /INSERT INTO public\.master_maps/);
  assert.doesNotMatch(SQL, /UPDATE public\.master_maps/);
  assert.doesNotMatch(SQL, /DELETE FROM public\.master_maps/);
  assert.doesNotMatch(SQL, /INSERT INTO public\.event_map_settings/);
  assert.doesNotMatch(SQL, /UPDATE public\.event_map_settings/);
  assert.doesNotMatch(SQL, /DELETE FROM public\.event_map_settings/);
  assert.doesNotMatch(SQL, /public\.nearby_area/);
  assert.doesNotMatch(SQL, /public\.attendees\b/);
  assert.doesNotMatch(SQL, /public\.events\b/);
});

test("the existing FK/RLS/grant posture on parking_sites is not modified", () => {
  assert.doesNotMatch(SQL, /DROP CONSTRAINT/);
  assert.doesNotMatch(SQL, /ALTER TABLE public\.parking_sites/);
  assert.doesNotMatch(SQL, /CREATE POLICY|DROP POLICY|ALTER TABLE.*ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(SQL, /GRANT [A-Z, ]+ ON TABLE public\.parking_sites\b/);
});

test("the repair function is revoked from PUBLIC and dropped again before commit -- no new persistent, browser-reachable surface", () => {
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.retire_branson_legacy_duplicate_parking_site\(\) FROM PUBLIC;/);
  assert.match(SQL, /DROP FUNCTION public\.retire_branson_legacy_duplicate_parking_site\(\);/);
  assert.doesNotMatch(SQL, /GRANT EXECUTE ON FUNCTION public\.retire_branson_legacy_duplicate_parking_site/);
});

test("sync_master_map_parking_inventory_to_event is never invoked by this migration", () => {
  // The name may appear in the explanatory header comment (documenting
  // why it is NOT the repair mechanism here); only an actual call --
  // SELECT/PERFORM of the function -- would be a real invocation.
  assert.doesNotMatch(SQL, /(?:SELECT|PERFORM)\s+public\.sync_master_map_parking_inventory_to_event\s*\(/);
});

test("the whole repair is one atomic transaction -- no nested COMMIT, no savepoint release inside the migration itself", () => {
  assert.equal((SQL.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((SQL.match(/^COMMIT;$/gm) || []).length, 1);
  assert.doesNotMatch(SQL, /SAVEPOINT/);
});
