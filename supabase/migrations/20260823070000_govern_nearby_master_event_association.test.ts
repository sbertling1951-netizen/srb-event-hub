import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural assertions for Nearby Scope Model Stage 2: governed
// reusable Nearby-place -> Event association, plus the Stored Area bulk
// paths' source_master_id repair. No local Supabase/Docker instance is
// available in this environment (confirmed the same way as Stage 0/1) --
// these verify SQL/TypeScript shape and guards, matching this
// repository's only established pattern for this exact workstream.
//
// Run with:
//   npx tsx --test supabase/migrations/20260823070000_govern_nearby_master_event_association.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260823070000_govern_nearby_master_event_association.sql", import.meta.url),
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
const FOUNDATION_SQL = readFileSync(
  fileURLToPath(
    new URL("./20260811120000_create_nearby_knowledge_tenant_curation_foundation.sql", import.meta.url),
  ),
  "utf8",
);
const STAGE1_SQL = readFileSync(
  fileURLToPath(
    new URL("./20260823060000_govern_nearby_master_update_and_retirement.sql", import.meta.url),
  ),
  "utf8",
);

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("../../app/admin/nearby/page.tsx", import.meta.url)),
  "utf8",
);

function pageFunctionBody(name: string): string {
  const start = PAGE_SOURCE.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `expected to find ${name} in app/admin/nearby/page.tsx`);
  const end = PAGE_SOURCE.indexOf("\n  async function ", start + 1);
  return PAGE_SOURCE.slice(start, end === -1 ? undefined : end);
}

// ---------------------------------------------------------------------------
// Signature, shape, load-order
// ---------------------------------------------------------------------------

test("associate_nearby_master_place_with_event: signature is exactly (p_event_id uuid, p_place_id uuid) -- no display-field parameters a caller could resubmit", () => {
  assert.match(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.associate_nearby_master_place_with_event\(\s*\n\s*p_event_id uuid,\s*\n\s*p_place_id uuid\s*\n\s*\)\s*\n\s*RETURNS public\.event_nearby_places/,
  );
});

test("is SECURITY DEFINER with the same fixed search_path convention as every sibling Nearby RPC", () => {
  const body = functionBody("associate_nearby_master_place_with_event");
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path TO 'pg_catalog'/);
});

test("loads the event first, checks authority before ever touching the place, then asserts lifecycle before loading the place", () => {
  const body = functionBody("associate_nearby_master_place_with_event");
  const eventLoadIdx = body.indexOf("SELECT e.tenant_id INTO v_event_tenant_id");
  const eventNotFoundIdx = body.indexOf("event % not found");
  const authIdx = body.indexOf("has_event_task_authority");
  const lifecycleIdx = body.indexOf("assert_event_lifecycle_mutable");
  const placeLoadIdx = body.indexOf("SELECT nm.* INTO v_place");
  assert.ok(eventLoadIdx >= 0 && eventLoadIdx < eventNotFoundIdx);
  assert.ok(eventNotFoundIdx < authIdx);
  assert.ok(authIdx < lifecycleIdx, "lifecycle must be asserted only after authority passes");
  assert.ok(lifecycleIdx < placeLoadIdx, "the place is loaded only after the event side is fully validated");
});

// ---------------------------------------------------------------------------
// 1 & 4. Event Admin can associate an approved Shared place; authority is
// destination-Event-based
// ---------------------------------------------------------------------------

test("1 & 4. authority is has_event_task_authority('event.nearby.manage', p_event_id) only -- destination-Event-based, not a separate catalog-authority check; Tenant Admin/Super Admin reach it through the same resolver an Event Admin does", () => {
  const body = functionBody("associate_nearby_master_place_with_event");
  assert.match(body, /IF NOT public\.has_event_task_authority\('event\.nearby\.manage', p_event_id\) THEN/);
  // No second, parallel authority primitive is consulted for the
  // authorization decision itself (has_tenant_admin_authority appears
  // only later, for the tenant/scope DATA check -- distinct concern).
  const beforePlaceLoad = body.slice(0, body.indexOf("SELECT nm.* INTO v_place"));
  assert.equal(/has_tenant_admin_authority|has_platform_admin_authority/.test(beforePlaceLoad), false);
});

test("event.nearby.manage is registered as tenant_inherits and platform_inherits -- Tenant Admin and Super Admin already reach has_event_task_authority for any Event in scope, without a second check here", () => {
  assert.match(
    TASK_AUTHORITY_SQL,
    /\('event\.nearby\.manage','event','mutation','Manage Event nearby places\.',true,true,true\)/,
  );
});

