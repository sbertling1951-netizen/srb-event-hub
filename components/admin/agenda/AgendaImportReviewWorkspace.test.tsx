import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import {
  getAgendaEditRowFields,
  resolveAgendaImportCategorySelection,
} from "@/components/admin/agenda/AgendaEditRowDialog";
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
    correctionRevision: 0,
    correctionCount: 0,
    latestCorrectedCandidate: null,
    latestCorrectionIssues: [],
    latestCorrectedByAuthUserId: null,
    latestCorrectedAt: null,
    ...overrides,
  };
}

const EVENT_DATE_CONTEXT = {
  event_start_date: "2026-09-01",
  event_end_date: "2026-09-03",
};

const CATEGORY_OPTIONS = [
  { name: "General", color: "#DBEAFE" },
  { name: "Meal", color: "#FDE68A" },
  { name: "Seminar", color: "#DCFCE7" },
];

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
  options: {
    status?: "staging" | "ready_for_review";
    compact?: boolean;
    existingLocations?: { key: string; label: string }[];
  } = {},
) {
  return renderToStaticMarkup(
    <AgendaImportReviewWorkspace
      run={run(rows)}
      status={options.status ?? "staging"}
      compact={options.compact ?? false}
      committing={false}
      eventDateContext={EVENT_DATE_CONTEXT}
      categoryOptions={CATEGORY_OPTIONS}
      existingLocations={options.existingLocations ?? []}
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
    "#DBEAFE",
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

test("renders the latest valid correction as the effective working row and hides stale original candidate and validation guidance", () => {
  const correctedCandidate: AgendaImportRowResult["candidate"] = {
    source_row_number: 2,
    title: "Dinner",
    description: "Corrected evening meal",
    location: "Garden Pavilion",
    speaker: "Jordan Lee",
    agenda_date: "2026-11-04",
    start_time: "17:00",
    end_time: "19:00",
    category: "Meal",
    color: "#FDE68A",
    is_published: true,
    sort_order: 12,
    external_id: "dinner-2026-11-04-17-00",
  };
  const html = renderWorkspace([
    row({
      candidate: {
        ...row().candidate,
        title: "original lowercase meal",
        agenda_date: null,
        start_time: null,
        end_time: null,
        external_id: null,
      },
      issues: [
        { code: "missing_agenda_date", message: "Date missing", severity: "error" },
        {
          code: "missing_agenda_start_time",
          message: "Start time missing",
          severity: "error",
        },
      ],
      correctionCount: 1,
      correctionRevision: 1,
      latestCorrectedCandidate: correctedCandidate,
      latestCorrectionIssues: [],
    }),
  ]);

  for (const currentValue of [
    "Dinner",
    "Corrected evening meal",
    "Garden Pavilion",
    "Jordan Lee",
    "2026-11-04",
    "17:00",
    "19:00",
    "Meal",
    "#FDE68A",
    "Published: Yes",
    "Sort order: 12",
    "dinner-2026-11-04-17-00",
  ]) {
    assert.ok(html.includes(currentValue), currentValue);
  }
  assert.doesNotMatch(html, /original lowercase meal/);
  assert.doesNotMatch(html, /Date missing/);
  assert.doesNotMatch(html, /Start time is missing/);
  assert.doesNotMatch(html, /No external identity could be derived/);
  assert.match(html, />Ready to Import</);
});

test("a latest invalid correction renders its current values and issues, not the obsolete original failure", () => {
  const invalidCorrection = {
    ...row().candidate,
    title: "Current Corrected Title",
    agenda_date: "2026-11-04",
    start_time: null,
    external_id: null,
  };
  const html = renderWorkspace([
    row({
      rowState: "validation_failed",
      issues: [
        { code: "missing_agenda_date", message: "old", severity: "error" },
      ],
      correctionCount: 1,
      correctionRevision: 2,
      latestCorrectedCandidate: invalidCorrection,
      latestCorrectionIssues: [
        {
          code: "missing_agenda_start_time",
          message: "current",
          severity: "error",
        },
      ],
    }),
  ]);

  assert.match(html, /Current Corrected Title/);
  assert.match(html, /Start Time is missing/);
  assert.doesNotMatch(html, /Date is missing/);
});

test("Edit Row reopens from the latest effective candidate, not immutable original evidence", () => {
  const correctedCandidate = {
    ...row().candidate,
    title: "Latest Operator Edit",
    agenda_date: "2026-11-04",
    start_time: "17:00",
  };
  const fields = getAgendaEditRowFields(
    row({
      correctionCount: 2,
      correctionRevision: 2,
      latestCorrectedCandidate: correctedCandidate,
    }),
  );

  assert.equal(fields.Title, "Latest Operator Edit");
  assert.equal(fields["Agenda Date"], "2026-11-04");
  assert.equal(fields["Start Time"], "17:00");
});

test("governed category selection owns color changes and unknown imported categories are preserved until deliberate selection", () => {
  assert.deepEqual(resolveAgendaImportCategorySelection("Meal", CATEGORY_OPTIONS), {
    category: "Meal",
    color: "#FDE68A",
  });
  assert.deepEqual(resolveAgendaImportCategorySelection("Seminar", CATEGORY_OPTIONS), {
    category: "Seminar",
    color: "#DCFCE7",
  });
  assert.deepEqual(resolveAgendaImportCategorySelection("Imported Custom", CATEGORY_OPTIONS), {
    category: "Imported Custom",
    color: "",
  });

  const dialogSource = readFileSync(
    fileURLToPath(new URL("./AgendaEditRowDialog.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(dialogSource, /Imported: \{fields\.Category\} \(not configured\)/);
  assert.match(dialogSource, /label="Category color"/);
  assert.match(dialogSource, /readOnly/);
  assert.match(
    dialogSource,
    /repeat\(auto-fit, minmax\(min\(100%, 12rem\), 1fr\)\)/,
  );
  assert.doesNotMatch(dialogSource, /gridTemplateColumns: "1fr 1fr/);
  assert.doesNotMatch(dialogSource, /update\("Color"/);
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

test("a never-corrected validation-failed row offers both Edit Row and Delete Row, and cannot gain commit eligibility through UI state", () => {
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
  assert.match(html, />Edit Row</);
  assert.match(html, />Delete Row</);
  assert.doesNotMatch(html, />Import Agenda \(/);
  assert.doesNotMatch(html, /persisted message is not the presentation source/);
});

test("a corrected-but-still-invalid row surfaces as Needs Attention and still offers Delete Row, and a corrected-valid row is Ready to Import with Delete Row also offered", () => {
  const stillInvalid = row({
    rowState: "validation_failed",
    correctionCount: 1,
    correctionRevision: 1,
    issues: [
      {
        code: "invalid_agenda_date",
        message: "server-persisted, not shown verbatim",
        severity: "error",
      },
    ],
  });
  const stillInvalidHtml = renderWorkspace([stillInvalid], { status: "ready_for_review" });
  assert.match(stillInvalidHtml, />Needs Attention</);
  assert.doesNotMatch(stillInvalidHtml, />Cannot Import</);
  assert.match(stillInvalidHtml, />Edit Row</);
  assert.match(stillInvalidHtml, />Delete Row</);

  const corrected = row({ rowState: "approved", correctionCount: 1, correctionRevision: 1 });
  const correctedHtml = renderWorkspace([corrected], { status: "ready_for_review" });
  assert.match(correctedHtml, />Ready to Import</);
  assert.doesNotMatch(correctedHtml, />Cannot Import</);
  assert.match(correctedHtml, />Edit Row</);
  assert.match(correctedHtml, />Delete Row</);
});

test("committed and abandoned rows never offer Edit Row or Delete Row", () => {
  const committedHtml = renderWorkspace([
    row({ rowState: "committed", canonicalAgendaItemId: crypto.randomUUID() }),
  ]);
  assert.doesNotMatch(committedHtml, />Edit Row</);
  assert.doesNotMatch(committedHtml, />Delete Row</);

  const abandonedHtml = renderWorkspace([
    row({
      rowState: "validation_failed",
      abandonedAt: "2026-08-23T10:00:00Z",
      abandonmentReasonCode: "cannot_resolve",
    }),
  ]);
  assert.doesNotMatch(abandonedHtml, />Edit Row</);
  assert.doesNotMatch(abandonedHtml, />Delete Row</);
});

test("a finalized run never offers Edit Row even for a correctable rowState", () => {
  const html = renderWorkspace([row({ rowState: "approved" })], {
    status: "ready_for_review",
  });
  assert.match(html, />Edit Row</);

  // AgendaRowAction's own canEdit gate reads runStatus !== "finalized";
  // the workspace itself is never rendered once a run is finalized (its
  // caller unmounts it), so this proves the gate exists in source rather
  // than rendering a finalized workspace directly.
  assert.match(SOURCE, /canEdit =\s*\n?\s*runStatus !== "finalized"/);
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
  assert.match(SOURCE, /onClick=\{beginCommit\}/);
  assert.match(SOURCE, /<ConfirmDialog[\s\S]*onConfirm=\{confirmCommit\}/);
});

test("ready review exposes the shared run-wide Skip bulk action and the row-level Delete Row action, both confirmation-gated", () => {
  const html = renderWorkspace([row()], { status: "ready_for_review" });
  assert.match(html, />Skip All Open Rows</);
  assert.match(html, />Delete Row</);
  assert.doesNotMatch(html, />Skip Row</);
  assert.match(SOURCE, /abandonAllDialogTitle="Skip All Open Agenda Rows"/);
  assert.match(SOURCE, /title="Delete This Agenda Row"/);
  assert.doesNotMatch(SOURCE, /will remain in History/i);
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

test("workspace uses only governed lifecycle/correction/deletion components, never a direct database call", () => {
  assert.match(SOURCE, /<RunLifecycleActions/);
  assert.match(SOURCE, /<AgendaEditRowDialog/);
  assert.match(SOURCE, /<ConfirmDialog/);
  assert.match(SOURCE, /deleteAgendaImportRow/);
  assert.doesNotMatch(SOURCE, /AbandonRowButton/);
  assert.doesNotMatch(SOURCE, /supabase|\.rpc\(|\.from\(/);
  // The workspace delegates the actual edit form to AgendaEditRowDialog; it
  // renders no raw form control and no staged evidence itself.
  assert.doesNotMatch(SOURCE, /<Input|<Textarea|normalized_candidate/);
});

test("Delete Row's confirmation dialog states the exact governed consequence -- not imported, cannot be undone -- and never claims the row remains in History", () => {
  assert.match(
    SOURCE,
    /message="Delete this staged row from the current import\? It will not be imported\. This action cannot be undone from the review workspace\."/,
  );
  assert.doesNotMatch(SOURCE, /remain(s)? in (the )?History/i);
});

test("deletion calls the governed RPC through the orchestration module only, and reloads recovery state on success rather than removing the row client-side", () => {
  assert.match(SOURCE, /await deleteAgendaImportRow\(\{ rowId: row\.rowId \}\)/);
  // handleDelete awaits the RPC and only then calls onRowsChanged (which
  // reloads governed recovery state from the server) -- there is no
  // client-side row-array splice/filter anywhere that would remove the row
  // optimistically ahead of RPC success.
  assert.doesNotMatch(SOURCE, /\.filter\(.*rowId/);
  assert.match(
    SOURCE,
    /async function handleDelete\(\) \{\s*\n\s*setDeleting\(true\);\s*\n\s*try \{\s*\n\s*await deleteAgendaImportRow/,
  );
});

test("the Edit Row dialog itself is the sole editor, calls the governed correction RPC through the orchestration module only, and never a direct database call", () => {
  const dialogSource = readFileSync(
    fileURLToPath(new URL("./AgendaEditRowDialog.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(dialogSource, /correctAgendaImportRow/);
  assert.match(dialogSource, /interpretAgendaCorrection/);
  assert.match(dialogSource, /getEffectiveAgendaImportCandidate/);
  assert.doesNotMatch(dialogSource, /supabase|\.rpc\(|\.from\(/);
});

// --- Event-specific location comparison: import typo advisory (browser-only) ---

test("a staged location that is a likely typo of an existing Event location is visibly flagged with a resolution path", () => {
  const html = renderWorkspace(
    [row({ candidate: { ...row().candidate, location: "Main Hal" } })],
    { existingLocations: [{ key: "main hall", label: "Main Hall" }] },
  );
  assert.match(html, /Possible location typo/);
  assert.match(html, /Main Hall/);
  // The resolution is the governed Edit Row correction, not an automatic merge.
  assert.match(html, /Use Edit\s*Row to reuse an existing location or deliberately keep this name\./);
});

test("the typo advisory is advisory-only: it never changes the row's governed status badge", () => {
  const html = renderWorkspace(
    [row({ rowState: "approved", candidate: { ...row().candidate, location: "Main Hal" } })],
    { existingLocations: [{ key: "main hall", label: "Main Hall" }] },
  );
  // Still Ready to Import -- the advisory does not downgrade validation/review.
  assert.match(html, /Ready to Import/);
});

test("two staged rows whose locations are typos of each other flag each other, with no Event locations configured", () => {
  const html = renderWorkspace([
    row({ sourceRowNumber: 2, candidate: { ...row().candidate, location: "Auditorium" } }),
    row({ sourceRowNumber: 3, candidate: { ...row().candidate, location: "Auditrium" } }),
  ]);
  assert.match(html, /Possible location typo/);
});

test("a genuinely distinct location raises no false typo flag", () => {
  const html = renderWorkspace(
    [row({ candidate: { ...row().candidate, location: "Auditorium" } })],
    { existingLocations: [{ key: "main hall", label: "Main Hall" }] },
  );
  assert.doesNotMatch(html, /Possible location typo/);
});

test("a committed row is not re-flagged for a typo (advisory is a pre-import aid)", () => {
  const html = renderWorkspace(
    [
      row({
        rowState: "committed",
        canonicalAgendaItemId: crypto.randomUUID(),
        candidate: { ...row().candidate, location: "Main Hal" },
      }),
    ],
    { existingLocations: [{ key: "main hall", label: "Main Hall" }] },
  );
  assert.doesNotMatch(html, /Possible location typo/);
});

test("the Edit Row correction uses the shared governed location picker, fed this Event's and the import's own locations", () => {
  const dialogSource = readFileSync(
    fileURLToPath(new URL("./AgendaEditRowDialog.tsx", import.meta.url)),
    "utf8",
  );
  // The dialog's Location field is the searchable picker, not a bare Input.
  assert.match(dialogSource, /<AgendaLocationPicker/);
  assert.match(dialogSource, /options=\{locationOptions\}/);
  // The workspace builds the picker's options from the Event's existing
  // locations plus every staged row's own effective location, deduped by the
  // shared comparison rules, and passes them into the dialog.
  assert.match(SOURCE, /collectAgendaLocations\(\[/);
  assert.match(SOURCE, /existingLocations\.map\(\(option\) => option\.label\)/);
  assert.match(SOURCE, /getEffectiveAgendaImportCandidate\(row\)\.location/);
  assert.match(SOURCE, /locationOptions=\{runLocationOptions\}/);
});

// --- Resolve import typo warnings before confirmation (Lun #2) ---

test("an eligible row with an unresolved likely-duplicate location shows a pre-commit gate before Import runs", () => {
  const html = renderWorkspace(
    [row({ rowState: "approved", candidate: { ...row().candidate, location: "Main Hal" } })],
    { status: "ready_for_review", existingLocations: [{ key: "main hall", label: "Main Hall" }] },
  );
  // The import is still offered, but a gate warns it will require a choice.
  assert.match(html, />Import Agenda \(1\)</);
  assert.match(html, /looks like a possible duplicate/);
});

test("no gate warning when the eligible row's location is genuinely distinct", () => {
  const html = renderWorkspace(
    [row({ rowState: "approved", candidate: { ...row().candidate, location: "Auditorium" } })],
    { status: "ready_for_review", existingLocations: [{ key: "main hall", label: "Main Hall" }] },
  );
  assert.match(html, />Import Agenda \(1\)</);
  assert.doesNotMatch(html, /looks like a possible duplicate/);
});

test("Import is gated behind an explicit reuse-or-keep choice, re-checked at confirmation, before invoking the governed commit", () => {
  // The Import button routes through beginCommit, not straight to the confirm.
  assert.match(SOURCE, /onClick=\{beginCommit\}/);
  // beginCommit opens the resolution dialog when any eligible row is unresolved.
  assert.match(SOURCE, /function beginCommit\(\) \{\s*\n\s*if \(unresolvedTypoRows\.length > 0\) \{\s*\n\s*setLocationWarningsOpen\(true\);/);
  // confirmCommit re-checks at confirmation, not only at render.
  assert.match(SOURCE, /function confirmCommit\(\) \{\s*\n\s*if \(unresolvedTypoRows\.length > 0\) \{\s*\n\s*setConfirmCommitOpen\(false\);\s*\n\s*setLocationWarningsOpen\(true\);/);
  assert.match(SOURCE, /return Promise\.resolve\(onCommit\(\)\)/);
});

test("only commit-eligible rows gate, and a row's own appearance in the options is never treated as resolution", () => {
  assert.match(SOURCE, /row\.rowState === "approved" \|\| row\.rowState === "commit_failed"/);
  assert.match(SOURCE, /row\.abandonedAt === null/);
  // Similarity excludes the row's own key (findSimilarLocations), so a row
  // being in the options can never mark its own typo resolved.
  assert.match(SOURCE, /findSimilarLocations\(\s*\n\s*getEffectiveAgendaImportCandidate\(row\)\.location,\s*\n\s*runLocationOptions,\s*\n\s*\)\.length > 0/);
});

test("Reuse goes through the governed Edit Row correction; Keep is a transient acknowledgment bound to Event/run/row/revision/location/options", () => {
  // Reuse opens the same governed AgendaEditRowDialog and refreshes recovery.
  assert.match(SOURCE, /Reuse existing \(Edit Row\)/);
  assert.match(SOURCE, /setReuseEditRowId\(row\.rowId\)/);
  assert.match(SOURCE, /<AgendaEditRowDialog[\s\S]*onSaved=\{async \(message, shouldClose\) => \{[\s\S]*await onRowsChanged\(message\)/);
  // Keep records a transient in-memory ack signature bound to the exact facts.
  assert.match(SOURCE, /function keepAckSignature\(row: AgendaImportRowResult\): string \{/);
  assert.match(SOURCE, /run\.eventId,\s*\n\s*run\.runId,\s*\n\s*row\.rowId,\s*\n\s*row\.correctionRevision,\s*\n\s*location,\s*\n\s*optionsSignature,/);
  assert.match(SOURCE, /function acknowledgeKeep\(row: AgendaImportRowResult\)/);
});

test("the keep acknowledgment is in-memory only -- never a persisted browser store", () => {
  assert.match(SOURCE, /useState<ReadonlySet<string>>\(new Set\(\)\)/);
  assert.doesNotMatch(SOURCE, /localStorage|sessionStorage|indexedDB/);
  // No alternate writer / persistence is introduced for acknowledgments.
  assert.doesNotMatch(SOURCE, /supabase/);
});
