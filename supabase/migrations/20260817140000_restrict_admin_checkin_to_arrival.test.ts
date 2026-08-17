import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(
    new URL("./20260817140000_restrict_admin_checkin_to_arrival.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = sql.replace(/^\s*--.*$/gm, "");

function extractFunctionBody(source: string, name: string): string {
  const pattern = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$ *;`,
  );
  const match = source.match(pattern);
  assert.ok(match, `expected to find function body for ${name}`);
  return match![0];
}

test("the old 8-parameter placement-carrying signature is dropped, not overloaded", () => {
  assert.match(
    executableSql,
    /DROP FUNCTION IF EXISTS public\.complete_admin_checkin\(uuid, uuid, boolean, boolean, text, uuid, uuid, boolean\);/,
  );
});

test("the new signature accepts exactly the four Arrival-owned parameters -- no placement parameter of any kind", () => {
  const body = extractFunctionBody(executableSql, "complete_admin_checkin");
  assert.match(
    body,
    /CREATE FUNCTION public\.complete_admin_checkin\(\s*p_attendee_id uuid,\s*p_expected_event_id uuid,\s*p_has_arrived boolean,\s*p_share_with_attendees boolean\s*\)/,
  );
  for (const removed of [
    "p_placement_action",
    "p_site_id",
    "p_placement_idempotency_key",
    "p_override_occupied_site",
  ]) {
    assert.equal(body.includes(removed), false, `${removed} must not remain`);
  }
});

test("record_site_placement is never invoked -- Arrival never composes placement", () => {
  assert.equal(/record_site_placement/.test(executableSql), false);
});

test("attendees.assigned_site is never written by this function", () => {
  const body = extractFunctionBody(executableSql, "complete_admin_checkin");
  assert.equal(/assigned_site/.test(body), false);
});

test("only event.checkin.manage authorizes -- event.parking.manage is not an alternate basis for Arrival", () => {
  const body = extractFunctionBody(executableSql, "complete_admin_checkin");
  assert.match(body, /has_event_task_authority\('event\.checkin\.manage', v_event_id\)/);
  assert.equal(/event\.parking\.manage/.test(body), false);
});

test("Authority is established, then Event scope, then Lifecycle, before the Arrival mutation -- in that order", () => {
  const body = extractFunctionBody(executableSql, "complete_admin_checkin");
  const iAuthority = body.indexOf("has_event_task_authority(");
  const iScope = body.indexOf("v_event_id <> p_expected_event_id");
  const iLifecycle = body.indexOf("assert_event_lifecycle_mutable(v_event_id)");
  const iMutation = body.indexOf("UPDATE public.attendees");
  assert.ok(
    iAuthority >= 0 &&
      iScope > iAuthority &&
      iLifecycle > iScope &&
      iMutation > iLifecycle,
  );
});

test("the Arrival mutation only ever sets Arrival-owned columns", () => {
  const body = extractFunctionBody(executableSql, "complete_admin_checkin");
  const updateStart = body.indexOf("UPDATE public.attendees AS a");
  const setClause = body.slice(
    updateStart,
    body.indexOf("WHERE a.id = p_attendee_id", updateStart),
  );
  assert.match(setClause, /share_with_attendees = p_share_with_attendees/);
  assert.match(setClause, /has_arrived = p_has_arrived/);
  assert.match(setClause, /arrival_status = CASE/);
  assert.equal(/assigned_site/.test(setClause), false);
});

test("executable only by authenticated -- not anon, not service_role, not PUBLIC", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.complete_admin_checkin\(uuid, uuid, boolean, boolean\)\s*\nFROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.complete_admin_checkin\(uuid, uuid, boolean, boolean\)\s*\nTO authenticated;/,
  );
});
