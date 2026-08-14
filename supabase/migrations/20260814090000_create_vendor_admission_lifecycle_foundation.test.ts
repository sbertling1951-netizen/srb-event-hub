import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Vendor Admission Lifecycle Stage 1
// (Foundation) migration. This migration creates three tables, additive
// columns on event_vendors, five trigger functions, and backfill logic --
// its shape is provable from its SQL text. Live proofs (isolation across
// Events/Tenants, application/disposition invariant enforcement,
// immutability, reason-classification derivation, EA/TA/SA authority via
// has_event_task_authority, backfill correctness, zero residue) were
// independently verified against the linked database inside
// rollback-contained transactions and are reported separately, not
// re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814090000_create_vendor_admission_lifecycle_foundation.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814090000_create_vendor_admission_lifecycle_foundation.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("statement is wrapped in a single transaction", () => {
  assert.match(executableSql.trim(), /^BEGIN;/);
  assert.match(executableSql.trim(), /COMMIT;$/);
});

test("creates exactly the three new tables", () => {
  const creates = executableSql.match(/CREATE TABLE public\.(\w+)/g) || [];
  const names = creates.map((c) => c.replace("CREATE TABLE public.", ""));
  assert.deepEqual(
    names.sort(),
    ["vendor_disposition_reason_codes", "vendor_event_applications", "vendor_event_dispositions"].sort(),
  );
});

test("does not use is_active_admin anywhere -- admission authority must not fall back to any-active-admin", () => {
  assert.equal(/is_active_admin/.test(executableSql), false);
});

test("does not use has_vendor_catalog_admin_authority anywhere -- catalog CRUD authority and admission authority stay separate", () => {
  assert.equal(/has_vendor_catalog_admin_authority/.test(executableSql), false);
});

test("both event-scoped SELECT policies use has_event_task_authority('event.vendors.view', event_id) -- the canonical EA/TA/SA resolver", () => {
  const calls = executableSql.match(/has_event_task_authority\([^)]*\)/g) || [];
  assert.ok(calls.length >= 2, "expected at least two has_event_task_authority calls");
  for (const call of calls) {
    assert.match(call, /has_event_task_authority\('event\.vendors\.view', event_id\)/);
  }
});

