import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(
    new URL("./20260817170000_add_member_site_report_read_surfaces.sql", import.meta.url),
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

test("get_my_confirmed_site_placement reuses the identical member-identity boundary as get_my_attendee_record", () => {
  const body = extractFunctionBody(executableSql, "get_my_confirmed_site_placement");
  assert.match(body, /resolve_temporary_or_authenticated_attendee\(/);
  assert.match(body, /IF v_verified_attendee_id IS NULL THEN\s*\n\s*RETURN;/);
});

test("get_my_confirmed_site_placement derives placement only from canonical parking_sites occupancy, never attendees.assigned_site or a report", () => {
  const body = extractFunctionBody(executableSql, "get_my_confirmed_site_placement");
  assert.match(body, /FROM public\.parking_sites AS ps/);
  assert.match(body, /ps\.assigned_attendee_id = v_verified_attendee_id/);
  assert.equal(/assigned_site/.test(body), false);
  assert.equal(/member_site_reports/.test(body), false);
});

test("get_my_confirmed_site_placement grants match the sibling member-facing reads: anon and authenticated", () => {
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.get_my_confirmed_site_placement\(uuid, text, text\) TO anon, authenticated;/,
  );
});

test("get_member_site_reports_for_event authorizes on event.parking.manage only -- the same authority record_site_placement requires", () => {
  const body = extractFunctionBody(executableSql, "get_member_site_reports_for_event");
  assert.match(body, /has_event_task_authority\('event\.parking\.manage', p_event_id\)/);
  assert.equal(/event\.checkin\.manage/.test(body), false);
  assert.match(body, /RAISE EXCEPTION 'authorization_denied';/);
});

test("get_member_site_reports_for_event is a pure read -- no INSERT, UPDATE, or DELETE anywhere in its body", () => {
  const body = extractFunctionBody(executableSql, "get_member_site_reports_for_event");
  assert.equal(/\bINSERT\b/.test(body), false);
  assert.equal(/\bUPDATE\b/.test(body), false);
  assert.equal(/\bDELETE\b/.test(body), false);
  assert.equal(/record_site_placement/.test(body), false);
});

test("get_member_site_reports_for_event is executable only by authenticated -- not anon, not service_role, not PUBLIC", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.get_member_site_reports_for_event\(uuid\) FROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.get_member_site_reports_for_event\(uuid\) TO authenticated;/,
  );
});

test("get_member_site_reports_for_event returns evidence fields only, scoped to the requested Event", () => {
  const body = extractFunctionBody(executableSql, "get_member_site_reports_for_event");
  assert.match(body, /WHERE r\.event_id = p_event_id/);
  assert.match(body, /r\.raw_reported_value/);
  assert.match(body, /r\.normalized_reported_value/);
});
