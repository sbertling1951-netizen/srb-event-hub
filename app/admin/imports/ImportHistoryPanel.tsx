"use client";

// Stage: Import Run Lifecycle + History UI hookup. Read-only Import
// History browser (finalized runs only) shared by the Attendee and
// Vendor doors. list_finalized_import_run_history / get_finalized_import_run_history_detail
// are gated by event.imports.view -- a distinct, non-implying authority
// from event.imports.manage (which gates every mutation elsewhere on
// this page). An admin who can manage imports but cannot view History is
// an expected, legitimate configuration, not a malfunction: this panel
// hides itself silently on that specific denial rather than surfacing an
// alarming error for a normal authority boundary.
import { useEffect, useState } from "react";

import { AppButton } from "@/components/ui/AppButton";
import { DataTable } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  describeFinalOutcome,
  describeLifecycleError,
  type FinalizedImportRunDetail,
  type FinalizedImportRunSummary,
  getFinalizedImportRunHistoryDetail,
  listFinalizedImportRunHistory,
} from "@/lib/importLifecycleOrchestration";

function isAuthorityDenial(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  const message = (err as { message?: string } | null)?.message;
  return message === "not_authorized" || code === "42501";
}

const DISPOSITION_TONE: Record<string, "success" | "danger" | "neutral"> = {
  committed: "success",
  validation_failed: "danger",
  abandoned: "danger",
  legacy_unresolved: "neutral",
};

const DISPOSITION_LABEL: Record<string, string> = {
  committed: "Committed",
  validation_failed: "Validation Failed",
  abandoned: "Abandoned",
  legacy_unresolved: "Legacy Unresolved",
};

function RunDetailDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<FinalizedImportRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await getFinalizedImportRunHistoryDetail(runId);
        if (!cancelled) {
          setDetail(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(describeLifecycleError(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const outcome = detail ? describeFinalOutcome(detail.run.finalOutcome) : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Finalized Import Run"
      className="app-dialog-wide"
      footer={<AppButton onClick={onClose}>Close</AppButton>}
    >
      {loading ? <LoadingState message="Loading run detail..." /> : null}
      {error ? <EmptyState message={error} /> : null}
      {detail ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="app-subtle-text" style={{ fontSize: 13 }}>
            {detail.run.sourceFilename || "—"} • Finalized {new Date(detail.run.finalizedAt).toLocaleString()}
          </div>
          {outcome ? <StatusBadge tone={outcome.tone}>{outcome.label}</StatusBadge> : null}
          <DataTable caption="Finalized run rows">
            <thead>
              <tr>
                <th>Row</th>
                <th>Disposition</th>
                <th>Detail</th>
                <th>Committed / Abandoned</th>
              </tr>
            </thead>
            <tbody>
              {detail.rows.map((row) => (
                <tr key={row.sourceRowNumber}>
                  <td>{row.sourceRowNumber}</td>
                  <td>
                    <StatusBadge tone={DISPOSITION_TONE[row.terminalDisposition] ?? "neutral"}>
                      {DISPOSITION_LABEL[row.terminalDisposition] ?? row.terminalDisposition}
                    </StatusBadge>
                  </td>
                  <td>
                    {row.terminalDisposition === "validation_failed"
                      ? row.validationCodes.map((c) => c.code).join("; ") || "—"
                      : row.terminalDisposition === "abandoned"
                        ? row.abandonmentReasonCode || "—"
                        : row.commitFailureCode || "—"}
                  </td>
                  <td>
                    {row.committedAt
                      ? new Date(row.committedAt).toLocaleString()
                      : row.abandonedAt
                        ? new Date(row.abandonedAt).toLocaleString()
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      ) : null}
    </Dialog>
  );
}

export type ImportHistoryPanelProps = {
  eventId: string;
  importType: string;
};

export function ImportHistoryPanel({ eventId, importType }: ImportHistoryPanelProps) {
  const [runs, setRuns] = useState<FinalizedImportRunSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);

  async function loadHistory(before?: { finalizedAt: string; importRunId: string } | null) {
    setLoading(true);
    setError(null);
    try {
      const page = await listFinalizedImportRunHistory(eventId, before ?? null, 50);
      setRuns((prev) => (before ? [...prev, ...page.filter((r) => r.importType === importType)] : page.filter((r) => r.importType === importType)));
      setHasMore(page.length === 50);
      setHidden(false);
    } catch (err) {
      if (isAuthorityDenial(err)) {
        setHidden(true);
      } else {
        setError(describeLifecycleError(err));
      }
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }

  if (!eventId) {
    return null;
  }

  if (hidden) {
    return null;
  }

  return (
    <div className="card app-card-section">
      <details onToggle={(e) => (e.currentTarget.open && !loaded ? void loadHistory() : undefined)}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Import History</summary>
        <div style={{ marginTop: 12 }}>
          {loading && !runs.length ? <LoadingState message="Loading Import History..." /> : null}
          {error ? <EmptyState message={error} /> : null}
          {!loading && loaded && !runs.length && !error ? (
            <EmptyState message="No finalized import runs yet for this door on this Event." />
          ) : null}
          {runs.length ? (
            <DataTable caption="Finalized import run history">
              <thead>
                <tr>
                  <th>Source File</th>
                  <th>Outcome</th>
                  <th>Rows</th>
                  <th>Finalized</th>
                  <th>Finalized By</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const outcome = describeFinalOutcome(run.finalOutcome);
                  return (
                    <tr key={run.importRunId}>
                      <td>{run.sourceFilename || "—"}</td>
                      <td>
                        <StatusBadge tone={outcome.tone}>{outcome.label}</StatusBadge>
                      </td>
                      <td>
                        {run.rowTotal} total • {run.committedCount} committed
                        {run.abandonedCount ? ` • ${run.abandonedCount} abandoned` : ""}
                      </td>
                      <td>{new Date(run.finalizedAt).toLocaleString()}</td>
                      <td>{run.finalizedByDisplayIdentity || "—"}</td>
                      <td>
                        <AppButton variant="tertiary" onClick={() => setViewingRunId(run.importRunId)}>
                          View
                        </AppButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          ) : null}
          {hasMore && runs.length ? (
            <div className="app-button-row" style={{ marginTop: 12 }}>
              <AppButton
                variant="secondary"
                loading={loading}
                onClick={() => {
                  const last = runs[runs.length - 1];
                  void loadHistory({ finalizedAt: last.finalizedAt, importRunId: last.importRunId });
                }}
              >
                Load More
              </AppButton>
            </div>
          ) : null}
        </div>
      </details>
      {viewingRunId ? <RunDetailDialog runId={viewingRunId} onClose={() => setViewingRunId(null)} /> : null}
    </div>
  );
}
