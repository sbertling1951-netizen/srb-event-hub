import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261011000000_govern_self_service_private_event_replacement.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20261011000000_govern_self_service_private_event_replacement.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

function functionBody(name: string) {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = SQL.indexOf("$function$;", start);
  assert.notEqual(end, -1, `missing body end for ${name}`);
  return SQL.slice(start, end);
}

const REPLACE_FN = functionBody("replace_self_service_organizer_event");
const DRAFT_FN = functionBody("create_self_service_organizer_draft");
const EVENT_FN = functionBody("create_self_service_organizer_event");

test("the migration is one transaction defining exactly the three expected functions, in order", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
  const order = [
    SQL.indexOf("CREATE OR REPLACE FUNCTION public.create_self_service_organizer_draft"),
    SQL.indexOf("CREATE OR REPLACE FUNCTION public.create_self_service_organizer_event"),
    SQL.indexOf("CREATE OR REPLACE FUNCTION public.replace_self_service_organizer_event"),
  ];
  for (const idx of order) {
    assert.notEqual(idx, -1);
  }
  assert.ok(order[0] < order[1] && order[1] < order[2], "expected draft, then event, then replace, in that order");
  // exactly one definition of each -- no accidental duplication
  assert.equal(
    (SQL.match(/CREATE OR REPLACE FUNCTION public\.create_self_service_organizer_draft/g) ?? []).length,
    1,
  );
  assert.equal(
    (SQL.match(/CREATE OR REPLACE FUNCTION public\.create_self_service_organizer_event/g) ?? []).length,
    1,
  );
  assert.equal(
    (SQL.match(/CREATE OR REPLACE FUNCTION public\.replace_self_service_organizer_event/g) ?? []).length,
    1,
  );
});

test("the command-audit action allow-list is widened to accept private_event_replaced alongside the existing two values", () => {
  assert.match(
    SQL,
    /DROP CONSTRAINT self_service_onboarding_command_audit_action_check/,
  );
  assert.match(
    SQL,
    /ADD CONSTRAINT self_service_onboarding_command_audit_action_check\s*\n\s*CHECK \(action IN \('private_draft_created', 'private_event_added', 'private_event_replaced'\)\)/,
  );
});

// ---- Structured capacity-conflict outcome (replacing the raw exception) ----

test("create_self_service_organizer_draft no longer RAISEs on capacity -- it returns a structured, caller-scoped outcome", () => {
  assert.doesNotMatch(
    DRAFT_FN,
    /RAISE EXCEPTION 'You already have an active unfinished event/,
  );
  assert.match(DRAFT_FN, /'active_event_exists'::text/);
  // still the identical count>=limit predicate -- the future-subscription seam is unchanged
  assert.match(
    DRAFT_FN,
    />= public\.self_service_default_active_event_limit\(\) THEN/,
  );
});

test("create_self_service_organizer_event has the identical structured capacity-conflict outcome", () => {
  assert.doesNotMatch(
    EVENT_FN,
    /RAISE EXCEPTION 'You already have an active unfinished event/,
  );
  assert.match(EVENT_FN, /'active_event_exists'::text/);
  assert.match(
    EVENT_FN,
    />= public\.self_service_default_active_event_limit\(\) THEN/,
  );
  // the P-2C "Organization not found." boundary is untouched
  assert.match(EVENT_FN, /RAISE EXCEPTION 'Organization not found\.';/);
});

test("the active_event_exists outcome names ONLY the caller's own blocking Event id/name/schedule -- never a Person id, internal identifier, or unconsumed lifecycle flag", () => {
  for (const fn of [DRAFT_FN, EVENT_FN]) {
    const idx = fn.indexOf("'active_event_exists'::text");
    assert.notEqual(idx, -1);
    // the RETURN QUERY ... LIMIT 1; block immediately following the outcome literal
    const block = fn.slice(idx, fn.indexOf("RETURN;", idx));

    // Adversarial-review correction (Lun): organizer_person_id -- the
    // caller's own canonical Person id -- is NULL in the returned row (the
    // dedicated test below proves it is never projected at all; this checks
    // the exact NULL/cap_e.id shape it was replaced with).
    assert.match(block, /NULL::uuid, NULL::uuid, NULL::uuid, cap_e\.id/);

    // tenant_id/organizer_appointment_id/organization_name/location_mode/
    // location/starter_template/created_at are NULL, and -- narrowed by this
    // correction -- so are status/is_active/visible_to_members, since the UI
    // never reads them for this outcome. Scoped to just the projected
    // column list (outcome literal through the final NULL::timestamptz),
    // not the FROM/WHERE clause below it, where cap_e.is_active etc.
    // legitimately appear as FILTER conditions, not projections.
    const projection = block.slice(0, block.indexOf("NULL::timestamptz") + "NULL::timestamptz".length);
    assert.match(
      projection,
      /NULL::text, cap_e\.name, cap_e\.start_date, cap_e\.end_date, cap_e\.timezone,\s*\n\s*NULL::text, NULL::text, NULL::text, NULL::text, NULL::boolean, NULL::boolean,\s*\n\s*NULL::timestamptz/,
    );
    assert.doesNotMatch(projection, /cap_e\.status|cap_e\.is_active|cap_e\.visible_to_members/);

    // scoped to the caller's OWN resolved Person, every join is on cap_oa.person_id
    assert.match(block, /cap_oa\.person_id = v_organizer_person_id/);
    // never a caller-supplied person/event id
    assert.doesNotMatch(block, /p_old_event_id|p_organization_tenant_id/);
  }
});

