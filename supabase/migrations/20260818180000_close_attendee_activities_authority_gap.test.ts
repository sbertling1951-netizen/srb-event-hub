import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural proof for the attendee_activities authority-gap closure.
// This repository has no live-Postgres test harness for any migration (no
// Docker/local Supabase in this environment) -- every sibling migration
// test proves invariants by reading the migration's own SQL source and
// asserting the required properties are structurally present, exactly as
// 20260818140000_cutover_attendees_household_members_task_authority.test.ts
// and its own siblings already do. The live-database evidence this
// migration's header cites (anon-reachable HTTP 200 with 57 rows, the
// 6-events/4-admin_event_access coverage gap, grant/policy inspection) was
// separately verified against the linked project directly; this file
// proves the SQL text matches what that inspection concluded was safe, not
// the live database state itself. Run with:
//   npx tsx --test supabase/migrations/20260818180000_close_attendee_activities_authority_gap.test.ts

const SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "./20260818180000_close_attendee_activities_authority_gap.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const SOURCE_NO_COMMENTS = SOURCE.replace(/--.*$/gm, "");

function policyBlock(name: string): string {
  const idx = SOURCE.indexOf(`CREATE POLICY "${name}"`);
  assert.ok(idx > -1, `expected to find CREATE POLICY "${name}"`);
  const end = SOURCE.indexOf(";", idx);
  return SOURCE.slice(idx, end + 1);
}

// ---- 1. The anon-open policy is dropped outright, with no replacement policy or RPC for anon. ----

test("the anon-open 'public read attendee_activities' policy is dropped, and no new policy targets anon", () => {
  assert.match(
    SOURCE,
    /DROP POLICY IF EXISTS "public read attendee_activities" ON public\.attendee_activities;/,
  );
  const created = SOURCE_NO_COMMENTS.match(/CREATE POLICY "[^"]+"[\s\S]*?;/g) || [];
  for (const block of created) {
    assert.equal(/\banon\b/.test(block), false, `unexpected anon reference in: ${block}`);
  }
});

