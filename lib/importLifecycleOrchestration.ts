// Stage: Import Run Lifecycle + History application layer. Thin client
// orchestration over the governed 20260822170000 lifecycle RPCs
// (close_import_run_staging, abandon_import_run_row,
// abandon_import_run_open_rows, finalize_import_run,
// list_active_import_runs, list_finalized_import_run_history,
// get_finalized_import_run_history_detail) plus the derived-outcome
// vocabulary those RPCs already compute server-side. This module is
// import-type-agnostic -- run lifecycle/History belong to the Imports
// domain, not to Attendee or Vendor specifically -- and is shared by both
// governed doors rather than duplicated. It owns no lifecycle rule of its
// own: every state transition, terminality check, and authority decision
// is made server-side; this module only calls the RPC and shapes its
// response for display.

import { supabase } from "@/lib/supabase";

export type ImportRunLifecycleStatus = "staging" | "ready_for_review" | "finalized";

export type AbandonmentReasonCode =
  | "operator_declined"
  | "source_superseded"
  | "duplicate_intentionally_dismissed"
  | "cannot_resolve"
  | "other";

export const ABANDONMENT_REASON_OPTIONS: { code: AbandonmentReasonCode; label: string }[] = [
  { code: "operator_declined", label: "Operator declined this row" },
  { code: "source_superseded", label: "Source data was superseded" },
  { code: "duplicate_intentionally_dismissed", label: "Duplicate, intentionally dismissed" },
  { code: "cannot_resolve", label: "Cannot be resolved" },
  { code: "other", label: "Other" },
];

export type ImportRunFinalOutcome = "completed" | "completed_with_errors" | "abandoned" | "mixed";

export function describeFinalOutcome(outcome: string | null): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  switch (outcome) {
    case "completed":
      return { label: "Completed", tone: "success" };
    case "completed_with_errors":
      return { label: "Completed with Errors", tone: "warning" };
    case "abandoned":
      return { label: "Abandoned", tone: "danger" };
    case "mixed":
      return { label: "Mixed", tone: "warning" };
    default:
      return { label: "Not yet finalized", tone: "neutral" };
  }
}

export type ActiveImportRunSummary = {
  importRunId: string;
  importType: string;
  sourceFilename: string | null;
  createdByDisplayIdentity: string | null;
  createdAt: string;
  status: ImportRunLifecycleStatus;
  rowTotal: number;
  parsedCount: number;
  validationFailedCount: number;
  needsReviewCount: number;
  approvedCount: number;
  committedCount: number;
  commitFailedCount: number;
  abandonedCount: number;
};

export type FinalizedImportRunSummary = {
  importRunId: string;
  importType: string;
  sourceFilename: string | null;
  createdByDisplayIdentity: string | null;
  finalizedByDisplayIdentity: string | null;
  createdAt: string;
  finalizedAt: string;
  rowTotal: number;
  committedCount: number;
  validationFailedCount: number;
  abandonedCount: number;
  finalOutcome: ImportRunFinalOutcome;
};

export type FinalizedImportRunRowDetail = {
  sourceRowNumber: number;
  terminalDisposition: "committed" | "validation_failed" | "abandoned" | "legacy_unresolved";
  validationCodes: { code: string }[];
  abandonmentReasonCode: string | null;
  commitState: string;
  commitFailureCode: string | null;
  canonicalTargetId: string | null;
  createdAt: string;
  updatedAt: string;
  committedAt: string | null;
  abandonedAt: string | null;
};

export type FinalizedImportRunDetail = {
  run: {
    id: string;
    eventId: string;
    importType: string;
    sourceFilename: string | null;
    status: string;
    createdAt: string;
    finalizedAt: string;
    finalOutcome: ImportRunFinalOutcome;
  };
  rows: FinalizedImportRunRowDetail[];
};

export async function listActiveImportRuns(eventId: string): Promise<ActiveImportRunSummary[]> {
  const { data, error } = await supabase.rpc("list_active_import_runs", { p_event_id: eventId });
  if (error) {
    throw error;
  }
  return ((data || []) as any[]).map((r) => ({
    importRunId: r.import_run_id,
    importType: r.import_type,
    sourceFilename: r.source_filename,
    createdByDisplayIdentity: r.created_by_display_identity,
    createdAt: r.created_at,
    status: r.status,
    rowTotal: Number(r.row_total ?? 0),
    parsedCount: Number(r.parsed_count ?? 0),
    validationFailedCount: Number(r.validation_failed_count ?? 0),
    needsReviewCount: Number(r.needs_review_count ?? 0),
    approvedCount: Number(r.approved_count ?? 0),
    committedCount: Number(r.committed_count ?? 0),
    commitFailedCount: Number(r.commit_failed_count ?? 0),
    abandonedCount: Number(r.abandoned_count ?? 0),
  }));
}

