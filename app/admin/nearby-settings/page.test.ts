import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Tenant Admin Route Authority Foundation adoption for /admin/nearby-settings.
// No HTTP/Supabase mocking infrastructure exists in this repository, so
// these are structural, source-level assertions -- the same style already
// established by lib/adminTenantAuthority.test.ts and
// app/admin/tenant-admins/page.test.ts.

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("route authority is the canonical Tenant Admin check, not the legacy permission flag", () => {
  assert.match(PAGE_SOURCE, /<AdminRouteGuard requiredTenantAuthority>/);
  assert.equal(/requiredPermission="can_manage_nearby"/.test(PAGE_SOURCE), false);
  assert.equal(/can_manage_nearby/.test(PAGE_SOURCE), false);
});

test("no Event task authority is introduced -- Nearby Settings is Tenant-scoped, not Event-scoped", () => {
  assert.equal(/requiredTask/.test(PAGE_SOURCE), false);
  assert.equal(/getCurrentAdminEvent|adminEventContext|adminWorkspaceContext/.test(PAGE_SOURCE), false);
});

test("the Tenant selector is populated from the governed self-scoped RPC", () => {
  assert.match(
    PAGE_SOURCE,
    /import \{ listMyTenantAdminAccess \} from "@\/lib\/adminTenantAuthority";/,
  );
  assert.match(PAGE_SOURCE, /listMyTenantAdminAccess\(\)/);
  assert.match(
    PAGE_SOURCE,
    /setTenants\(\s*\n\s*accessRows\.map\(\(row\) => \(\{ id: row\.tenant_id, display_name: row\.display_name \}\)\),\s*\n\s*\);/,
  );
});

test("the old unfiltered tenants table query is gone", () => {
  assert.equal(/\.from\(["']tenants["']\)/.test(PAGE_SOURCE), false);
});

test("place_categories catalog read is untouched (not a Tenant-authority concern)", () => {
  assert.match(PAGE_SOURCE, /\.from\("place_categories"\)/);
});

test("a selected Tenant that drops out of the governed access list is cleared, not retained silently", () => {
  assert.match(
    PAGE_SOURCE,
    /if \(selectedTenantId && !tenants\.some\(\(tenant\) => tenant\.id === selectedTenantId\)\) \{\s*\n\s*setSelectedTenantId\(""\);\s*\n\s*\}/,
  );
});

test("no default Tenant is selected on load -- the selector starts empty and fails closed until a governed Tenant is chosen", () => {
  assert.match(PAGE_SOURCE, /const \[selectedTenantId, setSelectedTenantId\] = useState\(""\);/);
  assert.equal(/setSelectedTenantId\(\s*(accessRows|tenants)/.test(PAGE_SOURCE), false);
});

test("existing mutation RPC paths remain intact", () => {
  assert.match(PAGE_SOURCE, /\.rpc\("set_tenant_category_override", \{/);
  assert.match(PAGE_SOURCE, /\.rpc\("set_tenant_place_relevance", \{/);
  assert.match(PAGE_SOURCE, /\.rpc\("record_tenant_place", \{/);
  assert.match(PAGE_SOURCE, /\.rpc\("search_shared_places", \{/);
  assert.match(PAGE_SOURCE, /p_tenant_id: selectedTenantId/);
});
