import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural assertions for Nearby Category Authority Stage C: the one
// governed rename_place_category RPC. No local Supabase/Docker instance
// is available in this environment to test-apply it -- these verify the
// SQL's shape/guards, matching this repository's established style for
// every prior migration in this workstream.
//
// Run with:
//   npx tsx --test supabase/migrations/20260821250000_create_place_category_rename_governed_operation.test.ts

const SQL = readFileSync(
  fileURLToPath(new URL("./20260821250000_create_place_category_rename_governed_operation.sql", import.meta.url)),
  "utf8",
);
// Comment-stripped view, for checks that must ignore prose mentions of a
// term inside this file's own explanatory `--` comments.
const EXECUTABLE = SQL.replace(/--.*$/gm, "");

function functionBody(name: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const end = SQL.indexOf("$function$;", start);
  return SQL.slice(start, end);
}

// ---------------------------------------------------------------------------
// Signature / mechanics
// ---------------------------------------------------------------------------

test("function signature matches the requested contract exactly: rename_place_category(p_category_id uuid, p_new_label text) RETURNS void", () => {
  assert.match(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.rename_place_category\(\s*\n\s*p_category_id uuid,\s*\n\s*p_new_label text\s*\n\s*\)\s*\n\s*RETURNS void/,
  );
});

test("is SECURITY DEFINER with a fixed, safe search_path, owned consistently with sibling governed RPCs (postgres)", () => {
  const body = functionBody("rename_place_category");
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path TO 'pg_catalog'/);
  assert.match(SQL, /ALTER FUNCTION public\.rename_place_category\(uuid, text\) OWNER TO postgres;/);
});

// ---------------------------------------------------------------------------
// Authority
// ---------------------------------------------------------------------------

test("authority is has_platform_admin_authority(auth.uid()) -- checked first, before any row is read or written", () => {
  const body = functionBody("rename_place_category");
  const authIdx = body.indexOf("has_platform_admin_authority(auth.uid())");
  const selectIdx = body.indexOf("SELECT * INTO v_before");
  const updateIdx = body.indexOf("UPDATE public.place_categories");
  assert.ok(authIdx >= 0);
  assert.ok(authIdx < selectIdx && authIdx < updateIdx);
  assert.match(body, /IF NOT public\.has_platform_admin_authority\(auth\.uid\(\)\) THEN\s*\n\s*RAISE EXCEPTION 'unauthorized';/);
});

test("no Event or Tenant authority helper is invoked -- global catalog rename is Platform Admin only", () => {
  const body = functionBody("rename_place_category");
  assert.equal(/has_tenant_admin_authority|has_event_admin_authority|resolve_task_authority/.test(body), false);
});

// ---------------------------------------------------------------------------
// Grants -- ACL layer
// ---------------------------------------------------------------------------

