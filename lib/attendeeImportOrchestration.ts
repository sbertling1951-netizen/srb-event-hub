// Stage 4 client orchestration for the governed Attendee Roster import
// workflow. This module owns no business/domain rules of its own: parsing
// and normalization come from the Stage 2 contract
// (lib/attendeeImportContract.ts), and every persisted state transition and
// canonical mutation is performed by the Stage 1 / Stage 3 / Stage 3.1 / Stage
// 1.1 governed RPCs. This module only sequences those calls and classifies
// their results for the UI.
import {
  type AttendeeImportCandidate,
  classifyFileAmbiguities,
  type ImportIssue,
  interpretAttendeeImportRow,
  type RawImportRow,
} from "@/lib/attendeeImportContract";
import { supabase } from "@/lib/supabase";

export type AttendeeImportRowState =
  | "validation_failed"
  | "needs_review"
  | "approved"
  | "committed"
  | "commit_failed";

export type AttendeeImportCommitFailureCode =
  | "canonical_commit_failed"
  | "canonical_commit_denied"
  | "canonical_commit_conflict"
  | "canonical_commit_unavailable";

export type AttendeeImportCommitError = {
  code: string;
  message: string;
};

export type AttendeeImportRowResult = {
  rowId: string;
  sourceRowNumber: number;
  candidate: AttendeeImportCandidate;
  issues: ImportIssue[];
  rowState: AttendeeImportRowState;
  canonicalTargetId: string | null;
  commitError: AttendeeImportCommitError | null;
};

export type AttendeeImportRunResult = {
  runId: string;
  eventId: string;
  sourceFilename: string | null;
  rows: AttendeeImportRowResult[];
};

export type RecoveredAttendeeImportRun = {
  run: {
    id: string;
    eventId: string;
    importType: string;
    sourceFilename: string | null;
    status: string;
    createdAt: string;
    finalizedAt: string | null;
  };
  rows: AttendeeImportRowResult[];
};

export type AttendeeImportRunSummary = {
  processed: number;
  committed: number;
  validationFailed: number;
  needsReview: number;
  commitFailed: number;
  approvedPendingCommit: number;
  warnings: number;
};

const REGISTRATION_IDENTITY_AMBIGUOUS_ISSUE: ImportIssue = {
  code: "registration_identity_ambiguous",
  message:
    "Entry ID and email resolve to different existing attendees. Resolve manually before committing.",
  severity: "error",
};

function classifyCommitFailureCode(err: unknown): AttendeeImportCommitFailureCode {
  const code = (err as { code?: string } | null)?.code;
  const message = String((err as { message?: string } | null)?.message || "");

  if (
    code === "42501" ||
    ["not_authorized", "event_archived", "event_lifecycle_indeterminate", "import_run_not_committable"].includes(
      message,
    )
  ) {
    return "canonical_commit_denied";
  }

  if (code && ["23505", "23503", "23514"].includes(code)) {
    return "canonical_commit_conflict";
  }

  if (!code) {
    // No PostgrestError code at all means the request never reached a
    // classifiable database outcome (transport/service failure).
    return "canonical_commit_unavailable";
  }

  return "canonical_commit_failed";
}

