import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Public Map Attendee Exposure
// governance repair. No live/linked database was used to validate this
// migration or the page changes it required -- there is no established
// safe harness for a live-DB run in this workstream, so these tests
// prove what the SQL text and the two consuming page files themselves
// commit to: which columns each governed contract can possibly return,
// which grants exist, and which client code path each page now calls.
// This is structural proof, not runtime proof -- see the workstream's
// final report.
//
// Run with:
//   npx tsx --test supabase/migrations/20260816160000_close_anonymous_attendee_map_exposure.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260816160000_close_anonymous_attendee_map_exposure.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

const MAP_PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("../../app/map/page.tsx", import.meta.url)),
  "utf8",
);
const COACH_MAP_PUBLIC_SOURCE = readFileSync(
  fileURLToPath(
    new URL("../../app/coach-map/public/page.tsx", import.meta.url),
  ),
  "utf8",
);

function extractFunctionBody(sql: string, functionName: string) {
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?\\$\\$;`,
  );
  const match = sql.match(re);
  return match ? match[0] : null;
}

// ─── A/H. get_event_public_roster is retired, not left dangerous ───────

test("get_event_public_roster is dropped, not merely revoked-but-present", () => {
  assert.match(
    executableSql,
    /DROP FUNCTION IF EXISTS public\.get_event_public_roster\(uuid\);/,
  );
});

// ─── A/E/H. Anonymous-safe geometry contract carries no Person link ────

test("get_event_public_map_sites never selects assigned_attendee_id or any attendee-identifying column", () => {
  const fnBody = extractFunctionBody(
    executableSql,
    "get_event_public_map_sites",
  );
  assert.ok(fnBody, "expected get_event_public_map_sites body");

  const returnsMatch = fnBody!.match(
    /RETURNS TABLE\(([\s\S]*?)\)\s*\nLANGUAGE/,
  );
  assert.ok(returnsMatch, "expected a RETURNS TABLE column list");
  const columnList = returnsMatch![1];

  for (const forbidden of [
    "assigned_attendee_id",
    "pilot_first",
    "pilot_last",
    "coach_make",
    "coach_model",
    "campsite_location",
    "email",
    "phone",
    "has_arrived",
    "arrival_status",
  ]) {
    assert.equal(
      columnList.includes(forbidden),
      false,
      `get_event_public_map_sites must not return '${forbidden}'`,
    );
  }

  // assigned_attendee_id may only appear inside the derived boolean
  // expression (assigned_attendee_id IS NOT NULL) in the query body --
  // never selected as its own output column.
  const selectMatch = fnBody!.match(/SELECT\s+([\s\S]*?)\s+FROM/);
  assert.ok(selectMatch, "expected a SELECT list");
  assert.match(selectMatch![1], /assigned_attendee_id IS NOT NULL/);
});

test("get_event_public_map_sites is Event-scoped and lifecycle-gated", () => {
  const fnBody = extractFunctionBody(
    executableSql,
    "get_event_public_map_sites",
  );
  assert.ok(fnBody, "expected get_event_public_map_sites body");
  assert.match(fnBody!, /WHERE\s+s\.event_id = p_event_id/);
  assert.match(fnBody!, /e\.visible_to_members = true/);
  assert.match(fnBody!, /coalesce\(e\.is_active, true\) = true/);
});

test("get_event_public_map_sites is SECURITY DEFINER with a locked search_path, granted to anon and authenticated only", () => {
  const fnBody = extractFunctionBody(
    executableSql,
    "get_event_public_map_sites",
  );
  assert.ok(fnBody, "expected get_event_public_map_sites body");
  assert.match(fnBody!, /SECURITY DEFINER/);
  assert.match(fnBody!, /SET search_path TO 'pg_catalog'/);
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.get_event_public_map_sites\(uuid\) FROM PUBLIC, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.get_event_public_map_sites\(uuid\) TO anon, authenticated;/,
  );
});

// ─── H. parking_sites: anon loses the Person-linked column ─────────────

test("anon's blanket parking_sites SELECT is replaced with a column list excluding assigned_attendee_id", () => {
  assert.match(
    executableSql,
    /REVOKE SELECT ON TABLE public\.parking_sites FROM anon;/,
  );

  const grantMatch = executableSql.match(
    /GRANT SELECT \(([\s\S]*?)\)\s*\nON TABLE public\.parking_sites\s*\nTO anon;/,
  );
  assert.ok(grantMatch, "expected a column-scoped anon SELECT grant");
  const columnList = grantMatch![1];

  assert.equal(
    columnList.includes("assigned_attendee_id"),
    false,
    "anon's parking_sites column grant must not include assigned_attendee_id",
  );
  assert.equal(
    columnList.includes("notes"),
    false,
    "anon's parking_sites column grant must not include notes",
  );

  // The revoke must precede the column grant, or the table-wide
  // privilege would still satisfy the check regardless of any column
  // list (table-level and column-level SELECT are independent ACL
  // entries in Postgres).
  const revokeIndex = executableSql.indexOf(
    "REVOKE SELECT ON TABLE public.parking_sites FROM anon;",
  );
  const grantIndex = executableSql.indexOf(
    "GRANT SELECT (id, event_id, site_number, display_label, map_x, map_y, master_site_id)",
  );
  assert.ok(revokeIndex >= 0 && grantIndex > revokeIndex);
});

// ─── B/C/F. Reciprocal, governed, map-shaped roster contract ───────────

test("get_event_participant_map_roster resolves caller identity and fails closed before any target is queried", () => {
  const fnBody = extractFunctionBody(
    executableSql,
    "get_event_participant_map_roster",
  );
  assert.ok(fnBody, "expected get_event_participant_map_roster body");
  assert.match(
    fnBody!,
    /resolve_temporary_or_authenticated_attendee\(\s*\n\s*p_event_id, p_event_code, p_registration_identifier\s*\n\s*\)/,
  );
  assert.match(
    fnBody!,
    /IF v_caller_attendee_id IS NULL THEN\s*\n\s*RETURN;/,
  );
});

test("get_event_participant_map_roster requires the caller's own Name to be shared -- reciprocal share-to-see, server-enforced", () => {
  const fnBody = extractFunctionBody(
    executableSql,
    "get_event_participant_map_roster",
  );
  assert.ok(fnBody, "expected get_event_participant_map_roster body");
  assert.match(
    fnBody!,
    /WHERE attendee_id = v_caller_attendee_id AND field_key = 'name'/,
  );
  assert.match(
    fnBody!,
    /IF NOT coalesce\(v_caller_participates, false\) THEN\s*\n\s*RETURN;/,
  );
});

test("every optional target field is masked by that target's own governed preference", () => {
  const fnBody = extractFunctionBody(
    executableSql,
    "get_event_participant_map_roster",
  );
  assert.ok(fnBody, "expected get_event_participant_map_roster body");
  assert.match(fnBody!, /CASE WHEN name_pref\.shared THEN a\.pilot_first ELSE NULL END/);
  assert.match(fnBody!, /CASE WHEN name_pref\.shared THEN a\.pilot_last ELSE NULL END/);
  assert.match(
    fnBody!,
    /CASE WHEN coach_pref\.shared THEN a\.coach_manufacturer ELSE NULL END/,
  );
  assert.match(
    fnBody!,
    /CASE WHEN coach_pref\.shared THEN a\.coach_model ELSE NULL END/,
  );
  assert.match(
    fnBody!,
    /CASE WHEN campsite_pref\.shared THEN site\.display_label ELSE NULL END/,
  );
});

test("get_event_participant_map_roster enforces registration-status eligibility, closing the drift from get_event_public_roster", () => {
  const fnBody = extractFunctionBody(
    executableSql,
    "get_event_participant_map_roster",
  );
  assert.ok(fnBody, "expected get_event_participant_map_roster body");
  assert.match(
    fnBody!,
    /coalesce\(a\.registration_status, ''\) IN \('active', 'registered'\)/,
  );
});

test("get_event_participant_map_roster is Event-scoped and lifecycle-gated, matching every other governed attendee contract", () => {
  const fnBody = extractFunctionBody(
    executableSql,
    "get_event_participant_map_roster",
  );
  assert.ok(fnBody, "expected get_event_participant_map_roster body");
  assert.match(fnBody!, /WHERE a\.event_id = p_event_id/);
  assert.match(fnBody!, /e\.visible_to_members = true/);
  assert.match(fnBody!, /coalesce\(e\.is_active, true\) = true/);
});

test("get_event_participant_map_roster never returns email, phone, household, or Co-pilot identity", () => {
  const fnBody = extractFunctionBody(
    executableSql,
    "get_event_participant_map_roster",
  );
  assert.ok(fnBody, "expected get_event_participant_map_roster body");

  const returnsMatch = fnBody!.match(
    /RETURNS TABLE\(([\s\S]*?)\)\s*\nLANGUAGE/,
  );
  assert.ok(returnsMatch, "expected a RETURNS TABLE column list");
  const columnList = returnsMatch![1];

  for (const forbidden of [
    "email",
    "phone",
    "household",
    "copilot",
    "co_pilot",
    "co-pilot",
  ]) {
    assert.equal(
      columnList.toLowerCase().includes(forbidden),
      false,
      `get_event_participant_map_roster must not return '${forbidden}'`,
    );
  }

  // Arrival is the one deliberate exception to "map fields only, nothing
  // this page doesn't need" -- it is documented as independent of
  // sharing under the Site Placement architecture, exactly as it was in
  // the contract this replaces.
  assert.match(columnList, /has_arrived/);
  assert.match(columnList, /arrival_status/);
});

test("get_event_participant_map_roster is SECURITY DEFINER with a locked search_path, granted to anon and authenticated only", () => {
  const fnBody = extractFunctionBody(
    executableSql,
    "get_event_participant_map_roster",
  );
  assert.ok(fnBody, "expected get_event_participant_map_roster body");
  assert.match(fnBody!, /SECURITY DEFINER/);
  assert.match(fnBody!, /SET search_path TO 'pg_catalog'/);
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.get_event_participant_map_roster\(uuid, text, text\) FROM PUBLIC, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.get_event_participant_map_roster\(uuid, text, text\) TO anon, authenticated;/,
  );
});

// ─── D. Cross-Event isolation reuses the existing identity boundary ────

test("get_event_participant_map_roster reuses resolve_temporary_or_authenticated_attendee rather than inventing a parallel identity model", () => {
  assert.match(
    executableSql,
    /public\.resolve_temporary_or_authenticated_attendee\(/,
  );
  assert.doesNotMatch(executableSql, /CREATE .*FUNCTION.*resolve_/i);
});

// ─── G. /coach-map/public: server contract, not client-only hiding ─────

test("/coach-map/public calls the reciprocal, governed contract and no longer calls the retired broadcast RPC", () => {
  assert.match(
    COACH_MAP_PUBLIC_SOURCE,
    /\.rpc\("get_event_participant_map_roster",/,
  );
  assert.doesNotMatch(
    COACH_MAP_PUBLIC_SOURCE,
    /\.rpc\("get_event_public_roster"/,
  );
});

test("/coach-map/public no longer reconstructs reciprocity from a viewer/occupant opted-in pair -- the server result already reflects it", () => {
  assert.doesNotMatch(COACH_MAP_PUBLIC_SOURCE, /viewerHasOptedIn/);
  assert.doesNotMatch(COACH_MAP_PUBLIC_SOURCE, /occupantHasOptedIn/);
  assert.match(
    COACH_MAP_PUBLIC_SOURCE,
    /const canShowPrivateDetails = !!selectedAttendee;/,
  );
});

// ─── H. Neither page reads parking_sites directly anymore ──────────────

test("/map and /coach-map/public no longer read public.parking_sites directly -- both go through the governed geometry RPC", () => {
  assert.doesNotMatch(MAP_PAGE_SOURCE, /\.from\("parking_sites"\)/);
  assert.match(MAP_PAGE_SOURCE, /\.rpc\("get_event_public_map_sites",/);

  assert.doesNotMatch(COACH_MAP_PUBLIC_SOURCE, /\.from\("parking_sites"\)/);
  assert.match(
    COACH_MAP_PUBLIC_SOURCE,
    /\.rpc\("get_event_public_map_sites",/,
  );
});

test("/map passes best-effort legitimate-participant identity to the reciprocal roster call rather than a separate anonymous/member branch", () => {
  assert.match(MAP_PAGE_SOURCE, /\.rpc\("get_event_participant_map_roster",/);
  assert.match(MAP_PAGE_SOURCE, /p_event_code: memberEvent\?\.event_code \|\| null/);
  assert.match(
    MAP_PAGE_SOURCE,
    /p_registration_identifier:\s*\n\s*memberSession\?\.attendee_email \|\| memberSession\?\.attendee_phone \|\| null/,
  );
});
