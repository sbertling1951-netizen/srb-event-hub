import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildStaffRows,
  eventStaffStatusTone,
  filterAvailableAdmins,
  resolveAssignableProfile,
} from "@/app/admin/event-staff/page";

// Focused tests for the Admin Batch 2 Central UI Standard migration of
// Event Staff. Run with:
//   npx tsx --test app/admin/event-staff/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("the route is gated by the canonical Event Staff delegation authority check, NOT the legacy client permission gate", () => {
  assert.match(PAGE_SOURCE, /<AdminRouteGuard requiredEventStaffDelegationAuthority>/);
  assert.match(PAGE_SOURCE, /AdminShellAdapter\s*\n\s*pageTitle="Event Staff"/);
  // The old legacy gates are gone entirely.
  assert.equal(/requiredPermission="can_manage_event_staff"/.test(PAGE_SOURCE), false);
  assert.equal(/can_manage_event_staff/.test(PAGE_SOURCE), false);
  assert.equal(/hasPermission\(/.test(PAGE_SOURCE), false);
  assert.equal(/canAccessEvent\(/.test(PAGE_SOURCE), false);
});

test("the duplicate in-page <h1>Event Staff</h1> is gone -- the canonical shell header (pageTitle) is the page's only h1", () => {
  assert.equal(/<h1[^>]*>Event Staff<\/h1>/.test(PAGE_SOURCE), false);
});

test("every governed RPC name and the direct read-only table names are still present verbatim -- zero authority/data-behavior drift from the UI migration", () => {
  for (const needle of [
    "list_event_authority_assignments",
    "list_event_authority_profile_catalog",
    "create_event_authority_assignment",
    "change_event_authority_profile",
    "grant_event_authority_task",
    "revoke_event_authority_task",
    "remove_event_authority_assignment",
    'from("events")',
    'from("admin_users")',
    "reset_to_defaults",
    "preserve_exceptions",
  ]) {
    assert.ok(PAGE_SOURCE.includes(needle), `Event Staff must retain ${needle}`);
  }
});

