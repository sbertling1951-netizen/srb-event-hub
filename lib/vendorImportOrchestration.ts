// Stage 5B.3 client orchestration for the governed Vendor Import workflow.
// This module owns no matching/admission/metadata/lifecycle rules of its
// own: normalization comes from the Stage 5B.1 contract
// (lib/vendorImportContract.ts), staging/review persistence comes from the
// Stage 1 governed RPCs, canonical Event-domain matching/commit comes from
// the Stage 5B.2 governed RPC (commit_vendor_import_run_row), and recovery
// comes from the Stage 1.1 governed RPC. This module only sequences those
// calls and classifies their results for the UI -- the same responsibility
// split as lib/attendeeImportOrchestration.ts.
//
// One notable difference from the Attendee precedent: commit_vendor_import_run_row
// persists a needs_review outcome (row_state/review_state/commit_state) itself,
// inside its own governed transaction -- unlike commit_attendee_import_run_row,
// which leaves that persistence to a separate set_import_run_row_review_state
// call. This module never re-writes what Stage 5B.2 already persisted.
import { supabase } from "@/lib/supabase";
import {
  interpretVendorImportRow,
  type RawVendorImportRow,
  type VendorImportCandidate,
  type VendorImportIssue,
} from "@/lib/vendorImportContract";

export type VendorImportRowState =
  | "validation_failed"
  | "needs_review"
  | "approved"
  | "committed"
  | "commit_failed";

export type VendorImportCommitFailureCode =
  | "vendor_commit_failed"
  | "vendor_commit_denied"
  | "vendor_commit_conflict"
  | "vendor_commit_unavailable";

export type VendorImportCommitError = {
  code: string;
  message: string;
};

/** Stage 5B.2's bounded needs_review reason codes, persisted in a row's
 * validation_details by commit_vendor_import_run_row itself. */
export type VendorReviewReasonCode =
  | "vendor_not_found"
  | "vendor_identity_ambiguous"
  | "vendor_inactive"
  | "vendor_identity_conflict"
  | "vendor_duplicate_in_import"
  | "vendor_not_admitted";

export type VendorImportRowResult = {
  rowId: string;
  sourceRowNumber: number;
  candidate: VendorImportCandidate;
  issues: VendorImportIssue[];
  rowState: VendorImportRowState;
  /** The matched canonical vendors.id once committed. Never set for any
   * other row state -- a needs_review/commit_failed row never carries a
   * guessed target. */
  canonicalVendorId: string | null;
  /** Stage 5B.2's reason for a needs_review outcome, when known. */
  reviewReasonCode: VendorReviewReasonCode | null;
  commitError: VendorImportCommitError | null;
  /** Row Lifecycle overlay (Stage 20260822170000): set only once, never
   * cleared, independent of rowState (abandonment never rewrites it). */
  abandonedAt: string | null;
  abandonedByAuthUserId: string | null;
  abandonmentReasonCode: string | null;
};

export type VendorImportRunResult = {
  runId: string;
  eventId: string;
  sourceFilename: string | null;
  rows: VendorImportRowResult[];
};

export type RecoveredVendorImportRun = {
  run: {
    id: string;
    eventId: string;
    importType: string;
    sourceFilename: string | null;
    status: string;
    createdAt: string;
    finalizedAt: string | null;
  };
  rows: VendorImportRowResult[];
};

export type VendorImportRunSummary = {
  processed: number;
  committed: number;
  validationFailed: number;
  needsReview: number;
  commitFailed: number;
  approvedPendingCommit: number;
  warnings: number;
};

/** Human-facing description of a Stage 5B.2 needs_review reason. Display
 * text only -- the code itself, not this text, is the persisted truth. */
export function describeVendorReviewReason(code: string | null): string {
  switch (code) {
    case "vendor_not_found":
      return "No active canonical Vendor matches this Business Name.";
    case "vendor_identity_ambiguous":
      return "More than one active canonical Vendor matches this Business Name.";
    case "vendor_inactive":
      return "The matching canonical Vendor is inactive.";
    case "vendor_identity_conflict":
      return "Supporting details on this row conflict with the matched Vendor's canonical record.";
    case "vendor_duplicate_in_import":
      return "Another row in this file has the same Business Name.";
    case "vendor_not_admitted":
      return "Event details were requested, but this Vendor is not admitted to this Event.";
    default:
      return "This row needs review.";
  }
}

