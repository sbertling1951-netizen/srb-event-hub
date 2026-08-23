"use client";

import { useState } from "react";

import { ImportRunSummary } from "@/app/admin/imports/ImportRunSummary";
import {
  AbandonRowButton,
  RunLifecycleActions,
} from "@/app/admin/imports/RunLifecycleActions";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable, ResponsiveList } from "@/components/ui/DataTable";
import { FormActions } from "@/components/ui/FormActions";
import { PageSection } from "@/components/ui/PageSection";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/StatusBadge";
import type { AgendaImportIssueCode } from "@/lib/agendaImportContract";
import {
  type AgendaImportRowResult,
  type AgendaImportRunResult,
  summarizeAgendaImportRows,
} from "@/lib/agendaImportOrchestration";
import {
  ABANDONMENT_REASON_OPTIONS,
  type ImportRunLifecycleStatus,
} from "@/lib/importLifecycleOrchestration";

const VALIDATION_MESSAGES: Record<AgendaImportIssueCode, string> = {
  missing_agenda_title:
    "Title is missing. Add it to the source row, then upload a new import run.",
  missing_agenda_date:
    "Agenda Date is missing. Add it to the source row, then upload a new import run.",
  invalid_agenda_date:
    "Agenda Date is not a valid calendar date. Correct the source row, then upload a new import run.",
  missing_agenda_start_time:
    "Start Time is missing. Add it to the source row, then upload a new import run.",
  invalid_agenda_start_time:
    "Start Time is not valid. Correct the source row, then upload a new import run.",
  invalid_agenda_end_time:
    "End Time is not valid. Correct the source row, then upload a new import run.",
  invalid_agenda_sort_order:
    "Sort Order must be a whole number of zero or greater. Correct the source row, then upload a new import run.",
  duplicate_agenda_external_id_in_file:
    "All rows with this same title, date, and start time are blocked. No duplicate was selected as a winner. Correct or remove every duplicate in the source file, then upload a new import run.",
};

const COMMIT_FAILURE_MESSAGES: Record<string, string> = {
  agenda_commit_failed:
    "The Agenda import did not complete. Review the run and retry when the underlying issue is resolved.",
  agenda_commit_denied:
    "The Agenda import was denied by its authority or Event lifecycle boundary.",
  agenda_commit_conflict:
    "The Agenda import encountered a governed data conflict. Review the current Agenda before retrying.",
  agenda_commit_unavailable:
    "The Agenda import service was unavailable. The batch was rolled back and can be retried.",
  agenda_commit_stale_version:
    "The Agenda changed after this import was staged. This run cannot overwrite newer Agenda data; skip its remaining open rows and start a new import from the current Agenda version.",
};

const RUN_STATUS: Record<
  ImportRunLifecycleStatus,
  { label: string; tone: StatusBadgeTone }
> = {
  staging: { label: "Review Open", tone: "info" },
  ready_for_review: { label: "Staging Closed", tone: "warning" },
  finalized: { label: "Finalized", tone: "success" },
};

export function describeAgendaValidationIssue(code: string): string {
  return (
    VALIDATION_MESSAGES[code as AgendaImportIssueCode] ||
    "This row did not pass Agenda import validation. Correct the source row, then upload a new import run."
  );
}

export function describeAgendaCommitFailure(code: string | null): string {
  if (!code) {
    return "The Agenda import did not complete. Review the run before retrying.";
  }
  return (
    COMMIT_FAILURE_MESSAGES[code] ||
    "The Agenda import did not complete. The batch was rolled back; review the run before retrying."
  );
}

export function getAgendaImportRowStatus(row: AgendaImportRowResult): {
  label: string;
  tone: StatusBadgeTone;
} {
  if (row.abandonedAt) {
    return { label: "Abandoned / Skipped", tone: "neutral" };
  }
  switch (row.rowState) {
    case "committed":
      return { label: "Imported", tone: "success" };
    case "validation_failed":
      return { label: "Cannot Import", tone: "danger" };
    case "approved":
      return { label: "Ready to Import", tone: "info" };
    case "commit_failed":
    case "needs_review":
      return { label: "Needs Attention", tone: "warning" };
    default:
      return { label: "Review Pending", tone: "warning" };
  }
}

function abandonmentReasonLabel(code: string | null) {
  return (
    ABANDONMENT_REASON_OPTIONS.find((option) => option.code === code)?.label ||
    "Skipped by an authorized operator"
  );
}

