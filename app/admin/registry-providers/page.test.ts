import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
/** Comments removed: the prose may legitimately name what does NOT happen. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("the workspace is guarded by exact Platform authority and uses the canonical Admin shell", () => {
  assert.match(SOURCE, /<AdminRouteGuard requiredPlatformAuthority>/);
  assert.match(SOURCE, /<AdminShellAdapter\s*\n\s*pageTitle="Registry Provider Catalog"/);
  // both wrap the actual workspace, not just render side by side
  const guardAt = SOURCE.indexOf("<AdminRouteGuard requiredPlatformAuthority>");
  const shellAt = SOURCE.indexOf("<AdminShellAdapter", guardAt);
  const workspaceAt = SOURCE.indexOf("<RegistryProviderCatalogWorkspace", shellAt);
  const shellCloseAt = SOURCE.indexOf("</AdminShellAdapter>", workspaceAt);
  const guardCloseAt = SOURCE.indexOf("</AdminRouteGuard>", shellCloseAt);
  assert.ok(
    guardAt < shellAt && shellAt < workspaceAt && workspaceAt < shellCloseAt && shellCloseAt < guardCloseAt,
    "AdminRouteGuard wraps AdminShellAdapter wraps the workspace, properly nested",
  );
});

test("the page uses ONLY the dedicated Catalog P1 adapter -- no direct RPC call, no other planning/catalog adapter import", () => {
  assert.match(SOURCE, /from "@\/lib\/registryProviderCatalogAdmin"/);
  assert.doesNotMatch(CODE, /\.rpc\(|supabase\.rpc/);
  assert.doesNotMatch(CODE, /from "@\/lib\/organizerRegistryPlan"|from "@\/lib\/tenantAdministration"/);
  for (const fn of [
    "listRegistryProviderCatalogAssetsForPlatformAdmin",
    "createRegistryProviderCatalogAsset",
    "updateRegistryProviderCatalogAsset",
    "setRegistryProviderCatalogAssetActiveStatus",
  ]) {
    assert.match(SOURCE, new RegExp(fn));
  }
});

test("empty state, create-inactive, edit, and explicit activate/deactivate controls are all present", () => {
  assert.match(SOURCE, /EMPTY_COPY = "No registry providers exist yet/);
  assert.match(SOURCE, /<EmptyState message={EMPTY_COPY}/);
  assert.match(SOURCE, />\s*Add (a )?registry provider\s*</i);
  assert.match(SOURCE, />Edit</);
  assert.match(SOURCE, /row\.is_active \? "Deactivate" : "Activate"/);
  // active/inactive status is displayed, never a caller-suppliable create argument
  assert.match(SOURCE, /row\.is_active \? "Active" : "Inactive"/);
  assert.doesNotMatch(CODE, /p_is_active/);
});

test("revision-conflict handling: a stale-write error triggers a reload, and every mutation passes the row's own current revision", () => {
  assert.match(SOURCE, /recoverFromConflict/);
  assert.match(SOURCE, /changed since you loaded it/i);
  assert.match(SOURCE, /updateRegistryProviderCatalogAsset\(row\.id, row\.revision, editForm\)/);
  assert.match(SOURCE, /setRegistryProviderCatalogAssetActiveStatus\(row\.id, row\.revision, !row\.is_active\)/);
});

test("NO WEBSITE LINK, NAVIGATION, FETCH, PREVIEW, IMAGE, OR IFRAME anywhere on this page", () => {
  assert.doesNotMatch(CODE, /<a\s+href|window\.open|window\.location|<iframe|<img|\bfetch\(|XMLHttpRequest|axios/i);
  // the website is rendered through the one dedicated plain-text component
  assert.match(SOURCE, /function WebsiteText/);
  assert.match(SOURCE, /<WebsiteText value={row\.public_website}\s*\/>/);
  const websiteFn = SOURCE.slice(SOURCE.indexOf("function WebsiteText"), SOURCE.indexOf("function AssetFields"));
  assert.doesNotMatch(websiteFn, /<a\b|href=|onClick/i);
  assert.match(websiteFn, /<span/);
});

test("NO usage count, where-used, private-plan, Tenant, Event, organizer identity, vendor, or Nearby information appears", () => {
  // Copy text is allowed to say what does NOT happen (e.g. "Organizers
  // cannot search..."); this checks the CODE with that scope prose removed.
  // "Event" is capitalized in this codebase for the domain entity, so the
  // check targets that -- never the lowercase DOM `event` handler param.
  const codeWithoutScopeCopy = CODE
    .replace(/const SCOPE_COPY =[\s\S]*?;\n/, "")
    .replace(/pageSubtitle="[^"]*"/, "");
  assert.doesNotMatch(
    codeWithoutScopeCopy,
    /usage|where.?used|reference.?count|referenced.?by|private.?plan|registry.?plan|\bTenant\b|\bEvent\b|\bOrganizer\b|\bvendor\b|nearby/,
  );
});

test("NO category, geography, alias, ranking, popularity, or recommendation control exists", () => {
  assert.doesNotMatch(CODE, /categor|geograph|alias|rank|popular|recommend/i);
});

test("no public/organizer route exists at this path, and this file makes no Registry Plan change", () => {
  assert.doesNotMatch(SOURCE, /"use server"/);
  assert.doesNotMatch(CODE, /organizerRegistryPlan|attachSelection|catalogAssetId|snapshot/i);
});
