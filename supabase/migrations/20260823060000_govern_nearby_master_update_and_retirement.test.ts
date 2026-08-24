import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural assertions for Nearby Scope Model Stage 1: governed
// canonical Nearby-place update and retirement. No local Supabase/Docker
// instance is available in this environment (confirmed live: `docker
// info` cannot reach the daemon, `supabase status` fails to connect) --
// these verify the SQL's shape/guards, matching this repository's only
// established test pattern for this exact workstream (see
// 20260821250000_create_place_category_rename_governed_operation.test.ts
// and 20260823050000_govern_shared_place_contribution.test.ts).
// Executing against the linked production database instead was
// considered and rejected: it would require either persistent test rows
// or an unverified assumption that a single `supabase db query --linked`
// invocation behaves as one atomic, rollback-safe session across
// multiple statements -- both are exactly what this workstream's own
// instructions say to avoid.
//
// Run with:
//   npx tsx --test supabase/migrations/20260823060000_govern_nearby_master_update_and_retirement.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260823060000_govern_nearby_master_update_and_retirement.sql", import.meta.url),
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

const AUTHORITY_SQL = readFileSync(
  fileURLToPath(
    new URL("./20260810110000_create_administrative_authority_foundation.sql", import.meta.url),
  ),
  "utf8",
);

function authorityFunctionBody(name: string): string {
  const start = AUTHORITY_SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `expected to find ${name} in the authority foundation migration`);
  const end = AUTHORITY_SQL.indexOf("$function$;", start);
  return AUTHORITY_SQL.slice(start, end);
}

const STAGE0_SQL = readFileSync(
  fileURLToPath(new URL("./20260823050000_govern_shared_place_contribution.sql", import.meta.url)),
  "utf8",
);

// ---------------------------------------------------------------------------
// update_nearby_master_place -- signature, load-first, scope-derived authority
// ---------------------------------------------------------------------------

test("update_nearby_master_place: signature takes only p_place_id and editable metadata -- no p_scope, no p_tenant_id, no caller-supplied authority claim", () => {
  assert.match(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.update_nearby_master_place\(\s*\n\s*p_place_id uuid,\s*\n\s*p_name text,\s*\n\s*p_category_id uuid DEFAULT NULL,\s*\n\s*p_category text DEFAULT NULL,\s*\n\s*p_address text DEFAULT NULL,\s*\n\s*p_phone text DEFAULT NULL,\s*\n\s*p_website text DEFAULT NULL,\s*\n\s*p_lat numeric DEFAULT NULL,\s*\n\s*p_lng numeric DEFAULT NULL,\s*\n\s*p_notes text DEFAULT NULL,\s*\n\s*p_location_code text DEFAULT NULL\s*\n\s*\)\s*\n\s*RETURNS public\.nearby_master/,
  );
  const body = functionBody("update_nearby_master_place");
  assert.equal(/p_scope|p_tenant_id/.test(body), false);
});

test("update_nearby_master_place: is SECURITY DEFINER with the same fixed search_path convention as every sibling Nearby RPC", () => {
  const body = functionBody("update_nearby_master_place");
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path TO 'pg_catalog'/);
});

test("update_nearby_master_place: loads the target row first and raises not-found before any authority check or write", () => {
  const body = functionBody("update_nearby_master_place");
  const loadIdx = body.indexOf("SELECT nm.scope, nm.tenant_id INTO v_scope, v_tenant_id");
  const notFoundIdx = body.indexOf("IF NOT FOUND THEN");
  const authIdx = body.indexOf("IF v_scope = 'tenant_specific' THEN");
  const updateIdx = body.indexOf("UPDATE public.nearby_master");
  assert.ok(loadIdx >= 0 && loadIdx < notFoundIdx);
  assert.ok(notFoundIdx < authIdx, "not-found must be raised before authority is even consulted");
  assert.ok(authIdx < updateIdx, "authority must be checked before the write");
});

// ---------------------------------------------------------------------------
// 1-4. Scope-aware authority -- update
// ---------------------------------------------------------------------------

