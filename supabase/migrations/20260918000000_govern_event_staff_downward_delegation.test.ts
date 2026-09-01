import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Source-level tests for the governed downward Event Staff delegation
// migration. This environment has no live Postgres (no Docker), so -- like
// every other supabase/migrations/*.test.ts -- these assert the SQL text
// encodes every privilege-escalation fence from the Task 4/5 investigation
// plus TA/SA regression behaviour and exact-Event isolation for an Event
// Admin. Run with:
//   npx tsx --test supabase/migrations/20260918000000_govern_event_staff_downward_delegation.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260918000000_govern_event_staff_downward_delegation.sql", import.meta.url),
  ),
  "utf8",
);

// Comment-stripped view for assertions that must match executable SQL only.
const EXEC = SQL.replace(/--.*$/gm, "");

const MUTATION_RPCS = [
  "create_event_authority_assignment",
  "grant_event_authority_task",
  "revoke_event_authority_task",
  "remove_event_authority_assignment",
  "change_event_authority_profile",
];
const READ_RPCS = [
  "list_event_authority_assignments",
  "list_event_authority_profile_catalog",
];
const ALL_SEVEN = [...MUTATION_RPCS, ...READ_RPCS];

function bodyOf(name: string): string {
  const start = EXEC.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start > -1, `expected a CREATE OR REPLACE for ${name}`);
  // Each function body ends at the first `$$;` after its start.
  const end = EXEC.indexOf("$$;", start);
  assert.ok(end > start, `expected a terminated body for ${name}`);
  return EXEC.slice(start, end + 3);
}

// ── Transaction envelope ────────────────────────────────────────────────
test("runs inside a single transaction", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /\nCOMMIT;\s*$/);
});

// ── assert_event_authority_governor is left completely untouched ────────
test("does NOT redefine assert_event_authority_governor -- other callers keep it verbatim", () => {
  assert.equal(
    /CREATE OR REPLACE FUNCTION public\.assert_event_authority_governor/.test(SQL),
    false,
  );
});

test("does not touch any core resolver / authority primitive or RLS policy", () => {
  for (const forbidden of [
    "CREATE OR REPLACE FUNCTION public.resolve_task_authority",
    "CREATE OR REPLACE FUNCTION public.has_event_task_authority",
    "CREATE OR REPLACE FUNCTION public.has_platform_admin_authority",
    "CREATE OR REPLACE FUNCTION public.has_tenant_admin_authority",
    "CREATE OR REPLACE FUNCTION public.has_any_tenant_admin_authority",
    "CREATE OR REPLACE FUNCTION public.has_event_admin_authority",
    "CREATE POLICY",
    "ALTER POLICY",
    "DROP POLICY",
    "ENABLE ROW LEVEL SECURITY",
  ]) {
    assert.equal(EXEC.includes(forbidden), false, `must not contain: ${forbidden}`);
  }
});

// ── Fail-closed drift guards ────────────────────────────────────────────
test("a fail-closed DO guard block runs before any function definition", () => {
  const guardIdx = SQL.indexOf("DO $guard$");
  const firstFnIdx = SQL.indexOf("CREATE OR REPLACE FUNCTION public.is_ea_delegable_task");
  assert.ok(guardIdx > -1 && firstFnIdx > -1);
  assert.ok(guardIdx < firstFnIdx, "the guard block must precede the function definitions");
});

test("guard: only the migration owner role may run it", () => {
  assert.match(EXEC, /IF current_user <> 'postgres' THEN\s*RAISE EXCEPTION/);
});

test("guard G1: the four EA-delegable subordinate profiles must exist and be active", () => {
  assert.match(EXEC, /unnest\(ARRAY\['content', 'checkin', 'parking', 'view_only'\]\)/);
  assert.match(EXEC, /missing or inactive EA-delegable profile/);
});

test("guard G2/G3: the live subordinate-template union must be DISJOINT from the nine EA-reserved tasks", () => {
  // The reserved set is spelled out literally...
  for (const reserved of [
    "event.definition.manage",
    "event.imports.view",
    "event.imports.manage",
    "event.print.view",
    "event.print.manage",
    "event.reports.export",
    "event.vendors.view",
    "event.vendors.manage",
    "event.validation_rules.manage",
  ]) {
    assert.ok(EXEC.includes(`'${reserved}'`), `reserved task ${reserved} must be named in the guard`);
  }
  // ...the union is taken from exactly the four subordinate templates...
  assert.match(
    EXEC,
    /FROM public\.admin_event_profile_tasks\s*\n\s*WHERE profile_key IN \('content', 'checkin', 'parking', 'view_only'\)/,
  );
  // ...and any overlap aborts.
  assert.match(EXEC, /delegation ceiling breach: a subordinate profile template now grants EA-reserved task/);
  assert.match(EXEC, /WHERE k = ANY\(v_reserved\)/);
});

