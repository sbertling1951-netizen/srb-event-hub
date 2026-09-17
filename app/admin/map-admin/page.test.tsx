import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { MapsWorkspaceSection } from "@/app/admin/map-admin/page";
import type { AdminAccessResult } from "@/lib/getCurrentAdminAccess";

const PAGE_SOURCE = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

// Central Navigation Batch 2B repair: this file's primary proof is now a
// real render of the actual production `MapsWorkspaceSection` component
// (exported from page.tsx) via react-dom/server's renderToStaticMarkup --
// already a project dependency, the same pattern this session's other
// shell/workspace tests already use. Every scenario below passes only
// already-resolved `admin`/`tenantAuthority` inputs and calls the REAL,
// unmodified `getAdminNavItemChildren(admin, tenantAuthority,
// "map-admin")` inside that real component -- no copied nav list, no
// separately recomputed expected link set, and no source regex is the
// primary proof of any behavior. Source-level checks below are kept only
// as secondary defense for things a render can't directly show (e.g. "no
// leftover bespoke style block exists at all"). Run with:
//   npx tsx --test app/admin/map-admin/page.test.ts

function buildAdmin(overrides: Partial<AdminAccessResult> = {}): AdminAccessResult {
  return {
    adminUser: {
      id: "admin-1",
      email: "admin@example.com",
      display_name: "Admin",
      is_active: true,
      privilege_group: "event_admin",
      user_id: "user-1",
    },
    eventAccessRows: [],
    permissionKeys: [],
    permissionMap: {},
    rolePermissions: [],
    eventPermissionKeys: [],
    privilegeGroup: "event_admin",
    isSuperAdmin: false,
    email: "admin@example.com",
    display_name: "Admin",
    privilege_group: "event_admin",
    eventIds: [],
    event_ids: [],
    ...overrides,
  };
}

test("a representative full-access admin renders all four visible Maps children as real links, with their actual canonical hrefs and labels", () => {
  const admin = buildAdmin({ isSuperAdmin: true, permissionMap: { can_manage_master_maps: true, can_manage_nearby: true, can_manage_locations: true } });
  const html = renderToStaticMarkup(
    <MapsWorkspaceSection admin={admin} tenantAuthority={{ status: "allowed" }} />,
  );

  assert.match(html, /<a class="app-button" href="\/admin\/master-maps">Master Maps<\/a>/);
  assert.match(html, /<a class="app-button" href="\/admin\/nearby">Nearby<\/a>/);
  assert.match(html, /<a class="app-button" href="\/admin\/nearby-settings">Nearby Settings<\/a>/);
  assert.match(html, /<a class="app-button" href="\/admin\/locations">Locations<\/a>/);
  assert.match(html, /Maps Workspace/);
});

test("a constrained access case renders only the visible child -- the real getAdminNavItemChildren() call hides the rest, not a test-side filter", () => {
  // can_manage_master_maps alone (no can_manage_nearby, no
  // can_manage_locations, no tenantAuthority "allowed") satisfies the
  // Maps parent's own gate but none of the other three children's
  // independent gates.
  const admin = buildAdmin({ permissionMap: { can_manage_master_maps: true } });
  const html = renderToStaticMarkup(<MapsWorkspaceSection admin={admin} tenantAuthority={null} />);

  assert.match(html, /<a class="app-button" href="\/admin\/master-maps">Master Maps<\/a>/);
  assert.doesNotMatch(html, /Nearby Settings/);
  assert.doesNotMatch(html, /<a class="app-button" href="\/admin\/nearby">Nearby<\/a>/);
  assert.doesNotMatch(html, /<a class="app-button" href="\/admin\/locations">Locations<\/a>/);
  // Exactly one link rendered.
  assert.equal((html.match(/<a class="app-button"/g) || []).length, 1);
});

test("a no-visible-links case renders nothing at all -- no Maps Workspace section, no PageSection markup", () => {
  const noAccessAdmin = buildAdmin({ permissionMap: {} });
  const html = renderToStaticMarkup(<MapsWorkspaceSection admin={noAccessAdmin} tenantAuthority={null} />);
  assert.equal(html, "");

  const nullAdminHtml = renderToStaticMarkup(<MapsWorkspaceSection admin={null} tenantAuthority={null} />);
  assert.equal(nullAdminHtml, "");
});

