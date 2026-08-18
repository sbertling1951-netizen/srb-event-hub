import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural proof for the Vendor Requests Backend Authority
// Reconciliation. This repository has no live-Postgres test harness for
// any migration (no Docker/local Supabase in this environment) -- every
// sibling migration test proves invariants by reading the migration's
// own SQL source and asserting the required properties are structurally
// present, exactly as 20260811230000_cutover_event_locations_and_nearby_task_authority's
// sibling tests and 20260818120000_close_vendor_catalog_authority_oracle.test.ts
// already do. Run with:
//   npx tsx --test supabase/migrations/20260818130000_cutover_vendor_service_requests_task_authority.test.ts

const SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "./20260818130000_cutover_vendor_service_requests_task_authority.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

// Strips -- line comments so the header's own explanatory prose (which
// necessarily names the old is_active_admin(auth.uid()) predicate it
// replaces) doesn't trip a check for actual SQL statements.
const SOURCE_NO_COMMENTS = SOURCE.replace(/--.*$/gm, "");

// ---- 9. broad is_active_admin Admin bypass is gone. ----

test("is_active_admin no longer appears anywhere in an actual policy definition", () => {
  assert.equal(/is_active_admin/.test(SOURCE_NO_COMMENTS), false);
});

test("the legacy vendor_service_requests_admin_all_policy is dropped and never recreated", () => {
  assert.match(
    SOURCE,
    /DROP POLICY IF EXISTS vendor_service_requests_admin_all_policy ON public\.vendor_service_requests;/,
  );
  assert.equal(
    /CREATE POLICY vendor_service_requests_admin_all_policy/.test(SOURCE_NO_COMMENTS),
    false,
  );
});

// ---- 1, 2, 3. Admin access requires the canonical, Event-scoped task -- never a bare/unconditional grant. ----

test("every admin policy authorizes only through has_event_task_authority('event.vendors.manage', event_id) -- no bare true, no unconditional grant", () => {
  const policyBlocks = SOURCE_NO_COMMENTS.match(/CREATE POLICY vendor_service_requests_admin_\w+_policy[\s\S]*?;/g) || [];
  assert.equal(policyBlocks.length, 3, "expected exactly three admin policies (insert/update/delete)");
  for (const block of policyBlocks) {
    assert.match(
      block,
      /public\.has_event_task_authority\('event\.vendors\.manage', event_id\)/,
      `expected the canonical Event-scoped authority call in: ${block}`,
    );
    assert.equal(/USING \(true\)|WITH CHECK \(true\)/.test(block), false);
  }
});

// ---- 4. authority for Event A does not grant Event B access -- the row's own event_id is always the input, never a session/ambient value. ----