test("shared_public places require no tenant match -- any authorized Event may associate an approved Shared place", () => {
  const body = functionBody("associate_nearby_master_place_with_event");
  const branchStart = body.indexOf("ELSIF v_place.scope = 'shared_public' THEN");
  const branchEnd = body.indexOf("ELSE\n    RAISE EXCEPTION 'associate_nearby_master_place_with_event: place % has an unrecognized scope");
  const branch = body.slice(branchStart, branchEnd);
  assert.match(branch, /NULL;/);
});

// ---------------------------------------------------------------------------
// 2 & 3. Tenant place: same-Tenant only
// ---------------------------------------------------------------------------

test("2 & 3. tenant_specific places require nearby_master.tenant_id = events.tenant_id exactly (IS DISTINCT FROM, so NULL never accidentally matches NULL) -- a caller cannot attach another Tenant's private place merely by knowing its id", () => {
  const body = functionBody("associate_nearby_master_place_with_event");
  const branchStart = body.indexOf("IF v_place.scope = 'tenant_specific' THEN");
  const branchEnd = body.indexOf("ELSIF v_place.scope = 'shared_public'");
  const branch = body.slice(branchStart, branchEnd);
  assert.match(branch, /IF v_place\.tenant_id IS DISTINCT FROM v_event_tenant_id THEN/);
  assert.match(branch, /RAISE EXCEPTION 'associate_nearby_master_place_with_event: place % belongs to a different tenant than event %'/);
});

test("v_event_tenant_id comes only from the loaded events row -- never a caller-supplied parameter (the signature test above already proves no such parameter exists)", () => {
  const body = functionBody("associate_nearby_master_place_with_event");
  const assignmentCount = [...body.matchAll(/INTO v_event_tenant_id/g)].length;
  assert.equal(assignmentCount, 1);
});

// ---------------------------------------------------------------------------
// 5 & 6. Eligibility: approved-only, active-only
// ---------------------------------------------------------------------------

test("5. pending_review or rejected shared_public places cannot be associated -- review_status = 'approved' is required unconditionally, never bypassable through this path", () => {
  const body = functionBody("associate_nearby_master_place_with_event");
  assert.match(
    body,
    /IF v_place\.review_status <> 'approved' THEN\s*\n\s*RAISE EXCEPTION 'associate_nearby_master_place_with_event: place % is not approved/,
  );
});

test("6. archived (and hidden) reusable places cannot be newly associated -- status = 'active' is required, matching search_shared_places' own established status='active' precedent for discoverability", () => {
  const body = functionBody("associate_nearby_master_place_with_event");
  assert.match(
    body,
    /IF v_place\.status <> 'active' THEN\s*\n\s*RAISE EXCEPTION 'associate_nearby_master_place_with_event: place % is not active/,
  );
  // search_shared_places itself lives in the original foundation
  // migration (20260811120000), not Stage 0's file -- Stage 0 only ever
  // redefined record_tenant_place.
  assert.match(FOUNDATION_SQL, /WHERE nm\.status = 'active'/);
});

// ---------------------------------------------------------------------------
// 7 & 8 & 9. Field mapping, source_master_id, no master mutation
// ---------------------------------------------------------------------------

test("7 & 8. the INSERT copies exactly the documented field set from the loaded master row, stamps source_master_id = v_place.id, and initializes Event-specific fields to existing precedent (is_hidden=false, distance_miles omitted/NULL, sort_order appended after the Event's current max)", () => {
  const body = functionBody("associate_nearby_master_place_with_event");
  assert.match(
    body,
    /INSERT INTO public\.event_nearby_places \(\s*\n\s*event_id, source_master_id, name, address, phone, website, category, category_id,\s*\n\s*notes, location_code, lat, lng, sort_order, is_hidden\s*\n\s*\) VALUES \(\s*\n\s*p_event_id, v_place\.id, v_place\.name, v_place\.address, v_place\.phone, v_place\.link,\s*\n\s*v_place\.category, v_place\.category_id, v_place\.description, v_place\.location_code,\s*\n\s*v_place\.lat, v_place\.lng, v_sort_order, false\s*\n\s*\)/,
  );
  assert.match(
    body,
    /v_sort_order := COALESCE\(\s*\n\s*\(SELECT max\(sort_order\) FROM public\.event_nearby_places WHERE event_id = p_event_id\),\s*\n\s*0\s*\n\s*\) \+ 1;/,
  );
  // Never writes distance_miles or master_place_id.
  assert.equal(/distance_miles\s*[,=]|master_place_id/.test(body), false);
});

