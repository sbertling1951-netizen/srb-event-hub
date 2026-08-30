import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(new URL("./20260915000000_govern_platform_map_asset_lifecycle.sql", import.meta.url)),
  "utf8",
);
const FIXTURE = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260915000000_platform_map_asset_lifecycle_rollback.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

function parityBlock(source: string) {
  const start = source.indexOf("-- PARITY START");
  const end = source.indexOf("-- PARITY END", start);
  assert.notEqual(start, -1, "missing parity start");
  assert.notEqual(end, -1, "missing parity end");
  return source.slice(start, end + "-- PARITY END".length).trim();
}

function fn(name: string) {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = SQL.indexOf("$function$;", start);
  assert.notEqual(end, -1, `missing terminator for ${name}`);
  return SQL.slice(start, end);
}

const EXECUTABLE = SQL.replace(/^\s*--.*$/gm, "");

test("the linked rollback fixture installs the exact Stage 6B parity block inside one outer rollback", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("the migration is transactional and guard-checks Stage 6A + the legacy policies before changing anything", () => {
  assert.equal((SQL.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((SQL.match(/^COMMIT;$/gm) || []).length, 1);
  assert.match(SQL, /Stage 6B aborted: has_platform_admin_authority\(uuid\) is absent/);
  assert.match(SQL, /Stage 6B aborted: Stage 6A admin_save_event_assignments_guarded is absent/);
  assert.match(SQL, /event\.definition\.manage is not an active platform-inheriting Event task/);
  assert.match(SQL, /Stage 6A event_map_settings policies are absent or renamed/);
  assert.match(SQL, /legacy master_maps write policies are absent or renamed/);
  assert.match(SQL, /legacy master_map_sites write policies are absent or renamed/);
});

test("canonical mutation authority is retargeted from global privilege_group to has_platform_admin_authority", () => {
  // the legacy global-role policies are dropped
  assert.match(SQL, /DROP POLICY IF EXISTS "Admins can insert master maps" ON public\.master_maps/);
  assert.match(SQL, /DROP POLICY IF EXISTS "Admins can update master maps" ON public\.master_maps/);
  assert.match(SQL, /DROP POLICY IF EXISTS "Admins can insert master map sites" ON public\.master_map_sites/);
  assert.match(SQL, /DROP POLICY IF EXISTS "Admins can update master map sites" ON public\.master_map_sites/);
  assert.match(SQL, /DROP POLICY IF EXISTS "Admins can delete master map sites" ON public\.master_map_sites/);
  // the five replacements all require platform authority
  assert.equal(
    (SQL.match(/CREATE POLICY "Platform admins can [a-z ]+master map[s]?[a-z ]*"\s*\n\s*ON public\.master_map/g) || []).length,
    5,
  );
  assert.equal(
    (EXECUTABLE.match(/has_platform_admin_authority\(auth\.uid\(\)\)/g) || []).length >= 5,
    true,
  );
  // no retargeted policy body still references privilege_group
  const policyRegion = EXECUTABLE.slice(
    EXECUTABLE.indexOf('DROP POLICY IF EXISTS "Admins can insert master maps"'),
    EXECUTABLE.indexOf("assert_platform_map_authority_and_lock"),
  );
  assert.doesNotMatch(policyRegion, /privilege_group/);
});

test("direct browser mutation grants are revoked on both tables; SELECT is untouched", () => {
  assert.match(SQL, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public\.master_maps FROM authenticated, anon;/);
  assert.match(SQL, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public\.master_map_sites FROM authenticated, anon;/);
  assert.doesNotMatch(EXECUTABLE, /REVOKE[^;]*SELECT[^;]*ON TABLE public\.master_maps/);
  assert.doesNotMatch(EXECUTABLE, /DROP POLICY[^;]*"public read master_maps"/);
  assert.doesNotMatch(EXECUTABLE, /DROP POLICY[^;]*"Admins can view master maps"/);
});

test("no DELETE policy is added to master_maps -- hard delete stays unavailable", () => {
  assert.doesNotMatch(EXECUTABLE, /CREATE POLICY[^;]*ON public\.master_maps[\s\S]{0,80}FOR DELETE/);
  assert.doesNotMatch(EXECUTABLE, /GRANT DELETE ON TABLE public\.master_maps/);
});

test("every canonical mutation RPC enforces has_platform_admin_authority and is a hardened governed RPC", () => {
  for (const name of [
    "assert_platform_map_authority_and_lock",
    "create_master_map",
    "create_master_map_draft_from",
    "update_master_map_details",
    "set_master_map_image",
    "apply_master_map_marker_changes",
    "archive_master_map",
    "restore_master_map",
    "publish_master_map",
  ]) {
    const body = fn(name);
    assert.match(body, /SECURITY DEFINER/, `${name} SECURITY DEFINER`);
    assert.match(body, /SET search_path TO 'pg_catalog'/, `${name} search_path`);
    // platform authority is asserted directly, or via the locked helper
    assert.match(
      body,
      /has_platform_admin_authority|assert_platform_map_authority_and_lock/,
      `${name} platform authority`,
    );
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${name}\\([^)]*\\) OWNER TO postgres`), `${name} owner`);
    assert.match(
      SQL,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role`),
      `${name} revoke-all`,
    );
  }
  // the internal helper is REVOKE-only (never granted); the 8 browser RPCs are granted to authenticated only
  assert.doesNotMatch(SQL, /GRANT EXECUTE ON FUNCTION public\.assert_platform_map_authority_and_lock/);
  for (const name of [
    "create_master_map",
    "create_master_map_draft_from",
    "update_master_map_details",
    "set_master_map_image",
    "apply_master_map_marker_changes",
    "archive_master_map",
    "restore_master_map",
    "publish_master_map",
  ]) {
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\)\\s*\\n?\\s*TO authenticated;`), `${name} grant`);
  }
});

test("lifecycle transitions are enforced inside the RPCs -- published/read-only is not directly editable", () => {
  for (const name of ["update_master_map_details", "set_master_map_image", "apply_master_map_marker_changes"]) {
    assert.match(fn(name), /v_row\.status <> 'draft'[\s\S]{0,60}master_map_not_draft/, `${name} draft-only`);
  }
  assert.match(fn("archive_master_map"), /status = 'archived',\s*\n\s*is_read_only = true/);
  assert.match(fn("restore_master_map"), /v_row\.status <> 'archived'[\s\S]{0,60}master_map_not_archived/);
  assert.match(fn("restore_master_map"), /status = 'draft',\s*\n\s*is_read_only = false/);
  assert.match(fn("publish_master_map"), /status = 'published',\s*\n\s*is_read_only = true/);
});

test("concurrency: every map mutation compare-and-swaps master_maps.revision under FOR UPDATE and advances it", () => {
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0/);
  const helper = fn("assert_platform_map_authority_and_lock");
  assert.match(helper, /FROM public\.master_maps WHERE id = p_map_id FOR UPDATE/);
  assert.match(helper, /v_row\.revision IS DISTINCT FROM p_expected_revision THEN\s*\n\s*RAISE EXCEPTION 'stale_master_map'/);
  for (const name of ["update_master_map_details", "set_master_map_image", "apply_master_map_marker_changes", "archive_master_map", "restore_master_map"]) {
    assert.match(fn(name), /assert_platform_map_authority_and_lock\(p_map_id, p_expected_revision\)/, `${name} locks + checks revision`);
    assert.match(fn(name), /revision = v_row\.revision \+ 1/, `${name} advances revision`);
  }
  assert.match(fn("publish_master_map"), /v_draft\.revision IS DISTINCT FROM p_expected_draft_revision THEN\s*\n\s*RAISE EXCEPTION 'stale_master_map'/);
});

test("the atomic marker-save contract handles add + update + delete in one function transaction", () => {
  const body = fn("apply_master_map_marker_changes");
  assert.match(body, /p_adds jsonb DEFAULT '\[\]'::jsonb/);
  assert.match(body, /p_updates jsonb DEFAULT '\[\]'::jsonb/);
  assert.match(body, /p_delete_ids uuid\[\] DEFAULT ARRAY\[\]::uuid\[\]/);
  assert.match(body, /DELETE FROM public\.master_map_sites\s*\n\s*WHERE master_map_id = p_map_id\s*\n\s*AND id = ANY \(p_delete_ids\)/);
  assert.match(body, /jsonb_to_recordset\(p_updates\)/);
  assert.match(body, /jsonb_to_recordset\(p_adds\)/);
  assert.match(body, /site_count = \(SELECT count\(\*\) FROM public\.master_map_sites WHERE master_map_id = p_map_id\)/);
  // no per-marker RPC and no direct browser marker mutation is added
  assert.doesNotMatch(SQL, /master_map_add_marker|master_map_delete_marker\b/);
});

test("archive / restore do NOT touch event_map_settings -- only publish_master_map migrates Event references", () => {
  assert.doesNotMatch(fn("archive_master_map"), /event_map_settings/);
  assert.doesNotMatch(fn("restore_master_map"), /event_map_settings/);
  const pub = fn("publish_master_map");
  assert.match(pub, /UPDATE public\.event_map_settings\s*\n\s*SET selected_master_map_id = v_draft\.id/);
  assert.match(pub, /WHERE selected_master_map_id = p_expected_superseded_map_id/);
  // deterministic, all-or-nothing: it resolves the CURRENT published map and
  // rejects a mismatched expectation rather than silently doing a subset
  assert.match(pub, /stale_master_map_publish_target/);
  assert.match(pub, /RETURNS TABLE\(published_map_id uuid, superseded_map_id uuid, events_reassigned integer\)/);
  // deterministic lock order on the two maps
  assert.match(pub, /p_draft_map_id < p_expected_superseded_map_id/);
  assert.match(pub, /FOR UPDATE/);
});

test("Stage 6A is preserved -- admin_save_event_assignments_guarded and its policies are only guard-checked, never altered", () => {
  assert.doesNotMatch(EXECUTABLE, /CREATE OR REPLACE FUNCTION public\.admin_save_event_assignments_guarded/);
  assert.doesNotMatch(EXECUTABLE, /DROP FUNCTION[^;]*admin_save_event_assignments_guarded/);
  assert.doesNotMatch(EXECUTABLE, /(CREATE|DROP) POLICY[^;]*event_map_settings/);
  assert.doesNotMatch(EXECUTABLE, /ALTER TABLE public\.event_map_settings/);
  // publish relies on platform authority which INHERITS event.definition.manage
  assert.match(SQL, /platform_inherits IS TRUE/);
  assert.match(SQL, /inherits event\.definition\.manage/i);
});

test("parking / Stage 6C are untouched; copy_master_map_to_event EXECUTE is closed but the object is retained", () => {
  assert.doesNotMatch(EXECUTABLE, /parking_sites/);
  assert.doesNotMatch(EXECUTABLE, /record_site_placement|materialize_event_parking_site/);
  assert.doesNotMatch(EXECUTABLE, /(CREATE OR REPLACE|DROP) FUNCTION public\.copy_master_map_to_event/);
  // authenticated EXECUTE is closed; service_role EXECUTE is deliberately left in place
  assert.match(SQL, /REVOKE EXECUTE ON FUNCTION public\.copy_master_map_to_event\(uuid, uuid\) FROM authenticated;/);
  assert.doesNotMatch(EXECUTABLE, /REVOKE EXECUTE ON FUNCTION public\.copy_master_map_to_event[^;]*service_role/);
});

test("the linked proof covers authority, lifecycle, atomicity, concurrency, Event migration, and Stage 6A", () => {
  for (const evidence of [
    "create_master_map yields a draft at revision 0",
    "a stale expected_revision raises stale_master_map",
    "apply_master_map_marker_changes applies add + partial update + delete atomically in one call",
    "a published map is read-only",
    "update_master_map_details refuses a published map (master_map_not_draft)",
    "publish_master_map supersedes the prior published version and reassigns exactly the referencing Events",
    "promotion is coherent: superseded archived, replacement published, Event repointed -- all in one transaction",
    "publish_master_map rejects a wrong superseded-map expectation",
    "a rejected publish leaves the draft untouched (no partial promotion)",
    "archive/restore never migrate Event assignments",
    "' cannot create_master_map'",
    "' cannot archive_master_map'",
    "' cannot apply_master_map_marker_changes'",
    "' cannot publish_master_map'",
    "no browser role retains a direct INSERT/UPDATE/DELETE grant on the platform-map tables",
    "the legacy global privilege_group write policies are gone",
    "the five retargeted write policies require has_platform_admin_authority",
    "the public / admin SELECT policies are deliberately untouched",
    "Stage 6A event_map_settings policies and admin_save_event_assignments_guarded are intact",
    "no DELETE policy exists on master_maps -- hard delete remains unavailable",
    "copy_master_map_to_event EXECUTE is closed for authenticated and anon",
  ]) {
    assert.ok(FIXTURE.includes(evidence), `linked fixture must prove: ${evidence}`);
  }
});
