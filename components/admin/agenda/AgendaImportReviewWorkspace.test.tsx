import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import {
  AgendaImportReviewWorkspace,
  describeAgendaCommitFailure,
  describeAgendaValidationIssue,
  getAgendaImportRowStatus,
} from "@/components/admin/agenda/AgendaImportReviewWorkspace";
import type {
  AgendaImportRowResult,
  AgendaImportRunResult,
} from "@/lib/agendaImportOrchestration";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./AgendaImportReviewWorkspace.tsx", import.meta.url)),
  "utf8",
);

const noop = () => {};

function row(
  overrides: Partial<AgendaImportRowResult> = {},
): AgendaImportRowResult {
  return {
    rowId: crypto.randomUUID(),
    sourceRowNumber: 2,
    candidate: {
      source_row_number: 2,
      title: "Opening Session",
      description: "Welcome and Event overview",
      location: "Main Hall",
      speaker: "Alex Rivera",
      agenda_date: "2026-09-01",
      start_time: "09:00",
      end_time: "09:45",
      category: "General",
      color: "#DBEAFE",
      is_published: false,
      sort_order: 0,
      external_id: "opening-session-2026-09-01-09-00",
    },
    issues: [],
    rowState: "approved",
    canonicalAgendaItemId: null,
    commitError: null,
    abandonedAt: null,
    abandonedByAuthUserId: null,
    abandonmentReasonCode: null,
    ...overrides,
  };
}

function run(rows: AgendaImportRowResult[]): AgendaImportRunResult {
  return {
    runId: "00000000-0000-4000-8000-000000000001",
    eventId: "00000000-0000-4000-8000-000000000002",
    sourceFilename: "agenda-review.xlsx",
    status: "staging",
    rows,
    batchOutcome: "pending_commit",
    importedCount: 0,
    newVersion: null,
    orchestrationError: null,
  };
}

function renderWorkspace(
  rows: AgendaImportRowResult[],
  options: { status?: "staging" | "ready_for_review"; compact?: boolean } = {},
) {
  return renderToStaticMarkup(
    <AgendaImportReviewWorkspace
      run={run(rows)}
      status={options.status ?? "staging"}
      compact={options.compact ?? false}
      committing={false}
      onRowsChanged={noop}
      onCommit={noop}
      onFinalized={noop}
      onError={noop}
    />,
  );
}

test("renders the required persisted run summary counts in operator language", () => {
  const html = renderWorkspace([
    row(),
    row({ rowState: "validation_failed" }),
    row({ rowState: "committed", canonicalAgendaItemId: crypto.randomUUID() }),
    row({ abandonedAt: "2026-08-23T10:00:00Z", abandonmentReasonCode: "operator_declined" }),
  ]);

  for (const label of [
    "Total Rows",
    "Ready to Import",
    "Failed Validation",
    "Abandoned / Skipped",
    "Imported",
    "Open Rows",
  ]) {
    assert.match(html, new RegExp(`>${label.replace("/", "\\/")}<`));
  }
  assert.match(html, /agenda-review\.xlsx/);
  assert.match(html, /Run ID:/);
});

