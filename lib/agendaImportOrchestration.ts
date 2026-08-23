// Agenda Governed Imports Stage B/Stage C client orchestration. File parsing
// remains the Agenda page's browser-I/O concern; interpretation remains
// exclusively lib/agendaImportContract.ts; source persistence/recovery remains
// the generic governed Imports architecture; and canonical mutation is one
// explicitly confirmed database-side Agenda batch through
// commit_agenda_import_run.

import {
  type AgendaImportCandidate,
  type AgendaImportEventDateContext,
  type AgendaImportIssue,
  type AgendaImportRowContext,
  interpretAgendaImportRow,
  interpretAgendaImportRows,
  type RawAgendaImportRow,
} from "@/lib/agendaImportContract";
import { supabase } from "@/lib/supabase";

export type AgendaImportRowState =
  | "parsed"
  | "validation_failed"
  | "needs_review"
  | "approved"
  | "committed"
  | "commit_failed";

export type AgendaImportCommitFailureCode =
  | "agenda_commit_failed"
  | "agenda_commit_denied"
  | "agenda_commit_conflict"
  | "agenda_commit_unavailable"
  | "agenda_commit_stale_version";

export type AgendaImportCommitError = {
  code: string;
  message: string;
};

export type AgendaImportCorrectionReasonCode =
  | "data_entry_error"
  | "source_file_error"
  | "ambiguous_date_resolved"
  | "duplicate_conflict_resolved"
  | "other";

export const AGENDA_CORRECTION_REASON_OPTIONS: {
  code: AgendaImportCorrectionReasonCode;
  label: string;
}[] = [
  { code: "data_entry_error", label: "Data entry error" },
  { code: "source_file_error", label: "Source file error" },
  { code: "ambiguous_date_resolved", label: "Ambiguous date resolved" },
  { code: "duplicate_conflict_resolved", label: "Duplicate conflict resolved" },
  { code: "other", label: "Other" },
];

export type AgendaImportRowResult = {
  rowId: string;
  sourceRowNumber: number;
  candidate: AgendaImportCandidate;
  issues: AgendaImportIssue[];
  rowState: AgendaImportRowState;
  canonicalAgendaItemId: string | null;
  commitError: AgendaImportCommitError | null;
  abandonedAt: string | null;
  abandonedByAuthUserId: string | null;
  abandonmentReasonCode: string | null;
  /** 0 when this row has never been through governed correction. */
  correctionRevision: number;
  correctionCount: number;
  /** The latest correction's own candidate/issues, independent of whether
   * that latest attempt was valid -- used to preload the Edit Row dialog
   * with the operator's own most recent edit, not the frozen original. */
  latestCorrectedCandidate: AgendaImportCandidate | null;
  latestCorrectionIssues: AgendaImportIssue[];
  latestCorrectedByAuthUserId: string | null;
  latestCorrectedAt: string | null;
};

export type AgendaImportRunStatus = "staging" | "ready_for_review" | "finalized";

export type AgendaImportRunResult = {
  runId: string;
  eventId: string;
  sourceFilename: string | null;
  status: AgendaImportRunStatus;
  rows: AgendaImportRowResult[];
  batchOutcome:
    | "committed"
    | "already_committed"
    | "no_eligible_rows"
    | "pending_commit"
    | "commit_failed"
    | "orchestration_failed";
  importedCount: number;
  newVersion: number | null;
  orchestrationError: string | null;
};

export type AgendaImportRunSummary = {
  processed: number;
  committed: number;
  validationFailed: number;
  commitFailed: number;
  approvedPendingCommit: number;
  abandoned: number;
  unresolvedOpen: number;
};

type AgendaBatchAttempt = Pick<
  AgendaImportRunResult,
  "batchOutcome" | "importedCount" | "newVersion" | "orchestrationError"
