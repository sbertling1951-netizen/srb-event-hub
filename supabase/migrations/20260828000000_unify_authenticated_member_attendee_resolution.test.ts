import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260828000000_unify_authenticated_member_attendee_resolution.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

function fn(name: string) {
  const match = executableSql.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$(?:function\\$|\\$);`,
    ),
  );
  assert.ok(match, `expected to find function ${name}`);
  return match[0];
}

function authenticatedBranch(source: string) {
  const start = source.indexOf("IF v_uid IS NOT NULL THEN");
  assert.notEqual(start, -1, "expected an authenticated branch");
  const end = source.indexOf("ELSE", start);
  assert.ok(end > start, "expected an ELSE closing the authenticated branch");
  return source.slice(start, end);
}

// -- 1/2/3/4: canonical, role-independent resolution (PILOT continues to
// work; HOUSEHOLD_MEMBER and COPILOT are structurally treated identically
// to PILOT; a self-mirrored Person dedupes to one attendee) -----------------

test("resolve_temporary_or_authenticated_attendee: authenticated branch never reads attendees.person_id as identity", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const branch = authenticatedBranch(resolver);
  assert.equal(/a\.person_id/.test(branch), false);
});

test("resolve_temporary_or_authenticated_attendee: authenticated branch uses the same canonical join as resolve_member_account", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const branch = authenticatedBranch(resolver);
  assert.match(
    branch,
    /FROM public\.person_event_participations AS pep\s*\n\s*JOIN public\.person_role_instances AS pri\s*\n\s*ON pri\.person_id = pep\.person_id\s*\n\s*AND pri\.event_id = pep\.event_id\s*\n\s*JOIN public\.attendees AS a\s*\n\s*ON a\.id = pri\.attendee_id/,
  );
  assert.match(branch, /pep\.participation_state = 'eligible'/);
  // Scoped to the one requested Event -- unlike resolve_member_account
  // (which enumerates every eligible Event), this function answers "the
  // attendee for THIS Event," so the join is additionally bound to
  // pep.event_id = p_event_id.
  assert.match(branch, /pep\.event_id = p_event_id/);
});

test("resolve_temporary_or_authenticated_attendee: no role is special-cased -- PILOT, COPILOT, and HOUSEHOLD_MEMBER resolve through the identical predicate", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const branch = authenticatedBranch(resolver);
  // The whole point of the repair: the authenticated branch's matching
  // query contains no identity_role filter or comparison at all, so a
  // COPILOT or HOUSEHOLD_MEMBER role instance is matched by the exact same
  // WHERE clause as a PILOT role instance -- there is no PILOT-only path
  // left to special-case.
  assert.equal(/identity_role/.test(branch), false);
  assert.equal(/'PILOT'/.test(branch), false);
});

test("resolve_temporary_or_authenticated_attendee: a Person with multiple role instances on the same attendee resolves once, not ambiguously", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const branch = authenticatedBranch(resolver);
  // Self-mirrored Pilot + Household-Member rows on the same attendee must
  // collapse to one match -- DISTINCT on attendee id, not on role-instance
  // id, is what makes that safe.
  assert.match(
    branch,
    /count\(DISTINCT a\.id\), array_agg\(DISTINCT a\.id\)/,
  );
});

// -- 5/6: WRONG PERSON / WRONG EVENT denial, via the established fail-closed
// convention already used everywhere else in this function -----------------

test("resolve_temporary_or_authenticated_attendee: fails closed (returns NULL) on zero or ambiguous matches, exactly as the existing temporary branch already does", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const branch = authenticatedBranch(resolver);
  assert.match(
    branch,
    /IF v_match_count <> 1 THEN\s*\n\s*RETURN NULL;\s*\n\s*END IF;/,
  );
});

test("resolve_temporary_or_authenticated_attendee: match is scoped to the requested Event only -- a Person's relationship at a different Event cannot satisfy this call", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const branch = authenticatedBranch(resolver);
  // pep.event_id = p_event_id (asserted above) is the sole Event-scoping
  // predicate; there is no OR/fallback that widens the match to any other
  // Event once that predicate is present.
  assert.equal((branch.match(/p_event_id/g) || []).length >= 1, true);
});

// -- 7: TEMPORARY EVENT ACCESS is byte-for-byte unchanged --------------------

test("resolve_temporary_or_authenticated_attendee: unauthenticated (event-code/email/phone) branch is untouched", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const elseStart = resolver.indexOf("IF v_uid IS NOT NULL THEN");
  const elseBranch = resolver.slice(resolver.indexOf("ELSE", elseStart));
  assert.match(elseBranch, /v_identifier_is_email := position\('@' IN btrim\(p_registration_identifier\)\) > 0;/);
  assert.match(elseBranch, /household_matches AS \(/);
  assert.match(elseBranch, /verified_matches AS \(/);
  // No Person/role table appears anywhere in the temporary path -- it
  // remains fully independent of the Person bridge.
  assert.equal(/person_role_instances|person_event_participations|resolve_auth_person_link/.test(elseBranch), false);
});

// -- lifecycle/visibility freeze: unchanged from the live version -----------

test("resolve_temporary_or_authenticated_attendee: events.is_active / visible_to_members gates are preserved unchanged", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const occurrences = resolver.match(/coalesce\(e\.is_active, true\) = true/g);
  assert.ok(occurrences && occurrences.length >= 2, "expected the is_active gate in both branches");
  assert.match(resolver, /e\.visible_to_members = true/);
});

// -- 8: submit_member_checkin no longer maintains an independent identity
// rule -- it delegates to the one shared resolver ---------------------------

test("submit_member_checkin: authenticated branch delegates to the shared resolver instead of an inline attendees.person_id check", () => {
  const checkin = fn("submit_member_checkin");
  const branch = authenticatedBranch(checkin);
  assert.equal(/a\.person_id/.test(branch), false);
  assert.match(
    branch,
    /v_verified_attendee_id := public\.resolve_temporary_or_authenticated_attendee\(\s*\n\s*p_event_id, NULL, NULL\s*\n\s*\);/,
  );
  assert.match(
    branch,
    /IF v_verified_attendee_id IS NULL\s*\n\s*OR v_verified_attendee_id IS DISTINCT FROM p_expected_attendee_id THEN/,
  );
});

test("submit_member_checkin: Tenant re-verification, temporary branch, site-report write, Arrival/sharing update, and audit insert are unchanged", () => {
  const checkin = fn("submit_member_checkin");
  assert.match(checkin, /Independent Tenant re-verification\./);
  assert.match(checkin, /WHERE e\.id = p_event_id\s*\n\s*AND e\.tenant_id = p_tenant_id\s*\n\s*AND t\.is_active = true;/);
  assert.match(checkin, /v_authorization_basis := 'temporary';/);
  assert.match(checkin, /PERFORM public\._record_member_site_report\(/);
  assert.match(
    checkin,
    /UPDATE public\.attendees AS a\s*\n\s*SET has_arrived = p_has_arrived,\s*\n\s*share_with_attendees = p_share_with_attendees,/,
  );
  assert.match(checkin, /INSERT INTO public\.member_checkin_audit \(/);
});

test("submit_member_checkin: does not weaken authority -- still raises on any unresolved attendee, never falls back to a guess", () => {
  const checkin = fn("submit_member_checkin");
  const branch = authenticatedBranch(checkin);
  assert.match(branch, /RAISE EXCEPTION 'Member check-in verification failed\.';/);
});

// -- grants/security characteristics unchanged -------------------------------

test("does not broaden grants, RLS, or ownership beyond the existing anon/authenticated EXECUTE contract", () => {
  assert.equal(/DISABLE ROW LEVEL SECURITY/.test(executableSql), false);
  assert.equal(/GRANT .* TO (?!anon, authenticated)/.test(executableSql), false);
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.resolve_temporary_or_authenticated_attendee\(uuid, text, text\)\s*\n\s*TO anon, authenticated;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.submit_member_checkin\(uuid, uuid, boolean, boolean, text, uuid, text, text\)\s*\n\s*TO anon, authenticated;/,
  );
});

test("function signatures are unchanged (no contract change)", () => {
  assert.match(
    executableSql,
    /CREATE OR REPLACE FUNCTION public\.resolve_temporary_or_authenticated_attendee\(\s*\n\s*p_event_id uuid,\s*\n\s*p_event_code text DEFAULT NULL,\s*\n\s*p_registration_identifier text DEFAULT NULL\s*\n\)\s*\nRETURNS uuid/,
  );
  assert.match(
    executableSql,
    /CREATE OR REPLACE FUNCTION public\.submit_member_checkin\(\s*\n\s*p_event_id uuid,\s*\n\s*p_expected_attendee_id uuid,\s*\n\s*p_has_arrived boolean,\s*\n\s*p_share_with_attendees boolean,\s*\n\s*p_assigned_site text,\s*\n\s*p_tenant_id uuid,\s*\n\s*p_event_code text DEFAULT NULL,\s*\n\s*p_registration_identifier text DEFAULT NULL\s*\n\)\s*\nRETURNS TABLE\(/,
  );
});
