import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261007000000_govern_self_service_private_draft_budget_plan.test.ts

const SQL = readFileSync(
  fileURLToPath(new URL("./20261007000000_govern_self_service_private_draft_budget_plan.sql", import.meta.url)),
  "utf8",
);
const P3G = readFileSync(
  fileURLToPath(new URL("./20261005000000_govern_self_service_private_draft_checklist.sql", import.meta.url)),
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

const AUTHZ = fn("_organizer_private_draft_budget_plan_authorize");
const SCALE = fn("_organizer_private_budget_currency_scale");
const VALIDATE = fn("_organizer_private_budget_line_validate");
const LIST = fn("list_my_private_draft_budget_lines");
const ADD = fn("add_my_private_draft_budget_line");
const UPDATE = fn("update_my_private_draft_budget_line");
const DELETE = fn("delete_my_private_draft_budget_line");
const DELETE_EVENT = fn("delete_self_service_organizer_event");

/** Only the P-3H functions this migration introduces -- NOT the carried-forward
 *  deletion path, which legitimately counts events and command-audit rows. */
const P3H_OWN = [AUTHZ, SCALE, VALIDATE, LIST, ADD, UPDATE, DELETE].join("\n");
const P3H_OWN_CODE = P3H_OWN.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

test("the migration adds exactly one dedicated table and restates a bounded set of functions", () => {
  assert.deepEqual(
    [...SQL.matchAll(/CREATE TABLE public\.([a-z_]+)/g)].map((m) => m[1]),
    ["self_service_private_draft_budget_lines"],
  );
  assert.deepEqual(
    [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/g)].map((m) => m[1]).sort(),
    [
      "_organizer_private_budget_currency_scale",
      "_organizer_private_budget_line_validate",
      "_organizer_private_draft_budget_plan_authorize",
      "add_my_private_draft_budget_line",
      "delete_my_private_draft_budget_line",
      "delete_self_service_organizer_event",
      "list_my_private_draft_budget_lines",
      "update_my_private_draft_budget_line",
    ],
  );
  // not a generic polymorphic planning table
  assert.doesNotMatch(CODE, /entity_type|planning_kind|record_type|polymorphic|subject_type/i);
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;\s*$/m);
});

test("ORGANIZER-ENTERED: the ONLY insert into the budget table is the organizer's own add", () => {
  const inserts = [...EXEC.matchAll(/INSERT INTO public\.self_service_private_draft_budget_lines/g)];
  assert.equal(inserts.length, 1, "exactly one INSERT exists in the whole migration");
  assert.ok(
    ADD.includes("INSERT INTO public.self_service_private_draft_budget_lines"),
    "and it lives inside add_my_private_draft_budget_line",
  );
  // nothing seeds, imports, suggests, benchmarks, or pre-fills an amount
  assert.doesNotMatch(EXEC, /seed|starter|template|suggest|recommend|benchmark|preset|sample|prefill|pre_fill/i);
  assert.doesNotMatch(EXEC, /INSERT INTO[\s\S]{0,200}?SELECT/i);
  assert.doesNotMatch(EXEC, /create_self_service_organizer_draft/);
});

