"use client";

import { useState } from "react";

import { ImportRunSummary } from "@/app/admin/imports/ImportRunSummary";
import { RunLifecycleActions } from "@/app/admin/imports/RunLifecycleActions";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable, ResponsiveList } from "@/components/ui/DataTable";
import { FormActions } from "@/components/ui/FormActions";
import { PageSection } from "@/components/ui/PageSection";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/StatusBadge";
import type { AgendaImportEventDateContext } from "@/lib/agendaImportContract";
import {
  describeAgendaCommitFailure,
  describeAgendaValidationIssue,
} from "@/lib/agendaImportMessages";
import {
  type AgendaImportRowResult,
  type AgendaImportRunResult,
  deleteAgendaImportRow,
  getEffectiveAgendaImportCandidate,
  getEffectiveAgendaImportIssues,
  summarizeAgendaImportRows,
} from "@/lib/agendaImportOrchestration";
import {
  ABANDONMENT_REASON_OPTIONS,
  describeLifecycleError,
  type ImportRunLifecycleStatus,
} from "@/lib/importLifecycleOrchestration";

import {
  AgendaEditRowDialog,
  type AgendaImportCategoryOption,
} from "./AgendaEditRowDialog";

// Re-exported for existing external callers (this module was their
// original home before lib/agendaImportMessages.ts was split out to avoid
// a component<->component import cycle with AgendaEditRowDialog).
export { describeAgendaCommitFailure, describeAgendaValidationIssue };

const RUN_STATUS: Record<
  ImportRunLifecycleStatus,
  { label: string; tone: StatusBadgeTone }
> = {
  staging: { label: "Review Open", tone: "info" },
  ready_for_review: { label: "Staging Closed", tone: "warning" },
  finalized: { label: "Finalized", tone: "success" },
};

export function getAgendaImportRowStatus(row: AgendaImportRowResult): {
  label: string;
  tone: StatusBadgeTone;
} {
  if (row.abandonedAt) {
    return { label: "Abandoned / Skipped", tone: "neutral" };
  }
  switch (row.rowState) {
    case "committed":
      return row.correctionCount > 0
        ? { label: "Imported (Corrected)", tone: "success" }
        : { label: "Imported", tone: "success" };
    case "validation_failed":
      // A correction attempt was made and is still invalid: this is an
      // actionable, in-progress state (Needs Attention), not the original
      // never-touched "Cannot Import" dead end.
      return row.correctionCount > 0
        ? { label: "Needs Attention", tone: "warning" }
        : { label: "Cannot Import", tone: "danger" };
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
  const candidate = getEffectiveAgendaImportCandidate(row);

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
        Category: {candidate.category || "None"} · Color: {candidate.color || "None"} · Location: {candidate.location || "None"}
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
  const currentIssues = getEffectiveAgendaImportIssues(row);
  const messages = row.abandonedAt
    ? [abandonmentReasonLabel(row.abandonmentReasonCode)]
    : row.rowState === "validation_failed"
      ? currentIssues.map((issue) => describeAgendaValidationIssue(issue.code))
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

const CORRECTABLE_ROW_STATES = new Set(["validation_failed", "approved"]);

function AgendaRowAction({
  row,
  runStatus,
  eventDateContext,
  categoryOptions,
  onRowsChanged,
  onError,
}: {
  row: AgendaImportRowResult;
  runStatus: ImportRunLifecycleStatus;
  eventDateContext: AgendaImportEventDateContext;
  categoryOptions: readonly AgendaImportCategoryOption[];
  onRowsChanged: (message: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const canEdit =
    runStatus !== "finalized" &&
    row.abandonedAt === null &&
    CORRECTABLE_ROW_STATES.has(row.rowState);
  // Delete Row is the sole "this staged row does not belong" action for
  // Agenda -- available for any not-yet-committed, not-yet-deleted row
  // regardless of validation/correction state (invalid, corrected-invalid,
  // or a valid row the operator simply decides to exclude). Committed and
  // already-abandoned rows are refused by the governed RPC itself; this
  // client hint only decides whether to render the control.
  const canDelete =
    runStatus !== "finalized" &&
    row.abandonedAt === null &&
    row.rowState !== "committed";
  const candidate = getEffectiveAgendaImportCandidate(row);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteAgendaImportRow({ rowId: row.rowId });
      setDeleteOpen(false);
      await onRowsChanged(
        `Source row ${row.sourceRowNumber} was deleted. The governed run has been refreshed.`,
      );
    } catch (err) {
      onError(describeLifecycleError(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
      {canEdit ? (
        <AppButton
          variant="secondary"
          aria-label={`Edit source row ${row.sourceRowNumber}: ${candidate.title || "Untitled Agenda row"}`}
          onClick={() => setEditOpen(true)}
        >
          Edit Row
        </AppButton>
      ) : null}
      {canDelete ? (
        <AppButton
          variant="danger"
          aria-label={`Delete source row ${row.sourceRowNumber}: ${candidate.title || "Untitled Agenda row"}`}
          onClick={() => setDeleteOpen(true)}
        >
          Delete Row
        </AppButton>
      ) : null}
      {canEdit ? (
        <AgendaEditRowDialog
          open={editOpen}
          row={row}
          eventDateContext={eventDateContext}
          categoryOptions={categoryOptions}
          onCancel={() => setEditOpen(false)}
          onSaved={async (message, shouldClose) => {
            if (shouldClose) {
              setEditOpen(false);
            }
            await onRowsChanged(message);
          }}
          onError={onError}
        />
      ) : null}
      {canDelete ? (
        <ConfirmDialog
          open={deleteOpen}
          title="Delete This Agenda Row"
          message="Delete this staged row from the current import? It will not be imported. This action cannot be undone from the review workspace."
          confirmLabel="Delete Row"
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => (deleting ? null : setDeleteOpen(false))}
        />
      ) : null}
    </div>
  );
}

type AgendaImportReviewWorkspaceProps = {
  run: AgendaImportRunResult;
  status: ImportRunLifecycleStatus;
  compact: boolean;
  committing: boolean;
  eventDateContext: AgendaImportEventDateContext;
  categoryOptions: readonly AgendaImportCategoryOption[];
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
  eventDateContext,
  categoryOptions,
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

        {summary.validationFailed > 0 && status !== "finalized" ? (
          <Alert tone="warning">
            Rows that failed validation can be corrected in place -- use Edit Row below to fix the
            values and revalidate. If a row does not belong in this import, use Delete Row instead;
            deleted rows are permanently removed and will not appear in this run's History.
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
                  <AgendaRowAction row={row} runStatus={status} eventDateContext={eventDateContext} categoryOptions={categoryOptions} onRowsChanged={onRowsChanged} onError={onError} />
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
                      <AgendaRowAction row={row} runStatus={status} eventDateContext={eventDateContext} categoryOptions={categoryOptions} onRowsChanged={onRowsChanged} onError={onError} />
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
