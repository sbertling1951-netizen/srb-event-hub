import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261003000000_govern_self_service_private_draft_venue_plan.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20261003000000_govern_self_service_private_draft_venue_plan.sql", import.meta.url),
  ),
  "utf8",
);

const P3D = readFileSync(
  fileURLToPath(
    new URL("./20261001000000_govern_self_service_private_draft_vendor_plan.sql", import.meta.url),
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

const AUTHZ = fn("_organizer_private_draft_venue_plan_authorize");
const VALIDATE = fn("_organizer_private_venue_plan_validate");
const LIST = fn("list_my_private_draft_venue_plans");
const ADD = fn("add_my_private_draft_venue_plan");
const UPDATE = fn("update_my_private_draft_venue_plan");
const DELETE = fn("delete_my_private_draft_venue_plan");
const DELETE_EVENT = fn("delete_self_service_organizer_event");
const MUTATIONS = [ADD, UPDATE, DELETE];

test("the migration adds exactly one dedicated table and restates a bounded set of functions", () => {
  const created = [...SQL.matchAll(/CREATE TABLE public\.([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(created, ["self_service_private_draft_venue_plans"]);

  const replaced = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(replaced, [
    "_organizer_private_draft_venue_plan_authorize",
    "_organizer_private_venue_plan_validate",
    "add_my_private_draft_venue_plan",
    "delete_my_private_draft_venue_plan",
    "delete_self_service_organizer_event",
    "list_my_private_draft_venue_plans",
    "update_my_private_draft_venue_plan",
  ]);

  // a DEDICATED place table, not a generic polymorphic planning table
  assert.doesNotMatch(CODE, /entity_type|planning_kind|record_type|polymorphic|subject_type/i);
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;\s*$/m);
});

test("THE CENTRAL RULE: no function writes any official Event location field", () => {
  // no write to events.* or the draft's location_mode, anywhere
  assert.doesNotMatch(CODE, /UPDATE public\.events/);
  assert.doesNotMatch(CODE, /UPDATE public\.self_service_private_event_drafts/);
  assert.doesNotMatch(CODE, /INSERT INTO public\.events/);
  assert.doesNotMatch(CODE, /INSERT INTO public\.event_locations/);
  assert.doesNotMatch(CODE, /\blocation_mode\s*=/);
  // events.* columns are only ever READ, and only inside the authorization
  // predicate's eligibility JOIN
  for (const col of ["venue_name", "street_address", "\\blat\\b", "\\blng\\b"]) {
    assert.doesNotMatch(CODE, new RegExp(`e\\.${col}|events\\.${col}`), `never touches events.${col}`);
  }
  // the only statements that mention events at all are the eligibility SELECTs
  // and the pre-existing deletion path carried forward verbatim
  const eventWrites = [...CODE.matchAll(/(UPDATE|INSERT INTO)\s+public\.events/g)];
  assert.equal(eventWrites.length, 0);
});

test("'selected' is inert: the status is stored and nothing branches on it", () => {
  assert.match(
    SQL,
    /planning_status text NOT NULL DEFAULT 'considering'\s*\n\s*CHECK \(planning_status IN \('considering', 'contacted', 'selected'\)\)/,
  );
  // Nothing anywhere COMPARES a value to 'selected'. The only places the word
  // appears are the CHECK constraint and the validation whitelist, which list
  // all three statuses together -- so no behavior can branch on being selected.
  assert.doesNotMatch(CODE, /(=|<>|!=)\s*'selected'/);
  assert.doesNotMatch(CODE, /'selected'\s*(=|<>|!=)/);
  const selectedMentions = [...CODE.matchAll(/'selected'/g)].length;
  const allThree = [...CODE.matchAll(/'considering', 'contacted', 'selected'/g)].length;
  assert.equal(
    selectedMentions,
    allThree,
    "every mention of 'selected' is part of the three-status whitelist, never a standalone branch",
  );
  // the update writes only this table's own planning columns
  const setStart = UPDATE.indexOf("SET place_name = v_place_name");
  const updateSet = UPDATE.slice(setStart, UPDATE.indexOf("\n  WHERE vp.id", setStart));
  assert.match(
    updateSet,
    /place_name = v_place_name,\s*\n\s*location_description = v_location,\s*\n\s*website = v_website,\s*\n\s*contact_name = v_contact_name,\s*\n\s*contact_phone = v_contact_phone,\s*\n\s*planning_status = v_status,\s*\n\s*organizer_note = v_note,\s*\n\s*updated_at = now\(\)/,
  );
  assert.doesNotMatch(updateSet, /\bevent_id\s*=|\bcreated_at\s*=/);
});

test("no map, coordinate, geocoding, Nearby, or place-search behavior", () => {
  // COMMENT ON bodies are prose asserting these very prohibitions, so they are
  // excluded before the executable SQL is checked.
  const EXEC = CODE.replace(/COMMENT ON [\s\S]*?;\n/g, "");
  assert.doesNotMatch(EXEC, /master_map|map_asset|map_x|map_y|venue_evidence|site_placement/i);
  assert.doesNotMatch(EXEC, /\blat\b|\blng\b|latitude|longitude|geocod|coordinate|postgis|geography|geometry/i);
  // PostGIS function calls specifically (a bare /st_/ would match "li*st_*my_…")
  assert.doesNotMatch(EXEC, /\bST_[A-Za-z]+\s*\(/i);
  assert.doesNotMatch(CODE, /event_nearby_places|nearby_master|nearby_area|tenant_place_relevance|place_categories/i);
  // no geographic or text search index / operator over the typed place data
  assert.doesNotMatch(CODE, /to_tsvector|tsquery|similarity|\bILIKE\b|<->/i);
});

test("the migration touches NO vendor / identity / attendee / invitation / payment surface", () => {
  assert.doesNotMatch(CODE, /\bpublic\.vendors\b|\bevent_vendors\b|\bvendor_contacts\b|\bvendor_org_access\b/);
  assert.doesNotMatch(CODE, /vendor_invitation|vendor_candidac|vendor_admission|disposition|vendor_access|vendor_token|vendor_workspace/i);
  assert.doesNotMatch(
    CODE,
    /\b(people|person_identifiers|person_auth_accounts|person_role_instances|person_event_participations|attendees|attendee_household_members|activity_registrations|member_checkin_audit)\b/,
  );
  assert.doesNotMatch(CODE, /invitation|registration|household|capacity|check_?in|notification|resend|email_queue|\bnotify\b|\bpublish/i);
  assert.doesNotMatch(CODE, /has_event_task_authority|has_tenant_admin_authority|has_vendor_catalog_admin_authority/);
  // no catalog reference and no booking / availability / financial field
  assert.doesNotMatch(CODE, /catalog_asset_id|planning_catalog/i);
  assert.doesNotMatch(CODE, /\bbooking\b|\bbooked\b|availability\b|\bcost\b|\bquote\b|\bcurrency\b|\bbudget\b|\bprice\b|\bdeposit\b|passport/i);
  // no new audit sink / ledger / trigger of its own
  assert.doesNotMatch(CODE, /_ledger_log|resolution_audit|CREATE TRIGGER|CREATE TABLE public\.\w*(ledger|audit)/);
  for (const body of MUTATIONS) {
    assert.doesNotMatch(body, /INSERT INTO public\.agenda_command_ledger|command_ledger/);
  }
});

test("the venue-plan table is event-owned, RLS-on, and closed to every browser role", () => {
  assert.match(SQL, /event_id uuid NOT NULL REFERENCES public\.events\(id\) ON DELETE RESTRICT/);
  assert.match(SQL, /place_name text NOT NULL\s*\n\s*CHECK \(btrim\(place_name\) <> '' AND length\(place_name\) <= 200\)/);
  assert.match(SQL, /ALTER TABLE public\.self_service_private_draft_venue_plans ENABLE ROW LEVEL SECURITY/);
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.self_service_private_draft_venue_plans\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  // browser access is RPC-only: no RLS policy is opened on the table
  assert.doesNotMatch(CODE, /CREATE POLICY[^\n]*self_service_private_draft_venue_plans/);
});

test("the authorization helper is the exact self-service organizer-owner rule", () => {
  assert.match(AUTHZ, /v_actor uuid := auth\.uid\(\)/);
  assert.match(AUTHZ, /email_confirmed_at IS NOT NULL/);
  assert.match(AUTHZ, /resolve_auth_person_link\(v_actor\)/);
  assert.match(AUTHZ, /IF v_link_status NOT IN \('resolved', 'no_link'\) THEN\s*\n\s*RAISE EXCEPTION 'Draft not found\.'/);
  assert.match(
    AUTHZ,
    /oa\.is_active = true[\s\S]*?t\.is_active = true\s*\n\s*AND t\.is_self_service_private_draft = true\s*\n\s*AND e\.status = 'Draft'\s*\n\s*AND e\.is_active = false\s*\n\s*AND e\.visible_to_members = false/,
  );
  assert.doesNotMatch(AUTHZ, /has_event_task_authority/);
});

test("the owner predicate is byte-identical to the P-3D vendor predicate apart from name and messages", () => {
  const vendorAuthz = fnFrom(P3D, "_organizer_private_draft_vendor_plan_authorize");
  const normalize = (body: string) =>
    body
      .replace(/_organizer_private_draft_(venue|vendor)_plan_authorize/g, "AUTHZ")
      .replace(/Editing a (venue|vendor) plan requires/g, "Editing X requires");
  assert.equal(normalize(AUTHZ), normalize(vendorAuthz));
});

test("every venue-plan RPC re-runs the full authorization first and is non-enumerating", () => {
  for (const body of [LIST, ADD, UPDATE, DELETE]) {
    assert.match(body, /PERFORM public\._organizer_private_draft_venue_plan_authorize\(p_event_id\)/);
  }
  for (const body of [UPDATE, DELETE]) {
    assert.match(body, /WHERE vp\.id = p_venue_plan_id AND vp\.event_id = p_event_id/);
    assert.match(body, /RAISE EXCEPTION 'Venue plan entry not found\.'/);
  }
});

test("place name is required; every other field is optional; only three statuses", () => {
  assert.match(VALIDATE, /p_place_name IS NULL OR btrim\(p_place_name\) = '' OR length\(btrim\(p_place_name\)\) > 200/);
  assert.match(
    VALIDATE,
    /p_planning_status IS NULL OR p_planning_status NOT IN \('considering', 'contacted', 'selected'\)/,
  );
  assert.match(VALIDATE, /RAISE EXCEPTION 'A venue plan status must be considering, contacted, or selected\.'/);
  for (const body of [ADD, UPDATE]) {
    for (const v of [
      "v_location text := nullif\\(btrim\\(p_location_description\\), ''\\)",
      "v_website text := nullif\\(btrim\\(p_website\\), ''\\)",
      "v_contact_name text := nullif\\(btrim\\(p_contact_name\\), ''\\)",
      "v_contact_phone text := nullif\\(btrim\\(p_contact_phone\\), ''\\)",
      "v_note text := nullif\\(btrim\\(p_organizer_note\\), ''\\)",
    ]) {
      assert.match(body, new RegExp(v));
    }
    // a blank / unrecognized status is REJECTED, never silently defaulted
    assert.match(body, /v_status text := coalesce\(btrim\(p_planning_status\), 'considering'\)/);
    assert.doesNotMatch(body, /nullif\(btrim\(p_planning_status\), ''\)/);
  }
  const statuses = new Set([...SQL.matchAll(/'(considering|contacted|selected)'/g)].map((m) => m[1]));
  assert.deepEqual([...statuses].sort(), ["considering", "contacted", "selected"]);
});

test("address, contact name, and phone are opaque -- length-bounded only", () => {
  assert.match(VALIDATE, /p_location_description IS NOT NULL AND length\(p_location_description\) > 500/);
  assert.match(VALIDATE, /p_contact_name IS NOT NULL AND length\(p_contact_name\) > 200/);
  assert.match(VALIDATE, /p_contact_phone IS NOT NULL AND length\(p_contact_phone\) > 50/);
  // no format check, rewriting, parsing, or lookup on any of them
  assert.doesNotMatch(VALIDATE, /~|LIKE|SIMILAR TO|regexp/i);
  assert.doesNotMatch(CODE, /split_part|regexp_|substring\s*\(|strpos/i);
  for (const body of [ADD, UPDATE]) {
    assert.doesNotMatch(
      body,
      /(lower|upper|translate|replace|regexp_replace)\s*\(\s*p_(location_description|contact_name|contact_phone)/,
    );
  }
  assert.doesNotMatch(CODE, /_identity_convergence_norm_|normalized_value|resolve_vendor_person|evaluate_member_identity/);
  assert.doesNotMatch(CODE, /FROM public\.people|FROM public\.person_identifiers|FROM public\.attendees|FROM public\.vendors/);
  // the one index is on ownership/order only -- no discovery index over typed text
  const indexes = [...SQL.matchAll(/CREATE INDEX [^\n]+/g)].map((m) => m[0]);
  assert.equal(indexes.length, 1);
  assert.doesNotMatch(indexes[0], /place_name|location_description|contact_name|contact_phone|website|organizer_note/);
});

test("all venue-plan RPCs are postgres-owned and authenticated-only; internals granted to nobody", () => {
  for (const sig of [
    "list_my_private_draft_venue_plans\\(uuid\\)",
    "add_my_private_draft_venue_plan\\(uuid, text, text, text, text, text, text, text\\)",
    "update_my_private_draft_venue_plan\\(uuid, uuid, text, text, text, text, text, text, text\\)",
    "delete_my_private_draft_venue_plan\\(uuid, uuid\\)",
  ]) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${sig} OWNER TO postgres`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon, service_role`));
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated`));
  }
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\._organizer_private_draft_venue_plan_authorize\(uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\._organizer_private_venue_plan_validate\(text, text, text, text, text, text, text\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*?TO (?:anon|service_role)/);
});

test("delete_self_service_organizer_event removes venue plans in the CORRECT position", () => {
  const agendaDel = DELETE_EVENT.indexOf("DELETE FROM public.agenda_items AS ai");
  const guestDel = DELETE_EVENT.indexOf("DELETE FROM public.self_service_private_draft_planned_guests AS plg");
  const vendorDel = DELETE_EVENT.indexOf("DELETE FROM public.self_service_private_draft_vendor_plans AS svp");
  const venueDel = DELETE_EVENT.indexOf("DELETE FROM public.self_service_private_draft_venue_plans AS svnp");
  const scan = DELETE_EVENT.indexOf("FOR v_dep IN");
  const eventDel = DELETE_EVENT.indexOf("DELETE FROM public.events AS e");
  assert.ok(venueDel !== -1, "the venue-plan cleanup block is present");
  assert.ok(agendaDel !== -1 && agendaDel < guestDel, "P-3B agenda still precedes P-3C guests");
  assert.ok(guestDel < vendorDel, "P-3C guests still precede P-3D vendors");
  assert.ok(vendorDel < venueDel, "P-3D vendors precede the new P-3E venue cleanup");
  assert.ok(venueDel < scan, "venue-plan cleanup precedes the fail-closed dependency scan");
  assert.ok(scan < eventDel, "the dependency scan still precedes the Event delete");
  assert.match(
    DELETE_EVENT,
    /DELETE FROM public\.self_service_private_draft_venue_plans AS svnp\s*\n\s*WHERE svnp\.event_id = p_event_id;/,
  );

  // auth gate, governed markers, fail-closed scan, teardown all intact
  assert.match(DELETE_EVENT, /RAISE EXCEPTION 'Event not found\.'/);
  assert.match(DELETE_EVENT, /PERFORM set_config\('app\.self_service_governed_deletion', 'on', true\)/);
  assert.match(DELETE_EVENT, /FROM pg_constraint AS con[\s\S]*?con\.confrelid = 'public\.events'::regclass/);
  assert.match(DELETE_EVENT, /RAISE EXCEPTION\s*\n\s*'Unfinished event % has unexpected dependent data in %; deletion aborted\.'/);
  assert.match(DELETE_EVENT, /IF v_scope = 'event_and_empty_workspace' THEN[\s\S]*?DELETE FROM public\.tenants/);
  // the venue table is NOT added to the scan's exclusion list -- emptied first
  assert.doesNotMatch(DELETE_EVENT, /venue_plans'::regclass/);
  // CREATE OR REPLACE keeps the existing owner/ACL -- no re-grant
  assert.doesNotMatch(SQL, /ALTER FUNCTION public\.delete_self_service_organizer_event|GRANT EXECUTE ON FUNCTION public\.delete_self_service_organizer_event/);
});

test("delete_self_service_organizer_event is otherwise carried forward VERBATIM from P-3D", () => {
  const previous = fnFrom(P3D, "delete_self_service_organizer_event");
  const stripped = DELETE_EVENT.replace(
    /\n  -- P-3E organizer private venue-plan cleanup:[\s\S]*?WHERE svnp\.event_id = p_event_id;\n/,
    "",
  );
  assert.equal(
    stripped,
    previous,
    "every P-2D/P-3B/P-3C/P-3D line of the deletion path must be byte-identical to 20261001000000",
  );
});

test("no planner-entered content reaches a deletion audit, URL, or raised error", () => {
  const auditInsert = DELETE_EVENT.indexOf("INSERT INTO public.self_service_event_deletion_audit");
  const auditBlock = DELETE_EVENT.slice(auditInsert, DELETE_EVENT.indexOf("RETURNING * INTO v_audit"));
  assert.match(
    auditBlock,
    /organizer_person_id, actor_auth_user_id, deleted_event_id, deleted_tenant_id,\s*\n\s*deletion_scope, removed_command_audit_count, idempotency_key/,
  );
  assert.doesNotMatch(auditBlock, /place|venue|address|location_desc|website|contact|organizer_note|status/i);
  assert.doesNotMatch(
    CODE,
    /RAISE EXCEPTION[^;]*%[^;]*(place_name|location_description|website|contact_name|contact_phone|organizer_note)/,
  );
});
