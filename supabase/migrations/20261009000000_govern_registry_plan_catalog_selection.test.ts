import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261009000000_govern_registry_plan_catalog_selection.test.ts

const SQL = readFileSync(
  fileURLToPath(new URL("./20261009000000_govern_registry_plan_catalog_selection.sql", import.meta.url)),
  "utf8",
);
const P1 = readFileSync(
  fileURLToPath(new URL("./20261008000000_govern_registry_provider_catalog_foundation.sql", import.meta.url)),
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

const AUTHZ = fn("_organizer_private_draft_registry_catalog_authorize");
const SEARCH = fn("search_my_private_draft_registry_provider_catalog");
const ATTACH = fn("attach_my_private_draft_registry_plan_catalog_selection");
const DETACH = fn("detach_my_private_draft_registry_plan_catalog_selection");
const LIST_CATALOG = fn("list_my_private_draft_registry_plans_with_catalog");
const ALL_RPCS = [SEARCH, ATTACH, DETACH, LIST_CATALOG];
const ALL_FUNCTIONS = [AUTHZ, ...ALL_RPCS].join("\n");

test("the migration creates exactly one new table, restates NO Catalog P1 object, and adds a bounded set of functions", () => {
  assert.deepEqual(
    [...SQL.matchAll(/CREATE TABLE public\.([a-z_]+)/g)].map((m) => m[1]),
    ["registry_plan_catalog_selection_audit"],
  );
  assert.deepEqual(
    [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/g)].map((m) => m[1]).sort(),
    [
      "_organizer_private_draft_registry_catalog_authorize",
      "attach_my_private_draft_registry_plan_catalog_selection",
      "detach_my_private_draft_registry_plan_catalog_selection",
      "list_my_private_draft_registry_plans_with_catalog",
      "prevent_registry_plan_catalog_selection_audit_mutation",
      "search_my_private_draft_registry_provider_catalog",
    ],
  );
  // none of the four Catalog P1 objects (table, functions) appear anywhere
  for (const p1Object of [
    "registry_provider_catalog_assets", "registry_provider_catalog_curation_audit",
    "list_registry_provider_catalog_assets_for_platform_admin", "create_registry_provider_catalog_asset",
    "update_registry_provider_catalog_asset", "set_registry_provider_catalog_asset_active_status",
  ]) {
    assert.doesNotMatch(CODE, new RegExp(`CREATE (TABLE|OR REPLACE FUNCTION) public\\.${p1Object}\\b`));
  }
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;\s*$/m);
});

test("P1 UNTOUCHED: this migration's SQL text never redefines any P1 object, and P1's own file is byte-identical to what P1 shipped", () => {
  // sanity: P1's own migration still defines exactly its four RPCs + table
  assert.match(P1, /CREATE TABLE public\.registry_provider_catalog_assets/);
  assert.match(P1, /CREATE OR REPLACE FUNCTION public\.list_registry_provider_catalog_assets_for_platform_admin/);
  // this migration performs no seeding call and no write of any kind against
  // the P1 asset or audit tables
  assert.doesNotMatch(EXEC, /INSERT INTO public\.registry_provider_catalog_assets/);
  assert.doesNotMatch(EXEC, /INSERT INTO public\.registry_provider_catalog_curation_audit/);
  assert.doesNotMatch(EXEC, /UPDATE public\.registry_provider_catalog_assets\s+SET/);
  assert.doesNotMatch(EXEC, /DELETE FROM public\.registry_provider_catalog_assets/);
});

test("NO SIBLING SURFACE TOUCHED: no reference to vendors, event_vendors, Nearby, maps, tenant curation, or public discovery", () => {
  assert.doesNotMatch(EXEC, /\bpublic\.vendors\b|\bevent_vendors\b|nearby_|master_map|parking_sites/i);
  assert.doesNotMatch(EXEC, /admin_task_registry/);
  assert.doesNotMatch(EXEC, /has_tenant_admin_authority|has_event_task_authority|has_vendor_catalog_admin_authority|has_event_admin_authority/);
});

