import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261001000000_govern_self_service_private_draft_vendor_plan.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20261001000000_govern_self_service_private_draft_vendor_plan.sql", import.meta.url),
  ),
  "utf8",
);

const GUEST_SQL = readFileSync(
  fileURLToPath(
    new URL("./20260930000000_govern_self_service_private_draft_guest_list.sql", import.meta.url),
  ),
  "utf8",
);

/** The migration SQL with `-- …` line comments stripped. */
const CODE = SQL.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");

function fnFrom(source: string, name: string) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = source.indexOf("$function$;", start);
  return source.slice(start, end);
}
const fn = (name: string) => fnFrom(SQL, name);

const AUTHZ = fn("_organizer_private_draft_vendor_plan_authorize");
const VALIDATE = fn("_organizer_private_vendor_plan_validate");
const LIST = fn("list_my_private_draft_vendor_plans");
const ADD = fn("add_my_private_draft_vendor_plan");
const UPDATE = fn("update_my_private_draft_vendor_plan");
const DELETE = fn("delete_my_private_draft_vendor_plan");
const DELETE_EVENT = fn("delete_self_service_organizer_event");
const MUTATIONS = [ADD, UPDATE, DELETE];

test("the migration adds exactly one table and restates a bounded set of functions", () => {
  const created = [...SQL.matchAll(/CREATE TABLE public\.([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(created, ["self_service_private_draft_vendor_plans"]);

  const replaced = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(replaced, [
    "_organizer_private_draft_vendor_plan_authorize",
    "_organizer_private_vendor_plan_validate",
    "add_my_private_draft_vendor_plan",
    "delete_my_private_draft_vendor_plan",
    "delete_self_service_organizer_event",
    "list_my_private_draft_vendor_plans",
    "update_my_private_draft_vendor_plan",
  ]);

  // one transactional file
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;\s*$/m);
});

test("the migration touches NO vendor catalog / admission / access / invitation system", () => {
  // the operational vendor stack is never read, written, or referenced
  assert.doesNotMatch(CODE, /\bpublic\.vendors\b|\bevent_vendors\b|\bvendor_contacts\b|\bvendor_org_access\b/);
  assert.doesNotMatch(CODE, /vendor_invitation|vendor_candidac|vendor_admission|disposition|vendor_access|vendor_token|vendor_workspace/i);
  assert.doesNotMatch(CODE, /has_vendor_catalog_admin_authority|has_event_task_authority|has_tenant_admin_authority|resolve_task_authority/);
  // no admission / assignment / registration / payment concept is introduced
  assert.doesNotMatch(CODE, /\badmit|\bassign(ment)?\b|invitation|registration|capacity|check_?in|parking|notification|resend|email_queue/i);
});

test("the migration touches NO identity / attendee / public-visibility system", () => {
  assert.doesNotMatch(
    CODE,
    /\b(people|person_identifiers|person_auth_accounts|person_role_instances|person_event_participations|attendees|attendee_household_members|activity_registrations|member_checkin_audit)\b/,
  );
  assert.doesNotMatch(CODE, /household|publish/i);
  assert.doesNotMatch(CODE, /visible_to_members\s*=\s*true/);
  // no new audit sink / ledger / trigger of its own
  assert.doesNotMatch(CODE, /_ledger_log|resolution_audit|CREATE TRIGGER|CREATE TABLE public\.\w*(ledger|audit)/);
  for (const body of MUTATIONS) {
    assert.doesNotMatch(body, /INSERT INTO public\.agenda_command_ledger|command_ledger/);
  }
});

test("P-3D adds NO catalog reference and NO financial field", () => {
  // the Shared Planning Catalog projection does not exist yet
  assert.doesNotMatch(CODE, /catalog_asset_id|catalog_asset|planning_catalog|catalog_reference/i);
  // the contract leaves financial semantics an explicit open decision
  assert.doesNotMatch(CODE, /\bcost\b|\bquote\b|\bcurrency\b|\bbudget\b|\bprice\b|\bamount\b|\bpayment\b|\bpassport\b|\busd\b/i);
});

test("the vendor-plan table is event-owned, RLS-on, and closed to every browser role", () => {
  assert.match(SQL, /event_id uuid NOT NULL REFERENCES public\.events\(id\) ON DELETE RESTRICT/);
  assert.match(SQL, /vendor_name text NOT NULL\s*\n\s*CHECK \(btrim\(vendor_name\) <> '' AND length\(vendor_name\) <= 200\)/);
  assert.match(SQL, /ALTER TABLE public\.self_service_private_draft_vendor_plans ENABLE ROW LEVEL SECURITY/);
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.self_service_private_draft_vendor_plans\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  // no direct RLS policy is opened on the table -- browser access is RPC-only
  assert.doesNotMatch(CODE, /CREATE POLICY[^\n]*self_service_private_draft_vendor_plans/);
});

test("only the three approved planning statuses exist, at the column and in validation", () => {
  assert.match(
    SQL,
    /planning_status text NOT NULL DEFAULT 'considering'\s*\n\s*CHECK \(planning_status IN \('considering', 'contacted', 'selected'\)\)/,
  );
  assert.match(
    VALIDATE,
    /p_planning_status IS NULL OR p_planning_status NOT IN \('considering', 'contacted', 'selected'\)/,
  );
  assert.match(VALIDATE, /RAISE EXCEPTION 'A vendor plan status must be considering, contacted, or selected\.'/);
  // a blank / unrecognized status is REJECTED, never silently coerced to a
  // default; only an omitted (NULL) argument takes the contract's default
  for (const body of [ADD, UPDATE]) {
    assert.match(body, /v_status text := coalesce\(btrim\(p_planning_status\), 'considering'\)/);
    assert.doesNotMatch(body, /nullif\(btrim\(p_planning_status\), ''\)/);
  }
  // exactly three status literals anywhere in the file
  const statuses = new Set([...SQL.matchAll(/'(considering|contacted|selected)'/g)].map((m) => m[1]));
  assert.deepEqual([...statuses].sort(), ["considering", "contacted", "selected"]);
});

test("the authorization helper is the exact self-service organizer-owner rule -- never Event task authority", () => {
  assert.match(AUTHZ, /v_actor uuid := auth\.uid\(\)/);
  assert.match(AUTHZ, /email_confirmed_at IS NOT NULL/);
  assert.match(AUTHZ, /nullif\(btrim\(u\.email\), ''\) IS NOT NULL/);
  assert.match(AUTHZ, /resolve_auth_person_link\(v_actor\)/);
  assert.match(AUTHZ, /IF v_link_status NOT IN \('resolved', 'no_link'\) THEN\s*\n\s*RAISE EXCEPTION 'Draft not found\.'/);
  assert.match(
    AUTHZ,
    /\(v_link_status = 'resolved' AND oa\.person_id = v_person_id\)\s*\n\s*OR \(v_link_status = 'no_link' AND oa\.auth_user_id = v_actor\)/,
  );
  assert.match(
    AUTHZ,
    /oa\.is_active = true[\s\S]*?t\.is_active = true\s*\n\s*AND t\.is_self_service_private_draft = true\s*\n\s*AND e\.status = 'Draft'\s*\n\s*AND e\.is_active = false\s*\n\s*AND e\.visible_to_members = false/,
  );
  assert.doesNotMatch(AUTHZ, /has_event_task_authority/);
});

test("the owner predicate is byte-identical to the P-3C guest predicate apart from its name and messages", () => {
  const guestAuthz = fnFrom(GUEST_SQL, "_organizer_private_draft_guest_authorize");
  const normalize = (body: string) =>
    body
      .replace(/_organizer_private_draft_(vendor_plan|guest)_authorize/g, "AUTHZ")
      .replace(/Editing a (vendor plan|guest list) requires/g, "Editing X requires");
  assert.equal(normalize(AUTHZ), normalize(guestAuthz));
});

test("every vendor-plan RPC re-runs the full authorization first and is non-enumerating", () => {
  for (const body of [LIST, ADD, UPDATE, DELETE]) {
    assert.match(body, /PERFORM public\._organizer_private_draft_vendor_plan_authorize\(p_event_id\)/);
  }
  for (const body of [UPDATE, DELETE]) {
    assert.match(body, /WHERE vp\.id = p_vendor_plan_id AND vp\.event_id = p_event_id/);
    assert.match(body, /RAISE EXCEPTION 'Vendor plan entry not found\.'/);
  }
});

test("vendor name is required; category / website / contact / note are optional and stored as typed", () => {
  assert.match(VALIDATE, /p_vendor_name IS NULL OR btrim\(p_vendor_name\) = '' OR length\(btrim\(p_vendor_name\)\) > 200/);
  for (const body of [ADD, UPDATE]) {
    assert.match(body, /v_category text := nullif\(btrim\(p_service_category\), ''\)/);
    assert.match(body, /v_website text := nullif\(btrim\(p_website\), ''\)/);
    assert.match(body, /v_contact text := nullif\(btrim\(p_contact_detail\), ''\)/);
    assert.match(body, /v_note text := nullif\(btrim\(p_organizer_note\), ''\)/);
  }
  // the update rewrites only the six editable fields + updated_at
  const setStart = UPDATE.indexOf("SET vendor_name = v_vendor_name");
  const updateSet = UPDATE.slice(setStart, UPDATE.indexOf("\n  WHERE vp.id", setStart));
  assert.match(
    updateSet,
    /vendor_name = v_vendor_name,\s*\n\s*service_category = v_category,\s*\n\s*planning_status = v_status,\s*\n\s*website = v_website,\s*\n\s*contact_detail = v_contact,\s*\n\s*organizer_note = v_note,\s*\n\s*updated_at = now\(\)/,
  );
  assert.doesNotMatch(updateSet, /\bevent_id\s*=|\bcreated_at\s*=/);
});

test("contact detail and note are opaque -- never normalized, matched, or resolved", () => {
  assert.doesNotMatch(CODE, /_identity_convergence_norm_|normalized_value|resolve_vendor_person|evaluate_member_identity/);
  assert.doesNotMatch(CODE, /FROM public\.people|FROM public\.person_identifiers|FROM public\.attendees|FROM public\.vendors/);
  // the only validation on the free-text fields is a length bound
  assert.match(VALIDATE, /p_contact_detail IS NOT NULL AND length\(p_contact_detail\) > 320/);
  assert.doesNotMatch(VALIDATE, /~|LIKE|similar to|regexp/i);
  // no discovery index is built over the planner-entered text
  const indexes = [...SQL.matchAll(/CREATE INDEX [^\n]+/g)].map((m) => m[0]);
  assert.deepEqual(indexes.length, 1);
  assert.doesNotMatch(indexes[0], /vendor_name|contact_detail|organizer_note|website|service_category/);
});

test("all vendor-plan RPCs are postgres-owned and authenticated-only; internals are granted to nobody", () => {
  for (const sig of [
    "list_my_private_draft_vendor_plans\\(uuid\\)",
    "add_my_private_draft_vendor_plan\\(uuid, text, text, text, text, text, text\\)",
    "update_my_private_draft_vendor_plan\\(uuid, uuid, text, text, text, text, text, text\\)",
    "delete_my_private_draft_vendor_plan\\(uuid, uuid\\)",
  ]) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${sig} OWNER TO postgres`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon, service_role`));
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated`));
  }
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\._organizer_private_draft_vendor_plan_authorize\(uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\._organizer_private_vendor_plan_validate\(text, text, text, text, text, text\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*?TO (?:anon|service_role)/);
});

test("delete_self_service_organizer_event removes vendor plans BEFORE the fail-closed scan", () => {
  const vendorDel = DELETE_EVENT.indexOf("DELETE FROM public.self_service_private_draft_vendor_plans AS svp");
  const guestDel = DELETE_EVENT.indexOf("DELETE FROM public.self_service_private_draft_planned_guests AS plg");
  const agendaDel = DELETE_EVENT.indexOf("DELETE FROM public.agenda_items AS ai");
  const scan = DELETE_EVENT.indexOf("FOR v_dep IN");
  const eventDel = DELETE_EVENT.indexOf("DELETE FROM public.events AS e");
  assert.ok(vendorDel !== -1, "the vendor-plan cleanup block is present");
  assert.ok(agendaDel !== -1 && agendaDel < guestDel, "the P-3B agenda cleanup still precedes the P-3C guest cleanup");
  assert.ok(guestDel !== -1 && guestDel < vendorDel, "the P-3C guest cleanup still precedes the P-3D vendor cleanup");
  assert.ok(vendorDel < scan, "vendor-plan cleanup precedes the dependency scan");
  assert.ok(scan < eventDel, "the dependency scan still precedes the Event delete");
  assert.match(
    DELETE_EVENT,
    /DELETE FROM public\.self_service_private_draft_vendor_plans AS svp\s*\n\s*WHERE svp\.event_id = p_event_id;/,
  );

  // the auth gate, governed markers, fail-closed scan, and empty-workspace
  // teardown are all still there and unchanged in shape
  assert.match(DELETE_EVENT, /RAISE EXCEPTION 'Event not found\.'/);
  assert.match(DELETE_EVENT, /PERFORM set_config\('app\.self_service_governed_deletion', 'on', true\)/);
  assert.match(DELETE_EVENT, /FROM pg_constraint AS con[\s\S]*?con\.confrelid = 'public\.events'::regclass/);
  assert.match(DELETE_EVENT, /RAISE EXCEPTION\s*\n\s*'Unfinished event % has unexpected dependent data in %; deletion aborted\.'/);
  assert.match(DELETE_EVENT, /IF v_scope = 'event_and_empty_workspace' THEN[\s\S]*?DELETE FROM public\.tenants/);
  // the vendor-plan table is NOT added to the scan's exclusion list -- it is
  // emptied first, then the scan legitimately finds nothing
  assert.doesNotMatch(DELETE_EVENT, /vendor_plans'::regclass/);
  // CREATE OR REPLACE keeps the existing owner/ACL -- no re-grant
  assert.doesNotMatch(SQL, /ALTER FUNCTION public\.delete_self_service_organizer_event|GRANT EXECUTE ON FUNCTION public\.delete_self_service_organizer_event/);
});

test("delete_self_service_organizer_event is otherwise carried forward VERBATIM from P-3C", () => {
  const previous = fnFrom(GUEST_SQL, "delete_self_service_organizer_event");
  const strippedOfVendorBlock = DELETE_EVENT.replace(
    /\n  -- P-3D organizer private vendor-plan cleanup:[\s\S]*?WHERE svp\.event_id = p_event_id;\n/,
    "",
  );
  assert.equal(
    strippedOfVendorBlock,
    previous,
    "every P-2D/P-3B/P-3C line of the deletion path must be byte-identical to 20260930000000",
  );
});

test("no vendor / contact / note content is placed in a deletion audit, URL, or raised error", () => {
  const auditInsert = DELETE_EVENT.indexOf("INSERT INTO public.self_service_event_deletion_audit");
  const auditBlock = DELETE_EVENT.slice(auditInsert, DELETE_EVENT.indexOf("RETURNING * INTO v_audit"));
  assert.match(
    auditBlock,
    /organizer_person_id, actor_auth_user_id, deleted_event_id, deleted_tenant_id,\s*\n\s*deletion_scope, removed_command_audit_count, idempotency_key/,
  );
  assert.doesNotMatch(auditBlock, /vendor|category|status|website|contact|organizer_note/i);
  // raised errors never interpolate a planner-entered field
  assert.doesNotMatch(
    CODE,
    /RAISE EXCEPTION[^;]*%[^;]*(vendor_name|service_category|website|contact_detail|organizer_note)/,
  );
});
