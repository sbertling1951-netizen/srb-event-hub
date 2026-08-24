import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural assertions for Nearby Scope Model Stage 3: unified Add/Edit
// editor wiring plus retirement of the Stage 2.5 temporary
// nearby_master_legacy_authenticated_write_bridge. No local Supabase/
// Docker instance is available in this environment (confirmed the same
// way as every prior Nearby stage this session) -- these verify SQL
// shape/guards, matching this repository's only established pattern for
// this workstream.
//
// Run with:
//   npx tsx --test supabase/migrations/20260823090000_unify_nearby_editor_and_retire_legacy_bridge.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260823090000_unify_nearby_editor_and_retire_legacy_bridge.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const EXECUTABLE = SQL.replace(/--.*$/gm, "");

function functionBody(name: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `expected to find ${name}`);
  const end = SQL.indexOf("$function$;", start);
  return SQL.slice(start, end);
}

const STAGE0_SQL = readFileSync(
  fileURLToPath(new URL("./20260823050000_govern_shared_place_contribution.sql", import.meta.url)),
  "utf8",
);
const STAGE2_SQL = readFileSync(
  fileURLToPath(
    new URL("./20260823070000_govern_nearby_master_event_association.sql", import.meta.url),
  ),
  "utf8",
);
const STAGE2_5_SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260823080000_govern_nearby_place_reassignment_and_reconcile_master_rls.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("../../app/admin/nearby/page.tsx", import.meta.url)),
  "utf8",
);

// ---------------------------------------------------------------------------
// 1. add_tenant_place_to_event -- composition
// ---------------------------------------------------------------------------

