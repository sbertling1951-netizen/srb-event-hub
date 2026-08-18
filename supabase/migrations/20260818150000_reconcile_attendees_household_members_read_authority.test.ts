import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural proof for the Attendees + Household Members admin
// READ-authority reconciliation. Same convention as
// 20260818140000_cutover_attendees_household_members_task_authority.test.ts
// and its siblings: no live-Postgres test harness exists in this
// environment (no Docker/local Supabase), so every migration test proves
// invariants by reading the migration's own SQL source. The live-database
// access-delta claims this migration's header makes were separately
// verified against the linked project directly (Attendees Admin
// Read-Authority Reconciliation workstream); this file proves the SQL
// text matches what that inspection concluded was safe, not the live
// database state itself. Run with:
//   npx tsx --test supabase/migrations/20260818150000_reconcile_attendees_household_members_read_authority.test.ts

const SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "./20260818150000_reconcile_attendees_household_members_read_authority.sql",
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

// ---- 1, 2. Both admin SELECT policies are redefined onto event.attendees.view, scoped to the row's own event_id. ----

test("attendees admin SELECT requires event.attendees.view against the row's own event_id", () => {
  const block = policyBlock("Admins can view attendees");
  assert.match(block, /FOR SELECT/);
  assert.match(
    block,
    /USING \(public\.has_event_task_authority\('event\.attendees\.view', event_id\)\)/,
  );
});

test("household-member admin SELECT requires event.attendees.view against the row's own event_id", () => {
  const block = policyBlock("Admins can view household members");
  assert.match(block, /FOR SELECT/);
  assert.match(
    block,
    /USING \(public\.has_event_task_authority\('event\.attendees\.view', event_id\)\)/,
  );
});

test("both admin SELECT policies key off event.attendees.view specifically, never event.attendees.manage", () => {
  assert.equal(/event\.attendees\.manage/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 3. The redundant, narrower legacy policy is dropped outright, not replaced. ----

test("the fully-subsumed 'SA or event admins can view attendees' policy is dropped and never recreated", () => {
  assert.match(
    SOURCE_NO_COMMENTS,
    /DROP POLICY IF EXISTS "SA or event admins can view attendees" ON public\.attendees;/,
  );
  assert.equal(
    /CREATE POLICY "SA or event admins can view attendees"/.test(SOURCE_NO_COMMENTS),
    false,
  );
});

// ---- 4. Member self-service SELECT is untouched. ----

test("member self-service SELECT policy is neither dropped nor recreated", () => {
  assert.equal(/Members can view own attendee row/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 5. Mutation policies (already cut over) are untouched by this migration. ----

test("no INSERT/UPDATE/DELETE policy is created, dropped, or referenced -- mutation authority is out of scope here", () => {
  assert.equal(/FOR INSERT/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/FOR UPDATE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/FOR DELETE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(
    /SA or event admins can insert attendees|SA or event admins can update attendees|SA or event admins can delete attendees|admin insert household members|admin update household members|admin delete household members/.test(
      SOURCE_NO_COMMENTS,
    ),
    false,
  );
});

// ---- 6. No inline legacy predicate logic remains; authority is delegated entirely to the canonical resolver. ----

test("no privilege_group, is_super_admin, or inline admin_event_access logic remains in either recreated policy", () => {
  assert.equal(/privilege_group/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/is_super_admin/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/admin_event_access/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/has_platform_admin_authority|has_tenant_admin_authority/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 7. No RPC, table, or ACL statement is touched -- pure RLS-policy predicate swap. ----

test("exactly two CREATE POLICY statements, both SELECT, both on the two target tables", () => {
  const creates = SOURCE_NO_COMMENTS.match(/CREATE POLICY "[^"]+"/g) || [];
  assert.equal(creates.length, 2);
  assert.deepEqual(
    creates.sort(),
    [
      'CREATE POLICY "Admins can view attendees"',
      'CREATE POLICY "Admins can view household members"',
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
  assert.equal(/CREATE OR REPLACE FUNCTION|CREATE FUNCTION/.test(SOURCE_NO_COMMENTS), false);
});

test("no ACL (GRANT/REVOKE) statement is present -- this migration is a pure policy-predicate swap", () => {
  const aclStatements = SOURCE_NO_COMMENTS.match(/^(REVOKE|GRANT)\b.*$/gm) || [];
  assert.equal(aclStatements.length, 0);
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SOURCE, /^BEGIN;/m);
  assert.match(SOURCE, /^COMMIT;/m);
});
