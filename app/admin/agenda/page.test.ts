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

test("mapAgendaRpcError falls through to the raw message for unknown codes", () => {
  assert.equal(
    mapAgendaRpcError(new Error("some_unmapped_code"), "fallback"),
    "some_unmapped_code",
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
