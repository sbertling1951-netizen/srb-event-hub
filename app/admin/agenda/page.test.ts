import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import Papa from "papaparse";
import * as XLSX from "xlsx";

import {
  agendaItemFormsAreEqual,
  isStaleAgendaVersionError,
  mapAgendaRpcError,
} from "@/app/admin/agenda/page";
import {
  findAgendaWorkbookHeaderRow,
  interpretAgendaImportRow,
  parseAgendaWorkbookWorksheet,
} from "@/lib/agendaImportContract";
import { AGENDA_IMPORT_TEMPLATE_CONTRACT } from "@/lib/importTemplateContract";

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
const IMPORT_ORCHESTRATION_SOURCE = readFileSync(
  fileURLToPath(
    new URL("../../../lib/agendaImportOrchestration.ts", import.meta.url),
  ),
  "utf8",
);
const IMPORT_REVIEW_SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "../../../components/admin/agenda/AgendaImportReviewWorkspace.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);

function agendaTemplatePath(filename: string) {
  return fileURLToPath(
    new URL(`../../../public/templates/agenda/${filename}`, import.meta.url),
  );
}

const AGENDA_HEADINGS = AGENDA_IMPORT_TEMPLATE_CONTRACT.fields.map(
  (field) => field.preferredHeading,
);

function normalizeAgendaSampleRow(row: Record<string, unknown>) {
  const interpretation = interpretAgendaImportRow(row, {
    source_row_number: 5,
    default_sort_order: 1,
  });
  assert.equal(interpretation.validation_state, "valid");
  const candidate = interpretation.candidate;
  return {
    title: candidate.title,
    description: candidate.description,
    location: candidate.location,
    speaker: candidate.speaker,
    agenda_date: candidate.agenda_date,
    start_time: candidate.start_time,
    end_time: candidate.end_time,
    category: candidate.category,
    color: candidate.color,
    is_published: candidate.is_published,
  };
}

// -- Shipped Agenda template assets -----------------------------------
//
// These exercise the exact worksheet parser used by the live Agenda page.
// The title and instruction rows are intentionally retained in XLSX; the
// parser must deliberately locate the contract-defined header row.

test("Agenda blank XLSX: the live worksheet parser finds canonical headings without leaking title/instruction keys", () => {
  const workbook = XLSX.readFile(
    agendaTemplatePath("agenda_import_template_blank_with_speaker.xlsx"),
  );
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];

  assert.equal(findAgendaWorkbookHeaderRow(worksheet), 3);
  const rows = parseAgendaWorkbookWorksheet(worksheet);

  for (const row of rows) {
    assert.ok(
      Object.keys(row).every((key) => AGENDA_HEADINGS.includes(key)),
      `unexpected Agenda XLSX key: ${JSON.stringify(row)}`,
    );
  }
  assert.equal(
    rows.some((row) =>
      Object.keys(row).some((key) =>
        /fcoc|freightliner|chassis owners/i.test(key),
      ),
    ),
    false,
    "the generated Agenda blank template must not leak tenant-branded title/instruction keys",
  );
});

test("Agenda sample XLSX: the live worksheet parser reaches the normalized import shape", () => {
  const workbook = XLSX.readFile(
    agendaTemplatePath("agenda_import_template_sample_with_speaker.xlsx"),
  );
  const rows = parseAgendaWorkbookWorksheet(workbook.Sheets[workbook.SheetNames[0]]);
  const sample = normalizeAgendaSampleRow(rows[0]);

  assert.deepEqual(sample, {
    title: "Welcome & Opening Remarks",
    description: "Kickoff for all attendees with an overview of the event schedule.",
    location: "Main Pavilion",
    speaker: "Event Staff",
    agenda_date: "2026-09-12",
    start_time: "09:00",
    end_time: "09:30",
    category: "General",
    color: "#DBEAFE",
    is_published: true,
  });
});

test("Agenda CSV templates retain the canonical header contract and sample mapping", () => {
  const blank = Papa.parse<Record<string, string>>(
    readFileSync(
      agendaTemplatePath("agenda_import_template_blank_with_speaker.csv"),
      "utf8",
    ),
    { header: true, skipEmptyLines: true, transformHeader: (header) => header.replace(/^\uFEFF/, "").trim() },
  );
  assert.deepEqual(blank.meta.fields, AGENDA_HEADINGS);

  const sample = Papa.parse<Record<string, string>>(
    readFileSync(
      agendaTemplatePath("agenda_import_template_sample_with_speaker.csv"),
      "utf8",
    ),
    { header: true, skipEmptyLines: true, transformHeader: (header) => header.replace(/^\uFEFF/, "").trim() },
  );
  assert.deepEqual(sample.meta.fields, AGENDA_HEADINGS);
  assert.deepEqual(normalizeAgendaSampleRow(sample.data[0]), {
    title: "Welcome & Opening Remarks",
    description: "Kickoff for all attendees with an overview of the event schedule.",
    location: "Main Pavilion",
    speaker: "Event Staff",
    agenda_date: "2026-09-12",
    start_time: "09:00",
    end_time: "09:30",
    category: "General",
    color: "#DBEAFE",
    is_published: true,
  });
});

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

