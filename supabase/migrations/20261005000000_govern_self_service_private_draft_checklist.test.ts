import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261005000000_govern_self_service_private_draft_checklist.test.ts

const SQL = readFileSync(
  fileURLToPath(new URL("./20261005000000_govern_self_service_private_draft_checklist.sql", import.meta.url)),
  "utf8",
);
const P3F = readFileSync(
  fileURLToPath(new URL("./20261004000000_govern_self_service_private_draft_registry_plan.sql", import.meta.url)),
  "utf8",
);

/** Comments stripped. */
const CODE = SQL.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
/** Executable SQL: comments AND `COMMENT ON` prose removed. */
const EXEC = CODE.replace(/COMMENT ON [\s\S]*?;\n/g, "");

function fnFrom(src: string, name: string) {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  return src.slice(start, src.indexOf("$function$;", start));
}
const fn = (n: string) => fnFrom(SQL, n);

const AUTHZ = fn("_organizer_private_draft_checklist_authorize");
const VALIDATE = fn("_organizer_private_checklist_item_validate");
const LIST = fn("list_my_private_draft_checklist_items");
const ADD = fn("add_my_private_draft_checklist_item");
const UPDATE = fn("update_my_private_draft_checklist_item");
const DELETE = fn("delete_my_private_draft_checklist_item");
const DELETE_EVENT = fn("delete_self_service_organizer_event");

test("the migration adds exactly one dedicated table and restates a bounded set of functions", () => {
  assert.deepEqual(
    [...SQL.matchAll(/CREATE TABLE public\.([a-z_]+)/g)].map((m) => m[1]),
    ["self_service_private_draft_checklist_items"],
  );
  assert.deepEqual(
    [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/g)].map((m) => m[1]).sort(),
    [
      "_organizer_private_checklist_item_validate",
      "_organizer_private_draft_checklist_authorize",
      "add_my_private_draft_checklist_item",
      "delete_my_private_draft_checklist_item",
      "delete_self_service_organizer_event",
      "list_my_private_draft_checklist_items",
      "update_my_private_draft_checklist_item",
    ],
  );
  assert.doesNotMatch(CODE, /entity_type|planning_kind|record_type|polymorphic|subject_type/i);
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;\s*$/m);
});

test("§B.1 BLANK: the ONLY insert into the checklist table is the organizer's own add", () => {
  const inserts = [...EXEC.matchAll(/INSERT INTO public\.self_service_private_draft_checklist_items/g)];
  assert.equal(inserts.length, 1, "exactly one INSERT exists in the whole migration");
  assert.ok(
    ADD.includes("INSERT INTO public.self_service_private_draft_checklist_items"),
    "and it lives inside add_my_private_draft_checklist_item",
  );
  // nothing seeds, generates, suggests, templates, or defaults an item
  assert.doesNotMatch(EXEC, /seed|starter|template|suggest|recommend|default_item|generate|preset|sample/i);
  // no INSERT … SELECT (a bulk seeder) and no VALUES list of literal titles
  assert.doesNotMatch(EXEC, /INSERT INTO[\s\S]{0,200}?SELECT/i);
  // the create/onboarding path is not touched, so a new draft gets nothing
  assert.doesNotMatch(EXEC, /create_self_service_organizer_draft/);
});