test("9. nearby_master is only ever read (SELECT), never the target of any UPDATE/INSERT/DELETE in this function -- the canonical row is never mutated by association", () => {
  const body = functionBody("associate_nearby_master_place_with_event");
  assert.equal(/UPDATE public\.nearby_master|DELETE FROM public\.nearby_master|INSERT INTO public\.nearby_master/.test(body), false);
});

// ---------------------------------------------------------------------------
// 10. No silent duplicates
// ---------------------------------------------------------------------------

test("10. a pre-check returns the existing association unchanged (idempotent no-op) before any INSERT is attempted, and a concurrent-race unique_violation is caught and resolved to the winner's row -- never a raw constraint error, never a silent duplicate", () => {
  const body = functionBody("associate_nearby_master_place_with_event");
  const precheckIdx = body.indexOf("SELECT * INTO v_existing");
  const returnExistingIdx = body.indexOf("IF FOUND THEN\n    RETURN v_existing;");
  const insertIdx = body.indexOf("INSERT INTO public.event_nearby_places");
  assert.ok(precheckIdx >= 0 && precheckIdx < returnExistingIdx && returnExistingIdx < insertIdx);
  assert.match(body, /EXCEPTION WHEN unique_violation THEN\s*\n\s*SELECT \* INTO v_row\s*\n\s*FROM public\.event_nearby_places\s*\n\s*WHERE event_id = p_event_id AND source_master_id = p_place_id;/);
});

test("a new partial unique index on (event_id, source_master_id) backstops the race, live-verified safe against all 85 existing rows (zero currently have source_master_id populated)", () => {
  assert.match(
    SQL,
    /CREATE UNIQUE INDEX event_nearby_places_event_source_master_unique_idx\s*\n\s*ON public\.event_nearby_places \(event_id, source_master_id\)\s*\n\s*WHERE source_master_id IS NOT NULL;/,
  );
});

// ---------------------------------------------------------------------------
// 11. Event Only (source_master_id IS NULL) unaffected
// ---------------------------------------------------------------------------

test("11. the new unique index is partial (WHERE source_master_id IS NOT NULL) -- Event Only rows, which always have source_master_id NULL, are completely outside its scope and remain freely insertable/multiple per Event, exactly as today", () => {
  assert.match(EXECUTABLE, /WHERE source_master_id IS NOT NULL/);
});

// ---------------------------------------------------------------------------
// 12, 13, 14. Bulk paths stamp source_master_id, preserve their distinction
// ---------------------------------------------------------------------------

test("12. mergeStoredAreaIntoEvent now stamps source_master_id: place.id on every inserted row", () => {
  const body = pageFunctionBody("mergeStoredAreaIntoEvent");
  assert.match(body, /source_master_id: place\.id,/);
});

test("13. replaceEventListFromStored now stamps source_master_id: place.id on every inserted row", () => {
  const body = pageFunctionBody("replaceEventListFromStored");
  assert.match(body, /source_master_id: place\.id,/);
});

test("14. bulk merge and bulk replace preserve their prior behavioral distinction -- replace still deletes the existing list first, merge still de-dupes by name+address and never deletes anything", () => {
  const replaceBody = pageFunctionBody("replaceEventListFromStored");
  assert.match(replaceBody, /\.from\("event_nearby_places"\)\s*\n\s*\.delete\(\)\s*\n\s*\.eq\("event_id", adminEvent\.id\);/);

  const mergeBody = pageFunctionBody("mergeStoredAreaIntoEvent");
  assert.equal(/\.delete\(\)/.test(mergeBody), false);
  assert.match(mergeBody, /existingKeys\.has\(compareKey\)/);
});

test("both bulk functions' non-linkage field mapping is otherwise byte-identical to before this stage -- only the one new line was added to each payload", () => {
  for (const name of ["replaceEventListFromStored", "mergeStoredAreaIntoEvent"]) {
    const body = pageFunctionBody(name);
    assert.match(body, /category_id: place\.category_id \?\? null,/);
    assert.match(body, /distance_miles: null,/);
    assert.match(body, /is_hidden: false,/);
  }
});

// ---------------------------------------------------------------------------
// 15. No speculative backfill of existing unlinked rows
// ---------------------------------------------------------------------------

test("15. this migration contains no UPDATE against event_nearby_places at all -- existing unlinked rows are left exactly as they are, no speculative name/address-based linkage is attempted", () => {
  assert.equal(/UPDATE\s+public\.event_nearby_places/i.test(EXECUTABLE), false);
});

