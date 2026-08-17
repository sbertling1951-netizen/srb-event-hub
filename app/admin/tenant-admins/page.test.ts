import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("page uses the canonical guarded Admin Governance shell", () => {
  assert.match(PAGE_SOURCE, /requiredPermission="can_manage_admins"/);
  assert.match(PAGE_SOURCE, /pageTitle="Tenant Admin Access"/);
  assert.match(PAGE_SOURCE, /backTarget=\{\{ href: "\/admin\/admin-users", label: "Admin Users" \}\}/);
});

test("authority denial is explicit and never rendered as an empty assignment list", () => {
  assert.match(PAGE_SOURCE, /Platform Administrator authority is required to view Tenant Admin assignments/);
  assert.match(PAGE_SOURCE, /role="alert"/);
  assert.match(PAGE_SOURCE, /assignments === null \? null/);
});

test("true empty state is distinct from loading and failure", () => {
  assert.match(PAGE_SOURCE, /Loading Tenant Admin assignments/);
  assert.match(PAGE_SOURCE, /No Tenant Admins are currently assigned to this Tenant/);
  assert.match(PAGE_SOURCE, /activeAssignments\.length === 0/);
});

test("current Tenant Admin assignments render from the governed list result", () => {
  assert.match(PAGE_SOURCE, /activeAssignments\.map\(\(assignment\) =>/);
  assert.match(PAGE_SOURCE, /adminById\.get\(assignment\.admin_user_id\)/);
  assert.match(PAGE_SOURCE, /Tenant-scoped authority/);
});

test("assignment and removal success feedback identify Tenant scope", () => {
  assert.match(PAGE_SOURCE, /now has Tenant Admin authority for/);
  assert.match(PAGE_SOURCE, /no longer has Tenant Admin authority for/);
  assert.match(PAGE_SOURCE, /role="status"/);
});

test("removal requires the canonical confirmation dialog", () => {
  assert.match(PAGE_SOURCE, /<ConfirmDialog/);
  assert.match(PAGE_SOURCE, /title="Remove Tenant Admin Access"/);
  assert.match(PAGE_SOURCE, /Event-specific assignments are not changed/);
});

test("the screen introduces no Event Admin assignment semantics", () => {
  assert.equal(/create_event_authority_assignment|admin_event_access|p_event_id/.test(PAGE_SOURCE), false);
  assert.match(PAGE_SOURCE, /Event Admin assignments remain Event-specific and are managed in Event Staff/);
});

test("the screen never directly reads or mutates admin_tenant_access", () => {
  assert.equal(/\.from\(["']admin_tenant_access["']\)/.test(PAGE_SOURCE), false);
  assert.match(PAGE_SOURCE, /listTenantAdminAccess/);
  assert.match(PAGE_SOURCE, /setTenantAdminAccess/);
});