test("organizer_person_id never appears in either capacity-conflict RETURN QUERY's projected column list, in either create RPC", () => {
  for (const fn of [DRAFT_FN, EVENT_FN]) {
    const idx = fn.indexOf("'active_event_exists'::text");
    assert.notEqual(idx, -1);
    const returnQueryStart = fn.lastIndexOf("RETURN QUERY", idx);
    const selectListEnd = fn.indexOf("NULL::timestamptz", idx) + "NULL::timestamptz".length;
    assert.notEqual(returnQueryStart, -1);
    const projectedColumns = fn.slice(returnQueryStart, selectListEnd);
    assert.doesNotMatch(
      projectedColumns,
      /v_organizer_person_id/,
      "organizer_person_id must never be projected in the active_event_exists row",
    );
  }
});

// ---- The one atomic replacement operation ----

test("replace_self_service_organizer_event is SECURITY DEFINER, authenticated-only, and takes the old Event id plus the complete new-draft contract", () => {
  assert.match(REPLACE_FN, /SECURITY DEFINER/);
  assert.match(
    REPLACE_FN,
    /CREATE OR REPLACE FUNCTION public\.replace_self_service_organizer_event\(\s*\n\s*p_old_event_id uuid,\s*\n\s*p_organization_name text,\s*\n\s*p_event_name text,/,
  );
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.replace_self_service_organizer_event\([\s\S]*?\)\s*TO authenticated;/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.replace_self_service_organizer_event\([\s\S]*?\)\s*FROM PUBLIC, anon, service_role;/,
  );
});

test("the new-draft input is fully validated BEFORE the old Event is touched -- validation precedes the nested delete call", () => {
  const validationIdx = REPLACE_FN.indexOf("Organization name is required");
  const deleteCallIdx = REPLACE_FN.indexOf("public.delete_self_service_organizer_event(p_old_event_id");
  assert.notEqual(validationIdx, -1);
  assert.notEqual(deleteCallIdx, -1);
  assert.ok(validationIdx < deleteCallIdx, "input validation must run before any deletion");
});

