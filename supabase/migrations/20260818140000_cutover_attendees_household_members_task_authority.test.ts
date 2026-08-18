import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural proof for the Attendees + Household Members canonical
// task-authority RLS cutover. This repository has no live-Postgres test
// harness for any migration (no Docker/local Supabase in this
// environment) -- every sibling migration test proves invariants by
// reading the migration's own SQL source and asserting the required
// properties are structurally present, exactly as
// 20260818130000_cutover_vendor_service_requests_task_authority.test.ts
// and 20260811230000's sibling tests already do. The live-database
// access delta/schema-shape claims this migration's header makes were
// separately verified against the linked project directly (Live
// Attendees / Household Member RLS Authority Inspection workstream);
// this file proves the SQL text matches what that inspection concluded
// was safe, not the live database state itself. Run with:
//   npx tsx --test supabase/migrations/20260818140000_cutover_attendees_household_members_task_authority.test.ts

const SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "./20260818140000_cutover_attendees_household_members_task_authority.sql",
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

// ---- 1, 2, 3. attendees INSERT/UPDATE/DELETE require event.attendees.manage for the row's own Event. ----

test("attendees INSERT requires event.attendees.manage against the inserted row's own event_id", () => {
  const block = policyBlock("SA or event admins can insert attendees");
  assert.match(block, /FOR INSERT/);
  assert.match(
    block,
    /WITH CHECK \(public\.has_event_task_authority\('event\.attendees\.manage', event_id\)\)/,
  );
  assert.equal(/\bUSING\s*\(/.test(block), false, "INSERT policies have no USING clause");
});

test("attendees UPDATE requires event.attendees.manage on both USING (old row) and WITH CHECK (resulting row)", () => {
  const block = policyBlock("SA or event admins can update attendees");
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

test("attendees DELETE requires event.attendees.manage against the row's own event_id", () => {
  const block = policyBlock("SA or event admins can delete attendees");
  assert.match(block, /FOR DELETE/);
  assert.match(
    block,
    /USING \(public\.has_event_task_authority\('event\.attendees\.manage', event_id\)\)/,
  );
});

// ---- 4. Event A authority cannot mutate Event B -- the row's own event_id is always the input. ----

test("every attendees mutation policy passes the row's own bare event_id column -- never a session, working-Event, or literal value", () => {
  const calls = SOURCE_NO_COMMENTS.match(
    /has_event_task_authority\('event\.attendees\.manage', ([^)]+)\)/g,
  ) || [];
  assert.ok(calls.length >= 7, "expected at least 7 call sites across both tables (3 attendees + 4 household-member)");
  for (const call of calls) {
    assert.match(call, /has_event_task_authority\('event\.attendees\.manage', event_id\)/);
  }
  assert.equal(/current_setting/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/has_event_task_authority\('event\.attendees\.manage', '[0-9a-f-]+'\)/i.test(SOURCE_NO_COMMENTS), false);
});

// ---- 5, 6. household-member INSERT/UPDATE/DELETE are Event-scoped; UPDATE cannot move into an unauthorized Event. ----

test("household-member INSERT requires event.attendees.manage against the inserted row's own event_id", () => {
  const block = policyBlock("admin insert household members");
  assert.match(block, /FOR INSERT/);
  assert.match(
    block,
    /WITH CHECK \(public\.has_event_task_authority\('event\.attendees\.manage', event_id\)\)/,
  );
});

test("household-member UPDATE protects both the old row (USING) and the resulting row (WITH CHECK)", () => {
  const block = policyBlock("admin update household members");
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

test("household-member DELETE requires event.attendees.manage against the row's own event_id", () => {
  const block = policyBlock("admin delete household members");
  assert.match(block, /FOR DELETE/);
  assert.match(
    block,
    /USING \(public\.has_event_task_authority\('event\.attendees\.manage', event_id\)\)/,
  );
});

// ---- 7, 8. Any active admin without the task is denied; Platform/Tenant inheritance delegated, never reimplemented. ----

test("no privilege_group, is_active_admin, or inline admin_event_access/is_super_admin logic remains in any mutation policy -- authority is delegated entirely to has_event_task_authority", () => {
  assert.equal(/privilege_group/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/is_active_admin/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/is_super_admin/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/admin_event_access/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/has_platform_admin_authority|has_tenant_admin_authority/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 9. Member self-service SELECT/RPC behavior is untouched -- no SELECT policy, function, or RPC is touched. ----

test("no SELECT policy is created, dropped, or referenced -- SELECT semantics are explicitly out of scope for this migration", () => {
  assert.equal(/FOR SELECT/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/Admins can view attendees|Admins can view household members|SA or event admins can view attendees|Members can view own attendee row/.test(SOURCE_NO_COMMENTS), false);
});

test("no member/self-service RPC is redefined or touched", () => {
  assert.equal(
    /submit_member_checkin|save_participant_identity|update_participant_email|finalize_member_identity_activation|increment_attendee_login|record_participant_capacity_increase/.test(
      SOURCE_NO_COMMENTS,
    ),
    false,
  );
  assert.equal(/CREATE OR REPLACE FUNCTION|CREATE FUNCTION/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 10, 11. No broad active-admin mutation policy remains; no permissive sibling policy restores the old bypass. ----

test("exactly six mutation policies are (re)created, three per table, and no other policy is introduced", () => {
  const creates = SOURCE_NO_COMMENTS.match(/CREATE POLICY "[^"]+"/g) || [];
  assert.equal(creates.length, 6);
  assert.deepEqual(
    creates.sort(),
    [
      'CREATE POLICY "SA or event admins can insert attendees"',
      'CREATE POLICY "SA or event admins can update attendees"',
      'CREATE POLICY "SA or event admins can delete attendees"',
      'CREATE POLICY "admin insert household members"',
      'CREATE POLICY "admin update household members"',
      'CREATE POLICY "admin delete household members"',
    ].sort(),
  );
});

test("no other table's RLS is touched -- every policy target is public.attendees or public.attendee_household_members", () => {
  const policyRefs = SOURCE_NO_COMMENTS.match(/\bON\s+public\.(\w+)/g) || [];
  const normalizedRefs = policyRefs.map((ref) => ref.replace(/\s+/g, " "));
  assert.ok(normalizedRefs.length > 0, "expected at least one policy target");
  for (const ref of normalizedRefs) {
    assert.ok(
      ref === "ON public.attendees" || ref === "ON public.attendee_household_members",
      `unexpected policy target: ${ref}`,
    );
  }
  assert.equal(/CREATE TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/ALTER TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/DROP TABLE/.test(SOURCE_NO_COMMENTS), false);
});

// ---- ACL hardening: narrowly scoped, proven-independent anon revoke only. ----

test("the only ACL statement is a narrowly-scoped anon INSERT/DELETE revoke on attendees -- no grant is added, authenticated/service_role are untouched", () => {
  const aclStatements = SOURCE_NO_COMMENTS.match(/^(REVOKE|GRANT)\b.*$/gm) || [];
  assert.equal(aclStatements.length, 1);
  assert.match(aclStatements[0], /^REVOKE INSERT, DELETE ON TABLE public\.attendees FROM anon;$/);
  assert.equal(/FROM authenticated/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/FROM service_role/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/attendee_household_members[\s\S]{0,80}FROM anon/.test(SOURCE_NO_COMMENTS), false);
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SOURCE, /^BEGIN;/m);
  assert.match(SOURCE, /^COMMIT;/m);
});
