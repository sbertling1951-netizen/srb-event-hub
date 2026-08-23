"use client";

// Stage: Import Run Lifecycle + History UI hookup. Discovery panel for
// active (staging / ready_for_review) import runs on the selected Event,
// shared by the Attendee and Vendor doors. This component only lists and
// requests a resume -- it never recovers a run itself. Recovery stays each
// door's own concern (recoverAttendeeImportRun / recoverVendorImportRun),
// which already revalidates authority and persisted truth server-side; this
// panel only supplies the run id to resume, exactly like the existing
// localStorage locator already does, never row/commit truth.
import { useEffect, useState } from "react";

import { AppButton } from "@/components/ui/AppButton";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/StatusBadge";
import {
  type ActiveImportRunSummary,
  describeLifecycleError,
  type ImportRunLifecycleStatus,
  listActiveImportRuns,
} from "@/lib/importLifecycleOrchestration";

const STATUS_LABEL: Record<ImportRunLifecycleStatus, string> = {
  staging: "Staging",
  ready_for_review: "Ready for Review",
  finalized: "Finalized",
};

const STATUS_TONE: Record<ImportRunLifecycleStatus, StatusBadgeTone> = {
  staging: "info",
  ready_for_review: "warning",
  finalized: "success",
};

export type ActiveRunsPanelProps = {
  eventId: string;
  /** Restricts display to this door's own import_type -- list_active_import_runs
   * itself is only scoped by event_id (server-side, authoritative); this is a
   * display-only narrowing so the Attendee door doesn't offer to "resume" a
   * Vendor run it has no recovery path for, and vice versa. */
  importType: string;
  onResume: (runId: string) => void;
  resumingRunId?: string | null;
  /** Bump to force a reload (e.g. after a run in this list is finalized
   * elsewhere and should drop out of the active set). */
  reloadToken?: number | string;
};

export function ActiveRunsPanel({
  eventId,
  importType,
  onResume,
  resumingRunId = null,
  reloadToken,
}: ActiveRunsPanelProps) {
  const [runs, setRuns] = useState<ActiveImportRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) {
      setRuns([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const all = await listActiveImportRuns(eventId);
        if (cancelled) {
          return;
        }
        setRuns(all.filter((run) => run.importType === importType));
      } catch (err) {
        if (!cancelled) {
          setError(describeLifecycleError(err));
          setRuns([]);
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
  }, [eventId, importType, reloadToken]);

  if (!eventId) {
    return null;
  }

  if (loading) {
    return <LoadingState message="Checking for active import runs..." />;
  }

  if (error) {
    return <EmptyState message={error} />;
  }

  if (!runs.length) {
    return null;
  }

  return (
    <div className="card app-card-section">
      <h3 style={{ marginTop: 0 }}>
        Active Import Run{runs.length === 1 ? "" : "s"} ({runs.length})
      </h3>
      <p className="app-subtle-text" style={{ marginTop: 0 }}>
        These runs are still open on this Event. Resume one to continue reviewing or committing its rows.
      </p>
      <DataTable caption="Active import runs on this Event">
        <thead>
          <tr>
            <th>Source File</th>
            <th>Status</th>
            <th>Rows</th>
            <th>Started</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.importRunId}>
              <td>{run.sourceFilename || "—"}</td>
              <td>
                <StatusBadge tone={STATUS_TONE[run.status]}>{STATUS_LABEL[run.status]}</StatusBadge>
              </td>
              <td>
                {run.rowTotal} total • {run.committedCount} committed
                {run.abandonedCount ? ` • ${run.abandonedCount} abandoned` : ""}
              </td>
              <td>{new Date(run.createdAt).toLocaleString()}</td>
              <td>
                <AppButton
                  variant="secondary"
                  onClick={() => onResume(run.importRunId)}
                  disabled={resumingRunId === run.importRunId}
                  loading={resumingRunId === run.importRunId}
                >
                  Resume
                </AppButton>
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}
