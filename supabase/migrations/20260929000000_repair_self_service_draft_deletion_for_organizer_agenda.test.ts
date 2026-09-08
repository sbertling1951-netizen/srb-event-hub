import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20260929000000_repair_self_service_draft_deletion_for_organizer_agenda.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260929000000_repair_self_service_draft_deletion_for_organizer_agenda.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const CODE = SQL.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

function fn(name: string) {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = SQL.indexOf("$function$;", start);
  return SQL.slice(start, end);
}

const TRIGGER = fn("_agenda_command_ledger_immutable");
const DELETE_FN = fn("delete_self_service_organizer_event");

test("the migration restates exactly two functions and adds nothing structural", () => {
  const replaced = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(replaced, ["_agenda_command_ledger_immutable", "delete_self_service_organizer_event"]);
  assert.doesNotMatch(CODE, /CREATE TABLE|ALTER TABLE|DROP |CREATE POLICY|DROP POLICY|CREATE TRIGGER|DROP TRIGGER/);
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;\s*$/m);
});

test("the organizer is granted NO Event task authority", () => {
  assert.doesNotMatch(CODE, /has_event_task_authority|event\.agenda\.manage|GRANT .*event\.agenda/);
  // the migration never touches an admin agenda RPC
  assert.doesNotMatch(CODE, /\b(create|update|delete|reorder|import)_event_agenda_items?\b|get_event_agenda_version|apply_agenda_template/);
});

test("the ledger immutability exception is bounded by ALL six required conditions", () => {
  // DELETE only -- UPDATE is never permitted
  assert.match(TRIGGER, /IF TG_OP = 'DELETE'/);
  assert.doesNotMatch(TRIGGER, /TG_OP = 'UPDATE'[\s\S]*RETURN OLD/);
  // the self-service governed-deletion marker
  assert.match(TRIGGER, /current_setting\('app\.self_service_governed_deletion', true\) = 'on'/);
  // a companion marker naming the exact event id, matched against this row
  assert.match(TRIGGER, /OLD\.event_id::text\s*\n?\s*= current_setting\('app\.self_service_governed_deletion_event_id', true\)/);
  // organizer branch + no admin task key + only the three P-3B actions
  assert.match(TRIGGER, /OLD\.resolved_authority_branch = 'organizer'/);
  assert.match(TRIGGER, /OLD\.task_key IS NULL/);
  assert.match(
    TRIGGER,
    /OLD\.action IN \(\s*\n\s*'organizer_private_agenda_item_created',\s*\n\s*'organizer_private_agenda_item_updated',\s*\n\s*'organizer_private_agenda_item_deleted'\s*\n\s*\)/,
  );
  // the Event is re-verified as the eligible hidden/inactive/non-visible private Draft
  assert.match(
    TRIGGER,
    /t\.is_active = true\s*\n\s*AND t\.is_self_service_private_draft = true\s*\n\s*AND e\.status = 'Draft'\s*\n\s*AND e\.is_active = false\s*\n\s*AND e\.visible_to_members = false/,
  );
  // permit is RETURN OLD; every other path still raises the original message
  assert.match(TRIGGER, /THEN\s*\n\s*RETURN OLD;\s*\n\s*END IF;\s*\n\s*RAISE EXCEPTION 'agenda command ledger entries are immutable'/);
});

test("the delete RPC sets BOTH governed markers right after authorization and clears both at the end", () => {
  assert.match(DELETE_FN, /PERFORM set_config\('app\.self_service_governed_deletion', 'on', true\);\s*\n\s*PERFORM set_config\('app\.self_service_governed_deletion_event_id', p_event_id::text, true\);/);
  assert.match(DELETE_FN, /PERFORM set_config\('app\.self_service_governed_deletion', 'off', true\);\s*\n\s*PERFORM set_config\('app\.self_service_governed_deletion_event_id', '', true\);/);
  // markers are opened AFTER the "Event not found." authorization gate...
  const authGate = DELETE_FN.lastIndexOf("RAISE EXCEPTION 'Event not found.'");
  const markerOn = DELETE_FN.indexOf("set_config('app.self_service_governed_deletion', 'on', true)");
  assert.ok(authGate !== -1 && markerOn > authGate, "markers set only after authorization succeeds");
});