function AgendaCandidateDetails({ row }: { row: AgendaImportRowResult }) {
  const candidate = row.candidate;

  return (
    <div style={{ display: "grid", gap: "var(--space-2)", minWidth: 0 }}>
      <div>
        <strong>{candidate.title || "Untitled Agenda row"}</strong>
        {candidate.description ? (
          <div className="app-subtle-text" style={{ marginTop: "var(--space-1)" }}>
            {candidate.description}
          </div>
        ) : null}
      </div>
      <div className="app-subtle-text">
        {candidate.agenda_date || "Date missing"} · {candidate.start_time || "Start missing"}
        {candidate.end_time ? `–${candidate.end_time}` : ""}
      </div>
      <div className="app-subtle-text">
        Category: {candidate.category || "None"} · Location: {candidate.location || "None"}
        {candidate.speaker ? ` · Speaker: ${candidate.speaker}` : ""}
      </div>
      <div className="app-subtle-text">
        Sort order: {candidate.sort_order ?? "Not set"} · Published: {candidate.is_published ? "Yes" : "No"}
      </div>
      <div className="app-subtle-text" style={{ overflowWrap: "anywhere" }}>
        {candidate.external_id
          ? `Creates or updates the Agenda item with external identity ${candidate.external_id}.`
          : "No external identity could be derived; this row cannot be imported."}
      </div>
    </div>
  );
}

