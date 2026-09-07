import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20260926000000_govern_self_service_organizer_event_deletion_and_capacity.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260926000000_govern_self_service_organizer_event_deletion_and_capacity.sql",
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

const DELETE_FN = functionBody("delete_self_service_organizer_event");
const CAPACITY_FN = functionBody("get_my_self_service_organizer_capacity");
const LIMIT_FN = functionBody("self_service_default_active_event_limit");
const DRAFT_FN = functionBody("create_self_service_organizer_draft");
const EVENT_FN = functionBody("create_self_service_organizer_event");
const CMD_TRIGGER_FN = functionBody("prevent_self_service_onboarding_command_audit_mutation");
const LIFECYCLE_TRIGGER_FN = functionBody("prevent_self_service_tenant_lifecycle_audit_mutation");

test("the deletion audit is minimal, immutable, browser-inaccessible, and has no event/tenant FK", () => {
  assert.match(SQL, /CREATE TABLE public\.self_service_event_deletion_audit/);
  // durable identity subjects only
  assert.match(SQL, /organizer_person_id uuid NOT NULL REFERENCES public\.people\(id\) ON DELETE RESTRICT/);
  assert.match(SQL, /actor_auth_user_id uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE RESTRICT/);
  // deleted ids are plain columns, NEVER foreign keys (the rows are gone)
  const table = SQL.slice(
    SQL.indexOf("CREATE TABLE public.self_service_event_deletion_audit"),
    SQL.indexOf("ALTER TABLE public.self_service_event_deletion_audit OWNER TO postgres"),
  );
  assert.match(table, /deleted_event_id uuid NOT NULL,/);
  assert.match(table, /deleted_tenant_id uuid,/);
  assert.doesNotMatch(table, /deleted_event_id[^\n]*REFERENCES/);
  assert.doesNotMatch(table, /deleted_tenant_id[^\n]*REFERENCES/);
  assert.doesNotMatch(table, /REFERENCES public\.events/);
  assert.doesNotMatch(table, /REFERENCES public\.tenants/);
  // no content columns
  assert.doesNotMatch(table, /\b(event_name|organization_name|location|start_date|end_date|timezone|starter_template|title|guest)\b/);
  // retained non-content facts
  assert.match(table, /deletion_scope text NOT NULL CHECK \(deletion_scope IN \(\s*'event_only', 'event_and_empty_workspace'\s*\)\)/);
  assert.match(table, /removed_command_audit_count integer NOT NULL/);
  assert.match(table, /idempotency_key uuid NOT NULL/);
  assert.match(table, /occurred_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(table, /UNIQUE \(actor_auth_user_id, idempotency_key\)/);
  // append-only + browser-inaccessible
  assert.match(SQL, /CREATE TRIGGER prevent_self_service_event_deletion_audit_mutation_trigger\s*\nBEFORE UPDATE OR DELETE ON public\.self_service_event_deletion_audit/);
  assert.match(SQL, /raise exception 'self_service_event_deletion_audit is immutable'/i);
  assert.match(SQL, /ALTER TABLE public\.self_service_event_deletion_audit ENABLE ROW LEVEL SECURITY/);
  assert.match(SQL, /REVOKE ALL ON TABLE public\.self_service_event_deletion_audit\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/);
});

test("the two existing immutable audit triggers gain a DELETE-only, guard-gated exception; UPDATE stays forbidden", () => {
  for (const body of [CMD_TRIGGER_FN, LIFECYCLE_TRIGGER_FN]) {
    // DELETE is allowed only while the transaction-local guard is 'on'
    assert.match(
      body,
      /IF TG_OP = 'DELETE'\s*\n\s*AND current_setting\('app\.self_service_governed_deletion', true\) = 'on' THEN\s*\n\s*RETURN OLD;\s*\n\s*END IF;/,
    );
    // everything else (crucially UPDATE) still raises
    assert.match(body, /RAISE EXCEPTION '[a-z_]+ is immutable'/);
    // the guard is never checked for UPDATE
    assert.doesNotMatch(body, /TG_OP = 'UPDATE'[\s\S]*RETURN/);
  }
});

test("the default capacity helper is a bare server-owned constant of 1", () => {
  // STABLE (not IMMUTABLE): the designated future per-Person entitlement seam.
  assert.match(LIMIT_FN, /RETURNS integer\s*\nLANGUAGE sql\s*\nSTABLE/);
  assert.doesNotMatch(LIMIT_FN, /\nIMMUTABLE\n/);
  assert.match(LIMIT_FN, /SELECT 1;/);
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.self_service_default_active_event_limit\(\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/);
  // no plan / subscription / billing object is actually created (the header
  // comment names them only to say they are NOT built)
  const ddl = SQL.split("\n").filter((l) => /^\s*(CREATE|ALTER)\s+(TABLE|TYPE|SEQUENCE)\b/i.test(l)).join("\n");
  assert.doesNotMatch(ddl, /subscription|billing|checkout|payment|entitlement|plan|stripe/i);
  assert.match(ddl, /CREATE TABLE public\.self_service_event_deletion_audit/);
});

test("get_my_self_service_organizer_capacity returns the three contract fields, fails closed, is authenticated-only", () => {
  assert.match(
    CAPACITY_FN,
    /RETURNS TABLE\(\s*\n\s*active_event_limit integer,\s*\n\s*active_unfinished_event_count integer,\s*\n\s*can_start_another_event boolean\s*\n\s*\)/,
  );
  assert.match(CAPACITY_FN, /SECURITY DEFINER\s*\nSET search_path TO 'pg_catalog'/);
  assert.match(CAPACITY_FN, /v_limit integer := public\.self_service_default_active_event_limit\(\)/);
  assert.match(CAPACITY_FN, /resolve_auth_person_link\(v_auth\)/);
  assert.match(CAPACITY_FN, /IF v_link_status NOT IN \('resolved', 'no_link'\) THEN\s*\n\s*RETURN QUERY SELECT v_limit, v_limit, false;/);
  assert.match(CAPACITY_FN, /RETURN QUERY SELECT v_limit, v_count, \(v_count < v_limit\)/);
  assert.match(SQL, /GRANT EXECUTE ON FUNCTION public\.get_my_self_service_organizer_capacity\(\)\s*\n\s*TO authenticated/);
});

test("delete_self_service_organizer_event: verified-account + fail-closed identity + non-enumerating", () => {
  assert.match(DELETE_FN, /SECURITY DEFINER\s*\nSET search_path TO 'pg_catalog'/);
  assert.match(DELETE_FN, /v_actor uuid := auth\.uid\(\)/);
  assert.match(DELETE_FN, /email_confirmed_at IS NOT NULL/);
  assert.match(DELETE_FN, /nullif\(btrim\(u\.email\), ''\) IS NOT NULL/);
  assert.match(DELETE_FN, /resolve_auth_person_link\(v_actor\)/);
  assert.match(DELETE_FN, /IF v_link_status NOT IN \('resolved', 'no_link'\) THEN\s*\n\s*RAISE EXCEPTION 'Event not found\.'/);
  // person-scoped when resolved; own-appointment only when no_link
  assert.match(
    DELETE_FN,
    /\(v_link_status = 'resolved' AND oa\.person_id = v_person_id\)\s*\n\s*OR \(v_link_status = 'no_link' AND oa\.auth_user_id = v_actor\)/,
  );
  // only a hidden, inactive, non-member-visible Draft
  assert.match(DELETE_FN, /e\.status = 'Draft'\s*\n\s*AND e\.is_active = false\s*\n\s*AND e\.visible_to_members = false/);
  assert.match(DELETE_FN, /t\.is_self_service_private_draft = true/);
  assert.match(DELETE_FN, /IF v_appointment_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'Event not found\.'/);
});

test("delete_self_service_organizer_event: advisory locks, idempotent replay, audit-before-deletes", () => {
  assert.match(DELETE_FN, /pg_advisory_xact_lock\(\s*\n\s*hashtextextended\(\s*\n\s*'self_service_event_deletion:'/);
  assert.match(DELETE_FN, /pg_advisory_xact_lock\(\s*\n\s*hashtextextended\('self_service_event_deletion_target:'/);
  // prior success replays verbatim
  assert.match(DELETE_FN, /FROM public\.self_service_event_deletion_audit AS a\s*\n\s*WHERE a\.actor_auth_user_id = v_actor\s*\n\s*AND a\.idempotency_key = p_idempotency_key/);
  assert.match(DELETE_FN, /v_existing\.deleted_event_id <> p_event_id THEN\s*\n\s*RAISE EXCEPTION 'Idempotency key was already used to delete a different event\.'/);
  // the deletion-audit INSERT precedes every operational DELETE
  assert.ok(
    DELETE_FN.indexOf("INSERT INTO public.self_service_event_deletion_audit") <
      DELETE_FN.indexOf("DELETE FROM public.self_service_onboarding_command_audit"),
    "the minimal deletion audit is written before any operational delete",
  );
});

test("delete_self_service_organizer_event: complete dependency guard, children-first order, empty-workspace teardown", () => {
  // dynamic guard over every events(id) child except this event's own marker + audit
  assert.match(DELETE_FN, /FROM pg_constraint AS con[\s\S]*?con\.confrelid = 'public\.events'::regclass/);
  assert.match(DELETE_FN, /con\.conrelid NOT IN \(\s*\n\s*'public\.self_service_private_event_drafts'::regclass,\s*\n\s*'public\.self_service_onboarding_command_audit'::regclass\s*\n\s*\)/);
  assert.match(DELETE_FN, /RAISE EXCEPTION\s*\n\s*'Unfinished event % has unexpected dependent data in %; deletion aborted\.'/);
  // children first: command audit -> draft marker -> event
  const cmd = DELETE_FN.indexOf("DELETE FROM public.self_service_onboarding_command_audit");
  const marker = DELETE_FN.indexOf("DELETE FROM public.self_service_private_event_drafts");
  const evt = DELETE_FN.indexOf("DELETE FROM public.events");
  assert.ok(cmd < marker && marker < evt, "delete order is command audit -> draft marker -> event");
  // empty workspace also removes lifecycle audit + appointment + tenant
  assert.match(
    DELETE_FN,
    /IF v_scope = 'event_and_empty_workspace' THEN\s*\n\s*DELETE FROM public\.self_service_tenant_lifecycle_audit[\s\S]*?DELETE FROM public\.self_service_organizer_appointments[\s\S]*?DELETE FROM public\.tenants/,
  );
  assert.match(DELETE_FN, /v_scope := CASE WHEN v_other_events = 0\s*\n\s*THEN 'event_and_empty_workspace'/);
  // the governed DELETE window is opened AND closed inside the function
  assert.match(DELETE_FN, /set_config\('app\.self_service_governed_deletion', 'on', true\)/);
  assert.match(DELETE_FN, /set_config\('app\.self_service_governed_deletion', 'off', true\)/);
  // identity is never destroyed
  assert.doesNotMatch(DELETE_FN, /DELETE FROM public\.(people|person_auth_accounts|person_resolution_audit)\b/);
});

test("delete + capacity RPCs are postgres-owned, authenticated-only", () => {
  for (const sig of [
    "get_my_self_service_organizer_capacity\\(\\)",
    "delete_self_service_organizer_event\\(uuid, uuid\\)",
  ]) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${sig} OWNER TO postgres`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig}\\s*\\n\\s*FROM PUBLIC, anon, service_role`));
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig}\\s*\\n\\s*TO authenticated`));
  }
  assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*?TO (?:anon|service_role)/);
});

test("both creation commands enforce the default capacity after identity resolution and before the events insert", () => {
  for (const body of [DRAFT_FN, EVENT_FN]) {
    const capacityCheck = /\) >= public\.self_service_default_active_event_limit\(\) THEN\s*\n\s*RAISE EXCEPTION 'You already have an active unfinished event\. Finish or delete it before starting another\.'/;
    assert.match(body, capacityCheck);
    // capacity is checked on the resolved canonical Person
    assert.match(body, /WHERE cap_oa\.person_id = v_organizer_person_id/);
    // ordering: after "no Person" fail-closed check, before the first events insert
    const nullCheck = body.indexOf("v_organizer_person_id IS NULL");
    const capIdx = body.search(capacityCheck);
    const firstEventInsert = body.indexOf("INSERT INTO public.events");
    assert.ok(nullCheck !== -1 && nullCheck < capIdx, "capacity check follows identity resolution");
    assert.ok(capIdx !== -1 && capIdx < firstEventInsert, "capacity check precedes the events insert");
  }
});

test("the migration changes no global authority predicate, tenant/event RLS policy, or historical migration", () => {
  assert.doesNotMatch(SQL, /FUNCTION public\.has_(?:platform|tenant|event)_admin_authority/);
  assert.doesNotMatch(SQL, /FUNCTION public\._is_self_service_private_draft_tenant/);
  assert.doesNotMatch(SQL, /CREATE POLICY|DROP POLICY/);
  assert.doesNotMatch(SQL, /list_tenants_for_administration|list_tenant_owned_events_for_administration/);
  // only the two creation commands and the two immutable triggers are restated
  const replaced = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(replaced, [
    "create_self_service_organizer_draft",
    "create_self_service_organizer_event",
    "delete_self_service_organizer_event",
    "get_my_self_service_organizer_capacity",
    "prevent_self_service_event_deletion_audit_mutation",
    "prevent_self_service_onboarding_command_audit_mutation",
    "prevent_self_service_tenant_lifecycle_audit_mutation",
    "self_service_default_active_event_limit",
  ]);
});