/** Reasons that can only be resolved by editing the canonical Vendor
 * record itself (create/reactivate/correct identity) -- these are the
 * cases Imports must hand off to /admin/vendors rather than attempt to
 * fix. Duplicate-in-file and not-admitted are resolved by correcting the
 * import file or requesting admission, not by canonical identity work. */
export function vendorReviewRequiresIdentityWork(code: string | null): boolean {
  return (
    code === "vendor_not_found" ||
    code === "vendor_identity_ambiguous" ||
    code === "vendor_inactive" ||
    code === "vendor_identity_conflict"
  );
}

function classifyVendorCommitFailureCode(err: unknown): VendorImportCommitFailureCode {
  const code = (err as { code?: string } | null)?.code;
  const message = String((err as { message?: string } | null)?.message || "");

  if (
    code === "42501" ||
    ["not_authorized", "event_archived", "event_lifecycle_indeterminate", "import_run_not_committable"].includes(
      message,
    )
  ) {
    return "vendor_commit_denied";
  }

  if (code && ["23505", "23503", "23514"].includes(code)) {
    return "vendor_commit_conflict";
  }

  if (!code) {
    // No PostgrestError code at all means the request never reached a
    // classifiable database outcome (transport/service failure).
    return "vendor_commit_unavailable";
  }

  return "vendor_commit_failed";
}

async function attemptVendorCommit(rowId: string): Promise<{
  rowState: VendorImportRowState;
  canonicalVendorId: string | null;
  reviewReasonCode: VendorReviewReasonCode | null;
  commitError: VendorImportCommitError | null;
}> {
  try {
    const { data, error } = await supabase.rpc("commit_vendor_import_run_row", {
      p_import_run_row_id: rowId,
    });
    if (error) {
      throw error;
    }

    const outcome = Array.isArray(data) ? data[0] : data;

    if (outcome?.outcome === "committed" || outcome?.outcome === "already_committed") {
      return {
        rowState: "committed",
        canonicalVendorId: outcome.vendor_id ?? null,
        reviewReasonCode: null,
        commitError: null,
      };
    }

    if (outcome?.outcome === "needs_review") {
      // Stage 5B.2 already persisted row_state/review_state/commit_state
      // for this outcome inside its own governed transaction -- this
      // module never re-writes what the RPC already made truthful.
      return {
        rowState: "needs_review",
        canonicalVendorId: null,
        reviewReasonCode: (outcome.reason_code ?? null) as VendorReviewReasonCode | null,
        commitError: null,
      };
    }

    throw new Error(`unrecognized_commit_outcome:${String(outcome?.outcome)}`);
  } catch (commitErr) {
    const failureCode = classifyVendorCommitFailureCode(commitErr);

    try {
      const { data: failed, error: recordError } = await supabase.rpc(
        "record_vendor_import_run_row_commit_failure",
        { p_import_run_row_id: rowId, p_failure_code: failureCode },
      );
      if (recordError) {
        throw recordError;
      }

      return {
        rowState: "commit_failed",
        canonicalVendorId: null,
        reviewReasonCode: null,
        commitError: failed?.commit_error ?? { code: failureCode, message: "Commit failed." },
      };
    } catch (recordErr) {
      // Two-level orchestration failure: the canonical commit failed AND
      // the failure outcome could not be recorded. Surface both truthfully
      // rather than guessing a persisted state that was never written.
      return {
        rowState: "approved",
        canonicalVendorId: null,
        reviewReasonCode: null,
        commitError: {
          code: "orchestration_failed",
          message: `Canonical commit failed (${failureCode}) and the failure outcome could not be recorded: ${
            (recordErr as { message?: string } | null)?.message || "unknown error"
          }`,
        },
      };
    }
  }
}