test("guard G4: event.validation_rules.manage may never enter a subordinate template", () => {
  assert.match(EXEC, /'event\.validation_rules\.manage' = ANY\(v_sub_union\)/);
  assert.match(EXEC, /event\.validation_rules\.manage is in a subordinate profile template/);
});

test("guard G5: no event.staff.* / event.event_staff.* task may exist in the registry -- delegation is a predicate, never a grantable task", () => {
  assert.match(
    EXEC,
    /task_key LIKE 'event\.staff\.%' OR task_key LIKE 'event\.event_staff\.%'/,
  );
  assert.match(EXEC, /delegation model breach: registry contains an Event-Staff task/);
});

test("the migration introduces no Event-Staff task of its own -- no registry INSERT, and every event.staff / event.event_staff string is the G5 negative LIKE guard", () => {
  assert.equal(/INSERT INTO public\.admin_task_registry/.test(EXEC), false);
  const occurrences = EXEC.match(/'event\.(event_)?staff\.[^']*'/g) ?? [];
  assert.deepEqual(
    occurrences.sort(),
    ["'event.event_staff.%'", "'event.staff.%'"],
    "the only Event-Staff string literals must be the two guard LIKE patterns",
  );
});

// ── is_ea_delegable_task ────────────────────────────────────────────────
test("is_ea_delegable_task is computed from the live union of exactly the four subordinate profile templates", () => {
  const body = bodyOf("is_ea_delegable_task");
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path TO 'pg_catalog'/);
  assert.match(
    body,
    /FROM public\.admin_event_profile_tasks\s*\n\s*WHERE profile_key IN \('content', 'checkin', 'parking', 'view_only'\)\s*\n\s*AND task_key = p_task_key/,
  );
});

test("is_ea_delegable_task is inner-only: never granted to authenticated / anon / service_role", () => {
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.is_ea_delegable_task\(text\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.equal(
    /GRANT EXECUTE ON FUNCTION public\.is_ea_delegable_task/.test(SQL),
    false,
    "is_ea_delegable_task must not be executable by any application role",
  );
});

// ── resolve_event_staff_delegation ─────────────────────────────────────
test("resolve_event_staff_delegation keeps the governor's shape and hardening and RETURNS a tier", () => {
  const body = bodyOf("resolve_event_staff_delegation");
  assert.match(body, /RETURNS TABLE\(tenant_id uuid, actor_admin_user_id uuid, actor_tier text\)/);
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path TO 'pg_catalog'/);
  assert.match(body, /RAISE EXCEPTION 'event or tenant not found'/);
  assert.match(body, /RAISE EXCEPTION 'caller is not active admin'/);
});

test("resolve_event_staff_delegation precedence is platform, then tenant-for-THIS-Event's-tenant, then event_admin-for-THIS-exact-Event, else deny", () => {
  const body = bodyOf("resolve_event_staff_delegation");
  const platformIdx = body.indexOf("has_platform_admin_authority(auth.uid())");
  const tenantIdx = body.indexOf("has_tenant_admin_authority(auth.uid(), tenant_id)");
  const eventAdminIdx = body.indexOf("actor_tier := 'event_admin'");
  const denyIdx = body.indexOf("RAISE EXCEPTION 'caller lacks Event staff delegation authority'");
  assert.ok(platformIdx > -1 && tenantIdx > -1 && eventAdminIdx > -1 && denyIdx > -1);
  assert.ok(
    platformIdx < tenantIdx && tenantIdx < eventAdminIdx && eventAdminIdx < denyIdx,
    "tiers must be resolved in strict precedence order, with denial last",
  );
  assert.match(body, /actor_tier := 'platform'/);
  assert.match(body, /actor_tier := 'tenant'/);
});

