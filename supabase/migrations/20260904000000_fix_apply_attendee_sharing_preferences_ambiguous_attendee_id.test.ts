import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the _apply_attendee_sharing_preferences
// ambiguity fix. Behavior was additionally verified against the linked
// database in a rolled-back transaction (member authenticated, member
// Temporary Event Access, and admin entry points all return
// outcome = 'applied'; an unregistered key still fails closed; no
// parking_sites row is created or changed) -- see the closeout report.
//
// Run with:
//   npx tsx --test supabase/migrations/20260904000000_fix_apply_attendee_sharing_preferences_ambiguous_attendee_id.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260904000000_fix_apply_attendee_sharing_preferences_ambiguous_attendee_id.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^\s*--.*$/gm, "");

function helperBody() {
  const match = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\._apply_attendee_sharing_preferences\([\s\S]*?\$\$\s*;/,
  );
  assert.ok(match, "expected the _apply_attendee_sharing_preferences replacement");
  return match![0];
}

test("the only function touched is the shared internal helper -- no second/duplicated fix", () => {
  const replaced = [
    ...executableSql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g),
  ].map((m) => m[1]);
  assert.deepEqual(replaced, ["_apply_attendee_sharing_preferences"]);
  // the two entry points that delegate to it are deliberately not rewritten
  assert.equal(/set_member_attendee_sharing_preferences/.test(executableSql), false);
  assert.equal(/FUNCTION public\.set_attendee_sharing_preferences/.test(executableSql), false);
});

test("the ambiguous unqualified predicate on attendee_id is gone -- the SELECT is alias-qualified", () => {
  const body = helperBody();
  assert.match(
    body,
    /SELECT pref\.shared INTO v_previous\s*\n\s*FROM public\.attendee_sharing_preferences AS pref\s*\n\s*WHERE pref\.attendee_id = p_attendee_id\s*\n\s*AND pref\.field_key = v_field\.field_key;/,
  );
  assert.equal(
    /FROM public\.attendee_sharing_preferences\s*\n\s*WHERE attendee_id = p_attendee_id/.test(body),
    false,
    "the unqualified WHERE attendee_id = ... must not survive",
  );
});

test("ON CONFLICT is arbitrated by the existing constraint name, not a column-inference list", () => {
  const body = helperBody();
  assert.match(
    body,
    /ON CONFLICT ON CONSTRAINT attendee_sharing_preferences_attendee_field_unique DO UPDATE/,
  );
  assert.equal(
    /ON CONFLICT \(attendee_id, field_key\)/.test(body),
    false,
    "the ambiguous column-inference list must not survive",
  );
});

test("the external contract is unchanged: same signature, same RETURNS TABLE shape", () => {
  const body = helperBody();
  assert.match(
    body,
    /public\._apply_attendee_sharing_preferences\(\s*\n\s*p_attendee_id uuid,\s*\n\s*p_shared_field_keys text\[\],\s*\n\s*p_source text,\s*\n\s*p_actor_admin_user_id uuid,\s*\n\s*p_actor_auth_user_id uuid\s*\n\)/,
  );
  assert.match(
    body,
    /RETURNS TABLE\(\s*\n\s*outcome text,\s*\n\s*attendee_id uuid,\s*\n\s*shared_field_keys text\[\],\s*\n\s*rejection_code text\s*\n\)/,
  );
  assert.match(body, /RETURN QUERY SELECT 'applied'::text, p_attendee_id, v_keys, NULL::text;/);
});

test("authority, grants and secdef owner are preserved -- the helper stays internal-only", () => {
  assert.match(helperBody(), /LANGUAGE plpgsql\s*\n\s*SECURITY DEFINER/);
  assert.match(
    executableSql,
    /ALTER FUNCTION public\._apply_attendee_sharing_preferences\(uuid, text\[\], text, uuid, uuid\) OWNER TO postgres;/,
  );
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\._apply_attendee_sharing_preferences\(uuid, text\[\], text, uuid, uuid\)\s*\nFROM PUBLIC, anon, authenticated, service_role;/,
  );
  // never widened to a directly-callable client role
  assert.equal(
    /GRANT EXECUTE ON FUNCTION public\._apply_attendee_sharing_preferences[\s\S]*?TO (anon|authenticated)/.test(
      executableSql,
    ),
    false,
  );
});

test("no schema / RLS / authority / identity-contract change", () => {
  assert.equal(/CREATE TABLE|ALTER TABLE|DROP TABLE/.test(executableSql), false);
  assert.equal(/CREATE POLICY|ALTER POLICY|ENABLE ROW LEVEL SECURITY/.test(executableSql), false);
  assert.equal(/has_event_task_authority|resolve_auth_person_link|resolve_temporary_or_authenticated_attendee/.test(executableSql), false);
  assert.equal(/GRANT[\s\S]*?TO (anon|authenticated|service_role)/.test(executableSql), false);
});

test("still fails closed on an unregistered field key -- no partial write", () => {
  const body = helperBody();
  assert.match(body, /RAISE EXCEPTION 'unknown_share_field';/);
  // the fail-closed check still precedes the write loop
  assert.ok(
    body.indexOf("unknown_share_field") < body.indexOf("FOR v_field IN"),
  );
});

test("parking placement is untouched -- no parking_sites or attendees.assigned_site write", () => {
  assert.equal(/parking_sites|assigned_site|record_site_placement/.test(executableSql), false);
});

test("the member's ability to report an observed site is not affected here -- this migration is sharing-only", () => {
  assert.equal(/submit_member_checkin|member_site_reports|_record_member_site_report/.test(executableSql), false);
});
