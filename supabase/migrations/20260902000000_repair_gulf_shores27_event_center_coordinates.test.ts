import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260902000000_repair_gulf_shores27_event_center_coordinates.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^\s*--.*$/gm, "");

test("wraps the repair in one transaction", () => {
  assert.match(executableSql, /^\s*BEGIN;/);
  assert.match(executableSql, /COMMIT;\s*$/);
});

test("targets exactly Gulf Shores27 by id, and sets exactly the reviewed pair", () => {
  assert.match(executableSql, /c_event_id\s+constant uuid\s+:= '9106b34a-b82b-4e7f-9d64-6325fc6ca705'/);
  assert.match(executableSql, /c_event_code\s+constant text\s+:= 'GS2027'/);
  assert.match(executableSql, /c_event_name\s+constant text\s+:= 'Gulf Shores27'/);
  assert.match(executableSql, /c_target_lat\s+constant numeric := 30\.3090/);
  assert.match(executableSql, /c_target_lng\s+constant numeric := -87\.7072/);
  // exactly one bare uuid literal in the executable body (the target event)
  const uuids = executableSql.match(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/g) ?? [];
  assert.deepEqual([...new Set(uuids)].sort(), [
    "'16c39847-ce1d-43c3-b9bc-75f33e16d711'", // reviewed tenant (verified, not changed)
    "'9106b34a-b82b-4e7f-9d64-6325fc6ca705'", // target event
  ].sort());
});

test("only touches events.lat / events.lng, and only while both are NULL", () => {
  const update = executableSql.match(/UPDATE public\.events AS e\s+SET([\s\S]*?)WHERE([\s\S]*?);/);
  assert.ok(update, "expected the events UPDATE");
  const setClause = update[1];
  assert.match(setClause, /lat = c_target_lat/);
  assert.match(setClause, /lng = c_target_lng/);
  assert.doesNotMatch(setClause, /tenant_id|name|location|status|event_code|is_active|visible_to_members/);
  const whereClause = update[2];
  assert.match(whereClause, /e\.id = c_event_id/);
  assert.match(whereClause, /e\.lat IS NULL/);
  assert.match(whereClause, /e\.lng IS NULL/);
});

test("verifies row identity before writing and fails closed on any drift", () => {
  assert.match(executableSql, /v_name IS DISTINCT FROM c_event_name/);
  assert.match(executableSql, /v_code IS DISTINCT FROM c_event_code/);
  assert.match(executableSql, /v_tenant IS DISTINCT FROM c_tenant_id/);
  assert.match(executableSql, /Fail-closed: Event % identity does not match the reviewed state/);
});

test("is rerun-safe: no-op branch when already at the target, fail-closed on unexpected coords", () => {
  assert.match(executableSql, /IF v_lat IS NOT NULL OR v_lng IS NOT NULL THEN/);
  assert.match(executableSql, /already carries the reviewed coordinate pair/);
  assert.match(executableSql, /RETURN;/);
  assert.match(executableSql, /already has coordinates \(%, %\) that are not the reviewed NULL state/);
  // fresh / shadow DB replay: NOT FOUND -> NOTICE + RETURN, not an error
  assert.match(executableSql, /IF NOT FOUND THEN[\s\S]*?RAISE NOTICE 'No-op: Event % is not present[\s\S]*?RETURN;/);
});

test("self-verifies row count, target values, tenant ownership, and no collateral change", () => {
  assert.match(executableSql, /GET DIAGNOSTICS v_rows_updated = ROW_COUNT/);
  assert.match(executableSql, /v_rows_updated <> 1/);
  assert.match(executableSql, /v_lat <> c_target_lat OR v_lng <> c_target_lng/);
  assert.match(executableSql, /Post-repair: Gulf Shores27 tenant ownership changed/);
  assert.match(executableSql, /Collateral change: another Event''s coordinates changed/);
  // fingerprint is taken over every OTHER event, before and after
  const fps = executableSql.match(/WHERE e\.id <> c_event_id/g) ?? [];
  assert.ok(fps.length >= 2, "expected a before and after fingerprint over the other events");
});

test("touches no function, policy, grant, trigger, or any other table", () => {
  assert.doesNotMatch(executableSql, /CREATE (OR REPLACE )?FUNCTION/i);
  assert.doesNotMatch(executableSql, /CREATE POLICY|DROP POLICY|ALTER POLICY|CREATE TRIGGER|DROP TRIGGER/i);
  assert.doesNotMatch(executableSql, /\bGRANT\b|\bREVOKE\b/);
  assert.doesNotMatch(executableSql, /ALTER TABLE/i);
  assert.doesNotMatch(executableSql, /UPDATE public\.(?!events\b)\w+/);
  assert.doesNotMatch(executableSql, /INSERT INTO/i);
  assert.doesNotMatch(executableSql, /DELETE FROM/i);
});