export async function runGovernedVendorImport(params: {
  eventId: string;
  sourceFilename: string | null;
  rows: RawVendorImportRow[];
}): Promise<VendorImportRunResult> {
  const { eventId, sourceFilename, rows } = params;

  const { data: run, error: runError } = await supabase.rpc("create_import_run", {
    p_event_id: eventId,
    p_import_type: "vendors",
    p_source_filename: sourceFilename,
    p_source_metadata: { row_count: rows.length },
  });
  if (runError) {
    throw runError;
  }
  const runId = run.id as string;

  const interpretations = rows.map((row, index) => interpretVendorImportRow(row, index + 2));

  const results: VendorImportRowResult[] = [];

  for (const interp of interpretations) {
    const fingerprint = await interp.fingerprint;
    const { data: staged, error: stageError } = await supabase.rpc("stage_import_run_row", {
      p_import_run_id: runId,
      p_source_row_number: interp.candidate.source_row_number,
      p_source_payload: interp.source_payload,
      p_normalized_candidate: interp.candidate,
      p_source_fingerprint: fingerprint,
    });
    if (stageError) {
      throw stageError;
    }
    const rowId = staged.id as string;

    const validationState = interp.validation_state === "validation_failed" ? "invalid" : "valid";
    const reviewState = validationState === "invalid" ? "unreviewed" : "approved";

    const { data: reviewed, error: reviewError } = await supabase.rpc("set_import_run_row_review_state", {
      p_import_run_row_id: rowId,
      p_validation_state: validationState,
      p_validation_details: interp.issues,
      p_review_state: reviewState,
    });
    if (reviewError) {
      throw reviewError;
    }

    results.push({
      rowId,
      sourceRowNumber: interp.candidate.source_row_number,
      candidate: interp.candidate,
      issues: interp.issues,
      rowState: reviewed.row_state as VendorImportRowState,
      canonicalVendorId: null,
      reviewReasonCode: null,
      commitError: null,
      abandonedAt: null,
      abandonedByAuthUserId: null,
      abandonmentReasonCode: null,
    });
  }

  for (const result of results) {
    if (result.rowState !== "approved") {
      // Only an approved row may be sent to Stage 5B.2 -- validation_failed
      // rows never reach commit_vendor_import_run_row at all.
      continue;
    }

    const outcome = await attemptVendorCommit(result.rowId);
    result.rowState = outcome.rowState;
    result.canonicalVendorId = outcome.canonicalVendorId;
    result.reviewReasonCode = outcome.reviewReasonCode;
    result.commitError = outcome.commitError;
  }

  return { runId, eventId, sourceFilename, rows: results };
}

export async function retryVendorImportRowCommit(
  row: Pick<VendorImportRowResult, "rowId">,
): Promise<
  Pick<VendorImportRowResult, "rowState" | "canonicalVendorId" | "reviewReasonCode" | "commitError">
> {
  return attemptVendorCommit(row.rowId);
}

export async function recoverVendorImportRun(runId: string): Promise<RecoveredVendorImportRun> {
  const { data, error } = await supabase.rpc("get_managed_import_run_recovery", {
    p_import_run_id: runId,
  });
  if (error) {
    throw error;
  }

  const run = data.run;
  const rows: VendorImportRowResult[] = (data.rows || []).map((r: any) => {
    const issues = (r.validation_details || []) as VendorImportIssue[];
    // Stage 5B.2 appends one reason entry to validation_details for each
    // needs_review outcome; the most recently appended one is the current
    // truth for a row currently in that state.
    const lastCode =
      r.row_state === "needs_review" && issues.length ? (issues[issues.length - 1]?.code ?? null) : null;

    return {
      rowId: r.id,
      sourceRowNumber: r.source_row_number,
      candidate: r.normalized_candidate,
      issues,
      rowState: r.row_state as VendorImportRowState,
      canonicalVendorId: r.canonical_target_id,
      reviewReasonCode: lastCode as VendorReviewReasonCode | null,
      commitError: r.commit_error,
      abandonedAt: r.abandoned_at ?? null,
      abandonedByAuthUserId: r.abandoned_by_auth_user_id ?? null,
      abandonmentReasonCode: r.abandonment_reason_code ?? null,
    };
  });

  return {
    run: {
      id: run.id,
      eventId: run.event_id,
      importType: run.import_type,
      sourceFilename: run.source_filename,
      status: run.status,
      createdAt: run.created_at,
      finalizedAt: run.finalized_at,
    },
    rows,
  };
}

export function summarizeVendorImportRows(rows: VendorImportRowResult[]): VendorImportRunSummary {
  return {
    processed: rows.length,
    committed: rows.filter((r) => r.rowState === "committed").length,
    validationFailed: rows.filter((r) => r.rowState === "validation_failed").length,
    needsReview: rows.filter((r) => r.rowState === "needs_review").length,
    commitFailed: rows.filter((r) => r.rowState === "commit_failed").length,
    approvedPendingCommit: rows.filter((r) => r.rowState === "approved").length,
    warnings: rows.filter((r) => r.issues.some((i) => i.severity === "warning")).length,
  };
}
