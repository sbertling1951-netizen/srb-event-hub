import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  announcementStatusTone,
  formatDate,
  priorityLabel,
  priorityTone,
} from "@/app/admin/announcements/page";

// Focused tests for the Event Context Single-Owner Integrity pass
// (docs/architecture/ADR-006 Event Context Architecture.md §3.1/§3.4):
// Announcements previously read the Admin working Event through
// lib/getAdminEvent.ts, a fourth, independently-parsed implementation
// over the same storage key. It must now consume the canonical
// getCurrentAdminEvent() and must never independently resolve, filter,
// or substitute an Event of its own. Run with:
//   npx tsx --test app/admin/announcements/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("Announcements reads the current Event only through the canonical getCurrentAdminEvent()", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{[^}]*getCurrentAdminEvent[^}]*\}\s*from\s*["']@\/lib\/adminWorkspaceContext["']/,
  );
  assert.match(PAGE_SOURCE, /const stored = getCurrentAdminEvent\(\);/);
});

test("the retired lib/getAdminEvent module is no longer referenced anywhere", () => {
  assert.equal(/getAdminEvent\b/.test(PAGE_SOURCE), false);
  assert.equal(/lib\/getAdminEvent/.test(PAGE_SOURCE), false);
});

test("Announcements never independently queries or filters an Event list -- it only consumes the canonical context", () => {
  assert.equal(/\.from\(\s*["']events["']\s*\)/.test(PAGE_SOURCE), false);
  assert.equal(/isActiveEventStatus/.test(PAGE_SOURCE), false);
  assert.equal(/events\[0\]/.test(PAGE_SOURCE), false);
});

test("Announcements never writes to the shared Admin working Event -- it is a pure consumer", () => {
  assert.equal(/setCurrentAdminEvent/.test(PAGE_SOURCE), false);
  assert.equal(/setAdminEvent\(/.test(PAGE_SOURCE), false);
});

test("an unauthorized stored Event enters an explicit access-denied state, never a silent substitute", () => {
  const fnIdx = PAGE_SOURCE.indexOf("function loadCurrentEvent()");
  assert.notEqual(fnIdx, -1);
  const fnBody = PAGE_SOURCE.slice(fnIdx, fnIdx + 700);

  assert.match(fnBody, /if \(!canAccessEvent\(admin!, stored\.id\)\)/);
  assert.match(fnBody, /setCurrentEvent\(null\)/);
  assert.match(fnBody, /You do not have access to this event\./);
});

test("no context ever established (nothing stored) surfaces an explicit prompt, never an auto-selected default", () => {
  assert.match(
    PAGE_SOURCE,
    /Select an admin working event before managing announcements\./,
  );
});

test("shell wrapper and AdminRouteGuard remain in place", () => {
  assert.match(PAGE_SOURCE, /AdminRouteGuard/);
  assert.match(PAGE_SOURCE, /AdminShellAdapter/);
});

// -- G-03A: Announcements route-authority migration ----------------------
//
// Announcements has no view-only mode -- the page's one job is
// Event-scoped announcement CRUD (create/edit/publish/pin/delete), all of
// which already route through governed RPCs that enforce
// event.announcements.manage server-side
// (20260814000000_create_announcements_governed_operations.sql) -- so the
// whole route requires event.announcements.manage, matching the pattern
// already established for Print Settings.

test("route requires event.announcements.manage, not the legacy can_manage_announcements permission", () => {
  assert.match(
    PAGE_SOURCE,
    /<AdminRouteGuard requiredTask="event\.announcements\.manage">/,
  );
  assert.equal(/requiredPermission/.test(PAGE_SOURCE), false);
  assert.equal(/can_manage_announcements/.test(PAGE_SOURCE), false);
  assert.equal(/hasPermission/.test(PAGE_SOURCE), false);
});

test("no direct has_event_task_authority RPC call is introduced -- authority is owned entirely by AdminRouteGuard", () => {
  assert.equal(/has_event_task_authority/.test(PAGE_SOURCE), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(PAGE_SOURCE), false);
});

test("announcement CRUD and publish/pin toggle behavior is unchanged", () => {
  for (const needle of [
    'from("announcements")',
    "create_event_announcement",
    "update_event_announcement",
    "delete_event_announcement",
    "is_pinned",
    "is_published",
  ]) {
    assert.ok(PAGE_SOURCE.includes(needle), `Announcements must retain ${needle}`);
  }
});

// -- UI Phase 2: reusable Admin table/list pattern, piloted here --------

test("formatDate renders a date-only string, and preserves each call site's own fallback wording", () => {
  assert.equal(formatDate(null, "No expiration"), "No expiration");
  assert.equal(formatDate(undefined, "Unknown"), "Unknown");
  assert.equal(formatDate("not-a-date", "Unknown"), "Unknown");

  const rendered = formatDate("2026-03-05T10:00:00.000Z", "Unknown");
  assert.notEqual(rendered, "Unknown");
  // Date-only, not a timestamp: no colon-separated time component.
  assert.equal(/\d{1,2}:\d{2}/.test(rendered), false);
});

test("priorityTone maps every supported priority to a distinct, semantic tone", () => {
  assert.equal(priorityTone("urgent"), "danger");
  assert.equal(priorityTone("high"), "warning");
  assert.equal(priorityTone("normal"), "info");
  assert.equal(priorityTone("low"), "neutral");
});

test("priorityTone is case-insensitive and defaults an absent priority to Normal's tone", () => {
  assert.equal(priorityTone("URGENT"), "danger");
  assert.equal(priorityTone(null), "info");
});

test("priorityLabel title-cases the stored value without inventing new priority names", () => {
  assert.equal(priorityLabel("urgent"), "Urgent");
  assert.equal(priorityLabel("low"), "Low");
  assert.equal(priorityLabel(null), "Normal");
});

test("announcementStatusTone classifies confirmation text as success, everything else as informational", () => {
  assert.equal(announcementStatusTone("Announcement created."), "success");
  assert.equal(announcementStatusTone("Announcement unpublished."), "success");
  assert.equal(announcementStatusTone("Announcement pinned."), "success");
  assert.equal(announcementStatusTone("Loading announcements..."), "info");
  assert.equal(announcementStatusTone("Creating announcement..."), "info");
  assert.equal(
    announcementStatusTone("Select an admin working event before managing announcements."),
    "info",
  );
});

test("the retired page-local isMobile/resize-listener breakpoint state is gone", () => {
  for (const forbidden of ["isMobile", 'addEventListener("resize"', "window.innerWidth"]) {
    assert.equal(
      PAGE_SOURCE.includes(forbidden),
      false,
      `page-local breakpoint state "${forbidden}" should be replaced by the shared useShellInterfaceCapabilities() hook`,
    );
  }
  assert.match(
    PAGE_SOURCE,
    /import\s*\{[^}]*useShellInterfaceCapabilities[^}]*\}\s*from\s*["']@\/components\/shell\/useShellViewport["']/,
  );
});

test("desktop and narrow-viewport presentations are both driven by the one shared isCompact signal", () => {
  assert.match(PAGE_SOURCE, /const \{ isCompact \} = useShellInterfaceCapabilities\(\);/);
  assert.match(PAGE_SOURCE, /isCompact \? \(/);
});

test("the desktop table uses the shared DataTable primitive with real column headers, not a hand-rolled table", () => {
  assert.match(PAGE_SOURCE, /<DataTable caption="[^"]+">/);
  for (const column of ["Title", "Status", "Priority", "Created", "Expires", "Actions"]) {
    assert.ok(
      PAGE_SOURCE.includes(`<th scope="col">${column}</th>`),
      `expected a <th scope="col"> for "${column}"`,
    );
  }
});

test("the narrow-viewport presentation uses the shared ResponsiveList primitive, not a second bespoke card layout", () => {
  assert.match(
    PAGE_SOURCE,
    /<ResponsiveList aria-labelledby="announcements-existing-heading">/,
  );
});

test("the ResponsiveList is named via aria-labelledby against the visible 'Existing Announcements' section heading", () => {
  assert.match(
    PAGE_SOURCE,
    /title="Existing Announcements"\s*\n\s*titleId="announcements-existing-heading"/,
  );
});

test("Published/Draft, priority, and Pinned all render through the shared StatusBadge -- text is the sole carrier, never color alone", () => {
  const badgeCount = (PAGE_SOURCE.match(/<StatusBadge/g) || []).length;
  // Status + Priority in each of the two presentations, plus a
  // conditional Pinned badge in each -- at minimum 4 call sites.
  assert.ok(badgeCount >= 4, `expected at least 4 StatusBadge usages, found ${badgeCount}`);
  assert.match(PAGE_SOURCE, />Published<|is_published \? "Published" : "Draft"/);
});

test("row actions carry a more specific accessible name than their visible label, for screen-reader users scanning many identically-labelled rows", () => {
  assert.match(PAGE_SOURCE, /aria-label=\{`Edit "\$\{name\}"`\}/);
  assert.match(PAGE_SOURCE, /aria-label=\{`Delete "\$\{name\}"`\}/);
});

test("the destructive action alone uses the danger button variant -- routine row actions stay visually equal", () => {
  const rowActionsIdx = PAGE_SOURCE.indexOf("function renderRowActions(");
  assert.notEqual(rowActionsIdx, -1);
  const rowActionsBody = PAGE_SOURCE.slice(rowActionsIdx, PAGE_SOURCE.indexOf("\n  }", rowActionsIdx));

  assert.equal((rowActionsBody.match(/variant="danger"/g) || []).length, 1);
  assert.equal(/variant="primary"/.test(rowActionsBody), false);
});

// -- Central UI Standard migration -----------------------------------------

test("the list ('Existing Announcements') is the first page section, the Add/Edit form second -- per the preferred Admin workflow hierarchy", () => {
  const listIdx = PAGE_SOURCE.indexOf('title="Existing Announcements"');
  const formIdx = PAGE_SOURCE.indexOf(
    'title={editingId ? "Edit Announcement" : "New Announcement"}',
  );
  assert.notEqual(listIdx, -1);
  assert.notEqual(formIdx, -1);
  assert.ok(listIdx < formIdx, "the announcement list must render before the create/edit form");
});

test("page-context status/error surfaces above both sections, not nested inside the form -- visible immediately after a row action in the list", () => {
  const listIdx = PAGE_SOURCE.indexOf('title="Existing Announcements"');
  const statusIdx = PAGE_SOURCE.indexOf("{!error && status ?");
  assert.notEqual(statusIdx, -1);
  assert.ok(statusIdx < listIdx, "status/error Alerts must render before the list section");
});

test("the Add/Edit form uses the canonical Field/Input/Select/Textarea/Checkbox primitives -- no raw form controls remain", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*Checkbox,\s*Field,\s*Input,\s*Select,\s*Textarea\s*\}\s*from\s*["']@\/components\/ui\/Field["']/,
  );
  assert.equal(/<input\b/.test(PAGE_SOURCE), false, "no raw <input> should remain");
  assert.equal(/<textarea\b/.test(PAGE_SOURCE), false, "no raw <textarea> should remain");
  assert.equal(/<select\b/.test(PAGE_SOURCE), false, "no raw <select> should remain");
  assert.equal(/type="checkbox"/.test(PAGE_SOURCE), false, "no raw checkbox input should remain");

  const formIdx = PAGE_SOURCE.indexOf(
    'title={editingId ? "Edit Announcement" : "New Announcement"}',
  );
  const formSource = PAGE_SOURCE.slice(formIdx);
  assert.match(formSource, /<Field label="Title" required error={fieldErrors\.title}>/);
  assert.match(formSource, /<Field label="Message" required error={fieldErrors\.body}>/);
  assert.match(formSource, /<Field label="Priority">/);
  assert.match(formSource, /<Field label="Expire At" help="[^"]+">/);
  assert.match(formSource, /<Checkbox\s+label="Pin this announcement"/);
  assert.match(formSource, /<Checkbox\s+label="Published"/);
});

test("the page-local fieldLabelStyle/checkboxLabelStyle inline-style constants are gone -- labeling now comes from the shared Field/Checkbox primitives", () => {
  assert.equal(/fieldLabelStyle/.test(PAGE_SOURCE), false);
  assert.equal(/checkboxLabelStyle/.test(PAGE_SOURCE), false);
});

test("Title and Message required-field validation surfaces as a field-level error via Field's own error prop, not only a page-level Alert", () => {
  assert.match(PAGE_SOURCE, /const \[fieldErrors, setFieldErrors\] = useState<\{ title\?: string; body\?: string \}>/);
  assert.match(PAGE_SOURCE, /nextFieldErrors\.title = "Title is required\."/);
  assert.match(PAGE_SOURCE, /nextFieldErrors\.body = "Message is required\."/);
});

test("editing an announcement scrolls the form section into view, not the page top -- the form now renders below the list", () => {
  assert.equal(/window\.scrollTo/.test(PAGE_SOURCE), false);
  assert.match(PAGE_SOURCE, /formSectionRef\.current\?\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(PAGE_SOURCE, /<section ref={formSectionRef}/);
});

test("resetForm also clears any pending field-level errors", () => {
  const fnIdx = PAGE_SOURCE.indexOf("function resetForm()");
  const fnBody = PAGE_SOURCE.slice(fnIdx, PAGE_SOURCE.indexOf("\n  }", fnIdx));
  assert.match(fnBody, /setFieldErrors\(\{\}\)/);
});

// -- Admin Batch 1 migration: LoadingState/EmptyState/FormActions ----------

test("loading and empty presentations use the canonical LoadingState/EmptyState primitives, not a hand-written neutral Alert", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*EmptyState\s*\}\s*from\s*["']@\/components\/ui\/EmptyState["']/,
  );
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*LoadingState\s*\}\s*from\s*["']@\/components\/ui\/LoadingState["']/,
  );
  assert.match(PAGE_SOURCE, /<LoadingState message="Loading selected event\.\.\." \/>/);
  assert.match(PAGE_SOURCE, /<EmptyState message="No event selected\." \/>/);
  assert.match(PAGE_SOURCE, /<LoadingState message="Loading announcements\.\.\." \/>/);
  assert.match(
    PAGE_SOURCE,
    /<EmptyState message="No announcements yet for this event\." \/>/,
  );
  assert.equal(
    /<Alert tone="neutral">Loading/.test(PAGE_SOURCE),
    false,
    "no hand-written neutral loading Alert should remain",
  );
});

test("the create/edit form's Save/Cancel row uses the canonical FormActions wrapper, not a raw app-button-row div", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*FormActions\s*\}\s*from\s*["']@\/components\/ui\/FormActions["']/,
  );
  assert.match(PAGE_SOURCE, /<FormActions>/);
  assert.equal(/className="app-button-row"/.test(PAGE_SOURCE), false);
});
