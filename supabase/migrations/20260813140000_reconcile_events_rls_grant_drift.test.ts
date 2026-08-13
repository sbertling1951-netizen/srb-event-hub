import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Events RLS / Grant Drift
// Reconciliation migration (LEM Events Security Drift Repair Validation).
// These prove the migration's TEXT matches the agreed, narrow scope --
// they cannot prove live database behavior (see the completion report for
// read-only evidence gathered directly against the linked project via
// public.has_event_admin_authority). Run with:
//   npx tsx --test supabase/migrations/20260813140000_reconcile_events_rls_grant_drift.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260813140000_reconcile_events_rls_grant_drift.sql", import.meta.url),
  ),
  "utf8",
);

test("drops the duplicate 'Admins update events' UPDATE policy", () => {
  assert.match(SQL, /DROP POLICY IF EXISTS "Admins update events" ON public\.events;/);
});

test("drops the duplicate lowercase 'public read events' SELECT policy", () => {
  assert.match(SQL, /DROP POLICY IF EXISTS "public read events" ON public\.events;/);
});

test("consolidates public read into exactly one 'Public read events' policy with unchanged broad-read semantics", () => {
  // Old policy is dropped defensively (idempotent against a fresh replay
  // where it never existed), then recreated once -- not left duplicated.
  assert.match(SQL, /DROP POLICY IF EXISTS "Public read events" ON public\.events;/);

  const createMatches = [
    ...SQL.matchAll(/CREATE POLICY "Public read events"\s*\nON public\.events\s*\nFOR SELECT\s*\nTO anon, authenticated\s*\nUSING \(true\);/g),
  ];
  assert.equal(
    createMatches.length,
    1,
    "expected exactly one recreated 'Public read events' policy, anon+authenticated, USING (true)",
  );
});

test("drops 'Admins can insert events' with no replacement INSERT policy anywhere in the file", () => {
  assert.match(SQL, /DROP POLICY IF EXISTS "Admins can insert events" ON public\.events;/);
  assert.equal(
    /FOR INSERT/.test(SQL),
    false,
    "no new INSERT policy should be introduced -- Event creation has no live consumer today",
  );
});

test("retargets 'Admins can update events' to the canonical has_event_admin_authority primitive in both USING and WITH CHECK", () => {
  assert.match(SQL, /DROP POLICY IF EXISTS "Admins can update events" ON public\.events;/);

  const updatePolicyMatch = SQL.match(
    /CREATE POLICY "Admins can update events"\s*\nON public\.events\s*\nFOR UPDATE\s*\nTO authenticated\s*\nUSING \(public\.has_event_admin_authority\(auth\.uid\(\), id\)\)\s*\nWITH CHECK \(public\.has_event_admin_authority\(auth\.uid\(\), id\)\);/,
  );
  assert.ok(
    updatePolicyMatch,
    "expected 'Admins can update events' to be USING/WITH CHECK public.has_event_admin_authority(auth.uid(), id) exactly",
  );

  // The legacy predicate this replaces must not appear inside any executable
  // statement (it is expected in the header comment's prose explaining what
  // was replaced -- only the SQL statements themselves are checked here).
  const executableSql = SQL.replace(/^--.*$/gm, "");
  assert.equal(
    /admin_users\.privilege_group|privilege_group = ANY/.test(executableSql),
    false,
    "the legacy privilege_group-only predicate must not be reintroduced in any executable statement",
  );
});

test("revokes INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER from both anon and authenticated", () => {
  assert.match(
    SQL,
    /REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER\s*\nON TABLE public\.events\s*\nFROM anon, authenticated;/,
  );
});

test("revokes UPDATE from anon only -- authenticated's UPDATE grant is left intact", () => {
  assert.match(SQL, /REVOKE UPDATE ON TABLE public\.events FROM anon;/);
  assert.equal(
    /REVOKE[^;]*UPDATE[^;]*FROM[^;]*authenticated;/s.test(
      SQL.replace(/REVOKE UPDATE ON TABLE public\.events FROM anon;/, ""),
    ),
    false,
    "authenticated must retain its UPDATE grant -- it is the live enforcement path for admin Event edits",
  );
});

test("introduces no DELETE policy and does not revoke a privilege that was never granted to authenticated", () => {
  assert.equal(/FOR DELETE/.test(SQL), false, "no DELETE policy should be created");
});

test("every DROP POLICY in the file is defensively guarded with IF EXISTS (fresh-replay and drifted-production convergence)", () => {
  const dropStatements = [...SQL.matchAll(/DROP POLICY[^\n;]*;/g)].map((m) => m[0]);
  assert.ok(dropStatements.length > 0, "expected at least one DROP POLICY statement");
  for (const stmt of dropStatements) {
    assert.match(stmt, /^DROP POLICY IF EXISTS/, `expected IF EXISTS guard in: ${stmt}`);
  }
});

test("touches only public.events -- no other table, and no Member/Context-layer identifiers", () => {
  const tableRefs = [...SQL.matchAll(/ON (?:TABLE )?public\.(\w+)/g)].map((m) => m[1]);
  assert.ok(tableRefs.length > 0);
  for (const table of tableRefs) {
    assert.equal(table, "events", `expected only public.events to be targeted, found public.${table}`);
  }

  for (const forbidden of ["attendees", "resolveAdminWorkingEvent", "adminEventContext", "is_active = true", "visible_to_members ="]) {
    assert.equal(
      SQL.includes(forbidden),
      false,
      `migration must not reference '${forbidden}' -- Member semantics and Event Context resolution are out of scope`,
    );
  }
});
