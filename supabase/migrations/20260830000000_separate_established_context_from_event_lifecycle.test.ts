import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260830000000_separate_established_context_from_event_lifecycle.sql",
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

function temporaryBranch(source: string) {
  const start = source.indexOf("IF v_uid IS NOT NULL THEN");
  const elseStart = source.indexOf("ELSE", start);
  const end = source.indexOf("END IF;\n\n  RETURN v_verified_attendee_id;");
  assert.ok(elseStart > start && end > elseStart);
  return source.slice(elseStart, end);
}

// -- established-context resolution: events.is_active / visible_to_members
// no longer gate the authenticated branch ----------------------------------

test("authenticated branch no longer reads events.is_active or events.visible_to_members", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const branch = authenticatedBranch(resolver);
  assert.equal(/e\.visible_to_members/.test(branch), false);
  assert.equal(/e\.is_active/.test(branch), false);
});

test("authenticated branch still enforces Event existence via the JOIN to public.events", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const branch = authenticatedBranch(resolver);
  assert.match(branch, /JOIN public\.events AS e\s*\n\s*ON e\.id = pep\.event_id/);
});

test("authenticated branch still requires eligible Person x Event participation and retains the attendee's own cancellation state", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const branch = authenticatedBranch(resolver);
  assert.match(branch, /pep\.participation_state = 'eligible'/);
  assert.match(branch, /coalesce\(a\.is_active, true\) = true/);
});

test("authenticated branch still uses the canonical role-independent Person x Event x Role join and never reads attendees.person_id", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const branch = authenticatedBranch(resolver);
  assert.match(
    branch,
    /FROM public\.person_event_participations AS pep\s*\n\s*JOIN public\.person_role_instances AS pri\s*\n\s*ON pri\.person_id = pep\.person_id\s*\n\s*AND pri\.event_id = pep\.event_id\s*\n\s*JOIN public\.attendees AS a\s*\n\s*ON a\.id = pri\.attendee_id/,
  );
  assert.equal(/a\.person_id/.test(branch), false);
  assert.equal(/identity_role/.test(branch), false);
  assert.equal(/'PILOT'/.test(branch), false);
});

test("authenticated branch still dedupes multi-role-instance self-mirroring and fails closed on ambiguity", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const branch = authenticatedBranch(resolver);
  assert.match(branch, /count\(DISTINCT a\.id\), array_agg\(DISTINCT a\.id\)/);
  assert.match(branch, /IF v_match_count <> 1 THEN\s*\n\s*RETURN NULL;\s*\n\s*END IF;/);
});

// -- Temporary Event Access branch is untouched -----------------------------

test("Temporary Event Access branch retains its existing entry-grade events.is_active / visible_to_members predicates unweakened", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const branch = temporaryBranch(resolver);
  const activeCount = (branch.match(/coalesce\(e\.is_active, true\) = true/g) || []).length;
  const visibleCount = (branch.match(/e\.visible_to_members = true/g) || []).length;
  assert.equal(activeCount, 2, "expected the gate in both primary_matches and household_matches CTEs");
  assert.equal(visibleCount, 2, "expected the gate in both primary_matches and household_matches CTEs");
});

test("Temporary Event Access branch never touches the Person/role bridge", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const branch = temporaryBranch(resolver);
  assert.equal(/person_role_instances|person_event_participations|resolve_auth_person_link/.test(branch), false);
});

// -- server-side parity / intentional-divergence: authenticated vs temporary
// deliberately differ, and that difference is the whole point of Stage 1 --

test("parity: the authenticated and temporary branches of the same function now intentionally diverge on lifecycle/visibility -- this is documented, not accidental", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  const authBranch = authenticatedBranch(resolver);
  const tempBranch = temporaryBranch(resolver);
  const authGatesOnLifecycle = /e\.is_active|e\.visible_to_members/.test(authBranch);
  const tempGatesOnLifecycle = /e\.is_active|e\.visible_to_members/.test(tempBranch);
  assert.equal(authGatesOnLifecycle, false, "established-context identity must not gate on Event lifecycle/visibility");
  assert.equal(tempGatesOnLifecycle, true, "Temporary Event Access must keep its entry-grade gate");
});

// -- Tenant-level authority guard (ADR-014, out of scope for this stage) is
// unchanged --------------------------------------------------------------

test("the top-level Tenant-active existence guard is unchanged and applies to both branches", () => {
  const resolver = fn("resolve_temporary_or_authenticated_attendee");
  assert.match(
    resolver,
    /IF NOT EXISTS \(\s*\n\s*SELECT 1\s*\n\s*FROM public\.events AS e\s*\n\s*JOIN public\.tenants AS t ON t\.id = e\.tenant_id\s*\n\s*WHERE e\.id = p_event_id\s*\n\s*AND t\.is_active = true\s*\n\s*\) THEN\s*\n\s*RETURN NULL;\s*\n\s*END IF;/,
  );
});

// -- grants/signature unchanged ---------------------------------------------

test("does not broaden grants or change the function signature", () => {
  assert.match(
    executableSql,
    /CREATE OR REPLACE FUNCTION public\.resolve_temporary_or_authenticated_attendee\(\s*\n\s*p_event_id uuid,\s*\n\s*p_event_code text DEFAULT NULL,\s*\n\s*p_registration_identifier text DEFAULT NULL\s*\n\)\s*\nRETURNS uuid/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.resolve_temporary_or_authenticated_attendee\(uuid, text, text\)\s*\n\s*TO anon, authenticated;/,
  );
  assert.equal(/GRANT .* TO (?!anon, authenticated)/.test(executableSql), false);
  assert.equal(/DISABLE ROW LEVEL SECURITY/.test(executableSql), false);
});

test("no other function is defined or modified by this migration", () => {
  const defs = executableSql.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) || [];
  assert.deepEqual(
    defs.map((d) => d.replace("CREATE OR REPLACE FUNCTION public.", "")),
    ["resolve_temporary_or_authenticated_attendee"],
  );
});
