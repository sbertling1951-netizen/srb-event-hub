import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural assertions for Nearby Scope Model Stage 2.5: safe
// linked-place Event reassignment (Part A) + nearby_master RLS/grant
// reconciliation (Part B). No local Supabase/Docker instance is
// available in this environment (confirmed the same way as every prior
// Nearby stage this session) -- these verify SQL shape/guards, matching
// this repository's only established pattern for this workstream. The
// RLS/grant claims in Part B were additionally verified against the live
// linked database both before writing this migration (documented in the
// migration's own header) and after deployment (see the closeout
// report) -- the closest available substitute for an executable
// behavioral DB test in an environment with no local Postgres.
//
// Run with:
//   npx tsx --test supabase/migrations/20260823080000_govern_nearby_place_reassignment_and_reconcile_master_rls.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260823080000_govern_nearby_place_reassignment_and_reconcile_master_rls.sql",
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

const TASK_AUTHORITY_SQL = readFileSync(
  fileURLToPath(
    new URL("./20260811170000_create_scoped_task_authority_foundation.sql", import.meta.url),
  ),
  "utf8",
);

const STAGE0_SQL = readFileSync(
  fileURLToPath(new URL("./20260823050000_govern_shared_place_contribution.sql", import.meta.url)),
  "utf8",
);
const STAGE1_SQL = readFileSync(
  fileURLToPath(
    new URL("./20260823060000_govern_nearby_master_update_and_retirement.sql", import.meta.url),
  ),
  "utf8",
);
const STAGE2_SQL = readFileSync(
  fileURLToPath(
    new URL("./20260823070000_govern_nearby_master_event_association.sql", import.meta.url),
  ),
  "utf8",
);

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("../../app/admin/nearby/page.tsx", import.meta.url)),
  "utf8",
);

// ---------------------------------------------------------------------------
// Part A -- signature, load-order
// ---------------------------------------------------------------------------

test("reassign_event_nearby_place: signature is (p_event_place_id uuid, p_destination_event_id uuid)", () => {
  assert.match(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.reassign_event_nearby_place\(\s*\n\s*p_event_place_id uuid,\s*\n\s*p_destination_event_id uuid\s*\n\s*\)\s*\n\s*RETURNS public\.event_nearby_places/,
  );
});

test("is SECURITY DEFINER with the same fixed search_path convention as every sibling Nearby RPC", () => {
  const body = functionBody("reassign_event_nearby_place");
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path TO 'pg_catalog'/);
});

test("loads the row first, derives the source event from it (never a caller claim), and checks both authorities before any lifecycle/scope validation", () => {
  const body = functionBody("reassign_event_nearby_place");
  const loadIdx = body.indexOf("SELECT * INTO v_row");
  const notFoundIdx = body.indexOf("event nearby place % not found");
  const sourceAssignIdx = body.indexOf("v_source_event_id := v_row.event_id;");
  const sourceAuthIdx = body.indexOf("caller is not authorized to manage nearby places for the source event");
  const destAuthIdx = body.indexOf("caller is not authorized to manage nearby places for the destination event");
  const lifecycleIdx = body.indexOf("assert_event_lifecycle_mutable(v_source_event_id)");
  assert.ok(loadIdx >= 0 && loadIdx < notFoundIdx);
  assert.ok(notFoundIdx < sourceAssignIdx);
  assert.ok(sourceAssignIdx < sourceAuthIdx);
  assert.ok(sourceAuthIdx < destAuthIdx);
  assert.ok(destAuthIdx < lifecycleIdx);
});

// ---------------------------------------------------------------------------
// 1-3. Source/destination authority
// ---------------------------------------------------------------------------

test("2. lack of source authority blocks the move -- the source check uses has_event_task_authority against v_source_event_id (derived from the loaded row), evaluated first", () => {
  const body = functionBody("reassign_event_nearby_place");
  assert.match(
    body,
    /IF NOT public\.has_event_task_authority\('event\.nearby\.manage', v_source_event_id\) THEN/,
  );
});

test("3. lack of destination authority blocks the move -- has_event_task_authority against p_destination_event_id, checked independently of the source check", () => {
  const body = functionBody("reassign_event_nearby_place");
  assert.match(
    body,
    /IF NOT public\.has_event_task_authority\('event\.nearby\.manage', p_destination_event_id\) THEN/,
  );
});