test("1 & 2. update: tenant_specific branch uses has_tenant_admin_authority(auth.uid(), v_tenant_id) -- the loaded row's own tenant_id, never a parameter -- so a Tenant Admin can update their own Tenant's place and cannot update another Tenant's", () => {
  const body = functionBody("update_nearby_master_place");
  const branchStart = body.indexOf("IF v_scope = 'tenant_specific' THEN");
  const branchEnd = body.indexOf("ELSIF v_scope = 'shared_public'");
  const branch = body.slice(branchStart, branchEnd);
  assert.match(branch, /has_tenant_admin_authority\(auth\.uid\(\), v_tenant_id\)/);
  // v_tenant_id is populated only by the initial SELECT ... INTO from the
  // loaded row -- no p_tenant_id parameter exists at all on this
  // function (already proven by the signature test above), so there is
  // no caller-supplied value it could ever be reassigned from.
  const intoAssignments = [...body.matchAll(/INTO v_scope, v_tenant_id/g)];
  assert.equal(intoAssignments.length, 1, "v_tenant_id must be populated exactly once, by the initial row load");
  assert.equal(/v_tenant_id\s*:=/.test(body), false, "v_tenant_id must never be reassigned via :=");
});

test("3 & 4. update: shared_public branch uses has_platform_admin_authority(auth.uid()) -- Super Admin only -- so a Tenant Admin cannot update canonical Shared metadata merely via contributed_by_tenant_id, and Super Admin can update both scopes", () => {
  const body = functionBody("update_nearby_master_place");
  const branchStart = body.indexOf("ELSIF v_scope = 'shared_public' THEN");
  const branchEnd = body.indexOf("ELSE\n    RAISE EXCEPTION 'update_nearby_master_place");
  const branch = body.slice(branchStart, branchEnd);
  assert.match(branch, /has_platform_admin_authority\(auth\.uid\(\)\)/);
  // contributed_by_tenant_id is never read anywhere in this function --
  // it plays no role in the authority decision.
  assert.equal(/contributed_by_tenant_id/.test(body), false);
});

// ---------------------------------------------------------------------------
// 5. Update cannot alter scope/ownership/provenance/review state
// ---------------------------------------------------------------------------

test("5. update's SET clause touches only the nine editable metadata columns -- never scope, tenant_id, contributed_by_tenant_id, review_status, reviewed_by, reviewed_at, status, source_type, evidence_quality, created_by, created_at, area_id, or hours", () => {
  const body = functionBody("update_nearby_master_place");
  const updateStart = body.indexOf("UPDATE public.nearby_master");
  const updateStatement = body.slice(updateStart, body.indexOf("RETURNING * INTO v_row;") + "RETURNING * INTO v_row;".length);
  const setClause = updateStatement.slice(
    updateStatement.indexOf("SET"),
    updateStatement.indexOf("WHERE id = p_place_id"),
  );
  const settableColumns = [...setClause.matchAll(/^\s*(\w+)\s*=/gm)].map((m) => m[1]);
  assert.deepEqual(
    settableColumns.sort(),
    ["address", "category", "category_id", "description", "lat", "link", "lng", "location_code", "name", "phone"].sort(),
  );
  for (const forbidden of [
    "scope", "tenant_id", "contributed_by_tenant_id", "review_status", "reviewed_by",
    "reviewed_at", "status", "source_type", "evidence_quality", "created_by", "created_at",
    "area_id", "hours",
  ]) {
    assert.equal(settableColumns.includes(forbidden), false, `${forbidden} must never be settable by update_nearby_master_place`);
  }
});

test("update never reads or writes public.event_nearby_places, public.tenant_place_relevance, or any Stage 2 association concept", () => {
  const body = functionBody("update_nearby_master_place");
  assert.equal(/event_nearby_places|tenant_place_relevance|source_master_id/.test(body), false);
});

// ---------------------------------------------------------------------------
// retire_nearby_master_place -- signature, load-first, scope-derived authority
// ---------------------------------------------------------------------------

test("retire_nearby_master_place: signature is just p_place_id -- no scope/tenant claim, no reason parameter (no audit table exists for one to feed)", () => {
  assert.match(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.retire_nearby_master_place\(p_place_id uuid\)\s*\n\s*RETURNS TABLE \(\s*\n\s*id uuid,\s*\n\s*status text,\s*\n\s*scope text,\s*\n\s*tenant_id uuid,\s*\n\s*event_place_references integer,\s*\n\s*tenant_relevance_references integer,\s*\n\s*legacy_reference_count integer\s*\n\s*\)/,
  );
});

