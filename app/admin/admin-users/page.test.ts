import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  adminUserStatusTone,
  formatEventOptionLabel,
  orderEventsForAccessSelector,
  pickInitialEventId,
} from "@/app/admin/admin-users/page";

// Central UI Standard, Stage 3 -- /admin/admin-users migration (first
// form-heavy proving ground). No HTTP/Supabase mocking infrastructure
// exists in this repository, so these are structural, source-level
// assertions -- the same style already established for
// app/admin/vendor-requests/page.test.ts and app/admin/checkin/page.test.ts.

const source = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("authority is unchanged: still gated on can_manage_admins, no permission/task swap", () => {
  assert.match(source, /<AdminRouteGuard requiredPermission="can_manage_admins">/);
  assert.equal(/requiredTask=/.test(source), false);
});

test("the page renders through the canonical PageSection, PageHeader, AppButton, Field, Alert, and StatusBadge primitives", () => {
  assert.match(source, /from "@\/components\/ui\/PageSection"/);
  assert.match(source, /from "@\/components\/ui\/PageHeader"/);
  assert.match(source, /from "@\/components\/ui\/AppButton"/);
  assert.match(source, /\{ Checkbox, Field, Input, Select \} from "@\/components\/ui\/Field"/);
  assert.match(source, /from "@\/components\/ui\/Alert"/);
  assert.match(source, /from "@\/components\/ui\/StatusBadge"/);
});

