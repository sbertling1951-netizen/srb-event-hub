import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
const CLIENT_SOURCE = readFileSync(
  fileURLToPath(new URL("../../../lib/tenantAdministration.ts", import.meta.url)),
  "utf8",
);

test("the canonical workspace is guarded by exact Platform authority and uses the canonical Admin shell", () => {
  assert.match(SOURCE, /<AdminRouteGuard requiredPlatformAuthority>/);
  assert.match(SOURCE, /<AdminShellAdapter\s*pageTitle="Tenant Administration"/);
});

test("active and inactive Tenants come from the governed administrative list and selection loads every T3 detail read", () => {
  assert.match(SOURCE, /listTenantsForAdministration\(\)/);
  assert.match(SOURCE, /tenant\.is_active \? "Active" : "Inactive"/);
  assert.match(SOURCE, /requestSelectTenant\(tenant\.id\)/);
  for (const reader of [
    "getTenantForAdministration",
    "listTenantHostnameMappingsForAdministration",
    "listTenantAdministratorAppointmentsForAdministration",
    "listTenantAdministratorAppointmentAuditForAdministration",
    "listTenantOwnedEventsForAdministration",
    "listTenantAdministrationAudit",
  ]) {
    assert.match(SOURCE, new RegExp(`${reader}\\(tenantId`));
  }
});

test("Add Tenant communicates inactive-first side effects and contains no Active control", () => {
  const dialog = SOURCE.slice(
    SOURCE.indexOf('title="Add Tenant"'),
    SOURCE.indexOf("open={statusDialogOpen}"),
  );
  assert.match(dialog, /always created Inactive/);
  assert.match(dialog, /does not create Events, hostname mappings, or Tenant Administrator appointments/);
  assert.match(SOURCE, /createTenantForAdministration\(createForm\)/);
  assert.equal(/Active Tenant|is_active|p_is_active/.test(dialog), false);
});

test("metadata editing is bounded to the T3 allowlist while immutable identity is display-only", () => {
  const fields = SOURCE.slice(
    SOURCE.indexOf("function TenantMetadataFields"),
    SOURCE.indexOf("function TenantAdministrationWorkspace"),
  );
  assert.equal(/organization_code|slug|is_active|tenant_id/.test(fields), false);
  assert.match(SOURCE, /<dt>Tenant UUID<\/dt><dd>\{detail\.id\}<\/dd>/);
  assert.match(SOURCE, /<dt>Organization code<\/dt><dd>\{detail\.organization_code\}<\/dd>/);
  assert.match(SOURCE, /<dt>Slug<\/dt><dd>\{detail\.slug\}<\/dd>/);
  assert.match(SOURCE, /updateTenantMetadataForAdministration\(detail\.id, metadataForm, metadataReason\)/);
});

test("lifecycle status is a separate governed confirmation with accurate retained-data semantics and reason", () => {
  assert.match(SOURCE, /setTenantActiveStatus\(detail\.id, nextActive, statusReason\)/);
  assert.match(SOURCE, /operational access while preserving Tenant, Event, Admin, and history data/);
  assert.match(SOURCE, /Platform Administrators retain recovery access, and reactivation is reversible/);
  assert.match(SOURCE, /id="tenant-status-form"/);
  assert.equal(/metadataForm[\s\S]{0,200}is_active/.test(SOURCE), false);
});