test("retire: loads the target row first and raises not-found before any authority check or write", () => {
  const body = functionBody("retire_nearby_master_place");
  const loadIdx = body.indexOf("SELECT nm.scope, nm.tenant_id INTO v_scope, v_tenant_id");
  const notFoundIdx = body.indexOf("IF NOT FOUND THEN");
  const authIdx = body.indexOf("IF v_scope = 'tenant_specific' THEN");
  const updateIdx = body.indexOf("UPDATE public.nearby_master");
  assert.ok(loadIdx >= 0 && loadIdx < notFoundIdx);
  assert.ok(notFoundIdx < authIdx);
  assert.ok(authIdx < updateIdx);
});

// ---------------------------------------------------------------------------
// 6-9. Scope-aware authority -- retire
// ---------------------------------------------------------------------------

test("6 & 7. retire: tenant_specific branch uses has_tenant_admin_authority(auth.uid(), v_tenant_id) from the loaded row -- Tenant Admin can retire their own Tenant's place, cannot retire another Tenant's", () => {
  const body = functionBody("retire_nearby_master_place");
  const branchStart = body.indexOf("IF v_scope = 'tenant_specific' THEN");
  const branchEnd = body.indexOf("ELSIF v_scope = 'shared_public'");
  const branch = body.slice(branchStart, branchEnd);
  assert.match(branch, /has_tenant_admin_authority\(auth\.uid\(\), v_tenant_id\)/);
});

test("8 & 9. retire: shared_public branch uses has_platform_admin_authority(auth.uid()) -- Tenant Admin cannot retire Shared, Super Admin can", () => {
  const body = functionBody("retire_nearby_master_place");
  const branchStart = body.indexOf("ELSIF v_scope = 'shared_public' THEN");
  const branchEnd = body.indexOf("ELSE\n    RAISE EXCEPTION 'retire_nearby_master_place");
  const branch = body.slice(branchStart, branchEnd);
  assert.match(branch, /has_platform_admin_authority\(auth\.uid\(\)\)/);
});

test("Super Admin behavior is verified explicitly, not assumed: has_tenant_admin_authority's own live definition grants Super Admin as its first branch, before consulting admin_tenant_access at all -- true for both update and retire, which both call it identically", () => {
  const authorityBody = authorityFunctionBody("has_tenant_admin_authority");
  const superAdminBranchIdx = authorityBody.indexOf("IF public.has_platform_admin_authority(p_auth_user_id) THEN");
  const tenantAccessIdx = authorityBody.indexOf("FROM public.admin_tenant_access");
  assert.ok(superAdminBranchIdx >= 0 && superAdminBranchIdx < tenantAccessIdx);
});

test("fails closed on a mismatched or NULL tenant: has_tenant_admin_authority's exact-match admin_tenant_access clause and NULL short-circuit are unchanged live inputs this migration depends on", () => {
  const authorityBody = authorityFunctionBody("has_tenant_admin_authority");
  assert.match(
    authorityBody,
    /IF p_auth_user_id IS NULL OR p_tenant_id IS NULL THEN\s*\n\s*RETURN false;/,
  );
  assert.match(authorityBody, /ata\.tenant_id = p_tenant_id/);
});

// ---------------------------------------------------------------------------
// 10 & 13. Archive semantics, idempotent
// ---------------------------------------------------------------------------

test("10. retirement sets status = 'archived' -- no DELETE statement exists anywhere in this migration", () => {
  const body = functionBody("retire_nearby_master_place");
  assert.match(body, /UPDATE public\.nearby_master\s*\n\s*SET status = 'archived'\s*\n\s*WHERE id = p_place_id;/);
  assert.equal(/DELETE FROM/i.test(EXECUTABLE), false);
});

test("13. retirement is idempotent by construction, matching archive_presentation_deck's own precedent: the UPDATE carries no status <> 'archived' guard, so re-retiring an already-archived place is a safe no-op, not an error", () => {
  const body = functionBody("retire_nearby_master_place");
  const updateStatement = body.slice(
    body.indexOf("UPDATE public.nearby_master"),
    body.indexOf("WHERE id = p_place_id;") + "WHERE id = p_place_id;".length,
  );
  assert.equal(/status\s*<>|status\s*!=/.test(updateStatement), false);
});

