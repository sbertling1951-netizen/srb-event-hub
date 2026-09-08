import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20260930000000_govern_self_service_private_draft_guest_list.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260930000000_govern_self_service_private_draft_guest_list.sql", import.meta.url),
  ),
  "utf8",
);

/** The migration SQL with `-- …` line comments stripped. */
const CODE = SQL.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");

function fn(name: string) {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = SQL.indexOf("$function$;", start);
  return SQL.slice(start, end);
}

const AUTHZ = fn("_organizer_private_draft_guest_authorize");
const VALIDATE = fn("_organizer_private_planned_guest_validate");
const LIST = fn("list_my_private_draft_planned_guests");
const ADD = fn("add_my_private_draft_planned_guest");
const UPDATE = fn("update_my_private_draft_planned_guest");
const DELETE = fn("delete_my_private_draft_planned_guest");
const DELETE_EVENT = fn("delete_self_service_organizer_event");
const MUTATIONS = [ADD, UPDATE, DELETE];

test("the migration adds exactly one table and restates a bounded set of functions", () => {
  const created = [...SQL.matchAll(/CREATE TABLE public\.([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(created, ["self_service_private_draft_planned_guests"]);

  const replaced = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(replaced, [
    "_organizer_private_draft_guest_authorize",
    "_organizer_private_planned_guest_validate",
    "add_my_private_draft_planned_guest",
    "delete_my_private_draft_planned_guest",
    "delete_self_service_organizer_event",
    "list_my_private_draft_planned_guests",
    "update_my_private_draft_planned_guest",
  ]);

  // one transactional file
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;\s*$/m);
});

test("the migration touches NO identity / attendee / invitation / capacity / visibility system", () => {
  assert.doesNotMatch(
    CODE,
    /\b(people|person_identifiers|person_auth_accounts|person_role_instances|person_event_participations|attendees|attendee_household_members|activity_registrations|member_checkin_audit|parking)\b/,
  );
  assert.doesNotMatch(CODE, /invitation|registration|household|capacity|check_?in|notification|resend|email_queue/i);
  assert.doesNotMatch(CODE, /visible_to_members\s*=\s*true|is_active\s*=\s*true\s+WHERE|publish/i);
  // no Event task / tenant / platform authority is consulted or granted
  assert.doesNotMatch(CODE, /has_event_task_authority|has_tenant_admin_authority|has_platform_admin_authority|GRANT .*event\./);
  // no admin agenda / attendee RPC is redefined
  assert.doesNotMatch(CODE, /\b(create|update|delete)_event_agenda_item\b|_attendee_|admin_save_/);
  // no new audit sink / trigger of its own
  assert.doesNotMatch(CODE, /_ledger_log|resolution_audit|CREATE TRIGGER|CREATE TABLE public\.\w*(ledger|audit)/);
  // the guest RPCs write NO ledger row -- the only agenda_command_ledger
  // reference is the verbatim-restated P-3B cleanup inside the deletion path
  for (const body of MUTATIONS) {
    assert.doesNotMatch(body, /INSERT INTO public\.agenda_command_ledger|command_ledger/);
  }
});

test("the planned-guest table is event-owned, RLS-on, and closed to every browser role", () => {
  assert.match(SQL, /event_id uuid NOT NULL REFERENCES public\.events\(id\) ON DELETE RESTRICT/);
  assert.match(SQL, /display_name text NOT NULL\s*\n\s*CHECK \(btrim\(display_name\) <> '' AND length\(display_name\) <= 200\)/);
  assert.match(SQL, /ALTER TABLE public\.self_service_private_draft_planned_guests ENABLE ROW LEVEL SECURITY/);
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.self_service_private_draft_planned_guests\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  // no direct RLS policy is opened on the table -- browser access is RPC-only
  assert.doesNotMatch(CODE, /CREATE POLICY[^\n]*self_service_private_draft_planned_guests/);
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

test("every guest RPC re-runs the full authorization first and is non-enumerating", () => {
  for (const body of [LIST, ADD, UPDATE, DELETE]) {
    assert.match(body, /PERFORM public\._organizer_private_draft_guest_authorize\(p_event_id\)/);
  }
  for (const body of [UPDATE, DELETE]) {
    assert.match(body, /WHERE g\.id = p_guest_id AND g\.event_id = p_event_id/);
    assert.match(body, /RAISE EXCEPTION 'Planned guest not found\.'/);
  }
});

test("display name is required; email / phone / note are optional and stored as typed", () => {
  assert.match(VALIDATE, /p_display_name IS NULL OR btrim\(p_display_name\) = '' OR length\(btrim\(p_display_name\)\) > 200/);
  for (const body of [ADD, UPDATE]) {
    assert.match(body, /v_email text := nullif\(btrim\(p_email\), ''\)/);
    assert.match(body, /v_phone text := nullif\(btrim\(p_phone\), ''\)/);
    assert.match(body, /v_note text := nullif\(btrim\(p_organizer_note\), ''\)/);
  }
  // the update rewrites only the four editable fields + updated_at
  const setStart = UPDATE.indexOf("SET display_name = v_display_name");
  const updateSet = UPDATE.slice(setStart, UPDATE.indexOf("\n  WHERE g.id", setStart));
  assert.match(updateSet, /display_name = v_display_name,\s*\n\s*email = v_email,\s*\n\s*phone = v_phone,\s*\n\s*organizer_note = v_note,\s*\n\s*updated_at = now\(\)/);
  assert.doesNotMatch(updateSet, /\bevent_id\s*=|\bcreated_at\s*=/);
});

test("the guest table is never matched against an existing person / account", () => {
  // no lookup of an existing identity from a planned guest's contact fields
  assert.doesNotMatch(CODE, /_identity_convergence_norm_|normalized_value|resolve_vendor_person|evaluate_member_identity/);
  assert.doesNotMatch(CODE, /FROM public\.people|FROM public\.person_identifiers|FROM public\.attendees/);
});

test("all guest RPCs are postgres-owned and authenticated-only; internals are granted to nobody", () => {
  for (const sig of [
    "list_my_private_draft_planned_guests\\(uuid\\)",
    "add_my_private_draft_planned_guest\\(uuid, text, text, text, text\\)",
    "update_my_private_draft_planned_guest\\(uuid, uuid, text, text, text, text\\)",
    "delete_my_private_draft_planned_guest\\(uuid, uuid\\)",
  ]) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${sig} OWNER TO postgres`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon, service_role`));
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated`));
  }
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\._organizer_private_draft_guest_authorize\(uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\._organizer_private_planned_guest_validate\(text, text, text, text\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*?TO (?:anon|service_role)/);
});

test("delete_self_service_organizer_event removes planned guests BEFORE the fail-closed scan, unchanged otherwise", () => {
  const guestDel = DELETE_EVENT.indexOf("DELETE FROM public.self_service_private_draft_planned_guests AS plg");
  const agendaDel = DELETE_EVENT.indexOf("DELETE FROM public.agenda_items AS ai");
  const scan = DELETE_EVENT.indexOf("FOR v_dep IN");
  const eventDel = DELETE_EVENT.indexOf("DELETE FROM public.events AS e");
  assert.ok(guestDel !== -1, "the planned-guest cleanup block is present");
  assert.ok(agendaDel !== -1 && agendaDel < guestDel, "the P-3B agenda cleanup still precedes it");
  assert.ok(guestDel < scan, "planned-guest cleanup precedes the dependency scan");
  assert.ok(scan < eventDel, "the dependency scan still precedes the Event delete");
  assert.match(
    DELETE_EVENT,
    /DELETE FROM public\.self_service_private_draft_planned_guests AS plg\s*\n\s*WHERE plg\.event_id = p_event_id;/,
  );

  // the auth gate, governed markers, fail-closed scan, and empty-workspace
  // teardown are all still there and unchanged in shape
  assert.match(DELETE_EVENT, /RAISE EXCEPTION 'Event not found\.'/);
  assert.match(DELETE_EVENT, /PERFORM set_config\('app\.self_service_governed_deletion', 'on', true\)/);
  assert.match(DELETE_EVENT, /FROM pg_constraint AS con[\s\S]*?con\.confrelid = 'public\.events'::regclass/);
  assert.match(DELETE_EVENT, /RAISE EXCEPTION\s*\n\s*'Unfinished event % has unexpected dependent data in %; deletion aborted\.'/);
  assert.match(DELETE_EVENT, /IF v_scope = 'event_and_empty_workspace' THEN[\s\S]*?DELETE FROM public\.tenants/);
  // the planned-guest table is NOT added to the scan's exclusion list -- it is
  // emptied first, then the scan legitimately finds nothing
  assert.doesNotMatch(DELETE_EVENT, /planned_guests'::regclass/);
  // CREATE OR REPLACE keeps the existing owner/ACL -- no re-grant
  assert.doesNotMatch(SQL, /ALTER FUNCTION public\.delete_self_service_organizer_event|GRANT EXECUTE ON FUNCTION public\.delete_self_service_organizer_event/);
});

test("no guest PII is placed in a deletion audit, URL, or raised error", () => {
  // the only INSERT into the deletion audit carries identifiers + counts only
  const auditInsert = DELETE_EVENT.indexOf("INSERT INTO public.self_service_event_deletion_audit");
  const auditBlock = DELETE_EVENT.slice(auditInsert, DELETE_EVENT.indexOf("RETURNING * INTO v_audit"));
  assert.match(
    auditBlock,
    /organizer_person_id, actor_auth_user_id, deleted_event_id, deleted_tenant_id,\s*\n\s*deletion_scope, removed_command_audit_count, idempotency_key/,
  );
  assert.doesNotMatch(auditBlock, /display_name|guest|email|phone|organizer_note/i);
  // raised errors never interpolate a guest field
  assert.doesNotMatch(CODE, /RAISE EXCEPTION[^;]*%[^;]*(display_name|email|phone|organizer_note)/);
});