test("vendor_disposition_reason_codes is seeded with exactly 18 rows across the three required classifications", () => {
  const insertMatch = executableSql.match(/INSERT INTO public\.vendor_disposition_reason_codes[\s\S]*?;/);
  assert.ok(insertMatch, "seed INSERT not found");
  const seed = insertMatch[0];
  const rows = seed.match(/\('[^']+', '[^']+', '[^']+'\)/g) || [];
  assert.equal(rows.length, 18);

  const byClassification = { operational_capacity: 0, performance_quality: 0, administrative_other: 0 };
  for (const row of rows) {
    const m = row.match(/\('([^']+)', '([^']+)', '[^']+'\)/);
    assert.ok(m, `unparseable seed row: ${row}`);
    const classification = m[2];
    assert.ok(classification in byClassification, `unexpected classification: ${classification}`);
    byClassification[classification as keyof typeof byClassification] += 1;
  }
  assert.equal(byClassification.operational_capacity, 6);
  assert.equal(byClassification.performance_quality, 7);
  assert.equal(byClassification.administrative_other, 5);
});

test("vendor_event_applications: candidacy uniqueness, status enum, and tenant_id derivation trigger", () => {
  assert.match(
    executableSql,
    /CONSTRAINT vendor_event_applications_unique_candidacy UNIQUE \(vendor_id, event_id\)/,
  );
  assert.match(
    executableSql,
    /status text NOT NULL DEFAULT 'pending'\s*\n\s*CHECK \(status IN \('pending', 'admitted', 'rejected', 'withdrawn'\)\)/,
  );
  assert.match(executableSql, /CREATE TRIGGER set_vendor_event_application_tenant_id_trigger/);
});

test("vendor_event_dispositions: decision_type enum, reason required for negative decisions, backfill has no named actor", () => {
  assert.match(
    executableSql,
    /decision_type text NOT NULL CHECK \(decision_type IN \('admitted', 'rejected', 'revoked'\)\)/,
  );
  assert.match(
    executableSql,
    /CONSTRAINT vendor_event_dispositions_reason_required_for_negative_decisions\s*\n\s*CHECK \(decision_type = 'admitted' OR reason_code IS NOT NULL\)/,
  );
  assert.match(
    executableSql,
    /CONSTRAINT vendor_event_dispositions_backfill_has_no_named_actor\s*\n\s*CHECK \(authority_basis <> 'backfill' OR \(actor_auth_user_id IS NULL AND actor_admin_user_id IS NULL\)\)/,
  );
  assert.match(
    executableSql,
    /authority_basis text NOT NULL CHECK \(authority_basis IN \('platform', 'tenant', 'event_grant', 'backfill'\)\)/,
  );
});

test("reason_classification is always derived server-side from reason_code, never taken from caller input", () => {
  const fnMatch = executableSql.match(/CREATE OR REPLACE FUNCTION public\.prepare_vendor_event_disposition\(\)[\s\S]*?\$\$;/);
  assert.ok(fnMatch, "prepare_vendor_event_disposition function not found");
  assert.match(fnMatch[0], /SELECT rc\.classification INTO NEW\.reason_classification/);
});

test("dispositions are append-only: immutability trigger fires BEFORE UPDATE OR DELETE and always raises", () => {
  const fnMatch = executableSql.match(/CREATE OR REPLACE FUNCTION public\.prevent_vendor_event_disposition_mutation\(\)[\s\S]*?\$\$;/);
  assert.ok(fnMatch, "prevent_vendor_event_disposition_mutation function not found");
  assert.match(fnMatch[0], /RAISE EXCEPTION 'vendor_event_dispositions is immutable'/);
  assert.match(
    executableSql,
    /CREATE TRIGGER prevent_vendor_event_disposition_mutation_trigger\s*\nBEFORE UPDATE OR DELETE ON public\.vendor_event_dispositions/,
  );
});

test("application state is synced from admitted/rejected dispositions only -- revoked is deliberately excluded", () => {
  const fnMatch = executableSql.match(/CREATE OR REPLACE FUNCTION public\.sync_vendor_event_application_from_disposition\(\)[\s\S]*?\$\$;/);
  assert.ok(fnMatch, "sync function not found");
  assert.match(fnMatch[0], /NEW\.decision_type IN \('admitted', 'rejected'\)/);
  assert.equal(/'revoked'.*IN \('admitted', 'rejected', 'revoked'\).*status/.test(fnMatch[0]), false);
});

test("no INSERT, UPDATE, or DELETE is granted to any role on either new table -- mutation is RPC-only", () => {
  const grantStatements = executableSql.match(/GRANT[^;]*;/g) || [];
  for (const stmt of grantStatements) {
    assert.equal(/\bINSERT\b/.test(stmt), false, `unexpected INSERT grant: ${stmt}`);
    assert.equal(/\bUPDATE\b/.test(stmt), false, `unexpected UPDATE grant: ${stmt}`);
    assert.equal(/\bDELETE\b/.test(stmt), false, `unexpected DELETE grant: ${stmt}`);
  }
  assert.equal(/GRANT SELECT ON TABLE public\.vendor_event_applications/.test(executableSql), false, "SELECT is granted via policy access, not an explicit table GRANT in this migration");
});

test("RLS is enabled on all three new tables", () => {
  for (const table of ["vendor_disposition_reason_codes", "vendor_event_applications", "vendor_event_dispositions"]) {
    assert.match(executableSql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
  }
});

test("event_vendors gets only additive columns -- no existing column, policy, or grant is touched", () => {
  assert.match(executableSql, /ALTER TABLE public\.event_vendors\s*\n\s*ADD COLUMN application_id/);
  assert.equal(/DROP COLUMN/.test(executableSql), false);
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY event_vendors_/.test(executableSql), false);
  assert.equal(/REVOKE/.test(executableSql), false);
  assert.equal(/action_type/.test(executableSql), false, "action_type must not be touched -- it is a different axis from admission_state");
});

test("admission_state defaults to 'admitted' and is constrained to admitted/revoked only", () => {
  assert.match(
    executableSql,
    /ADD COLUMN admission_state text NOT NULL DEFAULT 'admitted' CHECK \(admission_state IN \('admitted', 'revoked'\)\)/,
  );
});

test("backfill: existing event_vendors rows are preserved (no DELETE), each gets a synthesized application and backfill-marked disposition with no fabricated actor", () => {
  assert.equal(/DELETE FROM public\.event_vendors/.test(executableSql), false);
  const backfillBlock = executableSql.match(/DO \$\$[\s\S]*?FOR v_row IN[\s\S]*?END \$\$;/);
  assert.ok(backfillBlock, "backfill DO block not found");
  const block = backfillBlock[0];
  assert.match(block, /'backfill'/);
  assert.match(block, /coalesce\(v_row\.created_at, now\(\)\)/);
  assert.equal(/actor_auth_user_id\s*,\s*actor_admin_user_id/.test(block), false, "backfill insert must not populate actor columns");
});

test("no other domain table is referenced beyond vendors/events/tenants/admin_users/auth.users and the new tables", () => {
  for (const forbidden of ["agenda_items", "event_photos", "announcements", "parking_sites", "vendor_service_requests", "vendor_org_access", "vendor_contacts"]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this stage`,
    );
  }
});