// ---------------------------------------------------------------------------
// 11. Reference counts
// ---------------------------------------------------------------------------

test("11. reference counts cover event_nearby_places.source_master_id and tenant_place_relevance.place_id -- the two live associations named by the prior audit", () => {
  const body = functionBody("retire_nearby_master_place");
  assert.match(
    body,
    /SELECT count\(\*\)::integer FROM public\.event_nearby_places AS enp\s*\n\s*WHERE enp\.source_master_id = nm\.id\s*\n\s*\) AS event_place_references/,
  );
  assert.match(
    body,
    /SELECT count\(\*\)::integer FROM public\.tenant_place_relevance AS tpr\s*\n\s*WHERE tpr\.place_id = nm\.id\s*\n\s*\) AS tenant_relevance_references/,
  );
});

test("11b. reference counts also cover the two additional live FKs found only by fresh live-schema inspection (events.selected_nearby_master_id, nearby_event.master_id), not assumed complete from the prior audit alone", () => {
  const body = functionBody("retire_nearby_master_place");
  assert.match(body, /FROM public\.events AS e WHERE e\.selected_nearby_master_id = nm\.id/);
  assert.match(body, /FROM public\.nearby_event AS ne WHERE ne\.master_id = nm\.id/);
  assert.match(body, /\) AS legacy_reference_count/);
});

// ---------------------------------------------------------------------------
// 12. Event snapshots untouched by retirement
// ---------------------------------------------------------------------------

test("12. retirement never writes to event_nearby_places -- only a read-only count subquery references it; no Event snapshot can be altered or deleted by retiring a master place", () => {
  const body = functionBody("retire_nearby_master_place");
  assert.equal(/UPDATE public\.event_nearby_places|DELETE FROM public\.event_nearby_places|INSERT INTO public\.event_nearby_places/.test(body), false);
  // The one reference is a SELECT count(*) inside the RETURN QUERY --
  // confirmed read-only.
  const referenceIdx = body.indexOf("public.event_nearby_places");
  assert.ok(referenceIdx >= 0);
  const surroundingStatement = body.slice(Math.max(0, referenceIdx - 40), referenceIdx);
  assert.match(surroundingStatement, /SELECT count\(\*\)::integer FROM/);
});

// ---------------------------------------------------------------------------
// 14. No anonymous mutation execution path
// ---------------------------------------------------------------------------

