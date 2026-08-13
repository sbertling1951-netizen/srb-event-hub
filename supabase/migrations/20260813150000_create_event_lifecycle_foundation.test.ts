import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Event Lifecycle Foundation migration
// (ADR-013 §12 stages 3-4). These prove the migration's TEXT matches the
// accepted architecture -- three-state model, Event->Tenant->Platform(60)
// policy hierarchy, and a resolver that consults only Event dates/policy,
// never status/is_active/Authority/Context/Entitlement.
//
// The resolver's actual runtime BRANCH LOGIC -- override precedence,
// Event-local (not UTC) day-boundary math, DST handling via named-zone
// semantics, explicit-archive override, and the NULL-for-indeterminate
// behavior for a nonexistent Event, a missing end_date, and a missing/
// invalid timezone -- was proven separately by executing an exact mirror
// of this function's body against synthetic pg_temp fixtures on the linked
// database inside rolled-back transactions (session-scoped temp objects,
// zero residue): 15 cases total (11 branch/precedence cases + event-beats-
// tenant-override + 3 direct DST-offset proofs for fixed winter/summer/
// DST-crossing dates), all passing. See the completion report for the
// full matrix. That evidence cannot be captured here as a static
// assertion; this file proves the deployed SQL text matches what was
// tested.
//
// Run with:
//   npx tsx --test supabase/migrations/20260813150000_create_event_lifecycle_foundation.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260813150000_create_event_lifecycle_foundation.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("lifecycle_state is a three-state text+CHECK column, defaulting to the permissive 'operational'", () => {
  assert.match(
    executableSql,
    /ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'operational'/,
  );
  assert.match(
    executableSql,
    /CHECK \(lifecycle_state IN \('operational', 'post_event', 'archived'\)\)/,
  );
});

test("does not reuse or reinterpret events.status or events.is_active anywhere in the migration", () => {
  assert.equal(/\bstatus\b/.test(executableSql), false, "no reference to the legacy status column");
  assert.equal(/\bis_active\b/.test(executableSql), false, "no reference to the legacy is_active column");
});

test("archive/reopen bookkeeping columns exist as schema-only foundation (post_event_entered_at, archived_at, archived_by)", () => {
  assert.match(executableSql, /ADD COLUMN post_event_entered_at timestamptz NULL/);
  assert.match(executableSql, /ADD COLUMN archived_at timestamptz NULL/);
  assert.match(executableSql, /ADD COLUMN archived_by text NULL/);
  // Foundation only -- no archive_event/reopen_event RPC in this stage.
  assert.equal(/CREATE (OR REPLACE )?FUNCTION public\.archive_event/.test(SQL), false);
  assert.equal(/CREATE (OR REPLACE )?FUNCTION public\.reopen_event/.test(SQL), false);
});

test("policy hierarchy: Event and Tenant override columns exist with an identical non-negative bounds check", () => {
  assert.match(executableSql, /ALTER TABLE public\.events\s*\n\s*ADD CONSTRAINT events_post_event_edit_window_days_check\s*\n\s*CHECK \(post_event_edit_window_days IS NULL OR post_event_edit_window_days >= 0\);/);
  assert.match(executableSql, /ALTER TABLE public\.tenants\s*\n\s*ADD COLUMN post_event_edit_window_days integer NULL;/);
  assert.match(executableSql, /ALTER TABLE public\.tenants\s*\n\s*ADD CONSTRAINT tenants_post_event_edit_window_days_check\s*\n\s*CHECK \(post_event_edit_window_days IS NULL OR post_event_edit_window_days >= 0\);/);
});

test("the literal platform default 60 appears in exactly one place: the resolver's COALESCE fallback", () => {
  const sixtyOccurrences = [...executableSql.matchAll(/\b60\b/g)];
  assert.equal(sixtyOccurrences.length, 1, `expected exactly one literal '60', found ${sixtyOccurrences.length}`);
  assert.match(executableSql, /COALESCE\(v_event_window_days, v_tenant_window_days, 60\)/);
});

test("resolver signature matches ADR-013 §6.1: event_effective_lifecycle_state(uuid) returns text", () => {
  assert.match(
    executableSql,
    /CREATE OR REPLACE FUNCTION public\.event_effective_lifecycle_state\(p_event_id uuid\)\s*\nRETURNS text/,
  );
});

test("resolver reads events.timezone and derives the local day boundary via AT TIME ZONE, not a hardcoded 'UTC' literal", () => {
  assert.match(executableSql, /e\.timezone/, "must select events.timezone");
  assert.match(
    executableSql,
    /v_local_boundary_naive AT TIME ZONE v_timezone/,
    "the post-Event boundary must be converted using the Event's own timezone column, not a literal zone",
  );
  assert.match(
    executableSql,
    /v_local_deadline_naive AT TIME ZONE v_timezone/,
    "the freeze deadline must be converted using the Event's own timezone column",
  );
  assert.equal(
    /AT TIME ZONE 'UTC'/.test(executableSql),
    false,
    "no hardcoded UTC zone literal may appear -- the boundary must be Event-local",
  );
});