test("resolve_event_staff_delegation event_admin tier requires an EXACT-Event event_admin row AND respects the inactive-Tenant freeze", () => {
  const body = bodyOf("resolve_event_staff_delegation");
  assert.match(
    body,
    /IF v_tenant_active AND EXISTS \(\s*\n\s*SELECT 1\s*\n\s*FROM public\.admin_event_access aea\s*\n\s*WHERE aea\.admin_user_id = actor_admin_user_id\s*\n\s*AND aea\.event_id = p_event_id\s*\n\s*AND aea\.role = 'event_admin'/,
  );
  // The Tenant is derived from THIS Event only -- never a caller-supplied tenant.
  assert.match(body, /FROM public\.events e\s*\n\s*JOIN public\.tenants t ON t\.id = e\.tenant_id\s*\n\s*WHERE e\.id = p_event_id/);
});

test("resolve_event_staff_delegation is inner-only, like assert_event_authority_governor", () => {
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.resolve_event_staff_delegation\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.equal(
    /GRANT EXECUTE ON FUNCTION public\.resolve_event_staff_delegation/.test(SQL),
    false,
  );
});

// ── has_any_event_staff_delegation_authority ───────────────────────────
test("has_any_event_staff_delegation_authority is the coarse route-guard predicate: fails closed on null uid, Platform OR any-Tenant OR event_admin-on-an-active-Tenant Event", () => {
  const body = bodyOf("has_any_event_staff_delegation_authority");
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path TO 'pg_catalog'/);
  assert.match(body, /IF v_uid IS NULL THEN\s*\n\s*RETURN false;/);
  assert.match(body, /has_platform_admin_authority\(v_uid\)/);
  assert.match(body, /has_any_tenant_admin_authority\(\)/);
  assert.match(body, /aea\.role = 'event_admin'/);
  assert.match(body, /JOIN public\.tenants t ON t\.id = e\.tenant_id AND t\.is_active/);
});

test("has_any_event_staff_delegation_authority is the ONLY new function exposed to authenticated", () => {
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.has_any_event_staff_delegation_authority\(\) FROM PUBLIC, anon, service_role;\s*\nGRANT EXECUTE ON FUNCTION public\.has_any_event_staff_delegation_authority\(\) TO authenticated;/,
  );
});

// ── All seven RPCs swap the governor for the delegation resolver ────────
for (const name of ALL_SEVEN) {
  test(`${name}: calls resolve_event_staff_delegation and no longer calls assert_event_authority_governor`, () => {
    const body = bodyOf(name);
    assert.match(body, /resolve_event_staff_delegation\(/);
    assert.equal(
      body.includes("assert_event_authority_governor("),
      false,
      `${name} must delegate its gate to resolve_event_staff_delegation`,
    );
  });

  test(`${name}: preserves SECURITY DEFINER and the hardened search_path`, () => {
    const body = bodyOf(name);
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path TO 'pg_catalog'/);
  });
}

