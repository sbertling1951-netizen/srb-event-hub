import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Vendor Admission Lifecycle Stage 2
// (Governed Operations) migration. This migration creates seven
// SECURITY DEFINER RPCs -- its authority usage, ACL intent, and
// invariant-preservation shape are all provable from its SQL text. Live
// proofs (authority resolution across EA/TA/SA/non-admin, atomicity,
// concurrency, idempotency, isolation, classification, cross-Tenant
// privacy) were independently verified against the linked database
// inside rollback-contained transactions and are reported separately,
// not re-asserted here. Live function-ACL inspection (not just migration
// intent) was also performed separately, per Stage 1's own lesson that
// Supabase default privileges can silently grant more than a migration
// states.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814130000_create_vendor_admission_lifecycle_operations.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814130000_create_vendor_admission_lifecycle_operations.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

const FUNCTIONS = [
  { name: "register_vendor_event_candidacy", args: "uuid, uuid" },
  { name: "admit_vendor_for_event", args: "uuid, uuid" },
  { name: "reject_vendor_event_candidacy", args: "uuid, uuid, text, text" },
  { name: "revoke_vendor_admission", args: "uuid, uuid, text, text" },
  { name: "list_vendor_event_applications", args: "uuid" },
  { name: "list_vendor_event_dispositions", args: "uuid, uuid" },
  { name: "get_vendor_intelligence_summary", args: "uuid, uuid" },
];

function functionBody(name: string): string {
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`,
  );
  const m = executableSql.match(re);
  assert.ok(m, `function body for ${name} not found`);
  return m[0];
}

test("statement is wrapped in a single transaction", () => {
  assert.match(executableSql.trim(), /^BEGIN;/);
  assert.match(executableSql.trim(), /COMMIT;$/);
});

test("creates exactly the seven expected functions, no others", () => {
  const creates = executableSql.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) || [];
  const names = creates.map((c) => c.replace("CREATE OR REPLACE FUNCTION public.", "")).sort();
  assert.deepEqual(names, FUNCTIONS.map((f) => f.name).sort());
});

for (const fn of FUNCTIONS) {
  test(`${fn.name}: is SECURITY DEFINER with a fixed, safe search_path`, () => {
    const body = functionBody(fn.name);
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path TO 'pg_catalog'/);
  });

  test(`${fn.name}: owned by postgres, no anon/service_role EXECUTE, explicit authenticated grant`, () => {
    assert.match(
      executableSql,
      new RegExp(`ALTER FUNCTION public\\.${fn.name}\\(${fn.args.replace(/, /g, ", ")}\\) OWNER TO postgres;`),
    );
    assert.match(
      executableSql,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn.name}\\(${fn.args.replace(/, /g, ", ")}\\) FROM PUBLIC;`),
    );
    assert.match(
      executableSql,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn.name}\\(${fn.args.replace(/, /g, ", ")}\\) FROM anon;`),
    );
    assert.match(
      executableSql,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn.name}\\(${fn.args.replace(/, /g, ", ")}\\) FROM service_role;`),
    );
    assert.match(
      executableSql,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn.name}\\(${fn.args.replace(/, /g, ", ")}\\) TO authenticated;`),
    );
  });
}

test("no function references is_active_admin", () => {
  assert.equal(/is_active_admin/.test(executableSql), false);
});

test("no function references has_vendor_catalog_admin_authority -- admission authority stays separate from catalog authority", () => {
  assert.equal(/has_vendor_catalog_admin_authority/.test(executableSql), false);
});

test("all four mutation RPCs use resolve_task_authority or has_event_task_authority with the 'event.vendors.manage' task", () => {
  for (const name of ["register_vendor_event_candidacy", "admit_vendor_for_event", "reject_vendor_event_candidacy", "revoke_vendor_admission"]) {
    const body = functionBody(name);
    assert.match(body, /'event\.vendors\.manage'/, `${name} must gate on event.vendors.manage`);
  }
});

test("all three read RPCs use has_event_task_authority with the 'event.vendors.view' task", () => {
  for (const name of ["list_vendor_event_applications", "list_vendor_event_dispositions", "get_vendor_intelligence_summary"]) {
    const body = functionBody(name);
    assert.match(body, /has_event_task_authority\('event\.vendors\.view', p_event_id\)/, `${name} must gate on event.vendors.view`);
  }
});

test("Tenant is never accepted as a caller parameter -- every function derives it only through event_id-scoped authority resolution", () => {
  for (const fn of FUNCTIONS) {
    const body = functionBody(fn.name);
    assert.equal(/p_tenant_id/.test(body), false, `${fn.name} must not accept a caller-supplied tenant id`);
  }
});

test("authority_basis is never accepted as a caller parameter -- always taken from resolve_task_authority's own decision_branch", () => {
  for (const name of ["admit_vendor_for_event", "reject_vendor_event_candidacy", "revoke_vendor_admission"]) {
    const body = functionBody(name);
    assert.equal(/p_authority_basis/.test(body), false, `${name} must not accept a caller-supplied authority basis`);
    assert.match(body, /v_authority\.decision_branch/, `${name} must stamp authority_basis from resolve_task_authority's decision_branch`);
  }
  // register_vendor_event_candidacy creates no disposition, so it has no authority_basis to stamp.
  assert.equal(/authority_basis/.test(functionBody("register_vendor_event_candidacy")), false);
});

