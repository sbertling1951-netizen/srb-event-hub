import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(
    new URL(
      "./20260828130000_member_site_report_establishes_arrival.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = source.replace(/^\s*--.*$/gm, "");

function submitMemberCheckinBody() {
  const match = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\.submit_member_checkin\([\s\S]*?\$\$\s*;/,
  );
  assert.ok(match, "expected submit_member_checkin replacement");
  return match![0];
}

test("member site reporting establishes Arrival only from a nonblank report or already-arrived stored state", () => {
  const body = submitMemberCheckinBody();
  assert.match(
    body,
    /v_effective_has_arrived :=\s*coalesce\(v_previous_has_arrived, false\)\s*OR nullif\(btrim\(p_assigned_site\), ''\) IS NOT NULL;/,
  );
  assert.match(body, /SET has_arrived = v_effective_has_arrived,/);
  assert.match(body, /WHEN v_effective_has_arrived THEN 'arrived'/);
  assert.equal(/SET has_arrived = p_has_arrived/.test(body), false);
});

test("blank or edited reports cannot reverse Arrival, while sharing remains independent", () => {
  const body = submitMemberCheckinBody();
  const effectiveRule = body.slice(
    body.indexOf("v_effective_has_arrived :="),
    body.indexOf("UPDATE public.attendees AS a", body.indexOf("v_effective_has_arrived :=")),
  );
  assert.equal(/p_share_with_attendees/.test(effectiveRule), false);
  assert.match(body, /share_with_attendees = p_share_with_attendees,/);
});

test("the replacement preserves the existing verification and evidence-only Parking boundaries", () => {
  const body = submitMemberCheckinBody();
  for (const required of [
    "e.tenant_id = p_tenant_id",
    "t.is_active = true",
    "IF v_uid IS NOT NULL THEN",
    "FROM public.resolve_auth_person_link(v_uid) AS link",
    "public.resolve_temporary_or_authenticated_attendee(",
    "v_authorization_basis := 'temporary'",
    "PERFORM public._record_member_site_report(",
    "FOR UPDATE;",
  ]) {
    assert.ok(body.includes(required), `expected preserved boundary: ${required}`);
  }
  assert.equal(/parking_sites/.test(body), false);
  assert.equal(/record_site_placement/.test(body), false);
  const updateStart = body.indexOf("UPDATE public.attendees AS a");
  const updateEnd = body.indexOf("WHERE a.id = v_verified_attendee_id", updateStart);
  assert.equal(/assigned_site\s*=/.test(body.slice(updateStart, updateEnd)), false);
});

test("the existing member-facing function signature and grants remain unchanged", () => {
  assert.match(
    executableSql,
    /submit_member_checkin\(uuid, uuid, boolean, boolean, text, uuid, text, text\)/,
  );
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.submit_member_checkin\(uuid, uuid, boolean, boolean, text, uuid, text, text\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.submit_member_checkin\(uuid, uuid, boolean, boolean, text, uuid, text, text\)\s*\n\s*TO anon, authenticated;/,
  );
});