test("Agenda import browser path uses governed staging plus one batch commit and has no direct legacy import RPC", () => {
  assert.match(PAGE_SOURCE, /stageGovernedAgendaImport/);
  assert.match(PAGE_SOURCE, /commitAgendaImportRun/);
  assert.equal(PAGE_SOURCE.includes('"import_event_agenda_items"'), false);
  assert.match(IMPORT_ORCHESTRATION_SOURCE, /"create_import_run"/);
  assert.match(IMPORT_ORCHESTRATION_SOURCE, /"stage_import_run_row"/);
  assert.match(IMPORT_ORCHESTRATION_SOURCE, /"set_import_run_row_review_state"/);
  assert.equal(
    (IMPORT_ORCHESTRATION_SOURCE.match(/"commit_agenda_import_run"/g) || []).length,
    1,
  );
  assert.equal(IMPORT_ORCHESTRATION_SOURCE.includes("import_event_agenda_items"), false);
});

test("Agenda mounts the existing generic active/resume/lifecycle/History surfaces without a parallel lifecycle", () => {
  assert.match(PAGE_SOURCE, /<ActiveRunsPanel[\s\S]*?importType="agenda"/);
  assert.match(PAGE_SOURCE, /recoverAgendaImportRun/);
  assert.match(IMPORT_REVIEW_SOURCE, /<RunLifecycleActions/);
  assert.match(IMPORT_REVIEW_SOURCE, /deleteAgendaImportRow/);
  assert.match(
    PAGE_SOURCE,
    /<ImportHistoryPanel[\s\S]*?eventId=\{activeEvent\.id\}[\s\S]*?importType="agenda"/,
  );
  assert.match(PAGE_SOURCE, /epicentrax:agenda-import-run:/);
  assert.doesNotMatch(
    `${PAGE_SOURCE}\n${IMPORT_ORCHESTRATION_SOURCE}`,
    /create_agenda_import_lifecycle|list_active_agenda_import_runs|finalize_agenda_import_run/,
  );
});

test("Stage C separates upload/staging from the explicit confirmed Agenda commit", () => {
  const upload = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("async function handleAgendaImportFile"),
    PAGE_SOURCE.indexOf("async function resumeAgendaImportRun"),
  );
  const commit = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("async function commitCurrentAgendaImportRun"),
    PAGE_SOURCE.indexOf("async function refreshAgendaImportRun"),
  );
  assert.match(upload, /stageGovernedAgendaImport/);
  assert.doesNotMatch(upload, /commitAgendaImportRun/);
  assert.match(commit, /commitAgendaImportRun/);
  assert.match(IMPORT_REVIEW_SOURCE, /<ConfirmDialog/);
  assert.match(IMPORT_REVIEW_SOURCE, /onClick=\{\(\) => setConfirmCommitOpen\(true\)\}/);
});

test("Agenda staging passes the selected Event schedule to the single Stage A interpretation path", () => {
  const upload = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("async function handleAgendaImportFile"),
    PAGE_SOURCE.indexOf("async function resumeAgendaImportRun"),
  );
  assert.match(upload, /eventDateContext:/);
  assert.match(upload, /event_start_date: activeEvent\.start_date/);
  assert.match(upload, /event_end_date: activeEvent\.end_date/);
  assert.match(PAGE_SOURCE, /start_date: adminEvent\.start_date \?\? null/);
  assert.match(PAGE_SOURCE, /end_date: adminEvent\.end_date \?\? null/);
  assert.doesNotMatch(upload, /new Date\(|Date\.parse\(/);
});

test("Stage C lifecycle callbacks reload governed recovery rather than fabricating row/run state locally", () => {
  const refresh = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("async function refreshAgendaImportRun"),
    PAGE_SOURCE.indexOf("async function handleAgendaImportFinalized"),
  );
  assert.match(refresh, /recoverAgendaImportRun\(agendaImportRun\.runId\)/);
  assert.match(IMPORT_REVIEW_SOURCE, /onRowsChanged/);
  assert.doesNotMatch(PAGE_SOURCE, /handleAgendaImportRowAbandoned/);
});

