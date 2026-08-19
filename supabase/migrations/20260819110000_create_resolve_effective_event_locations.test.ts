import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the resolve_effective_event_locations
// governed RPC + event_locations anon grant closure. The live grant/RLS
// audit (anon held full undifferentiated CRUD on event_locations with a
// USING(true), no-predicate SELECT policy; has_event_task_authority
// already RLS-inert for anon) and the live post-apply verification are
// reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260819110000_create_resolve_effective_event_locations.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260819110000_create_resolve_effective_event_locations.sql",
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
    /ALTER FUNCTION public\.resolve_effective_event_locations\(uuid\) OWNER TO postgres;/,
  );
  assert.match(executableSql, /SET search_path TO 'pg_catalog'/);
});

test("does not rely on p_event_id alone: re-derives the same admission predicate as get_event_continuity_context", () => {
  const fnStart = executableSql.indexOf(
    "CREATE OR REPLACE FUNCTION public.resolve_effective_event_locations",
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
  // A failed predicate must return zero rows, not fall through to an
  // unconditional read.
  assert.match(fnBody, /RETURN;\s*\n\s*END IF;/);
});

test("returns only the non-PII columns the page already selects -- no wildcard, no extra table", () => {
  const selectMatch = executableSql.match(
    /RETURN QUERY\s*\n\s*SELECT ([^\n]+)\s*\n\s*FROM public\.event_locations AS el/,
  );
  assert.ok(selectMatch, "expected a scoped column list from event_locations");
  const columns = selectMatch[1];
  for (const col of [
    "el.id",
    "el.event_id",
    "el.name",
    "el.category",
    "el.description",
    "el.map_x",
    "el.map_y",
    "el.priority",
  ]) {
    assert.ok(columns.includes(col), `expected column ${col} in RPC select list`);
  }
  assert.doesNotMatch(executableSql, /SELECT \*/);
});

test("event_locations read is scoped to the requested event_id", () => {
  assert.match(executableSql, /WHERE el\.event_id = p_event_id/);
});

test("anon and authenticated both get EXECUTE on the new RPC", () => {
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.resolve_effective_event_locations\(uuid\) TO anon, authenticated;/,
  );
});

test("anon's raw event_locations grant is fully revoked -- SELECT, INSERT, UPDATE, DELETE, TRUNCATE", () => {
  assert.match(
    executableSql,
    /REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE\s*\nON TABLE public\.event_locations\s*\nFROM anon;/,
  );
});

test("REFERENCES and TRIGGER are not revoked from anon on event_locations", () => {
  const revokeMatch = executableSql.match(
    /REVOKE[^;]*ON TABLE public\.event_locations\s*\nFROM anon;/,
  );
  assert.ok(revokeMatch);
  assert.equal(/\bREFERENCES\b/.test(revokeMatch[0]), false);
  assert.equal(/\bTRIGGER\b/.test(revokeMatch[0]), false);
});

test("authenticated and service_role privileges on event_locations are never touched", () => {
  assert.equal(/FROM authenticated/.test(executableSql), false);
  assert.equal(/FROM service_role/.test(executableSql), false);
});

test("no RLS policy is touched: no DROP POLICY, CREATE POLICY, or ALTER TABLE ... ROW LEVEL SECURITY statement", () => {
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ROW LEVEL SECURITY/.test(executableSql), false);
});

test("master_maps and event_map_settings are not referenced -- shared with out-of-scope Coach Map", () => {
  assert.equal(/master_maps/.test(executableSql), false);
  assert.equal(/event_map_settings/.test(executableSql), false);
});

test("no other domain is touched: no Nearby, Person/Participation, vendor, agenda, announcement, or parking table/function reference", () => {
  for (const forbidden of [
    "event_nearby_places",
    "resolve_effective_nearby_places",
    "person_event_participations",
    "resolve_auth_person_link",
    "resolve_temporary_or_authenticated_attendee",
    "get_my_member_event_continuity_context",
    "verify_member_event_login",
    "vendor_contacts",
    "vendor_org_access",
    "vendor_event_status",
    "vendors",
    "agenda_items",
    "announcements",
    "attendees",
    "attendee_household_members",
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
