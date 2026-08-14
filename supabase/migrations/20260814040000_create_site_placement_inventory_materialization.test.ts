import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for Site Placement Inventory
// Materialization Governance. Behavioral proof (authorized/unauthorized
// materialization, cross-Event/cross-map rejection, idempotent replay,
// concurrent-duplicate safety via the unique index, no occupancy
// change) was executed live by running this migration's own SQL inside
// a transaction that was rolled back -- nothing committed, matching the
// commit gate. See the accompanying report for that evidence.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814040000_create_site_placement_inventory_materialization.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814040000_create_site_placement_inventory_materialization.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^\s*--.*$/gm, "");

function extractFunctionBody(sql: string, name: string): string {
  const pattern = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$ *;`);
  const match = sql.match(pattern);
  assert.ok(match, `expected to find function body for ${name}`);
  return match![0];
}

test("no public.assert_event_lifecycle_mutable call exists anywhere -- Authority only, no Lifecycle guard", () => {
  assert.equal(/assert_event_lifecycle_mutable/.test(executableSql), false);
});

test("actor is derived from auth.uid() and checked for NULL before anything else", () => {
  const body = extractFunctionBody(executableSql, "materialize_event_parking_site");
  const iActor = body.indexOf("v_actor uuid := auth.uid();");
  const iNullCheck = body.indexOf("IF v_actor IS NULL THEN");
  assert.ok(iActor >= 0 && iNullCheck > iActor);
});

test("Authority uses only the canonical has_event_task_authority primitive with the two canonical task keys -- never client-side can_assign_parking or a raw privilege_group check", () => {
  const body = extractFunctionBody(executableSql, "materialize_event_parking_site");
  assert.match(body, /has_event_task_authority\('event\.parking\.manage', p_event_id\)/);
  assert.match(body, /has_event_task_authority\('event\.checkin\.manage', p_event_id\)/);
  assert.equal(/can_assign_parking/.test(body), false);
  assert.equal(/privilege_group/.test(body), false);
});

test("Authority is established before the master-site lookup, the selected-map check, and the INSERT", () => {
  const body = extractFunctionBody(executableSql, "materialize_event_parking_site");
  const iAuthority = body.indexOf("v_has_full := public.has_event_task_authority(");
  const iMasterLookup = body.indexOf("SELECT * INTO v_master_site");
  const iInsert = body.indexOf("INSERT INTO public.parking_sites");
  assert.ok(iAuthority >= 0 && iMasterLookup > iAuthority && iInsert > iMasterLookup);
});

test("the operation validates the master site belongs to the Event's currently selected master map, rejecting with the spec's own site_not_in_selected_map code", () => {
  const body = extractFunctionBody(executableSql, "materialize_event_parking_site");
  assert.match(body, /v_selected_master_map_id IS NULL OR v_selected_master_map_id <> v_master_site\.master_map_id/);
  assert.match(body, /'site_not_in_selected_map'/);
});

test("a nonexistent master site is rejected with master_site_not_found before any insert is attempted", () => {
  const body = extractFunctionBody(executableSql, "materialize_event_parking_site");
  const iNotFound = body.indexOf("'master_site_not_found'");
  const iInsert = body.indexOf("INSERT INTO public.parking_sites");
  assert.ok(iNotFound >= 0 && iInsert > iNotFound);
});

test("the INSERT never sets assigned_attendee_id -- materialization creates a vacant row only", () => {
  const body = extractFunctionBody(executableSql, "materialize_event_parking_site");
  const insertStatement = body.match(/INSERT INTO public\.parking_sites \([\s\S]*?\)\s*VALUES/);
  assert.ok(insertStatement);
  assert.equal(/assigned_attendee_id/.test(insertStatement![0]), false);
});

test("materialization is idempotent via ON CONFLICT DO NOTHING against the unique index, then reselects the existing row -- never a raised duplicate-key error", () => {
  const body = extractFunctionBody(executableSql, "materialize_event_parking_site");
  assert.match(body, /ON CONFLICT \(event_id, master_site_id\) WHERE master_site_id IS NOT NULL DO NOTHING/);
  assert.match(body, /'already_materialized'/);
});

test("record_site_placement is never called from inside this operation", () => {
  const body = extractFunctionBody(executableSql, "materialize_event_parking_site");
  assert.equal(/record_site_placement/.test(body), false);
});

test("the concurrency backstop is a real unique index, not only an RPC-level check, scoped to rows that actually reference a master site", () => {
  assert.match(
    executableSql,
    /CREATE UNIQUE INDEX parking_sites_event_master_site_unique\s*\n\s*ON public\.parking_sites \(event_id, master_site_id\)\s*\n\s*WHERE master_site_id IS NOT NULL;/,
  );
});

test("materialize_event_parking_site is executable only by authenticated -- not anon, not service_role, not PUBLIC", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.materialize_event_parking_site\(uuid, uuid\)\s*\nFROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.materialize_event_parking_site\(uuid, uuid\)\s*\nTO authenticated;/,
  );
});

test("no table grant is revoked or granted -- this migration does not touch parking_sites direct-write privileges", () => {
  assert.equal(/REVOKE[^;]*ON TABLE public\.parking_sites/.test(executableSql), false);
  assert.equal(/GRANT[^;]*ON TABLE public\.parking_sites/.test(executableSql), false);
});

test("repair/correction machinery is completely untouched", () => {
  for (const forbidden of [
    "parking_repair",
    "master_site_identity_correction",
    "parking_inventory_quiescence",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this workstream`,
    );
  }
});

test("no unrelated domain is touched", () => {
  for (const forbidden of ["agenda_items", "event_photos", "announcements", "event_evaluations", "site_placement_history"]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this workstream`,
    );
  }
});
