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

test("Tenant authority guidance no longer names the retired legacy writer", () => {
  assert.match(PAGE_SOURCE, /Person-backed Tenant Administrator appointments/);
  assert.doesNotMatch(PAGE_SOURCE, /set_tenant_admin_access/);
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

// -----------------------------------------------------------------------
// Nearby Category Authority Stage D: InlineEdit production adoption for
// governed global category-label rename.
// -----------------------------------------------------------------------

test("InlineEdit is imported from the real shared primitive, not recreated locally", () => {
  assert.match(PAGE_SOURCE, /import \{ InlineEdit \} from "@\/components\/ui\/InlineEdit";/);
});

test("the category label is InlineEdit only for isSuperAdmin -- everyone else gets a plain read-only span, no edit affordance", () => {
  const rowSection = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("{categories.map((category) => {"),
    PAGE_SOURCE.indexOf("</div>\n              </div>\n            );\n          })}"),
  );
  assert.match(
    rowSection,
    /\{isSuperAdmin \? \(\s*\n\s*<InlineEdit/,
  );
  assert.match(rowSection, /\) : \(\s*\n\s*<span>\{category\.label\}<\/span>\s*\n\s*\)\}/);
});

test("InlineEdit's value comes from category.label, and its onSave calls renameCategory with the exact category id", () => {
  assert.match(
    PAGE_SOURCE,
    /<InlineEdit\s*\n\s*label="Category name"\s*\n\s*value=\{category\.label\}\s*\n\s*onSave=\{\(nextLabel\) => renameCategory\(category\.id, nextLabel\)\}/,
  );
});

test("validation is client-side non-empty-after-trim only -- duplicate-label/existence/authority stay server-authoritative, not duplicated in the browser", () => {
  assert.match(
    PAGE_SOURCE,
    /validate=\{\(draft\) => \(draft\.trim\(\) \? undefined : "Category name can't be empty\."\)\}/,
  );
  const renameFnStart = PAGE_SOURCE.indexOf("async function renameCategory(");
  const renameFnEnd = PAGE_SOURCE.indexOf("\n  }", renameFnStart);
  const renameFnBody = PAGE_SOURCE.slice(renameFnStart, renameFnEnd);
  assert.equal(/duplicate|already exists|is_active/.test(renameFnBody), false);
});

test("renameCategory calls ONLY rename_place_category -- no direct place_categories UPDATE, no nearby_master/event_nearby_places write, anywhere in this file", () => {
  assert.match(PAGE_SOURCE, /\.rpc\("rename_place_category", \{/);
  assert.equal(/\.from\("place_categories"\)\s*\n?\s*\.update\(/.test(PAGE_SOURCE), false);
  assert.equal(/\.from\("nearby_master"\)/.test(PAGE_SOURCE), false);
  assert.equal(/\.from\("event_nearby_places"\)/.test(PAGE_SOURCE), false);
});

test("rename_place_category is called with exactly p_category_id and a trimmed p_new_label -- no other parameters, no code, no tenant context", () => {
  const callStart = PAGE_SOURCE.indexOf('.rpc("rename_place_category", {');
  const callEnd = PAGE_SOURCE.indexOf("});", callStart);
  const callArgs = PAGE_SOURCE.slice(callStart, callEnd);
  assert.match(callArgs, /p_category_id: categoryId,/);
  assert.match(callArgs, /p_new_label: trimmedLabel,/);
  assert.equal(/p_tenant_id|selectedTenantId|p_code|code:/.test(callArgs), false);

  const renameFnStart = PAGE_SOURCE.indexOf("async function renameCategory(");
  const renameFnEnd = PAGE_SOURCE.indexOf("\n  }", renameFnStart);
  const renameFnBody = PAGE_SOURCE.slice(renameFnStart, renameFnEnd);
  assert.match(renameFnBody, /const trimmedLabel = nextLabel\.trim\(\);/);
  assert.equal(/selectedTenantId/.test(renameFnBody), false);
});

test("no merge, delete, or code-mutation capability is called or referenced anywhere in this file", () => {
  assert.equal(/merge_place_categor/i.test(PAGE_SOURCE), false);
  assert.equal(/delete_place_categor|deactivate_place_categor/i.test(PAGE_SOURCE), false);
  assert.equal(/DELETE FROM (public\.)?place_categories/.test(PAGE_SOURCE), false);
});

test("a successful rename updates only the matching category's label in local state, preserving id/code/sort_order -- no full reload", () => {
  const renameFnStart = PAGE_SOURCE.indexOf("async function renameCategory(");
  const renameFnEnd = PAGE_SOURCE.indexOf("\n  }", renameFnStart);
  const renameFnBody = PAGE_SOURCE.slice(renameFnStart, renameFnEnd);
  assert.match(
    renameFnBody,
    /setCategories\(\(prev\) =>\s*\n\s*prev\.map\(\(category\) => \(category\.id === categoryId \? \{ \.\.\.category, label: trimmedLabel \} : category\)\),\s*\n\s*\);/,
  );
  assert.equal(/window\.location|location\.reload/.test(renameFnBody), false);
});

test("a failed rename throws (not swallows) a human-readable error -- this is what keeps InlineEdit in its own recoverable edit-mode-with-draft-intact state", () => {
  const renameFnStart = PAGE_SOURCE.indexOf("async function renameCategory(");
  const renameFnEnd = PAGE_SOURCE.indexOf("\n  }", renameFnStart);
  const renameFnBody = PAGE_SOURCE.slice(renameFnStart, renameFnEnd);
  assert.match(renameFnBody, /if \(rpcError\) \{\s*\n\s*throw new Error\(describeRenameCategoryError\(rpcError\.message\)\);/);
});

test("known rename_place_category error codes (unauthorized, duplicate_label, category_not_found) are each translated to distinct human text, with a generic fallback for anything else -- raw database internals are never surfaced", () => {
  const mapFnStart = PAGE_SOURCE.indexOf("function describeRenameCategoryError(");
  const mapFnEnd = PAGE_SOURCE.indexOf("\n  }", mapFnStart);
  const mapFnBody = PAGE_SOURCE.slice(mapFnStart, mapFnEnd);
  assert.match(mapFnBody, /case "unauthorized":/);
  assert.match(mapFnBody, /case "duplicate_label":/);
  assert.match(mapFnBody, /case "category_not_found":/);
  assert.match(mapFnBody, /default:/);
  assert.equal(/P0001|pg_catalog|SQLSTATE/.test(mapFnBody), false);
});

test("InlineEdit owns its own Enter/Escape/blur/keyboard behavior -- this page adds no local onKeyDown/keyCode handling for the category label", () => {
  const rowSection = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("{categories.map((category) => {"),
    PAGE_SOURCE.indexOf("</div>\n              </div>\n            );\n          })}"),
  );
  assert.equal(/onKeyDown|onKeyUp|key === "Enter"|key === "Escape"/.test(rowSection), false);
});

test("the Marker Types card (global category label + rename) renders unconditionally -- not gated behind selecting a Tenant", () => {
  const markerTypesIdx = PAGE_SOURCE.indexOf('<h2 style={{ marginTop: 0 }}>Marker Types</h2>');
  const cardOpenIdx = PAGE_SOURCE.lastIndexOf('<div className="card"', markerTypesIdx);
  const precedingSource = PAGE_SOURCE.slice(0, cardOpenIdx);
  // The nearest preceding conditional-render check must not be an open,
  // still-unclosed "{selectedTenantId ? (" wrapping this card.
  const lastConditionalOpen = precedingSource.lastIndexOf("{selectedTenantId ? (");
  const lastConditionalClose = precedingSource.lastIndexOf(") : null}");
  assert.ok(lastConditionalClose > lastConditionalOpen, "Marker Types card must not still be inside an open selectedTenantId conditional");
});

test("the Add a Place card remains Tenant-gated, unchanged from before Stage D", () => {
  const addAPlaceIdx = PAGE_SOURCE.indexOf('<h2 style={{ marginTop: 0 }}>Add a Place</h2>');
  const precedingSource = PAGE_SOURCE.slice(0, addAPlaceIdx);
  const lastConditionalOpen = precedingSource.lastIndexOf("{selectedTenantId ? (");
  const lastConditionalClose = precedingSource.lastIndexOf(") : null}");
  assert.ok(lastConditionalOpen > lastConditionalClose, "Add a Place card must still be inside an open selectedTenantId conditional");
});

test("the tenant override buttons (Suppress/Include/Prioritize) still only render once a Tenant is selected, and handleSetOverride is otherwise unchanged", () => {
  const rowSection = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("{categories.map((category) => {"),
    PAGE_SOURCE.indexOf("</div>\n              </div>\n            );\n          })}"),
  );
  assert.match(rowSection, /\{selectedTenantId \? \(/);
  assert.match(rowSection, /handleSetOverride\(category\.id, current === option \? null : option\)/);
});

test("Member Nearby and Admin Nearby files are untouched by this Stage D adoption", () => {
  const memberSource = readFileSync(
    fileURLToPath(new URL("../../member/nearby/page.tsx", import.meta.url)),
    "utf8",
  );
  const adminNearbySource = readFileSync(
    fileURLToPath(new URL("../nearby/page.tsx", import.meta.url)),
    "utf8",
  );
  for (const needle of ["InlineEdit", "rename_place_category", "renameCategory"]) {
    assert.equal(memberSource.includes(needle), false, `member/nearby/page.tsx should not reference ${needle}`);
    assert.equal(adminNearbySource.includes(needle), false, `admin/nearby/page.tsx should not reference ${needle}`);
  }
});
