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
    SOURCE.indexOf("function TenantBrandingFields"),
    SOURCE.indexOf("function TenantAdministrationWorkspace"),
  );
  assert.equal(/organization_code|slug|is_active|tenant_id/.test(fields), false);
  assert.match(SOURCE, /<dt>Tenant UUID<\/dt><dd>\{detail\.id\}<\/dd>/);
  assert.match(SOURCE, /<dt>Organization code<\/dt><dd>\{detail\.organization_code\}<\/dd>/);
  assert.match(SOURCE, /<dt>Slug<\/dt><dd>\{detail\.slug\}<\/dd>/);
  assert.match(SOURCE, /updateTenantMetadataForAdministration\(detail\.id, metadataForm, metadataReason\)/);
});

// -- Tenant Branding P-1 -----------------------------------------------------

test("branding fields group under Branding & Appearance, operational fields under Operational settings", () => {
  assert.match(SOURCE, /title="Branding & Appearance"/);
  assert.match(SOURCE, /title="Operational settings"/);

  const brandingFields = SOURCE.slice(
    SOURCE.indexOf("function TenantBrandingFields"),
    SOURCE.indexOf("function TenantOperationalFields"),
  );
  for (const key of [
    "organization_name",
    "display_name",
    "app_title",
    "app_tagline",
    "logo_url",
    "favicon_url",
  ]) {
    assert.ok(brandingFields.includes(key), `Branding & Appearance owns ${key}`);
  }
  assert.match(brandingFields, /BRANDING_COLOR_FIELDS\.map/);

  const operationalFields = SOURCE.slice(
    SOURCE.indexOf("function TenantOperationalFields"),
    SOURCE.indexOf("function TenantMetadataFields"),
  );
  assert.ok(operationalFields.includes("tenant_type_id"));
  assert.ok(operationalFields.includes("post_event_edit_window_days"));
  assert.equal(/logo_url|primary_color|app_title/.test(operationalFields), false);
});

