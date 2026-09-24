import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sql = readFileSync(new URL("./20261025000000_separate_member_roster_from_optional_sharing.sql", import.meta.url), "utf8").replace(/^--.*$/gm, "");
const old = readFileSync(new URL("./20260816140000_create_attendee_sharing_governed_foundation.sql", import.meta.url), "utf8");

test("only the Member locator changes; no consent writes, map feed or resolver replacement", () => {
  assert.deepEqual([...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]), ["get_event_attendee_locator"]);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE POLICY|ALTER TABLE|DROP)\b/i);
  assert.doesNotMatch(sql, /get_event_public_roster|_apply_attendee_sharing_preferences/);
});

test("the established caller resolver, signature, owner, ACLs and search path are preserved", () => {
  const signature = /CREATE OR REPLACE FUNCTION public\.get_event_attendee_locator[\s\S]*?AS \$\$/;
  assert.equal(sql.match(signature)?.[0], old.match(signature)?.[0]);
  assert.match(sql, /v_caller_attendee_id := public\.resolve_temporary_or_authenticated_attendee\(\s*p_event_id, p_event_code, p_registration_identifier\s*\);/);
  assert.match(sql, /IF v_caller_attendee_id IS NULL THEN\s*RETURN;/);
  assert.match(sql, /caller.id = v_caller_attendee_id/);
  assert.match(sql, /caller.event_id = p_event_id/);
  assert.match(sql, /coalesce\(caller.registration_status, ''\) IN \('active', 'registered'\)/);
  assert.match(sql, /OWNER TO postgres;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_event_attendee_locator\(uuid, text, text\) FROM PUBLIC, service_role;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_event_attendee_locator\(uuid, text, text\) TO anon, authenticated;/);
});

test("roster names are independent of name preferences; target and Event eligibility stay intact", () => {
  assert.match(sql, /SELECT\s+a.id,\s+a.pilot_first,\s+a.pilot_last,/);
  assert.doesNotMatch(sql, /name_pref|v_caller_participates|share_with_attendees/);
  for (const predicate of [
    "a.event_id = p_event_id",
    "coalesce(a.is_active, true) = true",
    "coalesce(a.registration_status, '') IN ('active', 'registered')",
    "e.visible_to_members = true",
    "coalesce(e.is_active, true) = true",
  ]) {
    assert.ok(sql.includes(predicate), predicate);
  }
});

test("all optional field masks and their attendee-scoped joins are byte-identical to the previous contract", () => {
  const masks = /CASE WHEN (?:email|phone|campsite|coach)_pref.shared THEN [^\n]+/g;
  assert.deepEqual(sql.match(masks), old.slice(old.indexOf("CREATE OR REPLACE FUNCTION public.get_event_attendee_locator(")).match(masks)?.slice(0, 5));
  for (const key of ["email", "phone", "campsite_location", "coach_make_model"]) {
    assert.match(sql, new RegExp(`ON \\w+_pref.attendee_id = a.id AND \\w+_pref.field_key = '${key}'`));
  }
  assert.match(sql, /ON site.event_id = a.event_id AND site.assigned_attendee_id = a.id/);
  assert.doesNotMatch(sql, /a\.(?:assigned_site|membership_number|city|state|copilot_first|copilot_last)/);
});
