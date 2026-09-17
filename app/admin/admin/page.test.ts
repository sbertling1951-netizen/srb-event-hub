import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildAdminNavSections } from "@/components/shell/navigation/adminNav";
import type { AdminAccessResult } from "@/lib/getCurrentAdminAccess";
import { hasPermission } from "@/lib/getCurrentAdminAccess";

const SOURCE = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

// Central Navigation Batch 1: the new Admin workspace overview page.
// Run with:
//   npx tsx --test app/admin/admin/page.test.ts

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
  assert.match(SOURCE, /<AdminRouteGuard requiredPermission="can_manage_admins">/);
  assert.match(SOURCE, /<AdminShellAdapter pageTitle="Admin" backTarget=\{\{ href: "\/admin\/dashboard", label: "Dashboard" \}\}>/);
  assert.equal((SOURCE.match(/<AdminRouteGuard/g) || []).length, 1);
  assert.equal((SOURCE.match(/<AdminShellAdapter/g) || []).length, 1);
});

test("the door guard is never stricter than the Admin parent nav item's own visibility -- an admin with can_manage_admins but WITHOUT can_view_admin_dashboard still sees a working link", () => {
  const admin = buildAdmin({ permissionMap: { can_manage_admins: true, can_view_admin_dashboard: false } });

  // The "Admin" parent nav item is visible for this admin (adminNav.ts's
  // own rule: visible whenever it has at least one visible child, and
  // Admin Users/Permissions are both gated on exactly can_manage_admins).
  const sections = buildAdminNavSections(admin, null);
  const adminWorkspaceItem = sections.flatMap((section) => section.items).find((item) => item.id === "admin-workspace");
  assert.ok(adminWorkspaceItem, "the Admin parent nav item must be visible when can_manage_admins is true");
  assert.equal(adminWorkspaceItem!.href, "/admin/admin");

  // The page's own door guard requires exactly can_manage_admins -- the
  // same key that made the parent visible above -- so this same admin is
  // guaranteed to pass it. can_view_admin_dashboard is irrelevant to
  // reaching this page at all.
  assert.ok(
    hasPermission(admin, "can_manage_admins"),
    "the exact permission key the door guard requires must be true for this admin",
  );
  assert.match(SOURCE, /<AdminRouteGuard requiredPermission="can_manage_admins">/);
});

test("an admin who lacks can_manage_admins (and is not a Super Admin) sees neither the Admin parent nav item nor a usable /admin/admin door", () => {
  const admin = buildAdmin({ permissionMap: { can_view_admin_dashboard: true } });

  const sections = buildAdminNavSections(admin, null);
  assert.equal(
    sections.flatMap((section) => section.items).find((item) => item.id === "admin-workspace"),
    undefined,
    "the Admin parent nav item must not render with no visible children",
  );
  assert.equal(hasPermission(admin, "can_manage_admins"), false);
});

test("the page derives its content from the exact canonical buildAdminNavSections() call -- no second permission map", () => {
  assert.match(SOURCE, /import \{ buildAdminNavSections \} from "@\/components\/shell\/navigation\/adminNav";/);
  assert.match(SOURCE, /const sections = buildAdminNavSections\(admin, tenantAuthority\);/);
  assert.match(SOURCE, /find\(\(item\) => item\.id === "admin-workspace"\)/);
  assert.match(SOURCE, /const links = adminWorkspaceItem\?\.children \?\? \[\];/);

  // No independent permission/authority derivation of any kind: the page
  // never imports hasPermission, never reads admin.isSuperAdmin or any
  // permissionMap/privilege_group field directly, and never inlines a
  // second href/label list of its own.
  assert.doesNotMatch(SOURCE, /hasPermission/);
  assert.doesNotMatch(SOURCE, /isSuperAdmin/);
  assert.doesNotMatch(SOURCE, /permissionMap/);
  assert.doesNotMatch(SOURCE, /privilege_group/);
  assert.doesNotMatch(SOURCE, /href:\s*"\/admin\/(admin-users|permissions|tenants|registry-providers|passport-refunds)"/);
});

test("the page reads only already-resolved Admin identity/authority context via useAdmin() -- no data query, no RPC, no mutation", () => {
  assert.match(SOURCE, /import \{ useAdmin \} from "@\/lib\/adminContext";/);
  assert.match(SOURCE, /const \{ admin, tenantAuthority \} = useAdmin\(\);/);
  assert.doesNotMatch(SOURCE, /supabase\.(from|rpc)\(/);
  assert.doesNotMatch(SOURCE, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
});

test("an account with zero visible Admin-workspace children sees an explicit empty state, not an error or a crash", () => {
  assert.match(SOURCE, /links\.length === 0/);
  assert.match(SOURCE, /<EmptyState message="No admin functions are available for your account\." \/>/);
});

test("every rendered link is a real navigation Link, using each item's own href/label -- never a hardcoded destination list", () => {
  assert.match(SOURCE, /import Link from "next\/link";/);
  assert.match(SOURCE, /href=\{link\.href\}/);
  assert.match(SOURCE, /\{link\.label\}/);
});