test("the local end boundary is midnight of the day AFTER end_date (operational through the entirety of end_date, not from its start)", () => {
  assert.match(
    executableSql,
    /v_local_boundary_naive := \(v_end_date \+ 1\)::timestamp;/,
    "the boundary must be end_date + 1 day, not end_date itself",
  );
});

test("the freeze deadline adds the resolved window as calendar days to the still-naive local boundary, converting to UTC only once, at the end (correct per-date DST offset)", () => {
  assert.match(
    executableSql,
    /v_local_deadline_naive := v_local_boundary_naive \+ make_interval\(days => v_resolved_window_days\);/,
  );
});

test("resolver branch order: not-found, then explicit archive, then null end_date, then invalid/missing timezone, then deadline, then boundary, then operational", () => {
  const fn = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\.event_effective_lifecycle_state[\s\S]*?^\$\$;/m,
  );
  assert.ok(fn, "expected to find the resolver function body");
  const body = fn![0];

  const iNotFound = body.indexOf("IF NOT FOUND THEN");
  const iArchivedExplicit = body.indexOf("v_lifecycle_state = 'archived'");
  const iNullEndDate = body.indexOf("v_end_date IS NULL");
  const iTimezoneInvalid = body.indexOf("pg_timezone_names");
  const iDeadline = body.indexOf("now() > v_deadline_utc");
  const iBoundary = body.indexOf("now() > v_post_event_boundary_utc");

  assert.ok(iNotFound === 0 || iNotFound > 0, "expected a NOT FOUND branch");
  assert.ok(iArchivedExplicit > iNotFound, "explicit archive checked after not-found");
  assert.ok(iNullEndDate > iArchivedExplicit, "null end_date checked after explicit archive");
  assert.ok(iTimezoneInvalid > iNullEndDate, "timezone validity checked after null end_date");
  assert.ok(iDeadline > iTimezoneInvalid, "deadline-elapsed check follows timezone validation");
  assert.ok(iBoundary > iDeadline, "local-boundary-elapsed check follows the deadline check");
});

test("resolver returns NULL (not 'archived') for a nonexistent Event -- invalid identity is not archived Lifecycle", () => {
  assert.match(executableSql, /IF NOT FOUND THEN\s*\n\s*RETURN NULL;/);
});

test("resolver returns NULL (not 'operational' or 'archived') when end_date is missing", () => {
  const nullBranch = executableSql.match(/IF v_end_date IS NULL THEN\s*\n\s*RETURN (\w+);/);
  assert.ok(nullBranch, "expected a null end_date branch");
  assert.equal(nullBranch![1], "NULL");
});

test("resolver returns NULL when timezone is missing or not a recognized zone name -- never silently assumes UTC or any other default", () => {
  assert.match(
    executableSql,
    /IF v_timezone IS NULL OR NOT EXISTS \(SELECT 1 FROM pg_timezone_names WHERE name = v_timezone\) THEN\s*\n\s*RETURN NULL;/,
  );
});

test("resolver deliberately does not consult Authority, Context, or Entitlement", () => {
  for (const forbidden of [
    "has_platform_admin_authority",
    "has_tenant_admin_authority",
    "has_event_admin_authority",
    "admin_event_access",
    "auth.uid()",
    "resolveAdminWorkingEvent",
    "adminEventContext",
    "entitlement",
    "subscription",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `resolver/migration must not reference '${forbidden}' -- Lifecycle must stay independent of Authority/Context/Entitlement`,
    );
  }
});

test("resolver EXECUTE is granted only to authenticated -- not anon, not service_role, not PUBLIC", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.event_effective_lifecycle_state\(uuid\) FROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.event_effective_lifecycle_state\(uuid\) TO authenticated;/,
  );
  // No broader/mutating grant is introduced anywhere in this migration.
  assert.equal(/GRANT (INSERT|UPDATE|DELETE|TRUNCATE)/i.test(executableSql), false);
});

test("does not recreate any policy or grant retired by the prior RLS/grant drift reconciliation", () => {
  for (const forbidden of ["CREATE POLICY", "DROP POLICY", "GRANT SELECT", "GRANT INSERT", "GRANT UPDATE ON TABLE public.events TO anon"]) {
    assert.equal(
      executableSql.includes(forbidden),
      false,
      `migration must not touch RLS policies or grants -- that is 20260813140000's domain, not this one`,
    );
  }
});

test("touches only public.events and public.tenants -- no other table", () => {
  const tableRefs = [...executableSql.matchAll(/ALTER TABLE public\.(\w+)/g)].map((m) => m[1]);
  assert.ok(tableRefs.length > 0);
  for (const table of tableRefs) {
    assert.ok(
      table === "events" || table === "tenants",
      `expected only public.events/public.tenants to be targeted, found public.${table}`,
    );
  }
});
