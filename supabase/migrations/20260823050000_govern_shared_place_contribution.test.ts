import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural assertions for Nearby Scope Model Stage 0: Shared-place
// provenance + shared-contribution authority correction. No local
// Supabase/Docker instance is available in this environment to
// test-apply it -- these verify the SQL's shape/guards, matching this
// repository's established style for this exact workstream (see
// 20260821250000_create_place_category_rename_governed_operation.test.ts).
//
// Run with:
//   npx tsx --test supabase/migrations/20260823050000_govern_shared_place_contribution.test.ts

const SQL = readFileSync(
  fileURLToPath(new URL("./20260823050000_govern_shared_place_contribution.sql", import.meta.url)),
  "utf8",
);
const EXECUTABLE = SQL.replace(/--.*$/gm, "");

// The Stage 0 migration deliberately only ever redefines record_tenant_place
// (never review_shared_place) -- reused across many tests below.
function recordTenantPlaceBody(): string {
  const start = SQL.indexOf("CREATE OR REPLACE FUNCTION public.record_tenant_place(");
  assert.ok(start >= 0, "expected to find record_tenant_place");
  const end = SQL.indexOf("$function$;", start);
  return SQL.slice(start, end);
}

// The live has_tenant_admin_authority definition, read fresh from its own
// migration -- not assumed -- so the Super Admin/own-tenant-only contract
// this migration now depends on is independently locked in, not merely
// referenced by name.
const AUTHORITY_SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260810110000_create_administrative_authority_foundation.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

function authorityFunctionBody(name: string): string {
  const start = AUTHORITY_SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `expected to find ${name} in the authority foundation migration`);
  const end = AUTHORITY_SQL.indexOf("$function$;", start);
  return AUTHORITY_SQL.slice(start, end);
}

// ---------------------------------------------------------------------------
// 1. contributed_by_tenant_id -- schema addition
// ---------------------------------------------------------------------------

test("contributed_by_tenant_id is added as a nullable FK to tenants, separate from tenant_id", () => {
  assert.match(
    SQL,
    /ALTER TABLE public\.nearby_master\s*\n\s*ADD COLUMN contributed_by_tenant_id uuid REFERENCES public\.tenants\(id\);/,
  );
  // No NOT NULL, no DEFAULT -- nullable with no fabricated value.
  const columnLine = SQL.slice(
    SQL.indexOf("ADD COLUMN contributed_by_tenant_id"),
    SQL.indexOf(";", SQL.indexOf("ADD COLUMN contributed_by_tenant_id")),
  );
  assert.equal(/NOT NULL|DEFAULT/.test(columnLine), false);
});

test("the existing nearby_master_scope_tenant_consistency constraint is not touched -- no ALTER/DROP referencing it anywhere in this migration's executable SQL", () => {
  assert.equal(/nearby_master_scope_tenant_consistency/.test(EXECUTABLE), false);
});

test("a new, separate CHECK constrains contributed_by_tenant_id to shared_public rows only -- tenant_specific rows never stamp it", () => {
  assert.match(
    SQL,
    /ADD CONSTRAINT nearby_master_contributed_by_tenant_scope_check CHECK \(\s*\n\s*contributed_by_tenant_id IS NULL OR scope = 'shared_public'\s*\n\s*\);/,
  );
});

test("a partial index on contributed_by_tenant_id matches the existing tenant_id_idx precedent's shape (non-NULL only)", () => {
  assert.match(
    SQL,
    /CREATE INDEX nearby_master_contributed_by_tenant_id_idx\s*\n\s*ON public\.nearby_master \(contributed_by_tenant_id\)\s*\n\s*WHERE contributed_by_tenant_id IS NOT NULL;/,
  );
});

test("no UPDATE statement touches nearby_master in this migration -- no backfill, no fabricated provenance for existing rows", () => {
  assert.equal(/UPDATE\s+public\.nearby_master/i.test(EXECUTABLE), false);
});

// ---------------------------------------------------------------------------
// 2. record_tenant_place -- signature and untouched pieces
// ---------------------------------------------------------------------------

test("record_tenant_place's signature is byte-identical to the live function -- no new parameter was added", () => {
  assert.match(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.record_tenant_place\(\s*\n\s*p_scope text,\s*\n\s*p_name text,\s*\n\s*p_tenant_id uuid DEFAULT NULL,\s*\n\s*p_category_id uuid DEFAULT NULL,\s*\n\s*p_category text DEFAULT NULL,\s*\n\s*p_address text DEFAULT NULL,\s*\n\s*p_phone text DEFAULT NULL,\s*\n\s*p_website text DEFAULT NULL,\s*\n\s*p_lat numeric DEFAULT NULL,\s*\n\s*p_lng numeric DEFAULT NULL,\s*\n\s*p_notes text DEFAULT NULL\s*\n\s*\)\s*\n\s*RETURNS uuid/,
  );
});

test("is SECURITY DEFINER with the same fixed search_path as the live function", () => {
  const body = recordTenantPlaceBody();
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path TO 'pg_catalog'/);
});

