import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261004000000_govern_self_service_private_draft_registry_plan.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20261004000000_govern_self_service_private_draft_registry_plan.sql", import.meta.url),
  ),
  "utf8",
);

const P3E = readFileSync(
  fileURLToPath(
    new URL("./20261003000000_govern_self_service_private_draft_venue_plan.sql", import.meta.url),
  ),
  "utf8",
);

/** The migration SQL with `-- …` line comments stripped. */
const CODE = SQL.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
/** Executable SQL: comments AND `COMMENT ON` prose both removed. */
const EXEC = CODE.replace(/COMMENT ON [\s\S]*?;\n/g, "");

function fnFrom(source: string, name: string) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  return source.slice(start, source.indexOf("$function$;", start));
}
const fn = (name: string) => fnFrom(SQL, name);

const AUTHZ = fn("_organizer_private_draft_registry_plan_authorize");
const VALIDATE = fn("_organizer_private_registry_plan_validate");
const LIST = fn("list_my_private_draft_registry_plans");
const ADD = fn("add_my_private_draft_registry_plan");
const UPDATE = fn("update_my_private_draft_registry_plan");
const DELETE = fn("delete_my_private_draft_registry_plan");
const DELETE_EVENT = fn("delete_self_service_organizer_event");
const MUTATIONS = [ADD, UPDATE, DELETE];

test("the migration adds exactly one dedicated table and restates a bounded set of functions", () => {
  assert.deepEqual(
    [...SQL.matchAll(/CREATE TABLE public\.([a-z_]+)/g)].map((m) => m[1]),
    ["self_service_private_draft_registry_plans"],
  );
  assert.deepEqual(
    [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/g)].map((m) => m[1]).sort(),
    [
      "_organizer_private_draft_registry_plan_authorize",
      "_organizer_private_registry_plan_validate",
      "add_my_private_draft_registry_plan",
      "delete_my_private_draft_registry_plan",
      "delete_self_service_organizer_event",
      "list_my_private_draft_registry_plans",
      "update_my_private_draft_registry_plan",
    ],
  );
  // a DEDICATED registry table, not a generic polymorphic planning table
  assert.doesNotMatch(CODE, /entity_type|planning_kind|record_type|polymorphic|subject_type/i);
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;\s*$/m);
});

