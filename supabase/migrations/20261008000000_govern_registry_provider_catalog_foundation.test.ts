import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261008000000_govern_registry_provider_catalog_foundation.test.ts

const SQL = readFileSync(
  fileURLToPath(new URL("./20261008000000_govern_registry_provider_catalog_foundation.sql", import.meta.url)),
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

const AUTHORIZE = fn("_registry_provider_catalog_authorize");
const LOCK = fn("_registry_provider_catalog_lock");
const VALIDATE = fn("_registry_provider_catalog_validate");
const LIST = fn("list_registry_provider_catalog_assets_for_platform_admin");
const CREATE = fn("create_registry_provider_catalog_asset");
const UPDATE = fn("update_registry_provider_catalog_asset");
const SET_ACTIVE = fn("set_registry_provider_catalog_asset_active_status");
const ALL_RPCS = [LIST, CREATE, UPDATE, SET_ACTIVE];
const ALL_FUNCTIONS = [AUTHORIZE, LOCK, VALIDATE, ...ALL_RPCS].join("\n");

test("the migration adds exactly two dedicated tables and a bounded set of functions -- no generic planning table", () => {
  assert.deepEqual(
    [...SQL.matchAll(/CREATE TABLE public\.([a-z_]+)/g)].map((m) => m[1]),
    ["registry_provider_catalog_assets", "registry_provider_catalog_curation_audit"],
  );
  assert.deepEqual(
    [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/g)].map((m) => m[1]).sort(),
    [
      "_registry_provider_catalog_authorize",
      "_registry_provider_catalog_lock",
      "_registry_provider_catalog_validate",
      "create_registry_provider_catalog_asset",
      "list_registry_provider_catalog_assets_for_platform_admin",
      "prevent_registry_provider_catalog_curation_audit_mutation",
      "set_registry_provider_catalog_asset_active_status",
      "update_registry_provider_catalog_asset",
    ],
  );
  assert.doesNotMatch(CODE, /entity_type|planning_kind|record_type|polymorphic|subject_type|asset_type/i);
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;\s*$/m);
});

test("SCHEMA FACTS: the asset table holds exactly the approved P1 columns -- no category, geography, vendor, tenant, event, or organizer field", () => {
  const createTable = SQL.slice(
    SQL.indexOf("CREATE TABLE public.registry_provider_catalog_assets"),
    SQL.indexOf("ALTER TABLE public.registry_provider_catalog_assets OWNER"),
  );
  const cols = [...createTable.matchAll(/^  (\w+) (uuid|text|boolean|integer|timestamptz)/gm)].map((m) => m[1]);
  assert.deepEqual(cols, [
    "id", "provider_name", "normalized_name", "short_description", "public_website",
    "is_active", "revision", "created_at", "updated_at",
  ]);
  // the deepEqual above already proves the exact column set; this checks the
  // executable column-definition lines only, with comment prose (which
  // legitimately says "organizer" while explaining who types the name)
  // stripped out first
  const createTableCode = createTable.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  assert.doesNotMatch(
    createTableCode,
    /category|geography|location|vendor_id|event_id|tenant_id|organizer|person_id|rank|popularity|usage_count|alias/i,
  );
  // no reference to another table -- a platform asset owns nothing and is owned by nothing
  assert.doesNotMatch(createTableCode, /REFERENCES public\./);
});