export async function listFinalizedImportRunHistory(
  eventId: string,
  before?: { finalizedAt: string; importRunId: string } | null,
  limit = 50,
): Promise<FinalizedImportRunSummary[]> {
  const { data, error } = await supabase.rpc("list_finalized_import_run_history", {
    p_event_id: eventId,
    p_before_finalized_at: before?.finalizedAt ?? null,
    p_before_import_run_id: before?.importRunId ?? null,
    p_limit: limit,
  });
  if (error) {
    throw error;
  }
  return ((data || []) as any[]).map((r) => ({
    importRunId: r.import_run_id,
    importType: r.import_type,
    sourceFilename: r.source_filename,
    createdByDisplayIdentity: r.created_by_display_identity,
    finalizedByDisplayIdentity: r.finalized_by_display_identity,
    createdAt: r.created_at,
    finalizedAt: r.finalized_at,
    rowTotal: Number(r.row_total ?? 0),
    committedCount: Number(r.committed_count ?? 0),
    validationFailedCount: Number(r.validation_failed_count ?? 0),
    abandonedCount: Number(r.abandoned_count ?? 0),
    finalOutcome: r.final_outcome,
  }));
}

export async function getFinalizedImportRunHistoryDetail(runId: string): Promise<FinalizedImportRunDetail> {
  const { data, error } = await supabase.rpc("get_finalized_import_run_history_detail", {
    p_import_run_id: runId,
  });
  if (error) {
    throw error;
  }
  const run = data.run;
  const rows: FinalizedImportRunRowDetail[] = (data.rows || []).map((r: any) => ({
    sourceRowNumber: r.source_row_number,
    terminalDisposition: r.terminal_disposition,
    validationCodes: r.validation_codes || [],
    abandonmentReasonCode: r.abandonment_reason_code,
    commitState: r.commit_state,
    commitFailureCode: r.commit_failure_code,
    canonicalTargetId: r.canonical_target_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    committedAt: r.committed_at,
    abandonedAt: r.abandoned_at,
  }));
  return {
    run: {
      id: run.id,
      eventId: run.event_id,
      importType: run.import_type,
      sourceFilename: run.source_filename,
      status: run.status,
      createdAt: run.created_at,
      finalizedAt: run.finalized_at,
      finalOutcome: run.final_outcome,
    },
    rows,
  };
}

export type ImportRunStatus = {
  importRunId: string;
  eventId: string;
  importType: string;
  sourceFilename: string | null;
  status: ImportRunLifecycleStatus;
  createdAt: string;
  finalizedAt: string | null;
  finalizedByDisplayIdentity: string | null;
  rowTotal: number;
  parsedCount: number;
  validationFailedCount: number;
  needsReviewCount: number;
  approvedCount: number;
  committedCount: number;
  commitFailedCount: number;
  abandonedCount: number;
  finalOutcome: ImportRunFinalOutcome | null;
};

/**
 * Single-run status with the server-derived final outcome, gated by
 * event.imports.view (distinct from list_active_import_runs, which is
 * event.imports.manage). Used to show the derived outcome right after a
 * successful finalize -- a caller who can finalize but cannot view (an
 * event.imports.manage-only grant) legitimately cannot see this, and
 * callers must treat that denial as expected, not an error.
 */
export async function getImportRunStatus(runId: string): Promise<ImportRunStatus> {
  const { data, error } = await supabase.rpc("get_import_run_status", { p_import_run_id: runId });
  if (error) {
    throw error;
  }
  const r = Array.isArray(data) ? data[0] : data;
  return {
    importRunId: r.import_run_id,
    eventId: r.event_id,
    importType: r.import_type,
    sourceFilename: r.source_filename,
    status: r.status,
    createdAt: r.created_at,
    finalizedAt: r.finalized_at,
    finalizedByDisplayIdentity: r.finalized_by_display_identity,
    rowTotal: Number(r.row_total ?? 0),
    parsedCount: Number(r.parsed_count ?? 0),
    validationFailedCount: Number(r.validation_failed_count ?? 0),
    needsReviewCount: Number(r.needs_review_count ?? 0),
    approvedCount: Number(r.approved_count ?? 0),
    committedCount: Number(r.committed_count ?? 0),
    commitFailedCount: Number(r.commit_failed_count ?? 0),
    abandonedCount: Number(r.abandoned_count ?? 0),
    finalOutcome: r.final_outcome,
  };
}