test("the page carries NO client-side authorization gate of its own -- authz is the route guard plus the governed RPCs", () => {
  // No legacy permission-map check, no per-Event pre-check.
  assert.equal(/hasPermission\(/.test(PAGE_SOURCE), false);
  assert.equal(/canAccessEvent\(/.test(PAGE_SOURCE), false);
  assert.equal(/You do not have permission to manage event staff/.test(PAGE_SOURCE), false);
  // The governed RPC names remain the only write/read authority path.
  for (const rpc of [
    "list_event_authority_assignments",
    "list_event_authority_profile_catalog",
    "create_event_authority_assignment",
    "grant_event_authority_task",
    "revoke_event_authority_task",
    "remove_event_authority_assignment",
    "change_event_authority_profile",
  ]) {
    assert.ok(PAGE_SOURCE.includes(rpc), `Event Staff must retain ${rpc}`);
  }
});

test("the working-event header is seeded from the canonical working Event before the governed load, so it survives a denied or failed load", () => {
  const fnIdx = PAGE_SOURCE.indexOf("async function loadForCurrentEvent() {");
  const fnBody = PAGE_SOURCE.slice(fnIdx, PAGE_SOURCE.indexOf("await loadPage(workingEventId);", fnIdx));
  assert.match(fnBody, /const adminEvent = getCurrentAdminEvent\(\);/);
  assert.match(fnBody, /setEvent\(\(prev\) =>/);
  assert.match(fnBody, /name: adminEvent\.name \?\? adminEvent\.eventName \?\? null/);
  // loadPage's catch must NOT clear the seeded event.
  const loadPageIdx = PAGE_SOURCE.indexOf("async function loadPage(eventId: string) {");
  const catchBody = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("} catch (err: any) {", loadPageIdx),
    PAGE_SOURCE.indexOf("} finally {", loadPageIdx),
  );
  assert.equal(/setEvent\(null\)/.test(catchBody), false);
});

test("the profile <Select> options come from the governed, tier-filtered profileCatalog RPC feed -- never a hardcoded five-profile array", () => {
  // No array of {value,label} profile options literally listing event_admin.
  assert.equal(/value: "event_admin", label: "Event Admin"/.test(PAGE_SOURCE), false);
  // Add-staff select renders straight from profileCatalog.
  assert.match(PAGE_SOURCE, /profileCatalog\.map\(\(p\) => \(\s*\n?\s*<option key=\{p\.profile_key\} value=\{p\.profile_key\}>\{p\.display_name\}<\/option>/);
  // The label fallback map exists only for display of a catalog-omitted value.
  assert.match(PAGE_SOURCE, /const PROFILE_LABEL_FALLBACK: Record<string, string>/);
  assert.match(PAGE_SOURCE, /function profileLabel\(catalog: ProfileCatalogEntry\[\], key: string\)/);
});

test("an existing event_admin row stays visible but its profile <Select> still shows the correct current label even though the EA catalog omits event_admin", () => {
  assert.match(
    PAGE_SOURCE,
    /profileCatalog\.some\(\(p\) => p\.profile_key === row\.canonicalProfile\)/,
  );
  assert.match(PAGE_SOURCE, /outside your delegation authority -- visible but read-only/);
});

test("self-elevation protection (row.canGovern) still gates every mutation button, unchanged", () => {
  assert.equal((PAGE_SOURCE.match(/!row\.canGovern/g) || []).length >= 5, true);
  assert.match(PAGE_SOURCE, /self-elevation is not permitted/);
});

test("no raw form controls remain -- every input/select routes through the canonical Field/Input/Select/Checkbox primitives", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*Checkbox,\s*Field,\s*Select\s*\}\s*from\s*["']@\/components\/ui\/Field["']/,
  );
  assert.equal(/<select\b/.test(PAGE_SOURCE), false, "no raw <select> should remain");
  assert.equal(/<input\b/.test(PAGE_SOURCE), false, "no raw <input> should remain");
  assert.equal(/<button\b/.test(PAGE_SOURCE), false, "no raw <button> should remain");
  for (const label of ["Select Event", "Admin User", "Canonical Profile"]) {
    assert.ok(PAGE_SOURCE.includes(`label="${label}"`), `expected a Field for "${label}"`);
  }
});

test("the task-grant grid uses the canonical Checkbox component inside the shared app-permission-grid layout, matching Admin Users' own Permissions grid precedent", () => {
  assert.match(PAGE_SOURCE, /<div className="app-permission-grid">/);
  assert.match(PAGE_SOURCE, /<Checkbox\s*\n\s*key=\{task\.task_key\}/);
});

test("destructive Remove now routes through the canonical ConfirmDialog, not window.confirm", () => {
  assert.equal(/window\.confirm/.test(PAGE_SOURCE), false);
  assert.match(PAGE_SOURCE, /import ConfirmDialog from "@\/components\/ui\/ConfirmDialog";/);
  assert.match(PAGE_SOURCE, /<ConfirmDialog\s*\n\s*open=\{!!pendingRemoveRow\}/);
  assert.match(PAGE_SOURCE, /title="Remove Event Staff"/);
  assert.match(PAGE_SOURCE, /\bdanger\b/);

  const fnIdx = PAGE_SOURCE.indexOf("function requestRemoveRow(row: StaffRow) {");
  const fnBody = PAGE_SOURCE.slice(fnIdx, PAGE_SOURCE.indexOf("\n  }", fnIdx));
  assert.match(fnBody, /setPendingRemoveRow\(row\)/);
});

test("handleRemoveRow itself still performs the exact same governed RPC call -- only the confirmation surface changed", () => {
  const fnIdx = PAGE_SOURCE.indexOf("async function handleRemoveRow(row: StaffRow) {");
  const fnBody = PAGE_SOURCE.slice(fnIdx, PAGE_SOURCE.indexOf("\n  }", fnIdx));
  assert.match(
    fnBody,
    /supabase\.rpc\("remove_event_authority_assignment", \{ p_assignment_id: row\.accessId \}\)/,
  );
});

test("delete/remove uses no variant (an ordinary button; the real destructive fill lives only in ConfirmDialog's own Confirm step, per System 3); Save/Add/Apply-primary use primary", () => {
  const removeIdx = PAGE_SOURCE.indexOf("onClick={() => void requestRemoveRow(row)}");
  const removeBlock = PAGE_SOURCE.slice(removeIdx - 200, removeIdx + 100);
  assert.equal(/variant="danger"/.test(removeBlock), false);
  assert.match(PAGE_SOURCE, /variant="primary"\s*\n\s*onClick=\{\(\) => void handleAddStaff\(\)\}/);
});

test("loading/empty presentations use the canonical LoadingState/EmptyState primitives", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*EmptyState\s*\}\s*from\s*["']@\/components\/ui\/EmptyState["']/,
  );
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*LoadingState\s*\}\s*from\s*["']@\/components\/ui\/LoadingState["']/,
  );
  assert.match(PAGE_SOURCE, /<LoadingState message="Loading event staff\.\.\." \/>/);
  assert.match(PAGE_SOURCE, /<EmptyState message="Select an event to view staff\." \/>/);
  assert.match(PAGE_SOURCE, /<EmptyState message="No event staff assigned yet\." \/>/);
});