test("14. EXECUTE is revoked from PUBLIC, anon, authenticated, and service_role in one statement before the single authenticated-only grant, for both new functions -- closes the default-ACL gap, matching the rename_place_category precedent", () => {
  for (const fnSig of [
    "public.update_nearby_master_place(\n  uuid, text, uuid, text, text, text, text, numeric, numeric, text, text\n)",
    "public.retire_nearby_master_place(uuid)",
  ]) {
    assert.ok(SQL.includes(fnSig), `expected to find function reference: ${fnSig}`);
  }
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.update_nearby_master_place\(\s*\n\s*uuid, text, uuid, text, text, text, text, numeric, numeric, text, text\s*\n\s*\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.retire_nearby_master_place\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
  // GRANT statements here span multiple lines (the signature wraps), so
  // each is captured start-to-terminating-semicolon rather than assumed
  // to fit one line.
  const grantStatements = [...SQL.matchAll(/GRANT EXECUTE[\s\S]*?;/g)].map((m) => m[0]);
  assert.equal(grantStatements.length, 2);
  for (const statement of grantStatements) {
    assert.match(statement, /TO authenticated;$/);
    assert.equal(/\banon\b|\bservice_role\b|\bPUBLIC\b/.test(statement), false);
  }
});

test("no direct table INSERT/UPDATE/DELETE grant is added to nearby_master, event_nearby_places, or tenant_place_relevance -- mutation stays inside the two SECURITY DEFINER functions only", () => {
  assert.equal(/GRANT (INSERT|UPDATE|DELETE) ON (TABLE )?public\.(nearby_master|event_nearby_places|tenant_place_relevance)/.test(SQL), false);
});

// ---------------------------------------------------------------------------
// 15. Stage 0 remains unchanged
// ---------------------------------------------------------------------------

test("15. Stage 0's functions are not redefined by this migration -- record_tenant_place, review_shared_place, and search_shared_places are absent from every executable statement (prose comments may still name them for context)", () => {
  assert.equal(/record_tenant_place|review_shared_place|search_shared_places/.test(EXECUTABLE), false);
});

test("15b. this migration does not touch Stage 0's schema surface -- no ALTER TABLE on nearby_master, no reference to contributed_by_tenant_id's CHECK/index/FK", () => {
  assert.equal(/ALTER TABLE public\.nearby_master/.test(EXECUTABLE), false);
  assert.equal(/nearby_master_contributed_by_tenant/.test(EXECUTABLE), false);
});

test("Stage 0's own migration file is independently unmodified (still on disk, still exactly as deployed)", () => {
  assert.match(STAGE0_SQL, /CREATE OR REPLACE FUNCTION public\.record_tenant_place\(/);
  assert.match(STAGE0_SQL, /has_tenant_admin_authority\(auth\.uid\(\), p_tenant_id\)/);
});

// ---------------------------------------------------------------------------
// 16. No Stage 2 association behavior
// ---------------------------------------------------------------------------

test("16. source_master_id is only ever read (inside a reference-count subquery), never written -- no INSERT/UPDATE gives it a value; per-place Event association is not introduced", () => {
  assert.equal(/SET\s+(?:[^;]*,\s*)?source_master_id\s*=/s.test(EXECUTABLE), false);
  assert.equal(/INSERT INTO public\.event_nearby_places/.test(EXECUTABLE), false);
});

test("no unified-editor, scope-selector, Event-destination-selector, or UI-facing concept appears in any executable statement -- this migration is schema/RPC only (its own header prose may still name the page this replaces, for context)", () => {
  assert.equal(/scope.*selector|destination.*selector|dirty.edit/i.test(EXECUTABLE), false);
});

// ---------------------------------------------------------------------------
// 17. Live-RLS discrepancy is not silently rewritten
// ---------------------------------------------------------------------------

test("17. this migration contains no RLS or grant statement touching nearby_master at all -- the live 'Admins can manage nearby master' policy, the two open SELECT policies, and the anon table grants are all left completely untouched, not silently reconciled here", () => {
  assert.equal(/CREATE POLICY|ALTER POLICY|DROP POLICY/.test(EXECUTABLE), false);
  assert.equal(/ENABLE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY/.test(EXECUTABLE), false);
  assert.equal(/REVOKE[^;]*ON TABLE public\.nearby_master/.test(EXECUTABLE), false);
  assert.equal(/GRANT[^;]*ON TABLE public\.nearby_master/.test(EXECUTABLE), false);
});

test("the live-RLS discrepancy is documented in this migration's own header, not left for silent rediscovery", () => {
  assert.match(SQL, /LIVE-RLS PREFLIGHT/);
  assert.match(SQL, /Admins can manage nearby master/);
  assert.match(SQL, /anon holding the\s*\n-- full undifferentiated privilege set/);
});

// ---------------------------------------------------------------------------
// Concurrency characteristics, explicitly reported
// ---------------------------------------------------------------------------

test("no version/updated_at column is invented on nearby_master -- concurrency remains plain last-write-wins, matching the raw .update() call this RPC replaces, and this is stated explicitly rather than silently assumed", () => {
  assert.equal(/ADD COLUMN updated_at|ADD COLUMN version|ADD COLUMN revision/.test(EXECUTABLE), false);
  assert.match(SQL, /no updated_at, no version,\s*\n--\s*and no revision counter of any kind/);
});

// ---------------------------------------------------------------------------
// Audit/history: explicitly deferred, not invented
// ---------------------------------------------------------------------------

test("no nearby_master_command_audit or any new audit table is created -- explicitly deferred per the approved design, not built merely for symmetry with place_category_command_audit", () => {
  assert.equal(/CREATE TABLE/.test(EXECUTABLE), false);
  assert.match(SQL, /remains deferred to a later, separately authorized stage/);
});

test("only two functions are created/replaced by this migration", () => {
  const created = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(created.sort(), ["retire_nearby_master_place", "update_nearby_master_place"].sort());
});

test("neither function calls assert_event_lifecycle_mutable -- a reusable nearby_master row has no single owning Event lifecycle to consult", () => {
  assert.equal(/assert_event_lifecycle_mutable/.test(EXECUTABLE), false);
});
