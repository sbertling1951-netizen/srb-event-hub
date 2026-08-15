import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the anon Public Event SELECT
// retirement. authenticated's SELECT is deliberately preserved (Admin
// pages still depend on it directly); only anon's capability is removed.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814210000_retire_anon_public_events_select.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260814210000_retire_anon_public_events_select.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("drops the broad anon+authenticated 'Public read events' policy", () => {
  assert.match(executableSql, /DROP POLICY IF EXISTS "Public read events" ON public\.events;/);
});

test("recreates an unconditional SELECT policy scoped to authenticated only, same USING (true) predicate", () => {
  const createMatch = executableSql.match(/CREATE POLICY "Authenticated read events"[\s\S]*?;/);
  assert.ok(createMatch);
  const policyBlock = createMatch[0];
  assert.match(policyBlock, /FOR SELECT/);
  assert.match(policyBlock, /TO authenticated/);
  assert.match(policyBlock, /USING \(true\)/);
  assert.equal(/\banon\b/.test(policyBlock), false);
});

test("revokes anon's raw SELECT grant on public.events, does not touch authenticated's", () => {
  assert.match(executableSql, /REVOKE SELECT ON TABLE public\.events FROM anon;/);
  assert.equal(/REVOKE[^;]*authenticated/.test(executableSql), false);
});

test("does not touch Admin policies or any other existing public.events policy/grant", () => {
  assert.equal(/"Admins can update events"/.test(executableSql), false);
  assert.equal(/"Admins can view allowed events"/.test(executableSql), false);
  assert.equal(/INSERT|UPDATE|DELETE|TRUNCATE/.test(executableSql), false);
});

test("does not touch any governed Event read function", () => {
  for (const fn of [
    "get_public_discoverable_events",
    "get_event_continuity_context",
    "get_current_active_event",
    "get_tenant_owned_event_ids",
  ]) {
    assert.equal(executableSql.includes(fn), false, `must not reference ${fn} -- out of scope`);
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
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope`,
    );
  }
});