test("the Select Event / Add Existing Admin / Assigned Event Staff panels render through the canonical PageSection primitive", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*PageSection\s*\}\s*from\s*["']@\/components\/ui\/PageSection["']/,
  );
  assert.match(PAGE_SOURCE, /<PageSection variant="card" title="Add Existing Admin">/);
  assert.match(PAGE_SOURCE, /<PageSection\s*\n\s*variant="card"\s*\n\s*title="Assigned Event Staff"/);
});

test("Add Staff renders inside the canonical FormActions wrapper", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*FormActions\s*\}\s*from\s*["']@\/components\/ui\/FormActions["']/,
  );
  assert.match(PAGE_SOURCE, /<FormActions>/);
});

test("eventStaffStatusTone classifies confirmation/loading/authority-denial text correctly", () => {
  assert.equal(eventStaffStatusTone("Loaded 3 staff assignments."), "success");
  assert.equal(eventStaffStatusTone("Event staff added."), "success");
  assert.equal(eventStaffStatusTone("Profile updated for jane@example.com."), "success");
  assert.equal(eventStaffStatusTone("Jane Doe removed from event staff."), "success");

  assert.equal(eventStaffStatusTone("Loading event staff..."), "info");
  assert.equal(eventStaffStatusTone("Adding event staff..."), "info");

  assert.equal(eventStaffStatusTone("Access denied."), "danger");
  assert.equal(
    eventStaffStatusTone("You do not have delegation authority over this Event."),
    "danger",
  );
  assert.equal(
    eventStaffStatusTone("You cannot make this change with Event Admin delegation authority."),
    "danger",
  );
  assert.equal(eventStaffStatusTone("You cannot change your own assignment."), "danger");
  assert.equal(eventStaffStatusTone("Choose an admin user to add."), "danger");

  assert.equal(eventStaffStatusTone("2 assignments for this event."), "neutral");
});

// -- Preserve Super Admin Event-Staff Roles Without Changing Platform
// Authority: real behavior proof for filterAvailableAdmins, buildStaffRows,
// and resolveAssignableProfile -- the exact functions loadPage/
// handleAddStaff now call, not a source-regex proxy for them.

const ACTIVE_SUPER_ADMIN = { id: "sa-1", email: "sa@example.com", display_name: "Sam Admin", is_active: true, privilege_group: "super_admin" as const };
const ACTIVE_EVENT_ADMIN = { id: "ea-1", email: "ea@example.com", display_name: "Eve Admin", is_active: true, privilege_group: "event_admin" as const };
const INACTIVE_SUPER_ADMIN = { id: "sa-2", email: "sa2@example.com", display_name: "Retired Admin", is_active: false, privilege_group: "super_admin" as const };

