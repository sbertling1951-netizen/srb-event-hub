import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(
    new URL("./20260817180000_create_event_operational_summary_read.sql", import.meta.url),
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

const FUNCTION_NAME = "get_event_operational_summary";

test("get_event_operational_summary fails closed for a missing Event id", () => {
  const body = extractFunctionBody(executableSql, FUNCTION_NAME);
  assert.match(body, /IF p_event_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'unauthorized';/);
});

test("get_event_operational_summary authorizes on the existing Attendees/Check-In/Parking/Reports view capabilities only -- no new or parallel role test", () => {
  const body = extractFunctionBody(executableSql, FUNCTION_NAME);
  assert.match(body, /has_event_task_authority\('event\.attendees\.view', p_event_id\)/);
  assert.match(body, /has_event_task_authority\('event\.checkin\.view', p_event_id\)/);
  assert.match(body, /has_event_task_authority\('event\.parking\.view', p_event_id\)/);
  assert.match(body, /has_event_task_authority\('event\.reports\.view', p_event_id\)/);
  assert.match(body, /RAISE EXCEPTION 'authorization_denied';/);
  assert.equal(/canAccessEvent|caller-supplied|current_setting\('request\.jwt/.test(body), false);
});

test("get_event_operational_summary never reads attendees.assigned_site", () => {
  const body = extractFunctionBody(executableSql, FUNCTION_NAME);
  assert.equal(/\.assigned_site/.test(body), false);
  assert.equal(/a\.assigned_site/.test(body), false);
});

test("get_event_operational_summary never reads person_event_participations, household, or capacity concepts", () => {
  const body = extractFunctionBody(executableSql, FUNCTION_NAME);
  assert.equal(/person_event_participations/.test(body), false);
  assert.equal(/household/.test(body), false);
  assert.equal(/participant_capacity/.test(body), false);
});

test("get_event_operational_summary separates cancelled and inactive registrations from active", () => {
  const body = extractFunctionBody(executableSql, FUNCTION_NAME);
  assert.match(
    body,
    /a\.registration_status IS DISTINCT FROM 'cancelled' AND a\.is_active\s*\n\s*\)/,
  );
  assert.match(body, /a\.registration_status = 'cancelled'\)/);
  assert.match(
    body,
    /a\.registration_status IS DISTINCT FROM 'cancelled' AND NOT a\.is_active\s*\n\s*\)/,
  );
});

test("get_event_operational_summary derives Arrived/Not Arrived from active registrations only, and null-safely (IS TRUE / IS NOT TRUE, not boolean equality)", () => {
  const body = extractFunctionBody(executableSql, FUNCTION_NAME);
  const activeArrivedFilter = body.match(
    /FILTER \(\s*WHERE a\.registration_status IS DISTINCT FROM 'cancelled'\s*\n\s*AND a\.is_active\s*\n\s*AND a\.has_arrived IS TRUE\s*\)/,
  );
  const activeNotArrivedFilter = body.match(
    /FILTER \(\s*WHERE a\.registration_status IS DISTINCT FROM 'cancelled'\s*\n\s*AND a\.is_active\s*\n\s*AND a\.has_arrived IS NOT TRUE\s*\)/,
  );
  assert.ok(activeArrivedFilter, "expected an active+arrived FILTER clause");
  assert.ok(activeNotArrivedFilter, "expected an active+not-arrived FILTER clause");
  assert.equal(/has_arrived = true/.test(body), false);
  assert.equal(/has_arrived = false/.test(body), false);
});

test("get_event_operational_summary derives Current Placements only from canonical parking_sites.assigned_attendee_id occupancy, scoped to the requested Event", () => {
  const body = extractFunctionBody(executableSql, FUNCTION_NAME);
  assert.match(body, /FROM public\.parking_sites AS ps\s*\n\s*WHERE ps\.event_id = p_event_id\s*\n\s*AND ps\.assigned_attendee_id IS NOT NULL/);
});

test("get_event_operational_summary derives Active Needs-Parking/Unplaced from canonical placement (NOT EXISTS against parking_sites), never attendees.assigned_site", () => {
  const body = extractFunctionBody(executableSql, FUNCTION_NAME);
  assert.match(body, /a\.needs_parking IS TRUE/);
  assert.match(
    body,
    /NOT EXISTS \(\s*\n\s*SELECT 1\s*\n\s*FROM public\.parking_sites AS ps2\s*\n\s*WHERE ps2\.event_id = p_event_id\s*\n\s*AND ps2\.assigned_attendee_id = a\.id\s*\n\s*\)/,
  );
});

test("get_event_operational_summary is Event-scoped: every row source filters by the requested Event id", () => {
  const body = extractFunctionBody(executableSql, FUNCTION_NAME);
  assert.match(body, /FROM public\.attendees AS a\s*\n\s*WHERE a\.event_id = p_event_id/);
  const parkingScopeCount = (body.match(/ps\d?\.event_id = p_event_id/g) || []).length;
  assert.equal(parkingScopeCount, 2);
});

test("get_event_operational_summary is a pure read -- no INSERT, UPDATE, or DELETE anywhere in its body", () => {
  const body = extractFunctionBody(executableSql, FUNCTION_NAME);
  assert.equal(/\bINSERT\b/.test(body), false);
  assert.equal(/\bUPDATE\b/.test(body), false);
  assert.equal(/\bDELETE\b/.test(body), false);
});

test("get_event_operational_summary is executable only by authenticated -- not anon, not service_role, not PUBLIC", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.get_event_operational_summary\(uuid\) FROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.get_event_operational_summary\(uuid\) TO authenticated;/,
  );
});

test("get_event_operational_summary returns exactly the eight settled canonical aggregates plus the Event id, nothing else", () => {
  const createStatement = executableSql.match(
    /CREATE FUNCTION public\.get_event_operational_summary\(p_event_id uuid\)\s*\nRETURNS TABLE\(([\s\S]*?)\)\s*\nLANGUAGE/,
  );
  assert.ok(createStatement, "expected a RETURNS TABLE(...) clause");
  const columns = createStatement![1]
    .split(",")
    .map((c) => c.trim().split(/\s+/)[0])
    .filter(Boolean);
  assert.deepEqual(columns, [
    "event_id",
    "total_registrations",
    "active_registrations",
    "cancelled_registrations",
    "inactive_registrations",
    "active_arrived",
    "active_not_arrived",
    "current_placements",
    "active_needs_parking_unplaced",
  ]);
});