test("no new function or RPC is created for anon or otherwise -- no legitimate anon consumer exists to replace", () => {
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 2. Admin SELECT is reconciled to event.attendees.view. ----

test("Admin SELECT requires event.attendees.view against the row's own event_id", () => {
  const block = policyBlock("Admins can view attendee activities");
  assert.match(block, /FOR SELECT/);
  assert.match(
    block,
    /USING \(public\.has_event_task_authority\('event\.attendees\.view', event_id\)\)/,
  );
});

// ---- 3, 4, 5. The single FOR ALL admin policy is split into INSERT/UPDATE/DELETE, each requiring event.attendees.manage. ----

test("the old FOR ALL 'Admins can manage attendee activities' policy is dropped and never recreated as FOR ALL", () => {
  assert.match(
    SOURCE,
    /DROP POLICY IF EXISTS "Admins can manage attendee activities" ON public\.attendee_activities;/,
  );
  assert.equal(/CREATE POLICY "Admins can manage attendee activities"/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/FOR ALL/.test(SOURCE_NO_COMMENTS), false);
});

test("INSERT requires event.attendees.manage against the inserted row's own event_id, with no USING clause", () => {
  const block = policyBlock("Admins can insert attendee activities");
  assert.match(block, /FOR INSERT/);
  assert.match(
    block,
    /WITH CHECK \(public\.has_event_task_authority\('event\.attendees\.manage', event_id\)\)/,
  );
  assert.equal(/\bUSING\s*\(/.test(block), false, "INSERT policies have no USING clause");
});

test("UPDATE requires event.attendees.manage on both USING (old row) and WITH CHECK (resulting row)", () => {
  const block = policyBlock("Admins can update attendee activities");
  assert.match(block, /FOR UPDATE/);
  assert.match(
    block,
    /USING \(public\.has_event_task_authority\('event\.attendees\.manage', event_id\)\)/,
  );
  assert.match(
    block,
    /WITH CHECK \(public\.has_event_task_authority\('event\.attendees\.manage', event_id\)\)/,
  );
});

test("DELETE requires event.attendees.manage against the row's own event_id", () => {
  const block = policyBlock("Admins can delete attendee activities");
  assert.match(block, /FOR DELETE/);
  assert.match(
    block,
    /USING \(public\.has_event_task_authority\('event\.attendees\.manage', event_id\)\)/,
  );
  assert.equal(/WITH CHECK/.test(block), false, "DELETE policies have no WITH CHECK clause");
});

// ---- 6. Every task-authority call site passes the row's own bare event_id -- never a session/working-Event/literal value. ----

test("every has_event_task_authority call passes the bare event_id column, never current_setting or a literal uuid", () => {
  const calls = SOURCE_NO_COMMENTS.match(/has_event_task_authority\('event\.attendees\.\w+', ([^)]+)\)/g) || [];
  assert.equal(
    calls.length,
    5,
    "1 view (SELECT USING) + 4 manage (INSERT WITH CHECK, UPDATE USING, UPDATE WITH CHECK, DELETE USING)",
  );
  for (const call of calls) {
    assert.match(call, /has_event_task_authority\('event\.attendees\.(view|manage)', event_id\)/);
  }
  assert.equal(/current_setting/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/has_event_task_authority\('event\.attendees\.\w+', '[0-9a-f-]+'\)/i.test(SOURCE_NO_COMMENTS), false);
});

// ---- 7. No legacy broad-admin predicate remains anywhere in the file. ----

test("no privilege_group, is_active_admin, is_super_admin, or inline admin_event_access logic remains -- authority is delegated entirely to has_event_task_authority", () => {
  assert.equal(/privilege_group/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/is_active_admin/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/is_super_admin/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/admin_event_access/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/is_event_scoped_admin/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/has_platform_admin_authority|has_tenant_admin_authority|has_event_admin_authority/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 8. Exactly four policies are created, all on attendee_activities; nothing else is touched. ----

test("exactly four policies are created, and every one targets public.attendee_activities", () => {
  const creates = SOURCE_NO_COMMENTS.match(/CREATE POLICY "[^"]+"/g) || [];
  assert.deepEqual(
    creates.sort(),
    [
      'CREATE POLICY "Admins can view attendee activities"',
      'CREATE POLICY "Admins can insert attendee activities"',
      'CREATE POLICY "Admins can update attendee activities"',
      'CREATE POLICY "Admins can delete attendee activities"',
    ].sort(),
  );
  const policyRefs = SOURCE_NO_COMMENTS.match(/\bON\s+public\.(\w+)/g) || [];
  assert.ok(policyRefs.length > 0);
  for (const ref of policyRefs) {
    assert.equal(ref.replace(/\s+/g, " "), "ON public.attendee_activities");
  }
});

test("no table, trigger, or other object is created, dropped, or altered -- only policies and one ACL statement", () => {
  assert.equal(/CREATE TABLE|DROP TABLE|ALTER TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/CREATE TRIGGER|DROP TRIGGER/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 9. ACL hardening: anon's grants are fully revoked; authenticated and service_role are untouched. ----

test("the only ACL statement revokes anon's SELECT/INSERT/UPDATE/DELETE on attendee_activities -- no grant is added, authenticated/service_role are untouched", () => {
  const aclStatements = SOURCE_NO_COMMENTS.match(/^(REVOKE|GRANT)\b.*$/gm) || [];
  assert.equal(aclStatements.length, 1);
  assert.match(
    aclStatements[0],
    /^REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public\.attendee_activities FROM anon;$/,
  );
  assert.equal(/FROM authenticated/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/FROM service_role/.test(SOURCE_NO_COMMENTS), false);
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SOURCE, /^BEGIN;/m);
  assert.match(SOURCE, /^COMMIT;/m);
});