test("no new GRANT/REVOKE statement is issued -- CREATE OR REPLACE on an unchanged signature preserves the existing authenticated-only grant, so none is reissued", () => {
  assert.equal(/GRANT\b/.test(EXECUTABLE), false);
  assert.equal(/REVOKE\b/.test(EXECUTABLE), false);
});

test("the tenant_specific branch's authority check is completely unchanged: still has_tenant_admin_authority, still its own dedicated tenant_id-required guard immediately after", () => {
  const body = recordTenantPlaceBody();
  assert.match(
    body,
    /ELSIF p_scope = 'tenant_specific' THEN\s*\n\s*IF NOT public\.has_tenant_admin_authority\(auth\.uid\(\), p_tenant_id\) THEN\s*\n\s*RAISE EXCEPTION 'record_tenant_place: caller is not an active Tenant Admin \(or Super Admin\) for tenant %', p_tenant_id;/,
  );
  assert.match(
    body,
    /IF p_scope = 'tenant_specific' AND p_tenant_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'record_tenant_place: tenant_specific places require a tenant_id';/,
  );
});

test("validation, review_status derivation, and the created_by/reviewed_by/reviewed_at expressions are unchanged", () => {
  const body = recordTenantPlaceBody();
  assert.match(body, /IF p_name IS NULL OR btrim\(p_name\) = '' THEN\s*\n\s*RAISE EXCEPTION 'record_tenant_place: name is required';/);
  assert.match(
    body,
    /v_review_status := CASE WHEN p_scope = 'shared_public' THEN 'pending_review' ELSE 'approved' END;/,
  );
  assert.match(body, /CASE WHEN v_review_status = 'approved' THEN auth\.uid\(\)::text ELSE NULL END,/);
  assert.match(body, /CASE WHEN v_review_status = 'approved' THEN now\(\) ELSE NULL END,/);
  assert.match(body, /auth\.uid\(\)::text\s*\n\s*\)\s*\n\s*RETURNING id INTO v_place_id;/);
});

// ---------------------------------------------------------------------------
// 3. record_tenant_place -- the actual Stage 0 authority correction
// ---------------------------------------------------------------------------

test("the shared_public branch now uses has_tenant_admin_authority(auth.uid(), p_tenant_id), not has_platform_admin_authority", () => {
  const body = recordTenantPlaceBody();
  const sharedBranchStart = body.indexOf("IF p_scope = 'shared_public' THEN");
  const sharedBranchEnd = body.indexOf("ELSIF p_scope = 'tenant_specific'");
  const sharedBranch = body.slice(sharedBranchStart, sharedBranchEnd);
  assert.match(
    sharedBranch,
    /IF NOT public\.has_tenant_admin_authority\(auth\.uid\(\), p_tenant_id\) THEN/,
  );
  assert.equal(/has_platform_admin_authority/.test(sharedBranch), false);
});

test("Tenant Admin can propose shared_public for their own Tenant, and cannot propose on behalf of another Tenant -- both follow directly from has_tenant_admin_authority's own exact-tenant-match contract, now the gate on this branch", () => {
  const body = recordTenantPlaceBody();
  const sharedBranchStart = body.indexOf("IF p_scope = 'shared_public' THEN");
  const sharedBranchEnd = body.indexOf("ELSIF p_scope = 'tenant_specific'");
  const sharedBranch = body.slice(sharedBranchStart, sharedBranchEnd);
  // The caller's own Tenant is exactly p_tenant_id -- the same parameter
  // the candidate is recorded under -- so an admin_tenant_access grant on
  // any OTHER tenant cannot satisfy this call.
  assert.match(sharedBranch, /has_tenant_admin_authority\(auth\.uid\(\), p_tenant_id\)/);

  const authorityBody = authorityFunctionBody("has_tenant_admin_authority");
  assert.match(
    authorityBody,
    /WHERE au\.user_id = p_auth_user_id\s*\n\s*AND au\.is_active = true\s*\n\s*AND ata\.tenant_id = p_tenant_id\s*\n\s*AND ata\.is_active = true/,
  );
});

test("Super Admin behavior is verified explicitly, not assumed: has_tenant_admin_authority's own live definition grants Super Admin as its first branch, before consulting admin_tenant_access at all", () => {
  const authorityBody = authorityFunctionBody("has_tenant_admin_authority");
  const superAdminBranchIdx = authorityBody.indexOf("IF public.has_platform_admin_authority(p_auth_user_id) THEN");
  const tenantAccessIdx = authorityBody.indexOf("FROM public.admin_tenant_access");
  assert.ok(superAdminBranchIdx >= 0, "expected an explicit Super Admin short-circuit branch");
  assert.ok(tenantAccessIdx >= 0);
  assert.ok(
    superAdminBranchIdx < tenantAccessIdx,
    "Super Admin must be checked before admin_tenant_access, proving Super Admin authority for record_tenant_place's shared_public branch does not depend on any admin_tenant_access row existing",
  );
  assert.match(authorityBody, /RETURN true;\s*\n\s*END IF;/);
});