test("every RPC captures the resolved tier for its ceiling logic", () => {
  for (const name of MUTATION_RPCS) {
    const body = bodyOf(name);
    assert.match(
      body,
      /INTO v_tenant,v_actor,v_tier FROM public\.resolve_event_staff_delegation\(/,
      `${name} must capture actor_tier`,
    );
  }
  for (const name of READ_RPCS) {
    const body = bodyOf(name);
    assert.match(body, /g\.actor_tier INTO v_tenant, v_actor, v_tier/, `${name} must capture actor_tier`);
  }
});

// ── Signatures / return shapes unchanged ───────────────────────────────
test("all seven signatures and the two read return shapes are byte-for-byte the prior definitions", () => {
  assert.match(SQL, /public\.create_event_authority_assignment\(p_target_admin_user_id uuid,p_event_id uuid,p_profile_key text,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid\(\)\) RETURNS uuid/);
  assert.match(SQL, /public\.grant_event_authority_task\(p_assignment_id uuid,p_task_key text,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid\(\)\) RETURNS void/);
  assert.match(SQL, /public\.revoke_event_authority_task\(p_assignment_id uuid,p_task_key text,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid\(\)\) RETURNS void/);
  assert.match(SQL, /public\.remove_event_authority_assignment\(p_assignment_id uuid,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid\(\)\) RETURNS void/);
  assert.match(SQL, /public\.change_event_authority_profile\(p_assignment_id uuid,p_profile_key text,p_disposition text,p_final_task_keys text\[\] DEFAULT NULL,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid\(\)\) RETURNS void/);
  assert.match(SQL, /list_event_authority_assignments\(p_event_id uuid\)\s*\nRETURNS TABLE\([\s\S]*?can_govern boolean\n\)/);
  assert.match(SQL, /list_event_authority_profile_catalog\(p_event_id uuid\)\s*\nRETURNS TABLE\([\s\S]*?event_task_catalog jsonb\n\)/);
});

// ── Pre-existing protections retained ──────────────────────────────────
test("the self-elevation fence is retained verbatim in every mutation RPC", () => {
  for (const name of MUTATION_RPCS) {
    const body = bodyOf(name);
    assert.match(body, /RAISE EXCEPTION 'self-elevation is forbidden'/, `${name} keeps its self-elevation fence`);
  }
});

test("pre-existing validation fences are retained", () => {
  assert.match(bodyOf("create_event_authority_assignment"), /RAISE EXCEPTION 'target is not active admin'/);
  assert.match(bodyOf("create_event_authority_assignment"), /RAISE EXCEPTION 'unknown profile'/);
  assert.match(bodyOf("grant_event_authority_task"), /RAISE EXCEPTION 'task is not Event-grantable'/);
  assert.match(bodyOf("grant_event_authority_task"), /RAISE EXCEPTION 'assignment not found'/);
  assert.match(bodyOf("change_event_authority_profile"), /RAISE EXCEPTION 'invalid profile change'/);
  assert.match(bodyOf("change_event_authority_profile"), /RAISE EXCEPTION 'invalid final task'/);
});

test("uniqueness / ON CONFLICT and audit writes are retained", () => {
  assert.match(bodyOf("grant_event_authority_task"), /ON CONFLICT\(admin_event_access_id,permission_key\) DO NOTHING/);
  for (const name of MUTATION_RPCS) {
    assert.match(bodyOf(name), /INSERT INTO public\.admin_authority_audit/, `${name} still writes audit rows`);
  }
});

// ── The Event Admin ceiling (the privilege-escalation fences) ───────────
test("FENCE: an Event Admin delegate may not CREATE an event_admin (or any non-subordinate) assignment", () => {
  assert.match(
    bodyOf("create_event_authority_assignment"),
    /IF v_tier='event_admin' AND p_profile_key NOT IN \('content','checkin','parking','view_only'\) THEN RAISE EXCEPTION 'Event Admin delegation may not assign the % profile'/,
  );
});

test("FENCE: an Event Admin delegate may not grant/revoke a task on an event_admin assignment, nor any non-delegable task", () => {
  for (const name of ["grant_event_authority_task", "revoke_event_authority_task"]) {
    const body = bodyOf(name);
    assert.match(body, /IF v_tier='event_admin' THEN/);
    assert.match(body, /IF v_role='event_admin' THEN RAISE EXCEPTION 'Event Admin delegation may not modify an Event Admin assignment'/);
    assert.match(body, /IF NOT public\.is_ea_delegable_task\(p_task_key\) THEN RAISE EXCEPTION 'Event Admin delegation may not (grant|revoke) the % task'/);
  }
});

test("FENCE: an Event Admin delegate may not REMOVE an event_admin assignment", () => {
  assert.match(
    bodyOf("remove_event_authority_assignment"),
    /IF v_tier='event_admin' AND v_profile='event_admin' THEN RAISE EXCEPTION 'Event Admin delegation may not remove an Event Admin assignment'/,
  );
});

test("FENCE: an Event Admin delegate may not modify an existing event_admin assignment, may not change ANY assignment TO event_admin, and may not carry a non-delegable task through preserve_exceptions", () => {
  const body = bodyOf("change_event_authority_profile");
  assert.match(body, /IF v_old='event_admin' THEN RAISE EXCEPTION 'Event Admin delegation may not modify an Event Admin assignment'/);
  assert.match(body, /IF p_profile_key NOT IN \('content','checkin','parking','view_only'\) THEN RAISE EXCEPTION 'Event Admin delegation may not assign the % profile'/);
  assert.match(
    body,
    /IF v_tier='event_admin' AND EXISTS\(SELECT 1 FROM unnest\(v_final\) k WHERE NOT public\.is_ea_delegable_task\(k\)\) THEN RAISE EXCEPTION 'Event Admin delegation may not assign a task outside the delegable catalog'/,
  );
});

test("FENCE: existing event_admin rows stay VISIBLE to an Event Admin delegate but non-governable (can_govern false), on top of the pre-existing self-row fence", () => {
  const body = bodyOf("list_event_authority_assignments");
  assert.match(
    body,
    /au\.user_id IS DISTINCT FROM auth\.uid\(\)\s*\n\s*AND NOT \(v_tier = 'event_admin' AND aea\.role = 'event_admin'\)/,
  );
  // No WHERE-clause filter hides the row -- it is still returned.
  assert.match(body, /WHERE aea\.event_id = p_event_id\s*\n\s*ORDER BY aea\.created_at/);
});

test("FENCE: an Event Admin delegate is offered ONLY the four subordinate profiles and ONLY EA-delegable tasks from the catalog RPC", () => {
  const body = bodyOf("list_event_authority_profile_catalog");
  assert.match(body, /AND \(v_tier <> 'event_admin' OR public\.is_ea_delegable_task\(r\.task_key\)\)/);
  assert.match(body, /AND \(v_tier <> 'event_admin' OR public\.is_ea_delegable_task\(pt\.task_key\)\)/);
  assert.match(body, /AND \(v_tier <> 'event_admin' OR p\.profile_key IN \('content', 'checkin', 'parking', 'view_only'\)\)/);
});

// ── TA / SA regression: for those tiers every new branch is a no-op ─────
test("REGRESSION: every Event-Admin ceiling branch is guarded by v_tier='event_admin' (or v_tier <> 'event_admin'), so Platform / Tenant callers are unaffected", () => {
  for (const name of MUTATION_RPCS) {
    const body = bodyOf(name);
    // Count "Event Admin delegation may not" raises -- each must sit under a
    // v_tier='event_admin' guard.
    const raises = body.match(/RAISE EXCEPTION 'Event Admin delegation may not[^']*'/g) ?? [];
    assert.ok(raises.length >= 1, `${name} must carry at least one EA-ceiling fence`);
    assert.ok(
      body.includes("v_tier='event_admin'"),
      `${name}'s ceiling must be gated on the event_admin tier only`,
    );
  }
  for (const name of READ_RPCS) {
    assert.ok(
      bodyOf(name).includes("v_tier <> 'event_admin'") ||
        bodyOf(name).includes("v_tier = 'event_admin'"),
      `${name}'s tier filter must be a no-op for non-EA tiers`,
    );
  }
});

test("REGRESSION: neither read RPC filters profiles or tasks for a non-EA tier -- the catalog is unchanged for Platform / Tenant", () => {
  const body = bodyOf("list_event_authority_profile_catalog");
  // Each EA filter is written as (v_tier <> 'event_admin' OR <ea-predicate>)
  // so it is vacuously true whenever v_tier is 'platform' or 'tenant'.
  const filters = body.match(/v_tier <> 'event_admin' OR /g) ?? [];
  assert.equal(filters.length, 3, "expected exactly the three tier-gated OR filters");
});

// ── Ownership + grants re-emitted ─────────────────────────────────────
test("ownership and execution grants are re-emitted for every replaced mutation RPC exactly as before", () => {
  for (const name of MUTATION_RPCS) {
    assert.ok(
      new RegExp(`ALTER FUNCTION public\\.${name}\\([^)]*\\) OWNER TO postgres;`).test(SQL),
      `${name} OWNER TO postgres re-emitted`,
    );
    assert.ok(
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC,anon,service_role;`).test(SQL),
      `${name} REVOKE re-emitted`,
    );
    assert.ok(
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO authenticated;`).test(SQL),
      `${name} GRANT re-emitted`,
    );
  }
});

