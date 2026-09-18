import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildAdminNavSections } from "@/components/shell/navigation/adminNav";
import type { AdminAccessResult } from "@/lib/getCurrentAdminAccess";

const SOURCE = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

// Catalogs Workspace Batch 3A: the new Catalogs parent workspace overview.
// Run with:
//   npx tsx --test app/admin/catalogs/page.test.ts

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

test("the page is guarded, exactly once, by the canonical Admin route guard and shell adapter -- no double shell, no bespoke guard", () => {
  assert.match(SOURCE, /<AdminRouteGuard requiredPlatformAuthority>/);
  assert.match(SOURCE, /<AdminShellAdapter pageTitle="Catalogs" backTarget=\{\{ href: "\/admin\/dashboard", label: "Dashboard" \}\}>/);
  assert.equal((SOURCE.match(/<AdminRouteGuard/g) || []).length, 1);
  assert.equal((SOURCE.match(/<AdminShellAdapter/g) || []).length, 1);
});

// The shell (ShellHeader) renders the single page-level <h1> from
// pageTitle. This page's own PageHeader is a section heading beneath it,
// so it must not also claim h1 -- the two texts were identical
// ("Catalogs"), giving the page two competing top-level headings. It also
// carries the shared .app-section-title class: without it the heading fell
// through to the UA stylesheet (h1 32px -> h2 24px), so the level change
// alone would have shrunk it. The shared class is the intended section
// typography.
test("the in-page PageHeader is a section heading -- h2, with the shared section-title typography, leaving the shell's pageTitle as the only page-level h1", () => {
  assert.equal(/headingLevel="h1"/.test(SOURCE), false);
  assert.equal(/<h1\b/.test(SOURCE), false);
  assert.match(
    SOURCE,
    /<PageHeader\s*\n\s*title="Catalogs"\s*\n\s*headingLevel="h2"\s*\n\s*titleClassName="app-section-title"\s*\n\s*description="Reusable, curated reference data maintained by the platform, separate from day-to-day operational workspaces\."\s*\n\s*\/>/,
  );
});

test("the door guard matches the Catalogs parent nav item's own visibility exactly -- isSuperAdmin, the same gate Registry Provider Catalog's own route already uses", () => {
  const superAdmin = buildAdmin({ isSuperAdmin: true });
  const nonSuperAdmin = buildAdmin({ permissionMap: { can_manage_admins: true } });

  const sections = buildAdminNavSections(superAdmin, null);
  const catalogsItem = sections.flatMap((section) => section.items).find((item) => item.id === "catalogs");
  assert.ok(catalogsItem, "the Catalogs parent nav item must be visible for a Super Admin");
  assert.equal(catalogsItem!.href, "/admin/catalogs");

  const sectionsNonSuper = buildAdminNavSections(nonSuperAdmin, null);
  assert.equal(
    sectionsNonSuper.flatMap((section) => section.items).find((item) => item.id === "catalogs"),
    undefined,
    "a non-Super-Admin must see neither the Catalogs parent nav item nor its own destination",
  );
});

test("the page derives its content from the exact canonical buildAdminNavSections() call -- no second permission map", () => {
  assert.match(SOURCE, /import \{ buildAdminNavSections \} from "@\/components\/shell\/navigation\/adminNav";/);
  assert.match(SOURCE, /const sections = buildAdminNavSections\(admin, tenantAuthority\);/);
  assert.match(SOURCE, /find\(\(item\) => item\.id === "catalogs"\)/);
  assert.match(SOURCE, /const catalogLinks = catalogsItem\?\.children \?\? \[\];/);

  // No independent permission/authority derivation, and no invented
  // access decision or copied visibility list of any kind.
  assert.doesNotMatch(SOURCE, /hasPermission/);
  assert.doesNotMatch(SOURCE, /isSuperAdmin/);
  assert.doesNotMatch(SOURCE, /permissionMap/);
  assert.doesNotMatch(SOURCE, /privilege_group/);
  assert.doesNotMatch(SOURCE, /href:\s*"\/admin\/registry-providers"/);
});

test("the page reads only already-resolved Admin identity/authority context via useAdmin() -- no data query, no RPC, no mutation", () => {
  assert.match(SOURCE, /import \{ useAdmin \} from "@\/lib\/adminContext";/);
  assert.match(SOURCE, /const \{ admin, tenantAuthority \} = useAdmin\(\);/);
  assert.doesNotMatch(SOURCE, /supabase\.(from|rpc)\(/);
  assert.doesNotMatch(SOURCE, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
});

test("an empty children projection renders no Catalogs workspace section at all -- no EmptyState, no substitute message, no invented access decision", () => {
  // The workspace section is gated on the real projection, not asserted
  // non-empty and not backstopped by a fallback for a case the nav model
  // does not actually produce.
  assert.match(SOURCE, /catalogLinks\.length > 0/);
  assert.match(SOURCE, /\) : null\}/);

  // No EmptyState (or any other fallback/empty-state primitive) is
  // imported or rendered anywhere on this page.
  assert.doesNotMatch(SOURCE, /EmptyState/);
});

test("every rendered link is a real navigation Link, using each item's own href/label -- never a hardcoded destination list", () => {
  assert.match(SOURCE, /import Link from "next\/link";/);
  assert.match(SOURCE, /href=\{link\.href\}/);
  assert.match(SOURCE, /\{link\.label\}/);
});