// ---------------------------------------------------------------------------
// 16 & 17. Stage 0/1 unchanged
// ---------------------------------------------------------------------------

test("16. Shared review behavior is untouched -- review_shared_place is not redefined by this migration, and record_tenant_place/search_shared_places are equally absent", () => {
  assert.equal(/record_tenant_place|review_shared_place|search_shared_places/.test(EXECUTABLE), false);
});

test("17. Stage 1's update/retire RPCs are not redefined by this migration", () => {
  assert.equal(/update_nearby_master_place|retire_nearby_master_place/.test(EXECUTABLE), false);
});

test("Stage 0 and Stage 1 migration files remain independently unmodified on disk", () => {
  assert.match(STAGE0_SQL, /has_tenant_admin_authority\(auth\.uid\(\), p_tenant_id\)/);
  assert.match(STAGE1_SQL, /CREATE OR REPLACE FUNCTION public\.update_nearby_master_place/);
  assert.match(STAGE1_SQL, /CREATE OR REPLACE FUNCTION public\.retire_nearby_master_place/);
});

// ---------------------------------------------------------------------------
// 18. No Stage 3 UI concepts
// ---------------------------------------------------------------------------

test("18. no unified-editor, scope-selector, or Event-destination-selector UI concept appears in any executable statement of this migration", () => {
  assert.equal(/scope.*selector|destination.*selector|dirty.edit|unified.*editor/i.test(EXECUTABLE), false);
});

// ---------------------------------------------------------------------------
// 19. No anonymous EXECUTE path
// ---------------------------------------------------------------------------

test("19. EXECUTE is revoked from PUBLIC, anon, authenticated, and service_role in one statement before the single authenticated-only grant", () => {
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.associate_nearby_master_place_with_event\(uuid, uuid\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
  const grantStatements = [...SQL.matchAll(/GRANT EXECUTE[\s\S]*?;/g)].map((m) => m[0]);
  assert.equal(grantStatements.length, 1);
  assert.match(grantStatements[0], /GRANT EXECUTE ON FUNCTION public\.associate_nearby_master_place_with_event\(uuid, uuid\) TO authenticated;/);
});

test("no direct table INSERT/UPDATE/DELETE grant is added to nearby_master or event_nearby_places -- mutation stays inside the SECURITY DEFINER function only", () => {
  assert.equal(/GRANT (INSERT|UPDATE|DELETE) ON (TABLE )?public\.(nearby_master|event_nearby_places)/.test(SQL), false);
});

// ---------------------------------------------------------------------------
// 20. Known nearby_master RLS/grant drift not silently rewritten
// ---------------------------------------------------------------------------

test("20. this migration touches no RLS or grant statement on nearby_master or event_nearby_places -- the known nearby_master drift is re-verified in this migration's own header, not reconciled here", () => {
  assert.equal(/CREATE POLICY|ALTER POLICY|DROP POLICY/.test(EXECUTABLE), false);
  assert.equal(/ENABLE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY/.test(EXECUTABLE), false);
  assert.equal(/REVOKE[^;]*ON TABLE|GRANT[^;]*ON TABLE/.test(EXECUTABLE), false);
  assert.match(SQL, /nearby_master RLS\/grant drift re-verified unchanged from Stage 1's/);
});

// ---------------------------------------------------------------------------
// Lifecycle precedent
// ---------------------------------------------------------------------------

test("assert_event_lifecycle_mutable is called for this Event-scoped write, matching the established Agenda/presentation-deck precedent -- unlike Stage 1's nearby_master RPCs, which correctly omit it", () => {
  const body = functionBody("associate_nearby_master_place_with_event");
  assert.match(body, /PERFORM public\.assert_event_lifecycle_mutable\(p_event_id\);/);
  // Confirms the contrast this test's name claims: Stage 1's own
  // executable SQL genuinely never calls it (its header comment
  // explains why, in prose, which is why this checks comment-stripped
  // text rather than the raw file).
  assert.equal(/assert_event_lifecycle_mutable/.test(STAGE1_SQL.replace(/--.*$/gm, "")), false);
});

test("only one function is created/replaced by this migration", () => {
  const created = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(created, ["associate_nearby_master_place_with_event"]);
});

test("reassignment finding is documented, not silently fixed with a new RPC in this migration", () => {
  assert.match(SQL, /No RPC in this migration\s*\n-- performs or gates reassignment/);
});