test("the Event ID passed to has_event_task_authority is always the row's own event_id column -- never a working-Event, session, or hardcoded value", () => {
  const calls = SOURCE_NO_COMMENTS.match(/has_event_task_authority\('event\.vendors\.manage', ([^)]+)\)/g) || [];
  assert.ok(calls.length >= 4, "expected at least four call sites (insert, update USING+WITH CHECK, delete, select)");
  for (const call of calls) {
    assert.match(call, /has_event_task_authority\('event\.vendors\.manage', event_id\)/);
  }
  // No other identifier (e.g. a working-Event variable, current_setting, or
  // literal uuid) is ever supplied as the second argument.
  assert.equal(/has_event_task_authority\('event\.vendors\.manage', '[0-9a-f-]+'\)/i.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/current_setting/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 5. Tenant/Platform inheritance is delegated, never reimplemented. ----

test("Tenant/Platform inheritance is delegated entirely to has_event_task_authority -- no privilege_group, admin_tenant_access, or admin_event_access logic is reimplemented here", () => {
  assert.equal(/privilege_group/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/admin_tenant_access/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/admin_event_access/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/has_platform_admin_authority|has_tenant_admin_authority/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 6. UPDATE cannot move a request to an unauthorized Event -- WITH CHECK protects the resulting row, USING protects the existing row. ----

test("vendor_service_requests_admin_update_policy supplies both USING and WITH CHECK, each independently evaluating event_id", () => {
  const block = SOURCE.match(
    /CREATE POLICY vendor_service_requests_admin_update_policy[\s\S]*?;/,
  )?.[0];
  assert.ok(block, "expected the admin update policy block");
  assert.match(block!, /FOR UPDATE/);
  const usingMatch = block!.match(/USING \(\s*public\.has_event_task_authority\('event\.vendors\.manage', event_id\)\s*\)/);
  const checkMatch = block!.match(/WITH CHECK \(\s*public\.has_event_task_authority\('event\.vendors\.manage', event_id\)\s*\)/);
  assert.ok(usingMatch, "expected USING to reference the row's own event_id");
  assert.ok(checkMatch, "expected WITH CHECK to reference the row's own event_id");
});

// ---- 7. INSERT cannot create an admin-controlled request for an unauthorized Event. ----

test("vendor_service_requests_admin_insert_policy supplies WITH CHECK evaluating the inserted row's event_id", () => {
  const block = SOURCE.match(
    /CREATE POLICY vendor_service_requests_admin_insert_policy[\s\S]*?;/,
  )?.[0];
  assert.ok(block, "expected the admin insert policy block");
  assert.match(block!, /FOR INSERT/);
  assert.match(
    block!,
    /WITH CHECK \(\s*public\.has_event_task_authority\('event\.vendors\.manage', event_id\)\s*\)/,
  );
  assert.equal(/\bUSING\s*\(/.test(block!), false, "INSERT policies have no USING clause");
});

test("vendor_service_requests_admin_delete_policy uses USING (no WITH CHECK, matching DELETE's own semantics)", () => {
  const block = SOURCE.match(
    /CREATE POLICY vendor_service_requests_admin_delete_policy[\s\S]*?;/,
  )?.[0];
  assert.ok(block, "expected the admin delete policy block");
  assert.match(block!, /FOR DELETE/);
  assert.match(
    block!,
    /USING \(\s*public\.has_event_task_authority\('event\.vendors\.manage', event_id\)\s*\)/,
  );
});

// ---- 8. Vendor/self-service policies remain intact. ----

test("the member self-service SELECT branch (is_my_vendor_service_request) is reproduced verbatim, completely unchanged", () => {
  const block = SOURCE.match(
    /CREATE POLICY vendor_service_requests_authenticated_select_policy[\s\S]*?;/,
  )?.[0];
  assert.ok(block, "expected the SELECT policy block");
  assert.match(block!, /FOR SELECT/);
  assert.match(
    block!,
    /public\.has_event_task_authority\('event\.vendors\.manage', event_id\)\s*\n\s*OR public\.is_my_vendor_service_request\(vendor_service_requests\.id\)/,
  );
});

test("is_my_vendor_service_request itself is never redefined or altered -- only referenced", () => {
  assert.equal(
    /CREATE OR REPLACE FUNCTION public\.is_my_vendor_service_request/.test(SOURCE_NO_COMMENTS),
    false,
  );
  assert.equal(/DROP FUNCTION/.test(SOURCE_NO_COMMENTS), false);
});

test("no governed member RPC (submit/set-status/read) is touched -- only RLS policies are edited", () => {
  assert.equal(/CREATE OR REPLACE FUNCTION|CREATE FUNCTION/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/submit_my_vendor_service_request|set_my_vendor_service_request_status|get_my_vendor_service_requests/.test(SOURCE_NO_COMMENTS), false);
});

// ---- 10. no permissive sibling policy silently restores the broad bypass. ----

test("exactly four policies are created in this migration, and no other policy, grant, or revoke touches this table", () => {
  const creates = SOURCE_NO_COMMENTS.match(/CREATE POLICY \w+/g) || [];
  assert.equal(creates.length, 4);
  assert.deepEqual(
    creates.sort(),
    [
      "CREATE POLICY vendor_service_requests_admin_delete_policy",
      "CREATE POLICY vendor_service_requests_admin_insert_policy",
      "CREATE POLICY vendor_service_requests_admin_update_policy",
      "CREATE POLICY vendor_service_requests_authenticated_select_policy",
    ].sort(),
  );
  assert.equal(/GRANT|REVOKE/.test(SOURCE_NO_COMMENTS), false, "no grant/revoke statement should be needed for a pure RLS-basis swap");
});

test("no other table's RLS, grants, or schema is touched -- every policy target is public.vendor_service_requests", () => {
  const policyRefs = SOURCE_NO_COMMENTS.match(/\bON\s+public\.(\w+)/g) || [];
  const normalizedRefs = policyRefs.map((ref) => ref.replace(/\s+/g, " "));
  assert.ok(normalizedRefs.length > 0, "expected at least one policy target");
  for (const ref of normalizedRefs) {
    assert.equal(ref, "ON public.vendor_service_requests", `unexpected policy target: ${ref}`);
  }
  assert.equal(/CREATE TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/ALTER TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/DROP TABLE/.test(SOURCE_NO_COMMENTS), false);
});

test("can_manage_events (the legacy route-level key) is never referenced in this backend migration", () => {
  assert.equal(/can_manage_events/.test(SOURCE_NO_COMMENTS), false);
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SOURCE, /^BEGIN;/m);
  assert.match(SOURCE, /^COMMIT;/m);
});