test("1. Event Only rows (source_master_id IS NULL) require no further check beyond both authorities -- the tenant/scope validation block is entirely inside an `IF v_row.source_master_id IS NOT NULL` guard", () => {
  const body = functionBody("reassign_event_nearby_place");
  const guardIdx = body.indexOf("IF v_row.source_master_id IS NOT NULL THEN");
  assert.ok(guardIdx >= 0);
  const sortOrderIdx = body.indexOf("v_sort_order := COALESCE(");
  assert.ok(guardIdx < sortOrderIdx, "the guard must fully enclose the scope/tenant/duplicate checks, ending before sort_order computation");
});

test("event.nearby.manage remains tenant_inherits/platform_inherits -- Tenant Admin and Super Admin already satisfy both authority checks the same way an Event Admin does, no separate primitive needed", () => {
  assert.match(
    TASK_AUTHORITY_SQL,
    /\('event\.nearby\.manage','event','mutation','Manage Event nearby places\.',true,true,true\)/,
  );
});

// ---------------------------------------------------------------------------
// 4, 5, 6. Scope validation on move
// ---------------------------------------------------------------------------

test("4. shared_public-linked rows require no tenant match -- movable to any authorized destination Event regardless of Tenant", () => {
  const body = functionBody("reassign_event_nearby_place");
  const branchStart = body.indexOf("ELSIF v_place.scope = 'shared_public' THEN");
  const branchEnd = body.indexOf("ELSE\n      RAISE EXCEPTION 'reassign_event_nearby_place: place % has an unrecognized scope");
  assert.match(body.slice(branchStart, branchEnd), /NULL;/);
});

test("5 & 6. tenant_specific-linked rows require destination Event's tenant_id = place.tenant_id exactly (IS DISTINCT FROM, so NULL never accidentally matches) -- movable within the same Tenant, blocked across Tenants", () => {
  const body = functionBody("reassign_event_nearby_place");
  const branchStart = body.indexOf("IF v_place.scope = 'tenant_specific' THEN");
  const branchEnd = body.indexOf("ELSIF v_place.scope = 'shared_public'");
  const branch = body.slice(branchStart, branchEnd);
  assert.match(branch, /IF v_place\.tenant_id IS DISTINCT FROM v_destination_tenant_id THEN/);
  assert.match(branch, /RAISE EXCEPTION 'reassign_event_nearby_place: place % belongs to a different tenant than destination event %'/);
});

test("v_destination_tenant_id comes only from the loaded destination events row -- never a caller-supplied parameter", () => {
  const body = functionBody("reassign_event_nearby_place");
  const assignments = [...body.matchAll(/INTO v_destination_tenant_id/g)];
  assert.equal(assignments.length, 1);
  assert.equal(/p_destination_tenant_id|p_tenant_id/.test(body), false);
});

// ---------------------------------------------------------------------------
// 7 & 8. source_master_id and snapshot fields survive
// ---------------------------------------------------------------------------

test("7 & 8. the UPDATE's SET clause touches only event_id and sort_order -- source_master_id and every snapshot field (name, address, phone, website, category, category_id, notes, location_code, lat, lng, is_hidden, distance_miles) are preserved untouched", () => {
  const body = functionBody("reassign_event_nearby_place");
  const updateStart = body.indexOf("UPDATE public.event_nearby_places\n  SET event_id");
  const updateStatement = body.slice(updateStart, body.indexOf("RETURNING * INTO v_row;") + "RETURNING * INTO v_row;".length);
  const setClause = updateStatement.slice(updateStatement.indexOf("SET"), updateStatement.indexOf("WHERE id"));
  const settableColumns = [...setClause.matchAll(/(\w+)\s*=/g)].map((m) => m[1]);
  assert.deepEqual(settableColumns.sort(), ["event_id", "sort_order"].sort());
});

// ---------------------------------------------------------------------------
// 9. master row not mutated
// ---------------------------------------------------------------------------

test("9. nearby_master is only ever read (SELECT) in this function -- never the target of any UPDATE/INSERT/DELETE", () => {
  const body = functionBody("reassign_event_nearby_place");
  assert.equal(/UPDATE public\.nearby_master|DELETE FROM public\.nearby_master|INSERT INTO public\.nearby_master/.test(body), false);
});

// ---------------------------------------------------------------------------
// 10. Duplicate destination
// ---------------------------------------------------------------------------