test("EXECUTE is revoked from PUBLIC, anon, authenticated, and service_role in one statement before the single authenticated grant -- closes the default-ACL gap that silently grants EXECUTE to every role on a newly created function", () => {
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.rename_place_category\(uuid, text\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
  const revokeIdx = SQL.indexOf("REVOKE ALL ON FUNCTION public.rename_place_category");
  const grantIdx = SQL.indexOf("GRANT EXECUTE ON FUNCTION public.rename_place_category");
  assert.ok(revokeIdx < grantIdx);
  assert.match(SQL, /GRANT EXECUTE ON FUNCTION public\.rename_place_category\(uuid, text\) TO authenticated;$/m);
});

test("anon receives no EXECUTE grant anywhere in this migration -- this is not a member-facing capability", () => {
  const grantLines = SQL.match(/^GRANT[^\n]*$/gm) || [];
  for (const line of grantLines) {
    assert.equal(/\banon\b/.test(line), false, `unexpected anon grant: ${line}`);
  }
});

test("service_role receives no EXECUTE grant -- explicitly revoked, matching existing convention (no evidence any sibling RPC requires it)", () => {
  const grantLines = SQL.match(/^GRANT[^\n]*$/gm) || [];
  for (const line of grantLines) {
    assert.equal(/\bservice_role\b/.test(line), false, `unexpected service_role grant: ${line}`);
  }
});

test("no direct table UPDATE grant is added to place_categories, nearby_master, or event_nearby_places -- mutation stays inside the SECURITY DEFINER function only", () => {
  assert.equal(/GRANT UPDATE ON TABLE/.test(SQL), false);
  assert.equal(/GRANT (INSERT|UPDATE|DELETE) ON (TABLE )?public\.(place_categories|nearby_master|event_nearby_places)/.test(SQL), false);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("rejects a null category id", () => {
  const body = functionBody("rename_place_category");
  assert.match(body, /IF p_category_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'invalid_category_id';/);
});

test("rejects a null or blank/whitespace-only label via btrim(coalesce(...)) normalization, not raw equality", () => {
  const body = functionBody("rename_place_category");
  assert.match(body, /v_new_label text := btrim\(coalesce\(p_new_label, ''\)\);/);
  assert.match(body, /IF v_new_label = '' THEN\s*\n\s*RAISE EXCEPTION 'invalid_label';/);
});

test("label is trimmed but never case-transformed -- no lower()/upper()/initcap() is applied to the stored value", () => {
  const body = functionBody("rename_place_category");
  const storeStatement = body.slice(
    body.indexOf("UPDATE public.place_categories"),
    body.indexOf("WHERE id = p_category_id;") + "WHERE id = p_category_id;".length,
  );
  assert.match(storeStatement, /SET label = v_new_label/);
  assert.equal(/lower\(|upper\(|initcap\(/.test(storeStatement), false);
});

test("rejects a nonexistent or inactive category with the same not-found error -- scoped to is_active = true, matching the table's own read policy", () => {
  const body = functionBody("rename_place_category");
  assert.match(
    body,
    /SELECT \* INTO v_before\s*\n\s*FROM public\.place_categories\s*\n\s*WHERE id = p_category_id AND is_active = true;/,
  );
  assert.match(body, /IF NOT FOUND THEN\s*\n\s*RAISE EXCEPTION 'category_not_found';/);
});

test("duplicate-label contract: rejects an exact normalized (case-insensitive, trimmed) label already used by a different ACTIVE category -- comparison only, no unique constraint added to the table", () => {
  const body = functionBody("rename_place_category");
  assert.match(
    body,
    /WHERE is_active = true\s*\n\s*AND id <> p_category_id\s*\n\s*AND lower\(btrim\(label\)\) = lower\(v_new_label\)/,
  );
  assert.match(body, /RAISE EXCEPTION 'duplicate_label';/);
  assert.equal(/CREATE UNIQUE INDEX.*label|UNIQUE\s*\(label\)/i.test(EXECUTABLE), false);
});

// ---------------------------------------------------------------------------
// Rename semantics: id/code fixed, no merge/delete/repoint, no new
// category, tenant overrides untouched.
// ---------------------------------------------------------------------------

test("id and code are never written anywhere in this function -- only label is ever the target of a SET", () => {
  const body = functionBody("rename_place_category");
  const setClauses = [...body.matchAll(/SET\s+([^\n]+)/g)].map((m) => m[1]);
  for (const clause of setClauses) {
    assert.equal(/\bcode\s*=/.test(clause), false, `unexpected write to code: ${clause}`);
    assert.equal(/\bid\s*=/.test(clause), false, `unexpected write to id: ${clause}`);
  }
});

test("sort_order and is_active are never written -- rename touches label only on place_categories", () => {
  const body = functionBody("rename_place_category");
  const placeCategoriesUpdate = body.slice(
    body.indexOf("UPDATE public.place_categories"),
    body.indexOf("WHERE id = p_category_id;") + "WHERE id = p_category_id;".length,
  );
  assert.equal(/sort_order\s*=|is_active\s*=/.test(placeCategoriesUpdate), false);
});

test("no DELETE, no category creation (INSERT into place_categories), and no repointing of any OTHER row's category_id", () => {
  assert.equal(/DELETE FROM public\.place_categories/.test(SQL), false);
  assert.equal(/INSERT INTO public\.place_categories/.test(SQL), false);
  // category_id itself is never the target of any UPDATE ... SET in this
  // migration -- every UPDATE only ever filters BY category_id, never
  // assigns a new one.
  assert.equal(/SET\s+(?:[^;]*,\s*)?category_id\s*=/s.test(SQL), false);
});

test("tenant_category_overrides and tenant_type_category_defaults are never referenced in any executable statement -- rename is not a tenant-curation concern", () => {
  assert.equal(/tenant_category_overrides|tenant_type_category_defaults/.test(EXECUTABLE), false);
});

test("only one category_id value is ever mutated per call -- p_category_id is the sole target across every UPDATE statement", () => {
  const updateBlocks = SQL.split(/UPDATE public\./).slice(1);
  for (const block of updateBlocks) {
    const whereClause = block.slice(0, block.indexOf(";"));
    assert.match(whereClause, /category_id = p_category_id|id = p_category_id/);
  }
});

// ---------------------------------------------------------------------------
// Legacy free-text projection
// ---------------------------------------------------------------------------

test("legacy category text is propagated to nearby_master and event_nearby_places, filtered by category_id -- never by matching old text -- inside the same transaction as the label update", () => {
  const body = functionBody("rename_place_category");
  assert.match(
    body,
    /UPDATE public\.nearby_master\s*\n\s*SET category = v_new_label\s*\n\s*WHERE category_id = p_category_id;/,
  );
  assert.match(
    body,
    /UPDATE public\.event_nearby_places\s*\n\s*SET category = v_new_label\s*\n\s*WHERE category_id = p_category_id;/,
  );
  assert.equal(/WHERE category = /.test(body), false);
});

test("the whole function is one statement list with no explicit COMMIT inside it -- propagation is transactional with the label rename by construction (single function invocation, single implicit transaction)", () => {
  const body = functionBody("rename_place_category");
  assert.equal(/\bCOMMIT\b/.test(body), false);
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

test("a dedicated, immutable audit table is created, following the agenda_category_command_audit precedent's exact shape", () => {
  assert.match(SQL, /CREATE TABLE public\.place_category_command_audit \(/);
  assert.match(SQL, /action text NOT NULL CHECK \(action = 'renamed'\)/);
  assert.match(SQL, /actor_auth_user_id uuid NOT NULL/);
  assert.match(SQL, /before_state jsonb/);
  assert.match(SQL, /after_state jsonb/);
  assert.match(SQL, /occurred_at timestamptz NOT NULL DEFAULT now\(\)/);
});

test("the audit table is immutable (BEFORE UPDATE OR DELETE trigger raises) and locked down from every ordinary role", () => {
  assert.match(
    SQL,
    /CREATE TRIGGER prevent_place_category_command_audit_mutation_trigger\s*\n\s*BEFORE UPDATE OR DELETE ON public\.place_category_command_audit/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.place_category_command_audit FROM PUBLIC, anon, authenticated, service_role;/,
  );
});

test("every rename call records the real actor (auth.uid(), never a caller-supplied parameter) and both before/after label state", () => {
  const body = functionBody("rename_place_category");
  const insertStatement = body.slice(body.indexOf("INSERT INTO public.place_category_command_audit"));
  assert.match(insertStatement, /'renamed',\s*\n\s*auth\.uid\(\),/);
  assert.match(insertStatement, /jsonb_build_object\('label', v_before\.label\)/);
  assert.match(insertStatement, /jsonb_build_object\('label', v_new_label\)/);
  assert.equal(/p_actor|p_auth_user_id/.test(functionBody("rename_place_category")), false);
});

// ---------------------------------------------------------------------------
// Scope guards -- nothing beyond rename shipped in this migration
// ---------------------------------------------------------------------------

test("no merge RPC, no create/deactivate category RPC, no InlineEdit reference anywhere in this migration", () => {
  assert.equal(/merge_place_categor/i.test(SQL), false);
  assert.equal(/create_place_categor|deactivate_place_categor|delete_place_categor/i.test(SQL), false);
  assert.equal(/InlineEdit/.test(SQL), false);
});

test("only one new callable RPC is introduced by this migration", () => {
  const created = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
  // The audit-immutability trigger function is infrastructure, not a
  // caller-facing RPC -- excluded from this count deliberately.
  const rpcs = created.filter((name) => name !== "prevent_place_category_command_audit_mutation");
  assert.deepEqual(rpcs, ["rename_place_category"]);
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
});

// ---------------------------------------------------------------------------
// UI scope guard: Stage C creates the governed capability only -- no
// production page wires it up yet.
// ---------------------------------------------------------------------------

test("no production page references rename_place_category or InlineEdit yet -- this migration ships no UI adoption", () => {
  const pages = [
    ["../../app/admin/nearby/page.tsx", "app/admin/nearby/page.tsx"],
    ["../../app/admin/nearby-settings/page.tsx", "app/admin/nearby-settings/page.tsx"],
    ["../../app/member/nearby/page.tsx", "app/member/nearby/page.tsx"],
  ] as const;

  for (const [relativePath, label] of pages) {
    const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
    assert.equal(source.includes("rename_place_category"), false, `${label} should not reference rename_place_category yet`);
    assert.equal(source.includes("InlineEdit"), false, `${label} should not reference InlineEdit yet`);
  }
});
