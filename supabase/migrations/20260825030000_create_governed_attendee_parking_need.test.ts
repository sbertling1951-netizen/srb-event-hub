import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260825030000_create_governed_attendee_parking_need.sql", import.meta.url),
  ),
  "utf8",
);
const FIXTURE = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260825030000_attendee_parking_need_rollback.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const ATTENDEE_IMPORT_SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260822110000_create_governed_attendee_import_row_commit.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const EXECUTABLE_SQL = SQL.replace(/^\s*--.*$/gm, "");

function parityBlock(source: string) {
  const start = source.indexOf("-- PARITY START:");
  const end = source.indexOf("-- PARITY END", start);
  assert.notEqual(start, -1, "missing parity start");
  assert.notEqual(end, -1, "missing parity end");
  return source.slice(start, end + "-- PARITY END".length).trim();
}

function functionBody(source: string, name: string) {
  const start = source.indexOf(`FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = source.indexOf("$function$;", start);
  assert.notEqual(end, -1, `missing ${name} terminator`);
  return source.slice(start, end + "$function$;".length);
}

test("linked rollback fixture installs the exact pending parking-need command inside one outer rollback", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("set_attendee_parking_need accepts only attendee identity and an explicit boolean intent", () => {
  const body = functionBody(EXECUTABLE_SQL, "set_attendee_parking_need");
  assert.match(
    body,
    /FUNCTION public\.set_attendee_parking_need\(\s*p_attendee_id uuid,\s*p_needs_parking boolean\s*\)/,
  );
  assert.doesNotMatch(body, /p_event_id|p_tenant_id|p_actor|p_assigned_site/);
  assert.match(body, /p_attendee_id IS NULL OR p_needs_parking IS NULL/);
  assert.match(body, /RAISE EXCEPTION 'parking_need_required'/);
});

test("manual and governed attendee-import creation both defer an unspecified parking need to the canonical database default", () => {
  const importInsert = ATTENDEE_IMPORT_SQL.match(
    /INSERT INTO public\.attendees\([\s\S]*?\)\s*VALUES\([\s\S]*?\) RETURNING \*/,
  )?.[0];
  assert.ok(importInsert, "missing governed attendee-import INSERT");
  assert.doesNotMatch(importInsert, /needs_parking/);
  assert.match(
    FIXTURE,
    /manual and governed-import default creation both persist Needs Parking/,
  );
});

test("the command derives Event scope from the locked attendee row and authorizes only event.attendees.manage", () => {
  const body = functionBody(EXECUTABLE_SQL, "set_attendee_parking_need");
  assert.match(body, /SELECT a\.event_id, a\.needs_parking[\s\S]*?FROM public\.attendees AS a[\s\S]*?WHERE a\.id = p_attendee_id[\s\S]*?FOR UPDATE/);
  assert.match(body, /has_event_task_authority\('event\.attendees\.manage', v_event_id\)/);
  assert.doesNotMatch(body, /event\.parking\.manage|event\.checkin\.manage/);
  const authority = body.indexOf("has_event_task_authority(");
  const lifecycle = body.indexOf("assert_event_lifecycle_mutable(v_event_id)");
  const mutation = body.indexOf("UPDATE public.attendees AS a");
  assert.ok(authority >= 0 && lifecycle > authority && mutation > lifecycle);
});

test("the command fails closed for a canonical parking assignment before a false transition", () => {
  const body = functionBody(EXECUTABLE_SQL, "set_attendee_parking_need");
  assert.match(body, /p_needs_parking = false AND EXISTS \([\s\S]*?FROM public\.parking_sites AS ps[\s\S]*?ps\.event_id = v_event_id[\s\S]*?ps\.assigned_attendee_id = p_attendee_id/);
  assert.match(body, /RAISE EXCEPTION 'parking_assignment_must_be_removed_first'/);
  assert.match(body, /Remove this attendee''s parking assignment in Parking/);
  assert.doesNotMatch(body, /UPDATE public\.parking_sites|DELETE FROM public\.parking_sites/);
});

test("the only attendee mutation is needs_parking, with a no-write idempotent branch", () => {
  const body = functionBody(EXECUTABLE_SQL, "set_attendee_parking_need");
  const updateStart = body.indexOf("UPDATE public.attendees AS a");
  const updateEnd = body.indexOf("RETURNING", updateStart);
  const update = body.slice(updateStart, updateEnd);
  assert.match(update, /SET needs_parking = p_needs_parking/);
  for (const forbidden of ["has_arrived", "assigned_site", "share_with_attendees"]) {
    assert.equal(update.includes(forbidden), false, `${forbidden} must not be updated`);
  }
  assert.match(body, /v_current_needs_parking IS NOT DISTINCT FROM p_needs_parking/);
  assert.match(body, /SELECT 'unchanged'::text, v_event_id, p_attendee_id, v_current_needs_parking/);
});

test("the command is security-definer with a fixed path and authenticated-only execution", () => {
  assert.match(EXECUTABLE_SQL, /SECURITY DEFINER\s*\nSET search_path TO 'pg_catalog'/);
  assert.match(
    EXECUTABLE_SQL,
    /REVOKE ALL ON FUNCTION public\.set_attendee_parking_need\(uuid, boolean\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.match(
    EXECUTABLE_SQL,
    /GRANT EXECUTE ON FUNCTION public\.set_attendee_parking_need\(uuid, boolean\)\s*\n\s*TO authenticated;/,
  );
});

test("fixture proves defaults, bidirectional intent changes, Parking conflict denial, authority, lifecycle, summary semantics, and cleanup", () => {
  for (const evidence of [
    "manual and governed-import default creation both persist Needs Parking",
    "unplaced true to false changes only parking intent",
    "unplaced false to true changes only parking intent",
    "placed true to false is rejected and leaves Arrival, legacy projection, and canonical placement untouched",
    "authority is derived from the attendee Event and cannot cross Events",
    "null requested parking need is rejected",
    "missing attendee is rejected",
    "archived Event lifecycle denial leaves parking need untouched",
    "parking need RPC grants are authenticated-only",
    "Attendee parking-need fixture rollback left residue",
  ]) {
    assert.match(FIXTURE, new RegExp(evidence));
  }
});