test("10. moving a linked row into a destination that already has the same source_master_id raises a named conflict exception, never a silent duplicate or a misleading return of the destination's unrelated existing row", () => {
  const body = functionBody("reassign_event_nearby_place");
  assert.match(
    body,
    /SELECT \* INTO v_existing\s*\n\s*FROM public\.event_nearby_places\s*\n\s*WHERE event_id = p_destination_event_id AND source_master_id = v_row\.source_master_id;\s*\n\s*\n\s*IF FOUND THEN\s*\n\s*RAISE EXCEPTION 'reassign_event_nearby_place: destination event % already has this place associated/,
  );
});

test("Event Only rows have no duplicate check at all -- no fuzzy name/address matching is invented as identity for them", () => {
  const body = functionBody("reassign_event_nearby_place");
  assert.equal(/name.*=.*address|address.*=.*name|ILIKE/i.test(body), false);
});

// ---------------------------------------------------------------------------
// 11. Sort order convention
// ---------------------------------------------------------------------------

test("11. sort_order is appended after the destination Event's current maximum, matching associate_nearby_master_place_with_event's (Stage 2) identical convention", () => {
  const body = functionBody("reassign_event_nearby_place");
  const expr = "v_sort_order := COALESCE(\n    (SELECT max(sort_order) FROM public.event_nearby_places WHERE event_id = p_destination_event_id),\n    0\n  ) + 1;";
  assert.ok(body.includes(expr));
  assert.ok(STAGE2_SQL.includes("v_sort_order := COALESCE(\n    (SELECT max(sort_order) FROM public.event_nearby_places WHERE event_id = p_event_id),\n    0\n  ) + 1;"));
});

// ---------------------------------------------------------------------------
// 12. Archived/hidden master state does not block moving an already-linked row
// ---------------------------------------------------------------------------

test("12. no status or review_status check exists anywhere in reassign_event_nearby_place -- an already-linked place's archived/hidden state, or any future review_status change, never blocks moving the Event's existing snapshot", () => {
  const body = functionBody("reassign_event_nearby_place");
  assert.equal(/v_place\.status|v_place\.review_status/.test(body), false);
});

test("the chosen canonical-state semantics are documented, not merely coded", () => {
  assert.match(SQL, /CANONICAL-STATE QUESTION, decided:/);
  assert.match(SQL, /Only the Tenant\/scope match is re-validated on move; no\s*\n-- status or review_status check exists in this function at all\./);
});

// ---------------------------------------------------------------------------
// No new client-supplied claims; lifecycle precedent
// ---------------------------------------------------------------------------

test("assert_event_lifecycle_mutable is checked for both the source and destination Event", () => {
  const body = functionBody("reassign_event_nearby_place");
  assert.match(body, /PERFORM public\.assert_event_lifecycle_mutable\(v_source_event_id\);/);
  assert.match(body, /PERFORM public\.assert_event_lifecycle_mutable\(p_destination_event_id\);/);
});

