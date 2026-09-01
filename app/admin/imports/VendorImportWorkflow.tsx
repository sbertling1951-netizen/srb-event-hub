"use client";

// Stage 5B.3: the working Vendor Import door inside the shared Imports
// Service Center. Governed path only: Stage 5B.1 normalizes
// (lib/vendorImportContract.ts), Stage 1 stages/reviews, Stage 5B.2 matches
// and commits one row at a time to its Event (commit_vendor_import_run_row),
// Stage 1.1 recovers persisted truth on reload
// (lib/vendorImportOrchestration.ts sequences all of it). This component
// holds no matching/admission/metadata authority of its own -- every
// mutation goes through those governed RPCs, and the server's own outcome
// is always what gets shown.
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import { Alert } from "@/components/ui/Alert";
import { AppButton, AppLinkButton } from "@/components/ui/AppButton";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Select } from "@/components/ui/Field";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/StatusBadge";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { canAccessEvent } from "@/lib/getCurrentAdminAccess";
import type { ImportRunLifecycleStatus } from "@/lib/importLifecycleOrchestration";
import {
  EVENT_SCOPED_STORAGE_KEYS,
  TIER5_EVENT_SCOPED_MIGRATION_SOURCE_KEYS,
} from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";
import { readAndMigrateTier5LocalStorage } from "@/lib/tier5StorageMigration";
import {
  classifyVendorFileAmbiguities,
  interpretVendorImportRow,
  type RawVendorImportRow,
  type VendorImportInterpretation,
} from "@/lib/vendorImportContract";
import {
  describeVendorReviewReason,
  recoverVendorImportRun,
  retryVendorImportRowCommit,
  runGovernedVendorImport,
  summarizeVendorImportRows,
  type VendorImportRowResult,
  type VendorImportRunResult,
  vendorReviewRequiresIdentityWork,
} from "@/lib/vendorImportOrchestration";

import { ActiveRunsPanel } from "./ActiveRunsPanel";
import { TemplateDownloadList,type TemplateFile } from "./importDoorTemplates";
import { ImportHistoryPanel } from "./ImportHistoryPanel";
import { AbandonRowButton, RunLifecycleActions } from "./RunLifecycleActions";

type VendorEventOption = {
  id: string;
  name: string | null;
  location?: string | null;
  start_date?: string | null;
};

// Locator only -- the run ID conveys no authority. On reload,
// get_managed_import_run_recovery revalidates authority and returns the
// actual persisted row states; nothing about matching/commit truth is ever
// read back out of localStorage.
function activeVendorRunStorageKey(eventId: string) {
  return EVENT_SCOPED_STORAGE_KEYS.vendorImportRun(eventId);
}

function loadActiveVendorRunId(eventId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return readAndMigrateTier5LocalStorage(
      activeVendorRunStorageKey(eventId),
      TIER5_EVENT_SCOPED_MIGRATION_SOURCE_KEYS.vendorImportRun(eventId),
    );
  } catch {
    return null;
  }
}

function saveActiveVendorRunId(eventId: string, runId: string | null) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (runId) {
      localStorage.setItem(activeVendorRunStorageKey(eventId), runId);
    } else {
      localStorage.removeItem(activeVendorRunStorageKey(eventId));
    }
  } catch {
    // ignore storage errors
  }
}

const ROW_STATE_TONE: Record<VendorImportRowResult["rowState"], StatusBadgeTone> = {
  validation_failed: "danger",
  needs_review: "warning",
  approved: "info",
  committed: "success",
  commit_failed: "danger",
};

const ROW_STATE_LABEL: Record<VendorImportRowResult["rowState"], string> = {
  validation_failed: "Validation Failed",
  needs_review: "Needs Review",
  approved: "Ready",
  committed: "Committed",
  commit_failed: "Commit Failed",
};