test("NO AGGREGATION: no total, subtotal, sum, average, or count of budget rows anywhere", () => {
  assert.doesNotMatch(P3H_OWN_CODE, /\bsum\s*\(|\bavg\s*\(|\bcount\s*\(|\bmin\s*\(|\bmax\s*\(/i);
  assert.doesNotMatch(P3H_OWN_CODE, /total|subtotal|remaining|balance|aggregate|percent|ratio|running/i);
  assert.doesNotMatch(P3H_OWN_CODE, /GROUP BY|HAVING|OVER\s*\(|FILTER\s*\(/i);
  // no arithmetic combining the two amount columns or two rows
  assert.doesNotMatch(P3H_OWN_CODE, /estimated_amount\s*[-+*/]|actual_amount\s*[-+*/]/);
  assert.doesNotMatch(P3H_OWN_CODE, /actual_amount\s*[<>=]+\s*\w*estimated|estimated_amount\s*[<>=]+\s*\w*actual/i);
  // and the deletion path counts NO budget row
  assert.doesNotMatch(DELETE_EVENT, /count\s*\([^)]*budget|budget[_a-z]*count|INTO v_\w*budget/i);
});

test("NO CONVERSION: no exchange rate, price lookup, or cross-currency arithmetic", () => {
  assert.doesNotMatch(EXEC, /exchange|\brate\b|convert|conversion|fx_|forex|spot_price|price_lookup|market/i);
  assert.doesNotMatch(EXEC, /usd_to|btc_to|to_usd|to_btc|in_usd|in_btc|base_currency|common_currency/i);
  // no external reach of any kind could fetch a rate
  assert.doesNotMatch(
    EXEC,
    /\bhttp\s*\(|http_get|http_post|pg_net|net\.http|dblink|COPY[^;]*PROGRAM|CREATE EXTENSION|FOREIGN DATA WRAPPER|pg_read_file/i,
  );
  const langs = new Set([...SQL.matchAll(/^LANGUAGE (\w+)/gm)].map((m) => m[1]));
  assert.deepEqual([...langs].sort(), ["plpgsql"]);
  // the currency values are only ever compared for equality, never ordered or mapped to each other
  assert.doesNotMatch(P3H_OWN_CODE, /currency\s*(<|>|<=|>=)/);
});

test("NO COMMERCE: no payment, Passport, invoice, wallet, key, or credential surface", () => {
  assert.doesNotMatch(
    EXEC,
    /payment|passport|checkout|invoice|receipt|contract|\btax\b|reimburse|contribution|fundrais|purchase|order_id|refund/i,
  );
  assert.doesNotMatch(EXEC, /wallet|blockchain|on_chain|onchain|satoshi_address|private_key|public_key|seed_phrase|mnemonic|xpub|\baddress\b/i);
  assert.doesNotMatch(EXEC, /bank|card_number|iban|routing|credential|stripe|paypal|coinbase|merchant/i);
});

test("EXACT NUMERIC: amounts are numeric -- never float, double precision, real, or money", () => {
  assert.match(SQL, /^  estimated_amount numeric,$/m);
  assert.match(SQL, /^  actual_amount numeric,$/m);
  assert.doesNotMatch(EXEC, /float|double precision|\breal\b|\bmoney\b|::float|numeric\(\d/i);
});

test("CURRENCY: exactly two values, defaulting to USD, ONE currency column per line", () => {
  assert.match(SQL, /currency text NOT NULL DEFAULT 'USD'\s*\n\s*CHECK \(currency IN \('USD', 'BTC'\)\)/);
  // one currency column only -- so both amounts on a line necessarily share it
  const createTable = SQL.slice(
    SQL.indexOf("CREATE TABLE public.self_service_private_draft_budget_lines"),
    SQL.indexOf("ALTER TABLE public.self_service_private_draft_budget_lines OWNER"),
  );
  assert.equal(
    [...createTable.matchAll(/^\s*(\w*currency\w*) text/gm)].map((m) => m[1]).length,
    1,
    "exactly one currency column exists",
  );
  assert.doesNotMatch(createTable, /estimated_currency|actual_currency|currency_estimated|currency_actual/i);
  // no third currency, no free-text or organizer-defined currency list
  assert.doesNotMatch(CODE, /'EUR'|'GBP'|'JPY'|'CAD'|'ETH'|currency_list|allowed_currencies/i);
  // the RPC default is USD on both writers
  for (const body of [ADD, UPDATE]) {
    assert.match(body, /p_currency text DEFAULT 'USD'/);
    assert.match(body, /v_currency text := upper\(btrim\(coalesce\(nullif\(btrim\(p_currency\), ''\), 'USD'\)\)\)/);
  }
});

test("PRECISION: USD 2 / BTC 8, enforced identically by the CHECK and the helper", () => {
  // the executable helper
  assert.match(SCALE, /IF p_currency = 'USD' THEN\s*\n\s*RETURN 2;/);
  assert.match(SCALE, /ELSIF p_currency = 'BTC' THEN\s*\n\s*RETURN 8;/);
  assert.match(SCALE, /RAISE EXCEPTION 'A budget line must be in US dollars \(USD\) or Bitcoin \(BTC\)\.'/);
  // the table constraint carries its own copy of the same two numbers
  const constraint = SQL.slice(
    SQL.indexOf("CONSTRAINT self_service_private_draft_budget_lines_amounts_valid"),
    SQL.indexOf("ALTER TABLE public.self_service_private_draft_budget_lines OWNER"),
  );
  const cases = [...constraint.matchAll(/CASE currency WHEN 'BTC' THEN (\d+) ELSE (\d+) END/g)];
  assert.equal(cases.length, 2, "both amount columns carry the currency-scale rule");
  for (const c of cases) {
    assert.equal(c[1], "8", "BTC scale in the CHECK matches the helper");
    assert.equal(c[2], "2", "USD scale in the CHECK matches the helper");
  }
  assert.match(constraint, /scale\(estimated_amount\) <=/);
  assert.match(constraint, /scale\(actual_amount\) <=/);
});

test("EXCESS PRECISION IS REJECTED, NEVER SILENTLY ROUNDED", () => {
  // the test is `round(v, allowed) <> v` -> raise. Both amounts, both directions.
  const rejects = [...VALIDATE.matchAll(/IF round\(p_(estimated|actual)_amount, v_scale\) <> p_\1_amount THEN/g)];
  assert.equal(rejects.length, 2, "both amounts are precision-checked before anything is stored");
  assert.match(VALIDATE, /RAISE EXCEPTION 'A Bitcoin amount can have at most 8 decimal places\.'/);
  assert.match(VALIDATE, /RAISE EXCEPTION 'A US dollar amount can have at most 2 decimal places\.'/);
  // the writers validate BEFORE they round, so rounding can only pad zeros
  for (const body of [ADD, UPDATE]) {
    const validateAt = body.indexOf("_organizer_private_budget_line_validate");
    const roundAt = body.indexOf("round(p_estimated_amount, v_scale)");
    assert.ok(validateAt !== -1 && roundAt !== -1, "both steps are present");
    assert.ok(validateAt < roundAt, "validation refuses excess precision BEFORE any round() runs");
    // round() is applied only at the currency's own scale, never to a fixed 2
    assert.doesNotMatch(body, /round\([^)]*,\s*\d+\)/);
  }
});

test("NON-NEGATIVE amounts, in either currency, in both the CHECK and the validator", () => {
  const negatives = [...VALIDATE.matchAll(/IF p_(estimated|actual)_amount < 0 THEN/g)];
  assert.equal(negatives.length, 2);
  assert.equal([...VALIDATE.matchAll(/RAISE EXCEPTION 'A budget amount cannot be negative\.'/g)].length, 2);
  assert.match(SQL, /estimated_amount >= 0/);
  assert.match(SQL, /actual_amount >= 0/);
});

test("NO SIBLING LINKAGE: the budget functions never read vendor, venue, registry, checklist, or catalog rows", () => {
  assert.doesNotMatch(
    P3H_OWN,
    /vendor_plans|venue_plans|registry_plans|checklist_items|planned_guests|agenda_items|event_agenda_state/,
  );
  const ownNoSearchPath = P3H_OWN.replace(/pg_catalog/g, "");
  assert.doesNotMatch(ownNoSearchPath, /catalog|planning_catalog|catalog_asset_id/i);
  assert.doesNotMatch(P3H_OWN_CODE, /\bpublic\.vendors\b|\bevent_vendors\b|candidac|admission|disposition/i);
  // the sibling tables appear ONLY in the carried-forward deletion cleanups
  for (const t of [
    "self_service_private_draft_vendor_plans",
    "self_service_private_draft_venue_plans",
    "self_service_private_draft_registry_plans",
    "self_service_private_draft_checklist_items",
  ]) {
    assert.equal(
      [...EXEC.matchAll(new RegExp(t, "g"))].length, 1,
      `${t} appears exactly once -- its carried-forward deletion cleanup`,
    );
  }
});

test("NO identity, invitation, notification, readiness, or event-state write", () => {
  assert.doesNotMatch(
    P3H_OWN_CODE,
    /\b(people|person_identifiers|person_auth_accounts|attendees|activity_registrations|member_checkin_audit)\b/,
  );
  assert.doesNotMatch(CODE, /invitation|notification|email_queue|resend|\bnotify\b|announcements/i);
  assert.doesNotMatch(CODE, /readiness|affordab|\bunder budget\b|\bover budget\b|\bwarn/i);
  assert.doesNotMatch(P3H_OWN_CODE, /UPDATE public\.events|INSERT INTO public\.events/);
  assert.doesNotMatch(P3H_OWN_CODE, /UPDATE public\.self_service_private_event_drafts/);
  const writes = [...P3H_OWN_CODE.matchAll(/(UPDATE|INSERT INTO)\s+public\.\w+[\s\S]*?;/g)].map((m) => m[0]);
  for (const w of writes) {
    assert.doesNotMatch(
      w, /\bstatus\s*=|is_active\s*=|visible_to_members\s*=|location_mode\s*=/,
      "no write in this migration assigns event status / activity / visibility / location mode",
    );
  }
  assert.doesNotMatch(P3H_OWN_CODE, /has_event_task_authority|has_tenant_admin_authority|has_vendor_catalog_admin_authority/);
  assert.doesNotMatch(CODE, /_ledger_log|resolution_audit|CREATE TRIGGER|CREATE TABLE public\.\w*(ledger|audit)/);
});

test("the budget table is event-owned, RLS-on, and closed to every browser role", () => {
  assert.match(SQL, /event_id uuid NOT NULL REFERENCES public\.events\(id\) ON DELETE RESTRICT/);
  assert.match(SQL, /line_name text NOT NULL\s*\n\s*CHECK \(btrim\(line_name\) <> '' AND length\(line_name\) <= 200\)/);
  assert.match(SQL, /ALTER TABLE public\.self_service_private_draft_budget_lines ENABLE ROW LEVEL SECURITY/);
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.self_service_private_draft_budget_lines\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(CODE, /CREATE POLICY/);
});

test("the table holds exactly the approved columns -- no status, no ordering, no due date, no paid flag", () => {
  const createTable = SQL.slice(
    SQL.indexOf("CREATE TABLE public.self_service_private_draft_budget_lines"),
    SQL.indexOf("ALTER TABLE public.self_service_private_draft_budget_lines OWNER"),
  );
  const cols = [...createTable.matchAll(/^  (\w+) (uuid|text|numeric|timestamptz)/gm)].map((m) => m[1]);
  assert.deepEqual(cols, [
    "id", "event_id", "line_name", "category", "currency",
    "estimated_amount", "actual_amount", "organizer_note", "created_at", "updated_at",
  ]);
  assert.doesNotMatch(createTable, /planning_status|is_paid|paid_at|due_date|payment_date|attachment|receipt_url/i);
  assert.doesNotMatch(CODE, /sort_order|\bposition\b|\brank\b|display_order|reorder/i);
  assert.match(SQL, /ORDER BY bl\.created_at, bl\.id/);
  assert.doesNotMatch(CODE, /assignee|assigned_to|shared_with|delegat|collaborat|export/i);
});

test("the owner predicate is byte-identical to the P-3G checklist predicate apart from name and messages", () => {
  const checklistAuthz = fnFrom(P3G, "_organizer_private_draft_checklist_authorize");
  const norm = (b: string) =>
    b
      .replace(/_organizer_private_draft_(budget_plan|checklist)_authorize/g, "AUTHZ")
      .replace(/Editing a (budget plan|planning checklist) requires/g, "Editing X requires");
  assert.equal(norm(AUTHZ), norm(checklistAuthz));
  assert.doesNotMatch(AUTHZ, /has_event_task_authority/);
});

test("every budget RPC re-runs the full authorization first and is non-enumerating", () => {
  for (const body of [LIST, ADD, UPDATE, DELETE]) {
    assert.match(body, /PERFORM public\._organizer_private_draft_budget_plan_authorize\(p_event_id\)/);
  }
  for (const body of [UPDATE, DELETE]) {
    assert.match(body, /WHERE bl\.id = p_budget_line_id AND bl\.event_id = p_event_id/);
    assert.match(body, /RAISE EXCEPTION 'Budget line not found\.'/);
  }
});

test("name required; category/amounts/note optional; nothing is parsed or priced", () => {
  assert.match(VALIDATE, /p_line_name IS NULL OR btrim\(p_line_name\) = '' OR length\(btrim\(p_line_name\)\) > 200/);
  assert.doesNotMatch(VALIDATE, /~|\bLIKE\b|SIMILAR TO|regexp/i);
  assert.doesNotMatch(P3H_OWN_CODE, /split_part|regexp_|substring\s*\(|strpos|to_tsvector|tsquery/i);
  for (const body of [ADD, UPDATE]) {
    assert.match(body, /v_category text := nullif\(btrim\(p_category\), ''\)/);
    assert.match(body, /v_note text := nullif\(btrim\(p_organizer_note\), ''\)/);
  }
  const setStart = UPDATE.indexOf("SET line_name = v_name");
  const updateSet = UPDATE.slice(setStart, UPDATE.indexOf("\n  WHERE bl.id", setStart));
  assert.match(
    updateSet,
    /line_name = v_name,\s*\n\s*category = v_category,\s*\n\s*currency = v_currency,\s*\n\s*estimated_amount = v_estimated,\s*\n\s*actual_amount = v_actual,\s*\n\s*organizer_note = v_note,\s*\n\s*updated_at = now\(\)/,
  );
  assert.doesNotMatch(updateSet, /\bevent_id\s*=|\bcreated_at\s*=/);
});

test("the list RPC returns rows only, with each amount as exact text beside its own currency", () => {
  const returns = LIST.slice(LIST.indexOf("RETURNS TABLE("), LIST.indexOf(")\nLANGUAGE"));
  const cols = [...returns.matchAll(/\n  (\w+) (uuid|text|timestamptz)/g)].map((m) => m[1]);
  assert.deepEqual(cols, [
    "id", "line_name", "category", "currency", "estimated_amount", "actual_amount",
    "organizer_note", "created_at", "updated_at",
  ]);
  // amounts leave as exact decimal text -- no double ever holds them in a browser
  for (const body of [LIST, ADD, UPDATE]) {
    assert.match(body, /estimated_amount::text/);
    assert.match(body, /actual_amount::text/);
  }
  assert.doesNotMatch(LIST, /count\s*\(|sum\s*\(|total|remaining|percent/i);
});

test("no error message anywhere echoes an amount, a name, a category, or a note", () => {
  const raises = [...CODE.matchAll(/RAISE EXCEPTION '[^']*'[^;]*/g)].map((m) => m[0]);
  for (const r of raises) {
    assert.doesNotMatch(
      r,
      /p_estimated_amount|p_actual_amount|p_line_name|p_category|p_organizer_note|v_estimated|v_actual|v_name|v_category|v_note/,
      `error must state the rule, not the organizer's content: ${r}`,
    );
  }
});

test("all budget RPCs are postgres-owned and authenticated-only; internals granted to nobody", () => {
  for (const sig of [
    "list_my_private_draft_budget_lines\\(uuid\\)",
    "add_my_private_draft_budget_line\\(uuid, text, text, text, numeric, numeric, text\\)",
    "update_my_private_draft_budget_line\\(uuid, uuid, text, text, text, numeric, numeric, text\\)",
    "delete_my_private_draft_budget_line\\(uuid, uuid\\)",
  ]) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${sig} OWNER TO postgres`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon, service_role`));
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated`));
  }
  for (const internal of [
    "_organizer_private_draft_budget_plan_authorize\\(uuid\\)",
    "_organizer_private_budget_currency_scale\\(text\\)",
    "_organizer_private_budget_line_validate\\(text, text, text, numeric, numeric, text\\)",
  ]) {
    assert.match(
      SQL,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${internal}\\s*\\n\\s*FROM PUBLIC, anon, authenticated, service_role`),
    );
  }
  assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*?TO (?:anon|service_role)/);
});

test("delete_self_service_organizer_event removes budget rows in the CORRECT position", () => {
  const at = (n: string) => DELETE_EVENT.indexOf(n);
  const seq = [
    at("DELETE FROM public.self_service_private_draft_planned_guests AS plg"),
    at("DELETE FROM public.self_service_private_draft_vendor_plans AS svp"),
    at("DELETE FROM public.self_service_private_draft_venue_plans AS svnp"),
    at("DELETE FROM public.self_service_private_draft_registry_plans AS srp"),
    at("DELETE FROM public.self_service_private_draft_checklist_items AS sci"),
    at("DELETE FROM public.self_service_private_draft_budget_lines AS sbl"),
    at("FOR v_dep IN"),
    at("DELETE FROM public.events AS e"),
  ];
  assert.ok(seq.every((v) => v !== -1), "every expected cleanup block is present");
  assert.deepEqual(seq, seq.slice().sort((a, b) => a - b),
    "guests < vendors < venues < registries < checklist < budget < scan < event delete");
  assert.match(
    DELETE_EVENT,
    /DELETE FROM public\.self_service_private_draft_budget_lines AS sbl\s*\n\s*WHERE sbl\.event_id = p_event_id;/,
  );
  assert.match(DELETE_EVENT, /PERFORM set_config\('app\.self_service_governed_deletion', 'on', true\)/);
  assert.match(DELETE_EVENT, /FROM pg_constraint AS con[\s\S]*?con\.confrelid = 'public\.events'::regclass/);
  assert.match(DELETE_EVENT, /IF v_scope = 'event_and_empty_workspace' THEN[\s\S]*?DELETE FROM public\.tenants/);
  // the new table is NOT added to the scan's exclusion list -- it is cleaned, then proven empty
  assert.doesNotMatch(DELETE_EVENT, /budget_lines'::regclass/);
  assert.doesNotMatch(SQL, /ALTER FUNCTION public\.delete_self_service_organizer_event|GRANT EXECUTE ON FUNCTION public\.delete_self_service_organizer_event/);
});

test("delete_self_service_organizer_event is otherwise carried forward VERBATIM from P-3G", () => {
  const previous = fnFrom(P3G, "delete_self_service_organizer_event");
  const stripped = DELETE_EVENT.replace(
    /\n  -- P-3H organizer private budget-plan cleanup:[\s\S]*?WHERE sbl\.event_id = p_event_id;\n/,
    "",
  );
  assert.equal(stripped, previous,
    "every P-2D..P-3G line of the deletion path must be byte-identical to 20261005000000");
});

test("the deletion audit gains NO budget content, NO LINE COUNT, and NO TOTAL", () => {
  const block = DELETE_EVENT.slice(
    DELETE_EVENT.indexOf("DELETE FROM public.self_service_private_draft_budget_lines AS sbl") - 600,
    DELETE_EVENT.indexOf("FOR v_dep IN"),
  );
  assert.doesNotMatch(block, /count\s*\(|sum\s*\(|INTO v_\w*budget|budget_count|budget_total/i);
  const ai = DELETE_EVENT.indexOf("INSERT INTO public.self_service_event_deletion_audit");
  const auditBlock = DELETE_EVENT.slice(ai, DELETE_EVENT.indexOf("RETURNING * INTO v_audit"));
  assert.match(
    auditBlock,
    /organizer_person_id, actor_auth_user_id, deleted_event_id, deleted_tenant_id,\s*\n\s*deletion_scope, removed_command_audit_count, idempotency_key/,
  );
  assert.doesNotMatch(auditBlock, /budget|amount|currency|line_name|category|estimated|actual/i);
  assert.doesNotMatch(
    CODE,
    /RAISE EXCEPTION[^;]*%[^;]*(line_name|category|currency|estimated_amount|actual_amount|organizer_note)/,
  );
});