>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function fingerprintAgendaCandidate(candidate: AgendaImportCandidate) {
  const bytes = new TextEncoder().encode(stableJson(candidate));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function classifyAgendaCommitFailureCode(
  err: unknown,
): AgendaImportCommitFailureCode {
  const code = (err as { code?: string } | null)?.code;
  const message = String((err as { message?: string } | null)?.message || "");

  if (message === "stale_agenda_version") {
    return "agenda_commit_stale_version";
  }
  if (
    code === "42501" ||
    [
      "not_authorized",
      "event_archived",
      "event_lifecycle_indeterminate",
      "import_run_not_committable",
    ].includes(message)
  ) {
    return "agenda_commit_denied";
  }
  if (code && ["23505", "23503", "23514", "22P02"].includes(code)) {
    return "agenda_commit_conflict";
  }
  if (!code) {
    return "agenda_commit_unavailable";
  }
  return "agenda_commit_failed";
}

async function attemptAgendaBatchCommit(runId: string): Promise<AgendaBatchAttempt> {
  try {
    const { data, error } = await supabase.rpc("commit_agenda_import_run", {
      p_import_run_id: runId,
    });
    if (error) {
      throw error;
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (
      result?.outcome !== "committed" &&
      result?.outcome !== "already_committed" &&
      result?.outcome !== "no_eligible_rows"
    ) {
      throw new Error("unrecognized_agenda_batch_commit_outcome");
    }

    return {
      batchOutcome: result.outcome,
      importedCount: Number(result.imported_count ?? 0),
      newVersion:
        typeof result.new_version === "number" ? result.new_version : null,
      orchestrationError: null,
    };
  } catch (commitError) {
    const failureCode = classifyAgendaCommitFailureCode(commitError);
    const { error: recordError } = await supabase.rpc(
      "record_agenda_import_run_commit_failure",
      { p_import_run_id: runId, p_failure_code: failureCode },
    );

    if (recordError) {
      return {
        batchOutcome: "orchestration_failed",
        importedCount: 0,
        newVersion: null,
        orchestrationError:
          "The Agenda commit failed and its governed failure outcome could not be recorded.",
      };
    }

    return {
      batchOutcome: "commit_failed",
      importedCount: 0,
      newVersion: null,
      orchestrationError: null,
    };
  }
}

export async function recoverAgendaImportRun(
  runId: string,
): Promise<
  Omit<AgendaImportRunResult, "batchOutcome" | "importedCount" | "newVersion" | "orchestrationError">
> {
  const [{ data, error }, correctionResult] = await Promise.all([
    supabase.rpc("get_managed_import_run_recovery", { p_import_run_id: runId }),
    supabase.rpc("list_agenda_import_row_correction_summaries", {
      p_import_run_id: runId,
    }),
  ]);
  if (error) {
    throw error;
  }
  if (data?.run?.import_type !== "agenda") {
    throw new Error("import_run_not_agenda");
  }
  // A denial here (e.g. a non-Agenda run, already rejected above) would
  // throw; any other error is surfaced the same way rather than silently
  // treating "corrections unknown" as "no corrections".
  if (correctionResult.error) {
    throw correctionResult.error;
  }

  const correctionByRow = new Map<string, any>(
    (correctionResult.data || []).map((c: any) => [c.import_run_row_id, c]),
  );

  return {
    runId: data.run.id,
    eventId: data.run.event_id,
    sourceFilename: data.run.source_filename,
    status: data.run.status,
    rows: (data.rows || []).map((row: any) => {
      const correction = correctionByRow.get(row.id);
      return {
        rowId: row.id,
        sourceRowNumber: row.source_row_number,
        candidate: row.normalized_candidate,
        issues: row.validation_details || [],
        rowState: row.row_state as AgendaImportRowState,
        canonicalAgendaItemId: row.canonical_target_id,
        commitError: row.commit_error,
        abandonedAt: row.abandoned_at ?? null,
        abandonedByAuthUserId: row.abandoned_by_auth_user_id ?? null,
        abandonmentReasonCode: row.abandonment_reason_code ?? null,
        correctionRevision: correction ? Number(correction.latest_revision) : 0,
        correctionCount: correction ? Number(correction.correction_count) : 0,
        latestCorrectedCandidate: correction
          ? (correction.latest_corrected_candidate as AgendaImportCandidate)
          : null,
        latestCorrectionIssues: correction
          ? (correction.latest_validation_details as AgendaImportIssue[]) || []
          : [],
        latestCorrectedByAuthUserId: correction
          ? correction.latest_corrected_by_auth_user_id
          : null,
        latestCorrectedAt: correction ? correction.latest_corrected_at : null,
      };
    }),
  };
}

/**
 * Recompute a single row's candidate through the exact same, unchanged
 * Stage A interpreter used for original ingestion (same human-friendly
 * date/time semantics: "11/4/26", "1300", "1:30 PM", ...), given the
 * operator's edited preferred-heading field values. This is the only place
 * a corrected candidate is produced -- correct_agenda_import_run_row never
 * re-parses source text itself, only re-validates the resulting candidate's
 * shape.
 */
export function interpretAgendaCorrection(
  editedFields: RawAgendaImportRow,
  context: AgendaImportRowContext,
) {
  return interpretAgendaImportRow(editedFields, context);
}

export type AgendaCorrectionResult = {
  rowId: string;
  rowState: AgendaImportRowState;
  validationState: "valid" | "invalid";
  reviewState: string;
  revision: number;
};

/**
 * Submit a governed correction for one staged Agenda row. The candidate and
 * its validation outcome must already be computed by
 * interpretAgendaCorrection (or interpretAgendaImportRow directly) -- this
 * function only calls the governed RPC and never re-derives Stage A logic
 * itself. expectedRevision must be the row's currently known
 * correctionRevision (0 if never corrected); a stale value is rejected by
 * the server rather than silently overwriting a newer correction.
 */
export async function correctAgendaImportRow(params: {
  rowId: string;
  expectedRevision: number;
  candidate: AgendaImportCandidate;
  validationState: "valid" | "validation_failed";
  issues: AgendaImportIssue[];
  reasonCode?: AgendaImportCorrectionReasonCode | null;
}): Promise<AgendaCorrectionResult> {
  const { rowId, expectedRevision, candidate, validationState, issues, reasonCode } =
    params;
  const { data, error } = await supabase.rpc("correct_agenda_import_run_row", {
    p_import_run_row_id: rowId,
    p_expected_revision: expectedRevision,
    p_corrected_candidate: candidate,
    p_validation_state: validationState === "valid" ? "valid" : "invalid",
    p_validation_details: issues,
    p_correction_reason_code: reasonCode ?? null,
  });
  if (error) {
    throw error;
  }
  const result = Array.isArray(data) ? data[0] : data;
  return {
    rowId: result.import_run_row_id,
    rowState: result.row_state as AgendaImportRowState,
    validationState: result.validation_state,
    reviewState: result.review_state,
    revision: Number(result.revision),
  };
}

async function recoverAfterAttempt(
  runId: string,
  attempt: AgendaBatchAttempt,
): Promise<AgendaImportRunResult> {
  const recovered = await recoverAgendaImportRun(runId);
  return { ...recovered, ...attempt };
}

export async function stageGovernedAgendaImport(params: {
  eventId: string;
  sourceFilename: string | null;
  rows: RawAgendaImportRow[];
  expectedAgendaVersion: number;
  eventDateContext: AgendaImportEventDateContext;
}): Promise<AgendaImportRunResult> {
  const {
    eventId,
    sourceFilename,
    rows,
    expectedAgendaVersion,
    eventDateContext,
  } = params;
  const interpretations = interpretAgendaImportRows(rows, eventDateContext);

  const { data: run, error: runError } = await supabase.rpc("create_import_run", {
    p_event_id: eventId,
    p_import_type: "agenda",
    p_source_filename: sourceFilename,
    p_source_metadata: {
      row_count: rows.length,
      expected_agenda_version: expectedAgendaVersion,
      event_date_context: eventDateContext,
    },
  });
  if (runError) {
    throw runError;
  }
  const runId = run.id as string;

  let eligibleCount = 0;
  for (let index = 0; index < interpretations.length; index += 1) {
    const interpretation = interpretations[index];
    const fingerprint = await fingerprintAgendaCandidate(
      interpretation.candidate,
    );
    const { data: staged, error: stageError } = await supabase.rpc(
      "stage_import_run_row",
      {
        p_import_run_id: runId,
        p_source_row_number: interpretation.candidate.source_row_number,
        p_source_payload: rows[index],
        p_normalized_candidate: interpretation.candidate,
        p_source_fingerprint: fingerprint,
      },
    );
    if (stageError) {
      throw stageError;
    }

    const validationState =
      interpretation.validation_state === "validation_failed"
        ? "invalid"
        : "valid";
    const reviewState =
      validationState === "invalid" ? "unreviewed" : "approved";
    const { error: reviewError } = await supabase.rpc(
      "set_import_run_row_review_state",
      {
        p_import_run_row_id: staged.id,
        p_validation_state: validationState,
        p_validation_details: interpretation.issues,
        p_review_state: reviewState,
      },
    );
    if (reviewError) {
      throw reviewError;
    }
    if (reviewState === "approved") {
      eligibleCount += 1;
    }
  }

  const attempt: AgendaBatchAttempt = {
    batchOutcome: eligibleCount ? "pending_commit" : "no_eligible_rows",
    importedCount: 0,
    newVersion: null,
    orchestrationError: null,
  };

  return recoverAfterAttempt(runId, attempt);
}

export async function commitAgendaImportRun(
  runId: string,
): Promise<AgendaImportRunResult> {
  return recoverAfterAttempt(runId, await attemptAgendaBatchCommit(runId));
}

export function summarizeAgendaImportRows(
  rows: AgendaImportRowResult[],
): AgendaImportRunSummary {
  return {
    processed: rows.length,
    committed: rows.filter((row) => row.rowState === "committed").length,
    validationFailed: rows.filter(
      (row) => row.rowState === "validation_failed",
    ).length,
    commitFailed: rows.filter(
      (row) => row.rowState === "commit_failed" && row.abandonedAt === null,
    ).length,
    approvedPendingCommit: rows.filter(
      (row) => row.rowState === "approved" && row.abandonedAt === null,
    ).length,
    abandoned: rows.filter((row) => row.abandonedAt !== null).length,
    unresolvedOpen: rows.filter(
      (row) =>
        row.abandonedAt === null &&
        row.rowState !== "committed" &&
        row.rowState !== "validation_failed",
    ).length,
  };
}