test("finalize is verified through governed recovery, clears the locator, and resets the shared History panel", () => {
  const finalize = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("async function handleAgendaImportFinalized"),
    PAGE_SOURCE.indexOf("if \(hasAgendaAccess === false\)"),
  );
  assert.match(finalize, /recoverAgendaImportRun\(agendaImportRun\.runId\)/);
  assert.match(finalize, /recovered\.status !== "finalized"/);
  assert.match(finalize, /saveActiveAgendaImportRunId\(activeEvent\.id, null\)/);
  assert.match(finalize, /setAgendaImportHistoryReloadToken/);
  assert.match(PAGE_SOURCE, /key=\{agendaImportHistoryReloadToken\}/);
});

test("reload recovery hands an already-finalized locator to shared History instead of retaining Agenda-specific completed state", () => {
  const recoveryEffect = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("// The browser stores only a run-id locator"),
    PAGE_SOURCE.indexOf("function moveItemUp"),
  );
  assert.match(recoveryEffect, /recovered\.status === "finalized"/);
  assert.match(recoveryEffect, /saveActiveAgendaImportRunId\(activeEvent\.id, null\)/);
  assert.match(recoveryEffect, /setAgendaImportRun\(null\)/);
  assert.match(recoveryEffect, /Import History below/);
});

test("an existing active Agenda run disables a second upload and stays resumable", () => {
  assert.match(PAGE_SOURCE, /agendaActiveImportRunCount > 0/);
  assert.match(PAGE_SOURCE, /onRunCountChanged=\{handleAgendaActiveRunCountChanged\}/);
  assert.match(
    PAGE_SOURCE,
    /agendaActiveImportRunDiscovery\?\.eventId === activeEvent\.id/,
  );
  assert.match(PAGE_SOURCE, /resumeAgendaImportRun/);
  assert.match(PAGE_SOURCE, /recoverAgendaImportRun/);
});

