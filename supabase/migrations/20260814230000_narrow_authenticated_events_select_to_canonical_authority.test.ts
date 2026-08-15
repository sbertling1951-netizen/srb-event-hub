import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for narrowing authenticated's
// public.events SELECT from USING (true) to the canonical
// has_event_admin_authority(auth.uid(), id) predicate, and dropping the
// obsolete/inferior "Admins can view allowed events" policy.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814230000_narrow_authenticated_events_select_to_canonical_authority.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260814230000_narrow_authenticated_events_select_to_canonical_authority.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("drops the obsolete 'Admins can view allowed events' policy", () => {
  assert.match(
    executableSql,
    /DROP POLICY IF EXISTS "Admins can view allowed events" ON public\.events;/,
  );
});

test("drops the unconditional 'Authenticated read events' policy before recreating it", () => {
  assert.match(
    executableSql,
    /DROP POLICY IF EXISTS "Authenticated read events" ON public\.events;/,
  );
});

test("recreates 'Authenticated read events' scoped to the canonical authority predicate", () => {
  const createMatch = executableSql.match(
    /CREATE POLICY "Authenticated read events"[\s\S]*?;/,
  );
  assert.ok(createMatch);
  const policyBlock = createMatch[0];
  assert.match(policyBlock, /FOR SELECT/);
  assert.match(policyBlock, /TO authenticated/);
  assert.match(
    policyBlock,
    /USING \(public\.has_event_admin_authority\(auth\.uid\(\), id\)\)/,
  );
  assert.equal(/USING \(true\)/.test(policyBlock), false);
  assert.equal(/\banon\b/.test(policyBlock), false);
});

test("does not touch UPDATE authority, grants, or any other policy", () => {
  assert.equal(/"Admins can update events"/.test(executableSql), false);
  assert.equal(/\bGRANT\b|\bREVOKE\b/.test(executableSql), false);
  assert.equal(/FOR (INSERT|UPDATE|DELETE)/.test(executableSql), false);
});

test("does not create an RPC or touch any governed Event read function", () => {
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(executableSql), false);
  for (const fn of [
    "get_public_discoverable_events",
    "get_event_continuity_context",
    "get_current_active_event",
    "get_tenant_owned_event_ids",
  ]) {
    assert.equal(
      executableSql.includes(fn),
      false,
      `must not reference ${fn} -- out of scope`,
    );
  }
});

test("no other table or domain is touched", () => {
  for (const forbidden of [
    "vendors",
    "parking_sites",
    "event_map_settings",
    "event_evaluations",
    "announcements",
    "attendees",
    "vendor_event_applications",
    "vendor_event_dispositions",
    "admin_event_access",
    "admin_tenant_access",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope`,
    );
  }
});