test("reject and revoke both validate the reason code against vendor_disposition_reason_codes before use", () => {
  for (const name of ["reject_vendor_event_candidacy", "revoke_vendor_admission"]) {
    const body = functionBody(name);
    assert.match(
      body,
      /SELECT 1 FROM public\.vendor_disposition_reason_codes\s*\n\s*WHERE code = p_reason_code AND is_active = true/,
    );
    assert.match(body, /RAISE EXCEPTION 'invalid_reason_code'/);
  }
});

test("no function ever UPDATEs or DELETEs vendor_event_dispositions -- append-only usage only (INSERT)", () => {
  for (const fn of FUNCTIONS) {
    const body = functionBody(fn.name);
    assert.equal(/UPDATE public\.vendor_event_dispositions/.test(body), false, `${fn.name} must never UPDATE a disposition`);
    assert.equal(/DELETE FROM public\.vendor_event_dispositions/.test(body), false, `${fn.name} must never DELETE a disposition`);
  }
});

test("revoke_vendor_admission never writes vendor_event_applications -- the historical outcome stays untouched", () => {
  const body = functionBody("revoke_vendor_admission");
  assert.equal(/UPDATE public\.vendor_event_applications/.test(body), false);
  assert.equal(/INSERT INTO public\.vendor_event_applications/.test(body), false);
});

test("reject_vendor_event_candidacy never writes event_vendors and never touches vendors.is_active", () => {
  const body = functionBody("reject_vendor_event_candidacy");
  assert.equal(/INSERT INTO public\.event_vendors/.test(body), false);
  assert.equal(/UPDATE public\.event_vendors/.test(body), false);
  assert.equal(/UPDATE public\.vendors\b/.test(body), false, "must never write to the vendors table itself");
  assert.equal(/\bvendors\.is_active\b/.test(body), false);
  assert.match(body, /cannot_reject_active_admission_use_revoke/);
});

test("admit_vendor_for_event and revoke_vendor_admission lock the relevant row FOR UPDATE before reading current state", () => {
  for (const name of ["admit_vendor_for_event", "revoke_vendor_admission"]) {
    const body = functionBody(name);
    assert.match(body, /FROM public\.event_vendors AS ev\s*\n\s*WHERE[\s\S]*?\n\s*FOR UPDATE;/);
  }
});

test("register/admit/reject use INSERT ... ON CONFLICT (vendor_id, event_id) DO NOTHING for concurrency-safe candidacy creation", () => {
  for (const name of ["register_vendor_event_candidacy", "admit_vendor_for_event", "reject_vendor_event_candidacy"]) {
    const body = functionBody(name);
    assert.match(body, /ON CONFLICT \(vendor_id, event_id\) DO NOTHING/);
  }
});

test("get_vendor_intelligence_summary: only performance_quality rejected/revoked dispositions count as adverse evidence", () => {
  const body = functionBody("get_vendor_intelligence_summary");
  const filters = body.match(/FILTER \(\s*\n\s*WHERE[\s\S]*?\n\s*\)/g) || [];
  assert.ok(filters.length >= 4, "expected at least four FILTER clauses");
  for (const filter of filters) {
    assert.match(filter, /decision_type IN \('rejected', 'revoked'\)/);
    assert.match(filter, /reason_classification = 'performance_quality'/);
  }
});

test("get_vendor_intelligence_summary never selects raw reason_text, notes, actor identity, or per-row Tenant/Event identity", () => {
  const body = functionBody("get_vendor_intelligence_summary");
  assert.equal(/reason_text/.test(body), false);
  assert.equal(/actor_auth_user_id|actor_admin_user_id/.test(body), false);
  assert.equal(/backfill_note/.test(body), false);
  // Only aggregate DISTINCT counts of event_id/tenant_id are permitted -- never a raw selected column.
  const selectClause = body.match(/RETURN QUERY[\s\S]*?FROM public\.vendor_event_dispositions/)?.[0] ?? "";
  assert.equal(/SELECT\s+d\.event_id\b/.test(selectClause), false);
  assert.equal(/SELECT\s+d\.tenant_id\b/.test(selectClause), false);
});

test("list_vendor_event_dispositions exposes raw fields only within the single authorized Event scope it was called for", () => {
  const body = functionBody("list_vendor_event_dispositions");
  assert.match(body, /WHERE d\.event_id = p_event_id/);
});

test("no direct table GRANT is issued anywhere -- only function EXECUTE grants", () => {
  assert.equal(/GRANT (SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)\s/.test(executableSql), false);
  assert.equal(/ON TABLE public\./.test(executableSql), false);
});

test("no RLS policy, schema change, or unrelated table is touched", () => {
  assert.equal(/CREATE POLICY|DROP POLICY|ROW LEVEL SECURITY/.test(executableSql), false);
  assert.equal(/CREATE TABLE|ALTER TABLE|DROP TABLE/.test(executableSql), false);
});
