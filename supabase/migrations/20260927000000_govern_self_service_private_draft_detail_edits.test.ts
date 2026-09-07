import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20260927000000_govern_self_service_private_draft_detail_edits.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260927000000_govern_self_service_private_draft_detail_edits.sql", import.meta.url),
  ),
  "utf8",
);

const FN = SQL.slice(
  SQL.indexOf("CREATE OR REPLACE FUNCTION public.save_my_self_service_private_draft_details"),
  SQL.indexOf("$function$;"),
);

test("the save RPC is authenticated-only, SECURITY DEFINER, postgres-owned", () => {
  assert.match(FN, /SECURITY DEFINER\s*\nSET search_path TO 'pg_catalog'/);
  assert.match(
    SQL,
    /ALTER FUNCTION public\.save_my_self_service_private_draft_details\(\s*\n\s*uuid, text, date, date, text, text, text, text, text, date, date, text, text, text, text\s*\n\s*\) OWNER TO postgres/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.save_my_self_service_private_draft_details\([\s\S]*?\) FROM PUBLIC, anon, service_role/,
  );
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.save_my_self_service_private_draft_details\([\s\S]*?\) TO authenticated/,
  );
  assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*?TO (?:anon|service_role)/);
});

test("it requires an authenticated verified account, exactly like create/delete", () => {
  assert.match(FN, /v_actor uuid := auth\.uid\(\)/);
  assert.match(FN, /IF v_actor IS NULL THEN\s*\n\s*RAISE EXCEPTION 'Saving event details requires an authenticated verified account\.'/);
  assert.match(FN, /email_confirmed_at IS NOT NULL/);
  assert.match(FN, /nullif\(btrim\(u\.email\), ''\) IS NOT NULL/);
});

test("it authorizes on the organizer-owner rule -- NOT Event Admin authority", () => {
  assert.match(FN, /resolve_auth_person_link\(v_actor\)/);
  assert.match(FN, /IF v_link_status NOT IN \('resolved', 'no_link'\) THEN\s*\n\s*RAISE EXCEPTION 'Draft not found\.'/);
  assert.match(
    FN,
    /\(v_link_status = 'resolved' AND oa\.person_id = v_person_id\)\s*\n\s*OR \(v_link_status = 'no_link' AND oa\.auth_user_id = v_actor\)/,
  );
  // never touches admin authority or admin tables, and never reuses the guarded admin save
  assert.doesNotMatch(FN, /has_(?:platform|tenant|event)_admin_authority/);
  assert.doesNotMatch(FN, /admin_users|admin_event_access|admin_tenant_access|person_tenant_administrator_appointments/);
  assert.doesNotMatch(SQL, /admin_save_event_details_guarded/);
});

test("it is non-enumerating and only edits a hidden inactive non-visible Draft in an active private tenant", () => {
  assert.equal((FN.match(/RAISE EXCEPTION 'Draft not found\.'/g) ?? []).length, 3);
  assert.match(
    FN,
    /t\.is_active = true\s*\n\s*AND t\.is_self_service_private_draft = true\s*\n\s*AND e\.status = 'Draft'\s*\n\s*AND e\.is_active = false\s*\n\s*AND e\.visible_to_members = false/,
  );
});

test("it validates the same create-time field rules, verbatim", () => {
  for (const msg of [
    "Event name is required and must be 200 characters or fewer.",
    "A scheduled Event end date is required.",
    "Event end date cannot be before start date.",
    "A valid IANA Event timezone is required.",
    "Location mode must be location, online, or no_location.",
    "A location is required when location mode is location.",
    "Location text is allowed only when location mode is location.",
    "Location must be 500 characters or fewer.",
    "Starter template is not recognized.",
  ]) {
    assert.ok(FN.includes(`RAISE EXCEPTION '${msg}'`), `missing validation: ${msg}`);
  }
  assert.match(FN, /'casual', 'birthday_family', 'club_rv', 'conference_corporate', 'dinner', 'sports_activity'/);
});