function AgendaRowOutcome({ row }: { row: AgendaImportRowResult }) {
  const status = getAgendaImportRowStatus(row);
  const messages = row.abandonedAt
    ? [abandonmentReasonLabel(row.abandonmentReasonCode)]
    : row.rowState === "validation_failed"
      ? row.issues.map((issue) => describeAgendaValidationIssue(issue.code))
      : row.rowState === "commit_failed"
        ? [describeAgendaCommitFailure(row.commitError?.code ?? null)]
        : [];

  return (
    <div style={{ display: "grid", gap: "var(--space-2)" }}>
      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      {messages.length ? (
        <ul
          aria-label={`Source row ${row.sourceRowNumber} import messages`}
          style={{ margin: 0, paddingLeft: "var(--space-5)" }}
        >
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : row.rowState === "approved" ? (
        <span className="app-subtle-text">This row will be included in the governed Agenda batch.</span>
      ) : row.rowState === "committed" ? (
        <span className="app-subtle-text">Canonical Agenda data has been committed.</span>
      ) : null}
    </div>
  );
}

function AgendaRowAction({
  row,
  onRowsChanged,
  onError,
}: {
  row: AgendaImportRowResult;
  onRowsChanged: (message: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  return (
    <AbandonRowButton
      row={row}
      triggerLabel="Skip Row"
      triggerAriaLabel={`Skip source row ${row.sourceRowNumber}: ${row.candidate.title || "Untitled Agenda row"}`}
      dialogTitle="Skip This Agenda Row"
      dialogDescription="Skip this row permanently for this import run? Its source and validation evidence remain in the run, but it will not be imported or retried. This cannot be undone."
      onAbandoned={() =>
        onRowsChanged(`Source row ${row.sourceRowNumber} was skipped. The governed run has been refreshed.`)
      }
      onError={onError}
    />
  );
}

type AgendaImportReviewWorkspaceProps = {
  run: AgendaImportRunResult;
  status: ImportRunLifecycleStatus;
  compact: boolean;
  committing: boolean;
  onRowsChanged: (message: string) => void | Promise<void>;
  onCommit: () => void | Promise<void>;
  onFinalized: (result: {
    status: ImportRunLifecycleStatus;
    finalizedAt: string | null;
    finalizedByAuthUserId: string | null;
  }) => void | Promise<void>;
  onError: (message: string) => void;
};

export function AgendaImportReviewWorkspace({
  run,
  status,
  compact,
  committing,
  onRowsChanged,
  onCommit,
  onFinalized,
  onError,
}: AgendaImportReviewWorkspaceProps) {
  const [confirmCommitOpen, setConfirmCommitOpen] = useState(false);
  const summary = summarizeAgendaImportRows(run.rows);
  const retryCount = summary.commitFailed;
  const importableCount = summary.approvedPendingCommit + retryCount;
  const hasStaleFailure = run.rows.some(
    (row) =>
      row.abandonedAt === null &&
      row.commitError?.code === "agenda_commit_stale_version",
  );
  const canCommit =
    status === "ready_for_review" && importableCount > 0 && !hasStaleFailure;
  const runStatus = RUN_STATUS[status];

  const nextStep =
    status === "staging"
      ? "Review every row and skip any ready row you do not want to import. Then close staging; closing means no more candidates can be added to this run."
      : canCommit
        ? `Staging is closed. Confirm the governed Agenda import for ${importableCount} eligible row${importableCount === 1 ? "" : "s"}.`
        : summary.unresolvedOpen > 0
          ? "This run still has open rows that must be imported, retried, or skipped before it can be finalized."
          : "Every row is imported, unable to import, or skipped. Finalize the run to complete it and move it into Import History.";

  return (
    <PageSection title="Agenda Import Review" titleStyle={{ margin: 0 }}>
      <div style={{ display: "grid", gap: "var(--space-5)" }}>
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", alignItems: "center" }}>
            <StatusBadge tone={runStatus.tone}>{runStatus.label}</StatusBadge>
            <strong>{run.sourceFilename || "Agenda import file"}</strong>
          </div>
          <div className="app-subtle-text" style={{ overflowWrap: "anywhere" }}>
            Run ID: {run.runId}
          </div>
        </div>

        <Alert tone="info">{nextStep}</Alert>

        <ImportRunSummary
          label="Agenda import run summary"
          items={[
            { label: "Total Rows", value: summary.processed },
            { label: "Ready to Import", value: summary.approvedPendingCommit },
            { label: "Failed Validation", value: summary.validationFailed },
            { label: "Abandoned / Skipped", value: summary.abandoned },
            { label: "Imported", value: summary.committed },
            {
              label: "Open Rows",
              value: summary.unresolvedOpen,
              description: "Includes ready and retryable rows",
            },
          ]}
        />

        {summary.validationFailed > 0 ? (
          <Alert tone="warning">
            Rows that failed validation cannot be edited or approved here. Correct the source file and upload a new run if those rows must be imported; their validation evidence remains part of this run.
          </Alert>
        ) : null}

        {hasStaleFailure ? (
          <Alert tone="warning">
            {describeAgendaCommitFailure("agenda_commit_stale_version")}
          </Alert>
        ) : null}

        <RunLifecycleActions
          runId={run.runId}
          status={status}
          rows={run.rows}
          abandonAllLabel="Skip All Open Rows"
          abandonAllDialogTitle="Skip All Open Agenda Rows"
          abandonAllDialogDescription="Skip every remaining open row permanently for this import run? Committed and validation-failed rows are unaffected. Source and outcome evidence remains in the run. This cannot be undone."
          onStagingClosed={() =>
            onRowsChanged("Source staging was closed. The governed run has been refreshed and is ready for commit review.")
          }
          onOpenRowsAbandoned={(count) =>
            onRowsChanged(`${count} open row${count === 1 ? " was" : "s were"} skipped. The governed run has been refreshed.`)
          }
          onFinalized={onFinalized}
          onError={onError}
        />

        {canCommit ? (
          <FormActions>
            <AppButton
              variant="primary"
              loading={committing}
              onClick={() => setConfirmCommitOpen(true)}
            >
              {retryCount > 0
                ? `Retry Agenda Import (${importableCount})`
                : `Import Agenda (${importableCount})`}
            </AppButton>
          </FormActions>
        ) : null}

        <ConfirmDialog
          open={confirmCommitOpen}
          title={retryCount > 0 ? "Retry Agenda Import" : "Import Agenda"}
          message={`Import ${importableCount} eligible Agenda row${importableCount === 1 ? "" : "s"}? This creates or updates canonical Agenda items through the governed atomic batch and will not overwrite an Agenda that changed after this run was staged.`}
          confirmLabel={retryCount > 0 ? "Retry Import" : "Import Agenda"}
          busy={committing}
          onConfirm={async () => {
            await onCommit();
            setConfirmCommitOpen(false);
          }}
          onCancel={() => (committing ? null : setConfirmCommitOpen(false))}
        />

        <div>
          <h3 id="agenda-import-candidates" style={{ marginTop: 0 }}>
            Staged Agenda Rows
          </h3>
          {compact ? (
            <ResponsiveList aria-labelledby="agenda-import-candidates">
              {run.rows.map((row) => (
                <li key={row.rowId} className="responsive-list-item">
                  <div className="responsive-list-item-header">
                    <div className="responsive-list-item-title">Source row {row.sourceRowNumber}</div>
                    <AgendaRowOutcome row={row} />
                  </div>
                  <AgendaCandidateDetails row={row} />
                  <AgendaRowAction row={row} onRowsChanged={onRowsChanged} onError={onError} />
                </li>
              ))}
            </ResponsiveList>
          ) : (
            <DataTable caption="Staged Agenda import rows">
              <thead>
                <tr>
                  <th scope="col">Source Row</th>
                  <th scope="col">Agenda Candidate</th>
                  <th scope="col">Import Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {run.rows.map((row) => (
                  <tr key={row.rowId}>
                    <td>{row.sourceRowNumber}</td>
                    <td>
                      <AgendaCandidateDetails row={row} />
                    </td>
                    <td>
                      <AgendaRowOutcome row={row} />
                    </td>
                    <td>
                      <AgendaRowAction row={row} onRowsChanged={onRowsChanged} onError={onError} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
      </div>
    </PageSection>
  );
}