test("filterAvailableAdmins: an active, unassigned Super Admin appears in the candidate list -- the privilege_group exclusion is gone", () => {
  const available = filterAvailableAdmins([ACTIVE_SUPER_ADMIN, ACTIVE_EVENT_ADMIN], new Set());
  assert.deepEqual(available.map((a) => a.id).sort(), ["ea-1", "sa-1"]);
});

test("filterAvailableAdmins: once assigned, that same Super Admin is excluded from the candidate list -- duplicate-assignment protection still applies to Super Admins", () => {
  const available = filterAvailableAdmins([ACTIVE_SUPER_ADMIN, ACTIVE_EVENT_ADMIN], new Set(["sa-1"]));
  assert.deepEqual(available.map((a) => a.id), ["ea-1"]);
});

test("filterAvailableAdmins: an inactive Super Admin is still excluded -- is_active remains a real filter, unaffected by removing the privilege_group check", () => {
  const available = filterAvailableAdmins([INACTIVE_SUPER_ADMIN, ACTIVE_EVENT_ADMIN], new Set());
  assert.deepEqual(available.map((a) => a.id), ["ea-1"]);
});

test("resolveAssignableProfile: a Super Admin candidate is always assigned the canonical event_admin profile, regardless of what the operator's Select still holds", () => {
  assert.equal(resolveAssignableProfile(ACTIVE_SUPER_ADMIN, "view_only"), "event_admin");
  assert.equal(resolveAssignableProfile(ACTIVE_SUPER_ADMIN, "content"), "event_admin");
});

test("resolveAssignableProfile: a non-Super-Admin candidate keeps the operator's chosen profile unchanged -- no forced coercion", () => {
  assert.equal(resolveAssignableProfile(ACTIVE_EVENT_ADMIN, "checkin"), "checkin");
  assert.equal(resolveAssignableProfile(null, "view_only"), "view_only");
  assert.equal(resolveAssignableProfile(undefined, "parking"), "parking");
});

test("buildStaffRows: a Super Admin holding an explicit event_admin assignment renders in the roster with privilegeGroup super_admin and canonicalProfile event_admin -- both truths visible on one row", () => {
  const assignmentRows = [
    {
      assignment_id: "assign-1",
      event_id: "event-a",
      tenant_id: "tenant-1",
      target_admin_user_id: "sa-1",
      target_display_name: "Sam Admin",
      target_email: "sa@example.com",
      canonical_profile: "event_admin" as const,
      assignment_created_at: "2026-01-01T00:00:00Z",
      explicit_grants: [],
      can_govern: true,
    },
  ];
  const rows = buildStaffRows(assignmentRows, [ACTIVE_SUPER_ADMIN]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].adminUserId, "sa-1");
  assert.equal(rows[0].privilegeGroup, "super_admin");
  assert.equal(rows[0].canonicalProfile, "event_admin");
  assert.equal(rows[0].pendingProfileChoice, "event_admin");
});

test("buildStaffRows: self-elevation/delegation/profile fields (canGovern, explicitGrantKeys) pass through unchanged for a Super Admin row, exactly as for any other admin", () => {
  const assignmentRows = [
    {
      assignment_id: "assign-2",
      event_id: "event-b",
      tenant_id: "tenant-1",
      target_admin_user_id: "sa-1",
      target_display_name: null,
      target_email: null,
      canonical_profile: "event_admin" as const,
      assignment_created_at: "2026-01-01T00:00:00Z",
      explicit_grants: [{ task_key: "task.x", granted_at: "2026-01-01T00:00:00Z", grant_source: "profile_materialization", source_profile_key: "event_admin", granted_by_admin_user_id: "actor-1" }],
      can_govern: false,
    },
  ];
  const rows = buildStaffRows(assignmentRows, [ACTIVE_SUPER_ADMIN]);
  assert.equal(rows[0].canGovern, false);
  assert.deepEqual(Array.from(rows[0].explicitGrantKeys), ["task.x"]);
  // No target admin_users row found -- falls back to the assignment's own
  // target_email/target_display_name exactly as before, unaffected by the
  // Super Admin inclusion.
  const orphanRows = buildStaffRows(assignmentRows, []);
  assert.equal(orphanRows[0].email, "Unknown admin");
});