test("it locks the rows, compares the caller baseline, and rejects a stale save writing NEITHER table", () => {
  assert.match(FN, /JOIN public\.events AS e ON e\.id = d\.event_id[\s\S]*?FOR UPDATE OF e/);
  assert.match(FN, /FROM public\.self_service_private_event_drafts AS d\s*\n\s*WHERE d\.event_id = p_event_id\s*\n\s*FOR UPDATE;/);
  assert.match(
    FN,
    /IF v_event\.name IS DISTINCT FROM p_expected_event_name\s*\n\s*OR v_event\.start_date IS DISTINCT FROM p_expected_start_date\s*\n\s*OR v_event\.end_date IS DISTINCT FROM p_expected_end_date\s*\n\s*OR v_event\.timezone IS DISTINCT FROM p_expected_timezone\s*\n\s*OR v_event\.location IS DISTINCT FROM p_expected_location\s*\n\s*OR v_draft\.location_mode IS DISTINCT FROM p_expected_location_mode\s*\n\s*OR v_draft\.starter_template IS DISTINCT FROM p_expected_starter_template\s*\n\s*THEN\s*\n\s*RAISE EXCEPTION 'stale_draft_details';/,
  );
  // the stale check sits BEFORE either UPDATE
  const stale = FN.indexOf("RAISE EXCEPTION 'stale_draft_details'");
  const firstUpdate = FN.indexOf("UPDATE public.events AS e\n  SET name");
  assert.ok(stale !== -1 && stale < firstUpdate, "stale check must precede any write");
});

test("it updates ONLY the permitted fields on ONLY the two permitted tables", () => {
  assert.match(
    FN,
    /UPDATE public\.events AS e\s*\n\s*SET name = v_event_name,\s*\n\s*start_date = p_start_date,\s*\n\s*end_date = p_end_date,\s*\n\s*timezone = v_timezone,\s*\n\s*location = v_location\s*\n\s*WHERE e\.id = p_event_id;/,
  );
  assert.match(
    FN,
    /UPDATE public\.self_service_private_event_drafts AS d\s*\n\s*SET location_mode = v_location_mode,\s*\n\s*starter_template = v_starter_template\s*\n\s*WHERE d\.event_id = p_event_id;/,
  );
  // only two UPDATE statements total, and neither sets a forbidden column
  const updateBlocks = FN.match(/UPDATE public\.[a-z_]+ AS [a-z]\s+SET[\s\S]*?WHERE [a-z]\.[a-z_]+ = p_event_id;/g) ?? [];
  assert.equal(updateBlocks.length, 2);
  for (const block of updateBlocks) {
    assert.doesNotMatch(block, /\b(status|is_active|visible_to_members|event_code|organization_name|organization_code|tenant_id)\b\s*=/);
  }
  assert.doesNotMatch(FN, /UPDATE public\.tenants/);
});

test("it returns the same safe draft shape the organizer UI already reads", () => {
  assert.match(
    FN,
    /RETURNS TABLE\(\s*\n\s*tenant_id uuid,\s*\n\s*organizer_appointment_id uuid,\s*\n\s*organizer_person_id uuid,\s*\n\s*event_id uuid,\s*\n\s*organization_name text,\s*\n\s*event_name text,\s*\n\s*start_date date,\s*\n\s*end_date date,\s*\n\s*timezone text,\s*\n\s*location_mode text,\s*\n\s*location text,\s*\n\s*starter_template text,\s*\n\s*status text,\s*\n\s*is_active boolean,\s*\n\s*visible_to_members boolean,\s*\n\s*created_at timestamptz\s*\n\s*\)/,
  );
  assert.match(FN, /RETURN QUERY\s*\n\s*SELECT\s*\n\s*t\.id,\s*\n\s*oa\.id,\s*\n\s*oa\.person_id,\s*\n\s*e\.id,/);
});

test("the migration is one transactional file that adds nothing else", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;\s*$/m);
  assert.doesNotMatch(SQL, /CREATE TABLE|DROP |CREATE POLICY|DROP POLICY|CREATE TRIGGER|ALTER TABLE/);
  const replaced = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(replaced, ["save_my_self_service_private_draft_details"]);
});