export async function closeImportRunStaging(runId: string): Promise<{ status: ImportRunLifecycleStatus }> {
  const { data, error } = await supabase.rpc("close_import_run_staging", { p_import_run_id: runId });
  if (error) {
    throw error;
  }
  return { status: data.status };
}

export async function abandonImportRunRow(
  rowId: string,
  reasonCode: AbandonmentReasonCode,
): Promise<{ rowId: string; abandonedAt: string; abandonedByAuthUserId: string; abandonmentReasonCode: string }> {
  const { data, error } = await supabase.rpc("abandon_import_run_row", {
    p_import_run_row_id: rowId,
    p_abandonment_reason_code: reasonCode,
  });
  if (error) {
    throw error;
  }
  return {
    rowId: data.id,
    abandonedAt: data.abandoned_at,
    abandonedByAuthUserId: data.abandoned_by_auth_user_id,
    abandonmentReasonCode: data.abandonment_reason_code,
  };
}

export async function abandonImportRunOpenRows(runId: string, reasonCode: AbandonmentReasonCode): Promise<number> {
  const { data, error } = await supabase.rpc("abandon_import_run_open_rows", {
    p_import_run_id: runId,
    p_abandonment_reason_code: reasonCode,
  });
  if (error) {
    throw error;
  }
  return Number(data ?? 0);
}

export async function finalizeImportRun(
  runId: string,
): Promise<{ status: ImportRunLifecycleStatus; finalizedAt: string | null; finalizedByAuthUserId: string | null }> {
  const { data, error } = await supabase.rpc("finalize_import_run", { p_import_run_id: runId });
  if (error) {
    throw error;
  }
  return {
    status: data.status,
    finalizedAt: data.finalized_at,
    finalizedByAuthUserId: data.finalized_by_auth_user_id,
  };
}

/**
 * Bounded, admin-readable message for a governed lifecycle denial -- never
 * the raw PostgrestError text. Unrecognized codes fall through to the
 * server's own message, which these RPCs already keep free of SQL/
 * exception internals (see 20260822170000's own redaction proof).
 */
export function describeLifecycleError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  const message = String((err as { message?: string } | null)?.message || "");

  const known: Record<string, string> = {
    not_authorized: "You do not have the required authority for this action.",
    missing_input: "Missing required information.",
    import_run_not_closable: "This run cannot be closed -- it is already finalized or no longer exists.",
    import_run_not_mutable: "This run is finalized and can no longer be changed.",
    import_row_not_mutable: "This row can no longer be changed.",
    import_row_terminal_or_retry_owned: "This row is already committed, failed validation, retry-owned, or abandoned.",
    import_row_terminal: "This row is already committed or failed validation and cannot be abandoned.",
    import_row_already_abandoned: "This row was already abandoned with a different reason.",
    invalid_abandonment_reason_code: "Choose one of the approved abandonment reasons.",
    import_run_not_ready_for_review: "Close source staging before finalizing this run.",
    import_run_has_open_rows: "Every row must be committed, failed validation, or abandoned before this run can be finalized.",
    import_run_not_finalizable: "This run could not be found.",
    event_archived: "This Event is archived and can no longer be changed.",
    event_lifecycle_indeterminate: "This Event's lifecycle state could not be determined.",
    import_run_not_agenda: "This run is not an Agenda import.",
    import_run_not_correctable:
      "This row can no longer be corrected -- the run is finalized, the row is committed or abandoned, or it is retry-owned.",
    corrected_candidate_malformed:
      "The corrected values are not a valid Agenda row. Check Title, Agenda Date, and Start Time.",
    stale_correction_conflict:
      "This row changed since you started editing it. Reload the row and try your correction again.",
    invalid_correction_reason_code: "Choose one of the approved correction reasons.",
    invalid_correction_validation_state: "Could not determine the corrected row's validation outcome.",
  };

  if (known[message]) {
    return known[message];
  }
  if (code === "42501") {
    return "You do not have the required authority for this action.";
  }
  return "This action could not be completed. Please try again.";
}