test("no hand-applied legacy style objects or app-button class strings remain", () => {
  for (const legacyStyleConst of [
    "labelStyle",
    "inputStyle",
    "primaryButtonStyle",
    "secondaryButtonStyle",
    "resetEmailButtonStyle",
    "errorBoxStyle",
    "listButtonStyle",
    "checkLabelStyle",
    "permissionLabelStyle",
    "tenantAdminLinkStyle",
  ]) {
    assert.equal(source.includes(legacyStyleConst), false, `${legacyStyleConst} should be removed`);
  }
  assert.equal(/className="app-button app-button-/.test(source), false);
});

test("the page no longer renders a duplicate <h1> page title -- the shell's own pageTitle is the single source", () => {
  assert.match(source, /<AdminShellAdapter pageTitle="Admin Users">/);
  assert.equal(/<h1[\s>]/.test(source), false);
});

test("internal layout responds to the Dialog's own width via CSS container queries, not a viewport-level JS signal -- no isCompact, no resize listener, no window.innerWidth anywhere on this page", () => {
  assert.equal(/isCompact/.test(source), false);
  assert.equal(/useShellInterfaceCapabilities/.test(source), false);
  assert.equal(/addEventListener\(\s*["']resize["']/.test(source), false);
  assert.equal(/window\.innerWidth/.test(source), false);
  assert.match(source, /className="app-dialog-form-pair"/);
  assert.match(source, /className="app-dialog-form-pair-auto"/);
});

test("Email, Display Name, Password, and Privilege Group are wired through Field with real label association (unique id via the control render-prop)", () => {
  assert.match(source, /<Field label="Email">/);
  assert.match(source, /<Field label="Display Name">/);
  assert.match(source, /label=\{selectedAdminId \? "Set New Password" : "Initial Password"\}/);
  assert.match(source, /<Field label="Privilege Group">/);
  assert.match(source, /\{\(controlProps\) => \(\s*<Input\s*\n?\s*\{\.\.\.controlProps\}/);
  assert.match(source, /\{\(controlProps\) => \(\s*<Select\s*\n?\s*\{\.\.\.controlProps\}/);
});

test("password field's help text is preserved as Field help, not a hand-rolled caption <div>", () => {
  assert.match(
    source,
    /help=\{\s*selectedAdminId\s*\?\s*"Only enter a password if you want to change it\."\s*:\s*"Temporary password for first login\."\s*\}/,
  );
});

test("permission checkboxes keep their exact read-only/derived-state semantics: readOnly + aria-readonly + explanatory title, not disabled", () => {
  const permissionsBlock = source.slice(
    source.indexOf("<strong>Permissions</strong>"),
    source.indexOf("<strong>Event Access</strong>"),
  );
  assert.match(permissionsBlock, /<Checkbox/);
  assert.match(permissionsBlock, /readOnly/);
  assert.match(permissionsBlock, /aria-readonly="true"/);
  assert.match(permissionsBlock, /title="Permission is controlled by the selected privilege group"/);
  assert.equal(/disabled(?!\?)/.test(permissionsBlock), false);
});

// Responsive density refinement (real-device follow-up #2): the Permissions
// list had far more vertical whitespace than necessary on a real iPhone.
// These assert the fix condenses inter-row spacing via a scoped CSS class
// (auto-fit column count driven by actual rendered width, no JS device
// check) while leaving the real touch-target floor completely untouched.

test("the Permissions grid uses the scoped app-permission-grid class, not a page-local inline grid style -- no device detection, pure CSS auto-fit", () => {
  const permissionsBlock = source.slice(
    source.indexOf("<strong>Permissions</strong>"),
    source.indexOf("<strong>Event Access</strong>"),
  );
  assert.match(permissionsBlock, /className="app-permission-grid"/);
  // The old page-local inline grid style (240px minmax, --space-4 gap) is
  // gone -- density now lives in the one scoped CSS class, not inline JSX.
  assert.equal(/gridTemplateColumns: "repeat\(auto-fit, minmax\(240px/.test(permissionsBlock), false);
  assert.equal(/window\.innerWidth/.test(permissionsBlock), false);
  assert.equal(/isCompact/.test(permissionsBlock), false);
});

test("app-permission-grid reduces only the row gap, via CSS gap's row/column shorthand -- it does not touch .app-field-checkable-label's own --touch-target-min floor", () => {
  const cssPath = fileURLToPath(new URL("../../globals.css", import.meta.url));
  const css = readFileSync(cssPath, "utf8");
  const ruleMatch = css.match(/\.app-permission-grid\s*\{([^}]*)\}/);
  assert.ok(ruleMatch, "expected an .app-permission-grid rule in app/globals.css");
  const rule = ruleMatch![1];
  assert.match(rule, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(260px,\s*1fr\)\)/);
  assert.match(rule, /gap:\s*var\(--space-2\)\s*var\(--space-4\)/);
  // The real touch-target floor lives on .app-field-checkable-label
  // (unchanged, elsewhere in globals.css) and is untouched by this rule.
  assert.match(css, /\.app-field-checkable-label\s*\{[^}]*min-height:\s*var\(--touch-target-min\);/);
});

// Automatically-sized, container-responsive edit workspace. Two prior
// approaches were tried and removed: hand-tuned fixed max-width/minmax
// pairs targeting one physical iPad's exact geometry, then a manual
// Pointer Events resize handle (not operable on a physical iPad). Both
// are gone. The architectural rule being proven: available space
// determines layout, device identity does not -- expressed entirely as
// pure CSS the browser recomputes on every layout pass (rotation,
// window resize, split-screen, fold/unfold, keyboard), with no resize/
// orientation listener, no manual resize hook, and no UA/device check
// anywhere in this page's own code.

test("app-dialog-form's width is a live CSS calc() derived from the viewport, not a value set by JS -- no manual resize hook, no resize handle, no Pointer Events resize state anywhere on this page", () => {
  const cssPath = fileURLToPath(new URL("../../globals.css", import.meta.url));
  const css = readFileSync(cssPath, "utf8");
  const dialogFormRule = css.match(/\.app-dialog-form\s*\{([^}]*)\}/);
  assert.ok(dialogFormRule, "expected the base .app-dialog-form rule");
  assert.match(dialogFormRule![1], /max-width:\s*min\(1080px,\s*calc\(100vw - 32px\)\)/);
  assert.match(dialogFormRule![1], /container-type:\s*inline-size/);
  // Scoped to .app-dialog-form's own rule -- unrelated `resize: vertical`
  // on plain <textarea> elements elsewhere in globals.css is legitimate
  // and untouched by this change.
  assert.equal(/resize:/.test(dialogFormRule![1]), false, "no CSS resize property on .app-dialog-form");

  assert.equal(/useResizableEditWorkspace/.test(source), false);
  assert.equal(/PointerEvent|onPointerDown|onPointerMove|onPointerUp|onPointerCancel/.test(source), false);
  assert.equal(/setPointerCapture/.test(source), false);
  assert.equal(/app-resize-handle/.test(source), false);
  assert.equal(/getBoundingClientRect|visualViewport|ResizeObserver/.test(source), false);
});

test("no manual resize hook file remains in this directory", () => {
  assert.throws(() => {
    readFileSync(fileURLToPath(new URL("./useResizableEditWorkspace.tsx", import.meta.url)));
  });
  assert.throws(() => {
    readFileSync(fileURLToPath(new URL("./useResizableEditWorkspace.test.ts", import.meta.url)));
  });
});

test("no resize-handle CSS remains in globals.css", () => {
  const cssPath = fileURLToPath(new URL("../../globals.css", import.meta.url));
  const css = readFileSync(cssPath, "utf8");
  assert.equal(/\.app-resize-handle\b/.test(css), false);
  assert.equal(/@media \(min-width: 640px\)/.test(css), false, "the old CSS-resize-enablement breakpoint is gone");
});

test("app-dialog-form establishes a CSS container-query context (container-type: inline-size) that .app-permission-grid/.app-dialog-form-pair* implicitly query against -- unaffected by the resize-mechanism change, since @container reacts to width however it changes", () => {
  const cssPath = fileURLToPath(new URL("../../globals.css", import.meta.url));
  const css = readFileSync(cssPath, "utf8");
  assert.match(css, /@container \(min-width: 480px\) \{\s*\.app-dialog-form-pair\s*\{/);
  assert.match(css, /@container \(min-width: 480px\) \{\s*\.app-dialog-form-pair-auto\s*\{/);
});

test("the shared base .app-dialog rule (every other Dialog/ConfirmDialog consumer) keeps its own original, unrelated max-width -- automatic sizing and container queries are scoped to .app-dialog-form only", () => {
  const cssPath = fileURLToPath(new URL("../../globals.css", import.meta.url));
  const css = readFileSync(cssPath, "utf8");
  const baseRuleMatch = css.match(/(?<!-form)\.app-dialog\s*\{([^}]*)\}/);
  assert.ok(baseRuleMatch, "expected the shared base .app-dialog rule");
  assert.match(baseRuleMatch![1], /max-width:\s*460px/);
  assert.equal(/resize/.test(baseRuleMatch![1]), false);
  assert.equal(/container-type/.test(baseRuleMatch![1]), false);
});

test("no Dialog sentinel/handle is rendered from this page -- Dialog.tsx's own children/footer composition is used exactly as-is", () => {
  const dialogStart = source.indexOf("<Dialog\n");
  const dialogEnd = source.indexOf("</Dialog>", dialogStart);
  assert.ok(dialogStart > -1 && dialogEnd > dialogStart);
  assert.equal(/resizeSentinel|resizeHandle/.test(source), false);
});

test("the outer dialog body gap was tightened by one token step, not eliminated -- it remains a real, readable section separator", () => {
  assert.match(
    source,
    /<div style=\{\{ display: "grid", gap: "var\(--space-5\)", minWidth: 0 \}\}>\s*\n\s*<div className="app-dialog-form-pair">/,
  );
});

// Event Access compaction (real-device follow-up): a long repeated
// checkbox-per-event grid grew linearly with the number of Events and was
// the remaining source of excessive dialog scrolling. It is replaced by a
// compact <select> (one option per event, plain text only) plus a focused
// single-event editor below it, editing the same assignedEventIds array.

test("no long repeated Event Access checkbox-per-event grid remains: exactly one Checkbox is used for access (the focused event's), the rest of the events render as plain-text <option>s", () => {
  const eventAccessBlock = source.slice(
    source.indexOf("<strong>Event Access</strong>"),
    source.lastIndexOf("</Dialog>"),
  );
  assert.equal(
    /events\.map\(\(event\) => \(\s*<Checkbox/.test(eventAccessBlock),
    false,
    "the old one-Checkbox-per-event grid should be gone",
  );
  assert.match(eventAccessBlock, /orderedEvents\.map\(\(event\) => \(\s*<option/);
  const checkboxCount = (eventAccessBlock.match(/<Checkbox\b/g) || []).length;
  assert.equal(checkboxCount, 1, "exactly one Checkbox: the focused event's access toggle");
});

test("the selector renders every legitimate event -- historical events are not filtered out, only reordered", () => {
  assert.match(source, /orderedEvents\.map\(\(event\) => \(/);
  // No filter/slice narrowing orderedEvents before it's mapped into options.
  assert.equal(/orderedEvents\.filter\(/.test(source), false);
  assert.equal(/orderedEvents\.slice\(/.test(source), false);
});

test("the focused event's access toggle edits the same assignedEventIds array Save already persists -- no per-event/new state source, and unlike the derived Permissions checkboxes it is genuinely editable", () => {
  assert.match(source, /onChange=\{\(\) => toggleAssignedEvent\(focusedEvent\.id\)\}/);
  assert.match(source, /const isFocusedEventAssigned = !!focusedEvent && assignedEventIds\.includes\(focusedEvent\.id\);/);
  const toggleMatch = source.match(/<Checkbox\s*\n\s*checked=\{isFocusedEventAssigned\}[\s\S]*?\/>/);
  assert.ok(toggleMatch, "expected the focused-event access Checkbox");
  assert.equal(/readOnly/.test(toggleMatch![0]), false);
});

test("selecting a different event in the dropdown only changes selectedEventId -- it never touches assignedEventIds, so switching focus cannot discard another event's unsaved change", () => {
  const selectBlock = source.slice(
    source.indexOf('<Field label="Event">'),
    source.indexOf("</Field>", source.indexOf('<Field label="Event">')),
  );
  assert.match(selectBlock, /onChange=\{\(e\) => setSelectedEventId\(e\.target\.value\)\}/);
  assert.equal(/setAssignedEventIds/.test(selectBlock), false);
  assert.equal(/toggleAssignedEvent/.test(selectBlock), false);
});

test("access status is textual (Access granted / No access), and the StatusBadge tone is never the sole carrier of meaning", () => {
  assert.match(
    source,
    /<StatusBadge tone=\{isFocusedEventAssigned \? "success" : "warning"\}>\s*\{isFocusedEventAssigned \? "Access granted" : "No access"\}\s*<\/StatusBadge>/,
  );
});

test("event lifecycle is rendered as separate plain text sourced verbatim from public.events.status -- never folded into the access StatusBadge's tone/text, never collapsed through isActiveEventStatus", () => {
  const focusedBlock = source.slice(
    source.indexOf("{focusedEvent ? ("),
    source.indexOf("Grant access to this Event"),
  );
  assert.match(focusedBlock, /<div className="data-table-cell-meta">Status: \{focusedEvent\.status \|\| "Draft"\}<\/div>/);
  assert.equal(/isActiveEventStatus\(/.test(focusedBlock), false);
  assert.equal(/Past event/.test(focusedBlock), false);
  // The StatusBadge in this same block is the access badge, not a second
  // lifecycle badge -- lifecycle never gets its own success/warning tone.
  const statusBadgeCount = (focusedBlock.match(/<StatusBadge\b/g) || []).length;
  assert.equal(statusBadgeCount, 1);
});

test("no isActiveEventStatus reference remains anywhere on this page -- lifecycle grouping/ordering uses only isArchivedEventStatus", () => {
  assert.equal(/\bisActiveEventStatus\(/.test(source), false);
  assert.match(source, /import \{ isArchivedEventStatus \} from "@\/lib\/eventStatus";/);
});

test("no new RPC/API call was introduced for Event Access -- the same admin_event_access SELECT and the same three governed RPCs remain the only event-access data paths", () => {
  assert.match(source, /supabase\.from\("admin_event_access"\)\.select\("id,event_id,role"\)\.eq\("admin_user_id", adminUserId\)/);
  // status is the only added column on the events read -- an additive
  // read for ordering/labeling, not a new query shape/contract.
  assert.match(source, /\.from\("events"\)\.select\("id, name, start_date, location, status"\)/);
  const rpcCallCount = (source.match(/\.rpc\("/g) || []).length;
  assert.equal(rpcCallCount, 3);
});

test("action hierarchy: Create/Save is primary, Send Reset Email is secondary, New and Cancel are the unset ghost default -- no status-color-as-action-color", () => {
  assert.match(source, /<AppButton variant="primary" onClick=\{\(\) => void handleSave\(\)\} loading=\{saving\}>/);
  assert.match(source, /<AppButton\s*\n\s*variant="secondary"\s*\n\s*onClick=\{\(\) => void handleSendPasswordReset\(\)\}\s*\n\s*loading=\{sendingReset\}/);
  assert.match(source, /<AppButton onClick=\{openNewAdminDialog\} aria-haspopup="dialog">\s*\n\s*New\s*\n\s*<\/AppButton>/);
  assert.match(source, /<AppButton onClick=\{closeAdminDialog\}>Cancel<\/AppButton>/);
  assert.equal(/variant="success"/.test(source), false);
  assert.equal(/variant="warning"/.test(source), false);
  assert.equal(/variant="start"/.test(source), false);
});

test("Save and Send Reset Email use the canonical loading prop (spinner + forced disabled), not a hand-rolled busy label", () => {
  assert.match(source, /const \[saving, setSaving\] = useState\(false\);/);
  assert.match(source, /const \[sendingReset, setSendingReset\] = useState\(false\);/);
  assert.match(source, /setSaving\(true\);/);
  assert.match(source, /setSaving\(false\);/);
  assert.match(source, /setSendingReset\(true\);/);
  assert.match(source, /setSendingReset\(false\);/);
});

test("no destructive/revoking action exists on this page, so no ConfirmDialog (or danger/stop variant) is introduced -- deactivation is an ordinary Field edit, not a destructive action", () => {
  assert.equal(/\bimport\b[^;]*ConfirmDialog/.test(source), false);
  assert.equal(/<ConfirmDialog\b/.test(source), false);
  assert.equal(/window\.confirm/.test(source), false);
  assert.equal(/variant="danger"/.test(source), false);
  assert.equal(/variant="stop"/.test(source), false);
});

test("the master list stays on the page; the Edit/Create form is the canonical Dialog as the edit surface, not a second always-visible detail panel", () => {
  assert.match(source, /from "@\/components\/ui\/Dialog"/);
  assert.match(source, /<Dialog\s*\n\s*open=\{dialogOpen\}\s*\n\s*onClose=\{closeAdminDialog\}/);
  // The old always-visible master/detail split grid is gone -- the master
  // list is now the page's sole PageSection, no side-by-side layout.
  assert.equal(
    /gridTemplateColumns: isCompact \? "1fr" : "minmax\(280px, 340px\) 1fr"/.test(source),
    false,
  );
});

test("selecting a row or New opens the dialog (does not merely populate an inline panel); the dialog carries the same selectedAdminId-driven title/description as before", () => {
  assert.match(source, /function openEditAdminDialog\(adminId: string\) \{\s*\n\s*setSelectedAdminId\(adminId\);\s*\n\s*setDialogOpen\(true\);/);
  assert.match(source, /function openNewAdminDialog\(\) \{\s*\n\s*startNewAdmin\(\);/);
  assert.match(source, /function openNewAdminDialog\(\) \{[\s\S]*?setDialogOpen\(true\);\s*\n\s*\}/);
  assert.match(source, /function closeAdminDialog\(\) \{\s*\n\s*setDialogOpen\(false\);/);
  assert.match(source, /onClick=\{\(\) => openEditAdminDialog\(row\.id\)\}/);
  assert.match(
    source,
    /title=\{selectedAdminId \? "Edit Admin User" : "New Admin User"\}/,
  );
});

test("the dialog uses the scoped app-dialog-form width/height modifier, not a change to the shared base Dialog sizing", () => {
  assert.match(source, /className="app-dialog-form"/);
});

test("Save/Create and Cancel are the dialog's own footer, not a page-level button row -- Escape/backdrop-click/Cancel all close without saving, matching the page's original lack of an unsaved-changes guard", () => {
  const footerStart = source.indexOf("footer={");
  const footerEnd = source.indexOf("}\n      >", footerStart);
  const footerSource = source.slice(footerStart, footerEnd);
  assert.match(footerSource, /<AppButton onClick=\{closeAdminDialog\}>Cancel<\/AppButton>/);
  assert.match(footerSource, /variant="primary" onClick=\{\(\) => void handleSave\(\)\} loading=\{saving\}/);
});

test("active/inactive renders through the canonical StatusBadge with the same success=active/neutral=inactive tone mapping used elsewhere (e.g. vendors' catalogStatusTone)", () => {
  assert.match(
    source,
    /<StatusBadge tone=\{row\.is_active \? "success" : "neutral"\}>\s*\{row\.is_active \? "Active" : "Inactive"\}\s*<\/StatusBadge>/,
  );
});

test("the internal Tenant Administration link targets the canonical consolidated workspace while keeping Next client-side transition", () => {
  assert.match(source, /<Link href="\/admin\/tenants" className="app-button">/);
  assert.match(source, /Tenant Administration/);
  assert.equal(/<AppLinkButton\b/.test(source), false);
});

test("save/create RPC and API behavior is byte-identical: same endpoints, same governed RPC names, same request bodies", () => {
  assert.match(source, /fetch\("\/api\/admins\/manage", \{/);
  assert.match(source, /fetch\("\/api\/admins\/set-password"/);
  assert.match(source, /\.rpc\("remove_event_authority_assignment", \{ p_assignment_id: assignment\.id \}\)/);
  assert.match(source, /\.rpc\("create_event_authority_assignment", \{/);
  assert.match(source, /\.rpc\("change_event_authority_profile", \{/);
  assert.match(source, /p_disposition: "reset_to_defaults"/);
  assert.match(source, /supabase\.auth\.resetPasswordForEmail\(trimmedEmail/);
});

test("event access diffing and privilege-group preset logic are unchanged", () => {
  assert.match(source, /function getPresetPermissions\(group: PrivilegeGroup\): AdminPermissions \{/);
  assert.match(source, /function getEventAccessRole\(privilegeGroup: PrivilegeGroup\)/);
  assert.match(source, /const toRemove = currentAssignments\.filter\(\(a\) => !wantEventIds\.has\(a\.event_id\)\);/);
  assert.match(source, /const toAdd = Array\.from\(wantEventIds\)\.filter\(/);
  assert.match(source, /const toReprofile = currentAssignments\.filter\(/);
});

test("load/error/save/reset status text renders through the canonical Alert with a pure tone classifier, never a second message source", () => {
  assert.match(source, /function adminUserStatusTone\(message: string\): AlertTone \{/);
  assert.match(source, /\{status \? <Alert tone=\{adminUserStatusTone\(status\)\}>\{status\}<\/Alert> : null\}/);
  assert.match(source, /\{error \? <Alert tone="danger">\{error\}<\/Alert> : null\}/);
  assert.match(source, /\{saveStatus \? <Alert tone=\{adminUserStatusTone\(saveStatus\)\}>\{saveStatus\}<\/Alert> : null\}/);
  assert.match(source, /\{resetStatus \? <Alert tone=\{adminUserStatusTone\(resetStatus\)\}>\{resetStatus\}<\/Alert> : null\}/);
});

test("adminUserStatusTone classifies partial-failure messages that still start with a success word as danger, not success", () => {
  assert.equal(adminUserStatusTone("Saving..."), "info");
  assert.equal(adminUserStatusTone("Saved."), "success");
  assert.equal(adminUserStatusTone("Saved and password set."), "success");
  assert.equal(adminUserStatusTone("Saved and invitation sent."), "success");
  assert.equal(adminUserStatusTone("Saved admin user, but event access failed: remove: boom"), "danger");
  assert.equal(adminUserStatusTone("Admin saved, but password was not set: Unknown password error"), "danger");
  assert.equal(adminUserStatusTone("Email is required."), "danger");
  assert.equal(adminUserStatusTone("Could not save admin user."), "danger");
  assert.equal(adminUserStatusTone("Password reset email sent."), "success");
  assert.equal(adminUserStatusTone("Could not send reset email: network error"), "danger");
});

// Event Access compaction (real-device follow-up, Part 9): direct unit
// coverage for the three pure helpers behind the compact selector +
// focused editor, independent of the source-level assertions above.
//
// Fixtures use the exact four status values public.events.status is
// actually written with today (app/admin/events/page.tsx's own Status
// <select>: Active/Inactive/Archived/Draft -- verified by reading that
// write path's option list, not a live Supabase query this environment
// has no credentials to run). "Archived" is the only one of the four
// whose plain-English meaning is unambiguously Past; Draft is a *future*,
// not-yet-started Event, and Inactive is deliberately left ambiguous
// (neither is Archived) -- exactly the distinction the isActiveEventStatus
// collapse got wrong (it also has an "unrecognized legacy status" case,
// covered separately below).

const ACTIVE_EVENT = { id: "active-evt", name: "Saint George", status: "Active" };
const DRAFT_EVENT = { id: "draft-evt", name: "Amana27", status: "Draft" };
const ARCHIVED_EVENT = { id: "archived-evt", name: "Camp Margaritaville", status: "Archived" };
const INACTIVE_EVENT = { id: "inactive-evt", name: "Paused Rally", status: "Inactive" };
const UNRECOGNIZED_STATUS_EVENT = { id: "legacy-evt", name: "Legacy Rally", status: "Completed" };

test("orderEventsForAccessSelector keeps every event -- it reorders, it never drops one", () => {
  const events = [ARCHIVED_EVENT, ACTIVE_EVENT, DRAFT_EVENT, INACTIVE_EVENT];
  const ordered = orderEventsForAccessSelector(events);
  assert.equal(ordered.length, events.length);
  const orderedIds = ordered.map((e) => e.id).slice().sort();
  const originalIds = events.map((e) => e.id).slice().sort();
  assert.deepEqual(orderedIds, originalIds);
});

test("orderEventsForAccessSelector puts every non-Archived event (including Draft and Inactive) before Archived, preserving relative order within each group (stable sort) -- Draft/Inactive are never treated as Past", () => {
  const events = [ARCHIVED_EVENT, ACTIVE_EVENT, DRAFT_EVENT, INACTIVE_EVENT, UNRECOGNIZED_STATUS_EVENT];
  const ordered = orderEventsForAccessSelector(events);
  assert.deepEqual(
    ordered.map((e) => e.id),
    ["active-evt", "draft-evt", "inactive-evt", "legacy-evt", "archived-evt"],
  );
});

test("orderEventsForAccessSelector never uses date inference -- events with no start_date at all still order correctly by status alone", () => {
  const noDateActive = { id: "a", name: "No-date Active", status: "Active" };
  const noDateArchived = { id: "b", name: "No-date Archived", status: "Archived" };
  const ordered = orderEventsForAccessSelector([noDateArchived, noDateActive]);
  assert.deepEqual(ordered.map((e) => e.id), ["a", "b"]);
});

test("formatEventOptionLabel renders the exact plain-text shape the design specifies, with the verbatim Supabase status term -- e.g. 'Saint George — Access granted · Active'", () => {
  assert.equal(
    formatEventOptionLabel(ACTIVE_EVENT, ["active-evt"]),
    "Saint George — Access granted · Active",
  );
  assert.equal(
    formatEventOptionLabel(DRAFT_EVENT, ["active-evt"]),
    "Amana27 — No access · Draft",
  );
  assert.equal(
    formatEventOptionLabel(ARCHIVED_EVENT, ["archived-evt"]),
    "Camp Margaritaville — Access granted · Archived",
  );
  assert.equal(
    formatEventOptionLabel(INACTIVE_EVENT, []),
    "Paused Rally — No access · Inactive",
  );
  // An unrecognized/legacy status is shown verbatim too -- never silently
  // relabeled to "Past"/"Active"/anything else.
  assert.equal(
    formatEventOptionLabel(UNRECOGNIZED_STATUS_EVENT, []),
    "Legacy Rally — No access · Completed",
  );
  assert.equal(
    formatEventOptionLabel({ id: "x", name: null, status: null }, []),
    "Untitled Event — No access · Draft",
  );
});

test("access-granted vs no-access is entirely independent of Event status -- every status value can be either", () => {
  assert.equal(
    formatEventOptionLabel(ARCHIVED_EVENT, ["archived-evt"]).includes("Access granted"),
    true,
    "an Archived (Past) Event can still show Access granted",
  );
  assert.equal(
    formatEventOptionLabel(ACTIVE_EVENT, []).includes("No access"),
    true,
    "an Active Event can still show No access",
  );
});

test("pickInitialEventId: existing admin already assigned to a non-Archived event -- that event wins over any other rule", () => {
  const ordered = orderEventsForAccessSelector([ARCHIVED_EVENT, ACTIVE_EVENT, DRAFT_EVENT]);
  assert.equal(pickInitialEventId(ordered, ["archived-evt", "active-evt"]), "active-evt");
});

test("pickInitialEventId: existing admin assigned to a Draft (future) event -- that counts as current/upcoming, not Past, so it wins over an unassigned Active event", () => {
  const ordered = orderEventsForAccessSelector([ARCHIVED_EVENT, ACTIVE_EVENT, DRAFT_EVENT]);
  assert.equal(pickInitialEventId(ordered, ["draft-evt"]), "draft-evt");
});

test("pickInitialEventId: existing admin assigned only to an Archived event -- that assignment still wins over an unassigned current event", () => {
  const ordered = orderEventsForAccessSelector([ARCHIVED_EVENT, ACTIVE_EVENT, DRAFT_EVENT]);
  assert.equal(pickInitialEventId(ordered, ["archived-evt"]), "archived-evt");
});

test("pickInitialEventId: existing admin with no assignments at all -- falls back to the first non-Archived available event", () => {
  const ordered = orderEventsForAccessSelector([ARCHIVED_EVENT, ACTIVE_EVENT, DRAFT_EVENT]);
  assert.equal(pickInitialEventId(ordered, []), "active-evt");
});

test("pickInitialEventId: no non-Archived event exists at all -- falls back to the first available event even if Archived", () => {
  const ordered = orderEventsForAccessSelector([ARCHIVED_EVENT]);
  assert.equal(pickInitialEventId(ordered, []), "archived-evt");
});

test("pickInitialEventId: new admin (always an empty assignment set) reduces to the same 'first non-Archived, else first available' rule -- one chain serves both Part 6 cases", () => {
  const ordered = orderEventsForAccessSelector([ARCHIVED_EVENT, DRAFT_EVENT]);
  assert.equal(pickInitialEventId(ordered, []), "draft-evt");
  const onlyArchived = orderEventsForAccessSelector([ARCHIVED_EVENT]);
  assert.equal(pickInitialEventId(onlyArchived, []), "archived-evt");
});

test("pickInitialEventId: no events at all -- returns empty string deterministically, never throws", () => {
  assert.equal(pickInitialEventId([], []), "");
  assert.equal(pickInitialEventId([], ["some-id"]), "");
});

test("pickInitialEventId is deterministic: repeated calls with the same inputs return the same result", () => {
  const ordered = orderEventsForAccessSelector([ARCHIVED_EVENT, ACTIVE_EVENT, DRAFT_EVENT, INACTIVE_EVENT]);
  const first = pickInitialEventId(ordered, ["draft-evt"]);
  const second = pickInitialEventId(ordered, ["draft-evt"]);
  assert.equal(first, second);
  assert.equal(first, "draft-evt");
});

// -- Admin Batch 2: Central UI Standard completion touch-up -----------------

test("loading and empty presentations use the canonical LoadingState/EmptyState primitives, not a hand-written neutral Alert", () => {
  assert.match(
    source,
    /import\s*\{\s*EmptyState\s*\}\s*from\s*["']@\/components\/ui\/EmptyState["']/,
  );
  assert.match(
    source,
    /import\s*\{\s*LoadingState\s*\}\s*from\s*["']@\/components\/ui\/LoadingState["']/,
  );
  assert.match(source, /<LoadingState message="Loading admin users\.\.\." \/>/);
  assert.match(source, /<EmptyState message="No admin users found\." \/>/);
  assert.match(source, /<EmptyState message="No events found\." \/>/);
  // The "Super Admin automatically has access" line is informational, not
  // an empty-collection state -- it correctly stays a plain Alert.
  assert.match(
    source,
    /<Alert tone="neutral">Super Admin automatically has access to all events\.<\/Alert>/,
  );
});