test("ORDINARY REGISTRY PLAN RPCs ARE NOT RESTATED: list/add/update/delete do not appear as CREATE OR REPLACE in this file", () => {
  for (const untouched of [
    "list_my_private_draft_registry_plans\\(",
    "add_my_private_draft_registry_plan\\(",
    "update_my_private_draft_registry_plan\\(",
    "delete_my_private_draft_registry_plan\\(",
  ]) {
    assert.doesNotMatch(SQL, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${untouched}`));
  }
  // and delete_self_service_organizer_event is not restated either -- no new
  // table in this migration carries a foreign key to public.events
  assert.doesNotMatch(SQL, /CREATE OR REPLACE FUNCTION public\.delete_self_service_organizer_event/);
  assert.doesNotMatch(EXEC, /REFERENCES public\.events\(/);
});

test("SCHEMA: exactly four new nullable columns, restrictive FK, and the all-null-or-all-present constraint", () => {
  const alterBlock = SQL.slice(
    SQL.indexOf("ALTER TABLE public.self_service_private_draft_registry_plans\n  ADD COLUMN"),
    SQL.indexOf("COMMENT ON COLUMN public.self_service_private_draft_registry_plans.catalog_asset_id"),
  );
  assert.match(alterBlock, /ADD COLUMN catalog_asset_id uuid\s*\n\s*REFERENCES public\.registry_provider_catalog_assets\(id\) ON DELETE RESTRICT,/);
  assert.doesNotMatch(alterBlock, /ON DELETE CASCADE|ON DELETE SET NULL/);
  assert.match(alterBlock, /ADD COLUMN catalog_provider_name_snapshot text/);
  assert.match(alterBlock, /ADD COLUMN catalog_description_snapshot text/);
  assert.match(alterBlock, /ADD COLUMN catalog_website_snapshot text/);

  assert.match(
    SQL,
    /CONSTRAINT self_service_private_draft_registry_plans_catalog_snapshot_complete\s*\n\s*CHECK \(/,
  );
  const constraintBlock = SQL.slice(
    SQL.indexOf("CONSTRAINT self_service_private_draft_registry_plans_catalog_snapshot_complete"),
    SQL.indexOf("CREATE INDEX self_service_private_draft_registry_plans_catalog_asset_idx"),
  );
  assert.match(constraintBlock, /catalog_asset_id IS NULL\s*\n\s*AND catalog_provider_name_snapshot IS NULL\s*\n\s*AND catalog_description_snapshot IS NULL\s*\n\s*AND catalog_website_snapshot IS NULL/);
  assert.match(constraintBlock, /catalog_asset_id IS NOT NULL\s*\n\s*AND catalog_provider_name_snapshot IS NOT NULL\s*\n\s*AND catalog_description_snapshot IS NOT NULL\s*\n\s*AND catalog_website_snapshot IS NOT NULL/);
  // no third/partial state -- only two disjuncts exist
  assert.equal([...constraintBlock.matchAll(/catalog_asset_id IS (NOT )?NULL/g)].length, 2);
});

test("AUDIT SCHEMA: exactly the approved content-free columns, no catalog_asset_id, no FK to events or the plan row", () => {
  const createTable = SQL.slice(
    SQL.indexOf("CREATE TABLE public.registry_plan_catalog_selection_audit"),
    SQL.indexOf("ALTER TABLE public.registry_plan_catalog_selection_audit OWNER"),
  );
  const cols = [...createTable.matchAll(/^  (\w+) (uuid|text|timestamptz)/gm)].map((m) => m[1]);
  assert.deepEqual(cols, [
    "id", "event_id", "registry_plan_id", "organizer_person_id", "actor_auth_user_id", "action", "occurred_at",
  ]);
  assert.doesNotMatch(createTable, /catalog_asset_id|provider_name|short_description|public_website|registry_url|organizer_note|planning_status|search_quer|jsonb/i);
  // event_id and registry_plan_id are bare -- no REFERENCES on either
  assert.doesNotMatch(createTable, /event_id uuid NOT NULL\s*\n\s*REFERENCES|registry_plan_id uuid NOT NULL\s*\n\s*REFERENCES/);
  assert.match(createTable, /organizer_person_id uuid NOT NULL REFERENCES public\.people\(id\)/);
  assert.match(createTable, /actor_auth_user_id uuid NOT NULL REFERENCES auth\.users\(id\)/);
  assert.match(createTable, /action text NOT NULL CHECK \(action IN \('attached', 'replaced', 'detached'\)\)/);
});

test("AUDIT IS APPEND-ONLY, RLS-CLOSED, AND HAS NO READ RPC", () => {
  assert.match(
    SQL,
    /CREATE TRIGGER prevent_registry_plan_catalog_selection_audit_mutation_trigger\s*\nBEFORE UPDATE OR DELETE ON public\.registry_plan_catalog_selection_audit/,
  );
  assert.match(
    fn("prevent_registry_plan_catalog_selection_audit_mutation"),
    /RAISE EXCEPTION 'registry_plan_catalog_selection_audit is immutable';/,
  );
  assert.match(SQL, /ALTER TABLE public\.registry_plan_catalog_selection_audit ENABLE ROW LEVEL SECURITY;/);
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.registry_plan_catalog_selection_audit\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.doesNotMatch(CODE, /CREATE POLICY/);
  // no function anywhere in this migration SELECTs from the audit table --
  // no Platform-Admin or browser read path of any kind
  assert.doesNotMatch(EXEC, /FROM public\.registry_plan_catalog_selection_audit/);
});

test("STRICT IDENTITY: the catalog authorize helper has NO no_link branch and fails with the bare sentinel", () => {
  assert.doesNotMatch(AUTHZ, /no_link/);
  assert.match(AUTHZ, /IF v_link_status <> 'resolved' THEN/);
  assert.match(AUTHZ, /RAISE EXCEPTION 'identity_resolution_required';/);
  assert.match(AUTHZ, /AND oa\.person_id = v_person_id/);
  // and it is a genuinely SEPARATE helper from the lenient P-3F one, which
  // this migration does not touch
  assert.doesNotMatch(SQL, /CREATE OR REPLACE FUNCTION public\._organizer_private_draft_registry_plan_authorize/);
  const lenientAuthz = fnFrom(P3F, "_organizer_private_draft_registry_plan_authorize");
  assert.match(lenientAuthz, /no_link/, "the P-3F lenient authorize (untouched) still has its no_link branch");

  for (const body of ALL_RPCS) {
    assert.match(
      body,
      /_organizer_private_draft_registry_catalog_authorize\(p_event_id\)/,
      "every Catalog P2 RPC calls the STRICT authorize, never the lenient one",
    );
  }
});

test("SEARCH: literal prefix (never LIKE), two-character minimum, active-only, alphabetical, capped at 10, four columns only", () => {
  assert.match(SEARCH, /IF v_query IS NULL OR length\(v_query\) < 2 THEN\s*\n\s*RETURN;\s*\n\s*END IF;/);
  assert.match(SEARCH, /left\(lower\(a\.provider_name\), length\(v_query\)\) = lower\(v_query\)/);
  assert.doesNotMatch(SEARCH, /\bLIKE\b|\bILIKE\b|~~|SIMILAR TO|regexp/i);
  assert.match(SEARCH, /a\.is_active = true/);
  assert.match(SEARCH, /ORDER BY a\.provider_name, a\.id/);
  assert.match(SEARCH, /LIMIT 10;/);
  const returns = SEARCH.slice(SEARCH.indexOf("RETURNS TABLE("), SEARCH.indexOf(")\nLANGUAGE"));
  const cols = [...returns.matchAll(/\n  (\w+) (uuid|text)/g)].map((m) => m[1]);
  assert.deepEqual(cols, ["id", "provider_name", "short_description", "public_website"]);
  assert.doesNotMatch(SEARCH, /categor|geograph|popular|\brank\b|alias/i);
});

test("ATTACH: locks both rows, requires active at the locked instant, copies the snapshot atomically, preserves typed fields", () => {
  const lockPlanAt = ATTACH.indexOf("FOR UPDATE;");
  const lockAssetAt = ATTACH.indexOf("FOR UPDATE;", lockPlanAt + 1);
  assert.ok(lockPlanAt !== -1 && lockAssetAt !== -1, "both the plan row and the asset row are locked");
  const activeCheckAt = ATTACH.indexOf("IF NOT v_asset.is_active THEN");
  assert.ok(activeCheckAt > lockAssetAt, "is_active is checked only AFTER the asset row is locked");
  assert.match(ATTACH, /RAISE EXCEPTION 'registry_provider_catalog_asset_inactive';/);

  const setStart = ATTACH.indexOf("SET catalog_asset_id");
  const setClause = ATTACH.slice(setStart, ATTACH.indexOf("WHERE id = p_registry_plan_id", setStart));
  assert.doesNotMatch(setClause, /provider_name\s*=|registry_url\s*=|planning_status\s*=|organizer_note\s*=/);
  assert.match(setClause, /catalog_asset_id = v_asset\.id/);
  assert.match(setClause, /catalog_provider_name_snapshot = v_asset\.provider_name/);
  assert.match(setClause, /catalog_description_snapshot = v_asset\.short_description/);
  assert.match(setClause, /catalog_website_snapshot = v_asset\.public_website/);

  assert.match(ATTACH, /v_action := CASE WHEN v_plan\.catalog_asset_id IS NULL THEN 'attached' ELSE 'replaced' END;/);
  assert.equal([...ATTACH.matchAll(/INSERT INTO public\.registry_plan_catalog_selection_audit/g)].length, 1);

  // no external URL construct anywhere in this migration
  assert.doesNotMatch(
    EXEC,
    /\bhttp\s*\(|http_get|http_post|pg_net|net\.http|dblink|COPY[^;]*PROGRAM|CREATE EXTENSION|FOREIGN DATA WRAPPER|fetch\(|curl/i,
  );
});

test("DETACH: clears ONLY the four catalog columns and audits only a real transition", () => {
  const setStart = DETACH.indexOf("SET catalog_asset_id");
  const setClause = DETACH.slice(setStart, DETACH.indexOf("WHERE id = p_registry_plan_id", setStart));
  assert.doesNotMatch(setClause, /provider_name\s*=|registry_url\s*=|planning_status\s*=|organizer_note\s*=/);
  assert.match(setClause, /catalog_asset_id = NULL/);
  assert.match(setClause, /catalog_provider_name_snapshot = NULL/);
  assert.match(setClause, /catalog_description_snapshot = NULL/);
  assert.match(setClause, /catalog_website_snapshot = NULL/);
  assert.match(DETACH, /v_had_selection := v_plan\.catalog_asset_id IS NOT NULL;/);
  assert.match(DETACH, /IF v_had_selection THEN\s*\n\s*INSERT INTO public\.registry_plan_catalog_selection_audit/);
  assert.match(DETACH, /'detached'/);
});

test("LIST-WITH-CATALOG: a new sibling reader, byte-distinct from list_my_private_draft_registry_plans, exposing the plan's own snapshot verbatim", () => {
  assert.match(LIST_CATALOG, /_organizer_private_draft_registry_catalog_authorize\(p_event_id\)/);
  const returns = LIST_CATALOG.slice(LIST_CATALOG.indexOf("RETURNS TABLE("), LIST_CATALOG.indexOf(")\nLANGUAGE"));
  const cols = [...returns.matchAll(/\n  (\w+) (uuid|text|timestamptz)/g)].map((m) => m[1]);
  assert.deepEqual(cols, [
    "id", "provider_name", "registry_url", "planning_status", "organizer_note", "created_at", "updated_at",
    "catalog_asset_id", "catalog_provider_name_snapshot", "catalog_description_snapshot", "catalog_website_snapshot",
  ]);
  // it selects the plan's own stored columns verbatim -- it never re-joins
  // or re-reads the live catalog table to "refresh" a snapshot
  assert.doesNotMatch(LIST_CATALOG, /JOIN public\.registry_provider_catalog_assets|FROM public\.registry_provider_catalog_assets/);
  assert.match(LIST_CATALOG, /SELECT rp\.id, rp\.provider_name, rp\.registry_url, rp\.planning_status, rp\.organizer_note,/);
  assert.match(LIST_CATALOG, /rp\.catalog_asset_id, rp\.catalog_provider_name_snapshot,/);
  // no is_active filter here -- an inactive asset's existing snapshot is
  // never hidden from its owner
  assert.doesNotMatch(LIST_CATALOG, /is_active/);
});

test("NO error message echoes a search query, provider content, or note", () => {
  const raises = [...CODE.matchAll(/RAISE EXCEPTION '[^']*'[^;]*/g)].map((m) => m[0]);
  for (const r of raises) {
    assert.doesNotMatch(
      r,
      /p_query|v_query|p_provider_name|v_asset\.provider_name|organizer_note/,
      `error must state the rule, not searched/typed content: ${r}`,
    );
  }
});

test("NO AGGREGATION, NO REVERSE USAGE: nothing counts, ranks, or reports selections across events", () => {
  assert.doesNotMatch(ALL_FUNCTIONS, /\bcount\s*\(|\bsum\s*\(|GROUP BY|reference_count|usage_count|where_used/i);
  // no query anywhere starts FROM the catalog asset and joins OUT to plans/events
  assert.doesNotMatch(EXEC, /FROM public\.registry_provider_catalog_assets[\s\S]{0,200}JOIN public\.self_service_private_draft_registry_plans/);
});

test("all four public RPCs are postgres-owned and authenticated-only; the internal helper is granted to nobody", () => {
  for (const sig of [
    "search_my_private_draft_registry_provider_catalog\\(uuid, text\\)",
    "attach_my_private_draft_registry_plan_catalog_selection\\(uuid, uuid, uuid\\)",
    "detach_my_private_draft_registry_plan_catalog_selection\\(uuid, uuid\\)",
    "list_my_private_draft_registry_plans_with_catalog\\(uuid\\)",
  ]) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${sig} OWNER TO postgres;`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig}\\s*\\n\\s*FROM PUBLIC, anon, service_role;`));
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated;`));
  }
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\._organizer_private_draft_registry_catalog_authorize\(uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*?TO (?:anon|service_role)/);
});

test("safe search_path on every function in this migration", () => {
  const setPaths = [...SQL.matchAll(/SET search_path TO '([^']+)'/g)].map((m) => m[1]);
  assert.ok(setPaths.length >= 6, "every function declares a search_path");
  for (const p of setPaths) {
    assert.equal(p, "pg_catalog");
  }
});