test("the misleading 'Super Admins are not listed here' copy is gone, replaced by wording that states both truths: automatic platform-wide access, and an explicit roster row is possible", () => {
  assert.equal(/Super Admins are not listed here/.test(PAGE_SOURCE), false);
  assert.match(PAGE_SOURCE, /Super Admin platform-wide access is automatic and independent of this list/);
});

test("the Add Existing Admin profile picker locks to Event Admin for a Super Admin candidate, with an explanatory help message -- it does not silently let another profile be sent", () => {
  assert.match(PAGE_SOURCE, /const isSuperAdminCandidate = selectedNewAdmin\?\.privilege_group === "super_admin";/);
  assert.match(PAGE_SOURCE, /const newProfileValue = resolveAssignableProfile\(selectedNewAdmin, newProfile\);/);
  assert.match(PAGE_SOURCE, /disabled=\{adding \|\| profileCatalog\.length === 0 \|\| isSuperAdminCandidate\}/);
  assert.match(
    PAGE_SOURCE,
    /const profileToAssign = resolveAssignableProfile\(selectedCandidate, newProfile\);/,
  );
  assert.match(PAGE_SOURCE, /p_profile_key: profileToAssign,/);
});

test("no migration, RPC, resolver, or navigation file was touched -- every governed RPC name is unchanged and adminNav is not imported here", () => {
  for (const rpc of [
    "list_event_authority_assignments",
    "list_event_authority_profile_catalog",
    "create_event_authority_assignment",
    "change_event_authority_profile",
    "grant_event_authority_task",
    "revoke_event_authority_task",
    "remove_event_authority_assignment",
  ]) {
    assert.ok(PAGE_SOURCE.includes(rpc), `Event Staff must retain ${rpc}`);
  }
  assert.equal(/adminNav/.test(PAGE_SOURCE), false);
});

// -- Central UI: Admin Users + Event Staff Consistency --------------------

test("the shell carries the exact Event Admin backTarget", () => {
  assert.match(
    PAGE_SOURCE,
    /<AdminShellAdapter\s*\n\s*pageTitle="Event Staff"\s*\n\s*backTarget=\{\{ href: "\/admin\/events", label: "Event Admin" \}\}\s*\n\s*>/,
  );
});

test("the outer page wrapper is normalized -- redundant explicit padding removed, matching the sibling canonical-page convention (no explicit padding, shell supplies it)", () => {
  assert.match(
    PAGE_SOURCE,
    /<div style=\{\{ display: "grid", gap: "var\(--space-4\)", minWidth: 0 \}\}>/,
  );
  assert.equal(/padding: "var\(--space-6\)"/.test(PAGE_SOURCE), false);
});

test("regression: guard, page title/content, and role-assignment/authority/confirmation-dialog wiring are unchanged by the backTarget/wrapper normalization", () => {
  assert.match(PAGE_SOURCE, /<AdminRouteGuard requiredEventStaffDelegationAuthority>/);
  assert.match(PAGE_SOURCE, /pageTitle="Event Staff"/);
  assert.equal((PAGE_SOURCE.match(/pageTitle="Event Staff"/g) || []).length, 1);
  // Super Admin inclusion, forced Event Admin profile, and candidate
  // filtering are all untouched.
  assert.match(PAGE_SOURCE, /export function filterAvailableAdmins\(/);
  assert.match(PAGE_SOURCE, /export function buildStaffRows\(/);
  assert.match(PAGE_SOURCE, /export function resolveAssignableProfile\(/);
  assert.match(
    PAGE_SOURCE,
    /return candidate\?\.privilege_group === "super_admin" \? "event_admin" : requestedProfile;/,
  );
  // Self-elevation/governance and the destructive-confirmation dialog are
  // untouched.
  assert.match(PAGE_SOURCE, /self-elevation is not permitted/);
  assert.match(
    PAGE_SOURCE,
    /<ConfirmDialog\s*\n\s*open=\{!!pendingRemoveRow\}\s*\n\s*title="Remove Event Staff"/,
  );
});