test("the agenda cleanup removes exactly this Event's organizer Agenda children, BEFORE the dependency scan and Event delete", () => {
  const ledgerDel = DELETE_FN.indexOf("DELETE FROM public.agenda_command_ledger AS acl");
  const itemsDel = DELETE_FN.indexOf("DELETE FROM public.agenda_items AS ai");
  const stateDel = DELETE_FN.indexOf("DELETE FROM public.event_agenda_state AS eas");
  const scan = DELETE_FN.indexOf("FOR v_dep IN");
  const eventDel = DELETE_FN.indexOf("DELETE FROM public.events AS e");
  assert.ok(ledgerDel !== -1 && itemsDel !== -1 && stateDel !== -1);
  assert.ok(ledgerDel < scan && itemsDel < scan && stateDel < scan, "agenda cleanup precedes the dependency scan");
  assert.ok(scan < eventDel, "dependency scan still precedes the Event delete");

  // the ledger delete is scoped to organizer-branch P-3B actions with no task key
  assert.match(
    DELETE_FN,
    /DELETE FROM public\.agenda_command_ledger AS acl\s*\n\s*WHERE acl\.event_id = p_event_id\s*\n\s*AND acl\.resolved_authority_branch = 'organizer'\s*\n\s*AND acl\.task_key IS NULL\s*\n\s*AND acl\.action IN \(/,
  );
  // agenda items + state deletes are scoped to the one Event
  assert.match(DELETE_FN, /DELETE FROM public\.agenda_items AS ai\s*\n\s*WHERE ai\.event_id = p_event_id;/);
  assert.match(DELETE_FN, /DELETE FROM public\.event_agenda_state AS eas\s*\n\s*WHERE eas\.event_id = p_event_id;/);
});

test("the fail-closed dependency scan and empty-workspace teardown are preserved unchanged", () => {
  assert.match(DELETE_FN, /FROM pg_constraint AS con[\s\S]*?con\.confrelid = 'public\.events'::regclass/);
  assert.match(DELETE_FN, /con\.conrelid NOT IN \(\s*\n\s*'public\.self_service_private_event_drafts'::regclass,\s*\n\s*'public\.self_service_onboarding_command_audit'::regclass\s*\n\s*\)/);
  assert.match(DELETE_FN, /RAISE EXCEPTION\s*\n\s*'Unfinished event % has unexpected dependent data in %; deletion aborted\.'/);
  assert.match(DELETE_FN, /IF v_scope = 'event_and_empty_workspace' THEN\s*\n\s*DELETE FROM public\.self_service_tenant_lifecycle_audit[\s\S]*?DELETE FROM public\.self_service_organizer_appointments[\s\S]*?DELETE FROM public\.tenants/);
  // the scan is NOT replaced by broad cascading deletion
  assert.doesNotMatch(DELETE_FN, /ON DELETE CASCADE|TRUNCATE|DELETE FROM public\.attendees|DELETE FROM public\.announcements/);
});

test("the minimal deletion audit is still the first write and carries no event content", () => {
  const auditInsert = DELETE_FN.indexOf("INSERT INTO public.self_service_event_deletion_audit");
  const firstAgendaDelete = DELETE_FN.indexOf("DELETE FROM public.agenda_command_ledger AS acl");
  const firstOpDelete = DELETE_FN.indexOf("DELETE FROM public.self_service_onboarding_command_audit AS ca");
  assert.ok(auditInsert !== -1 && auditInsert < firstAgendaDelete && auditInsert < firstOpDelete, "audit insert precedes every delete");
  // audit columns are unchanged: identifiers + counts only, no title/description/location/content
  const auditBlock = DELETE_FN.slice(auditInsert, DELETE_FN.indexOf("RETURNING * INTO v_audit"));
  assert.match(auditBlock, /organizer_person_id, actor_auth_user_id, deleted_event_id, deleted_tenant_id,\s*\n\s*deletion_scope, removed_command_audit_count, idempotency_key/);
  assert.doesNotMatch(auditBlock, /title|description|location|agenda|speaker|name/i);
});

test("the delete RPC keeps its signature, ownership, and authenticated-only grant (via CREATE OR REPLACE)", () => {
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.delete_self_service_organizer_event\(\s*\n\s*p_event_id uuid,\s*\n\s*p_idempotency_key uuid\s*\n\s*\)/);
  assert.match(DELETE_FN, /SECURITY DEFINER\s*\nSET search_path TO 'pg_catalog'/);
  // CREATE OR REPLACE preserves the 20260926000000 owner/ACL -- no re-grant needed
  assert.doesNotMatch(SQL, /ALTER FUNCTION public\.delete_self_service_organizer_event|GRANT EXECUTE ON FUNCTION public\.delete_self_service_organizer_event/);
});
