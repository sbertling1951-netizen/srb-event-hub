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

test("Stage B delegates exactly one interpretation pass to the unchanged Stage A batch contract", () => {
  assert.equal((source.match(/interpretAgendaImportRows\(rows\)/g) || []).length, 1);
  assert.equal(/interpretAgendaImportRow\(/.test(source), false);
  assert.equal(/classifyAgendaFileDuplicates\(/.test(source), false);
  assert.equal(/deriveAgendaExternalId\(/.test(source), false);
});

test("Agenda run creation precedes staging and preserves row count plus immutable expected-version evidence", () => {
  const createIndex = source.indexOf('.rpc("create_import_run"');
  const stageIndex = source.indexOf('"stage_import_run_row"');
  assert.ok(createIndex > -1 && stageIndex > createIndex);
  assert.match(source, /p_import_type: "agenda"/);
  assert.match(source, /row_count: rows\.length/);
  assert.match(source, /expected_agenda_version: expectedAgendaVersion/);
});

test("every Stage A interpretation is staged unchanged with source context and deterministic validation state", () => {
  const run = source.slice(source.indexOf("export async function runGovernedAgendaImport"));
  assert.match(run, /p_source_row_number: interpretation\.candidate\.source_row_number/);
  assert.match(run, /p_source_payload: rows\[index\]/);
  assert.match(run, /p_normalized_candidate: interpretation\.candidate/);
  assert.match(run, /p_validation_details: interpretation\.issues/);
  assert.match(run, /validation_state === "validation_failed"/);
  assert.match(run, /validationState === "invalid" \? "unreviewed" : "approved"/);
});

test("browser orchestration has no canonical or staging table writes and only the six governed Stage B operations", () => {
  assert.equal(/supabase\.from|\.from\(["']/.test(source), false);
  const allowed = new Set([
    "create_import_run",
    "stage_import_run_row",
    "set_import_run_row_review_state",
    "commit_agenda_import_run",
    "record_agenda_import_run_commit_failure",
    "get_managed_import_run_recovery",
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

test("one batch commit path owns initial commit and retry; valid rows are never committed one-by-one", () => {
  assert.equal((source.match(/\.rpc\(\s*"commit_agenda_import_run"/g) || []).length, 1);
  assert.match(source, /retryAgendaImportBatchCommit[\s\S]*attemptAgendaBatchCommit\(runId\)/);
  assert.doesNotMatch(source, /commit_agenda_import_run_row/);
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
    approvedPendingCommit: 2,
    abandoned: 1,
  });
  assert.deepEqual(summarizeAgendaImportRows([]), {
    processed: 0,
    committed: 0,
    validationFailed: 0,
    commitFailed: 0,
    approvedPendingCommit: 0,
    abandoned: 0,
  });
});
