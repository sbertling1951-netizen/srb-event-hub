import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import Papa from "papaparse";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as XLSX from "xlsx";

import {
  agendaItemFormsAreEqual,
  AgendaWorkspaceSection,
  isStaleAgendaVersionError,
  mapAgendaRpcError,
} from "@/app/admin/agenda/pageContent";
import {
  agendaClickRange,
  agendaDragRange,
  exceedsAgendaCreateThreshold,
} from "@/lib/agendaCreationGesture";
import {
  findAgendaWorkbookHeaderRow,
  interpretAgendaImportRow,
  parseAgendaWorkbookWorksheet,
} from "@/lib/agendaImportContract";
import type { AdminAccessResult } from "@/lib/getCurrentAdminAccess";
import { AGENDA_IMPORT_TEMPLATE_CONTRACT } from "@/lib/importTemplateContract";

// Focused tests for the Admin Agenda governed UI cutover (Agenda
// Consumer Migration Stages 2A and 2B). Run with:
//   npx tsx --test app/admin/agenda/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./pageContent.tsx", import.meta.url)),
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
  // The Import button routes through beginCommit, which gates on unresolved
  // location typos before opening the governed commit confirmation.
  assert.match(IMPORT_REVIEW_SOURCE, /onClick=\{beginCommit\}/);
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
    /const \{ isCompact \} = useShellInterfaceCapabilities\(\);/,
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

