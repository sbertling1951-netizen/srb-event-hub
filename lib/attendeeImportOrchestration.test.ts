import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { summarizeAttendeeImportRows } from "./attendeeImportOrchestration.ts";

// This repo has no HTTP/Supabase mocking infrastructure (see
// lib/adminTaskAuthority.test.ts). Runtime-only branches (the actual RPC
// round trips) are proven structurally against source, exactly like that
// precedent; pure functions (summarizeAttendeeImportRows) are executed for
// real.
//
// Run with: npx tsx --test lib/attendeeImportOrchestration.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./attendeeImportOrchestration.ts", import.meta.url)),
  "utf8",
);

test("uses the shared Stage 2 contract for interpretation and ambiguity classification -- no page-local parser", () => {
  const importBlock = SOURCE.slice(0, SOURCE.indexOf("from \"@/lib/attendeeImportContract\""));
  assert.match(importBlock, /classifyFileAmbiguities/);
  assert.match(importBlock, /interpretAttendeeImportRow/);
});

test("run creation happens once, before any row staging", () => {
  const createIdx = SOURCE.indexOf('.rpc("create_import_run"');
  const stageIdx = SOURCE.indexOf('.rpc("stage_import_run_row"');
  assert.ok(createIdx > -1 && stageIdx > -1);
  assert.ok(createIdx < stageIdx);
  assert.equal((SOURCE.match(/\.rpc\("create_import_run"/g) || []).length, 1);
});

test("every staged row is immediately given a persisted validation/review state via Stage 1 -- never left pending", () => {
  const runFn = SOURCE.slice(
    SOURCE.indexOf("export async function runGovernedAttendeeImport"),
    SOURCE.indexOf("export async function retryAttendeeImportRowCommit"),
  );
  const stageIdx = runFn.indexOf('.rpc("stage_import_run_row"');
  const reviewIdx = runFn.indexOf('.rpc("set_import_run_row_review_state"');
  assert.ok(stageIdx > -1 && reviewIdx > -1 && stageIdx < reviewIdx);
});

test("state mapping: invalid rows never reach needs_review or approved, and only unambiguous valid rows are approved", () => {
  assert.match(
    SOURCE,
    /const validationState = interp\.validation_state === "validation_failed" \? "invalid" : "valid";/,
  );
  assert.match(
    SOURCE,
    /const reviewState =\s*\n?\s*validationState === "invalid" \? "unreviewed" : isAmbiguous \? "needs_review" : "approved";/,
  );
});

test("only approved rows are ever sent to Stage 3 commit", () => {
  const runFn = SOURCE.slice(
    SOURCE.indexOf("export async function runGovernedAttendeeImport"),
    SOURCE.indexOf("export async function retryAttendeeImportRowCommit"),
  );
  assert.match(runFn, /if \(result\.rowState !== "approved"\) \{\s*continue;/);
});

test("Stage 3 needs_review outcome is persisted through Stage 1 review-state, not treated as a generic failure", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("async function attemptCommit"));
  const needsReviewBranch = fn.slice(
    fn.indexOf('outcome?.outcome === "needs_review"'),
    fn.indexOf("throw new Error(`unrecognized_commit_outcome"),
  );
  assert.match(needsReviewBranch, /set_import_run_row_review_state/);
  assert.match(needsReviewBranch, /p_review_state: "needs_review"/);
  assert.match(needsReviewBranch, /REGISTRATION_IDENTITY_AMBIGUOUS_ISSUE/);
  assert.equal(/record_attendee_import_run_row_commit_failure/.test(needsReviewBranch), false);
  assert.match(SOURCE, /code: "registration_identity_ambiguous"/);
});

test("committed and already_committed both resolve to the committed row state, with no canonical mutation performed client-side", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("async function attemptCommit"), SOURCE.indexOf("export async function runGovernedAttendeeImport"));
  assert.match(
    fn,
    /outcome\?\.outcome === "committed" \|\| outcome\?\.outcome === "already_committed"/,
  );
});

test("genuine canonical failures are classified into exactly one of the four allowed Stage 3.1 codes -- never arbitrary exception text", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("function classifyCommitFailureCode"),
    SOURCE.indexOf("async function attemptCommit"),
  );
  for (const code of [
    "canonical_commit_denied",
    "canonical_commit_conflict",
    "canonical_commit_unavailable",
    "canonical_commit_failed",
  ]) {
    assert.match(fn, new RegExp(code));
  }
  assert.equal((fn.match(/return "canonical_commit_/g) || []).length, 4);
});

test("failure recording sends only the classified code, never the raw error message or stack", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("async function attemptCommit"), SOURCE.indexOf("export async function runGovernedAttendeeImport"));
  assert.match(
    fn,
    /record_attendee_import_run_row_commit_failure["'],\s*\{\s*p_import_run_row_id: rowId,\s*p_failure_code: failureCode,?\s*\}/,
  );
});