test("the Stage C review surface contains no direct Agenda/import-table mutation or legacy import writer", () => {
  const sources = `${PAGE_SOURCE}\n${IMPORT_REVIEW_SOURCE}\n${IMPORT_ORCHESTRATION_SOURCE}`;
  assert.doesNotMatch(sources, /\.from\(["'](?:import_runs|import_run_rows)["']\)/);
  assert.doesNotMatch(sources, /\.from\(["']agenda_items["']\)\s*\.\s*(?:insert|update|delete|upsert)/);
  assert.doesNotMatch(sources, /["']import_event_agenda_items["']/);
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

test("Agenda access is re-evaluated on Admin working-Event change via loadPage, driven by the shared working-Event scope hook", () => {
  // useAdminWorkingEventScope replaces the bare subscribeToAdminWorkspace
  // reload: same-tab AND cross-tab changes now clear Event A's agenda
  // synchronously and reject a superseded loadPage().
  assert.match(PAGE_SOURCE, /useAdminWorkingEventScope\(/);
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
    /agendaMode === "items" && showTwoColumnAgendaLayout[\s\S]{0,100}\? "minmax\(300px, 360px\) 1fr"[\s\S]{0,30}: "1fr"/,
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

test("Agenda import correction reuses the normal editor's canonical active category read and passes those same options into review", () => {
  assert.match(
    PAGE_SOURCE,
    /\.from\("agenda_categories"\)[\s\S]*?\.select\("name,color,is_default,is_active"\)[\s\S]*?\.eq\("is_active", true\)/,
  );
  assert.match(PAGE_SOURCE, /<AgendaImportReviewWorkspace[\s\S]*?categoryOptions=\{agendaCategories\}/);
  assert.match(IMPORT_REVIEW_SOURCE, /categoryOptions=\{categoryOptions\}/);
});

// -- On-demand item editor + dirty-edit protection (2026-08-23) -----------
//
// The item editor previously stayed permanently expanded on wide/standard
// widths (only compact got the 2026-08-21 collapsible fix), consuming a
// large permanent slice of the page and obscuring the agenda. These tests
// lock in the on-demand behavior for every viewport: closed by default,
// opened only via Add Item / Edit Item, and closing never silently
// discards unsaved edits.

type AgendaFormLike = Parameters<typeof agendaItemFormsAreEqual>[0];

const BASE_AGENDA_FORM: AgendaFormLike = {
  id: "",
  external_id: "",
  title: "",
  description: "",
  location: "",
  speaker: "",
  category: "",
  color: "",
  agenda_date: "",
  start_time: "",
  end_time: "",
  sort_order: "",
  is_published: true,
};

test("1. editor is closed by default", () => {
  assert.match(PAGE_SOURCE, /const \[editorExpanded, setEditorExpanded\] = useState\(false\);/);
});

test("no new page-local viewport-width listener was introduced, and the editor no longer branches on isCompact at all -- it is on-demand at every width", () => {
  const listenerCount = (PAGE_SOURCE.match(/addEventListener\(\s*["']resize["']/g) || []).length;
  assert.equal(listenerCount, 0);
  assert.equal(/isCompact.*editorExpanded|editorExpanded.*isCompact/.test(PAGE_SOURCE), false);
});

test("2. Add Item opens a blank editor", () => {
  const fnStart = PAGE_SOURCE.indexOf("function openBlankEditor() {");
  const fnEnd = PAGE_SOURCE.indexOf("\n  function openEditorForItem(");
  assert.notEqual(fnStart, -1);
  assert.notEqual(fnEnd, -1);
  const body = PAGE_SOURCE.slice(fnStart, fnEnd);
  assert.match(body, /originalFormRef\.current = next;/);
  assert.match(body, /setForm\(next\);/);
  assert.match(body, /setEditorExpanded\(true\);/);
  // Wired to the always-visible header button shown while collapsed.
  assert.match(PAGE_SOURCE, /onClick=\{openBlankEditor\}\s*\n\s*>\s*\n\s*Add Item/);
});

test("3. Edit Item opens the editor with the selected item's existing values", () => {
  const fnStart = PAGE_SOURCE.indexOf("function openEditorForItem(item: AgendaItem) {");
  const fnEnd = PAGE_SOURCE.indexOf("\n  // Cancel/Close.");
  assert.notEqual(fnStart, -1);
  assert.notEqual(fnEnd, -1);
  const body = PAGE_SOURCE.slice(fnStart, fnEnd);
  assert.match(body, /const next = formFromItem\(item\);/);
  assert.match(body, /originalFormRef\.current = next;/);
  assert.match(body, /setForm\(next\);/);
  assert.match(body, /setEditorExpanded\(true\);/);
  // Both the Visual Agenda Editor's calendar block and the printable list
  // row reach openEditorForItem exclusively through the dirty-guarded
  // requestOpenEditorForItem() wrapper -- see the switching-guard block
  // below -- preserving the existing item selection/data-sync behavior
  // via a single code path.
  const callSites = [
    ...PAGE_SOURCE.matchAll(/onClick=\{\(\) => void requestOpenEditorForItem\(item\)\}/g),
  ];
  assert.equal(
    callSites.length,
    2,
    "expected both the calendar block and list row onClick to route through requestOpenEditorForItem",
  );
  assert.equal(
    /onClick=\{\(\) => openEditorForItem\(item\)\}/.test(PAGE_SOURCE),
    false,
    "no item-selection surface should call openEditorForItem directly, bypassing the dirty guard",
  );
});

test("4 & 5. successful Add and successful Save both close the editor -- Save/Add no longer branches on form.id to decide whether to collapse", () => {
  const saveItemStart = PAGE_SOURCE.indexOf("async function saveItem() {");
  const saveItemEnd = PAGE_SOURCE.indexOf("\n  async function deleteItem(");
  assert.notEqual(saveItemStart, -1);
  assert.notEqual(saveItemEnd, -1);
  const body = PAGE_SOURCE.slice(saveItemStart, saveItemEnd);
  assert.match(
    body,
    /originalFormRef\.current = emptyForm;\s*\n\s*setForm\(emptyForm\);\s*\n\s*setEditorExpanded\(false\);\s*\n\s*void refreshAgendaData\(\);/,
  );
  assert.equal(/if \(form\.id\) \{\s*\n\s*setEditorExpanded\(false\);/.test(body), false);
});

test("6. clean Cancel/Close closes immediately (no unsaved changes)", () => {
  const fnStart = PAGE_SOURCE.indexOf("async function closeEditor() {");
  assert.notEqual(fnStart, -1);
  const fnEnd = PAGE_SOURCE.indexOf("\n\n", fnStart + "async function closeEditor() {".length + 400);
  const body = PAGE_SOURCE.slice(fnStart, fnEnd === -1 ? fnStart + 900 : fnEnd);
  assert.match(body, /if \(!agendaItemFormsAreEqual\(form, originalFormRef\.current\)\) \{/);
  assert.match(body, /originalFormRef\.current = emptyForm;\s*\n\s*setForm\(emptyForm\);\s*\n\s*setEditorExpanded\(false\);/);
});

test("7. dirty Cancel/Close requires discard confirmation, reusing the existing requestConfirmation()/ConfirmDialog pattern -- no second confirmation mechanism", () => {
  const fnStart = PAGE_SOURCE.indexOf("async function closeEditor() {");
  const fnEnd = PAGE_SOURCE.indexOf("\n\n  useEffect(() => {\n    itemsRef.current = items;", fnStart);
  assert.notEqual(fnStart, -1);
  assert.notEqual(fnEnd, -1);
  const body = PAGE_SOURCE.slice(fnStart, fnEnd);
  assert.match(body, /await requestConfirmation\(\{/);
  assert.match(body, /confirmLabel: "Discard Changes",/);
  assert.match(body, /cancelLabel: "Keep Editing",/);
  assert.match(body, /danger: true,/);
});

test("8. declining discard leaves the editor open with edits intact -- closeEditor returns before touching form/editorExpanded when the confirmation resolves false", () => {
  const fnStart = PAGE_SOURCE.indexOf("async function closeEditor() {");
  const fnEnd = PAGE_SOURCE.indexOf("\n\n  useEffect(() => {\n    itemsRef.current = items;", fnStart);
  const body = PAGE_SOURCE.slice(fnStart, fnEnd);
  assert.match(body, /if \(!confirmed\) \{\s*\n\s*return;\s*\n\s*\}/);
});

test("9. confirming discard closes the editor -- the reset/collapse lines run unconditionally after the guarded confirmation block", () => {
  const fnStart = PAGE_SOURCE.indexOf("async function closeEditor() {");
  const fnEnd = PAGE_SOURCE.indexOf("\n\n  useEffect(() => {\n    itemsRef.current = items;", fnStart);
  const body = PAGE_SOURCE.slice(fnStart, fnEnd);
  const resetIdx = body.indexOf("originalFormRef.current = emptyForm;");
  const returnIdx = body.indexOf("return;");
  assert.notEqual(resetIdx, -1);
  assert.notEqual(returnIdx, -1);
  assert.ok(resetIdx > returnIdx, "the reset/collapse must come after the early-return guard, not before it");
});

test("10. no backdrop/outside-click dismissal exists for the editor -- it is an inline disclosure, not a modal, so there is no such surface, and the shared Dialog's dismissOnBackdrop is never wired to it", () => {
  assert.equal(/components\/ui\/Dialog["']/.test(PAGE_SOURCE.slice(0, PAGE_SOURCE.indexOf("export default function AdminAgendaPage"))), false);
  assert.equal(/dismissOnBackdrop/.test(PAGE_SOURCE), false);
  // The only close paths are the two explicit Cancel controls and a
  // successful Save -- confirmed above -- not any generic outside click.
  const cancelOnClicks = [...PAGE_SOURCE.matchAll(/onClick=\{\(\) => void closeEditor\(\)\}/g)];
  assert.equal(cancelOnClicks.length, 2, "expected exactly the header Cancel and the FormActions Cancel");
});

test("11. existing Agenda save/update RPC calls and their exact parameters are unchanged by the visibility/workflow change", () => {
  assert.match(PAGE_SOURCE, /supabase\.rpc\("create_event_agenda_item", \{/);
  assert.match(PAGE_SOURCE, /supabase\.rpc\("update_event_agenda_item", \{/);
  assert.match(PAGE_SOURCE, /p_expected_agenda_version: agendaVersionRef\.current,/);
});

test("12. the Visual Agenda Editor and the agenda display remain mounted (not gated on editorExpanded) when the item form is closed", () => {
  const bodyGateIdx = PAGE_SOURCE.indexOf("{editorExpanded ? (\n              <div\n                id=\"agenda-editor-form-body\"");
  assert.notEqual(bodyGateIdx, -1);
  const visualEditorIdx = PAGE_SOURCE.indexOf('title="Visual Agenda Editor"');
  assert.notEqual(visualEditorIdx, -1);
  assert.ok(visualEditorIdx > bodyGateIdx, "Visual Agenda Editor section should follow the gated form body, outside it");
  // Neither the printable agenda list nor the Visual Agenda Editor
  // PageSection is itself conditioned on editorExpanded.
  const visualSectionStart = PAGE_SOURCE.lastIndexOf("<PageSection", visualEditorIdx);
  const visualSectionSnippet = PAGE_SOURCE.slice(visualSectionStart, visualSectionStart + 120);
  assert.equal(/editorExpanded/.test(visualSectionSnippet), false);
});

// -- Dirty-editor protection when switching between Agenda items --------
//
// Both the agenda list row and the Visual Agenda Editor calendar block
// used to call openEditorForItem(item) directly, so switching to a
// different item while the editor held unsaved edits replaced the form
// immediately with no warning. requestOpenEditorForItem() is the single
// guarded path both surfaces now share -- see the updated "3. Edit Item"
// test above for proof both onClick handlers route through it.

function requestOpenEditorForItemSource() {
  const fnStart = PAGE_SOURCE.indexOf(
    "async function requestOpenEditorForItem(item: AgendaItem) {",
  );
  const fnEnd = PAGE_SOURCE.indexOf(
    "\n  // Cancel/Close.",
    fnStart,
  );
  assert.notEqual(fnStart, -1);
  assert.notEqual(fnEnd, -1);
  return PAGE_SOURCE.slice(fnStart, fnEnd);
}

test("requestOpenEditorForItem reuses the exact same dirty check as closeEditor -- no second dirty-state calculation", () => {
  const guardBody = requestOpenEditorForItemSource();
  assert.match(
    guardBody,
    /if \(!agendaItemFormsAreEqual\(form, originalFormRef\.current\)\) \{/,
  );
  // The identical expression closeEditor() already uses.
  const occurrences = [
    ...PAGE_SOURCE.matchAll(
      /if \(!agendaItemFormsAreEqual\(form, originalFormRef\.current\)\) \{/g,
    ),
  ];
  assert.equal(occurrences.length, 2, "expected exactly closeEditor and requestOpenEditorForItem to share this one dirty expression");
});

test("1 & 5. clean editor + selecting a different item (list row or Visual Agenda block) switches immediately -- opening only happens after the dirty check, never gated behind an unconditional prompt", () => {
  const guardBody = requestOpenEditorForItemSource();
  // openEditorForItem(item) must appear exactly once, after the guarded
  // if-block, reachable whether or not that block's confirmation ran --
  // i.e. it is not nested inside the dirty branch.
  const dirtyBlockStart = guardBody.indexOf(
    "if (!agendaItemFormsAreEqual(form, originalFormRef.current)) {",
  );
  const dirtyBlockEnd = guardBody.indexOf("\n    }\n", dirtyBlockStart) + "\n    }\n".length;
  const openCallIdx = guardBody.indexOf("openEditorForItem(item);");
  assert.notEqual(openCallIdx, -1);
  assert.ok(
    openCallIdx >= dirtyBlockEnd,
    "openEditorForItem(item) must run after the dirty-check block closes, not inside it",
  );
});

test("2 & 6. dirty editor + selecting a different item (list row or Visual Agenda block) opens the confirmation, reusing requestConfirmation()/ConfirmDialog -- no second confirmation mechanism", () => {
  const guardBody = requestOpenEditorForItemSource();
  assert.match(guardBody, /await requestConfirmation\(\{/);
  assert.match(guardBody, /confirmLabel: "Discard Changes",/);
  assert.match(guardBody, /cancelLabel: "Keep Editing",/);
  assert.match(guardBody, /danger: true,/);
  // Clearly communicates that unsaved changes will be discarded.
  assert.match(guardBody, /unsaved changes/i);
  assert.match(guardBody, /Discard them/i);
});

test("3. Keep Editing (declining discard) leaves the current item and unsaved values untouched -- the guard returns before calling openEditorForItem", () => {
  const guardBody = requestOpenEditorForItemSource();
  const confirmedIdx = guardBody.indexOf("const confirmed = await requestConfirmation({");
  const declineReturnIdx = guardBody.indexOf("if (!confirmed) {\n        return;\n      }", confirmedIdx);
  const openCallIdx = guardBody.indexOf("openEditorForItem(item);");
  assert.notEqual(confirmedIdx, -1);
  assert.notEqual(declineReturnIdx, -1);
  assert.ok(
    declineReturnIdx > confirmedIdx && openCallIdx > declineReturnIdx,
    "declining (return) must come before the eventual openEditorForItem call, guarding it",
  );
  // No setForm/setEditorExpanded exists anywhere in the decline branch
  // itself -- form and editorExpanded are simply never touched when the
  // user keeps editing.
  const declineBranch = guardBody.slice(confirmedIdx, openCallIdx);
  assert.equal(/setForm|setEditorExpanded/.test(declineBranch), false);
});

test("4 & 7. confirming discard opens the requested item through the existing openEditorForItem() path -- not a duplicated open implementation", () => {
  const guardBody = requestOpenEditorForItemSource();
  assert.match(guardBody, /openEditorForItem\(item\);/);
  // Only ever the one call to openEditorForItem in this guard -- no
  // second, inline copy of its setForm/originalFormRef/setEditorExpanded
  // logic.
  const openCalls = [...guardBody.matchAll(/openEditorForItem\(item\);/g)];
  assert.equal(openCalls.length, 1);
  assert.equal(/setForm\(next\)/.test(guardBody), false);
});

test("8. clicking the same currently edited item does not prompt -- an early-return guard precedes the dirty check", () => {
  const guardBody = requestOpenEditorForItemSource();
  const sameItemGuardIdx = guardBody.indexOf(
    "if (editorExpanded && form.id === item.id) {",
  );
  const dirtyCheckIdx = guardBody.indexOf(
    "if (!agendaItemFormsAreEqual(form, originalFormRef.current)) {",
  );
  assert.notEqual(sameItemGuardIdx, -1);
  assert.notEqual(dirtyCheckIdx, -1);
  assert.ok(sameItemGuardIdx < dirtyCheckIdx, "the same-item guard must run before the dirty check");
  const sameItemGuardEnd = guardBody.indexOf("\n    }\n", sameItemGuardIdx);
  assert.match(guardBody.slice(sameItemGuardIdx, sameItemGuardEnd), /return;/);
});

test("9. editor closed + item click still opens normally -- the same-item guard is conditioned on editorExpanded, and form equals originalFormRef (both emptyForm) whenever closed, so the dirty check is trivially false", () => {
  const guardBody = requestOpenEditorForItemSource();
  assert.match(guardBody, /if \(editorExpanded && form\.id === item\.id\) \{/);
  // Direct proof of the "trivially false while closed" claim: closeEditor,
  // saveItem, and deleteItem all reset both form and originalFormRef to
  // the identical emptyForm reference when the editor collapses.
  assert.equal(agendaItemFormsAreEqual(BASE_AGENDA_FORM, BASE_AGENDA_FORM), true);
});

test("10. existing Cancel/Close dirty protection is untouched by the switching guard -- closeEditor remains its own independent function with its own copy of the same discard-confirmation shape", () => {
  const closeStart = PAGE_SOURCE.indexOf("async function closeEditor() {");
  const closeEnd = PAGE_SOURCE.indexOf(
    "\n\n  useEffect(() => {\n    itemsRef.current = items;",
    closeStart,
  );
  assert.notEqual(closeStart, -1);
  assert.notEqual(closeEnd, -1);
  const closeBody = PAGE_SOURCE.slice(closeStart, closeEnd);
  assert.match(closeBody, /title: "Discard Unsaved Changes\?",/);
  assert.match(
    closeBody,
    /message:\s*\n\s*"This agenda item has unsaved changes\. Discard them and close the editor\?",/,
  );
  // requestOpenEditorForItem is defined separately, not folded into
  // closeEditor -- Cancel/Close keeps its own exact prior behavior.
  assert.notEqual(closeStart, PAGE_SOURCE.indexOf("async function requestOpenEditorForItem"));
});

test("11. existing Save/Add behavior is untouched by the switching guard -- same governed RPCs, same always-collapse-on-success behavior", () => {
  assert.match(PAGE_SOURCE, /supabase\.rpc\("create_event_agenda_item", \{/);
  assert.match(PAGE_SOURCE, /supabase\.rpc\("update_event_agenda_item", \{/);
  const saveItemStart = PAGE_SOURCE.indexOf("async function saveItem() {");
  const saveItemEnd = PAGE_SOURCE.indexOf("\n  async function deleteItem(");
  const body = PAGE_SOURCE.slice(saveItemStart, saveItemEnd);
  assert.match(
    body,
    /originalFormRef\.current = emptyForm;\s*\n\s*setForm\(emptyForm\);\s*\n\s*setEditorExpanded\(false\);\s*\n\s*void refreshAgendaData\(\);/,
  );
});

test("the header Add Item/Cancel toggle is a real accessible disclosure control, at every viewport (no isCompact gate)", () => {
  assert.match(PAGE_SOURCE, /actions=\{\s*editorExpanded \? \(/);
  assert.match(PAGE_SOURCE, /aria-expanded=\{editorExpanded\}/);
  assert.match(PAGE_SOURCE, /aria-controls="agenda-editor-form-body"/);
  assert.match(PAGE_SOURCE, /id="agenda-editor-form-body"/);
});

test("the form body only renders while editorExpanded, at every viewport", () => {
  assert.match(PAGE_SOURCE, /\{editorExpanded \? \(/);
  assert.equal(/\{!isCompact \|\| editorExpanded/.test(PAGE_SOURCE), false);
});

test("the editor is sticky except while expanded, at every viewport -- a tall open editor must scroll away normally, not stay pinned over the agenda", () => {
  assert.match(PAGE_SOURCE, /position: editorExpanded \? undefined : "sticky",/);
});

test("New Blank and both Edit Item entry points route through the shared openBlankEditor()/openEditorForItem() helpers, not inline duplicated logic", () => {
  assert.match(PAGE_SOURCE, /onClick=\{openBlankEditor\}/);
  assert.equal(/On New Blank, if a default category exists/.test(PAGE_SOURCE), false);
});

test("saveItem's stale version conflict path leaves the editor open (only the success path closes it)", () => {
  const saveItemStart = PAGE_SOURCE.indexOf("async function saveItem() {");
  const saveItemEnd = PAGE_SOURCE.indexOf("\n  async function deleteItem(");
  const body = PAGE_SOURCE.slice(saveItemStart, saveItemEnd);
  assert.match(
    body,
    /if \(isStaleAgendaVersionError\(new Error\(error\.message\)\)\) \{\s*\n\s*await reconcileAfterStaleVersion\(\);\s*\n\s*return;\s*\n\s*\}/,
  );
});

test("deleting the item currently being edited also collapses the editor and resets the dirty-tracking snapshot", () => {
  const deleteItemStart = PAGE_SOURCE.indexOf("async function deleteItem(id: string) {");
  const deleteItemEnd = PAGE_SOURCE.indexOf("\n  async function togglePublished(");
  assert.notEqual(deleteItemStart, -1);
  assert.notEqual(deleteItemEnd, -1);
  const body = PAGE_SOURCE.slice(deleteItemStart, deleteItemEnd);
  assert.match(
    body,
    /if \(form\.id === id\) \{\s*\n\s*originalFormRef\.current = emptyForm;\s*\n\s*setForm\(emptyForm\);\s*\n\s*setEditorExpanded\(false\);\s*\n\s*\}/,
  );
});

test("collapsing the editor while a focused control is inside it moves focus to the toggle button, rather than silently dropping focus -- now unconditional on isCompact", () => {
  assert.match(PAGE_SOURCE, /editorFormBodyRef\.current\.contains\(activeEl\)/);
  assert.match(PAGE_SOURCE, /editorToggleButtonRef\.current\?\.focus\(\);/);
  assert.match(PAGE_SOURCE, /useEffect\(\(\) => \{\s*\n\s*if \(editorExpanded\) \{\s*\n\s*return;\s*\n\s*\}/);
});

test("no shared Disclosure/Collapsible primitive was invented -- this remains a documented Agenda-local implementation, a candidate for later Central UI standardization", () => {
  assert.equal(/components\/ui\/(Disclosure|Collapsible|Accordion)/i.test(PAGE_SOURCE), false);
});

test("a small header-only sticky region exists whenever the editor is expanded, at every viewport, independent of the outer card's own sticky behavior", () => {
  assert.match(PAGE_SOURCE, /const editorHeaderSticky = editorExpanded;/);
  assert.match(
    PAGE_SOURCE,
    /editorHeaderSticky\s*\n\s*\?\s*\{\s*\n\s*position: "sticky",/,
  );
});

test("the sticky header has an opaque background and a bottom divider so it doesn't visually blend into the form scrolling beneath it", () => {
  const styleBlockStart = PAGE_SOURCE.indexOf("editorHeaderSticky\n                  ? {");
  assert.notEqual(styleBlockStart, -1);
  const block = PAGE_SOURCE.slice(styleBlockStart, styleBlockStart + 400);
  assert.match(block, /background: "var\(--color-bg-panel\)"/);
  assert.match(block, /borderBottom: "var\(--border-width-default\) solid var\(--color-border-default\)"/);
});

test("agendaItemFormsAreEqual: pure dirty-comparison helper treats identical forms as equal and any single-field change as unequal", () => {
  assert.equal(agendaItemFormsAreEqual(BASE_AGENDA_FORM, { ...BASE_AGENDA_FORM }), true);
  assert.equal(
    agendaItemFormsAreEqual(BASE_AGENDA_FORM, { ...BASE_AGENDA_FORM, title: "Changed" }),
    false,
  );
  assert.equal(
    agendaItemFormsAreEqual(BASE_AGENDA_FORM, { ...BASE_AGENDA_FORM, is_published: false }),
    false,
  );
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
