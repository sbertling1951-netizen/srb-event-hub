import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20260928000000_govern_self_service_private_draft_agenda.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260928000000_govern_self_service_private_draft_agenda.sql", import.meta.url),
  ),
  "utf8",
);

/** The migration SQL with `-- …` line comments stripped (assertions about what
 * the migration *does* must not trip on prose). */
const CODE = SQL.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");

function fn(name: string) {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = SQL.indexOf("$function$;", start);
  return SQL.slice(start, end);
}

const AUTHZ = fn("_organizer_private_draft_agenda_authorize");
const GET = fn("get_my_private_draft_agenda");
const CREATE = fn("create_my_private_draft_agenda_item");
const UPDATE = fn("update_my_private_draft_agenda_item");
const DELETE = fn("delete_my_private_draft_agenda_item");
const MUTATIONS = [CREATE, UPDATE, DELETE];

test("the migration does not touch any admin agenda RPC, RLS policy, or Event task authority", () => {
  const replaced = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(replaced, [
    "_organizer_private_agenda_item_validate",
    "_organizer_private_draft_agenda_authorize",
    "create_my_private_draft_agenda_item",
    "delete_my_private_draft_agenda_item",
    "get_my_private_draft_agenda",
    "update_my_private_draft_agenda_item",
  ]);
  assert.doesNotMatch(CODE, /\b(create|update|delete|reorder|import)_event_agenda_items?\b|get_event_agenda_version|_agenda_ledger_log/);
  assert.doesNotMatch(CODE, /has_event_task_authority|has_tenant_admin_authority|has_platform_admin_authority/);
  assert.doesNotMatch(CODE, /CREATE POLICY|DROP POLICY|admin_task_registry/);
  assert.doesNotMatch(CODE, /_agenda_command_ledger_immutable|CREATE TRIGGER/);
});

test("the ledger taxonomy extension is tightly limited: +1 authority branch, +3 organizer actions, every existing value verbatim", () => {
  assert.match(
    SQL,
    /ADD CONSTRAINT agenda_command_ledger_resolved_authority_branch_check\s*\n\s*CHECK \(resolved_authority_branch IN \('platform', 'tenant', 'event', 'compound', 'organizer'\)\)/,
  );
  for (const existing of [
    "root_created", "revision_created", "revision_published", "template_applied", "agenda_replaced",
    "event_agenda_item_created", "event_agenda_item_updated", "event_agenda_item_deleted",
    "event_agenda_items_reordered", "event_agenda_items_imported",
  ]) {
    assert.ok(SQL.includes(`'${existing}'`), `existing ledger action '${existing}' must be restated verbatim`);
  }
  for (const added of [
    "organizer_private_agenda_item_created",
    "organizer_private_agenda_item_updated",
    "organizer_private_agenda_item_deleted",
  ]) {
    assert.ok(SQL.includes(`'${added}'`), `new organizer ledger action '${added}' missing`);
  }
});

test("the organizer authorization helper is the self-service owner rule -- never Event task authority", () => {
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
    /t\.is_active = true\s*\n\s*AND t\.is_self_service_private_draft = true\s*\n\s*AND e\.status = 'Draft'\s*\n\s*AND e\.is_active = false\s*\n\s*AND e\.visible_to_members = false/,
  );
  assert.doesNotMatch(AUTHZ, /has_event_task_authority/);
});

test("every organizer agenda RPC re-runs the full authorization first and is non-enumerating", () => {
  for (const body of [GET, CREATE, UPDATE, DELETE]) {
    assert.match(body, /PERFORM public\._organizer_private_draft_agenda_authorize\(p_event_id\)/);
  }
  // the item-scoped mutations also confirm the item belongs to the authorized event
  for (const body of [UPDATE, DELETE]) {
    assert.match(body, /WHERE ai\.id = p_item_id AND ai\.event_id = p_event_id/);
    assert.match(body, /RAISE EXCEPTION 'Agenda item not found\.'/);
  }
});

test("items are stored non-public and organizer-sourced; is_published is never a parameter", () => {
  assert.match(CREATE, /is_published, source\s*\n\s*\) VALUES \([\s\S]*?false, 'organizer_manual'/);
  assert.doesNotMatch(CODE, /p_is_published|p_published/);
  // update rewrites only the editable text/time fields
  const setStart = UPDATE.indexOf("SET title = v_title");
  const updateSet = UPDATE.slice(setStart, UPDATE.indexOf("\n  WHERE ai.id", setStart));
  assert.doesNotMatch(updateSet, /\b(is_published|source|event_id|sort_order|category|color)\b\s*=/);
  assert.match(updateSet, /title = v_title,[\s\S]*?end_time = p_end_time$/);
});

test("optimistic concurrency reuses the shared per-Event agenda version", () => {
  assert.match(CREATE, /public\._agenda_event_version_advance\(p_event_id, NULL\)/);
  assert.match(UPDATE, /public\._agenda_event_version_advance\(p_event_id, p_expected_agenda_version\)/);
  assert.match(DELETE, /public\._agenda_event_version_advance\(p_event_id, p_expected_agenda_version\)/);
  // reading returns the same shared version alongside the items
  assert.match(GET, /RETURNS TABLE\(agenda_version integer, items jsonb\)/);
  assert.match(GET, /FROM public\.event_agenda_state AS s WHERE s\.event_id = p_event_id/);
});

test("every organizer mutation records a ledger row with branch 'organizer' and a NULL admin task_key", () => {
  for (const body of MUTATIONS) {
    assert.match(
      body,
      /INSERT INTO public\.agenda_command_ledger\([\s\S]*?resolved_authority_branch, task_key[\s\S]*?VALUES \(\s*\n\s*'organizer_private_agenda_item_[a-z]+', v_actor, 'organizer', NULL, p_event_id/,
    );
    // the ledger is immutable -- no follow-up UPDATE of it
    assert.doesNotMatch(body, /UPDATE public\.agenda_command_ledger/);
  }
});

test("all organizer agenda RPCs are postgres-owned and authenticated-only; internals are granted to nobody", () => {
  for (const sig of [
    "get_my_private_draft_agenda\\(uuid\\)",
    "create_my_private_draft_agenda_item\\(uuid, text, text, text, text, date, time, time\\)",
    "update_my_private_draft_agenda_item\\(uuid, uuid, integer, text, text, text, text, date, time, time\\)",
    "delete_my_private_draft_agenda_item\\(uuid, uuid, integer\\)",
  ]) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${sig} OWNER TO postgres`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon, service_role`));
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated`));
  }
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\._organizer_private_draft_agenda_authorize\(uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/);
  assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*?TO (?:anon|service_role)/);
});

test("the migration is one transactional file", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;\s*$/m);
});