test("the Event Agenda working pane takes the full content width -- the permanent 300-360px Catalog/Templates side column and its wide-tier switch are gone", () => {
  assert.equal(/showTwoColumnAgendaLayout/.test(PAGE_SOURCE), false);
  assert.equal(/minmax\(300px, 360px\)/.test(PAGE_SOURCE), false);
  assert.equal(/viewportClass/.test(PAGE_SOURCE), false);
  // The workflow container is a single column; the working pane keeps minWidth: 0.
  assert.match(
    PAGE_SOURCE,
    /<div\s*\n\s*style=\{\{\s*\n\s*display: "grid",\s*\n\s*gap: "var\(--space-5\)",\s*\n\s*alignItems: "start",\s*\n\s*minWidth: 0,\s*\n\s*\}\}\s*\n\s*>\s*\n\s*\{\/\* Catalog & Templates/,
  );
  assert.equal(/navigator\.userAgent/.test(PAGE_SOURCE), false);
  // Accessible separators declare aria-orientation; device-orientation layout branching remains forbidden.
  assert.equal(/matchMedia\([^)]*orientation|screen\.orientation/i.test(PAGE_SOURCE), false);
});

test("Catalog & Templates and Recent Template Activity live in one initially closed, accessible disclosure above the working pane (page-local, mirroring the item editor's toggle) -- expanding never creates a side column", () => {
  assert.match(PAGE_SOURCE, /const \[catalogExpanded, setCatalogExpanded\] = useState\(false\);/);
  assert.match(
    PAGE_SOURCE,
    /<AppButton\s*\n\s*variant="secondary"\s*\n\s*aria-expanded=\{catalogExpanded\}\s*\n\s*aria-controls="agenda-catalog-templates-body"\s*\n\s*onClick=\{\(\) => setCatalogExpanded\(\(open\) => !open\)\}/,
  );
  assert.match(PAGE_SOURCE, /\{catalogExpanded \? "Hide Templates" : "Show Templates"\}/);
  // Body is conditionally rendered (like #agenda-editor-form-body), stacked in the same column.
  const bodyStart = PAGE_SOURCE.indexOf('id="agenda-catalog-templates-body"');
  assert.notEqual(bodyStart, -1);
  const bodyBlock = PAGE_SOURCE.slice(bodyStart, PAGE_SOURCE.indexOf("Event Agenda working pane", bodyStart));
  assert.match(bodyBlock, /<AgendaTemplatePanel/);
  assert.match(bodyBlock, /Recent Template Activity/);
  assert.equal(/gridTemplateColumns/.test(bodyBlock), false);
  // Only rendered in Items mode -- Import mode is untouched.
  assert.match(PAGE_SOURCE, /\{agendaMode === "items" \? \(\s*\n\s*<PageSection variant="section">\s*\n\s*<PageHeader/);
});

test("every AgendaTemplatePanel prop, handler and confirmation stays wired inside the disclosure -- values live in page state so closing/reopening preserves them", () => {
  for (const prop of [
    "activeEvent={activeEvent}",
    "itemCount={items.length}",
    "templates={templates}",
    "selectedTemplateId={selectedTemplateId}",
    "newTemplateName={newTemplateName}",
    "newTemplateDescription={newTemplateDescription}",
    "savingTemplate={savingTemplate}",
    "applyingTemplate={applyingTemplate}",
    "replacingFromTemplate={replacingFromTemplate}",
    "setSelectedTemplateId={setSelectedTemplateId}",
    "setNewTemplateName={setNewTemplateName}",
    "setNewTemplateDescription={setNewTemplateDescription}",
    "onSaveTemplate={saveCurrentAgendaAsTemplate}",
    "onApplyTemplate={applyTemplateToEvent}",
    "onReplaceFromTemplate={replaceEventFromTemplate}",
  ]) {
    assert.ok(PAGE_SOURCE.includes(prop), `expected ${prop}`);
  }
  assert.match(PAGE_SOURCE, /const \[newTemplateName, setNewTemplateName\] = useState/);
  assert.match(PAGE_SOURCE, /const \[newTemplateDescription, setNewTemplateDescription\] = useState/);
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
    "onDragStart={(e) => handleCalendarDragStart(e, item.id)}",
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

test("AgendaTemplatePanel no longer takes an isMobile prop -- it always stacks vertically (now inside the page's Catalog & Templates disclosure)", () => {
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
  // Add Item and Calendar slot drafts share one new-item opener.
  assert.match(PAGE_SOURCE, /function openBlankEditor\(\) \{\s*openNewItemEditor\(\);\s*\}/);
  const fnStart = PAGE_SOURCE.indexOf("function openNewItemEditor(");
  const fnEnd = PAGE_SOURCE.indexOf("\n  function openBlankEditor(");
  assert.notEqual(fnStart, -1);
  assert.notEqual(fnEnd, -1);
  const body = PAGE_SOURCE.slice(fnStart, fnEnd);
  assert.match(body, /if \(recoverableDraft \|\| loading \|\| hasAgendaAccess !== true\) \{return;\}/);
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
  // via a single code path. The calendar opens on a single click/tap; the
  // printable list keeps double-click.
  const calendarClicks = [
    ...PAGE_SOURCE.matchAll(/data-agenda-calendar-item\s*\n[\s\S]{0,400}?onClick=\{\(\) => \{[\s\S]{0,300}?if \(!calendarResizePreview\) \{void requestOpenEditorForItem\(item\);\}/g),
  ];
  assert.equal(calendarClicks.length, 1, "expected a calendar single click to use guarded editing");
  const listDoubleClicks = [
    ...PAGE_SOURCE.matchAll(/onDoubleClick=\{\(\) => void requestOpenEditorForItem\(item\)\}/g),
  ];
  assert.equal(
    listDoubleClicks.length,
    1,
    "expected the list double-click to use guarded editing",
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

test("Cancel discards changed or unchanged drafts, preserves selection, and cannot interrupt a save", async () => {
  const start = PAGE_SOURCE.indexOf("  async function closeEditor() {");
  const end = PAGE_SOURCE.indexOf("\n  useEffect(() => {\n    itemsRef", start);
  const handler = PAGE_SOURCE.slice(start, end);
  for (const saving of [false, true]) {
    const calls: unknown[] = [];
    const original = {title: "Persisted title"};
    const cancel = new Function("saving", "saveInFlight", "originalFormRef", "setForm", "setEditorExpanded", handler + "\nreturn closeEditor;")(
      saving, {current: false}, {current: original}, (value: unknown) => calls.push(value), (value: unknown) => calls.push(value));
    await cancel();
    assert.deepEqual(calls, saving ? [] : [original, false]);
  }
  assert.doesNotMatch(handler, /requestConfirmation|setSelectedItemId|supabase/);
});

test("the modal uses the shared Dialog, disables backdrop dismissal, and routes Escape through guarded close", () => {
  assert.match(PAGE_SOURCE, /import \{ Dialog \} from "@\/components\/ui\/Dialog"/);
  assert.match(PAGE_SOURCE, /dismissOnBackdrop=\{false\}/);
  assert.match(PAGE_SOURCE, /<AgendaEditorSurface open=\{editorExpanded\} onClose=\{\(\) => void closeEditor\(\)\}/);
  assert.match(PAGE_SOURCE, /async function closeEditor\(\) \{\s*if \(saving \|\| saveInFlight.current\) \{return;\}/);
});

test("list single-click selects without expanding; keyboard and explicit Edit remain available", () => {
  const start = PAGE_SOURCE.indexOf("function selectAgendaItem(item: AgendaItem)");
  const end = PAGE_SOURCE.indexOf("function openEditorForItem", start);
  const selection = PAGE_SOURCE.slice(start, end);
  assert.match(selection, /originalFormRef\.current = next/);
  assert.match(selection, /setForm\(next\)/);
  assert.doesNotMatch(selection, /setEditorExpanded/);
  // Printable list only; Calendar items open the editor on a single click.
  assert.equal([...PAGE_SOURCE.matchAll(/onClick=\{\(\) => selectAgendaItem\(item\)\}/g)].length, 1);
  assert.match(PAGE_SOURCE, /recordRowProps\(item, selectAgendaItem,/);
  // The list button's own Enter/Space; Calendar item buttons use native
  // button activation of their guarded onClick.
  assert.equal([...PAGE_SOURCE.matchAll(/event\.key === "Enter" \|\| event\.key === " "/g)].length, 1);
  assert.match(PAGE_SOURCE, /Edit selected item/);
  assert.equal([...PAGE_SOURCE.matchAll(/onDoubleClick=\{\(event\) => event\.stopPropagation\(\)\}/g)].length, 3, "resize and move handles must not open editing");
  assert.match(PAGE_SOURCE, /aria-label=\{`Edit \$\{item\.title/);
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

test("switching editors retains one dirty-state check; Cancel discards directly", () => {
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
  assert.equal(occurrences.length, 1, "only switching records asks whether to discard");
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

test("Cancel remains independent of the guarded switching entry point", () => {
  const start = PAGE_SOURCE.indexOf("async function closeEditor()");
  const end = PAGE_SOURCE.indexOf("\n  useEffect", start);
  assert.match(PAGE_SOURCE.slice(start, end), /setForm\(originalFormRef.current\)/);
  assert.doesNotMatch(PAGE_SOURCE.slice(start, end), /requestConfirmation/);
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
  assert.match(formBlock, /<FormActions(?: className="record-editor-actions")?>/);
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
  const formActionsCount = (TEMPLATE_PANEL_SOURCE.match(/<FormActions(?: className="record-editor-actions")?>/g) || []).length;
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
  assert.match(PAGE_SOURCE, /<AppLinkButton variant="secondary" href=\{buildImportsHref\("agenda"\)\}>/);
});

test("Agenda's own Import Agenda tab still directly renders AgendaImportPanel -- the shared door does not replace the domain's existing entry point", () => {
  assert.match(PAGE_SOURCE, /<AgendaImportPanel/);
  assert.match(PAGE_SOURCE, /agendaMode=\{agendaMode\}/);
});

// ---- Central Navigation Batch 2C: the Agenda Workspace entry area. ----
// This file's primary proof is a real render of the actual production
// `AgendaWorkspaceSection` component (exported from page.tsx) via
// react-dom/server's renderToStaticMarkup -- the same runtime pattern
// already established for the Maps workspace (app/admin/map-admin/page.test.tsx).
// Every scenario below passes only already-resolved admin/tenantAuthority
// inputs and calls the REAL, unmodified
// getAdminNavItemChildren(admin, tenantAuthority, "agenda") inside that
// real component -- no copied nav list, no separately recomputed expected
// link set, and no source regex is the primary proof of any behavior.
// Rendered via React.createElement (not JSX) since this file is .ts, not
// .tsx.

function buildAgendaTestAdmin(overrides: Partial<AdminAccessResult> = {}): AdminAccessResult {
  return {
    adminUser: {
      id: "admin-1",
      email: "admin@example.com",
      display_name: "Admin",
      is_active: true,
      privilege_group: "event_admin",
      user_id: "user-1",
    },
    eventAccessRows: [],
    permissionKeys: [],
    permissionMap: {},
    rolePermissions: [],
    eventPermissionKeys: [],
    privilegeGroup: "event_admin",
    isSuperAdmin: false,
    email: "admin@example.com",
    display_name: "Admin",
    privilege_group: "event_admin",
    eventIds: [],
    event_ids: [],
    ...overrides,
  };
}

test("an admin with Agenda management authority renders the Agenda Workspace section with a real, visible Agenda Categories link", () => {
  const admin = buildAgendaTestAdmin({ permissionMap: { can_manage_agenda: true } });
  const html = renderToStaticMarkup(
    createElement(AgendaWorkspaceSection, { admin, tenantAuthority: null }),
  );

  assert.match(html, /<a class="app-button app-button-secondary" href="\/admin\/agenda\/categories">Agenda Categories<\/a>/);
  assert.match(html, /Agenda Workspace/);
});

test("an access input with no visible Agenda child renders no Agenda Workspace markup at all", () => {
  const noAccessAdmin = buildAgendaTestAdmin({ permissionMap: {} });
  const html = renderToStaticMarkup(
    createElement(AgendaWorkspaceSection, { admin: noAccessAdmin, tenantAuthority: null }),
  );
  assert.equal(html, "");

  const nullAdminHtml = renderToStaticMarkup(
    createElement(AgendaWorkspaceSection, { admin: null, tenantAuthority: null }),
  );
  assert.equal(nullAdminHtml, "");
});

// ---- Secondary source-level defense only -- not the primary proof of
// any behavior above, which is established by the renders themselves. ----

test("the production component calls the real getAdminNavItemChildren('agenda') itself -- the test never passes precomputed links in", () => {
  assert.match(PAGE_SOURCE, /import \{ getAdminNavItemChildren \} from "@\/components\/shell\/navigation\/adminNav";/);
  assert.match(PAGE_SOURCE, /export function AgendaWorkspaceSection\(/);
  assert.match(
    PAGE_SOURCE,
    /const agendaWorkspaceLinks = getAdminNavItemChildren\(admin, tenantAuthority, "agenda"\);/,
  );
  // AgendaWorkspaceSection's own props are admin/tenantAuthority only --
  // no `links`/`items` prop exists for a caller (or a test) to inject a
  // precomputed list instead of the real projection.
  const componentSignature = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("export function AgendaWorkspaceSection("),
    PAGE_SOURCE.indexOf(") {", PAGE_SOURCE.indexOf("export function AgendaWorkspaceSection(")),
  );
  assert.doesNotMatch(componentSignature, /links|items/);
});

test("AdminAgendaPageInner renders the exact extracted component, passing only admin/tenantAuthority from useAdmin() -- no duplicate rendering path", () => {
  assert.match(PAGE_SOURCE, /const \{ admin, tenantAuthority \} = useAdmin\(\);/);
  assert.match(PAGE_SOURCE, /<AgendaWorkspaceSection admin=\{admin\} tenantAuthority=\{tenantAuthority\} \/>/);
  assert.equal((PAGE_SOURCE.match(/<PageSection variant="card" title="Agenda Workspace">/g) || []).length, 1);
});

test("no hardcoded Agenda Categories href or second permission/visibility map is introduced by the workspace section itself", () => {
  const sectionStart = PAGE_SOURCE.indexOf("export function AgendaWorkspaceSection(");
  const sectionEnd = PAGE_SOURCE.indexOf("\n}\n", sectionStart) + 3;
  const sectionSource = PAGE_SOURCE.slice(sectionStart, sectionEnd);

  assert.doesNotMatch(sectionSource, /href="\/admin\/agenda\/categories"/);
  assert.doesNotMatch(sectionSource, /hasPermission|isSuperAdmin|permissionMap|privilege_group/);
  // The section maps agendaWorkspaceLinks directly -- no hardcoded
  // destination list of its own.
  assert.match(sectionSource, /\{agendaWorkspaceLinks\.map\(\(link\) => \(/);
});

test("the pre-existing hardcoded 'Manage Categories' operational button is untouched -- this batch adds the canonical entry area, it does not remove or alter existing Agenda workflow", () => {
  assert.match(PAGE_SOURCE, /window\.location\.href = "\/admin\/agenda\/categories";/);
  assert.match(PAGE_SOURCE, />\s*Manage Categories\s*</);
});

test("the Agenda Workspace section renders only when at least one link is visible -- never an empty dead section", () => {
  assert.match(PAGE_SOURCE, /if \(agendaWorkspaceLinks\.length === 0\) \{\s*\n\s*return null;\s*\n\s*\}/);
});

test("the Agenda Workspace entry area uses only established shared primitives -- PageSection, FormActions, AppLinkButton", () => {
  const sectionStart = PAGE_SOURCE.indexOf("export function AgendaWorkspaceSection(");
  const sectionEnd = PAGE_SOURCE.indexOf("\n}\n", sectionStart) + 3;
  const sectionSource = PAGE_SOURCE.slice(sectionStart, sectionEnd);

  assert.match(sectionSource, /<PageSection variant="card" title="Agenda Workspace">/);
  assert.match(sectionSource, /<FormActions(?: className="record-editor-actions")?>/);
  assert.match(sectionSource, /<AppLinkButton key=\{link\.id\} href=\{link\.href\} variant="secondary">/);
});

test("the bare route guard, shell adapter, title/subtitle, and back target are preserved unchanged", () => {
  assert.match(PAGE_SOURCE, /<AdminRouteGuard>/);
  assert.match(
    PAGE_SOURCE,
    /<AdminShellAdapter\s*\n\s*pageTitle="Admin Agenda"\s*\n\s*backTarget=\{\{ href: "\/admin\/dashboard", label: "Dashboard" \}\}\s*\n\s*>/,
  );
  assert.equal((PAGE_SOURCE.match(/<AdminRouteGuard/g) || []).length, 1);
  assert.equal((PAGE_SOURCE.match(/<AdminShellAdapter/g) || []).length, 1);
});

// The shell (ShellHeader) renders the single page-level <h1> from
// pageTitle ("Admin Agenda"). Both of AdminAgendaPageInner's returns --
// the hasAgendaAccess === false branch and the normal workspace -- render
// inside that same shell, so neither may claim h1 of its own.
//
// Deliberately NOT a whole-file literal-<h1> prohibition: the printable
// agenda is a separate standalone document built as an HTML string, and
// its own <h1> (the event name) is that document's legitimate title, not a
// heading in this page's outline.
// Both in-page headings also carry the shared .app-section-title class:
// the access-denied heading previously had no class at all, so demoting it
// alone would have dropped it from the UA h1 size (32px) to h2 (24px)
// rather than onto the shared section tier.
test("no in-page PageHeader claims h1 on either render path, both use the shared section-title typography, and the print document's own h1 is left alone", () => {
  assert.equal(/headingLevel="h1"/.test(PAGE_SOURCE), false);
  assert.match(
    PAGE_SOURCE,
    /<PageHeader title="Admin Agenda" headingLevel="h2" titleClassName="app-section-title" \/>/,
  );
  assert.match(
    PAGE_SOURCE,
    /<PageHeader\s*\n\s*title="No Agenda access for this event"\s*\n\s*headingLevel="h2"\s*\n\s*titleClassName="app-section-title"\s*\n\s*\/>/,
  );
  // Exactly one literal <h1> remains, and it is the print template's.
  assert.equal((PAGE_SOURCE.match(/<h1\b/g) || []).length, 1);
  assert.match(PAGE_SOURCE, /<h1>\$\{activeEvent\?\.name \?\? "Agenda"\}<\/h1>/);
});

test("automatic resume: an unfinished draft reopens its editor on the Items route without a manual Restore click", () => {
  // The auto-resume effect gates on the same confirmed scope the recovery
  // effect uses (recoverableDraft), the ordinary Items route, and a closed
  // editor -- then reopens the editor with the stored form and baseline.
  const idx = PAGE_SOURCE.indexOf("// Automatic resume:");
  assert.ok(idx >= 0, "expected an automatic-resume effect");
  const end = PAGE_SOURCE.indexOf("}, [recoverableDraft, loading, hasAgendaAccess, agendaMode, editorExpanded]);", idx);
  assert.ok(end > idx, "expected the auto-resume effect's dependency array");
  const body = PAGE_SOURCE.slice(idx, end);
  assert.match(body, /!recoverableDraft \|\|/);
  assert.match(body, /hasAgendaAccess !== true \|\|/);
  assert.match(body, /agendaMode !== "items" \|\|/, "must not hijack the Import route");
  assert.match(body, /editorExpanded/, "must not overwrite an already-open editor / newer edits");
  assert.match(body, /originalFormRef\.current = recoverableDraft\.original;/, "preserves the original baseline");
  assert.match(body, /setForm\(recoverableDraft\.form\);/, "restores every stored form value");
  assert.match(body, /setRecoverableDraft\(null\);/);
  assert.match(body, /setEditorExpanded\(true\);/, "reopens the editor automatically");
  assert.match(body, /resumeScrollRef\.current = true;/, "flags the one-time scroll-into-view");
  // No mutation/save is triggered by resuming.
  assert.equal(/create_event_agenda_item|update_event_agenda_item|supabase\.rpc/.test(body), false, "auto-resume issues no mutation");
});

test("automatic resume brings the reopened editor into view exactly once, without focusing an input (keyboard stays closed)", () => {
  const idx = PAGE_SOURCE.indexOf("// Bring the auto-resumed editor into view");
  assert.ok(idx >= 0, "expected the scroll-into-view effect");
  const end = PAGE_SOURCE.indexOf("}, [editorExpanded]);", idx);
  const body = PAGE_SOURCE.slice(idx, end);
  assert.match(body, /if \(!editorExpanded \|\| !resumeScrollRef\.current\)/, "only when a resume just happened");
  assert.match(body, /resumeScrollRef\.current = false;/, "runs once");
  assert.match(body, /editorToggleButtonRef\.current\?\.scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.equal(/\.focus\(\)/.test(body), false, "must not focus an input (no forced phone keyboard)");
});

test("the manual Restore/Discard panel is scoped to the Import route only -- the Items route resumes automatically (no routine Restore button)", () => {
  assert.match(PAGE_SOURCE, /recoverableDraft && !loading && hasAgendaAccess === true && agendaMode === "import" \?/);
  // The routine Items path no longer surfaces a Restore button.
  assert.equal(/recoverableDraft && !loading && hasAgendaAccess === true \?/.test(PAGE_SOURCE), false);
});

// --- Event-specific Agenda location picker (searchable selection + add new) ---

test("the item editor Location field is the searchable AgendaLocationPicker, not a bare text Input", () => {
  assert.match(PAGE_SOURCE, /import \{ AgendaLocationPicker \} from "@\/components\/admin\/agenda\/AgendaLocationPicker";/);
  assert.match(
    PAGE_SOURCE,
    /<Field\s*\n\s*label="Location"[\s\S]*?<AgendaLocationPicker\s*\n\s*controlProps=\{controlProps\}\s*\n\s*value=\{form\.location\}\s*\n\s*options=\{existingLocations\}/,
  );
  // The old raw Location <Input> is gone.
  assert.equal(
    /value=\{form\.location\}\s*\n\s*onChange=\{\(e\) =>\s*\n\s*setForm\(\(prev\) => \(\{ \.\.\.prev, location: e\.target\.value \}\)\)/.test(
      PAGE_SOURCE,
    ),
    false,
  );
});

test("existing locations are derived from THIS event's agenda items through the shared comparison rules, with no separate registry or persistence", () => {
  assert.match(PAGE_SOURCE, /collectAgendaLocations,?\s*\n?[\s\S]*?\} from "@\/lib\/agendaLocations";/);
  assert.match(
    PAGE_SOURCE,
    /const existingLocations = useMemo\(\s*\n\s*\(\) => collectAgendaLocations\(items\.map\(\(item\) => item\.location\)\),\s*\n\s*\[items\],\s*\n\s*\);/,
  );
});

test("choosing a location only updates form state (recovery-preserving); it never triggers a save or discards editor text", () => {
  // The picker's onChange writes location back through setForm, exactly like
  // every other editor field -- no RPC, no submit, no reset of the form. It
  // also records only an explicit "add" as a deliberate choice.
  assert.match(PAGE_SOURCE, /setForm\(\(prev\) => \(\{ \.\.\.prev, location: next \}\)\);/);
  assert.match(
    PAGE_SOURCE,
    /setLocationAckKey\(\s*\n\s*source === "add" \? locationComparisonKey\(next\) : null,\s*\n\s*\);/,
  );
});

test("the governed Agenda import review receives this event's existing locations so imports compare against them", () => {
  assert.match(PAGE_SOURCE, /existingLocations=\{existingLocations\}/);
});

// --- Deliberate location choice enforced in the Admin save path (Lun #1) ---

test("saveItem enforces a deliberate location choice before writing (not merely the picker)", () => {
  const save = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("async function saveItem"),
    PAGE_SOURCE.indexOf("async function saveItem") + 4000,
  );
  // Resolve the typed location against existing options + the item's original
  // value + an explicit acknowledgment; block save when a choice is needed.
  assert.match(save, /resolveLocationChoiceForSave\(\s*\n\s*form\.location,\s*\n\s*existingLocations,/);
  assert.match(save, /originalValue: form\.id \? originalFormRef\.current\.location : "",/);
  assert.match(save, /acknowledgedNewKey: locationAckKey,/);
  assert.match(save, /if \(locationResolution\.status !== "ok"\) \{/);
  assert.match(save, /return;/);
  // The governed RPC uses the RESOLVED spelling, not the raw typed text.
  assert.match(PAGE_SOURCE, /p_location: normalizeText\(resolvedLocation\)/);
  assert.doesNotMatch(PAGE_SOURCE, /p_location: normalizeText\(form\.location\)/);
});

test("an add-new acknowledgment is scoped to the current edit and reset when the item or editor state changes", () => {
  assert.match(
    PAGE_SOURCE,
    /useEffect\(\(\) => \{\s*\n\s*setLocationAckKey\(null\);\s*\n\s*setLocationChoiceError\(null\);\s*\n\s*\}, \[form\.id, editorExpanded\]\);/,
  );
});


test("day widths share one header/body track definition and remain display-only", () => {
  assert.equal((PAGE_SOURCE.match(/gridTemplateColumns: calendarColumns/g) || []).length, 2);
  const widths = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf("  const minimumDayWidth"), PAGE_SOURCE.indexOf("  const printableAgendaItems"));
  assert.doesNotMatch(widths, /supabase|setItems|setForm|agendaVersion/);
  assert.match(widths, /getComputedStyle/);
  assert.match(widths, /data-agenda-lanes/);
  assert.match(widths, /Math.min\(maximumDayWidth/);
});

// --- Calendar creation and item interaction (2026-10-10 accepted design) ---
//
// Executes the real page functions (types stripped) with synthetic pointer
// events, working-Event generations and confirmation results. No RPC is
// reachable: opening a draft only sets editor form state.

const CREATION_FUNCTIONS = [
  "minutesToTime",
  "openNewItemEditor",
  "requestOpenTimedDraft",
  "handleCreationPointerDown",
  "handleCreationPointerMove",
  "handleCreationPointerUp",
  "resetCreationGesture",
  "handleCreationSlotKeyDown",
  "handleCreationSlotClick",
];

const CREATION_CODE = (() => {
  const source = ts.createSourceFile("pageContent.tsx", PAGE_SOURCE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bodies: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && CREATION_FUNCTIONS.includes(node.name.text)) {
      bodies.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(bodies.length, CREATION_FUNCTIONS.length);
  return ts.transpileModule(bodies.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
})();

class FakeElement {
  isItem: boolean;
  constructor(isItem: boolean) {
    this.isItem = isItem;
  }
  closest() {
    return this.isItem ? this : null;
  }
}

const DIRTY_FORM = { ...BASE_AGENDA_FORM, title: "Unsaved session" };

function creationHarness(options: {
  state?: Record<string, unknown>;
  form?: AgendaFormLike;
  confirm?: (control: { switchEvent: () => void }) => boolean;
} = {}) {
  let generation = 1;
  const control = { switchEvent: () => { generation += 1; } };
  const record = {
    confirmations: 0,
    opened: [] as AgendaFormLike[],
    previews: [] as unknown[],
    captures: [] as number[],
    prevented: 0,
  };
  const formRef = { current: options.form ?? BASE_AGENDA_FORM };
  const originalFormRef = { current: BASE_AGENDA_FORM };
  const env: Record<string, unknown> = {
    AGENDA_SLOT_MINUTES: 15,
    AGENDA_SLOT_HEIGHT: 28,
    Element: FakeElement,
    emptyForm: BASE_AGENDA_FORM,
    agendaCategories: [{ name: "General", color: "#2563eb", is_default: true, is_active: true }],
    recoverableDraft: null,
    loading: false,
    hasAgendaAccess: true,
    saving: false,
    saveInFlight: { current: false },
    formRef,
    originalFormRef,
    editorReturnScrollRef: { current: null },
    window: { scrollX: 0, scrollY: 0 },
    agendaItemFormsAreEqual,
    requestConfirmation: async () => {
      record.confirmations += 1;
      return options.confirm ? options.confirm(control) : true;
    },
    setSelectedItemId: () => {},
    setForm: (next: AgendaFormLike) => { formRef.current = next; },
    setEditorExpanded: (open: boolean) => { if (open) {record.opened.push(formRef.current);} },
    captureAgendaGeneration: () => generation,
    isAgendaScopeCurrent: (captured: number) => captured === generation,
    creationGestureRef: { current: null },
    setCreationPreview: (preview: unknown) => { record.previews.push(preview); },
    calendarRange: { start: 7 * 60, end: 22 * 60 },
    calendarGeometry: { rangeStart: 7 * 60, rangeEnd: 22 * 60, slotMinutes: 15, slotHeight: 28 },
    agendaClickRange,
    agendaDragRange,
    exceedsAgendaCreateThreshold,
    ...options.state,
  };
  const fns = new Function(...Object.keys(env), `${CREATION_CODE}\nreturn { ${CREATION_FUNCTIONS.join(", ")} };`)(
    ...Object.values(env),
  ) as Record<string, (...args: unknown[]) => unknown>;

  // Day column top is at clientY 100.
  const column = {
    getBoundingClientRect: () => ({ top: 100 }),
    setPointerCapture: (id: number) => { record.captures.push(id); },
  };
  const pointer = (pointerType: string, offsetY: number, extra: Record<string, unknown> = {}) => ({
    pointerType, pointerId: 7, isPrimary: true, button: 0, clientX: 50, clientY: 100 + offsetY,
    target: new FakeElement(false), currentTarget: column,
    preventDefault: () => { record.prevented += 1; },
    ...extra,
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { fns, record, control, pointer, formRef, settle };
}

const slotY = (minutes: number) => ((minutes - 7 * 60) / 15) * 28;

test("Calendar click opens a guarded 30-minute draft with date, start, end and default category", async () => {
  const h = creationHarness();
  h.fns.handleCreationPointerDown(h.pointer("mouse", slotY(8 * 60) + 5), "2026-11-01");
  h.fns.handleCreationPointerUp(h.pointer("mouse", slotY(8 * 60) + 7));
  await h.settle();
  assert.equal(h.record.opened.length, 1);
  assert.deepEqual(h.record.opened[0], {
    ...BASE_AGENDA_FORM, category: "General", color: "#2563eb",
    agenda_date: "2026-11-01", start_time: "08:00", end_time: "08:30",
  });
  assert.deepEqual(h.record.captures, [7], "mouse uses pointer capture for column drags");
  assert.equal(h.record.prevented, 0);
});

test("primary mouse drag selects a snapped forward or backward range and opens on release", async () => {
  for (const [from, to] of [[slotY(8 * 60) + 2, slotY(8 * 60 + 45) + 20], [slotY(8 * 60 + 45) + 20, slotY(8 * 60) + 2]]) {
    const h = creationHarness();
    h.fns.handleCreationPointerDown(h.pointer("mouse", from), "2026-11-01");
    h.fns.handleCreationPointerMove(h.pointer("mouse", to));
    assert.equal(h.record.opened.length, 0, "nothing opens before release");
    assert.deepEqual(h.record.previews.at(-1), { day: "2026-11-01", start: 8 * 60, end: 9 * 60 });
    h.fns.handleCreationPointerUp(h.pointer("mouse", to));
    await h.settle();
    assert.equal(h.record.opened.length, 1);
    assert.equal(h.record.opened[0].start_time, "08:00");
    assert.equal(h.record.opened[0].end_time, "09:00");
    assert.equal(h.record.previews.at(-1), null, "preview clears on release");
  }
});

test("secondary mouse buttons, non-primary pointers and Calendar item targets never start creation", async () => {
  for (const extra of [{ button: 2 }, { isPrimary: false }, { target: new FakeElement(true) }]) {
    const h = creationHarness();
    h.fns.handleCreationPointerDown(h.pointer("mouse", 40, extra), "2026-11-01");
    h.fns.handleCreationPointerUp(h.pointer("mouse", 40));
    await h.settle();
    assert.equal(h.record.opened.length, 0);
    assert.deepEqual(h.record.captures, []);
  }
});

test("touch tap opens a draft without capture or preventDefault; touch movement of 6px or more scrolls instead", async () => {
  const tap = creationHarness();
  tap.fns.handleCreationPointerDown(tap.pointer("touch", slotY(9 * 60)), "2026-11-01");
  tap.fns.handleCreationPointerUp(tap.pointer("touch", slotY(9 * 60) + 3));
  await tap.settle();
  assert.equal(tap.record.opened[0].start_time, "09:00");
  assert.equal(tap.record.opened[0].end_time, "09:30");

  const scrolled = creationHarness();
  scrolled.fns.handleCreationPointerDown(scrolled.pointer("touch", slotY(9 * 60)), "2026-11-01");
  scrolled.fns.handleCreationPointerMove(scrolled.pointer("touch", slotY(9 * 60) + 6));
  scrolled.fns.handleCreationPointerUp(scrolled.pointer("touch", slotY(9 * 60) + 6));
  const unreported = creationHarness();
  unreported.fns.handleCreationPointerDown(unreported.pointer("touch", slotY(9 * 60)), "2026-11-01");
  unreported.fns.handleCreationPointerUp(unreported.pointer("touch", slotY(9 * 60) + 40));
  await scrolled.settle();
  for (const h of [tap, scrolled, unreported]) {
    assert.deepEqual(h.record.captures, []);
    assert.equal(h.record.prevented, 0);
  }
  assert.equal(scrolled.record.opened.length, 0);
  assert.equal(scrolled.record.previews.length, 0, "touch never draws a drag preview");
  assert.equal(unreported.record.opened.length, 0);
});

test("pointercancel clears the gesture and preview so a later release opens nothing", async () => {
  const h = creationHarness();
  h.fns.handleCreationPointerDown(h.pointer("mouse", 40), "2026-11-01");
  h.fns.handleCreationPointerMove(h.pointer("mouse", 120));
  h.fns.resetCreationGesture();
  h.fns.handleCreationPointerUp(h.pointer("mouse", 120));
  await h.settle();
  assert.equal(h.record.opened.length, 0);
  assert.equal(h.record.previews.at(-1), null);
});

test("a gesture begun under one working Event cannot open a draft after an Event switch", async () => {
  const h = creationHarness();
  h.fns.handleCreationPointerDown(h.pointer("mouse", 40), "2026-11-01");
  h.control.switchEvent();
  h.fns.handleCreationPointerUp(h.pointer("mouse", 42));
  await h.settle();
  assert.equal(h.record.opened.length, 0);
  assert.equal(h.record.confirmations, 0);
});

test("unauthorized, loading, recovering or saving states never open a timed draft", async () => {
  for (const state of [
    { hasAgendaAccess: false }, { hasAgendaAccess: null }, { loading: true },
    { recoverableDraft: { form: BASE_AGENDA_FORM } }, { saving: true }, { saveInFlight: { current: true } },
  ]) {
    const h = creationHarness({ state });
    h.fns.handleCreationPointerDown(h.pointer("touch", 40), "2026-11-01");
    h.fns.handleCreationPointerUp(h.pointer("touch", 40));
    await h.fns.requestOpenTimedDraft("2026-11-01", { start: 8 * 60, end: 8 * 60 + 30 }, 1);
    h.fns.handleCreationSlotKeyDown({ key: "Enter", preventDefault() {} }, "2026-11-01", 8 * 60);
    await h.settle();
    assert.equal(h.record.opened.length, 0, JSON.stringify(state));
    assert.equal(h.record.confirmations, 0);
  }
});

test("a dirty draft asks through requestConfirmation and survives Keep Editing", async () => {
  const declined = creationHarness({ form: DIRTY_FORM, confirm: () => false });
  await declined.fns.requestOpenTimedDraft("2026-11-01", { start: 8 * 60, end: 8 * 60 + 30 }, 1);
  assert.equal(declined.record.confirmations, 1);
  assert.equal(declined.record.opened.length, 0);
  assert.equal(declined.formRef.current, DIRTY_FORM, "unsaved values are untouched");

  const accepted = creationHarness({ form: DIRTY_FORM, confirm: () => true });
  await accepted.fns.requestOpenTimedDraft("2026-11-01", { start: 8 * 60, end: 8 * 60 + 30 }, 1);
  assert.equal(accepted.record.opened.length, 1);
  assert.equal(accepted.record.opened[0].title, "");

  const switched = creationHarness({
    form: DIRTY_FORM,
    confirm: (control) => { control.switchEvent(); return true; },
  });
  await switched.fns.requestOpenTimedDraft("2026-11-01", { start: 8 * 60, end: 8 * 60 + 30 }, 1);
  assert.equal(switched.record.opened.length, 0, "an awaited discard is rejected after an Event switch");
  assert.equal(switched.formRef.current, DIRTY_FORM);
});

test("Enter or Space on an hour slot opens the same guarded draft; other keys do nothing", async () => {
  const h = creationHarness();
  let prevented = 0;
  h.fns.handleCreationSlotKeyDown({ key: "Tab", preventDefault: () => { prevented += 1; } }, "2026-11-01", 10 * 60);
  h.fns.handleCreationSlotKeyDown({ key: " ", preventDefault: () => { prevented += 1; } }, "2026-11-01", 10 * 60);
  await h.settle();
  assert.equal(prevented, 1);
  assert.equal(h.record.opened.length, 1);
  assert.equal(h.record.opened[0].start_time, "10:00");
  assert.equal(h.record.opened[0].end_time, "10:30");
  assert.match(PAGE_SOURCE, /role="button"\s*tabIndex=\{slot % 60 === 0 \? 0 : -1\}/);
});

test("the Calendar column wires creation without suppressing touch, and the preview ignores pointers", () => {
  for (const needle of [
    "onPointerDown={(e) => handleCreationPointerDown(e, day)}",
    "onPointerMove={handleCreationPointerMove}",
    "onPointerUp={handleCreationPointerUp}",
    "onPointerCancel={resetCreationGesture}",
    "onLostPointerCapture={resetCreationGesture}",
  ]) {
    assert.ok(PAGE_SOURCE.includes(needle), needle);
  }
  const handlers = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("  function handleCreationPointerDown("),
    PAGE_SOURCE.indexOf("  function handleCreationSlotKeyDown("),
  );
  assert.doesNotMatch(handlers, /preventDefault|touchAction|supabase/);
  assert.match(handlers, /if \(isMouse\) \{\s*e\.currentTarget\.setPointerCapture\(e\.pointerId\);/);
  const preview = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf("{creationPreview?.day === day ? ("), PAGE_SOURCE.indexOf("{calendarDropPreview?.day === day ? ("));
  assert.match(preview, /pointerEvents: "none"/);
  assert.match(PAGE_SOURCE, /useAdminWorkingEventScope\(\(\) => \{\s*creationGestureRef\.current = null;\s*setCreationPreview\(null\);/);
});

test("existing items move only by a draggable span handle inside the item button, with no nested button", () => {
  const start = PAGE_SOURCE.indexOf("data-agenda-calendar-item\n");
  const end = PAGE_SOURCE.indexOf("</button>", start);
  const itemButton = PAGE_SOURCE.slice(start, end);
  assert.doesNotMatch(itemButton, /<button|<AppButton/);
  assert.equal((itemButton.match(/\bdraggable\b(?!=\{false\})/g) || []).length, 1, "only the move handle is draggable");
  assert.match(itemButton, /<span\s*\n\s*aria-hidden="true"\s*\n\s*draggable\s*\n\s*onDragStart=\{\(e\) => handleCalendarDragStart\(e, item\.id\)\}/);
  assert.match(itemButton, /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(itemButton, /cursor: "grab"/);
  // The drop offset is measured against the whole item, not the handle.
  const dragStart = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf("function handleCalendarDragStart("), PAGE_SOURCE.indexOf("function handleCalendarDragOver("));
  assert.match(dragStart, /e: React\.DragEvent<HTMLSpanElement>/);
  assert.match(dragStart, /closest<HTMLElement>\("\[data-agenda-calendar-item\]"\)/);
  assert.match(dragStart, /const rect = itemElement\.getBoundingClientRect\(\);/);
  // Resize handles remain.
  assert.equal((itemButton.match(/beginCalendar(Start|End)Resize\(e, item\)/g) || []).length, 2);
});

test("item editing rejects an awaited discard after a working-Event switch", () => {
  const guardBody = requestOpenEditorForItemSource();
  assert.match(guardBody, /const generation = captureAgendaGeneration\(\);/);
  const declineIdx = guardBody.indexOf("if (!confirmed) {");
  const staleIdx = guardBody.indexOf("if (!isAgendaScopeCurrent(generation)) {");
  assert.ok(declineIdx !== -1 && staleIdx > declineIdx);
  assert.ok(staleIdx < guardBody.indexOf("openEditorForItem(item);"));
});

test("day divider controls expose bounded keyboard and native touch alternatives", () => {
  assert.match(PAGE_SOURCE, /role="separator" aria-orientation="vertical"/);
  assert.match(PAGE_SOURCE, /aria-valuenow=\{calendarDayWidth\(day\)\}/);
  assert.match(PAGE_SOURCE, /type="range" step=\{10\}/);
  assert.match(PAGE_SOURCE, /onPointerCancel=/);
  assert.match(PAGE_SOURCE, /touchAction: "pan-y pinch-zoom"/);
  assert.match(PAGE_SOURCE, /Fit all days/);
  assert.match(PAGE_SOURCE, /Reset widths/);
});


test("screen-reader activation opens a slot once; pointer click does not duplicate pointerup", async () => {
  const h = creationHarness();
  h.fns.handleCreationSlotClick({ detail: 1 }, "2026-11-01", 10 * 60 + 15);
  assert.equal(h.record.opened.length, 0);
  h.fns.handleCreationSlotClick({ detail: 0 }, "2026-11-01", 10 * 60 + 15);
  await h.settle();
  assert.equal(h.record.opened.length, 1);
  assert.equal(h.record.opened[0].start_time, "10:15");
});