test("identity resolution happens ONCE and precedes the delete call -- an uncertain outcome never reaches deletion", () => {
  const identityIdx = REPLACE_FN.indexOf("resolve_auth_person_link(v_actor_auth_user_id)");
  const uncertainReturnIdx = REPLACE_FN.indexOf("v_safe_identity_outcome IS NOT NULL");
  const deleteCallIdx = REPLACE_FN.indexOf("public.delete_self_service_organizer_event(p_old_event_id");
  assert.notEqual(identityIdx, -1);
  assert.notEqual(uncertainReturnIdx, -1);
  assert.notEqual(deleteCallIdx, -1);
  assert.ok(identityIdx < uncertainReturnIdx && uncertainReturnIdx < deleteCallIdx);
  // only ONE resolve_auth_person_link call in this function -- no re-resolution
  assert.equal(
    (REPLACE_FN.match(/resolve_auth_person_link\(/g) ?? []).length,
    1,
  );
});

test("deletion is entirely delegated to the existing, unmodified delete_self_service_organizer_event -- no duplicated cleanup/dependency-scan logic", () => {
  assert.match(
    REPLACE_FN,
    /public\.delete_self_service_organizer_event\(p_old_event_id, p_idempotency_key\)/,
  );
  // none of the delete function's own private-draft-feature cleanup or the
  // dependency-scan machinery is re-implemented here
  for (const forbidden of [
    "agenda_command_ledger",
    "agenda_items",
    "self_service_private_draft_planned_guests",
    "self_service_private_draft_vendor_plans",
    "self_service_private_draft_venue_plans",
    "self_service_private_draft_registry_plans",
    "self_service_private_draft_checklist_items",
    "self_service_private_draft_budget_lines",
    "pg_constraint",
    "Unexpected dependent data",
  ]) {
    assert.doesNotMatch(REPLACE_FN, new RegExp(forbidden));
  }
  // this migration does not restate delete_self_service_organizer_event itself
  assert.doesNotMatch(SQL, /CREATE OR REPLACE FUNCTION public\.delete_self_service_organizer_event/);
});

test("the SAME idempotency key drives both halves -- the deletion call and the creation audit row -- so a retry is idempotent for free", () => {
  assert.match(
    REPLACE_FN,
    /public\.delete_self_service_organizer_event\(p_old_event_id, p_idempotency_key\)/,
  );
  assert.match(
    REPLACE_FN,
    /v_actor_auth_user_id, p_idempotency_key, v_request_fingerprint, v_tenant\.id,\s*\n\s*v_appointment\.id, v_event\.id, 'private_event_replaced'/,
  );
});

test("idempotent replay checks the creation audit (written LAST) before doing anything -- a completed replacement never re-runs", () => {
  const auditCheckIdx = REPLACE_FN.indexOf(
    "FROM public.self_service_onboarding_command_audit AS a",
  );
  const resolveIdx = REPLACE_FN.indexOf("resolve_auth_person_link(v_actor_auth_user_id)");
  const deleteCallIdx = REPLACE_FN.indexOf("public.delete_self_service_organizer_event(p_old_event_id");
  assert.notEqual(auditCheckIdx, -1);
  assert.ok(auditCheckIdx < resolveIdx && resolveIdx < deleteCallIdx);
  assert.match(REPLACE_FN, /RETURN QUERY\s*\n\s*SELECT\s*\n\s*'replaced'::text,/);
});

test("a reused idempotency key naming a different old Event or different new-draft input conflicts, never silently replays the wrong thing", () => {
  assert.match(
    REPLACE_FN,
    /jsonb_build_array\(\s*\n\s*p_old_event_id, v_organization_name, v_event_name, p_start_date, p_end_date,/,
  );
  assert.match(
    REPLACE_FN,
    /RAISE EXCEPTION 'Idempotency key was already used with different replacement input\.';/,
  );
});

test("ownership/eligibility of the old Event is never re-implemented here -- ownership can only be proven by the delegated delete succeeding", () => {
  // no bespoke ownership query joining the OLD event (p_old_event_id) against
  // self_service_organizer_appointments / self_service_private_event_drafts
  // anywhere in this function -- the delete function's own ownership shape
  // ("d.event_id = p_event_id" joined through the appointment/tenant chain)
  // never appears here under any parameter name.
  assert.doesNotMatch(REPLACE_FN, /d\.event_id\s*=\s*p_old_event_id/);
  assert.doesNotMatch(
    REPLACE_FN,
    /JOIN public\.self_service_organizer_appointments AS oa\s*\n\s*ON oa\.id = d\.organizer_appointment_id\s*\n\s*JOIN public\.tenants AS t/,
  );
  // this function raises no 'Event not found.' of its own (executable code,
  // not the explanatory comment above the delegated call) -- that denial can
  // only come from the delegated delete_self_service_organizer_event call
  const executable = REPLACE_FN.replace(/--.*$/gm, "");
  assert.doesNotMatch(executable, /RAISE EXCEPTION 'Event not found\.'/);
});

test("the discriminated return distinguishes 'replaced' from the two uncertain-identity outcomes, and carries the deletion facts", () => {
  assert.match(
    REPLACE_FN,
    /outcome text,\s*\n\s*tenant_id uuid,/,
  );
  assert.match(SQL, /deleted_event_id uuid,\s*\n\s*deletion_scope text\s*\n\)/);
  assert.match(REPLACE_FN, /'identity_confirmation_required'/);
  assert.match(REPLACE_FN, /'identity_review_required'/);
});

test("replace never creates two active unfinished private Events -- it performs exactly one deletion delegate call and one new-tenant/event insert, inside one transaction", () => {
  assert.equal(
    (REPLACE_FN.match(/INSERT INTO public\.tenants \(/g) ?? []).length,
    1,
  );
  assert.equal(
    (REPLACE_FN.match(/INSERT INTO public\.events \(/g) ?? []).length,
    1,
  );
  assert.equal(
    (REPLACE_FN.match(/public\.delete_self_service_organizer_event\(/g) ?? []).length,
    1,
  );
  // no capacity re-check inside replace -- the atomic delete-then-create
  // inside one transaction is what keeps the invariant, not a second check
  assert.doesNotMatch(REPLACE_FN, /self_service_default_active_event_limit\(\)/);
});