test("EXECUTE for reassign_event_nearby_place is revoked from PUBLIC/anon/authenticated/service_role then granted to authenticated only", () => {
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.reassign_event_nearby_place\(uuid, uuid\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.match(SQL, /GRANT EXECUTE ON FUNCTION public\.reassign_event_nearby_place\(uuid, uuid\) TO authenticated;/);
});

// ---------------------------------------------------------------------------
// 13 & 14. anon mutation/TRUNCATE removed
// ---------------------------------------------------------------------------

test("13 & 14. anon's entire table-level privilege set on nearby_master is revoked in one statement -- INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/SELECT all removed, not itemized (matching the exact precedent already used for event_nearby_places/master_maps)", () => {
  assert.match(EXECUTABLE, /REVOKE ALL ON TABLE public\.nearby_master FROM anon;/);
});

// ---------------------------------------------------------------------------
// 15. Direct anon SELECT
// ---------------------------------------------------------------------------

test("15. both previously anon-inclusive SELECT policies are dropped by exact name; the replacement policy is authenticated-only", () => {
  assert.match(EXECUTABLE, /DROP POLICY "Anyone can view nearby master" ON public\.nearby_master;/);
  assert.match(EXECUTABLE, /DROP POLICY "public read nearby_master" ON public\.nearby_master;/);
  assert.match(
    EXECUTABLE,
    /CREATE POLICY nearby_master_authenticated_select_policy\s*\n\s*ON public\.nearby_master\s*\n\s*FOR SELECT\s*\n\s*TO authenticated\s*\n\s*USING \(true\);/,
  );
});

test("the consumer audit proving no accepted path needs anon SELECT is documented in the migration header, not merely asserted", () => {
  assert.match(SQL, /repository-wide grep of every `\.from\("nearby_master"\)` call finds\s*\n-- exactly one file/);
  assert.match(SQL, /No anon-facing page, component, or member-side surface reads\s*\n-- nearby_master directly, anywhere\./);
});

// ---------------------------------------------------------------------------
// 16 & 17. Authenticated write policy reconciled, documented as temporary
// ---------------------------------------------------------------------------

test("16. the legacy authenticated write policy is dropped by its exact old name and replaced by an explicitly-named, functionally identical bridge policy -- same three privilege_group values, neither broadened nor narrowed", () => {
  assert.match(EXECUTABLE, /DROP POLICY "Admins can manage nearby master" ON public\.nearby_master;/);
  assert.match(
    EXECUTABLE,
    /CREATE POLICY nearby_master_legacy_authenticated_write_bridge\s*\n\s*ON public\.nearby_master\s*\n\s*FOR ALL\s*\n\s*TO authenticated/,
  );
  const bridgeStart = EXECUTABLE.indexOf("CREATE POLICY nearby_master_legacy_authenticated_write_bridge");
  const bridgeBlock = EXECUTABLE.slice(bridgeStart, EXECUTABLE.indexOf(";", EXECUTABLE.indexOf(";", bridgeStart) + 1) + 1);
  assert.match(bridgeBlock, /privilege_group = ANY \(ARRAY\['super_admin', 'event_admin', 'content_admin'\]\)/);
});

test("17. no canonical governed RPC's own access is affected -- none of Stage 0/1/2's functions, nor this migration's own reassign_event_nearby_place, are redefined or re-granted by Part B (they are untouched SECURITY DEFINER functions, unaffected by table RLS either way)", () => {
  const partBStart = SQL.indexOf("-- PART B --");
  const partB = SQL.slice(partBStart);
  assert.equal(/CREATE OR REPLACE FUNCTION|GRANT EXECUTE|REVOKE ALL ON FUNCTION/.test(partB), false);
});

test("the exact production dependency kept alive by the temporary bridge, and its exact retirement condition, are both documented", () => {
  assert.match(SQL, /8 of 11 live admin_users rows in\s*\n-- privilege_group 'event_admin'/);
  assert.match(SQL, /5 call sites: saveStoredPlace's\s*\n-- insert\+update, deleteStoredPlace's hard delete, and\s*\n-- bulkGeocodeStoredPlaces\/reGeocodeStoredPlace's lat\/lng-only updates\./);
  assert.match(SQL, /Stage 3 MUST drop this\s*\n-- policy \(`DROP POLICY nearby_master_legacy_authenticated_write_bridge/);
});

test("the five raw write call sites the bridge exists for are still present in the admin page, confirmed live rather than assumed stale", () => {
  const writeCallSites = [
    /\.from\("nearby_master"\)\s*\n\s*\.update\(payload\)/, // saveStoredPlace update
    /supabase\.from\("nearby_master"\)\.insert\(payload\)/, // saveStoredPlace insert
    /\.from\("nearby_master"\)\s*\n\s*\.delete\(\)/, // deleteStoredPlace
  ];
  for (const pattern of writeCallSites) {
    assert.match(PAGE_SOURCE, pattern);
  }
  const geocodeUpdates = [...PAGE_SOURCE.matchAll(/\.from\("nearby_master"\)\s*\n\s*\.update\(\{\s*\n\s*lat: resolved\.lat,\s*\n\s*lng: resolved\.lng,\s*\n\s*\}\)/g)];
  assert.equal(geocodeUpdates.length, 2, "expected exactly bulkGeocodeStoredPlaces and reGeocodeStoredPlace's lat/lng-only updates");
});

// ---------------------------------------------------------------------------
// 18. Tenant Admin cannot gain Shared canonical edit/retire authority via raw access
// ---------------------------------------------------------------------------

test("18. the preserved bridge policy's predicate is admin_users.privilege_group only -- it never references has_tenant_admin_authority or has_platform_admin_authority, so it grants no Tenant Admin any NEW authority over canonical Shared metadata beyond what the legacy predicate already granted (unchanged, not broadened)", () => {
  const bridgeStart = EXECUTABLE.indexOf("CREATE POLICY nearby_master_legacy_authenticated_write_bridge");
  const bridgeBlock = EXECUTABLE.slice(bridgeStart, EXECUTABLE.indexOf(";", EXECUTABLE.indexOf(";", bridgeStart) + 1) + 1);
  assert.equal(/has_tenant_admin_authority|has_platform_admin_authority|contributed_by_tenant_id/.test(bridgeBlock), false);
});

// ---------------------------------------------------------------------------
// 19. Event Admin cannot create/modify Shared records once the bridge retires
// ---------------------------------------------------------------------------

test("19. this migration does not retire the bridge (that is Stage 3's job, documented as a precondition) -- but the exact condition for safely retiring it without breaking production is stated in full, including that record_tenant_place/update_nearby_master_place/retire_nearby_master_place are the required governed replacements", () => {
  assert.match(SQL, /Fully retiring this bridge requires migrating all five call sites to\s*\n-- record_tenant_place\/update_nearby_master_place\/\s*\n-- retire_nearby_master_place/);
});

// ---------------------------------------------------------------------------
// 20. Migration owns the intended state explicitly
// ---------------------------------------------------------------------------

test("20. this migration explicitly DROP/CREATEs every one of the three previously-untracked live policies by their exact live names -- the repository no longer relies on undocumented manual policy state for nearby_master", () => {
  for (const policyName of [
    '"Admins can manage nearby master"',
    '"Anyone can view nearby master"',
    '"public read nearby_master"',
  ]) {
    assert.match(EXECUTABLE, new RegExp(`DROP POLICY ${policyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ON public\\.nearby_master;`));
  }
  const createdPolicies = [...EXECUTABLE.matchAll(/CREATE POLICY (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(
    createdPolicies.sort(),
    ["nearby_master_authenticated_select_policy", "nearby_master_legacy_authenticated_write_bridge"].sort(),
  );
});

// ---------------------------------------------------------------------------
// 21, 22, 23. Stage 0/1/2 preserved
// ---------------------------------------------------------------------------

test("21, 22, 23. Stage 0/1/2 functions are not redefined by this migration", () => {
  assert.equal(
    /record_tenant_place|review_shared_place|search_shared_places|update_nearby_master_place|retire_nearby_master_place|associate_nearby_master_place_with_event/.test(
      EXECUTABLE,
    ),
    false,
  );
});

test("Stage 0/1/2 migration files remain independently unmodified on disk", () => {
  assert.match(STAGE0_SQL, /has_tenant_admin_authority\(auth\.uid\(\), p_tenant_id\)/);
  assert.match(STAGE1_SQL, /CREATE OR REPLACE FUNCTION public\.update_nearby_master_place/);
  assert.match(STAGE2_SQL, /CREATE OR REPLACE FUNCTION public\.associate_nearby_master_place_with_event/);
});

test("contributed_by_tenant_id semantics are untouched -- no ALTER TABLE, no CHECK/index/FK reference anywhere in this migration", () => {
  assert.equal(/contributed_by_tenant_id/.test(EXECUTABLE), false);
});

// ---------------------------------------------------------------------------
// 24. No Stage 3 UI
// ---------------------------------------------------------------------------

test("24. no unified-editor, scope-selector, Move UI, or confirmation-message concept appears in any executable statement", () => {
  assert.equal(/scope.*selector|destination.*selector|dirty.edit|unified.*editor|confirmation.*banner/i.test(EXECUTABLE), false);
});

test("no scope-conversion behavior is introduced -- scope, tenant_id, and contributed_by_tenant_id are never assigned anywhere in this migration's executable SQL", () => {
  assert.equal(/SET\s+(?:[^;]*,\s*)?(scope|tenant_id|contributed_by_tenant_id)\s*=/s.test(EXECUTABLE.replace(/reassign_event_nearby_place[\s\S]*?\$function\$;/, "")), false);
});

test("only one function is created/replaced by this migration", () => {
  const created = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(created, ["reassign_event_nearby_place"]);
});

test("no direct table INSERT/UPDATE/DELETE grant is added to nearby_master, event_nearby_places, or tenant_place_relevance -- mutation stays inside SECURITY DEFINER functions and the one deliberately-preserved bridge policy", () => {
  assert.equal(/GRANT (INSERT|UPDATE|DELETE) ON (TABLE )?public\.(nearby_master|event_nearby_places|tenant_place_relevance)/.test(SQL), false);
});