test("dirty metadata protects selection, Cancel, create handoff, same-app navigation, and browser unload", () => {
  assert.match(SOURCE, /if \(metadataDirty\) \{\s*setDiscardIntent\(\{ kind: "select", tenantId \}\)/);
  assert.match(SOURCE, /kind: "reset-metadata"/);
  assert.match(SOURCE, /kind: "open-create"/);
  assert.match(SOURCE, /kind: "navigate"/);
  assert.match(SOURCE, /window\.addEventListener\("beforeunload", warnBeforeUnload\)/);
  assert.match(SOURCE, /document\.addEventListener\("click", guardClientNavigation, true\)/);
  assert.match(SOURCE, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*setDiscardIntent\(\{/);
  assert.match(SOURCE, /title="Discard unsaved changes\?"/);
});

test("failed metadata and status commands preserve editor input and show canonical error feedback", () => {
  assert.match(SOURCE, /catch \(saveError\) \{\s*setError\(describeError\(saveError\)\);/);
  assert.match(SOURCE, /catch \(statusError\) \{\s*setError\(describeError\(statusError\)\);/);
  assert.match(SOURCE, /\{error \? <Alert tone="danger">\{error\}<\/Alert> : null\}/);
  const saveCatch = SOURCE.slice(SOURCE.indexOf("catch (saveError)"), SOURCE.indexOf("async function createTenant"));
  assert.equal(/setMetadataForm|setMetadataReason|setStatusDialogOpen/.test(saveCatch), false);
});

test("Tenant Administrator management uses canonical Person candidates and appointment lifecycle commands", () => {
  assert.match(SOURCE, /listEligiblePersonTenantAdministratorCandidatesForAdministration/);
  assert.match(SOURCE, /listTenantAdministratorAppointmentsForAdministration/);
  assert.match(SOURCE, /listTenantAdministratorAppointmentAuditForAdministration/);
  assert.match(SOURCE, /appointment\.appointment_is_active \? "Active" : "Revoked"/);
  assert.match(SOURCE, /Appoint Tenant Administrator/);
  assert.match(SOURCE, /Revoke Appointment/);
  assert.match(SOURCE, /Reactivate Appointment/);
  assert.match(SOURCE, /setPersonTenantAdministratorAppointment\(/);
  assert.match(SOURCE, /Person-backed appointment lifecycle evidence/);
  assert.match(SOURCE, /Open Admin Users/);
  assert.equal(/setTenantAdminAccess|listTenantAdminAssignmentsForAdministration/.test(SOURCE), false);
  assert.equal(/\.from\("admin_users"\)/.test(SOURCE), false);
  assert.equal(/create.*Admin User/i.test(SOURCE), false);
});

test("hostname management adds and toggles retained mappings with no delete or transfer path", () => {
  assert.match(SOURCE, /addTenantHostnameMapping\(/);
  assert.match(SOURCE, /setTenantHostnameMappingActiveStatus\(/);
  assert.match(SOURCE, /Activate Mapping/);
  assert.match(SOURCE, /Deactivate Mapping/);
  assert.match(SOURCE, /never transferred here/);
  assert.equal(/deleteTenantHostname|transferTenantHostname|\.delete\(\)/.test(SOURCE), false);
});

test("Tenant-owned Events are read-only with a handoff to Event Admin and no create/transfer controls", () => {
  assert.match(SOURCE, /Read-only ownership inspection/);
  assert.match(SOURCE, /Open Event Admin/);
  assert.equal(/Create Event|Transfer Event|set.*tenant_id/.test(SOURCE), false);
});

test("audit history renders readable action, actor, subject, reason, and change summaries instead of raw JSON", () => {
  assert.match(SOURCE, /AUDIT_ACTION_LABELS/);
  assert.match(SOURCE, /Actor: \{row\.actor_email\}/);
  assert.match(SOURCE, /Subject: \{auditSubject\(row\)\}/);
  assert.match(SOURCE, /Reason: \{row\.reason\}/);
  assert.match(SOURCE, /auditSummary\(row\)/);
  assert.equal(/JSON\.stringify\(row\.(before_state|after_state)\)/.test(SOURCE), false);
});

test("Tenant mutations have no raw table-write escape hatch", () => {
  const combined = `${SOURCE}\n${CLIENT_SOURCE}`;
  for (const table of ["tenants", "admin_tenant_access", "tenant_hostname_mappings", "person_tenant_administrator_appointments"]) {
    assert.equal(new RegExp(`\\.from\\(["']${table}["']\\)`).test(combined), false);
  }
  assert.equal(/\.insert\(|\.update\(|\.delete\(/.test(combined), false);
});

test("the page uses centralized primitives and a responsive list/card master-detail layout", () => {
  for (const primitive of [
    "PageHeader",
    "PageSection",
    "AppButton",
    "AppLinkButton",
    "Dialog",
    "ConfirmDialog",
    "Field",
    "Input",
    "Select",
    "StatusBadge",
    "ResponsiveList",
    "Alert",
  ]) {
    assert.match(SOURCE, new RegExp(`<${primitive}`));
  }
  assert.match(SOURCE, /tenant-admin-workspace-grid/);
  assert.equal(/<table|<DataTable/.test(SOURCE), false);
});
