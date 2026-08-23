import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { isStaleAgendaVersionError, mapAgendaRpcError } from "@/app/admin/agenda/page";

// Focused tests for the Admin Agenda governed UI cutover (Agenda
// Consumer Migration Stages 2A and 2B). Run with:
//   npx tsx --test app/admin/agenda/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);
const TEMPLATE_PANEL_SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "../../../components/admin/agenda/AgendaTemplatePanel.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);

// -- Error mapping ----------------------------------------------------

test("mapAgendaRpcError renders known codes as friendly text", () => {
  assert.equal(
    mapAgendaRpcError(new Error("stale_agenda_version"), "fallback"),
    "This event's agenda changed since you loaded it. Reload before trying again.",
  );
  assert.equal(
    mapAgendaRpcError(new Error("unauthorized"), "fallback"),
    "You do not have Agenda management authority for this event.",
  );
  assert.equal(
    mapAgendaRpcError(new Error("cross_tenant_apply"), "fallback"),
    "That template belongs to a different Tenant and cannot be applied here.",
  );
});

test("mapAgendaRpcError never surfaces a raw/unmapped Postgres error message to the Admin -- it returns the caller's fallback instead (an internal implementation detail leaking into the UI, e.g. a trigger's own RAISE EXCEPTION text, is itself a defect)", () => {
  const originalConsoleError = console.error;
  const loggedArgs: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    loggedArgs.push(args);
  };
  try {
    assert.equal(
      mapAgendaRpcError(new Error("some_unmapped_code"), "fallback"),
      "fallback",
    );
    assert.equal(
      mapAgendaRpcError(
        new Error("agenda command ledger entries are immutable"),
        "Could not add agenda item.",
      ),
      "Could not add agenda item.",
    );
  } finally {
    console.error = originalConsoleError;
  }
  // Diagnostic detail is still reachable for developers via the console.
  assert.ok(
    loggedArgs.some((args) =>
      args.some(
        (arg) =>
          typeof arg === "string" &&
          arg.includes("agenda command ledger entries are immutable"),
      ),
    ),
    "expected the raw unmapped message to still be logged for developer diagnosis",
  );
});

test("mapAgendaRpcError renders the Lifecycle guard's two real remaining failure codes as friendly text, matching the app/admin/checkin/page.tsx precedent", () => {
  assert.equal(
    mapAgendaRpcError(new Error("event_archived"), "fallback"),
    "This Event is archived and can no longer be modified.",
  );
  assert.equal(
    mapAgendaRpcError(new Error("event_lifecycle_indeterminate"), "fallback"),
    "This Event's lifecycle state could not be determined. Contact an administrator.",
  );
});

test("mapAgendaRpcError uses the fallback for a non-Error input", () => {
  assert.equal(mapAgendaRpcError("not an error", "fallback text"), "fallback text");
});

test("isStaleAgendaVersionError identifies exactly the stale_agenda_version code", () => {
  assert.equal(isStaleAgendaVersionError(new Error("stale_agenda_version")), true);
  assert.equal(isStaleAgendaVersionError(new Error("unauthorized")), false);
  assert.equal(isStaleAgendaVersionError("stale_agenda_version"), false);
});

// -- Mutation routing (static source verification) --------------------
//
// No component-mocking test infrastructure exists in this repository
// (node:test only, no jsdom/RTL). Direct-write-bypass proof is done the
// same way app/admin/dashboard/page.test.ts already proves its own
// invariants: reading the file's own source and asserting the
// prohibited patterns are structurally absent.

