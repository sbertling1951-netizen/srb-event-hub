import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { eventStaffStatusTone } from "@/app/admin/event-staff/page";

// Focused tests for the Admin Batch 2 Central UI Standard migration of
// Event Staff. Run with:
//   npx tsx --test app/admin/event-staff/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("shell wrapper, AdminRouteGuard, and the existing can_manage_event_staff permission gate are unchanged", () => {
  assert.match(PAGE_SOURCE, /AdminRouteGuard requiredPermission="can_manage_event_staff"/);
  assert.match(PAGE_SOURCE, /AdminShellAdapter pageTitle="Event Staff"/);
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

test("the three-way permission check (can_manage_event_staff / can_manage_event_admins / can_manage_admins) is unchanged", () => {
  const fnIdx = PAGE_SOURCE.indexOf("useEffect(() => {");
  const fnBody = PAGE_SOURCE.slice(fnIdx, fnIdx + 700);
  assert.match(fnBody, /hasPermission\(safeAdmin, "can_manage_event_staff"\)/);
  assert.match(fnBody, /hasPermission\(safeAdmin, "can_manage_event_admins"\)/);
  assert.match(fnBody, /hasPermission\(safeAdmin, "can_manage_admins"\)/);
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
    eventStaffStatusTone("You do not have Platform or Tenant authority over this Event."),
    "danger",
  );
  assert.equal(eventStaffStatusTone("You cannot change your own assignment."), "danger");
  assert.equal(eventStaffStatusTone("Choose an admin user to add."), "danger");

  assert.equal(eventStaffStatusTone("2 assignments for this event."), "neutral");
});
