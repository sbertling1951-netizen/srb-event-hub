import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261002000000_add_private_draft_vendor_plan_contact_fields.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20261002000000_add_private_draft_vendor_plan_contact_fields.sql", import.meta.url),
  ),
  "utf8",
);

const PRIOR = readFileSync(
  fileURLToPath(
    new URL("./20261001000000_govern_self_service_private_draft_vendor_plan.sql", import.meta.url),
  ),
  "utf8",
);

/** The migration SQL with `-- …` line comments stripped. */
const CODE = SQL.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");

function fnFrom(source: string, name: string, keyword = "CREATE FUNCTION") {
  const start = source.indexOf(`${keyword} public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = source.indexOf("$function$;", start);
  return source.slice(start, end);
}

const VALIDATE = fnFrom(SQL, "_organizer_private_vendor_plan_validate");
const LIST = fnFrom(SQL, "list_my_private_draft_vendor_plans");
const ADD = fnFrom(SQL, "add_my_private_draft_vendor_plan");
const UPDATE = fnFrom(SQL, "update_my_private_draft_vendor_plan");
const MUTATIONS = [ADD, UPDATE];

test("the migration adds two nullable columns and creates no table", () => {
  assert.doesNotMatch(SQL, /CREATE TABLE/);
  assert.match(
    SQL,
    /ALTER TABLE public\.self_service_private_draft_vendor_plans\s*\n\s*ADD COLUMN contact_name text/,
  );
  assert.match(SQL, /ADD COLUMN contact_phone text/);
  assert.match(SQL, /CHECK \(contact_name IS NULL OR \(btrim\(contact_name\) <> '' AND length\(contact_name\) <= 200\)\)/);
  assert.match(SQL, /CHECK \(contact_phone IS NULL OR \(btrim\(contact_phone\) <> '' AND length\(contact_phone\) <= 50\)\)/);
  // both are nullable: no NOT NULL, no DEFAULT, so existing rows are untouched
  assert.doesNotMatch(SQL, /ADD COLUMN contact_(name|phone) text[^;]*NOT NULL/);
  assert.doesNotMatch(SQL, /ADD COLUMN contact_(name|phone) text[^;]*DEFAULT/);
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;\s*$/m);
});

test("existing contact_detail is never changed, parsed, backfilled, or dropped", () => {
  // The ONLY UPDATE in the file is the edit RPC's own single-row write. There
  // is no bulk/backfill UPDATE, and nothing derives the new columns from the
  // legacy one.
  const updates = [...CODE.matchAll(/UPDATE public\.self_service_private_draft_vendor_plans/g)];
  assert.equal(updates.length, 1, "exactly one UPDATE statement exists in the migration");
  assert.ok(
    UPDATE.includes("UPDATE public.self_service_private_draft_vendor_plans"),
    "and it lives inside update_my_private_draft_vendor_plan",
  );
  assert.match(UPDATE, /WHERE vp\.id = p_vendor_plan_id AND vp\.event_id = p_event_id/);
  // no new column is ever populated FROM the legacy column
  assert.doesNotMatch(CODE, /contact_(name|phone)\s*=\s*[^;]*contact_detail/);
  assert.doesNotMatch(CODE, /contact_detail\s*=\s*[^;,]*contact_(name|phone)/);
  assert.doesNotMatch(CODE, /DROP COLUMN|ALTER COLUMN|RENAME COLUMN/);
  // no parsing / splitting / guessing at the legacy free text
  assert.doesNotMatch(CODE, /split_part|regexp_|substring\s*\(|position\s*\(|strpos|\bLIKE\b|~\*|SIMILAR TO/i);
  // the column keeps its place in the row and in every result
  assert.match(SQL, /COMMENT ON COLUMN public\.self_service_private_draft_vendor_plans\.contact_detail IS/);
  assert.match(SQL, /LEGACY, pre-20261002000000 free-text contact field/);
});

test("COMPATIBILITY: the new parameters are appended LAST and both default NULL", () => {
  for (const body of MUTATIONS) {
    // the two new params come after every pre-existing one
    const nameAt = body.indexOf("p_contact_name text DEFAULT NULL");
    const phoneAt = body.indexOf("p_contact_phone text DEFAULT NULL");
    const noteAt = body.indexOf("p_organizer_note text DEFAULT NULL");
    const detailAt = body.indexOf("p_contact_detail text DEFAULT NULL");
    assert.ok(nameAt !== -1 && phoneAt !== -1, "both new params are declared with DEFAULT NULL");
    assert.ok(detailAt !== -1, "p_contact_detail is retained as a parameter");
    assert.ok(noteAt < nameAt && nameAt < phoneAt, "the new params are appended after every existing one");
  }
  // every pre-existing parameter keeps its exact name, type, and default
  for (const decl of [
    "p_event_id uuid",
    "p_vendor_name text",
    "p_service_category text DEFAULT NULL",
    "p_planning_status text DEFAULT 'considering'",
    "p_website text DEFAULT NULL",
    "p_contact_detail text DEFAULT NULL",
    "p_organizer_note text DEFAULT NULL",
  ]) {
    assert.ok(ADD.includes(decl), `add keeps the pre-existing parameter: ${decl}`);
  }
  assert.ok(UPDATE.includes("p_vendor_plan_id uuid"), "update keeps p_vendor_plan_id");
});

test("COMPATIBILITY: the functions are DROPped before creation, so no ambiguous overload exists", () => {
  // dropping the OLD exact signatures
  assert.match(SQL, /DROP FUNCTION IF EXISTS public\.list_my_private_draft_vendor_plans\(uuid\);/);
  assert.match(
    SQL,
    /DROP FUNCTION IF EXISTS public\.add_my_private_draft_vendor_plan\(uuid, text, text, text, text, text, text\);/,
  );
  assert.match(
    SQL,
    /DROP FUNCTION IF EXISTS public\.update_my_private_draft_vendor_plan\(uuid, uuid, text, text, text, text, text, text\);/,
  );
  assert.match(
    SQL,
    /DROP FUNCTION IF EXISTS public\._organizer_private_vendor_plan_validate\(text, text, text, text, text, text\);/,
  );
  // each dropped function is recreated exactly once, as a plain CREATE
  for (const name of [
    "list_my_private_draft_vendor_plans",
    "add_my_private_draft_vendor_plan",
    "update_my_private_draft_vendor_plan",
    "_organizer_private_vendor_plan_validate",
  ]) {
    assert.equal(
      (SQL.match(new RegExp(`CREATE FUNCTION public\\.${name}\\b`, "g")) ?? []).length,
      1,
      `${name} is created exactly once`,
    );
    assert.equal(
      (SQL.match(new RegExp(`DROP FUNCTION IF EXISTS public\\.${name}\\b`, "g")) ?? []).length,
      1,
      `${name} is dropped exactly once`,
    );
  }
  // CREATE OR REPLACE is deliberately NOT used -- it cannot change a return
  // type or argument list and would leave a second, ambiguous overload behind
  assert.doesNotMatch(SQL, /CREATE OR REPLACE FUNCTION/);
});

test("COMPATIBILITY: the new result columns are appended last, so old row parsers still work", () => {
  for (const body of [LIST, ADD, UPDATE]) {
    const returns = body.slice(body.indexOf("RETURNS TABLE("), body.indexOf(")\nLANGUAGE"));
    // every pre-existing output column is still present, in its original order
    const order = [
      "id uuid",
      "vendor_name text",
      "service_category text",
      "planning_status text",
      "website text",
      "contact_detail text",
      "organizer_note text",
      "created_at timestamptz",
      "updated_at timestamptz",
      "contact_name text",
      "contact_phone text",
    ];
    let cursor = -1;
    for (const col of order) {
      const at = returns.indexOf(col);
      assert.ok(at > cursor, `${col} appears in order in the result of this function`);
      cursor = at;
    }
  }
});

test("COMPATIBILITY: delete_my_private_draft_vendor_plan and the deletion path are untouched", () => {
  // the delete RPC needs no change and must not be redefined
  assert.doesNotMatch(SQL, /FUNCTION public\.delete_my_private_draft_vendor_plan/);
  // this migration adds no child table, so the governed event-deletion path is
  // deliberately NOT restated. (The name appears in the header comment saying
  // exactly that, so this asserts against comment-stripped CODE.)
  assert.doesNotMatch(CODE, /delete_self_service_organizer_event/);
  assert.doesNotMatch(CODE, /self_service_event_deletion_audit|self_service_governed_deletion|pg_constraint/);
});

test("the authorization rule is unchanged and still gates every RPC", () => {
  // the predicate itself is not redefined here
  assert.doesNotMatch(SQL, /FUNCTION public\._organizer_private_draft_vendor_plan_authorize\(/);
  for (const body of [LIST, ADD, UPDATE]) {
    assert.match(body, /PERFORM public\._organizer_private_draft_vendor_plan_authorize\(p_event_id\)/);
  }
  assert.doesNotMatch(CODE, /has_event_task_authority|has_tenant_admin_authority|has_vendor_catalog_admin_authority/);
});

test("contact name and phone are opaque -- length-bounded only, never matched or normalized", () => {
  assert.match(VALIDATE, /p_contact_name IS NOT NULL AND length\(p_contact_name\) > 200/);
  assert.match(VALIDATE, /p_contact_phone IS NOT NULL AND length\(p_contact_phone\) > 50/);
  // no format check, no rewriting, no lookup
  assert.doesNotMatch(VALIDATE, /~|LIKE|SIMILAR TO|regexp/i);
  for (const body of MUTATIONS) {
    assert.match(body, /v_contact_name text := nullif\(btrim\(p_contact_name\), ''\)/);
    assert.match(body, /v_contact_phone text := nullif\(btrim\(p_contact_phone\), ''\)/);
    // btrim is the ONLY transformation applied to either value
    assert.doesNotMatch(body, /(lower|upper|translate|replace|regexp_replace)\s*\(\s*p_contact_(name|phone)/);
  }
  // no index is built over the new fields
  assert.doesNotMatch(CODE, /CREATE INDEX/);
});

test("the migration touches NO vendor catalog / admission / identity / payment surface", () => {
  assert.doesNotMatch(CODE, /\bpublic\.vendors\b|\bevent_vendors\b|\bvendor_contacts\b|\bvendor_org_access\b/);
  assert.doesNotMatch(CODE, /vendor_invitation|vendor_candidac|vendor_admission|disposition|vendor_access|vendor_token|vendor_workspace/i);
  assert.doesNotMatch(
    CODE,
    /\b(people|person_identifiers|person_auth_accounts|person_role_instances|person_event_participations|attendees|activity_registrations|member_checkin_audit)\b/,
  );
  assert.doesNotMatch(CODE, /invitation|registration|notification|resend|email_queue|\bnotify\b|\bpublish/i);
  // still no catalog reference and still no financial field
  assert.doesNotMatch(CODE, /catalog_asset_id|planning_catalog/i);
  assert.doesNotMatch(CODE, /\bcost\b|\bquote\b|\bcurrency\b|\bbudget\b|\bprice\b|\busd\b/i);
});

test("ownership and the authenticated-only ACL are restated for every recreated function", () => {
  for (const sig of [
    "list_my_private_draft_vendor_plans\\(uuid\\)",
    "add_my_private_draft_vendor_plan\\(uuid, text, text, text, text, text, text, text, text\\)",
    "update_my_private_draft_vendor_plan\\(uuid, uuid, text, text, text, text, text, text, text, text\\)",
  ]) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${sig} OWNER TO postgres`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon, service_role`));
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated`));
  }
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\._organizer_private_vendor_plan_validate\(text, text, text, text, text, text, text, text\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*?TO (?:anon|service_role)/);
});