test("§B.3 INERT COMPLETION: never aggregated, counted, scored, or branched on", () => {
  // no aggregate or arithmetic over completion anywhere
  assert.doesNotMatch(EXEC, /count\s*\([^)]*is_completed|sum\s*\(|avg\s*\(|percent|ratio|progress|score/i);
  assert.doesNotMatch(EXEC, /FILTER\s*\(\s*WHERE[^)]*is_completed/i);
  // nothing branches on the completion value
  assert.doesNotMatch(EXEC, /IF[^;]*is_completed|CASE[^;]*is_completed|WHEN[^;]*is_completed/i);
  // no WHERE clause selects by completion (no "remaining items" query)
  assert.doesNotMatch(EXEC, /WHERE[^;]*is_completed\s*(=|IS)/i);
  // and completion never reaches the Event or the draft marker
  assert.doesNotMatch(EXEC, /UPDATE public\.events|INSERT INTO public\.events/);
  assert.doesNotMatch(EXEC, /UPDATE public\.self_service_private_event_drafts/);
  // No WRITE ever sets event state. (Reading `e.status = 'Draft'` /
  // `is_active = false` in the authorization predicate is required and is a
  // read, so the assertion targets assignment inside UPDATE/INSERT only.)
  const writes = [...EXEC.matchAll(/(UPDATE|INSERT INTO)\s+public\.\w+[\s\S]*?;/g)].map((m) => m[0]);
  for (const w of writes) {
    assert.doesNotMatch(w, /\bstatus\s*=|is_active\s*=|visible_to_members\s*=|location_mode\s*=/,
      "no write in this migration assigns event status / activity / visibility / location mode");
  }
  assert.doesNotMatch(EXEC, /readiness|\blaunch\b|\bpublish/i);
});

test("THE TARGET DATE IS INERT: date-typed, never range-checked, nothing acts on it", () => {
  assert.match(SQL, /target_date date,/, "date only -- deliberately not timestamptz");
  assert.doesNotMatch(SQL, /target_date timestamptz|target_time|target_at/);
  // no comparison against now()/current_date -> no overdue concept
  assert.doesNotMatch(EXEC, /target_date\s*(<|>|<=|>=)/);
  assert.doesNotMatch(EXEC, /overdue|due_|remind|notify|schedule|cron|calendar|ical/i);
  // no network-capable construct could deliver a reminder even if wanted
  assert.doesNotMatch(EXEC, /\bhttp\s*\(|http_get|http_post|pg_net|net\.http|dblink|COPY[^;]*PROGRAM|CREATE EXTENSION|FOREIGN DATA WRAPPER|pg_read_file/i);
  const langs = new Set([...SQL.matchAll(/^LANGUAGE (\w+)/gm)].map((m) => m[1]));
  assert.deepEqual([...langs], ["plpgsql"]);
});

test("the table holds exactly the approved columns -- no ordering, no score, no assignee", () => {
  const createTable = SQL.slice(
    SQL.indexOf("CREATE TABLE public.self_service_private_draft_checklist_items"),
    SQL.indexOf("ALTER TABLE public.self_service_private_draft_checklist_items OWNER"),
  );
  const cols = [...createTable.matchAll(/^  (\w+) (uuid|text|date|boolean|timestamptz)/gm)].map((m) => m[1]);
  assert.deepEqual(cols, [
    "id", "event_id", "item_title", "organizer_note", "target_date",
    "is_completed", "created_at", "updated_at",
  ]);
  assert.match(SQL, /is_completed boolean NOT NULL DEFAULT false/);
  // this phase adds NO ordering behavior; creation order only
  assert.doesNotMatch(CODE, /sort_order|\bposition\b|\brank\b|display_order|reorder/i);
  assert.match(SQL, /ORDER BY ci\.created_at, ci\.id/);
  // and no assignee / collaboration column
  assert.doesNotMatch(CODE, /assignee|assigned_to|owner_id|shared_with|delegat/i);
});

test("the migration touches NO task-authority / agenda / identity / commerce surface", () => {
  assert.doesNotMatch(EXEC, /admin_task_registry/);
  // The agenda tables appear ONLY inside the carried-forward P-3B cleanup in
  // delete_self_service_organizer_event. The P-3G functions themselves must
  // not mention them at all.
  const P3G_OWN = [VALIDATE, LIST, ADD, UPDATE, DELETE].join("\n");
  assert.doesNotMatch(P3G_OWN, /agenda_items|event_agenda_state|agenda_command_ledger/);
  assert.equal(
    [...EXEC.matchAll(/agenda_items|event_agenda_state/g)].length,
    2,
    "the only agenda references are the two carried-forward P-3B cleanup DELETEs",
  );
  assert.doesNotMatch(
    EXEC,
    /\b(people|person_identifiers|person_auth_accounts|attendees|activity_registrations|member_checkin_audit)\b/,
  );
  assert.doesNotMatch(EXEC, /\bpublic\.vendors\b|\bevent_vendors\b|vendor_contacts|candidac|admission|disposition/i);
  assert.doesNotMatch(EXEC, /invitation|notification|email_queue|resend|\bnotify\b|announcements/i);
  assert.doesNotMatch(EXEC, /catalog_asset_id|planning_catalog|\bpayment\b|passport|\bprice\b|\bcurrency\b/i);
  assert.doesNotMatch(EXEC, /has_event_task_authority|has_tenant_admin_authority|has_vendor_catalog_admin_authority/);
  assert.doesNotMatch(CODE, /_ledger_log|resolution_audit|CREATE TRIGGER|CREATE TABLE public\.\w*(ledger|audit)/);
});

test("the checklist table is event-owned, RLS-on, and closed to every browser role", () => {
  assert.match(SQL, /event_id uuid NOT NULL REFERENCES public\.events\(id\) ON DELETE RESTRICT/);
  assert.match(SQL, /item_title text NOT NULL\s*\n\s*CHECK \(btrim\(item_title\) <> '' AND length\(item_title\) <= 300\)/);
  assert.match(SQL, /ALTER TABLE public\.self_service_private_draft_checklist_items ENABLE ROW LEVEL SECURITY/);
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.self_service_private_draft_checklist_items\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(CODE, /CREATE POLICY/);
});

test("the owner predicate is byte-identical to the P-3F registry predicate apart from name and messages", () => {
  const registryAuthz = fnFrom(P3F, "_organizer_private_draft_registry_plan_authorize");
  const norm = (b: string) =>
    b
      .replace(/_organizer_private_draft_(checklist|registry_plan)_authorize/g, "AUTHZ")
      .replace(/Editing a (planning checklist|registry plan) requires/g, "Editing X requires");
  assert.equal(norm(AUTHZ), norm(registryAuthz));
  assert.doesNotMatch(AUTHZ, /has_event_task_authority/);
});

test("every checklist RPC re-runs the full authorization first and is non-enumerating", () => {
  for (const body of [LIST, ADD, UPDATE, DELETE]) {
    assert.match(body, /PERFORM public\._organizer_private_draft_checklist_authorize\(p_event_id\)/);
  }
  for (const body of [UPDATE, DELETE]) {
    assert.match(body, /WHERE ci\.id = p_checklist_item_id AND ci\.event_id = p_event_id/);
    assert.match(body, /RAISE EXCEPTION 'Checklist item not found\.'/);
  }
});

test("title required; note/date optional; the title is never parsed or categorized", () => {
  assert.match(VALIDATE, /p_item_title IS NULL OR btrim\(p_item_title\) = '' OR length\(btrim\(p_item_title\)\) > 300/);
  assert.doesNotMatch(VALIDATE, /~|\bLIKE\b|SIMILAR TO|regexp/i);
  assert.doesNotMatch(EXEC, /split_part|regexp_|substring\s*\(|strpos|to_tsvector|tsquery/i);
  for (const body of [ADD, UPDATE]) {
    assert.match(body, /v_note text := nullif\(btrim\(p_organizer_note\), ''\)/);
    assert.match(body, /v_completed boolean := coalesce\(p_is_completed, false\)/);
  }
  const setStart = UPDATE.indexOf("SET item_title = v_title");
  const updateSet = UPDATE.slice(setStart, UPDATE.indexOf("\n  WHERE ci.id", setStart));
  assert.match(
    updateSet,
    /item_title = v_title,\s*\n\s*organizer_note = v_note,\s*\n\s*target_date = p_target_date,\s*\n\s*is_completed = v_completed,\s*\n\s*updated_at = now\(\)/,
  );
  assert.doesNotMatch(updateSet, /\bevent_id\s*=|\bcreated_at\s*=/);
});

test("the list RPC returns rows only -- no totals, counts, or derived signal", () => {
  const returns = LIST.slice(LIST.indexOf("RETURNS TABLE("), LIST.indexOf(")\nLANGUAGE"));
  const cols = [...returns.matchAll(/\n  (\w+) (uuid|text|date|boolean|timestamptz)/g)].map((m) => m[1]);
  assert.deepEqual(cols, [
    "id", "item_title", "organizer_note", "target_date", "is_completed",
    "created_at", "updated_at",
  ]);
  assert.doesNotMatch(LIST, /count\s*\(|sum\s*\(|total|remaining|percent/i);
});

test("all checklist RPCs are postgres-owned and authenticated-only; internals granted to nobody", () => {
  for (const sig of [
    "list_my_private_draft_checklist_items\\(uuid\\)",
    "add_my_private_draft_checklist_item\\(uuid, text, text, date, boolean\\)",
    "update_my_private_draft_checklist_item\\(uuid, uuid, text, text, date, boolean\\)",
    "delete_my_private_draft_checklist_item\\(uuid, uuid\\)",
  ]) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${sig} OWNER TO postgres`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon, service_role`));
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated`));
  }
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\._organizer_private_draft_checklist_authorize\(uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\._organizer_private_checklist_item_validate\(text, text\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*?TO (?:anon|service_role)/);
});

test("delete_self_service_organizer_event removes checklist rows in the CORRECT position", () => {
  const at = (n: string) => DELETE_EVENT.indexOf(n);
  const seq = [
    at("DELETE FROM public.self_service_private_draft_planned_guests AS plg"),
    at("DELETE FROM public.self_service_private_draft_vendor_plans AS svp"),
    at("DELETE FROM public.self_service_private_draft_venue_plans AS svnp"),
    at("DELETE FROM public.self_service_private_draft_registry_plans AS srp"),
    at("DELETE FROM public.self_service_private_draft_checklist_items AS sci"),
    at("FOR v_dep IN"),
    at("DELETE FROM public.events AS e"),
  ];
  assert.ok(seq.every((v) => v !== -1), "every expected cleanup block is present");
  assert.deepEqual(seq, seq.slice().sort((a, b) => a - b),
    "guests < vendors < venues < registries < checklist < scan < event delete");
  assert.match(
    DELETE_EVENT,
    /DELETE FROM public\.self_service_private_draft_checklist_items AS sci\s*\n\s*WHERE sci\.event_id = p_event_id;/,
  );
  assert.match(DELETE_EVENT, /PERFORM set_config\('app\.self_service_governed_deletion', 'on', true\)/);
  assert.match(DELETE_EVENT, /FROM pg_constraint AS con[\s\S]*?con\.confrelid = 'public\.events'::regclass/);
  assert.match(DELETE_EVENT, /IF v_scope = 'event_and_empty_workspace' THEN[\s\S]*?DELETE FROM public\.tenants/);
  assert.doesNotMatch(DELETE_EVENT, /checklist_items'::regclass/);
  assert.doesNotMatch(SQL, /ALTER FUNCTION public\.delete_self_service_organizer_event|GRANT EXECUTE ON FUNCTION public\.delete_self_service_organizer_event/);
});

test("delete_self_service_organizer_event is otherwise carried forward VERBATIM from P-3F", () => {
  const previous = fnFrom(P3F, "delete_self_service_organizer_event");
  const stripped = DELETE_EVENT.replace(
    /\n  -- P-3G organizer private planning-checklist cleanup:[\s\S]*?WHERE sci\.event_id = p_event_id;\n/,
    "",
  );
  assert.equal(stripped, previous,
    "every P-2D..P-3F line of the deletion path must be byte-identical to 20261004000000");
});

test("the deletion audit gains NO checklist content and NO ITEM COUNT", () => {
  // the cleanup captures nothing -- no count variable, no SELECT count around it
  const block = DELETE_EVENT.slice(
    DELETE_EVENT.indexOf("DELETE FROM public.self_service_private_draft_checklist_items AS sci") - 400,
    DELETE_EVENT.indexOf("FOR v_dep IN"),
  );
  assert.doesNotMatch(block, /count\s*\(|INTO v_\w*checklist|checklist_count/i);
  // the audit insert column list is unchanged
  const ai = DELETE_EVENT.indexOf("INSERT INTO public.self_service_event_deletion_audit");
  const auditBlock = DELETE_EVENT.slice(ai, DELETE_EVENT.indexOf("RETURNING * INTO v_audit"));
  assert.match(
    auditBlock,
    /organizer_person_id, actor_auth_user_id, deleted_event_id, deleted_tenant_id,\s*\n\s*deletion_scope, removed_command_audit_count, idempotency_key/,
  );
  assert.doesNotMatch(auditBlock, /checklist|item|title|note|completed|target/i);
  assert.doesNotMatch(
    CODE,
    /RAISE EXCEPTION[^;]*%[^;]*(item_title|organizer_note|target_date|is_completed)/,
  );
});