test("renders recognizable normalized Agenda fields, preserving explicit false and zero", () => {
  const html = renderWorkspace([row()]);

  for (const value of [
    "Opening Session",
    "Welcome and Event overview",
    "2026-09-01",
    "09:00",
    "09:45",
    "General",
    "Main Hall",
    "Alex Rivera",
    "Sort order: 0",
    "Published: No",
    "opening-session-2026-09-01-09-00",
  ]) {
    assert.ok(html.includes(value), value);
  }
  assert.doesNotMatch(html, /normalized_candidate|\{&quot;title&quot;/);
});

test("maps deterministic validation codes to friendly correction guidance", () => {
  assert.match(describeAgendaValidationIssue("missing_agenda_title"), /Title is missing/);
  assert.match(describeAgendaValidationIssue("invalid_agenda_sort_order"), /whole number of zero or greater/);
  assert.match(describeAgendaValidationIssue("unknown_code"), /did not pass Agenda import validation/);
});

test("same-file duplicate guidance says every copy is blocked and no winner was selected", () => {
  const message = describeAgendaValidationIssue(
    "duplicate_agenda_external_id_in_file",
  );
  assert.match(message, /All rows/);
  assert.match(message, /No duplicate was selected as a winner/);
  assert.match(message, /new import run/);
});

test("validation-failed rows cannot gain eligibility or a Skip action through UI state", () => {
  const invalid = row({
    rowState: "validation_failed",
    issues: [
      {
        code: "missing_agenda_title",
        message: "persisted message is not the presentation source",
        severity: "error",
      },
    ],
  });
  const html = renderWorkspace([invalid]);

  assert.match(html, />Cannot Import</);
  assert.match(html, /Title is missing/);
  assert.doesNotMatch(html, />Skip Row</);
  assert.doesNotMatch(html, />Import Agenda \(/);
  assert.doesNotMatch(html, /persisted message is not the presentation source/);
});

test("row states use distinct text labels; ordinary ready state is not success-colored", () => {
  assert.deepEqual(getAgendaImportRowStatus(row()), {
    label: "Ready to Import",
    tone: "info",
  });
  assert.deepEqual(getAgendaImportRowStatus(row({ rowState: "committed" })), {
    label: "Imported",
    tone: "success",
  });
  assert.deepEqual(
    getAgendaImportRowStatus(row({ abandonedAt: "2026-08-23T10:00:00Z" })),
    { label: "Abandoned / Skipped", tone: "neutral" },
  );
});

test("commit is offered only after staging is closed and remains confirmation-gated", () => {
  assert.doesNotMatch(renderWorkspace([row()], { status: "staging" }), />Import Agenda \(1\)</);
  assert.match(
    renderWorkspace([row()], { status: "ready_for_review" }),
    />Import Agenda \(1\)</,
  );
  assert.match(SOURCE, /onClick=\{\(\) => setConfirmCommitOpen\(true\)\}/);
  assert.match(SOURCE, /<ConfirmDialog[\s\S]*onConfirm=\{async \(\) =>/);
});

test("ready review exposes governed row and run-wide Skip language with confirmation", () => {
  const html = renderWorkspace([row()], { status: "ready_for_review" });
  assert.match(html, />Skip All Open Rows</);
  assert.match(html, />Skip Row</);
  assert.match(SOURCE, /abandonAllDialogTitle="Skip All Open Agenda Rows"/);
});

test("safe commit-failure presentation includes a useful stale-version explanation and never reads raw persisted messages", () => {
  assert.match(
    describeAgendaCommitFailure("agenda_commit_stale_version"),
    /cannot overwrite newer Agenda data/,
  );
  assert.match(describeAgendaCommitFailure("unknown"), /batch was rolled back/);
  assert.doesNotMatch(SOURCE, /commitError\?\.message|commitError\.message/);
});

test("compact presentation uses a named ResponsiveList; wider presentation uses DataTable", () => {
  const compact = renderWorkspace([row()], { compact: true });
  const wide = renderWorkspace([row()], { compact: false });

  assert.match(compact, /class="responsive-list"/);
  assert.match(compact, /aria-labelledby="agenda-import-candidates"/);
  assert.doesNotMatch(compact, /<table/);
  assert.match(wide, /<table class="data-table"/);
});

test("workspace exposes only governed lifecycle components and no editor or direct database path", () => {
  assert.match(SOURCE, /<RunLifecycleActions/);
  assert.match(SOURCE, /<AbandonRowButton/);
  assert.doesNotMatch(SOURCE, /supabase|\.rpc\(|\.from\(/);
  assert.doesNotMatch(SOURCE, /<Input|<Textarea|normalized_candidate/);
});