const PROHIBITED_PATTERNS: RegExp[] = [
  /\.from\(["']agenda_items["']\)\s*\.\s*insert/,
  /\.from\(["']agenda_items["']\)\s*\.\s*update/,
  /\.from\(["']agenda_items["']\)\s*\.\s*delete/,
  /\.from\(["']agenda_items["']\)\s*\.\s*upsert/,
  /\.from\(["']agenda_templates["']\)/,
  /\.from\(["']agenda_template_items["']\)/,
];

const REQUIRED_RPC_CALLS = [
  "create_event_agenda_item",
  "update_event_agenda_item",
  "delete_event_agenda_item",
  "reorder_event_agenda_items",
  "import_event_agenda_items",
  "save_event_agenda_as_tenant_template",
  "apply_agenda_template_to_event",
  "replace_agenda_from_template",
  "list_available_agenda_templates",
  "get_event_agenda_version",
];

test("admin agenda page contains no direct agenda_items/agenda_templates mutation", () => {
  for (const pattern of PROHIBITED_PATTERNS) {
    assert.equal(
      pattern.test(PAGE_SOURCE),
      false,
      `found prohibited direct-mutation pattern: ${pattern}`,
    );
  }
});

test("admin agenda page's only agenda_items table access is a read", () => {
  const matches = [...PAGE_SOURCE.matchAll(/\.from\(["']agenda_items["']\)/g)];
  assert.equal(matches.length, 1, "expected exactly one .from(\"agenda_items\") call");

  const idx = matches[0].index ?? 0;
  const tail = PAGE_SOURCE.slice(idx, idx + 60);
  assert.match(tail, /\.select\(/, "the one remaining agenda_items access must be a .select()");
});

test("admin agenda page calls every required governed RPC", () => {
  for (const rpcName of REQUIRED_RPC_CALLS) {
    assert.match(
      PAGE_SOURCE,
      new RegExp(`["']${rpcName}["']`),
      `expected a call to ${rpcName}`,
    );
  }
});

// Strips // line comments before checking for a code-level reference, so
// explanatory comments about the removal decision (which necessarily
// mention the column name) don't trip a check for actual code usage.
const PAGE_SOURCE_NO_COMMENTS = PAGE_SOURCE.replace(/\/\/.*$/gm, "");

test("admin agenda page never writes events.assigned_agenda_template_id", () => {
  assert.equal(
    /\.update\(\s*\{\s*[^}]*assigned_agenda_template_id/.test(PAGE_SOURCE),
    false,
    "assigned_agenda_template_id must be read-only now",
  );
});

test("legacy assignTemplate operational write is gone", () => {
  assert.equal(/function assignTemplate\s*\(/.test(PAGE_SOURCE), false);
});

// -- Route safety: /admin/agenda/import ---------------------------------
//
// Stage 2B: deleted entirely (not just redirected), corroborated by the
// pre-existing EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md / _MODULE_ARCHITECTURE.md
// docs, which independently classify this route as dead/eliminated with
// zero inbound links.

test("the standalone /admin/agenda/import route no longer exists", () => {
  const routePath = fileURLToPath(new URL("./import/page.tsx", import.meta.url));
  assert.equal(existsSync(routePath), false);
});

// -- Template panel: no direct table access, no legacy assign button ----

test("AgendaTemplatePanel has no direct table access and no assign-template control", () => {
  assert.equal(/\.from\(/.test(TEMPLATE_PANEL_SOURCE), false);
  assert.equal(/onAssignTemplate/.test(TEMPLATE_PANEL_SOURCE), false);
  assert.equal(
    /assignedTemplateName/.test(TEMPLATE_PANEL_SOURCE),
    false,
    "the unresolvable legacy UUID display was removed in Stage 2B",
  );
});

// -- Stage 2B: governed page-access capability ---------------------------

test("page access is gated by the governed event.agenda.view/manage resolver, not can_manage_agenda", () => {
  assert.equal(
    /requiredPermission=["']can_manage_agenda["']/.test(PAGE_SOURCE),
    false,
    "can_manage_agenda must no longer gate page visibility",
  );
  assert.match(PAGE_SOURCE, /checkAdminEventTaskAuthority/);
  assert.match(PAGE_SOURCE, /event\.agenda\.view/);
  assert.match(PAGE_SOURCE, /hasAgendaAccess/);
});

// -- G-02: Agenda's direct has_event_task_authority calls are gone -------

test("the page never calls has_event_task_authority directly -- only the shared helper does", () => {
  assert.equal(
    /\.rpc\(\s*["']has_event_task_authority["']/.test(PAGE_SOURCE),
    false,
    "expected zero direct has_event_task_authority RPC calls in the page",
  );
});

test("the page imports checkAdminEventTaskAuthority from the shared helper module", () => {
  assert.match(
    PAGE_SOURCE,
    /import \{ checkAdminEventTaskAuthority \} from "@\/lib\/adminTaskAuthority";/,
  );
});

test("event.agenda.view is checked before event.agenda.manage, in that source order", () => {
  const viewIdx = PAGE_SOURCE.indexOf(
    'checkAdminEventTaskAuthority(\n      "event.agenda.view"',
  );
  const manageIdx = PAGE_SOURCE.indexOf(
    'checkAdminEventTaskAuthority(\n        "event.agenda.manage"',
  );
  assert.ok(viewIdx > -1, "expected an event.agenda.view check");
  assert.ok(manageIdx > -1, "expected an event.agenda.manage fallback check");
  assert.ok(viewIdx < manageIdx, "view must be checked before the manage fallback");
});

test("event.agenda.manage is only checked when event.agenda.view was not allowed -- the fallback stays nested under that condition", () => {
  const viewCheckIdx = PAGE_SOURCE.indexOf('if (viewResult.status === "check_failed")');
  const fallbackGateIdx = PAGE_SOURCE.indexOf('if (viewResult.status !== "allowed") {');
  const manageCallIdx = PAGE_SOURCE.indexOf(
    'checkAdminEventTaskAuthority(\n        "event.agenda.manage"',
  );
  assert.ok(viewCheckIdx > -1 && fallbackGateIdx > -1 && manageCallIdx > -1);
  assert.ok(viewCheckIdx < fallbackGateIdx);
  assert.ok(fallbackGateIdx < manageCallIdx);
});

test("a check_failed view result fails closed with the access-check error message, distinct from a plain denial", () => {
  const block = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf('if (viewResult.status === "check_failed") {'),
    PAGE_SOURCE.indexOf('if (viewResult.status !== "allowed") {'),
  );
  assert.match(block, /Could not check Agenda access for this event\./);
  assert.match(block, /setHasAgendaAccess\(false\);/);
});

test("a denied manage fallback fails closed with the no-access message, and only an exact allowed status grants page access", () => {
  const block = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf('if (viewResult.status !== "allowed") {'),
    PAGE_SOURCE.indexOf("setHasAgendaAccess(true);"),
  );
  assert.match(block, /if \(manageResult\.status !== "allowed"\) \{/);
  assert.match(block, /You do not have Agenda access for this event\./);
  assert.match(block, /setHasAgendaAccess\(false\);/);
});

test("no-Event behavior is checked before either task-authority call and never reaches the helper", () => {
  const noEventIdx = PAGE_SOURCE.indexOf("No admin working event selected.");
  const viewCallIdx = PAGE_SOURCE.indexOf(
    'checkAdminEventTaskAuthority(\n      "event.agenda.view"',
  );
  assert.ok(noEventIdx > -1 && viewCallIdx > -1);
  assert.ok(noEventIdx < viewCallIdx);
});

test("Agenda access is re-evaluated on Admin working-Event change via loadPage, subscribed through subscribeToAdminWorkspace", () => {
  assert.match(PAGE_SOURCE, /subscribeToAdminWorkspace/);
  assert.match(PAGE_SOURCE, /loadPage/);
});

test("page access check never inspects privilege_group or is_super_admin in code", () => {
  assert.equal(/privilege_group/.test(PAGE_SOURCE_NO_COMMENTS), false);
  assert.equal(/is_super_admin/.test(PAGE_SOURCE_NO_COMMENTS), false);
});

test("assigned_agenda_template_id is no longer read or displayed in code (comments may still explain the removal)", () => {
  assert.equal(/assigned_agenda_template_id/.test(PAGE_SOURCE_NO_COMMENTS), false);
});

// -- Stage 2B: application history ---------------------------------------

test("page reads application history via the governed RPC and renders it compactly", () => {
  assert.match(PAGE_SOURCE, /read_agenda_template_application_history/);
  assert.match(PAGE_SOURCE, /applicationHistory/);
});

// -- Central UI Standard migration (UI/workflow-layout only) -------------
//
// The tests above lock in Agenda's governance/data behavior and must keep
// passing byte-for-byte unmodified through this migration. These new tests
// cover the UI-layer change: canonical primitive adoption, the two-pane
// responsive workflow layout, and that the specialized calendar
// drag/resize + button/drag-handle reorder surfaces were left untouched.

test("every canonical Central UI primitive is imported", () => {
  for (const importPath of [
    '"@/components/shell/useShellViewport"',
    '"@/components/ui/Alert"',
    '"@/components/ui/AppButton"',
    '"@/components/ui/ConfirmDialog"',
    '"@/components/ui/Field"',
    '"@/components/ui/PageHeader"',
    '"@/components/ui/PageSection"',
    '"@/components/ui/StatusBadge"',
  ]) {
    assert.ok(PAGE_SOURCE.includes(importPath), `expected an import from ${importPath}`);
  }
});

test("the page-local isMobile/MOBILE_BREAKPOINT resize-listener state is gone -- replaced by the shared useShellInterfaceCapabilities() hook", () => {
  assert.equal(/isMobile/.test(PAGE_SOURCE), false);
  assert.equal(/MOBILE_BREAKPOINT/.test(PAGE_SOURCE), false);
  assert.equal(/addEventListener\(\s*["']resize["']/.test(PAGE_SOURCE), false);
  assert.match(
    PAGE_SOURCE,
    /const \{ isCompact, viewportClass \} = useShellInterfaceCapabilities\(\);/,
  );
});

test("the shell wrapper has a back target to the Dashboard, replacing the hand-rolled 'Return to Dashboard' button", () => {
  assert.match(PAGE_SOURCE, /AdminShellAdapter/);
  assert.match(
    PAGE_SOURCE,
    /backTarget=\{\{ href: "\/admin\/dashboard", label: "Dashboard" \}\}/,
  );
  assert.equal(/Return to Dashboard/.test(PAGE_SOURCE), false);
  assert.equal(/window\.location\.href = "\/admin\/dashboard"/.test(PAGE_SOURCE), false);
});

test("no raw form controls remain in the New/Edit Item form -- every input/select/textarea/checkbox there goes through Field/Input/Select/Textarea/Checkbox", () => {
  const formStart = PAGE_SOURCE.indexOf('title={form.id ? `Editing:');
  const formEnd = PAGE_SOURCE.indexOf("</PageSection>", formStart);
  assert.notEqual(formStart, -1);
  assert.notEqual(formEnd, -1);
  const formBlock = PAGE_SOURCE.slice(formStart, formEnd);

  assert.equal(/<input\b/.test(formBlock), false);
  assert.equal(/<select\b/.test(formBlock), false);
  assert.equal(/<textarea\b/.test(formBlock), false);
  assert.match(formBlock, /<Checkbox\s+label="Published"/);
});

test("the printDayFilter utility control is the one documented raw <select> exception, matching the Nearby migration's own toolbar-filter precedent", () => {
  const rawSelects = PAGE_SOURCE.match(/<select\b/g) || [];
  assert.equal(rawSelects.length, 1, "expected exactly one raw <select> (the print day filter)");
  assert.match(PAGE_SOURCE, /aria-label="Filter print by day"/);
});

test("the two-pane responsive workflow grid only activates at the shell's 'wide' tier -- empirically, 'standard' width (900-1199px, e.g. 1024px) leaves too little real content width for two panes once the shell's own sidebar/padding is accounted for", () => {
  assert.match(PAGE_SOURCE, /const showTwoColumnAgendaLayout = viewportClass === "wide";/);
  assert.match(
    PAGE_SOURCE,
    /gridTemplateColumns: showTwoColumnAgendaLayout \? "minmax\(300px, 360px\) 1fr" : "1fr"/,
  );
});

test("the Catalog & Templates pane reorders after the Event Agenda working pane whenever the single-column layout is active, via CSS order, not a UA/orientation branch", () => {
  assert.match(PAGE_SOURCE, /order: showTwoColumnAgendaLayout \? 0 : 1/);
  assert.equal(/navigator\.userAgent/.test(PAGE_SOURCE), false);
  assert.equal(/orientation/i.test(PAGE_SOURCE), false);
});

test("the Published/Hidden item pill renders through the shared StatusBadge, not a hand-rolled pill", () => {
  assert.match(
    PAGE_SOURCE,
    /<StatusBadge tone=\{item\.is_published \? "success" : "neutral"\}>/,
  );
  assert.match(PAGE_SOURCE, /<StatusBadge tone="info">Editing<\/StatusBadge>/);
});

test("delete-initiating buttons use the danger variant; Save/Update actions use primary", () => {
  for (const label of ["Delete Selected", "Delete"]) {
    const idx = PAGE_SOURCE.lastIndexOf(label);
    assert.notEqual(idx, -1, `expected to find button label "${label}"`);
    const nearby = PAGE_SOURCE.slice(Math.max(0, idx - 300), idx);
    assert.match(nearby, /variant="danger"/);
  }
  assert.match(TEMPLATE_PANEL_SOURCE, /variant="danger"[\s\S]{0,300}Replace Event Agenda From Template/);
});

test("deleteItem's existing ConfirmDialog/requestConfirmation() gate is unchanged -- the UI migration did not add or remove a confirmation step", () => {
  const deleteFnIdx = PAGE_SOURCE.indexOf("async function deleteItem(id: string) {");
  assert.notEqual(deleteFnIdx, -1);
  const body = PAGE_SOURCE.slice(deleteFnIdx, deleteFnIdx + 400);
  assert.match(body, /await requestConfirmation\(\{/);
  assert.match(body, /danger: true/);
});

test("the calendar's native HTML5 drag/resize engine is completely untouched -- same handler names, same dataTransfer-based mechanism, per the Central UI blueprint's direct-manipulation carve-out", () => {
  for (const needle of [
    "function handleCalendarDragStart(",
    "function handleCalendarDragOver(",
    "function handleCalendarColumnDrop(",
    "function beginCalendarStartResize(",
    "function beginCalendarEndResize(",
    "async function resizeAgendaItemStartTime(",
    "async function resizeAgendaItemEndTime(",
    "async function moveAgendaItemToCalendarSlot(",
    "calendarResizeDragRef",
    "onDragStart={(e) =>\n                                    handleCalendarDragStart(e, item.id)",
  ]) {
    assert.ok(PAGE_SOURCE.includes(needle), `expected calendar mechanism "${needle}" to remain untouched`);
  }
});

test("the button-reorder (touch) and native drag-handle (desktop) list-reorder mechanisms are both preserved, with explicit accessible names added to the button-reorder controls", () => {
  for (const needle of [
    "function moveItemUp(",
    "function moveItemDown(",
    "function handleDragStart(",
    "function handleDrop(",
    "const useButtonReorder = isCompact && !forceDesktopDrag;",
  ]) {
    assert.ok(PAGE_SOURCE.includes(needle), `expected reorder mechanism "${needle}" to remain untouched`);
  }
  assert.match(PAGE_SOURCE, /aria-label="Move item up"/);
  assert.match(PAGE_SOURCE, /aria-label="Move item down"/);
});

test("every governed Agenda RPC name and the agenda_items/agenda_categories table names are still present verbatim -- zero data-behavior drift from the UI migration", () => {
  for (const needle of [
    'from("agenda_items")',
    'from("agenda_categories")',
    "get_event_agenda_version",
    "create_event_agenda_item",
    "update_event_agenda_item",
    "delete_event_agenda_item",
    "reorder_event_agenda_items",
    "list_available_agenda_templates",
    "save_event_agenda_as_tenant_template",
    "apply_agenda_template_to_event",
    "replace_agenda_from_template",
    "read_agenda_template_application_history",
  ]) {
    assert.ok(PAGE_SOURCE.includes(needle), `expected ${needle} to be retained`);
  }
});

test("AgendaTemplatePanel no longer takes an isMobile prop -- it always stacks vertically now that it lives in the page's own narrow Catalog column", () => {
  assert.equal(/isMobile/.test(TEMPLATE_PANEL_SOURCE), false);
  assert.equal(/isMobile=\{isMobile\}/.test(PAGE_SOURCE), false);
  assert.match(TEMPLATE_PANEL_SOURCE, /import \{ PageSection \} from "@\/components\/ui\/PageSection";/);
});

test("AgendaImportPanel and AgendaTemplatePanel both import canonical Field/AppButton primitives -- no hand-rolled inline style objects remain", () => {
  const IMPORT_PANEL_SOURCE = readFileSync(
    fileURLToPath(
      new URL(
        "../../../components/admin/agenda/AgendaImportPanel.tsx",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  for (const source of [TEMPLATE_PANEL_SOURCE, IMPORT_PANEL_SOURCE]) {
    assert.equal(/const \w+Style = \{/.test(source), false);
  }
  assert.match(IMPORT_PANEL_SOURCE, /import \{ Field, Input \} from "@\/components\/ui\/Field";/);
  assert.match(IMPORT_PANEL_SOURCE, /type="file"/);
});

// -- iPhone collapsible-editor regression fix (2026-08-21) ----------------
//
// Real-device iPhone testing found the always-expanded, always-sticky
// editor from the migration above dominated the narrow viewport. These
// tests lock in the fix: a compact, Agenda-local disclosure gated on the
// existing isCompact capability signal -- no new page-local viewport
// listener, no change to desktop/standard behavior.

test("no new page-local viewport-width listener was introduced -- the collapsible editor reuses the existing isCompact capability signal", () => {
  const listenerCount = (PAGE_SOURCE.match(/addEventListener\(\s*["']resize["']/g) || []).length;
  assert.equal(listenerCount, 0);
  assert.match(PAGE_SOURCE, /const \[editorExpanded, setEditorExpanded\] = useState\(false\);/);
});

test("the editor toggle button only renders on compact widths, with a real accessible disclosure control", () => {
  assert.match(PAGE_SOURCE, /actions=\{\s*isCompact \? \(/);
  assert.match(PAGE_SOURCE, /aria-expanded=\{editorExpanded\}/);
  assert.match(PAGE_SOURCE, /aria-controls="agenda-editor-form-body"/);
  assert.match(PAGE_SOURCE, /id="agenda-editor-form-body"/);
  assert.match(PAGE_SOURCE, /\{editorExpanded \? "Collapse" : form\.id \? "Edit" : "Expand"\}/);
});

test("the form body (Field/Input/Select/Textarea/AppButton row) only renders while expanded on compact widths -- wide/standard always renders it, matching the pre-fix behavior exactly", () => {
  assert.match(PAGE_SOURCE, /\{!isCompact \|\| editorExpanded \? \(/);
});

test("the editor is sticky except while expanded on a compact width -- a tall open editor must scroll away normally, not stay pinned over the agenda", () => {
  assert.match(
    PAGE_SOURCE,
    /position: isCompact && editorExpanded \? undefined : "sticky",/,
  );
});

test("selecting an agenda item (calendar block or list row) auto-expands the editor so it is immediately reachable", () => {
  const selectCallSites = [...PAGE_SOURCE.matchAll(/setForm\(formFromItem\(item\)\);\s*\n\s*setEditorExpanded\(true\);/g)];
  assert.equal(selectCallSites.length, 2, "expected both the calendar block and list row onClick to auto-expand");
});

test("New Blank auto-expands the editor (the user is about to start typing a new item)", () => {
  // lastIndexOf, not indexOf -- the button's own onClick body contains an
  // earlier comment ("// On New Blank, if a default category exists...")
  // that also matches "New Blank" before the actual button label text.
  const newBlankIdx = PAGE_SOURCE.lastIndexOf("New Blank");
  const priorButtonStart = PAGE_SOURCE.lastIndexOf("<AppButton", newBlankIdx);
  const block = PAGE_SOURCE.slice(priorButtonStart, newBlankIdx);
  assert.match(block, /setEditorExpanded\(true\);/);
});

test("saving an existing item's update auto-collapses the editor (edit session complete); saving a brand-new item does not (so adding several in a row doesn't force re-expanding each time)", () => {
  const saveItemStart = PAGE_SOURCE.indexOf("async function saveItem() {");
  const saveItemEnd = PAGE_SOURCE.indexOf("\n  async function deleteItem(");
  assert.notEqual(saveItemStart, -1);
  assert.notEqual(saveItemEnd, -1);
  const body = PAGE_SOURCE.slice(saveItemStart, saveItemEnd);
  assert.match(body, /if \(form\.id\) \{\s*\n\s*setEditorExpanded\(false\);\s*\n\s*\}/);
});

test("deleting the item currently being edited also collapses the editor", () => {
  const deleteItemStart = PAGE_SOURCE.indexOf("async function deleteItem(id: string) {");
  const deleteItemEnd = PAGE_SOURCE.indexOf("\n  async function togglePublished(");
  assert.notEqual(deleteItemStart, -1);
  assert.notEqual(deleteItemEnd, -1);
  const body = PAGE_SOURCE.slice(deleteItemStart, deleteItemEnd);
  assert.match(
    body,
    /if \(form\.id === id\) \{\s*\n\s*setForm\(emptyForm\);\s*\n\s*setEditorExpanded\(false\);\s*\n\s*\}/,
  );
});

test("collapsing the editor while a focused control is inside it moves focus to the toggle button, rather than silently dropping focus", () => {
  assert.match(PAGE_SOURCE, /editorFormBodyRef\.current\.contains\(activeEl\)/);
  assert.match(PAGE_SOURCE, /editorToggleButtonRef\.current\?\.focus\(\);/);
});

test("no shared Disclosure/Collapsible primitive was invented -- this is a documented Agenda-local implementation, a candidate for later Central UI standardization", () => {
  assert.equal(/components\/ui\/(Disclosure|Collapsible|Accordion)/i.test(PAGE_SOURCE), false);
});

// -- Mobile editor escape-path fix (2026-08-21 follow-up) -----------------
//
// Real-device iPhone testing found Collapse itself became unreachable
// once the user scrolled into the (very tall) expanded form -- the whole
// editor card stopped being sticky the moment it expanded on a compact
// width, so the Collapse control at its top scrolled away with everything
// else. These tests lock in the fix: only a small header (title +
// Collapse) stays sticky while compact+expanded; the full form body
// remains normal-flow, and the outer card's own sticky behavior for every
// other case (collapsed, and all of !isCompact) is untouched.

test("a small header-only sticky region exists for the compact+expanded case, independent of the outer card's own sticky behavior", () => {
  assert.match(PAGE_SOURCE, /const editorHeaderSticky = isCompact && editorExpanded;/);
  assert.match(
    PAGE_SOURCE,
    /editorHeaderSticky\s*\n\s*\?\s*\{\s*\n\s*position: "sticky",/,
  );
});

test("the outer editor PageSection's own sticky rule is unchanged from the prior fix -- still sticky whenever NOT (compact AND expanded)", () => {
  assert.match(
    PAGE_SOURCE,
    /position: isCompact && editorExpanded \? undefined : "sticky",/,
  );
});

test("the sticky header has an opaque background and a bottom divider so it doesn't visually blend into the form scrolling beneath it", () => {
  const styleBlockStart = PAGE_SOURCE.indexOf("editorHeaderSticky\n                  ? {");
  assert.notEqual(styleBlockStart, -1);
  const block = PAGE_SOURCE.slice(styleBlockStart, styleBlockStart + 400);
  assert.match(block, /background: "var\(--color-bg-panel\)"/);
  assert.match(block, /borderBottom: "var\(--border-width-default\) solid var\(--color-border-default\)"/);
});

test("the Collapse/Expand toggle's onClick performs a pure view-state flip only -- no setForm, no RPC call, no reset -- Collapse must never be a data action", () => {
  const onClickIdx = PAGE_SOURCE.indexOf("onClick={() => setEditorExpanded((prev) => !prev)}");
  assert.notEqual(onClickIdx, -1);
  // The entire handler is this one expression -- nothing else runs.
  assert.match(
    PAGE_SOURCE.slice(onClickIdx, onClickIdx + 80),
    /^onClick=\{\(\) => setEditorExpanded\(\(prev\) => !prev\)\}\s*\n\s*>/,
  );
});

test("form field values are driven entirely by the persisted `form` state, never reset by the toggle -- dirty/uncommitted edits survive collapse and re-expand by construction (React state is untouched by a conditional-render toggle)", () => {
  // The toggle handler and the Field/Input value bindings are disjoint --
  // grep confirms no `setForm` call exists anywhere near the toggle.
  const toggleButtonBlockStart = PAGE_SOURCE.indexOf("<AppButton\n                      ref={editorToggleButtonRef}");
  const toggleButtonBlockEnd = PAGE_SOURCE.indexOf("</AppButton>", toggleButtonBlockStart);
  assert.notEqual(toggleButtonBlockStart, -1);
  const block = PAGE_SOURCE.slice(toggleButtonBlockStart, toggleButtonBlockEnd);
  assert.equal(/setForm/.test(block), false);
});

// -- Admin Batch 1: Central UI Standard completion touch-up -----------------

test("the New/Edit Item form's Save/New Blank/Delete row uses the canonical FormActions wrapper, not a raw app-button-row div", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*FormActions\s*\}\s*from\s*["']@\/components\/ui\/FormActions["']/,
  );
  const formStart = PAGE_SOURCE.indexOf('title={form.id ? `Editing:');
  const formEnd = PAGE_SOURCE.indexOf("</PageSection>", formStart);
  const formBlock = PAGE_SOURCE.slice(formStart, formEnd);
  assert.match(formBlock, /<FormActions>/);
  assert.equal(/className="app-button-row"/.test(formBlock), false);
});

test("the empty agenda-items list uses the canonical EmptyState primitive, not a hand-written neutral Alert", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*EmptyState\s*\}\s*from\s*["']@\/components\/ui\/EmptyState["']/,
  );
  assert.match(PAGE_SOURCE, /<EmptyState message="No agenda items found\." \/>/);
});

test("AgendaTemplatePanel's two action rows use the canonical FormActions wrapper, not a raw app-button-row div", () => {
  assert.match(
    TEMPLATE_PANEL_SOURCE,
    /import\s*\{\s*FormActions\s*\}\s*from\s*["']@\/components\/ui\/FormActions["']/,
  );
  const formActionsCount = (TEMPLATE_PANEL_SOURCE.match(/<FormActions>/g) || []).length;
  assert.equal(formActionsCount, 2);
  assert.equal(/className="app-button-row"/.test(TEMPLATE_PANEL_SOURCE), false);
});

test("the printDayFilter select remains the one deliberate raw-<select> exception -- untouched, not swapped to the Field-wrapped Select component", () => {
  assert.equal((PAGE_SOURCE.match(/<select\b/g) || []).length, 1);
  assert.equal((PAGE_SOURCE.match(/<\/select>/g) || []).length, 1);
});

// -- Agenda create-failure fix: immutable-ledger regression (2026-08-22) --
//
// Root cause lived entirely in the RPC (see
// supabase/migrations/20260822000000_repair_agenda_item_ledger_immutability_regression.sql
// and its own .test.ts for the database-level proof); these tests cover
// the two things this exact defect changed in the UI layer: the raw
// internal error message must never reach an Admin again, and the
// Recurring field's separately-flagged stale "after Amana" copy.

test("create/update/delete_event_agenda_item calls are unchanged by this fix -- the UI still calls the same governed RPCs with the same parameters, never a raw table write", () => {
  assert.match(PAGE_SOURCE, /supabase\.rpc\("create_event_agenda_item", \{/);
  assert.match(PAGE_SOURCE, /supabase\.rpc\("update_event_agenda_item", \{/);
  assert.match(PAGE_SOURCE, /supabase\.rpc\("delete_event_agenda_item", \{/);
  assert.equal(/\.from\(["']agenda_command_ledger["']\)/.test(PAGE_SOURCE), false);
  assert.equal(/\.from\(["']agenda_items["']\)\s*\.\s*(insert|update|delete|upsert)/.test(PAGE_SOURCE), false);
});

test("the Recurring field's user-facing help/title text no longer names Amana or promises a specific unlock milestone -- it states current capability neutrally", () => {
  assert.match(PAGE_SOURCE, /help="Recurring item generation is not yet available\."/);
  assert.match(PAGE_SOURCE, /title="Recurring agenda items are not yet supported\."/);
  const recurringFieldStart = PAGE_SOURCE.indexOf('label="Recurring"');
  const recurringFieldEnd = PAGE_SOURCE.indexOf("</Field>", recurringFieldStart);
  const recurringFieldBlock = PAGE_SOURCE.slice(recurringFieldStart, recurringFieldEnd);
  assert.equal(/Amana/.test(recurringFieldBlock), false);
});

test("the Recurring control remains the same inert placeholder (defaultValue, no onChange) -- this fix only corrects its wording, not its (non-)functionality", () => {
  const recurringFieldStart = PAGE_SOURCE.indexOf('label="Recurring"');
  assert.notEqual(recurringFieldStart, -1);
  const recurringFieldEnd = PAGE_SOURCE.indexOf("</Field>", recurringFieldStart);
  const recurringFieldBlock = PAGE_SOURCE.slice(recurringFieldStart, recurringFieldEnd);
  assert.match(recurringFieldBlock, /defaultValue="none"/);
  assert.equal(/onChange/.test(recurringFieldBlock), false);
});

// -- Stage 5A: shared Imports Service Center routes into this one Agenda --
// -- import implementation instead of a second one. ------------------------

test("?mode=import opens the existing Import Agenda tab -- no second importer, one implementation reached two ways", () => {
  assert.match(PAGE_SOURCE, /import\s*\{\s*useSearchParams\s*\}\s*from\s*"next\/navigation"/);
  assert.match(PAGE_SOURCE, /const initialAgendaMode: AgendaAdminMode = searchParams\.get\("mode"\) === "import" \? "import" : "items";/);
  assert.match(PAGE_SOURCE, /useState<AgendaAdminMode>\(initialAgendaMode\)/);
});

test("an unrecognized or missing ?mode value falls back to the ordinary default (Agenda Items) -- no throw", () => {
  const line = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf('const initialAgendaMode: AgendaAdminMode ='));
  assert.match(line, /^const initialAgendaMode: AgendaAdminMode = searchParams\.get\("mode"\) === "import" \? "import" : "items";/);
});

test("Agenda offers a reciprocal contextual link into the shared Imports Service Center's Agenda door, carrying no authority of its own", () => {
  assert.match(PAGE_SOURCE, /import\s*\{\s*buildImportsHref\s*\}\s*from\s*"@\/lib\/importTypeRouting"/);
  assert.match(PAGE_SOURCE, /<AppLinkButton variant="tertiary" href=\{buildImportsHref\("agenda"\)\}>/);
});

test("Agenda's own Import Agenda tab still directly renders AgendaImportPanel -- the shared door does not replace the domain's existing entry point", () => {
  assert.match(PAGE_SOURCE, /<AgendaImportPanel/);
  assert.match(PAGE_SOURCE, /agendaMode=\{agendaMode\}/);
});