test("add_tenant_place_to_event: signature matches the composed-add contract", () => {
  assert.match(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.add_tenant_place_to_event\(\s*\n\s*p_event_id uuid,\s*\n\s*p_tenant_id uuid,\s*\n\s*p_name text,/,
  );
  assert.match(functionBody("add_tenant_place_to_event"), /RETURNS public\.event_nearby_places/);
});

test("add_tenant_place_to_event calls record_tenant_place with scope hardcoded to tenant_specific", () => {
  const body = functionBody("add_tenant_place_to_event");
  assert.match(body, /record_tenant_place\(/);
  assert.match(body, /p_scope\s*:=\s*'tenant_specific'/);
});

test("add_tenant_place_to_event calls associate_nearby_master_place_with_event with the new place id", () => {
  const body = functionBody("add_tenant_place_to_event");
  assert.match(
    body,
    /RETURN public\.associate_nearby_master_place_with_event\(p_event_id, v_place_id\);/,
  );
});

test("add_tenant_place_to_event delegates authority to its two inner calls rather than checking anything itself", () => {
  const body = functionBody("add_tenant_place_to_event");
  assert.doesNotMatch(body, /has_tenant_admin_authority/);
  assert.doesNotMatch(body, /has_event_task_authority/);
  assert.doesNotMatch(body, /has_platform_admin_authority/);
});

test("add_tenant_place_to_event is SECURITY DEFINER, owned by postgres, authenticated-only EXECUTE", () => {
  const start = SQL.indexOf("CREATE OR REPLACE FUNCTION public.add_tenant_place_to_event(");
  const nextSectionStart = SQL.indexOf("-- 2. public.upsert_stored_area_place");
  const section = SQL.slice(start, nextSectionStart);

  assert.match(section, /SECURITY DEFINER/);
  assert.match(section, /SET search_path TO 'pg_catalog'/);
  assert.match(section, /ALTER FUNCTION public\.add_tenant_place_to_event\([\s\S]*?\) OWNER TO postgres;/);
  assert.match(
    section,
    /REVOKE ALL ON FUNCTION public\.add_tenant_place_to_event\([\s\S]*?\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.match(
    section,
    /GRANT EXECUTE ON FUNCTION public\.add_tenant_place_to_event\([\s\S]*?\) TO authenticated;/,
  );
});

// ---------------------------------------------------------------------------
// 2. upsert_stored_area_place -- legacy-authority replication, area guard
// ---------------------------------------------------------------------------

test("upsert_stored_area_place: signature takes p_place_id (nullable) and a required p_area_id", () => {
  assert.match(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.upsert_stored_area_place\(\s*\n\s*p_place_id uuid,\s*\n\s*p_area_id uuid,\s*\n\s*p_name text,/,
  );
  assert.match(functionBody("upsert_stored_area_place"), /RETURNS public\.nearby_master/);
});

test("upsert_stored_area_place replicates the exact bridge authority check (super_admin, event_admin, content_admin)", () => {
  const body = functionBody("upsert_stored_area_place");
  assert.match(body, /FROM public\.admin_users AS au/);
  assert.match(body, /au\.is_active = true/);
  assert.match(
    body,
    /au\.privilege_group = ANY \(ARRAY\['super_admin', 'event_admin', 'content_admin'\]\)/,
  );
});

test("upsert_stored_area_place matches the bridge policy's own authority list verbatim", () => {
  const bridgeMatch = STAGE2_5_SQL.match(
    /privilege_group = ANY \(ARRAY\['super_admin', 'event_admin', 'content_admin'\]\)/,
  );
  assert.ok(bridgeMatch, "expected to find the Stage 2.5 bridge policy's authority list");

  const body = functionBody("upsert_stored_area_place");
  assert.ok(body.includes(bridgeMatch![0]));
});

test("upsert_stored_area_place refuses to update a row whose area_id is NULL", () => {
  const body = functionBody("upsert_stored_area_place");
  assert.match(body, /v_existing_area_id IS NULL THEN/);
  assert.match(body, /is not a stored area place/);
});

test("upsert_stored_area_place requires p_area_id and validates the area exists", () => {
  const body = functionBody("upsert_stored_area_place");
  assert.match(body, /p_area_id IS NULL THEN/);
  assert.match(body, /FROM public\.nearby_area_templates WHERE id = p_area_id/);
});

test("upsert_stored_area_place never sets scope, tenant_id, or contributed_by_tenant_id -- new rows take the column default", () => {
  const body = functionBody("upsert_stored_area_place");
  assert.doesNotMatch(body, /\bscope\s*[,=]/);
  assert.doesNotMatch(body, /\btenant_id\s*[,=]/);
  assert.doesNotMatch(body, /contributed_by_tenant_id/);
});

test("upsert_stored_area_place inserts when p_place_id is NULL, updates otherwise", () => {
  const body = functionBody("upsert_stored_area_place");
  assert.match(body, /IF p_place_id IS NULL THEN\s*\n\s*INSERT INTO public\.nearby_master/);
  assert.match(body, /UPDATE public\.nearby_master/);
});

test("upsert_stored_area_place is SECURITY DEFINER, owned by postgres, authenticated-only EXECUTE", () => {
  const start = SQL.indexOf("CREATE OR REPLACE FUNCTION public.upsert_stored_area_place(");
  const nextSectionStart = SQL.indexOf("-- 3. public.delete_stored_area_place");
  const section = SQL.slice(start, nextSectionStart);

  assert.match(section, /SECURITY DEFINER/);
  assert.match(
    section,
    /ALTER FUNCTION public\.upsert_stored_area_place\([\s\S]*?\) OWNER TO postgres;/,
  );
  assert.match(
    section,
    /REVOKE ALL ON FUNCTION public\.upsert_stored_area_place\([\s\S]*?\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.match(
    section,
    /GRANT EXECUTE ON FUNCTION public\.upsert_stored_area_place\([\s\S]*?\) TO authenticated;/,
  );
});

// ---------------------------------------------------------------------------
// 3. delete_stored_area_place -- legacy-authority replication, area guard
// ---------------------------------------------------------------------------

test("delete_stored_area_place: signature is (p_place_id uuid) RETURNS void", () => {
  assert.match(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.delete_stored_area_place\(p_place_id uuid\)\s*\n\s*RETURNS void/,
  );
});

test("delete_stored_area_place replicates the exact bridge authority check", () => {
  const body = functionBody("delete_stored_area_place");
  assert.match(
    body,
    /au\.privilege_group = ANY \(ARRAY\['super_admin', 'event_admin', 'content_admin'\]\)/,
  );
});

test("delete_stored_area_place refuses to delete a row whose area_id is NULL", () => {
  const body = functionBody("delete_stored_area_place");
  assert.match(body, /v_area_id IS NULL THEN/);
  assert.match(body, /is not a stored area place/);
});

test("delete_stored_area_place performs a hard DELETE, matching the raw call site it replaces", () => {
  const body = functionBody("delete_stored_area_place");
  assert.match(body, /DELETE FROM public\.nearby_master WHERE id = p_place_id;/);
});

test("delete_stored_area_place is SECURITY DEFINER, owned by postgres, authenticated-only EXECUTE", () => {
  const start = SQL.indexOf("CREATE OR REPLACE FUNCTION public.delete_stored_area_place(");
  const nextSectionStart = SQL.indexOf("-- 4. Retire the Stage 2.5 temporary bridge");
  const section = SQL.slice(start, nextSectionStart);

  assert.match(section, /SECURITY DEFINER/);
  assert.match(
    section,
    /ALTER FUNCTION public\.delete_stored_area_place\(uuid\) OWNER TO postgres;/,
  );
  assert.match(
    section,
    /REVOKE ALL ON FUNCTION public\.delete_stored_area_place\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.match(
    section,
    /GRANT EXECUTE ON FUNCTION public\.delete_stored_area_place\(uuid\) TO authenticated;/,
  );
});

// ---------------------------------------------------------------------------
// 4. Bridge retirement
// ---------------------------------------------------------------------------

test("drops the Stage 2.5 legacy authenticated write bridge policy by exact name", () => {
  assert.match(
    EXECUTABLE,
    /DROP POLICY IF EXISTS nearby_master_legacy_authenticated_write_bridge ON public\.nearby_master;/,
  );
});

test("does not touch the Stage 2.5 authenticated SELECT policy", () => {
  assert.doesNotMatch(EXECUTABLE, /DROP POLICY[^;]*nearby_master_authenticated_select_policy/);
});

test("does not modify any Stage 0/1/2/2.5 migration file", () => {
  // This test file only ever reads sibling migrations for cross-reference
  // (STAGE0_SQL/STAGE2_SQL/STAGE2_5_SQL above); asserting they still
  // define their own original functions unchanged is the closest
  // structural proxy available for "no prior migration file was edited"
  // in an environment with no local DB to diff against.
  assert.match(STAGE0_SQL, /CREATE OR REPLACE FUNCTION public\.record_tenant_place\(/);
  assert.match(STAGE2_SQL, /CREATE OR REPLACE FUNCTION public\.associate_nearby_master_place_with_event\(/);
  assert.match(STAGE2_5_SQL, /CREATE OR REPLACE FUNCTION public\.reassign_event_nearby_place\(/);
});

// ---------------------------------------------------------------------------
// 5. No raw nearby_master mutation remains in the application code
// ---------------------------------------------------------------------------

test("app/admin/nearby/page.tsx no longer calls .insert()/.update()/.delete() on nearby_master directly", () => {
  const rawWritePattern =
    /\.from\(\s*"nearby_master"\s*\)[\s\S]{0,120}?\.(insert|update|delete)\(/g;
  const matches = PAGE_SOURCE.match(rawWritePattern) || [];
  assert.deepEqual(matches, []);
});

test("app/admin/nearby/page.tsx calls the three new governed RPCs by name", () => {
  assert.match(PAGE_SOURCE, /add_tenant_place_to_event/);
  assert.match(PAGE_SOURCE, /upsert_stored_area_place/);
  assert.match(PAGE_SOURCE, /delete_stored_area_place/);
});

test("app/admin/nearby/page.tsx calls reassign_event_nearby_place for Move", () => {
  assert.match(PAGE_SOURCE, /reassign_event_nearby_place/);
});

test("app/admin/nearby/page.tsx calls update_nearby_master_place and retire_nearby_master_place for canonical edit/retire", () => {
  assert.match(PAGE_SOURCE, /update_nearby_master_place/);
  assert.match(PAGE_SOURCE, /retire_nearby_master_place/);
});

test("app/admin/nearby/page.tsx calls record_tenant_place for the Shared (All Tenants) Add path", () => {
  assert.match(PAGE_SOURCE, /record_tenant_place/);
});