async function attemptCommit(
  rowId: string,
  priorIssues: ImportIssue[],
): Promise<{ rowState: AttendeeImportRowState; canonicalTargetId: string | null; commitError: AttendeeImportCommitError | null }> {
  try {
    const { data, error } = await supabase.rpc("commit_attendee_import_run_row", {
      p_import_run_row_id: rowId,
    });
    if (error) {
      throw error;
    }

    const outcome = Array.isArray(data) ? data[0] : data;

    if (outcome?.outcome === "committed" || outcome?.outcome === "already_committed") {
      return {
        rowState: "committed",
        canonicalTargetId: outcome.attendee_id ?? null,
        commitError: null,
      };
    }

    if (outcome?.outcome === "needs_review") {
      const { error: reviewError } = await supabase.rpc("set_import_run_row_review_state", {
        p_import_run_row_id: rowId,
        p_validation_state: "valid",
        p_validation_details: [...priorIssues, REGISTRATION_IDENTITY_AMBIGUOUS_ISSUE],
        p_review_state: "needs_review",
      });

      if (reviewError) {
        return {
          rowState: "approved",
          canonicalTargetId: null,
          commitError: {
            code: "orchestration_failed",
            message: `Stage 3 reported a review outcome but it could not be persisted: ${reviewError.message}`,
          },
        };
      }

      return { rowState: "needs_review", canonicalTargetId: null, commitError: null };
    }

    throw new Error(`unrecognized_commit_outcome:${String(outcome?.outcome)}`);
  } catch (commitErr) {
    const failureCode = classifyCommitFailureCode(commitErr);

    try {
      const { data: failed, error: recordError } = await supabase.rpc(
        "record_attendee_import_run_row_commit_failure",
        { p_import_run_row_id: rowId, p_failure_code: failureCode },
      );
      if (recordError) {
        throw recordError;
      }

      return {
        rowState: "commit_failed",
        canonicalTargetId: null,
        commitError: failed?.commit_error ?? { code: failureCode, message: "Commit failed." },
      };
    } catch (recordErr) {
      // Two-level orchestration failure: the canonical commit failed AND
      // Stage 3.1 could not record that outcome. Surface both truthfully
      // rather than guessing a persisted state that was never written.
      return {
        rowState: "approved",
        canonicalTargetId: null,
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

export async function runGovernedAttendeeImport(params: {
  eventId: string;
  sourceFilename: string | null;
  rows: RawImportRow[];
  headers: string[];
}): Promise<AttendeeImportRunResult> {
  const { eventId, sourceFilename, rows, headers } = params;

  const { data: run, error: runError } = await supabase.rpc("create_import_run", {
    p_event_id: eventId,
    p_import_type: "attendee_roster",
    p_source_filename: sourceFilename,
    p_source_metadata: { header_count: headers.length, row_count: rows.length },
  });
  if (runError) {
    throw runError;
  }
  const runId = run.id as string;

  const interpretations = rows.map((row, index) => interpretAttendeeImportRow(row, index + 2, headers));
  const ambiguities = classifyFileAmbiguities(interpretations);
  const ambiguousRowNumbers = new Set(ambiguities.flatMap((a) => a.row_numbers));

  const results: AttendeeImportRowResult[] = [];

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

    const isAmbiguous = ambiguousRowNumbers.has(interp.candidate.source_row_number);
    const validationState = interp.validation_state === "validation_failed" ? "invalid" : "valid";
    const reviewState =
      validationState === "invalid" ? "unreviewed" : isAmbiguous ? "needs_review" : "approved";

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
      rowState: reviewed.row_state as AttendeeImportRowState,
      canonicalTargetId: null,
      commitError: null,
    });
  }

  for (const result of results) {
    if (result.rowState !== "approved") {
      continue;
    }

    const outcome = await attemptCommit(result.rowId, result.issues);
    result.rowState = outcome.rowState;
    result.canonicalTargetId = outcome.canonicalTargetId;
    result.commitError = outcome.commitError;
  }

  return { runId, eventId, sourceFilename, rows: results };
}

export async function retryAttendeeImportRowCommit(
  row: Pick<AttendeeImportRowResult, "rowId" | "issues">,
): Promise<Pick<AttendeeImportRowResult, "rowState" | "canonicalTargetId" | "commitError">> {
  return attemptCommit(row.rowId, row.issues);
}

export async function recoverAttendeeImportRun(runId: string): Promise<RecoveredAttendeeImportRun> {
  const { data, error } = await supabase.rpc("get_managed_import_run_recovery", {
    p_import_run_id: runId,
  });
  if (error) {
    throw error;
  }

  const run = data.run;
  const rows: AttendeeImportRowResult[] = (data.rows || []).map((r: any) => ({
    rowId: r.id,
    sourceRowNumber: r.source_row_number,
    candidate: r.normalized_candidate,
    issues: (r.validation_details || []) as ImportIssue[],
    rowState: r.row_state as AttendeeImportRowState,
    canonicalTargetId: r.canonical_target_id,
    commitError: r.commit_error,
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
    },
    rows,
  };
}

export function summarizeAttendeeImportRows(rows: AttendeeImportRowResult[]): AttendeeImportRunSummary {
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
