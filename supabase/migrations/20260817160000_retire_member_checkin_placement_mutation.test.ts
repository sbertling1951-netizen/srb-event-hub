import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(
    new URL("./20260817160000_retire_member_checkin_placement_mutation.sql", import.meta.url),
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

// --- member_site_reports table ---

test("member_site_reports carries every field the evidence model requires", () => {
  const tableMatch = executableSql.match(
    /CREATE TABLE public\.member_site_reports \([\s\S]*?\n\);/,
  );
  assert.ok(tableMatch, "expected member_site_reports table definition");
  const body = tableMatch![0];
  for (const column of [
    "event_id uuid NOT NULL REFERENCES public.events(id)",
    "attendee_id uuid NOT NULL REFERENCES public.attendees(id)",
    "raw_reported_value text NOT NULL",
    "normalized_reported_value text NOT NULL",
    "matched_master_site_id uuid REFERENCES public.master_map_sites(id)",
    "authorization_basis text NOT NULL",
    "actor_person_id uuid REFERENCES public.people(id)",
    "actor_auth_user_id uuid REFERENCES auth.users(id)",
    "reported_at timestamptz NOT NULL DEFAULT now()",
  ]) {
    assert.ok(body.includes(column), `expected column: ${column}`);
  }
});

test("member_site_reports is completely locked down -- no role has any direct grant", () => {
  assert.match(
    executableSql,
    /ALTER TABLE public\.member_site_reports ENABLE ROW LEVEL SECURITY;/,
  );
  assert.match(
    executableSql,
    /REVOKE ALL ON TABLE public\.member_site_reports FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.equal(/GRANT[\s\S]*?ON TABLE public\.member_site_reports/.test(executableSql), false);
});

test("actor context is governed by the same authenticated/temporary CHECK shape as member_checkin_audit", () => {
  assert.match(
    executableSql,
    /CONSTRAINT member_site_reports_authorization_basis_check CHECK \(\s*\n\s*authorization_basis IN \('authenticated', 'temporary'\)/,
  );
  assert.match(executableSql, /CONSTRAINT member_site_reports_actor_context_check CHECK \(/);
});

// --- _record_member_site_report ---

test("_record_member_site_report has no client-callable grant at all -- private helper only", () => {
  assert.equal(
    /GRANT EXECUTE ON FUNCTION public\._record_member_site_report/.test(executableSql),
    false,
  );
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\._record_member_site_report\(uuid, uuid, text, text, uuid, uuid\)\s*\nFROM PUBLIC, anon, authenticated, service_role;/,
  );
});

test("blank input returns before any INSERT -- creates no report", () => {
  const body = extractFunctionBody(executableSql, "_record_member_site_report");
  const iBlankCheck = body.indexOf("IF v_normalized IS NULL THEN");
  const iReturnNull = body.indexOf("RETURN NULL;", iBlankCheck);
  const iInsert = body.indexOf("INSERT INTO public.member_site_reports");
  assert.ok(iBlankCheck >= 0 && iReturnNull > iBlankCheck && iInsert > iReturnNull);
});

test("matching reads only the selected master map template -- never parking_sites occupancy, never a lock, never materialization", () => {
  const body = extractFunctionBody(executableSql, "_record_member_site_report");
  assert.match(body, /FROM public\.master_map_sites AS mms/);
  assert.equal(/parking_sites/.test(body), false);
  assert.equal(/FOR UPDATE/.test(body), false);
  assert.equal(/materialize_event_parking_site/.test(body), false);
});

test("an unmatched value is inserted unconditionally -- no match found is not an error and does not skip the INSERT", () => {
  const body = extractFunctionBody(executableSql, "_record_member_site_report");
  const matchStart = body.indexOf("IF v_selected_master_map_id IS NOT NULL THEN");
  const matchEnd = body.indexOf("END IF;", matchStart) + "END IF;".length;
  const matchBranch = body.slice(matchStart, matchEnd);
  assert.equal(/RAISE EXCEPTION/.test(matchBranch), false);
  assert.equal(/RETURN/.test(matchBranch), false);
  const iInsert = body.indexOf("INSERT INTO public.member_site_reports");
  assert.ok(iInsert > matchEnd, "INSERT must always run after the optional match attempt, regardless of outcome");
});

// --- submit_member_checkin ---

test("submit_member_checkin keeps its exact existing 8-parameter signature -- no signature change", () => {
  assert.match(
    executableSql,
    /CREATE OR REPLACE FUNCTION public\.submit_member_checkin\(\s*p_event_id uuid,\s*p_expected_attendee_id uuid,\s*p_has_arrived boolean,\s*p_share_with_attendees boolean,\s*p_assigned_site text,\s*p_tenant_id uuid,\s*p_event_code text DEFAULT NULL,\s*p_registration_identifier text DEFAULT NULL\s*\)/,
  );
});

test("Tenant re-verification is present and unchanged in position -- before any identity branch", () => {
  const body = extractFunctionBody(executableSql, "submit_member_checkin");
  const iTenantCheck = body.indexOf("e.tenant_id = p_tenant_id");
  const iAuthBranch = body.indexOf("IF v_uid IS NOT NULL THEN");
  assert.ok(iTenantCheck >= 0 && iAuthBranch > iTenantCheck);
});

test("submit_member_checkin never writes parking_sites -- no INSERT, no UPDATE, no materialize call", () => {
  const body = extractFunctionBody(executableSql, "submit_member_checkin");
  assert.equal(/parking_sites/.test(body), false);
  assert.equal(/materialize_event_parking_site/.test(body), false);
  assert.equal(/record_site_placement/.test(body), false);
});

test("the final attendees UPDATE never sets assigned_site", () => {
  const body = extractFunctionBody(executableSql, "submit_member_checkin");
  const updateStart = body.indexOf("UPDATE public.attendees AS a\n  SET has_arrived");
  assert.ok(updateStart >= 0, "expected the Arrival-owned UPDATE statement");
  const setClause = body.slice(updateStart, body.indexOf("WHERE a.id = v_verified_attendee_id", updateStart));
  assert.match(setClause, /has_arrived = p_has_arrived/);
  assert.match(setClause, /share_with_attendees = p_share_with_attendees/);
  assert.match(setClause, /arrival_status = CASE/);
  assert.equal(/assigned_site\s*=/.test(setClause), false);
});

test("the report helper is invoked with the already-verified attendee/authorization context, after all verification branches", () => {
  const body = extractFunctionBody(executableSql, "submit_member_checkin");
  const iAuthenticatedBranchEnd = body.indexOf("v_verified_attendee_id := p_expected_attendee_id;");
  const iTemporaryBranchEnd = body.indexOf(
    "IF v_verified_attendee_id IS DISTINCT FROM p_expected_attendee_id THEN",
  );
  const iReportCall = body.indexOf("PERFORM public._record_member_site_report(");
  assert.ok(
    iAuthenticatedBranchEnd >= 0 &&
      iTemporaryBranchEnd > iAuthenticatedBranchEnd &&
      iReportCall > iTemporaryBranchEnd,
  );
  const callBlock = body.slice(iReportCall, body.indexOf(");", iReportCall));
  assert.match(callBlock, /p_event_id,/);
  assert.match(callBlock, /v_verified_attendee_id,/);
  assert.match(callBlock, /p_assigned_site,/);
  assert.match(callBlock, /v_authorization_basis,/);
});

test("the report call happens before the attendees row is read/locked -- report recording never depends on Arrival succeeding", () => {
  const body = extractFunctionBody(executableSql, "submit_member_checkin");
  const iReportCall = body.indexOf("PERFORM public._record_member_site_report(");
  const iAttendeeLock = body.indexOf("FOR UPDATE;");
  assert.ok(iReportCall >= 0 && iAttendeeLock > iReportCall);
});

test("the report call is unconditional -- it sits at the function's top level, not nested inside any IF, so both identity branches and every p_has_arrived value always reach it", () => {
  const body = extractFunctionBody(executableSql, "submit_member_checkin");
  // Written at the same 2-space top-level indent as the function's other
  // unconditional statements (the Tenant SELECT, the final RETURN QUERY) --
  // not indented further as it would be inside an IF/ELSE branch.
  assert.match(body, /\n {2}PERFORM public\._record_member_site_report\(/);
  const iReportCall = body.indexOf("\n  PERFORM public._record_member_site_report(");
  const iAttendeeUpdate = body.indexOf("UPDATE public.attendees AS a\n  SET has_arrived");
  assert.ok(iReportCall >= 0 && iAttendeeUpdate > iReportCall);
});

test("member_checkin_audit still receives an assigned_site key in both jsonb payloads -- satisfies its existing CHECK constraint without this function ever writing the column", () => {
  const body = extractFunctionBody(executableSql, "submit_member_checkin");
  const insertStart = body.indexOf("INSERT INTO public.member_checkin_audit");
  const insertBlock = body.slice(insertStart, body.indexOf(");", body.indexOf("RETURN QUERY")));
  const occurrences = (insertBlock.match(/'assigned_site', v_(?:previous|updated)_assigned_site/g) || []).length;
  assert.equal(occurrences, 2);
});

test("submit_member_checkin's own grants are unchanged: anon and authenticated, matching the existing member-facing entry point", () => {
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.submit_member_checkin\(uuid, uuid, boolean, boolean, text, uuid, text, text\)\s*\nTO anon, authenticated;/,
  );
});