test("THE URL IS INERT: length-bounded only, never format-checked or transformed", () => {
  // storage bound only
  assert.match(
    SQL,
    /registry_url text\s*\n\s*CHECK \(registry_url IS NULL OR \(btrim\(registry_url\) <> '' AND length\(registry_url\) <= 2000\)\)/,
  );
  assert.match(VALIDATE, /p_registry_url IS NOT NULL AND length\(p_registry_url\) > 2000/);
  // NO format check of any kind
  assert.doesNotMatch(VALIDATE, /~|LIKE|SIMILAR TO|regexp|https?|scheme|\burl\b\s*~/i);
  assert.doesNotMatch(EXEC, /regexp_|split_part|substring\s*\(|strpos|position\s*\(/i);
  // btrim is the ONLY transformation ever applied
  for (const body of [ADD, UPDATE]) {
    assert.match(body, /v_url text := nullif\(btrim\(p_registry_url\), ''\)/);
    assert.doesNotMatch(body, /(lower|upper|translate|replace|regexp_replace|encode|decode)\s*\(\s*p_registry_url/);
  }
  // no index over the URL -- nothing is searching or deduplicating it
  const indexes = [...SQL.matchAll(/CREATE INDEX [^\n]+/g)].map((m) => m[0]);
  assert.equal(indexes.length, 1);
  assert.doesNotMatch(indexes[0], /registry_url|provider_name|organizer_note/);
});

test("NO OUTBOUND CONTACT: nothing here can reach a provider or any network", () => {
  // Postgres HTTP/FDW/dblink/COPY-PROGRAM escape hatches
  assert.doesNotMatch(EXEC, /\bhttp\s*\(|http_get|http_post|pg_net|net\.http|dblink|COPY[^;]*PROGRAM|CREATE EXTENSION|FOREIGN DATA WRAPPER|SERVER\b/i);
  assert.doesNotMatch(EXEC, /pg_read_file|pg_read_binary_file|lo_import|lo_export/i);
  // no untrusted language that could shell out
  assert.doesNotMatch(EXEC, /LANGUAGE\s+(plpython|plperlu|plsh|c)\b/i);
  // every function is plpgsql only
  const langs = new Set([...SQL.matchAll(/^LANGUAGE (\w+)/gm)].map((m) => m[1]));
  assert.deepEqual([...langs], ["plpgsql"]);
});

test("NO CREDENTIALS, NO COMMERCE, NO PUBLICATION -- there is no column that could carry them", () => {
  // scoped to the CREATE TABLE block ONLY -- a whole-file scan would also
  // sweep up function parameters, RETURNS TABLE columns, and DECLARE vars
  const createTable = SQL.slice(
    SQL.indexOf("CREATE TABLE public.self_service_private_draft_registry_plans"),
    SQL.indexOf("ALTER TABLE public.self_service_private_draft_registry_plans OWNER"),
  );
  const cols = [...createTable.matchAll(/^  (\w+) (uuid|text|timestamptz)/gm)].map((m) => m[1]);
  assert.deepEqual(cols, [
    "id", "event_id", "provider_name", "registry_url", "planning_status",
    "organizer_note", "created_at", "updated_at",
  ]);
  assert.doesNotMatch(CODE, /credential|password|secret|token|api_key|apikey|access_code|oauth|refresh_token|client_secret/i);
  // `ORDER BY` is a SQL keyword, not commerce -- neutralized before the scan
  const noCommerce = CODE.replace(/\bORDER BY\b/gi, "SORT_BY");
  assert.doesNotMatch(noCommerce, /\bpayment\b|\bpurchase\b|\bgift\b|contribution|\bfund\b|\border\b|\borders\b|fulfil|\bprice\b|\bcurrency\b|\bamount\b|\bitem\b|quantity|passport/i);
  assert.doesNotMatch(EXEC, /is_published|published_at|publish|visible_to_members\s*=\s*true|announcements/i);
});

test("the migration touches NO provider / vendor / identity / catalog / task-registry surface", () => {
  assert.doesNotMatch(EXEC, /\bpublic\.vendors\b|\bevent_vendors\b|vendor_contacts|vendor_org_access|candidac|admission|disposition/i);
  assert.doesNotMatch(
    EXEC,
    /\b(people|person_identifiers|person_auth_accounts|person_role_instances|person_event_participations|attendees|attendee_household_members|activity_registrations|member_checkin_audit)\b/,
  );
  assert.doesNotMatch(EXEC, /invitation|notification|email_queue|resend|\bnotify\b/i);
  assert.doesNotMatch(EXEC, /catalog_asset_id|planning_catalog/i);
  // admin_task_registry merely shares the word "registry" -- never touched
  assert.doesNotMatch(EXEC, /admin_task_registry/);
  assert.doesNotMatch(EXEC, /has_event_task_authority|has_tenant_admin_authority|has_vendor_catalog_admin_authority/);
  // no new audit sink / ledger / trigger of its own
  assert.doesNotMatch(CODE, /_ledger_log|resolution_audit|CREATE TRIGGER|CREATE TABLE public\.\w*(ledger|audit)/);
  for (const body of MUTATIONS) {
    assert.doesNotMatch(body, /INSERT INTO public\.agenda_command_ledger|command_ledger/);
  }
});

test("'selected' is inert: stored, never branched on, and it writes no Event state", () => {
  assert.match(
    SQL,
    /planning_status text NOT NULL DEFAULT 'considering'\s*\n\s*CHECK \(planning_status IN \('considering', 'contacted', 'selected'\)\)/,
  );
  assert.doesNotMatch(CODE, /(=|<>|!=)\s*'selected'/);
  const sel = [...CODE.matchAll(/'selected'/g)].length;
  const trio = [...CODE.matchAll(/'considering', 'contacted', 'selected'/g)].length;
  assert.equal(sel, trio, "every 'selected' is part of the three-status whitelist");
  // and nothing in this migration writes the Event at all
  assert.doesNotMatch(EXEC, /UPDATE public\.events|INSERT INTO public\.events/);
  assert.doesNotMatch(EXEC, /UPDATE public\.self_service_private_event_drafts/);
});

test("the registry-plan table is event-owned, RLS-on, and closed to every browser role", () => {
  assert.match(SQL, /event_id uuid NOT NULL REFERENCES public\.events\(id\) ON DELETE RESTRICT/);
  assert.match(SQL, /provider_name text NOT NULL\s*\n\s*CHECK \(btrim\(provider_name\) <> '' AND length\(provider_name\) <= 200\)/);
  assert.match(SQL, /ALTER TABLE public\.self_service_private_draft_registry_plans ENABLE ROW LEVEL SECURITY/);
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.self_service_private_draft_registry_plans\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(CODE, /CREATE POLICY[^\n]*self_service_private_draft_registry_plans/);
});

test("the owner predicate is byte-identical to the P-3E venue predicate apart from name and messages", () => {
  const venueAuthz = fnFrom(P3E, "_organizer_private_draft_venue_plan_authorize");
  const normalize = (b: string) =>
    b
      .replace(/_organizer_private_draft_(registry|venue)_plan_authorize/g, "AUTHZ")
      .replace(/Editing a (registry|venue) plan requires/g, "Editing X requires");
  assert.equal(normalize(AUTHZ), normalize(venueAuthz));
  assert.doesNotMatch(AUTHZ, /has_event_task_authority/);
});

test("every registry RPC re-runs the full authorization first and is non-enumerating", () => {
  for (const body of [LIST, ADD, UPDATE, DELETE]) {
    assert.match(body, /PERFORM public\._organizer_private_draft_registry_plan_authorize\(p_event_id\)/);
  }
  for (const body of [UPDATE, DELETE]) {
    assert.match(body, /WHERE rp\.id = p_registry_plan_id AND rp\.event_id = p_event_id/);
    assert.match(body, /RAISE EXCEPTION 'Registry plan entry not found\.'/);
  }
});

test("provider name is required; URL and note optional; only three statuses", () => {
  assert.match(VALIDATE, /p_provider_name IS NULL OR btrim\(p_provider_name\) = '' OR length\(btrim\(p_provider_name\)\) > 200/);
  assert.match(VALIDATE, /p_planning_status IS NULL OR p_planning_status NOT IN \('considering', 'contacted', 'selected'\)/);
  for (const body of [ADD, UPDATE]) {
    assert.match(body, /v_note text := nullif\(btrim\(p_organizer_note\), ''\)/);
    assert.match(body, /v_status text := coalesce\(btrim\(p_planning_status\), 'considering'\)/);
    assert.doesNotMatch(body, /nullif\(btrim\(p_planning_status\), ''\)/);
  }
  const setStart = UPDATE.indexOf("SET provider_name = v_provider_name");
  const updateSet = UPDATE.slice(setStart, UPDATE.indexOf("\n  WHERE rp.id", setStart));
  assert.match(
    updateSet,
    /provider_name = v_provider_name,\s*\n\s*registry_url = v_url,\s*\n\s*planning_status = v_status,\s*\n\s*organizer_note = v_note,\s*\n\s*updated_at = now\(\)/,
  );
  assert.doesNotMatch(updateSet, /\bevent_id\s*=|\bcreated_at\s*=/);
});

test("all registry RPCs are postgres-owned and authenticated-only; internals granted to nobody", () => {
  for (const sig of [
    "list_my_private_draft_registry_plans\\(uuid\\)",
    "add_my_private_draft_registry_plan\\(uuid, text, text, text, text\\)",
    "update_my_private_draft_registry_plan\\(uuid, uuid, text, text, text, text\\)",
    "delete_my_private_draft_registry_plan\\(uuid, uuid\\)",
  ]) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${sig} OWNER TO postgres`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon, service_role`));
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated`));
  }
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\._organizer_private_draft_registry_plan_authorize\(uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\._organizer_private_registry_plan_validate\(text, text, text, text\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*?TO (?:anon|service_role)/);
});

test("delete_self_service_organizer_event removes registry plans in the CORRECT position", () => {
  const at = (needle: string) => DELETE_EVENT.indexOf(needle);
  const agenda = at("DELETE FROM public.agenda_items AS ai");
  const guests = at("DELETE FROM public.self_service_private_draft_planned_guests AS plg");
  const vendors = at("DELETE FROM public.self_service_private_draft_vendor_plans AS svp");
  const venues = at("DELETE FROM public.self_service_private_draft_venue_plans AS svnp");
  const registry = at("DELETE FROM public.self_service_private_draft_registry_plans AS srp");
  const scan = at("FOR v_dep IN");
  const eventDel = at("DELETE FROM public.events AS e");
  assert.ok(registry !== -1, "the registry cleanup block is present");
  assert.deepEqual(
    [agenda, guests, vendors, venues, registry, scan, eventDel],
    [agenda, guests, vendors, venues, registry, scan, eventDel].slice().sort((a, b) => a - b),
    "agenda < guests < vendors < venues < registry < scan < event delete",
  );
  assert.match(
    DELETE_EVENT,
    /DELETE FROM public\.self_service_private_draft_registry_plans AS srp\s*\n\s*WHERE srp\.event_id = p_event_id;/,
  );
  // governed markers, fail-closed scan, and teardown all intact
  assert.match(DELETE_EVENT, /RAISE EXCEPTION 'Event not found\.'/);
  assert.match(DELETE_EVENT, /PERFORM set_config\('app\.self_service_governed_deletion', 'on', true\)/);
  assert.match(DELETE_EVENT, /FROM pg_constraint AS con[\s\S]*?con\.confrelid = 'public\.events'::regclass/);
  assert.match(DELETE_EVENT, /IF v_scope = 'event_and_empty_workspace' THEN[\s\S]*?DELETE FROM public\.tenants/);
  assert.doesNotMatch(DELETE_EVENT, /registry_plans'::regclass/);
  assert.doesNotMatch(SQL, /ALTER FUNCTION public\.delete_self_service_organizer_event|GRANT EXECUTE ON FUNCTION public\.delete_self_service_organizer_event/);
});

test("delete_self_service_organizer_event is otherwise carried forward VERBATIM from P-3E", () => {
  const previous = fnFrom(P3E, "delete_self_service_organizer_event");
  const stripped = DELETE_EVENT.replace(
    /\n  -- P-3F organizer private registry-plan cleanup:[\s\S]*?WHERE srp\.event_id = p_event_id;\n/,
    "",
  );
  assert.equal(
    stripped,
    previous,
    "every P-2D/P-3B/P-3C/P-3D/P-3E line of the deletion path must be byte-identical to 20261003000000",
  );
});

test("no planner-entered content reaches a deletion audit, URL, or raised error", () => {
  const ai = DELETE_EVENT.indexOf("INSERT INTO public.self_service_event_deletion_audit");
  const block = DELETE_EVENT.slice(ai, DELETE_EVENT.indexOf("RETURNING * INTO v_audit"));
  assert.match(
    block,
    /organizer_person_id, actor_auth_user_id, deleted_event_id, deleted_tenant_id,\s*\n\s*deletion_scope, removed_command_audit_count, idempotency_key/,
  );
  assert.doesNotMatch(block, /provider|registry|url|note|status/i);
  assert.doesNotMatch(
    CODE,
    /RAISE EXCEPTION[^;]*%[^;]*(provider_name|registry_url|organizer_note)/,
  );
});