function rowDetail(row: VendorImportRowResult): string {
  if (row.rowState === "commit_failed" && row.commitError) {
    return row.commitError.message;
  }
  if (row.rowState === "needs_review") {
    return describeVendorReviewReason(row.reviewReasonCode);
  }
  if (row.rowState === "validation_failed") {
    return row.issues.map((issue) => issue.message).join("; ") || "Validation failed.";
  }
  if (row.rowState === "committed") {
    return "Committed to this Event.";
  }
  const warnings = row.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message);
  return warnings.join("; ") || "—";
}

export function VendorImportWorkflow({ templateFiles }: { templateFiles: TemplateFile[] }) {
  const { admin, loading: adminLoading } = useAdmin();

  const [availableEvents, setAvailableEvents] = useState<VendorEventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [loadedForEventId, setLoadedForEventId] = useState("");
  const [loadingEvents, setLoadingEvents] = useState(true);

  const [rawRows, setRawRows] = useState<RawVendorImportRow[]>([]);
  const [previews, setPreviews] = useState<VendorImportInterpretation[]>([]);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);

  const [importing, setImporting] = useState(false);
  const [runResult, setRunResult] = useState<VendorImportRunResult | null>(null);
  const [runStatus, setRunStatus] = useState<ImportRunLifecycleStatus | null>(null);
  const [retryingRowId, setRetryingRowId] = useState<string | null>(null);
  const [resumingRunId, setResumingRunId] = useState<string | null>(null);
  const [activeRunsReloadToken, setActiveRunsReloadToken] = useState(0);

  const [status, setStatus] = useState("Select a target Event, then load a CSV or XLSX file to begin.");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      setLoadingEvents(true);
      setError(null);

      if (adminLoading) {
        setLoadingEvents(false);
        return;
      }

      if (!admin) {
        setAvailableEvents([]);
        setSelectedEventId("");
        setStatus("No admin access.");
        setLoadingEvents(false);
        return;
      }

      try {
        const { data, error: eventsError } = await supabase
          .from("events")
          .select("id, name, location, start_date")
          .order("start_date", { ascending: false });
        if (eventsError) {
          throw eventsError;
        }
        if (cancelled) {
          return;
        }

        const accessible = ((data || []) as VendorEventOption[]).filter(
          (event) => !!event.id && canAccessEvent(admin, event.id),
        );
        setAvailableEvents(accessible);

        const stored = getCurrentAdminEvent();
        if (stored?.id && canAccessEvent(admin, stored.id)) {
          setSelectedEventId(stored.id);
        } else if (accessible.length > 0) {
          setSelectedEventId(accessible[0].id);
        } else {
          setSelectedEventId("");
          setStatus("No accessible Events available for Vendor import.");
        }
      } catch (err) {
        console.error("VendorImportWorkflow: could not load events", err);
        if (!cancelled) {
          setAvailableEvents([]);
          setSelectedEventId("");
          setStatus("Could not load Events.");
        }
      } finally {
        if (!cancelled) {
          setLoadingEvents(false);
        }
      }
    }

    void loadEvents();
    const unsubscribe = subscribeToAdminWorkspace(() => void loadEvents());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [admin, adminLoading]);

  // Reload recovery: only the run ID is a browser locator. Stage 1.1
  // revalidates authority and returns the actual persisted row states
  // (including the run's own lifecycle status -- see recovered.run.status
  // below -- so this single governed call is sufficient; no separate
  // view-gated status lookup is needed to resume).
  useEffect(() => {
    if (!selectedEventId) {
      setRunResult(null);
      setRunStatus(null);
      return;
    }

    const storedRunId = loadActiveVendorRunId(selectedEventId);
    if (!storedRunId) {
      setRunResult(null);
      setRunStatus(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const recovered = await recoverVendorImportRun(storedRunId);
        if (cancelled) {
          return;
        }
        setRunResult({
          runId: recovered.run.id,
          eventId: recovered.run.eventId,
          sourceFilename: recovered.run.sourceFilename,
          rows: recovered.rows,
        });
        setRunStatus(recovered.run.status as ImportRunLifecycleStatus);
        setStatus(`Recovered Vendor import run from ${recovered.run.sourceFilename || "a prior session"}.`);
      } catch (err) {
        console.error("VendorImportWorkflow: could not recover import run", err);
        if (!cancelled) {
          saveActiveVendorRunId(selectedEventId, null);
          setRunResult(null);
          setRunStatus(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedEventId]);

  // Explicit resume from the Active Runs panel -- same governed recovery
  // path as the mount effect above, triggered by an admin's choice rather
  // than a stored locator.
  async function handleResumeRun(runId: string) {
    if (!selectedEventId) {
      return;
    }
    setResumingRunId(runId);
    setError(null);
    try {
      const recovered = await recoverVendorImportRun(runId);
      setRunResult({
        runId: recovered.run.id,
        eventId: recovered.run.eventId,
        sourceFilename: recovered.run.sourceFilename,
        rows: recovered.rows,
      });
      setRunStatus(recovered.run.status as ImportRunLifecycleStatus);
      saveActiveVendorRunId(selectedEventId, runId);
      setStatus(`Resumed Vendor import run from ${recovered.run.sourceFilename || "a prior session"}.`);
    } catch (err: any) {
      console.error("VendorImportWorkflow: could not resume import run", err);
      setError(err?.message || "Could not resume import run.");
    } finally {
      setResumingRunId(null);
    }
  }

  const eventChangedSinceLoad =
    !!previews.length && !!loadedForEventId && !!selectedEventId && loadedForEventId !== selectedEventId;

  const duplicateBusinessNames = useMemo(() => classifyVendorFileAmbiguities(previews), [previews]);

  const validPreviewCount = useMemo(
    () => previews.filter((p) => p.validation_state === "valid").length,
    [previews],
  );

  async function handleFileChange(file: File) {
    if (!selectedEventId) {
      setError("Select a target Event before loading a file.");
      return;
    }

    setParsing(true);
    setError(null);
    setStatus(`Reading ${file.name}...`);
    setFileName(file.name);
    setRunResult(null);
    setRunStatus(null);
    saveActiveVendorRunId(selectedEventId, null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<RawVendorImportRow>(worksheet, { defval: "", raw: false });

      if (!json.length) {
        setRawRows([]);
        setPreviews([]);
        setLoadedForEventId("");
        setStatus("No rows found in file.");
        return;
      }

      const parsed = json.map((row, index) => interpretVendorImportRow(row, index + 2));
      setRawRows(json);
      setPreviews(parsed);
      setLoadedForEventId(selectedEventId);
      setStatus(`Loaded ${parsed.length} row${parsed.length === 1 ? "" : "s"} from ${file.name}.`);
    } catch (err) {
      console.error("VendorImportWorkflow: could not parse file", err);
      setError("Could not parse file.");
      setRawRows([]);
      setPreviews([]);
      setLoadedForEventId("");
      setStatus("Parse failed.");
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!selectedEventId) {
      setError("No target Event selected.");
      return;
    }
    if (eventChangedSinceLoad) {
      setError("Target Event changed after file load. Reload the file first.");
      return;
    }
    if (!rawRows.length) {
      setError("No rows to import.");
      return;
    }

    setImporting(true);
    setError(null);
    setRunResult(null);
    setRunStatus(null);
    setStatus("Creating governed Vendor import run...");

    try {
      const result = await runGovernedVendorImport({
        eventId: selectedEventId,
        sourceFilename: fileName || null,
        rows: rawRows,
      });

      setRunResult(result);
      setRunStatus("staging");
      saveActiveVendorRunId(selectedEventId, result.runId);
      setActiveRunsReloadToken((t) => t + 1);

      const summary = summarizeVendorImportRows(result.rows);
      const eventLabel = availableEvents.find((e) => e.id === selectedEventId)?.name || "the selected Event";
      setStatus(
        `Processed ${summary.processed} row${summary.processed === 1 ? "" : "s"} into ${eventLabel}: ` +
          `${summary.committed} committed, ${summary.needsReview} need review, ` +
          `${summary.validationFailed} failed validation, ${summary.commitFailed} failed to commit` +
          (summary.warnings ? `, ${summary.warnings} with warnings.` : "."),
      );
    } catch (err: any) {
      console.error("VendorImportWorkflow: import failed", err);
      setError(err?.message || "Import failed.");
      setStatus("Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function handleRetry(row: VendorImportRowResult) {
    setRetryingRowId(row.rowId);
    setError(null);

    try {
      const outcome = await retryVendorImportRowCommit({ rowId: row.rowId });
      setRunResult((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          rows: prev.rows.map((r) =>
            r.rowId === row.rowId
              ? {
                  ...r,
                  rowState: outcome.rowState,
                  canonicalVendorId: outcome.canonicalVendorId,
                  reviewReasonCode: outcome.reviewReasonCode,
                  commitError: outcome.commitError,
                }
              : r,
          ),
        };
      });
    } catch (err: any) {
      console.error("VendorImportWorkflow: retry failed", err);
      setError(err?.message || "Retry failed.");
    } finally {
      setRetryingRowId(null);
    }
  }

  function handleRowAbandoned(
    rowId: string,
    overlay: { abandonedAt: string; abandonedByAuthUserId: string; abandonmentReasonCode: string },
  ) {
    setRunResult((prev) =>
      prev
        ? { ...prev, rows: prev.rows.map((r) => (r.rowId === rowId ? { ...r, ...overlay } : r)) }
        : prev,
    );
  }

  // abandon_import_run_open_rows returns only a count, not per-row detail
  // (by design -- see lib/importLifecycleOrchestration.ts), so the rows
  // table is refreshed from the same governed recovery path used
  // everywhere else, rather than guessing which rows changed client-side.
  async function handleOpenRowsAbandoned() {
    if (!runResult) {
      return;
    }
    try {
      const recovered = await recoverVendorImportRun(runResult.runId);
      setRunResult({
        runId: recovered.run.id,
        eventId: recovered.run.eventId,
        sourceFilename: recovered.run.sourceFilename,
        rows: recovered.rows,
      });
      setStatus("Remaining open rows abandoned.");
    } catch (err: any) {
      console.error("VendorImportWorkflow: could not refresh after abandoning open rows", err);
      setError(err?.message || "Rows were abandoned, but the results could not be refreshed. Reload to see the current state.");
    }
  }

  function handleStagingClosed(newStatus: ImportRunLifecycleStatus) {
    setRunStatus(newStatus);
    setStatus("Source staging closed. This run is now ready for review.");
  }

  function handleFinalized(result: { status: ImportRunLifecycleStatus; finalizedAt: string | null; finalizedByAuthUserId: string | null }) {
    setRunStatus(result.status);
    setStatus("This run has been finalized and moved to Import History.");
    if (selectedEventId) {
      saveActiveVendorRunId(selectedEventId, null);
    }
    setRunResult(null);
    setActiveRunsReloadToken((t) => t + 1);
  }

  const selectedEvent = availableEvents.find((e) => e.id === selectedEventId) || null;
  const summary = runResult ? summarizeVendorImportRows(runResult.rows) : null;

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <div className="card app-card-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 className="app-section-title" style={{ margin: 0 }}>Vendor Import</h2>
            <p className="app-subtle-text" style={{ margin: "4px 0 0" }}>
              Governed workflow: Stage 5B.1 normalize → Stage 1 stage → Stage 5B.2 canonical Event-domain
              commit → Stage 1.1 recovery. No file uploaded here can create, edit, or reactivate a
              canonical Vendor -- only an existing active Vendor may be matched.
            </p>
          </div>
          <AppLinkButton variant="tertiary" href="/admin/imports">
            Back to Imports
          </AppLinkButton>
        </div>

        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Templates</summary>
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            <TemplateDownloadList files={templateFiles} />
          </div>
        </details>

        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          <Field label="Target Event" required>
            {(controlProps) => (
              <Select
                {...controlProps}
                value={selectedEventId}
                disabled={loadingEvents}
                onChange={(e) => setSelectedEventId(e.target.value)}
              >
                <option value="">Select an Event</option>
                {availableEvents.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name || "Untitled Event"}
                    {event.location ? ` • ${event.location}` : ""}
                    {event.start_date ? ` • ${event.start_date}` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Vendor CSV or XLSX file">
            {(controlProps) => (
              <input
                {...controlProps}
                type="file"
                accept=".csv,.xlsx,.xls"
                disabled={loadingEvents || !selectedEventId}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void handleFileChange(file);
                  }
                }}
              />
            )}
          </Field>

          {fileName ? (
            <div className="app-subtle-text" style={{ fontSize: 14 }}>
              Loaded file: <strong>{fileName}</strong>
            </div>
          ) : null}

          <div style={{ fontSize: 14 }}>{status}</div>

          {error ? <Alert tone="danger">{error}</Alert> : null}
          {eventChangedSinceLoad ? (
            <Alert tone="warning">
              Target Event changed after file load. Reload the file before importing to avoid importing
              into the wrong Event.
            </Alert>
          ) : null}

          {duplicateBusinessNames.length ? (
            <Alert tone="warning">
              {duplicateBusinessNames.length} Business Name{duplicateBusinessNames.length === 1 ? "" : "s"}{" "}
              appear{duplicateBusinessNames.length === 1 ? "s" : ""} more than once in this file. Every
              implicated row will be staged for review rather than guessed -- this is decided server-side
              by Stage 5B.2, not this preview.
            </Alert>
          ) : null}

          <div className="app-button-row">
            <AppButton
              variant="primary"
              onClick={() => void handleImport()}
              disabled={importing || parsing || !selectedEventId || !rawRows.length || eventChangedSinceLoad}
              loading={importing}
            >
              {importing ? "Importing..." : "Import Vendors"}
            </AppButton>
          </div>
        </div>
      </div>

      {selectedEventId ? (
        <ActiveRunsPanel
          eventId={selectedEventId}
          importType="vendor"
          onResume={(runId) => void handleResumeRun(runId)}
          resumingRunId={resumingRunId}
          reloadToken={activeRunsReloadToken}
        />
      ) : null}

      {previews.length ? (
        <div className="card app-card-section">
          <h3 style={{ marginTop: 0 }}>
            Row Preview ({validPreviewCount} of {previews.length} valid)
          </h3>
          <DataTable caption="Vendor import row preview">
            <thead>
              <tr>
                <th>Row</th>
                <th>Business Name</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Admit?</th>
                <th>Warnings</th>
              </tr>
            </thead>
            <tbody>
              {previews.map((preview) => (
                <tr key={preview.candidate.source_row_number}>
                  <td>{preview.candidate.source_row_number}</td>
                  <td>{preview.candidate.identity_evidence.business_name || "—"}</td>
                  <td>{preview.candidate.identity_evidence.contact_name || "—"}</td>
                  <td>{preview.candidate.identity_evidence.email || "—"}</td>
                  <td>
                    {preview.candidate.event_intent.admit === true
                      ? "Yes"
                      : preview.candidate.event_intent.admit === false
                        ? "No"
                        : "—"}
                  </td>
                  <td>
                    {preview.issues.length
                      ? preview.issues.map((issue) => issue.message).join("; ")
                      : "None"}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      ) : null}

      {runResult && summary ? (
        <div className="card app-card-section">
          <h3 style={{ marginTop: 0 }}>Governed Import Results</h3>
          <div className="app-subtle-text" style={{ fontSize: 13, marginBottom: 14 }}>
            Run {runResult.runId}
            {runResult.sourceFilename ? ` • ${runResult.sourceFilename}` : ""}
          </div>

          {runStatus ? (
            <RunLifecycleActions
              runId={runResult.runId}
              status={runStatus}
              rows={runResult.rows}
              onStagingClosed={handleStagingClosed}
              onOpenRowsAbandoned={() => void handleOpenRowsAbandoned()}
              onFinalized={handleFinalized}
              onError={(message) => setError(message)}
            />
          ) : null}

          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              marginBottom: 16,
            }}
          >
            {[
              { label: "Processed", value: summary.processed },
              { label: "Committed", value: summary.committed },
              { label: "Needs Review", value: summary.needsReview },
              { label: "Validation Failed", value: summary.validationFailed },
              { label: "Commit Failed", value: summary.commitFailed },
              { label: "Warnings", value: summary.warnings },
            ].map((tile) => (
              <div key={tile.label} className="app-card-section" style={{ padding: 12 }}>
                <div className="app-subtle-text" style={{ fontSize: 12 }}>{tile.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{tile.value}</div>
              </div>
            ))}
          </div>

          {summary.committed > 0 && summary.committed === summary.processed ? (
            <Alert tone="success">All {summary.processed} rows committed.</Alert>
          ) : summary.committed > 0 ? (
            <Alert tone="warning">
              {summary.committed} of {summary.processed} rows committed. Review the remaining rows below --
              this is not a full success.
            </Alert>
          ) : null}

          <DataTable caption="Vendor import results">
            <thead>
              <tr>
                <th>Row</th>
                <th>Business Name</th>
                <th>State</th>
                <th>Detail</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {runResult.rows.map((row) => (
                <tr key={row.rowId}>
                  <td>{row.sourceRowNumber}</td>
                  <td>{row.candidate?.identity_evidence?.business_name || "—"}</td>
                  <td>
                    <StatusBadge tone={ROW_STATE_TONE[row.rowState]}>
                      {ROW_STATE_LABEL[row.rowState]}
                    </StatusBadge>
                  </td>
                  <td>{rowDetail(row)}</td>
                  <td>
                    <div className="row-actions">
                      {row.rowState === "commit_failed" ? (
                        <AppButton
                          variant="secondary"
                          onClick={() => void handleRetry(row)}
                          disabled={retryingRowId === row.rowId}
                          loading={retryingRowId === row.rowId}
                        >
                          Retry
                        </AppButton>
                      ) : null}
                      {row.rowState === "needs_review" && vendorReviewRequiresIdentityWork(row.reviewReasonCode) ? (
                        <AppLinkButton variant="tertiary" href="/admin/vendors">
                          Open Vendor Workspace
                        </AppLinkButton>
                      ) : null}
                      {row.rowState === "needs_review" && !vendorReviewRequiresIdentityWork(row.reviewReasonCode)
                        ? "—"
                        : null}
                      {row.rowState === "committed" || row.rowState === "validation_failed"
                        ? "—"
                        : null}
                      <AbandonRowButton
                        row={row}
                        onAbandoned={handleRowAbandoned}
                        onError={(message) => setError(message)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      ) : null}

      {loadingEvents ? <LoadingState message="Loading Events..." /> : null}
      {!loadingEvents && !availableEvents.length ? (
        <EmptyState message="No accessible Events available for Vendor import." />
      ) : null}

      {selectedEventId ? <ImportHistoryPanel eventId={selectedEventId} importType="vendor" /> : null}

      {selectedEvent ? (
        <div className="app-subtle-text" style={{ fontSize: 12 }}>
          Target Event: {selectedEvent.name || "Untitled Event"}
          {selectedEvent.location ? ` • ${selectedEvent.location}` : ""}
        </div>
      ) : null}
    </div>
  );
}