test("Parking never renders in the Maps workspace, for any access level -- it is a real render-time fact, not just an absent source string", () => {
  const superAdmin = buildAdmin({ isSuperAdmin: true });
  const html = renderToStaticMarkup(
    <MapsWorkspaceSection admin={superAdmin} tenantAuthority={{ status: "allowed" }} />,
  );
  assert.doesNotMatch(html, /parking/i);
});

// ---- Secondary source-level defense only -- not the primary proof of
// any behavior above, which is established by the renders themselves. ----

test("the production component calls the real getAdminNavItemChildren('map-admin') itself -- the test never passes precomputed links in", () => {
  assert.match(PAGE_SOURCE, /export function MapsWorkspaceSection\(/);
  assert.match(
    PAGE_SOURCE,
    /const mapsWorkspaceLinks = getAdminNavItemChildren\(admin, tenantAuthority, "map-admin"\);/,
  );
  // MapsWorkspaceSection's own props are admin/tenantAuthority only --
  // no `links`/`items` prop exists for a caller (or a test) to inject a
  // precomputed list instead of the real projection.
  const componentSignature = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("export function MapsWorkspaceSection("),
    PAGE_SOURCE.indexOf(") {", PAGE_SOURCE.indexOf("export function MapsWorkspaceSection(")),
  );
  assert.doesNotMatch(componentSignature, /links|items/);
});

test("MapAdminPageInner renders the exact extracted component, passing only admin/tenantAuthority from useAdmin() -- no duplicate rendering path", () => {
  assert.match(PAGE_SOURCE, /const \{ admin, tenantAuthority \} = useAdmin\(\);/);
  assert.match(PAGE_SOURCE, /<MapsWorkspaceSection admin=\{admin\} tenantAuthority=\{tenantAuthority\} \/>/);
  assert.equal((PAGE_SOURCE.match(/<PageSection variant="card" title="Maps Workspace">/g) || []).length, 1);
});

test("the bare route guard, shell adapter, and page title are preserved unchanged", () => {
  assert.match(PAGE_SOURCE, /<AdminRouteGuard>/);
  assert.match(PAGE_SOURCE, /<AdminShellAdapter pageTitle="Map Admin">/);
  assert.equal((PAGE_SOURCE.match(/<AdminRouteGuard/g) || []).length, 1);
  assert.equal((PAGE_SOURCE.match(/<AdminShellAdapter/g) || []).length, 1);
  assert.doesNotMatch(PAGE_SOURCE, /requiredPermission|requiredTask|requiredTenantAuthority/);
});

test("the former hand-authored static card grid, inline visual styles, icons, and direct next/link navigation remain fully removed", () => {
  assert.doesNotMatch(PAGE_SOURCE, /mapCards/);
  assert.doesNotMatch(PAGE_SOURCE, /import Link from "next\/link";/);
  assert.doesNotMatch(PAGE_SOURCE, /<Link\b/);
  assert.doesNotMatch(PAGE_SOURCE, /CSSProperties/);
  assert.doesNotMatch(PAGE_SOURCE, /headerCardStyle|toolGridStyle|baseToolCardStyle|toolButtonStyle|iconCircleStyle/);
  assert.doesNotMatch(PAGE_SOURCE, /🗺️|📍|👥|🧭/);
  assert.doesNotMatch(PAGE_SOURCE, /linear-gradient/);
});

test("no new UI primitive was invented -- only PageSection, FormActions, and AppLinkButton are used for the workspace surface", () => {
  assert.match(PAGE_SOURCE, /import \{ AppLinkButton \} from "@\/components\/ui\/AppButton";/);
  assert.match(PAGE_SOURCE, /import \{ FormActions \} from "@\/components\/ui\/FormActions";/);
  assert.match(PAGE_SOURCE, /import \{ PageSection \} from "@\/components\/ui\/PageSection";/);
  assert.doesNotMatch(PAGE_SOURCE, /<button\b/);
  assert.doesNotMatch(PAGE_SOURCE, /onClick=\{/);
});

test("the page carries no dashboard, statistics, search, preview, or image content of its own", () => {
  const codeOnly = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codeOnly, /SummaryCards|statistic|<img\b|<input\b/i);
  assert.doesNotMatch(codeOnly, /useState/);
  assert.doesNotMatch(codeOnly, /supabase\.(from|rpc)\(/);
});