test("SCHEMA FACTS: the curation audit holds ONLY the six approved content-free facts", () => {
  const createTable = SQL.slice(
    SQL.indexOf("CREATE TABLE public.registry_provider_catalog_curation_audit"),
    SQL.indexOf("ALTER TABLE public.registry_provider_catalog_curation_audit OWNER"),
  );
  const cols = [...createTable.matchAll(/^  (\w+) (uuid|text|integer|timestamptz)/gm)].map((m) => m[1]);
  assert.deepEqual(cols, [
    "id", "catalog_asset_id", "actor_admin_user_id", "action", "revision_before", "revision_after", "occurred_at",
  ]);
  assert.doesNotMatch(
    createTable,
    /provider_name|short_description|public_website|jsonb|before_state|after_state|reason|event_id|tenant_id|person_id|organizer|usage_count|selection/i,
  );
  assert.match(createTable, /action text NOT NULL CHECK \(action IN \(/);
});

test("NAME COLLISION: normalized_name is a GENERATED collision key, unique-constrained; public_website is NOT unique", () => {
  assert.match(
    SQL,
    /normalized_name text GENERATED ALWAYS AS \(\s*\n\s*regexp_replace\(lower\(btrim\(provider_name\)\), '\\s\+', ' ', 'g'\)\s*\n\s*\) STORED,/,
  );
  assert.match(
    SQL,
    /ADD CONSTRAINT registry_provider_catalog_assets_normalized_name_key\s*\n\s*UNIQUE \(normalized_name\);/,
  );
  // public_website carries no UNIQUE constraint or unique index anywhere
  assert.doesNotMatch(CODE, /UNIQUE\s*\(\s*public_website|public_website[^,\n]*UNIQUE/i);
  const uniqueIndexes = [...CODE.matchAll(/CREATE UNIQUE INDEX[\s\S]*?;/g)];
  for (const idx of uniqueIndexes) {
    assert.doesNotMatch(idx[0], /public_website/);
  }
  // both mutation RPCs that could rename a provider catch the collision and
  // never leak the colliding value in the raised message
  for (const body of [CREATE, UPDATE]) {
    assert.match(body, /EXCEPTION WHEN unique_violation THEN\s*\n\s*RAISE EXCEPTION 'registry_provider_name_collision';/);
  }
  assert.doesNotMatch(CODE, /RAISE EXCEPTION[^;]*registry_provider_name_collision[^;]*%/);
});

test("INACTIVE FIRST: is_active defaults to false at the table level, and create_registry_provider_catalog_asset never accepts a caller-supplied active status", () => {
  assert.match(SQL, /is_active boolean NOT NULL DEFAULT false,/);
  assert.doesNotMatch(CREATE, /p_is_active/);
  assert.match(CREATE, /VALUES \(\s*\n\s*v_name, v_description, v_website, false\s*\n\s*\)/);
  // activation is exclusively the dedicated RPC's job: update's own SET
  // clause never assigns is_active (it legitimately appears in the RETURNS
  // TABLE shape and the final SELECT, since the full row is still returned)
  const setClause = UPDATE.slice(UPDATE.indexOf("SET provider_name"), UPDATE.indexOf("WHERE a.id"));
  assert.doesNotMatch(setClause, /is_active/);
});

test("NO HARD DELETE and NO automatic retirement anywhere in this migration", () => {
  assert.doesNotMatch(EXEC, /DELETE FROM public\.registry_provider_catalog/);
  assert.doesNotMatch(CODE, /DROP TABLE|TRUNCATE/i);
  assert.doesNotMatch(
    [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/g)].map((m) => m[1]).join(" "),
    /delete|remove|retire|purge/i,
  );
});

test("RLS: both tables are RLS-enabled with ALL grants revoked from every browser AND service_role -- zero CREATE POLICY exists", () => {
  for (const table of ["registry_provider_catalog_assets", "registry_provider_catalog_curation_audit"]) {
    assert.match(SQL, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
    assert.match(
      SQL,
      new RegExp(`REVOKE ALL ON TABLE public\\.${table}\\s*\\n\\s*FROM PUBLIC, anon, authenticated, service_role;`),
    );
  }
  assert.doesNotMatch(CODE, /CREATE POLICY/);
});

test("AUDIT IS APPEND-ONLY: a BEFORE UPDATE OR DELETE trigger unconditionally raises", () => {
  assert.match(
    SQL,
    /CREATE TRIGGER prevent_registry_provider_catalog_curation_audit_mutation_trigger\s*\nBEFORE UPDATE OR DELETE ON public\.registry_provider_catalog_curation_audit/,
  );
  const triggerFn = fn("prevent_registry_provider_catalog_curation_audit_mutation");
  assert.match(triggerFn, /RAISE EXCEPTION 'registry_provider_catalog_curation_audit is immutable';/);
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.prevent_registry_provider_catalog_curation_audit_mutation\(\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
  );
  // no RPC in this migration reads the audit table at all -- none is required by P1
  assert.doesNotMatch(
    ALL_RPCS.join("\n"),
    /FROM public\.registry_provider_catalog_curation_audit|SELECT[^;]*registry_provider_catalog_curation_audit/,
  );
});

test("AUTHORITY: every RPC fails closed on Platform Admin authority alone -- no other authority predicate is ever called", () => {
  for (const body of ALL_RPCS) {
    assert.match(body, /PERFORM public\._registry_provider_catalog_authorize\(\)|:= public\._registry_provider_catalog_authorize\(\)/);
  }
  assert.match(AUTHORIZE, /IF auth\.uid\(\) IS NULL THEN/);
  assert.match(AUTHORIZE, /IF NOT public\.has_platform_admin_authority\(auth\.uid\(\)\) THEN/);
  assert.match(AUTHORIZE, /au\.is_active = true\s*\n\s*AND au\.privilege_group = 'super_admin'/);
  assert.doesNotMatch(
    ALL_FUNCTIONS,
    /has_tenant_admin_authority|has_event_task_authority|has_vendor_catalog_admin_authority|has_event_admin_authority/,
  );
  // this migration defines no authority helper of its own and does not
  // redefine the one it depends on
  assert.doesNotMatch(CODE, /CREATE OR REPLACE FUNCTION public\.has_platform_admin_authority/);
  assert.doesNotMatch(CODE, /CREATE OR REPLACE FUNCTION public\.has_tenant_admin_authority/);
  assert.doesNotMatch(CODE, /CREATE OR REPLACE FUNCTION public\.has_event_admin_authority/);
});

test("REVISION CAS: update and activate/deactivate both lock, check the exact expected revision, and raise the bare stale sentinel on mismatch", () => {
  assert.match(LOCK, /FOR UPDATE;/);
  assert.match(LOCK, /IF p_expected_revision IS NULL OR v_row\.revision IS DISTINCT FROM p_expected_revision THEN/);
  assert.match(LOCK, /RAISE EXCEPTION 'stale_registry_provider_catalog_asset';/);
  for (const body of [UPDATE, SET_ACTIVE]) {
    assert.match(body, /_registry_provider_catalog_lock\(p_asset_id, p_expected_revision\)/);
  }
  // create takes no expected-revision argument -- nothing exists yet to CAS against
  assert.doesNotMatch(fnFrom(SQL, "create_registry_provider_catalog_asset").split("RETURNS")[0], /p_expected_revision/);
});

test("REVISION CAS: a stale-revision call cannot reach the mutating UPDATE statement -- zero asset and audit writes on conflict", () => {
  for (const body of [UPDATE, SET_ACTIVE]) {
    const lockAt = body.indexOf("_registry_provider_catalog_lock(p_asset_id, p_expected_revision)");
    const updateAt = body.indexOf("UPDATE public.registry_provider_catalog_assets");
    const insertAuditAt = body.indexOf("INSERT INTO public.registry_provider_catalog_curation_audit");
    assert.ok(lockAt !== -1 && updateAt !== -1 && insertAuditAt !== -1, "all three steps are present");
    assert.ok(lockAt < updateAt, "the revision lock/check runs strictly BEFORE the mutating UPDATE");
    assert.ok(updateAt < insertAuditAt, "the audit row is written strictly AFTER the mutation succeeds");
  }
});

test("AUDIT: every mutating RPC writes exactly one audit row per call, carrying only the six approved columns and the correct action", () => {
  for (const body of [CREATE, UPDATE, SET_ACTIVE]) {
    assert.equal(
      [...body.matchAll(/INSERT INTO public\.registry_provider_catalog_curation_audit/g)].length,
      1,
      "exactly one audit INSERT per RPC body",
    );
  }
  assert.match(CREATE, /'asset_created', 0, v_row\.revision/);
  assert.match(UPDATE, /'asset_corrected', v_current\.revision, v_row\.revision/);
  assert.match(SET_ACTIVE, /CASE WHEN p_is_active THEN 'asset_activated' ELSE 'asset_deactivated' END,\s*\n\s*v_current\.revision, v_row\.revision/);
  // the audit insert column list is exactly the four content-free columns
  // (id, occurred_at are defaulted) -- never a provider_name/description/website
  const auditInsertCols = [...ALL_RPCS.join("\n").matchAll(
    /INSERT INTO public\.registry_provider_catalog_curation_audit \(\s*\n\s*([^)]+)\)/g,
  )].map((m) => m[1].replace(/\s+/g, " ").trim());
  for (const cols of auditInsertCols) {
    assert.equal(cols, "catalog_asset_id, actor_admin_user_id, action, revision_before, revision_after");
  }
});

test("NO ERROR MESSAGE echoes provider content -- rules are stated, not the organizer's or admin's own text", () => {
  const raises = [...CODE.matchAll(/RAISE EXCEPTION '[^']*'[^;]*/g)].map((m) => m[0]);
  for (const r of raises) {
    assert.doesNotMatch(
      r,
      /p_provider_name|p_short_description|p_public_website|v_name|v_description|v_website/,
      `error must state the rule, not the submitted content: ${r}`,
    );
  }
});

test("WEBSITE IS INERT: no fetch/open/preview/crawl/unfurl/health-check construct exists anywhere, and no external reach is possible", () => {
  assert.doesNotMatch(
    EXEC,
    /\bhttp\s*\(|http_get|http_post|pg_net|net\.http|dblink|COPY[^;]*PROGRAM|CREATE EXTENSION|FOREIGN DATA WRAPPER|pg_read_file|fetch\(|curl/i,
  );
  const langs = new Set([...SQL.matchAll(/^LANGUAGE (\w+)/gm)].map((m) => m[1]));
  assert.deepEqual([...langs], ["plpgsql"]);
  // EXEC (comments AND COMMENT ON prose stripped): the prose is allowed to
  // say what does NOT happen ("never previewed, crawled, unfurled"); only
  // the executable code must contain none of these constructs
  assert.doesNotMatch(EXEC, /unfurl|preview|crawl|health.?check|validate.?url|dereferenc/i);
});

test("NO SEEDING: the only INSERT into the asset table anywhere is inside create_registry_provider_catalog_asset, and this migration never calls it", () => {
  const inserts = [...EXEC.matchAll(/INSERT INTO public\.registry_provider_catalog_assets/g)];
  assert.equal(inserts.length, 1, "exactly one INSERT statement exists in the whole migration");
  assert.ok(
    CREATE.includes("INSERT INTO public.registry_provider_catalog_assets"),
    "and it lives inside create_registry_provider_catalog_asset",
  );
  assert.doesNotMatch(EXEC, /SELECT public\.create_registry_provider_catalog_asset\(|PERFORM public\.create_registry_provider_catalog_asset\(/);
  assert.doesNotMatch(EXEC, /seed|starter|preset|sample|DEFAULT_PROVIDERS/i);
});

test("NO SIBLING SURFACE TOUCHED: no reference to the private Registry Plan, vendors, event_vendors, Nearby, maps, or any tenant/event/person table", () => {
  assert.doesNotMatch(
    EXEC,
    /self_service_private_draft_registry_plans|self_service_private_draft_vendor_plans|self_service_private_draft_venue_plans|self_service_private_draft_budget_lines|self_service_private_draft_checklist_items/,
  );
  assert.doesNotMatch(EXEC, /\bpublic\.vendors\b|\bevent_vendors\b|nearby_|master_map|parking_sites/i);
  assert.doesNotMatch(EXEC, /\bpublic\.events\b|\bpublic\.tenants\b|\bpublic\.people\b/);
  assert.doesNotMatch(EXEC, /invitation|notification|payment|passport|checkout|invoice/i);
});

test("all four public RPCs are postgres-owned and authenticated-only; internals granted to nobody", () => {
  for (const sig of [
    "list_registry_provider_catalog_assets_for_platform_admin\\(\\)",
    "create_registry_provider_catalog_asset\\(text, text, text\\)",
    "update_registry_provider_catalog_asset\\(uuid, integer, text, text, text\\)",
    "set_registry_provider_catalog_asset_active_status\\(uuid, integer, boolean\\)",
  ]) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${sig} OWNER TO postgres;`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig}\\s*\\n\\s*FROM PUBLIC, anon, service_role;`));
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig}\\s*\\n\\s*TO authenticated;`));
  }
  for (const internal of [
    "_registry_provider_catalog_authorize\\(\\)",
    "_registry_provider_catalog_lock\\(uuid, integer\\)",
    "_registry_provider_catalog_validate\\(text, text, text\\)",
  ]) {
    assert.match(
      SQL,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${internal}\\s*\\n\\s*FROM PUBLIC, anon, authenticated, service_role;`),
    );
  }
  assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*?TO (?:anon|service_role)/);
});

test("safe search_path on every function in this migration", () => {
  const setPaths = [...SQL.matchAll(/SET search_path TO '([^']+)'/g)].map((m) => m[1]);
  assert.ok(setPaths.length >= 8, "every function declares a search_path");
  for (const p of setPaths) {
    assert.equal(p, "pg_catalog");
  }
});

test("REQUIRED FIELDS: provider name, description, and website are all required (unlike the mostly-optional private-plan pattern)", () => {
  assert.match(VALIDATE, /p_provider_name IS NULL OR btrim\(p_provider_name\) = '' OR length\(btrim\(p_provider_name\)\) > 200/);
  assert.match(VALIDATE, /p_short_description IS NULL OR btrim\(p_short_description\) = '' OR length\(btrim\(p_short_description\)\) > 300/);
  assert.match(VALIDATE, /p_public_website IS NULL OR btrim\(p_public_website\) = '' OR length\(btrim\(p_public_website\)\) > 500/);
  for (const body of [CREATE, UPDATE]) {
    assert.match(body, /PERFORM public\._registry_provider_catalog_validate\(v_name, v_description, v_website\)/);
  }
});