test("the two read RPCs re-emit their introducing migration's exact ACL block (REVOKE from authenticated too, then GRANT)", () => {
  for (const name of READ_RPCS) {
    assert.ok(
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(uuid\\) FROM PUBLIC, anon, authenticated, service_role;`).test(SQL),
      `${name} REVOKE re-emitted`,
    );
    assert.ok(
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(uuid\\) TO authenticated;`).test(SQL),
      `${name} GRANT re-emitted`,
    );
  }
  // ...and NO explicit ALTER OWNER for the read RPCs (matches 20260811200000).
  assert.equal(/ALTER FUNCTION public\.list_event_authority_assignments\(uuid\) OWNER/.test(SQL), false);
  assert.equal(/ALTER FUNCTION public\.list_event_authority_profile_catalog\(uuid\) OWNER/.test(SQL), false);
});

test("the three new functions each get an explicit ALTER FUNCTION ... OWNER TO postgres", () => {
  for (const sig of [
    "public.is_ea_delegable_task(text)",
    "public.resolve_event_staff_delegation(uuid)",
    "public.has_any_event_staff_delegation_authority()",
  ]) {
    assert.ok(
      SQL.includes(`ALTER FUNCTION ${sig} OWNER TO postgres;`),
      `${sig} OWNER TO postgres`,
    );
  }
});
