import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the resolve_attendee_visible_vendor_
// notices governed RPC. Live grant/RLS evidence (vendor_event_status anon
// SELECT already correctly revoked; vendors/event_vendors anon SELECT
// already working and left untouched; the column-level over-exposure
// finding on vendors/event_vendors) is reported separately, not
// re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260819120000_create_resolve_attendee_visible_vendor_notices.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260819120000_create_resolve_attendee_visible_vendor_notices.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^\s*--.*$/gm, "");

test("function is SECURITY DEFINER, owned by postgres, search_path pinned", () => {
  assert.match(executableSql, /SECURITY DEFINER/);
  assert.match(
    executableSql,
    /ALTER FUNCTION public\.resolve_attendee_visible_vendor_notices\(uuid\) OWNER TO postgres;/,
  );
  assert.match(executableSql, /SET search_path TO 'pg_catalog'/);
});

test("does not rely on p_event_id alone: re-derives the same admission predicate as get_event_continuity_context", () => {
  const fnStart = executableSql.indexOf(
    "CREATE OR REPLACE FUNCTION public.resolve_attendee_visible_vendor_notices",
  );
  const fnEnd = executableSql.indexOf("$function$;", fnStart);
  const fnBody = executableSql.slice(fnStart, fnEnd);

  assert.match(fnBody, /FROM public\.events e/);
  assert.match(fnBody, /e\.visible_to_members = true/);
  assert.match(fnBody, /coalesce\(e\.is_active, true\) = true/);
  assert.match(
    fnBody,
    /'inactive',\s*'archived',\s*'complete',\s*'completed',\s*'closed',\s*'draft'/,
  );
  assert.match(fnBody, /RETURN;\s*\n\s*END IF;/);
});

test("returns only the four attendee-safe Notice columns -- no wildcard, no governance column", () => {
  const selectMatch = executableSql.match(
    /RETURN QUERY\s*\n\s*SELECT ([^\n]+)\s*\n\s*FROM public\.vendor_event_status AS ves/,
  );
  assert.ok(selectMatch, "expected a scoped column list from vendor_event_status");
  const columns = selectMatch[1];
  for (const col of [
    "ves.vendor_id",
    "ves.status_type",
    "ves.message",
    "ves.expires_at",
    "ves.is_active",
  ]) {
    assert.ok(columns.includes(col), `expected column ${col} in RPC select list`);
  }
  assert.doesNotMatch(executableSql, /SELECT \*/);

  for (const governanceColumn of [
    "admission_state",
    "admitted_by",
    "admission_authority_basis",
    "current_disposition_id",
    "application_id",
    "updated_by_auth_user_id",
    "ev.notes",
    "v.notes",
    "v.contact_name",
  ]) {
    assert.equal(
      executableSql.includes(governanceColumn),
      false,
      `must not reference governance column ${governanceColumn}`,
    );
  }
});

test("scoped to attendee-visible, active vendors for the requested event only", () => {
  assert.match(executableSql, /WHERE ves\.event_id = p_event_id/);
  assert.match(executableSql, /ev\.is_visible_to_members IS NOT FALSE/);
  assert.match(executableSql, /v\.is_active = true/);
  assert.match(
    executableSql,
    /JOIN public\.event_vendors AS ev\s*\n\s*ON ev\.event_id = ves\.event_id AND ev\.vendor_id = ves\.vendor_id/,
  );
  assert.match(
    executableSql,
    /JOIN public\.vendors AS v ON v\.id = ves\.vendor_id/,
  );
});

test("anon and authenticated both get EXECUTE on the new RPC", () => {
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.resolve_attendee_visible_vendor_notices\(uuid\) TO anon, authenticated;/,
  );
});

test("no GRANT or REVOKE touches any table -- only the new function's own EXECUTE grant", () => {
  const grantStatements = executableSql.match(/GRANT[^;]*;/g) || [];
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  assert.equal(grantStatements.length, 1);
  for (const stmt of [...grantStatements, ...revokeStatements]) {
    assert.equal(/ON TABLE/.test(stmt), false, `must not grant/revoke on a table: ${stmt}`);
  }
});

test("no RLS policy is touched: no DROP POLICY, CREATE POLICY, or ALTER TABLE ... ROW LEVEL SECURITY statement", () => {
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ROW LEVEL SECURITY/.test(executableSql), false);
});

test("no other domain is touched: no Nearby, Locations, /map, Person/Participation, agenda, announcement, or parking table/function reference", () => {
  for (const forbidden of [
    "event_nearby_places",
    "resolve_effective_nearby_places",
    "event_locations",
    "resolve_effective_event_locations",
    "get_event_public_map_sites",
    "get_event_participant_map_roster",
    "person_event_participations",
    "resolve_auth_person_link",
    "get_my_member_event_continuity_context",
    "verify_member_event_login",
    "vendor_contacts",
    "vendor_org_access",
    "vendor_service_requests",
    "agenda_items",
    "announcements",
    "attendees",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this repair`,
    );
  }
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
});
