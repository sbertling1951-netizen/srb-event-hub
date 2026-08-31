import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(new URL("./20260916000000_govern_event_parking_inventory_sync.sql", import.meta.url)),
  "utf8",
);
const FIXTURE = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260916000000_govern_event_parking_inventory_sync_rollback.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const EXECUTABLE = SQL.replace(/^\s*--.*$/gm, "");

function parityBlock(source: string) {
  const start = source.indexOf("-- PARITY START");
  const end = source.indexOf("-- PARITY END", start);
  assert.notEqual(start, -1, "missing parity start");
  assert.notEqual(end, -1, "missing parity end");
  return source.slice(start, end + "-- PARITY END".length).trim();
}

function fnBody(name: string) {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = SQL.indexOf("$function$;", start);
  assert.notEqual(end, -1, `missing terminator for ${name}`);
  return SQL.slice(start, end);
}

test("the linked rollback fixture installs the exact Stage 6C parity block inside one outer rollback", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("the migration is transactional and guard-checks the world before changing anything", () => {
  assert.equal((SQL.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((SQL.match(/^COMMIT;$/gm) || []).length, 1);
  assert.match(SQL, /Stage 6C aborted: has_event_task_authority\(text,uuid\) is absent/);
  assert.match(SQL, /Stage 6C aborted: record_site_placement is absent \(must remain untouched\)/);
  assert.match(SQL, /Stage 6C aborted: materialize_event_parking_site is absent \(must remain untouched\)/);
  assert.match(SQL, /event\.parking\.manage is not an active platform\/tenant-inheriting Event task/);
  assert.match(SQL, /Stage 6C aborted: master_maps\.revision \(Stage 6B\) is absent/);
  assert.match(SQL, /Stage 6C aborted: legacy parking_sites write policies are absent or renamed/);
  assert.match(SQL, /Stage 6C aborted: parking_sites_enforce_repair_quiescence trigger is absent/);
});

test("direct browser mutation grants are revoked on parking_sites; SELECT-related grants are untouched", () => {
  assert.match(SQL, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public\.parking_sites FROM authenticated, anon;/);
  assert.doesNotMatch(EXECUTABLE, /REVOKE[^;]*SELECT[^;]*ON TABLE public\.parking_sites/);
  assert.doesNotMatch(EXECUTABLE, /REVOKE[^;]*REFERENCES[^;]*ON TABLE public\.parking_sites/);
});

test("the three legacy global-privilege_group write policies are retargeted to has_event_task_authority", () => {
  for (const cmd of ["insert", "update", "delete"]) {
    assert.match(SQL, new RegExp(`DROP POLICY IF EXISTS "Admins can ${cmd} parking sites" ON public\\.parking_sites`));
    assert.match(
      SQL,
      new RegExp(`CREATE POLICY "Event parking admins can ${cmd} parking sites"\\s*\\n\\s*ON public\\.parking_sites`),
    );
  }
  // every retargeted predicate is the canonical Event-scoped task check
  assert.equal(
    (EXECUTABLE.match(/has_event_task_authority\('event\.parking\.manage', event_id\)/g) || []).length >= 4,
    true,
  );
  const policyRegion = EXECUTABLE.slice(
    EXECUTABLE.indexOf('DROP POLICY IF EXISTS "Admins can insert parking sites"'),
    EXECUTABLE.indexOf("CREATE OR REPLACE FUNCTION public.sync_master_map_parking_inventory_to_event"),
  );
  assert.doesNotMatch(policyRegion, /privilege_group/);
});

test("the parking_sites SELECT policies are not dropped or altered", () => {
  assert.doesNotMatch(EXECUTABLE, /DROP POLICY[^;]*"Admins can view parking sites"/);
  assert.doesNotMatch(EXECUTABLE, /DROP POLICY[^;]*"public read parking_sites"/);
  assert.doesNotMatch(EXECUTABLE, /DROP POLICY[^;]*"Public read parking"/);
  assert.doesNotMatch(EXECUTABLE, /CREATE POLICY[^;]*FOR SELECT[^;]*ON public\.parking_sites/);
});

test("sync_master_map_parking_inventory_to_event is a hardened governed RPC -- authenticated EXECUTE only", () => {
  const body = fnBody("sync_master_map_parking_inventory_to_event");
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path TO 'pg_catalog'/);
  assert.match(body, /p_event_id uuid,\s*\n\s*p_expected_selected_master_map_id uuid,\s*\n\s*p_expected_map_revision integer,\s*\n\s*p_apply boolean DEFAULT false/);
  assert.match(
    SQL,
    /ALTER FUNCTION public\.sync_master_map_parking_inventory_to_event\(uuid, uuid, integer, boolean\) OWNER TO postgres/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.sync_master_map_parking_inventory_to_event\(uuid, uuid, integer, boolean\)\s*\n\s*FROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.sync_master_map_parking_inventory_to_event\(uuid, uuid, integer, boolean\)\s*\n\s*TO authenticated;/,
  );
});

test("authority is the canonical Event-scoped task check; an unknown Event fails closed", () => {
  const body = fnBody("sync_master_map_parking_inventory_to_event");
  assert.match(body, /IF v_actor IS NULL THEN\s*\n\s*RAISE EXCEPTION 'unauthorized';/);
  assert.match(
    body,
    /IF NOT public\.has_event_task_authority\('event\.parking\.manage', p_event_id\) THEN\s*\n\s*RAISE EXCEPTION 'authorization_denied';/,
  );
  assert.doesNotMatch(body.replace(/^\s*--.*$/gm, ""), /privilege_group/);
});

test("stale-source protection: selected map + master_maps.revision are compare-and-swapped, and re-checked under lock on apply", () => {
  const body = fnBody("sync_master_map_parking_inventory_to_event");
  assert.match(body, /'no_selected_master_map'/);
  assert.match(body, /v_selected IS DISTINCT FROM p_expected_selected_master_map_id THEN[\s\S]{0,120}'stale_selected_map'/);
  assert.match(body, /v_map\.revision IS DISTINCT FROM p_expected_map_revision THEN[\s\S]{0,120}'stale_master_map'/);
  // apply re-verifies both after acquiring the row locks
  const applyRegion = body.slice(body.indexOf("IF p_apply THEN"));
  assert.match(applyRegion, /v_selected_recheck IS DISTINCT FROM v_selected THEN[\s\S]{0,120}'stale_selected_map'/);
  assert.match(applyRegion, /v_rev_recheck IS DISTINCT FROM v_map\.revision THEN[\s\S]{0,120}'stale_master_map'/);
});

test("apply locks every Event parking row FOR UPDATE in the same canonical order record_site_placement uses -- no attendee lock, no lock-order cycle", () => {
  const body = fnBody("sync_master_map_parking_inventory_to_event");
  assert.match(
    body,
    /PERFORM 1\s*\n\s*FROM public\.parking_sites\s*\n\s*WHERE event_id = p_event_id\s*\n\s*ORDER BY id::text\s*\n\s*FOR UPDATE;/,
  );
  // the sync itself never locks or writes attendees
  assert.doesNotMatch(body, /public\.attendees[^\n]*FOR UPDATE/);
  assert.doesNotMatch(body, /UPDATE public\.attendees/);
});

test("the sync NEVER mutates occupancy, the projection, or the placement ledger", () => {
  const body = fnBody("sync_master_map_parking_inventory_to_event");
  assert.doesNotMatch(body, /assigned_attendee_id\s*=/);
  assert.doesNotMatch(body, /assigned_site/);
  assert.doesNotMatch(body, /site_placement_history/);
  assert.doesNotMatch(body, /event_placement_sequence/);
  assert.doesNotMatch(body, /_allocate_event_placement_sequence/);
  // and it never deletes a parking_sites row -- orphans are report-only
  assert.doesNotMatch(body, /DELETE FROM public\.parking_sites/);
});

test("occupied rows: display fields may be reconciled/relinked but site_number is never changed -- a renumber is a conflict", () => {
  const body = fnBody("sync_master_map_parking_inventory_to_event");
  assert.match(body, /'occupied_renumber'/);
  // the occupied branches build reconcile_display / relink_display plans (no site_number key)
  assert.match(body, /'kind', 'reconcile_display'[\s\S]{0,200}'map_image_url', v_map\.map_image_url/);
  assert.match(body, /'kind', 'relink_display'[\s\S]{0,220}'map_image_url', v_map\.map_image_url/);
  // only the VACANT plans carry site_number
  assert.match(body, /'kind', 'reconcile_full'[\s\S]{0,120}'site_number', v_cur_mms\.site_number/);
  assert.match(body, /'kind', 'relink_full'[\s\S]{0,160}'site_number', v_target_mms\.site_number/);
});

test("successor-map identity reconciliation: exactly one candidate relinks; ambiguity is a conflict; zero candidates fall through to orphan", () => {
  const body = fnBody("sync_master_map_parking_inventory_to_event");
  assert.match(body, /v_map\.map_group IS NOT NULL\s*\n\s*AND v_old_group IS NOT DISTINCT FROM v_map\.map_group/);
  assert.match(body, /lower\(btrim\(site_number\)\) = v_norm/);
  assert.match(body, /IF v_cand_count = 1 AND v_old_dupes = 1 THEN/);
  assert.match(body, /'successor_collision'/);
  assert.match(body, /ELSIF v_cand_count > 1 OR v_old_dupes <> 1 THEN[\s\S]{0,320}'ambiguous_successor_match'/);
  // relink is allowed to update master_site_id even on an occupied row
  assert.match(body, /'kind', 'relink_display', 'id', r\.id, 'master_site_id', v_cands\[1\]/);
});

test("orphan / manual behavior: vacant orphan is counted (report-only), occupied orphan is a conflict, manual rows are skipped", () => {
  const body = fnBody("sync_master_map_parking_inventory_to_event");
  assert.match(body, /IF r\.master_site_id IS NULL THEN\s*\n\s*v_manual := v_manual \+ 1;\s*\n\s*CONTINUE;/);
  assert.match(body, /'occupied_orphan'/);
  assert.match(body, /ELSE\s*\n\s*v_orphan_vacant := v_orphan_vacant \+ 1;/);
});

test("apply is all-or-nothing: any conflict aborts with zero mutation", () => {
  const body = fnBody("sync_master_map_parking_inventory_to_event");
  assert.match(
    body,
    /IF jsonb_array_length\(v_conflicts\) > 0 THEN\s*\n\s*RETURN QUERY SELECT 'rejected'::text, 'unresolved_conflicts'::text/,
  );
  // preview returns before any mutation
  assert.match(body, /IF NOT p_apply THEN\s*\n\s*RETURN QUERY SELECT 'previewed'::text/);
  // the mutation statements come only after the conflict gate
  const iGate = body.indexOf("'unresolved_conflicts'");
  const iForeach = body.indexOf("FOREACH v_action IN ARRAY v_plan LOOP");
  const iInsert = body.indexOf("INSERT INTO public.parking_sites");
  assert.ok(iGate > 0 && iForeach > iGate && iInsert > iForeach);
});

test("the bulk add reuses materialize_event_parking_site's ON CONFLICT target and add-only shape", () => {
  const body = fnBody("sync_master_map_parking_inventory_to_event");
  assert.match(
    body,
    /INSERT INTO public\.parking_sites \(\s*\n\s*event_id, master_site_id, site_number, display_label, map_x, map_y, map_image_url\s*\n\s*\)/,
  );
  assert.match(body, /ON CONFLICT \(event_id, master_site_id\) WHERE master_site_id IS NOT NULL DO NOTHING/);
});

test("Stage 6C does not touch record_site_placement, materialize_event_parking_site, or the repair/quiescence machinery", () => {
  assert.doesNotMatch(EXECUTABLE, /CREATE OR REPLACE FUNCTION public\.record_site_placement/);
  assert.doesNotMatch(EXECUTABLE, /CREATE OR REPLACE FUNCTION public\.materialize_event_parking_site/);
  assert.doesNotMatch(EXECUTABLE, /DROP FUNCTION[^;]*record_site_placement/);
  assert.doesNotMatch(EXECUTABLE, /CREATE (OR REPLACE )?FUNCTION public\.enforce_parking_repair_quiescence/);
  assert.doesNotMatch(EXECUTABLE, /CREATE TRIGGER[^;]*parking_sites/);
  for (const forbidden of ["parking_repair", "master_site_identity_correction", "copy_master_map_to_event"]) {
    assert.equal(
      EXECUTABLE.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope`,
    );
  }
  // parking_inventory_quiescence is referenced ONLY by the guard block (a comment-stripped trigger-presence check), never mutated
  assert.doesNotMatch(EXECUTABLE, /INTO public\.parking_inventory_quiescence|FROM public\.parking_inventory_quiescence/);
});

test("event.parking.manage authority model is asserted, not re-implemented", () => {
  assert.match(SQL, /platform_inherits IS TRUE AND tenant_inherits IS TRUE/);
  assert.doesNotMatch(EXECUTABLE, /CREATE OR REPLACE FUNCTION public\.(resolve_task_authority|has_event_task_authority)/);
});

test("the linked proof covers authority inheritance, stale source, occupancy preservation, successor relink, conflicts, orphans, and idempotency", () => {
  for (const evidence of [
    "an explicit event.parking.manage grant authorizes the sync",
    "a platform admin inherits event.parking.manage for the sync",
    "a legacy global privilege_group=parking value alone does NOT authorize a sync",
    "an admin holding event.parking.manage on another Event is denied on this Event",
    "anonymous caller cannot sync -- unauthorized",
    "a wrong expected selected-map id is refused as stale_selected_map",
    "a wrong expected map revision is refused as stale_master_map",
    "an Event with no selected master map is refused as no_selected_master_map",
    "preview does not mutate any parking_sites row",
    "apply with unresolved conflicts is rejected",
    "a rejected apply leaves every parking_sites row untouched (no partial mutation)",
    "occupied exact-match row: occupancy + notes + site_number kept; display fields reconciled",
    "attendees.assigned_site projection is NEVER touched by a sync -- still the placement-time label",
    "occupied successor row: master_site_id relinked to the current map; occupancy + notes unchanged",
    "site_placement_history is never written by a sync",
    "vacant exact row resynced; vacant successor row relinked to the selected map",
    "a selected-map site with no Event row materializes as a vacant row",
    "a manual (master_site_id IS NULL) row is left completely untouched",
    "a second apply is a no-op -- the sync is idempotent",
    "Event C settled at 6 rows (5 original + materialized A4); nothing deleted",
    "no browser role retains a direct INSERT/UPDATE/DELETE grant on parking_sites",
    "the legacy global privilege_group write policies are gone",
    "the three retargeted write policies require has_event_task_authority",
    "the SELECT policies are deliberately left untouched",
    "record_site_placement and materialize_event_parking_site remain present and authenticated-executable",
  ]) {
    assert.ok(FIXTURE.includes(evidence), `linked fixture must prove: ${evidence}`);
  }
});