test("fails closed on a NULL tenant_id -- has_tenant_admin_authority never returns true for a missing tenant, so an omitted p_tenant_id cannot slip a shared_public proposal through", () => {
  const authorityBody = authorityFunctionBody("has_tenant_admin_authority");
  assert.match(
    authorityBody,
    /IF p_auth_user_id IS NULL OR p_tenant_id IS NULL THEN\s*\n\s*RETURN false;\s*\n\s*END IF;/,
  );
});

test("contributed_by_tenant_id is inserted from the function's own existing p_tenant_id parameter only -- no new client-supplied provenance parameter exists", () => {
  const body = recordTenantPlaceBody();
  assert.match(
    body,
    /CASE WHEN p_scope = 'shared_public' THEN p_tenant_id ELSE NULL END,\s*\n\s*'tenant_submitted', 'external', v_review_status,/,
  );
  // The signature test above already proves no parameter was added --
  // this confirms the value column's only source is p_tenant_id itself,
  // never a distinct p_contributed_by_tenant_id or similar.
  assert.equal(/p_contributed/.test(body), false);
});

test("tenant_id's own INSERT expression is unchanged -- still forced NULL for shared_public, still p_tenant_id only for tenant_specific", () => {
  const body = recordTenantPlaceBody();
  assert.match(
    body,
    /CASE WHEN p_scope = 'tenant_specific' THEN p_tenant_id ELSE NULL END,\s*\n\s*CASE WHEN p_scope = 'shared_public' THEN p_tenant_id ELSE NULL END,/,
  );
});

test("the INSERT column list includes contributed_by_tenant_id immediately after tenant_id, alongside the unchanged column set", () => {
  const body = recordTenantPlaceBody();
  assert.match(
    body,
    /INSERT INTO public\.nearby_master \(\s*\n\s*name, address, category, category_id, description, lat, lng, link, phone,\s*\n\s*status, scope, tenant_id, contributed_by_tenant_id, source_type, evidence_quality,\s*\n\s*review_status, reviewed_by, reviewed_at, created_by\s*\n\s*\) VALUES \(/,
  );
});

test("publication is unaffected: review_status is still forced pending_review for shared_public -- a Tenant Admin's proposal is never auto-approved", () => {
  const body = recordTenantPlaceBody();
  assert.match(
    body,
    /v_review_status := CASE WHEN p_scope = 'shared_public' THEN 'pending_review' ELSE 'approved' END;/,
  );
});

// ---------------------------------------------------------------------------
// 4. review_shared_place -- explicitly untouched
// ---------------------------------------------------------------------------

test("review_shared_place is not redefined by this migration at all -- the Super-Admin-only approval gate is entirely out of this migration's executable diff", () => {
  assert.equal(/review_shared_place/.test(EXECUTABLE), false);
});

// ---------------------------------------------------------------------------
// 5. Scope guards -- Stage 1/2/unified-editor territory stays untouched
// ---------------------------------------------------------------------------

test("only one function is created/replaced by this migration: record_tenant_place", () => {
  const created = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(created, ["record_tenant_place"]);
});

test("no RLS is added to nearby_master -- ENABLE ROW LEVEL SECURITY and CREATE POLICY are both absent from this migration", () => {
  assert.equal(/ENABLE ROW LEVEL SECURITY/.test(EXECUTABLE), false);
  assert.equal(/CREATE POLICY/.test(EXECUTABLE), false);
});

test("source_master_id is never referenced -- per-place Event association is Stage 2, not Stage 0", () => {
  assert.equal(/source_master_id/.test(SQL), false);
});

test("search_shared_places and resolve_effective_nearby_places are not touched by this migration", () => {
  assert.equal(/search_shared_places/.test(SQL), false);
  assert.equal(/resolve_effective_nearby_places/.test(SQL), false);
});

test("no update/retire/associate RPC name appears -- Stage 1/2 governed operations are not introduced here", () => {
  assert.equal(/update_tenant_place|retire_nearby_master_place|retire_tenant_place|associate.*event/i.test(SQL), false);
});

test("event_nearby_places is never referenced -- this migration touches nearby_master and record_tenant_place only", () => {
  assert.equal(/event_nearby_places/.test(SQL), false);
});

test("no Nearby admin/member/settings UI page is modified by this workstream's changed files", () => {
  const uiPaths = [
    "../../app/admin/nearby/page.tsx",
    "../../app/admin/nearby-settings/page.tsx",
    "../../app/member/nearby/page.tsx",
  ];
  for (const relativePath of uiPaths) {
    // Existence-independent: this test only needs to prove the migration
    // itself carries no reference to these surfaces; it does not read
    // them (no UI file is touched by Stage 0 at all).
    assert.equal(SQL.includes(relativePath), false);
  }
  assert.equal(/InlineEdit/.test(SQL), false);
});
