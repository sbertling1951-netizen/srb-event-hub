import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural proof for the agenda_items admin READ-authority
// reconciliation. Same convention as
// 20260818150000_reconcile_attendees_household_members_read_authority.test.ts
// and its siblings: no live-Postgres test harness exists in this
// environment (no Docker/local Supabase), so every migration test proves
// invariants by reading the migration's own SQL source. The live-database
// access-delta and dead-grant claims this migration's header makes were
// separately verified against the linked project directly (agenda_items
// Admin Read-Authority Reconciliation workstream); this file proves the
// SQL text matches what that inspection concluded was safe, not the live
// database state itself. Run with:
//   npx tsx --test supabase/migrations/20260818190000_reconcile_agenda_items_admin_read_authority.test.ts

const SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "./20260818190000_reconcile_agenda_items_admin_read_authority.sql",
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

// ---- 1. The admin SELECT policy is redefined onto event.agenda.view, scoped to the row's own event_id. ----

test("agenda_items admin SELECT requires event.agenda.view against the row's own event_id", () => {
  const block = policyBlock("Admins can view agenda items");
  assert.match(block, /FOR SELECT/);
  assert.match(
    block,
    /USING \(public\.has_event_task_authority\('event\.agenda\.view', event_id\)\)/,
  );
});

test("the admin SELECT policy keys off event.agenda.view specifically, never event.agenda.manage", () => {
  assert.equal(/event\.agenda\.manage/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 2. The unscoped legacy policy is dropped and never recreated. ----

test("the redefined 'Admins can view agenda items' policy is dropped before being recreated", () => {
  assert.match(
    SOURCE_NO_COMMENTS,
    /DROP POLICY IF EXISTS "Admins can view agenda items" ON public\.agenda_items;/,
  );
});

// ---- 3. The unreachable 'SA or event admins' policy is dropped outright, not replaced. ----

test("'SA or event admins can view agenda items' is dropped and never recreated", () => {
  assert.match(
    SOURCE_NO_COMMENTS,
    /DROP POLICY IF EXISTS "SA or event admins can view agenda items" ON public\.agenda_items;/,
  );
  assert.equal(
    /CREATE POLICY "SA or event admins can view agenda items"/.test(
      SOURCE_NO_COMMENTS,
    ),
    false,
  );
});

// ---- 4. Member/public read policy is untouched. ----

test("'Members can view published agenda items' is neither dropped nor recreated", () => {
  assert.equal(
    /Members can view published agenda items/.test(SOURCE_NO_COMMENTS),
    false,
  );
});

// ---- 5. Mutation authority is out of scope here. ----

test("no INSERT/UPDATE/DELETE policy is created, dropped, or referenced -- mutation authority is out of scope here", () => {
  assert.equal(/FOR INSERT/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/FOR UPDATE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/FOR DELETE/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 6. No inline legacy predicate logic remains; authority is delegated entirely to the canonical resolver. ----

test("no privilege_group, is_super_admin, or inline admin_event_access logic remains in the recreated policy", () => {
  assert.equal(/privilege_group/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/is_super_admin/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/admin_event_access/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(
    /has_platform_admin_authority|has_tenant_admin_authority/.test(
      SOURCE_NO_COMMENTS,
    ),
    false,
  );
});

// ---- 7. Pure RLS-policy predicate swap: no RPC, table, or ACL statement is touched. ----

test("exactly one CREATE POLICY statement, SELECT, on agenda_items", () => {
  const creates = SOURCE_NO_COMMENTS.match(/CREATE POLICY "[^"]+"/g) || [];
  assert.equal(creates.length, 1);
  assert.deepEqual(creates, ['CREATE POLICY "Admins can view agenda items"']);
});

test("no other table's RLS is touched -- every policy target is public.agenda_items", () => {
  const policyRefs = SOURCE_NO_COMMENTS.match(/\bON\s+public\.(\w+)/g) || [];
  const normalizedRefs = policyRefs.map((ref) => ref.replace(/\s+/g, " "));
  assert.ok(normalizedRefs.length > 0, "expected at least one policy target");
  for (const ref of normalizedRefs) {
    assert.equal(ref, "ON public.agenda_items");
  }
  assert.equal(/CREATE TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/ALTER TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/DROP TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(
    /CREATE OR REPLACE FUNCTION|CREATE FUNCTION/.test(SOURCE_NO_COMMENTS),
    false,
  );
});

test("no ACL (GRANT/REVOKE) statement is present -- this migration is a pure policy-predicate swap", () => {
  const aclStatements = SOURCE_NO_COMMENTS.match(/^(REVOKE|GRANT)\b.*$/gm) || [];
  assert.equal(aclStatements.length, 0);
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SOURCE, /^BEGIN;/m);
  assert.match(SOURCE, /^COMMIT;/m);
});
