import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural assertions for the Admin Events optimistic-concurrency
// governed operations. Behavior was verified against the linked database
// in rolled-back transactions -- see the closeout report:
//
//   A  fresh baseline -> admin_save_event_details_guarded succeeds, returns row
//   B  stale baseline -> RAISE 'stale_event_details'
//   C  stale rejection -> zero Event mutation (name unchanged)
//   D  A/B: B saves state2, A's stale save rejects, B's state2 survives
//   E  NULL coordinate baseline matches NULL current -> write succeeds
//   E2 NULL expected coord vs non-NULL current (write plan) -> stale
//   F  concurrent change to a non-owned column (selected_nearby_area_id)
//      does NOT create a false Details conflict; that value is preserved
//   G  admin_save_event_assignments_guarded writes Master Map + Nearby atomically
//   H  stale Master Map baseline -> RAISE 'stale_event_assignments'
//   I  stale Nearby baseline -> RAISE 'stale_event_assignments'
//   J  stale rejection -> neither assignment mutated
//   K  NULL/cleared assignments round-trip (both directions)
//   L  authority failure (non-admin uid) -> RAISE 'unauthorized', both fns

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260907000000_create_admin_event_optimistic_save_operations.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^\s*--.*$/gm, "");

function fn(name: string) {
  const m = executableSql.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`),
  );
  assert.ok(m, `expected ${name} definition`);
  return m![0];
}

test("exactly two additive governed functions are created; no historical migration touched", () => {
  const created = [
    ...executableSql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g),
  ].map((m) => m[1]);
  assert.deepEqual(created.sort(), [
    "admin_save_event_assignments_guarded",
    "admin_save_event_details_guarded",
  ]);
});

test("no table / RLS / grant change on events or event_map_settings", () => {
  assert.equal(/CREATE TABLE|ALTER TABLE|DROP TABLE/.test(executableSql), false);
  assert.equal(/CREATE POLICY|ALTER POLICY|DROP POLICY|ENABLE ROW LEVEL SECURITY/.test(executableSql), false);
  assert.equal(/GRANT[\s\S]*?ON TABLE/.test(executableSql), false);
});

test("both functions are SECURITY DEFINER with a safe search_path, owned by postgres, EXECUTE granted only to authenticated", () => {
  for (const name of [
    "admin_save_event_details_guarded",
    "admin_save_event_assignments_guarded",
  ]) {
    const body = fn(name);
    assert.match(body, /LANGUAGE plpgsql\s*\n\s*SECURITY DEFINER\s*\n\s*SET search_path TO 'pg_catalog'/);
    assert.match(executableSql, new RegExp(`ALTER FUNCTION public\\.${name}\\([\\s\\S]*?\\)\\s*\\n?\\s*OWNER TO postgres;`));
    assert.match(executableSql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([\\s\\S]*?\\)\\s*\\n?\\s*FROM PUBLIC, anon, authenticated, service_role;`));
    assert.match(executableSql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([\\s\\S]*?\\)\\s*\\n?\\s*TO authenticated;`));
  }
});

test("authority is the exact events UPDATE RLS predicate -- has_event_admin_authority -- and auth.uid() must be present", () => {
  for (const name of [
    "admin_save_event_details_guarded",
    "admin_save_event_assignments_guarded",
  ]) {
    const body = fn(name);
    assert.match(body, /v_actor uuid := auth\.uid\(\);/);
    assert.match(body, /IF v_actor IS NULL THEN\s*\n\s*RAISE EXCEPTION 'unauthorized';/);
    assert.match(body, /IF NOT public\.has_event_admin_authority\(v_actor, p_event_id\) THEN\s*\n\s*RAISE EXCEPTION 'unauthorized';/);
    // no re-implemented / broadened authority
    assert.equal(/privilege_group|admin_users|resolve_task_authority/.test(body), false);
  }
});

test("Event Details: NULL-safe baseline compare over exactly the editor-owned columns, coordinates only when written", () => {
  const body = fn("admin_save_event_details_guarded");
  for (const col of [
    "name",
    "location",
    "start_date",
    "end_date",
    "event_code",
    "status",
    "is_active",
    "visible_to_members",
  ]) {
    assert.match(body, new RegExp(`v_current\\.${col} IS DISTINCT FROM p_expected_${col}`));
  }
  // coordinates gated on p_write_coordinates
  assert.match(
    body,
    /coalesce\(p_write_coordinates, false\)\s*\n\s*AND \(\s*\n\s*v_current\.lat IS DISTINCT FROM p_expected_lat\s*\n\s*OR v_current\.lng IS DISTINCT FROM p_expected_lng/,
  );
  assert.match(body, /RAISE EXCEPTION 'stale_event_details';/);
  // FOR UPDATE lock before the compare; SET writes lat/lng only on write plan
  assert.match(body, /FROM public\.events AS e\s*\n\s*WHERE e\.id = p_event_id\s*\n\s*FOR UPDATE;/);
  assert.match(body, /lat = CASE WHEN coalesce\(p_write_coordinates, false\) THEN p_lat ELSE e\.lat END/);
  assert.match(body, /lng = CASE WHEN coalesce\(p_write_coordinates, false\) THEN p_lng ELSE e\.lng END/);
  // never touches columns another editor owns
  assert.equal(/selected_nearby_area_id|selected_master_map_id|tenant_id/.test(body), false);
});

test("Event Assignments: single transaction, dual baseline compare, mutate-neither-or-both", () => {
  const body = fn("admin_save_event_assignments_guarded");
  // lock the Event row, read both current assignments
  assert.match(body, /FROM public\.events AS e\s*\n\s*WHERE e\.id = p_event_id\s*\n\s*FOR UPDATE;/);
  assert.match(body, /FROM public\.event_map_settings AS ems\s*\n\s*WHERE ems\.event_id = p_event_id\s*\n\s*FOR UPDATE;/);
  // both baselines checked together, NULL-safe, before any write
  assert.match(
    body,
    /IF v_current_nearby IS DISTINCT FROM p_expected_nearby_list_id\s*\n\s*OR v_current_map IS DISTINCT FROM p_expected_master_map_id\s*\n\s*THEN\s*\n\s*RAISE EXCEPTION 'stale_event_assignments';/,
  );
  const raiseIdx = body.indexOf("RAISE EXCEPTION 'stale_event_assignments'");
  const firstWriteIdx = Math.min(
    ...["UPDATE public.events", "INSERT INTO public.event_map_settings"]
      .map((s) => body.indexOf(s))
      .filter((i) => i >= 0),
  );
  assert.ok(raiseIdx >= 0 && raiseIdx < firstWriteIdx, "the stale check must precede every write");
  // both writes, same function body (one transaction)
  assert.match(body, /UPDATE public\.events AS e\s*\n\s*SET selected_nearby_area_id = p_nearby_list_id/);
  assert.match(body, /INSERT INTO public\.event_map_settings \(event_id, selected_master_map_id\)/);
  assert.match(body, /ON CONFLICT ON CONSTRAINT event_map_settings_event_id_key DO UPDATE/);
  // returns the CONFIRMED persisted values, re-read after the writes
  assert.match(body, /RETURN QUERY\s*\n\s*SELECT\s*\n\s*\(SELECT ems\.selected_master_map_id/);
});

test("Event Details returns the confirmed persisted row; assignments return the confirmed persisted pair", () => {
  assert.match(fn("admin_save_event_details_guarded"), /RETURNS public\.events/);
  assert.match(
    fn("admin_save_event_assignments_guarded"),
    /RETURNS TABLE\(persisted_master_map_id uuid, persisted_nearby_list_id uuid\)/,
  );
});

test("wrapped in a single transaction", () => {
  assert.match(executableSql, /^\s*BEGIN;/);
  assert.match(executableSql, /COMMIT;\s*$/);
});
