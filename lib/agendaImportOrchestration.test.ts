import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  type AgendaImportRowResult,
  summarizeAgendaImportRows,
} from "./agendaImportOrchestration";

const source = readFileSync(
  fileURLToPath(new URL("./agendaImportOrchestration.ts", import.meta.url)),
  "utf8",
);

test("original file ingestion runs Stage A interpretation exactly once, via the batch contract, plus Event date context", () => {
  assert.equal((source.match(/interpretAgendaImportRows\(/g) || []).length, 1);
  assert.match(source, /interpretAgendaImportRows\(rows, eventDateContext\)/);
  assert.equal(/classifyAgendaFileDuplicates\(/.test(source), false);
  assert.equal(/deriveAgendaExternalId\(/.test(source), false);
});

test("row correction reuses the exact same, unchanged per-row Stage A interpreter -- no second, divergent normalization implementation", () => {
  // The only call to the singular interpretAgendaImportRow (as opposed to
  // the batch interpretAgendaImportRows used for original ingestion above)
  // is interpretAgendaCorrection's direct pass-through -- proving
  // correction reuses Stage A rather than reimplementing any part of it.
  assert.equal((source.match(/interpretAgendaImportRow\(/g) || []).length, 1);
  assert.match(
    source,
    /export function interpretAgendaCorrection\([\s\S]*?return interpretAgendaImportRow\(editedFields, context\);/,
  );
  // No independent parsing of dates, times, aliases, or duplicate identity
  // exists in this file -- interpretAgendaCorrection's own body is a pure
  // pass-through to the unchanged Stage A function, not a reimplementation.
  assert.equal(/normalizeImportDate|normalizeImportTimeOnly|deriveAgendaExternalId|classifyAgendaFileDuplicates/.test(source), false);
});

test("Agenda run creation precedes staging and preserves row count, Event date context, and expected-version evidence", () => {
  const createIndex = source.indexOf('.rpc("create_import_run"');
  const stageIndex = source.indexOf('"stage_import_run_row"');
  assert.ok(createIndex > -1 && stageIndex > createIndex);
  assert.match(source, /p_import_type: "agenda"/);
  assert.match(source, /row_count: rows\.length/);
  assert.match(source, /expected_agenda_version: expectedAgendaVersion/);
  assert.match(source, /event_date_context: eventDateContext/);
});

test("every Stage A interpretation is staged unchanged with source context and deterministic validation state", () => {
  const run = source.slice(source.indexOf("export async function stageGovernedAgendaImport"));
  assert.match(run, /p_source_row_number: interpretation\.candidate\.source_row_number/);
  assert.match(run, /p_source_payload: rows\[index\]/);
  assert.match(run, /p_normalized_candidate: interpretation\.candidate/);
  assert.match(run, /p_validation_details: interpretation\.issues/);
  assert.match(run, /validation_state === "validation_failed"/);
  assert.match(run, /validationState === "invalid" \? "unreviewed" : "approved"/);
});

test("browser orchestration has no canonical or staging table writes and only the nine governed Stage B/correction/deletion operations", () => {
  assert.equal(/supabase\.from|\.from\(["']/.test(source), false);
  const allowed = new Set([
    "create_import_run",
    "stage_import_run_row",
    "set_import_run_row_review_state",
    "commit_agenda_import_run",
    "record_agenda_import_run_commit_failure",
    "get_managed_import_run_recovery",
    "list_agenda_import_row_correction_summaries",
    "correct_agenda_import_run_row",
    "delete_agenda_import_run_row",
  ]);
  const rpcCalls = [...source.matchAll(/\.rpc\(\s*["']([a-z_]+)["']/g)].map(
    (match) => match[1],
  );
  assert.ok(rpcCalls.length > 0);
  for (const rpc of rpcCalls) {
    assert.ok(allowed.has(rpc), `unexpected RPC call: ${rpc}`);
  }
  assert.equal(source.includes("import_event_agenda_items"), false);
});

test("one explicit batch commit path owns first commit and retry; valid rows are never committed one-by-one", () => {
  assert.equal((source.match(/\.rpc\(\s*"commit_agenda_import_run"/g) || []).length, 1);
  assert.match(source, /commitAgendaImportRun[\s\S]*attemptAgendaBatchCommit\(runId\)/);
  assert.doesNotMatch(source, /commit_agenda_import_run_row/);
});

test("staging stops at recovered persisted truth and never invokes the batch commit", () => {
  const stage = source.slice(
    source.indexOf("export async function stageGovernedAgendaImport"),
    source.indexOf("export async function commitAgendaImportRun"),
  );
  assert.match(stage, /batchOutcome: eligibleCount \? "pending_commit" : "no_eligible_rows"/);
  assert.doesNotMatch(stage, /attemptAgendaBatchCommit\(/);
  assert.match(stage, /recoverAfterAttempt\(runId, attempt\)/);
});

test("commit failures are classified into the five bounded Agenda codes and only the code is recorded", () => {
  const classifier = source.slice(
    source.indexOf("function classifyAgendaCommitFailureCode"),
    source.indexOf("async function attemptAgendaBatchCommit"),
  );
  for (const code of [
    "agenda_commit_failed",
    "agenda_commit_denied",
    "agenda_commit_conflict",
    "agenda_commit_unavailable",
    "agenda_commit_stale_version",
  ]) {
    assert.match(classifier, new RegExp(code));
  }
  assert.match(
    source,
    /record_agenda_import_run_commit_failure[\s\S]*p_import_run_id: runId, p_failure_code: failureCode/,
  );
  assert.doesNotMatch(source, /p_failure_(?:message|detail)|commitError\.message/);
});

test("recovery is governed, rejects a non-Agenda run, and surfaces row abandonment truth", () => {
  const recovery = source.slice(
    source.indexOf("export async function recoverAgendaImportRun"),
    source.indexOf("async function recoverAfterAttempt"),
  );
  assert.match(recovery, /get_managed_import_run_recovery/);
  assert.match(recovery, /data\?\.run\?\.import_type !== "agenda"/);
  assert.match(recovery, /abandonedAt: row\.abandoned_at/);
  assert.match(recovery, /abandonedByAuthUserId: row\.abandoned_by_auth_user_id/);
  assert.match(recovery, /abandonmentReasonCode: row\.abandonment_reason_code/);
  assert.equal(/\.from\(/.test(recovery), false);
});

test("summary reports persisted Agenda row states and abandonment without guessing success", () => {
  const row = (overrides: Partial<AgendaImportRowResult>): AgendaImportRowResult => ({
    rowId: crypto.randomUUID(),
    sourceRowNumber: 2,
    candidate: {} as AgendaImportRowResult["candidate"],
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
  });
  const rows = [
    row({ rowState: "committed", canonicalAgendaItemId: crypto.randomUUID() }),
    row({ rowState: "validation_failed" }),
    row({ rowState: "commit_failed" }),
    row({ rowState: "approved" }),
    row({ rowState: "approved", abandonedAt: new Date().toISOString() }),
  ];

  assert.deepEqual(summarizeAgendaImportRows(rows), {
    processed: 5,
    committed: 1,
    validationFailed: 1,
    commitFailed: 1,
    approvedPendingCommit: 1,
    abandoned: 1,
    unresolvedOpen: 2,
  });
  assert.deepEqual(summarizeAgendaImportRows([]), {
    processed: 0,
    committed: 0,
    validationFailed: 0,
    commitFailed: 0,
    approvedPendingCommit: 0,
    abandoned: 0,
    unresolvedOpen: 0,
  });
});

test("correctAgendaImportRow submits exactly the recomputed candidate/validation outcome plus a fencing revision to the governed RPC", () => {
  const fn = source.slice(
    source.indexOf("export async function correctAgendaImportRow"),
    source.indexOf("async function recoverAfterAttempt"),
  );
  assert.match(fn, /\.rpc\("correct_agenda_import_run_row", \{/);
  assert.match(fn, /p_import_run_row_id: rowId/);
  assert.match(fn, /p_expected_revision: expectedRevision/);
  assert.match(fn, /p_corrected_candidate: candidate/);
  assert.match(fn, /p_validation_details: issues/);
  assert.doesNotMatch(fn, /p_event_id/);
});

test("recovery merges run-scoped correction summaries by row id rather than guessing per-row correction state", () => {
  const recovery = source.slice(
    source.indexOf("export async function recoverAgendaImportRun"),
    source.indexOf("export function interpretAgendaCorrection"),
  );
  assert.match(recovery, /list_agenda_import_row_correction_summaries/);
  assert.match(recovery, /correctionByRow\.get\(row\.id\)/);
  assert.match(recovery, /correctionRevision: correction \? Number\(correction\.latest_revision\) : 0/);
  assert.match(recovery, /correctionCount: correction \? Number\(correction\.correction_count\) : 0/);
});