test("the split is presentational: still exactly one governed save path", () => {
  assert.equal(
    (SOURCE.match(/updateTenantMetadataForAdministration\(/g) || []).length,
    1,
  );
  assert.equal((SOURCE.match(/onSubmit=\{saveMetadata\}/g) || []).length, 1);
  assert.equal((SOURCE.match(/onSubmit=\{createTenant\}/g) || []).length, 1);
  assert.match(SOURCE, /<TenantBrandingPreview form=\{metadataForm\} \/>/);
  assert.match(SOURCE, /<TenantBrandingFields[\s\S]{0,200}colorErrors=\{metadataColorErrors\}/);
  assert.match(SOURCE, /<TenantOperationalFields[\s\S]{0,200}form=\{metadataForm\}/);
});

test("client color validation flows through the shared validateMetadata path and blocks save/create on error", () => {
  assert.match(SOURCE, /isValidBrandColor,?\n?\s*\} from "@\/lib\/tenantBrandingColor"/);
  assert.match(SOURCE, /function brandingColorErrors\(/);
  assert.match(SOURCE, /const colorErrors = brandingColorErrors\(form\);/);
  assert.match(SOURCE, /disabled=\{!metadataDirty \|\| metadataHasColorErrors\}/);
  assert.match(SOURCE, /disabled=\{createHasColorErrors\}/);
  assert.match(SOURCE, /error=\{colorErrors\[key\]\}/);
  // no silent normalization/rewrite of a stored color value
  assert.equal(/normaliz/i.test(SOURCE), false);
});

test("each brand color keeps an authoritative text field plus a native picker writing the same state", () => {
  assert.match(SOURCE, /type="color"/);
  assert.match(SOURCE, /aria-label=\{`\$\{label\} picker`\}/);
  const colorBlock = SOURCE.slice(
    SOURCE.indexOf("BRANDING_COLOR_FIELDS.map(({ key, label }) =>"),
    SOURCE.indexOf("function TenantOperationalFields"),
  );
  const sameStateWrites = colorBlock.match(/\[key\]: event\.target\.value/g) || [];
  assert.equal(sameStateWrites.length, 2, "text field + picker both write [key]");
});

test("P-1 adds no FCOC/EventSync asset or literal brand fallback and no favicon runtime wiring", () => {
  assert.doesNotMatch(SOURCE, /fcoc-logo/i);
  assert.doesNotMatch(SOURCE, /\bFCOC\b/);
  assert.doesNotMatch(SOURCE, /EventSync/i);
  assert.doesNotMatch(SOURCE, /generateMetadata/);
  assert.match(SOURCE, /not yet applied to the browser tab icon/);
});

test("Platform Administrator authority is unchanged and no new mutation surface is introduced", () => {
  assert.match(SOURCE, /<AdminRouteGuard requiredPlatformAuthority>/);
  assert.equal((SOURCE.match(/requiredPlatformAuthority/g) || []).length, 1);
  const combined = `${SOURCE}\n${CLIENT_SOURCE}`;
  for (const table of ["tenants", "admin_tenant_access", "tenant_hostname_mappings"]) {
    assert.equal(new RegExp(`\\.from\\(["']${table}["']\\)`).test(combined), false);
  }
  assert.equal(/\.insert\(|\.update\(|\.delete\(/.test(combined), false);
  assert.equal(/checkAdminTenantAuthority|has_any_tenant_admin_authority/.test(SOURCE), false);
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

// -- Tenant Branding P-1A: widen Add Tenant desktop workspace ---------------

const CSS_SOURCE = readFileSync(
  fileURLToPath(new URL("../../globals.css", import.meta.url)),
  "utf8",
);

test("Add Tenant uses the shared intentional wide/container dialog variant, not a bespoke or global widening", () => {
  const dialog = SOURCE.slice(
    SOURCE.indexOf('title="Add Tenant"'),
    SOURCE.indexOf("open={statusDialogOpen}"),
  );
  // The Add Tenant Dialog panel now opts into app-dialog-form (the same
  // width/height/container variant admin-users and nearby already use).
  assert.match(dialog, /className="app-dialog-form(?: [^"]*)?"/);
  assert.equal(/app-dialog-wide/.test(dialog), false);

  // That variant is viewport-responsive with safe margins, and the shared
  // base .app-dialog rule is untouched (no global modal widening).
  assert.match(
    CSS_SOURCE,
    /\.app-dialog-form \{\s*\n\s*max-width: min\(1080px, calc\(100vw - 32px\)\);/,
  );
  assert.match(CSS_SOURCE, /\.app-dialog \{\s*\n\s*width: 100%;\s*\n\s*max-width: 460px;/);
  assert.match(CSS_SOURCE, /\.app-dialog-wide \{\s*\n\s*max-width: 900px;\s*\n\}/);
});

test("the first four field groups stay logically paired in the shared two-column grid", () => {
  const brandingFields = SOURCE.slice(
    SOURCE.indexOf("function TenantBrandingFields"),
    SOURCE.indexOf('<div className="tenant-branding-color-grid">'),
  );
  // org name + display name + app title + tagline + logo + favicon all live
  // in one .app-form-grid-2 (rows 2-4 of the desktop target); org code + slug
  // (row 1) are their own .app-form-grid-2 in the create dialog.
  assert.match(brandingFields, /<div className="app-form-grid-2">/);
  for (const key of [
    "organization_name",
    "display_name",
    "app_title",
    "app_tagline",
    "logo_url",
    "favicon_url",
  ]) {
    assert.ok(brandingFields.includes(key));
  }
  const createDialog = SOURCE.slice(
    SOURCE.indexOf('title="Add Tenant"'),
    SOURCE.indexOf("open={statusDialogOpen}"),
  );
  assert.match(createDialog, /organization_code[\s\S]{0,400}<Field label="Slug"/);
});

test("the three brand colors get a dedicated three-across row that collapses responsively", () => {
  assert.match(SOURCE, /<div className="tenant-branding-color-grid">/);
  assert.match(
    CSS_SOURCE,
    /\.tenant-branding-color-grid \{\s*\n\s*display: grid;\s*\n\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    CSS_SOURCE,
    /@media \(max-width: 899px\) \{\s*\n\s*\.tenant-branding-color-grid \{\s*\n\s*grid-template-columns: 1fr;/,
  );
  // the compact native picker never grows on narrow viewports
  assert.match(CSS_SOURCE, /\.tenant-branding-color-swatch-input \{[\s\S]*?flex: 0 0 auto;/);
});

test("P-1A is layout-only: creation path, authority, and mutation surface unchanged", () => {
  assert.match(SOURCE, /createTenantForAdministration\(createForm\)/);
  assert.match(SOURCE, /onSubmit=\{createTenant\}/);
  assert.match(SOURCE, /always created Inactive/);
  assert.match(SOURCE, /<AdminRouteGuard requiredPlatformAuthority>/);
  assert.equal((SOURCE.match(/requiredPlatformAuthority/g) || []).length, 1);
  assert.equal(
    (SOURCE.match(/updateTenantMetadataForAdministration\(/g) || []).length,
    1,
  );
  const combined = `${SOURCE}\n${CLIENT_SOURCE}`;
  assert.equal(/\.insert\(|\.update\(|\.delete\(/.test(combined), false);
  assert.doesNotMatch(SOURCE, /fcoc-logo/i);
  assert.doesNotMatch(SOURCE, /\bFCOC\b/);
});

// -- Tenant Branding P-1B: compact Add Tenant form / one-page desktop fit ---

test("P-1A wide dialog stays: the panel still opts into app-dialog-form and never returns to app-dialog-wide", () => {
  const dialog = SOURCE.slice(
    SOURCE.indexOf('title="Add Tenant"'),
    SOURCE.indexOf("open={statusDialogOpen}"),
  );
  assert.match(dialog, /className="app-dialog-form tenant-create-dialog"/);
  assert.equal(/app-dialog-wide/.test(dialog), false);
  assert.match(
    CSS_SOURCE,
    /\.app-dialog-form \{\s*\n\s*max-width: min\(1080px, calc\(100vw - 32px\)\);/,
  );
});

test("the Add Tenant form carries the scoped compact treatment on a plain scoped class", () => {
  assert.match(
    SOURCE,
    /id="create-tenant-form"\s*\n\s*className="tenant-create-form"/,
  );
  // the inner form no longer carries the shared app-dialog-form / app-stack-8
  // classes -- .tenant-create-form is self-contained (P-1C simplification)
  assert.doesNotMatch(
    SOURCE,
    /id="create-tenant-form"[\s\S]{0,80}app-dialog-form/,
  );
  assert.match(CSS_SOURCE, /\.tenant-create-form \{\s*\n\s*display: grid;\s*\n\s*gap: var\(--space-2\);/);
  assert.match(CSS_SOURCE, /\.tenant-create-form \.app-field \{\s*\n\s*gap: var\(--space-1\);/);
  assert.match(
    CSS_SOURCE,
    /@media \(min-width: 900px\) \{[\s\S]*?\.tenant-create-form \.app-control \{\s*\n\s*min-height: 2\.25rem;/,
  );
});

test("compactness is scoped to the Add Tenant workspace -- shared control/field/dialog rules are untouched", () => {
  // shared .app-control keeps its 45px touch target and 10px padding
  assert.match(
    CSS_SOURCE,
    /\.app-control,[\s\S]*?\.app-form-input \{\s*\n\s*width: 100%;\s*\n\s*min-height: var\(--touch-target-min\);\s*\n\s*padding: var\(--space-4\);/,
  );
  // shared .app-field keeps its --space-2 rhythm
  assert.match(CSS_SOURCE, /\.app-field \{\s*\n\s*display: grid;\s*\n\s*gap: var\(--space-2\);\s*\n\}/);
  // every tenant-create control/field override is prefixed with a tenant-create scope
  const block = CSS_SOURCE.slice(
    CSS_SOURCE.indexOf("Tenant Branding P-1A/B/C"),
    CSS_SOURCE.indexOf("/* Tenant Branding P-1: a text field paired"),
  );
  for (const line of block.split("\n")) {
    if (/\.app-(control|field|form-grid-2)\b/.test(line) && line.trim().endsWith("{")) {
      assert.match(
        line,
        /\.tenant-create-form /,
        `rule must be scoped to .tenant-create-form: ${line.trim()}`,
      );
    }
  }
});

test("Post-Event edit window is a deliberately compact numeric control; Tenant type keeps a useful width", () => {
  assert.match(SOURCE, /function TenantOperationalFields\(\{[\s\S]*?compact,/);
  assert.match(
    SOURCE,
    /className=\{compact \? "tenant-operational-row-compact" : "app-form-grid-2"\}/,
  );
  // create dialog opts in; the per-Tenant editor does not
  assert.match(SOURCE, /<TenantOperationalFields\s*\n\s*form=\{form\}\s*\n\s*tenantTypes=\{tenantTypes\}\s*\n\s*disabled=\{disabled\}\s*\n\s*compact\s*\n\s*onChange=\{onChange\}/);
  assert.match(
    CSS_SOURCE,
    /@media \(min-width: 900px\) \{[\s\S]*?\.tenant-operational-row-compact \{\s*\n\s*grid-template-columns: minmax\(0, 1fr\) minmax\(200px, 240px\);/,
  );
  // semantics unchanged: still a number input writing post_event_edit_window_days
  assert.match(SOURCE, /type="number"[\s\S]{0,260}post_event_edit_window_days: event\.target\.value/);
  assert.match(SOURCE, /Leave blank to use no Tenant-specific override\. Zero is preserved\./);
});

test("Reason textarea has a reduced default desktop footprint but stays a real, resizable field", () => {
  const createDialog = SOURCE.slice(
    SOURCE.indexOf('title="Add Tenant"'),
    SOURCE.indexOf("open={statusDialogOpen}"),
  );
  assert.match(createDialog, /<Field label="Reason"[\s\S]*?<Textarea\s*\n\s*\{\.\.\.props\}\s*\n\s*rows=\{2\}/);
  assert.match(CSS_SOURCE, /\.tenant-create-form textarea\.app-control \{\s*\n\s*min-height: 3\.5rem;/);
  assert.match(CSS_SOURCE, /textarea\.app-control,[\s\S]*?\{\s*\n\s*resize: vertical;/);
  // Reason field, payload and audit copy unchanged
  assert.match(createDialog, /Optional administrative context for the audit history\./);
  assert.match(createDialog, /reason: event\.target\.value/);
});

test("P-1B keeps the three-color desktop row and responsive collapse intact", () => {
  assert.match(SOURCE, /<div className="tenant-branding-color-grid">/);
  assert.match(
    CSS_SOURCE,
    /\.tenant-branding-color-grid \{\s*\n\s*display: grid;\s*\n\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    CSS_SOURCE,
    /@media \(max-width: 899px\) \{\s*\n\s*\.tenant-branding-color-grid \{\s*\n\s*grid-template-columns: 1fr;/,
  );
  // the compact operational row is single-column by default and only becomes
  // the asymmetric two-column layout at >= 900px
  assert.match(
    CSS_SOURCE,
    /\.tenant-operational-row-compact \{\s*\n\s*display: grid;\s*\n\s*grid-template-columns: 1fr;/,
  );
});

test("P-1B is layout-only: creation, authority, and P-1 color validation all unchanged", () => {
  assert.match(SOURCE, /createTenantForAdministration\(createForm\)/);
  assert.match(SOURCE, /onSubmit=\{createTenant\}/);
  assert.match(SOURCE, /always created Inactive/);
  assert.match(SOURCE, /does not create Events, hostname mappings, or Tenant Administrator appointments/);
  assert.match(SOURCE, /<AdminRouteGuard requiredPlatformAuthority>/);
  assert.equal((SOURCE.match(/requiredPlatformAuthority/g) || []).length, 1);
  assert.match(SOURCE, /function brandingColorErrors\(/);
  assert.match(SOURCE, /disabled=\{createHasColorErrors\}/);
  assert.match(SOURCE, /disabled=\{!metadataDirty \|\| metadataHasColorErrors\}/);
  const combined = `${SOURCE}\n${CLIENT_SOURCE}`;
  assert.equal(/\.insert\(|\.update\(|\.delete\(/.test(combined), false);
  for (const table of ["tenants", "tenant_hostname_mappings", "admin_tenant_access"]) {
    assert.equal(new RegExp(`\\.from\\(["']${table}["']\\)`).test(combined), false);
  }
  assert.doesNotMatch(SOURCE, /fcoc-logo/i);
  assert.doesNotMatch(SOURCE, /\bFCOC\b/);
  assert.doesNotMatch(SOURCE, /generateMetadata/);
});

// -- Tenant Branding P-1C: remove Add Tenant dead space -------------------

const P1C_BLOCK = CSS_SOURCE.slice(
  CSS_SOURCE.indexOf("Tenant Branding P-1A/B/C"),
  CSS_SOURCE.indexOf("/* Tenant Branding P-1: a text field paired"),
);

test("P-1C: no fixed or minimum height is imposed on the Add Tenant dialog or form", () => {
  // the form is a content-sized grid -- never height / min-height
  assert.match(CSS_SOURCE, /\.tenant-create-form \{\s*\n\s*display: grid;\s*\n\s*gap: var\(--space-2\);\s*\n\s*min-width: 0;\s*\n\}/);
  assert.equal(/\.tenant-create-form \{[^}]*\bheight:/.test(CSS_SOURCE), false);
  assert.equal(/\.tenant-create-form \{[^}]*\bmin-height:/.test(CSS_SOURCE), false);
  assert.equal(/\.tenant-create-dialog \{[^}]*\b(?:min-)?height:/.test(CSS_SOURCE), false);
  // the only height on the panel remains the shared max-height safety ceiling
  assert.match(CSS_SOURCE, /\.app-dialog-form \{\s*\n\s*max-width: min\(1080px, calc\(100vw - 32px\)\);\s*\n\s*max-height: min\(90vh, 90dvh\);/);
});

test("P-1C root-cause fix: paired create-form grids align to the top so a short field is never stretched to a taller neighbour", () => {
  assert.match(
    P1C_BLOCK,
    /\.tenant-create-form \.app-form-grid-2,\s*\n\s*\.tenant-create-form \.tenant-branding-color-grid \{\s*\n\s*align-items: start;/,
  );
  assert.match(P1C_BLOCK, /\.tenant-operational-row-compact \{[\s\S]*?align-items: start;/);
  // no spacer / flex-grow / 1fr row / stretch pushes Reason or the footer down
  assert.equal(/flex-grow|flex: 1|grid-auto-rows: 1fr|align-content: stretch|margin-top: auto/.test(P1C_BLOCK), false);
});

test("P-1C: the redundant app-dialog-form on the inner form is removed; the panel keeps it", () => {
  const dialog = SOURCE.slice(
    SOURCE.indexOf('title="Add Tenant"'),
    SOURCE.indexOf("open={statusDialogOpen}"),
  );
  assert.match(dialog, /className="app-dialog-form tenant-create-dialog"/); // panel
  assert.match(dialog, /id="create-tenant-form"\s*\n\s*className="tenant-create-form"/); // form
  assert.equal((dialog.match(/app-dialog-form/g) || []).length, 1);
  assert.equal(/app-stack-8/.test(dialog), false);
});

test("P-1C: structural order is code/slug -> branding -> operational row -> Reason -> actions", () => {
  const dialog = SOURCE.slice(
    SOURCE.indexOf('title="Add Tenant"'),
    SOURCE.indexOf("</Dialog>"),
  );
  const iCodeSlug = dialog.indexOf('label="Organization code"');
  const iMeta = dialog.indexOf("<TenantMetadataFields");
  const iReason = dialog.indexOf('<Field label="Reason"');
  const iFormEnd = dialog.indexOf("</form>");
  assert.ok(iCodeSlug > -1 && iMeta > iCodeSlug && iReason > iMeta && iFormEnd > iReason);
  // TenantMetadataFields renders branding fields then the operational row
  const meta = SOURCE.slice(
    SOURCE.indexOf("function TenantMetadataFields"),
    SOURCE.indexOf("function TenantAdministrationWorkspace"),
  );
  assert.ok(
    meta.indexOf("<TenantBrandingFields") < meta.indexOf("<TenantOperationalFields"),
  );
  // Reason is a normal grid row of the form, not anchored to the panel bottom
  assert.equal(/position:\s*sticky|position:\s*absolute|margin-top:\s*auto/.test(P1C_BLOCK), false);
});

test("P-1C keeps P-1A width, P-1B compact controls, 3-column colors, two-row Reason and 45px touch below 900px", () => {
  // P-1A width unchanged
  assert.match(CSS_SOURCE, /\.app-dialog-form \{\s*\n\s*max-width: min\(1080px, calc\(100vw - 32px\)\);/);
  assert.equal(/app-dialog-wide/.test(SOURCE.slice(SOURCE.indexOf('title="Add Tenant"'), SOURCE.indexOf("open={statusDialogOpen}"))), false);
  // P-1B compact controls still desktop-only
  assert.match(P1C_BLOCK, /@media \(min-width: 900px\) \{[\s\S]*?\.tenant-create-form \.app-control \{\s*\n\s*min-height: 2\.25rem;/);
  // 3-column colors + collapse
  assert.match(CSS_SOURCE, /\.tenant-branding-color-grid \{\s*\n\s*display: grid;\s*\n\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(CSS_SOURCE, /@media \(max-width: 899px\) \{\s*\n\s*\.tenant-branding-color-grid \{\s*\n\s*grid-template-columns: 1fr;/);
  // Reason rows=2, min-height 3.5rem, resize preserved
  const createDialog = SOURCE.slice(SOURCE.indexOf('title="Add Tenant"'), SOURCE.indexOf("open={statusDialogOpen}"));
  assert.match(createDialog, /<Field label="Reason"[\s\S]*?rows=\{2\}/);
  assert.match(P1C_BLOCK, /\.tenant-create-form textarea\.app-control \{\s*\n\s*min-height: 3\.5rem;/);
  // compact heights are gated to >= 900px, so tablet/phone keep the 45px target
  const desktopOnly = P1C_BLOCK.slice(P1C_BLOCK.indexOf("@media (min-width: 900px)"));
  assert.match(desktopOnly, /\.tenant-create-form \.app-control \{\s*\n\s*min-height: 2\.25rem;/);
  assert.equal(/min-height: 2\.25rem/.test(P1C_BLOCK.slice(0, P1C_BLOCK.indexOf("@media (min-width: 900px)"))), false);
});

test("P-1C is layout-only: creation path, authority, validation and P-1 preview all unchanged", () => {
  assert.match(SOURCE, /createTenantForAdministration\(createForm\)/);
  assert.match(SOURCE, /onSubmit=\{createTenant\}/);
  assert.match(SOURCE, /always created Inactive/);
  assert.match(SOURCE, /does not create Events, hostname mappings, or Tenant Administrator appointments/);
  assert.match(SOURCE, /<AdminRouteGuard requiredPlatformAuthority>/);
  assert.equal((SOURCE.match(/requiredPlatformAuthority/g) || []).length, 1);
  assert.match(SOURCE, /disabled=\{createHasColorErrors\}/);
  assert.match(SOURCE, /function brandingColorErrors\(/);
  assert.match(SOURCE, /<TenantBrandingPreview form=\{metadataForm\} \/>/);
  const combined = `${SOURCE}\n${CLIENT_SOURCE}`;
  assert.equal(/\.insert\(|\.update\(|\.delete\(/.test(combined), false);
  for (const table of ["tenants", "tenant_hostname_mappings", "admin_tenant_access"]) {
    assert.equal(new RegExp(`\\.from\\(["']${table}["']\\)`).test(combined), false);
  }
  assert.doesNotMatch(SOURCE, /fcoc-logo/i);
  assert.doesNotMatch(SOURCE, /\bFCOC\b/);
  assert.doesNotMatch(SOURCE, /generateMetadata/);
});