test("the status rule and the required vendor name carry forward from 20261001000000", () => {
  const priorValidate = PRIOR.slice(
    PRIOR.indexOf("CREATE OR REPLACE FUNCTION public._organizer_private_vendor_plan_validate"),
  );
  for (const rule of [
    "A vendor plan entry needs a name of 200 characters or fewer.",
    "A vendor plan status must be considering, contacted, or selected.",
    "A vendor plan category must be 120 characters or fewer.",
    "A vendor plan website must be 500 characters or fewer.",
    "A vendor plan note must be 2000 characters or fewer.",
  ]) {
    assert.ok(priorValidate.includes(rule), `precondition: 20261001000000 had "${rule}"`);
    assert.ok(VALIDATE.includes(rule), `carried forward: "${rule}"`);
  }
  for (const body of MUTATIONS) {
    assert.match(body, /v_status text := coalesce\(btrim\(p_planning_status\), 'considering'\)/);
  }
});

test("no planner-entered value reaches an audit row or a raised error", () => {
  assert.doesNotMatch(
    CODE,
    /RAISE EXCEPTION[^;]*%[^;]*(vendor_name|service_category|website|contact_detail|contact_name|contact_phone|organizer_note)/,
  );
  assert.doesNotMatch(CODE, /INSERT INTO public\.\w*audit/);
});