test("a failure that cannot be recorded (Stage 3.1 also fails) is surfaced as a distinct orchestration failure, not silently dropped or misclassified as commit_failed", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("async function attemptCommit"), SOURCE.indexOf("export async function runGovernedAttendeeImport"));
  const catchBranch = fn.slice(fn.lastIndexOf("catch (recordErr)"));
  assert.match(catchBranch, /orchestration_failed/);
  assert.equal(/rowState: "commit_failed"/.test(catchBranch), false);
});

test("retry reuses the exact same commit-and-classify path as the initial run -- no second writer", () => {
  assert.equal((SOURCE.match(/\.rpc\("commit_attendee_import_run_row"/g) || []).length, 1);
  const retryFn = SOURCE.slice(SOURCE.indexOf("export async function retryAttendeeImportRowCommit"));
  assert.match(retryFn, /attemptCommit\(/);
});

test("recovery reads only the governed recovery RPC -- never a raw staging-table read", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("export async function recoverAttendeeImportRun"),
    SOURCE.indexOf("export function summarizeAttendeeImportRows"),
  );
  assert.match(fn, /\.rpc\("get_managed_import_run_recovery"/);
  assert.equal(/\.from\(/.test(fn), false);
});

test("this module never performs a direct browser table mutation against any canonical or staging table -- RPCs only", () => {
  assert.equal(/\.from\(/.test(SOURCE), false);
});

test("recovered rows surface the Row Lifecycle abandonment overlay (abandoned_at/abandoned_by_auth_user_id/abandonment_reason_code) from the extended Stage 1.1 recovery RPC", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("export async function recoverAttendeeImportRun"),
    SOURCE.indexOf("export function summarizeAttendeeImportRows"),
  );
  assert.match(fn, /abandonedAt: r\.abandoned_at/);
  assert.match(fn, /abandonedByAuthUserId: r\.abandoned_by_auth_user_id/);
  assert.match(fn, /abandonmentReasonCode: r\.abandonment_reason_code/);
});

test("a freshly staged row (not yet recovered) always starts with a null abandonment overlay -- never guessed client-side", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("export async function runGovernedAttendeeImport"),
    SOURCE.indexOf("export async function retryAttendeeImportRowCommit"),
  );
  assert.match(fn, /abandonedAt: null,\s*\n\s*abandonedByAuthUserId: null,\s*\n\s*abandonmentReasonCode: null,/);
});

test("summarizeAttendeeImportRows: counts every persisted row state and warning-bearing rows truthfully", () => {
  const overlay = { abandonedAt: null, abandonedByAuthUserId: null, abandonmentReasonCode: null };
  const rows = [
    { rowId: "1", sourceRowNumber: 2, candidate: {} as any, issues: [], rowState: "committed" as const, canonicalTargetId: "a", commitError: null, ...overlay },
    { rowId: "2", sourceRowNumber: 3, candidate: {} as any, issues: [{ code: "x", message: "m", severity: "warning" as const }], rowState: "committed" as const, canonicalTargetId: "b", commitError: null, ...overlay },
    { rowId: "3", sourceRowNumber: 4, candidate: {} as any, issues: [], rowState: "validation_failed" as const, canonicalTargetId: null, commitError: null, ...overlay },
    { rowId: "4", sourceRowNumber: 5, candidate: {} as any, issues: [], rowState: "needs_review" as const, canonicalTargetId: null, commitError: null, ...overlay },
    { rowId: "5", sourceRowNumber: 6, candidate: {} as any, issues: [], rowState: "commit_failed" as const, canonicalTargetId: null, commitError: { code: "canonical_commit_failed", message: "m" }, ...overlay },
    { rowId: "6", sourceRowNumber: 7, candidate: {} as any, issues: [], rowState: "approved" as const, canonicalTargetId: null, commitError: null, ...overlay },
  ];

  assert.deepEqual(summarizeAttendeeImportRows(rows), {
    processed: 6,
    committed: 2,
    validationFailed: 1,
    needsReview: 1,
    commitFailed: 1,
    approvedPendingCommit: 1,
    warnings: 1,
  });
});

test("summarizeAttendeeImportRows: an empty run reports all-zero counts, not a whole-file success", () => {
  assert.deepEqual(summarizeAttendeeImportRows([]), {
    processed: 0,
    committed: 0,
    validationFailed: 0,
    needsReview: 0,
    commitFailed: 0,
    approvedPendingCommit: 0,
    warnings: 0,
  });
});
