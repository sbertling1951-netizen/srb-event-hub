import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  describeVendorReviewReason,
  summarizeVendorImportRows,
  vendorReviewRequiresIdentityWork,
} from "./vendorImportOrchestration.ts";

// Same precedent as lib/attendeeImportOrchestration.test.ts (see its own
// comment / lib/adminTaskAuthority.test.ts): this repo has no HTTP/Supabase
// mocking infrastructure, so the actual RPC round trips are proven
// structurally against source; pure functions are executed for real.
//
// Run with: npx tsx --test lib/vendorImportOrchestration.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./vendorImportOrchestration.ts", import.meta.url)),
  "utf8",
);

test("uses the shared Stage 5B.1 contract for interpretation -- no page-local Vendor parser", () => {
  const importBlock = SOURCE.slice(0, SOURCE.indexOf('from "@/lib/vendorImportContract"'));
  assert.match(importBlock, /interpretVendorImportRow/);
});

test("run creation happens once, before any row staging", () => {
  const createIdx = SOURCE.indexOf('.rpc("create_import_run"');
  const stageIdx = SOURCE.indexOf('.rpc("stage_import_run_row"');
  assert.ok(createIdx > -1 && stageIdx > -1);
  assert.ok(createIdx < stageIdx);
  assert.equal((SOURCE.match(/\.rpc\("create_import_run"/g) || []).length, 1);
});

test("create_import_run is called with the Vendor import type", () => {
  assert.match(SOURCE, /p_import_type: "vendors"/);
});

test("every staged row is immediately given a persisted validation/review state via Stage 1 -- never left pending", () => {
  const runFn = SOURCE.slice(
    SOURCE.indexOf("export async function runGovernedVendorImport"),
    SOURCE.indexOf("export async function retryVendorImportRowCommit"),
  );
  const stageIdx = runFn.indexOf('.rpc("stage_import_run_row"');
  const reviewIdx = runFn.indexOf('.rpc("set_import_run_row_review_state"');
  assert.ok(stageIdx > -1 && reviewIdx > -1 && stageIdx < reviewIdx);
});

test("state mapping: only Stage 5B.1 validity decides approved vs unreviewed at staging time -- no client-side matching/ambiguity decision", () => {
  assert.match(
    SOURCE,
    /const validationState = interp\.validation_state === "validation_failed" \? "invalid" : "valid";/,
  );
  assert.match(SOURCE, /const reviewState = validationState === "invalid" \? "unreviewed" : "approved";/);
  // Matching/ambiguity (zero/multiple match, inactive, conflict, same-file
  // duplicate) is exclusively Stage 5B.2's job -- this module must never
  // compute or stage a needs_review verdict on its own.
  const runFn = SOURCE.slice(
    SOURCE.indexOf("export async function runGovernedVendorImport"),
    SOURCE.indexOf("export async function retryVendorImportRowCommit"),
  );
  assert.equal(/needs_review/.test(runFn), false);
});

test("only approved rows are ever sent to Stage 5B.2 commit", () => {
  const runFn = SOURCE.slice(
    SOURCE.indexOf("export async function runGovernedVendorImport"),
    SOURCE.indexOf("export async function retryVendorImportRowCommit"),
  );
  assert.match(runFn, /if \(result\.rowState !== "approved"\) \{/);
});

test("a Stage 5B.2 needs_review outcome is trusted as already persisted -- this module never re-writes it", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("async function attemptVendorCommit"));
  const needsReviewBranch = fn.slice(
    fn.indexOf('outcome?.outcome === "needs_review"'),
    fn.indexOf("throw new Error(`unrecognized_commit_outcome"),
  );
  assert.equal(/set_import_run_row_review_state/.test(needsReviewBranch), false);
  assert.equal(/record_vendor_import_run_row_commit_failure/.test(needsReviewBranch), false);
  assert.match(needsReviewBranch, /already persisted/);
});

test("committed and already_committed both resolve to the committed row state, with no canonical mutation performed client-side", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("async function attemptVendorCommit"),
    SOURCE.indexOf("export async function runGovernedVendorImport"),
  );
  assert.match(fn, /outcome\?\.outcome === "committed" \|\| outcome\?\.outcome === "already_committed"/);
});

test("genuine canonical failures are classified into exactly one of the four allowed Stage 5B.2 Vendor codes -- never arbitrary exception text", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("function classifyVendorCommitFailureCode"),
    SOURCE.indexOf("async function attemptVendorCommit"),
  );
  for (const code of ["vendor_commit_denied", "vendor_commit_conflict", "vendor_commit_unavailable", "vendor_commit_failed"]) {
    assert.match(fn, new RegExp(code));
  }
  assert.equal((fn.match(/return "vendor_commit_/g) || []).length, 4);
});

test("failure recording sends only the classified code, never the raw error message or stack", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("async function attemptVendorCommit"),
    SOURCE.indexOf("export async function runGovernedVendorImport"),
  );
  assert.match(
    fn,
    /record_vendor_import_run_row_commit_failure["'],\s*\{\s*p_import_run_row_id: rowId,\s*p_failure_code: failureCode,?\s*\}/,
  );
});

test("a failure that cannot be recorded (the failure recorder also fails) is surfaced as a distinct orchestration failure, not silently dropped or misclassified as commit_failed", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("async function attemptVendorCommit"),
    SOURCE.indexOf("export async function runGovernedVendorImport"),
  );
  const catchBranch = fn.slice(fn.lastIndexOf("catch (recordErr)"));
  assert.match(catchBranch, /orchestration_failed/);
  assert.equal(/rowState: "commit_failed"/.test(catchBranch), false);
});

test("retry reuses the exact same commit-and-classify path as the initial run -- no second writer", () => {
  assert.equal((SOURCE.match(/\.rpc\("commit_vendor_import_run_row"/g) || []).length, 1);
  const retryFn = SOURCE.slice(SOURCE.indexOf("export async function retryVendorImportRowCommit"));
  assert.match(retryFn, /attemptVendorCommit\(/);
});

test("recovery reads only the governed recovery RPC -- never a raw staging-table read", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("export async function recoverVendorImportRun"),
    SOURCE.indexOf("export function summarizeVendorImportRows"),
  );
  assert.match(fn, /\.rpc\("get_managed_import_run_recovery"/);
  assert.equal(/\.from\(/.test(fn), false);
});

test("this module never performs a direct browser table mutation against any canonical or staging table -- RPCs only", () => {
  assert.equal(/\.from\(/.test(SOURCE), false);
});

test("recovered rows surface the Row Lifecycle abandonment overlay (abandoned_at/abandoned_by_auth_user_id/abandonment_reason_code) from the extended Stage 1.1 recovery RPC", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("export async function recoverVendorImportRun"),
    SOURCE.indexOf("export function summarizeVendorImportRows"),
  );
  assert.match(fn, /abandonedAt: r\.abandoned_at/);
  assert.match(fn, /abandonedByAuthUserId: r\.abandoned_by_auth_user_id/);
  assert.match(fn, /abandonmentReasonCode: r\.abandonment_reason_code/);
});

test("a freshly staged row (not yet recovered) always starts with a null abandonment overlay -- never guessed client-side", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("export async function runGovernedVendorImport"),
    SOURCE.indexOf("export async function retryVendorImportRowCommit"),
  );
  assert.match(fn, /abandonedAt: null,\s*\n\s*abandonedByAuthUserId: null,\s*\n\s*abandonmentReasonCode: null,/);
});

test("this module never calls a Vendor identity write, admission-revoke, or any RPC other than the six governed Imports/Stage 5B.2 operations", () => {
  const allowed = new Set([
    "create_import_run",
    "stage_import_run_row",
    "set_import_run_row_review_state",
    "commit_vendor_import_run_row",
    "record_vendor_import_run_row_commit_failure",
    "get_managed_import_run_recovery",
  ]);
  const calls = [...SOURCE.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.ok(allowed.has(call), `unexpected RPC call: ${call}`);
  }
  for (const forbidden of [
    "register_vendor_self",
    "update_vendor",
    "reactivate_vendor",
    "revoke_vendor_admission",
    "admit_vendor_for_event",
    "update_event_vendor_metadata",
  ]) {
    assert.equal(SOURCE.includes(forbidden), false, `must not reference ${forbidden} directly -- Stage 5B.2 owns that call`);
  }
});

test("describeVendorReviewReason: every Stage 5B.2 bounded reason code has a distinct, truthful description", () => {
  const codes = [
    "vendor_not_found",
    "vendor_identity_ambiguous",
    "vendor_inactive",
    "vendor_identity_conflict",
    "vendor_duplicate_in_import",
    "vendor_not_admitted",
  ];
  const descriptions = codes.map((code) => describeVendorReviewReason(code));
  assert.equal(new Set(descriptions).size, codes.length);
  assert.notEqual(describeVendorReviewReason(null), descriptions[0]);
});

test("vendorReviewRequiresIdentityWork: only true canonical-identity reasons route to the Vendors workspace", () => {
  for (const code of ["vendor_not_found", "vendor_identity_ambiguous", "vendor_inactive", "vendor_identity_conflict"]) {
    assert.equal(vendorReviewRequiresIdentityWork(code), true, code);
  }
  for (const code of ["vendor_duplicate_in_import", "vendor_not_admitted", null, "something_else"]) {
    assert.equal(vendorReviewRequiresIdentityWork(code), false, String(code));
  }
});

test("summarizeVendorImportRows: counts every persisted row state and warning-bearing rows truthfully", () => {
  const overlay = { abandonedAt: null, abandonedByAuthUserId: null, abandonmentReasonCode: null };
  const rows = [
    { rowId: "1", sourceRowNumber: 2, candidate: {} as any, issues: [], rowState: "committed" as const, canonicalVendorId: "a", reviewReasonCode: null, commitError: null, ...overlay },
    { rowId: "2", sourceRowNumber: 3, candidate: {} as any, issues: [{ code: "x", message: "m", severity: "warning" as const }], rowState: "committed" as const, canonicalVendorId: "b", reviewReasonCode: null, commitError: null, ...overlay },
    { rowId: "3", sourceRowNumber: 4, candidate: {} as any, issues: [], rowState: "validation_failed" as const, canonicalVendorId: null, reviewReasonCode: null, commitError: null, ...overlay },
    { rowId: "4", sourceRowNumber: 5, candidate: {} as any, issues: [], rowState: "needs_review" as const, canonicalVendorId: null, reviewReasonCode: "vendor_not_found" as const, commitError: null, ...overlay },
    { rowId: "5", sourceRowNumber: 6, candidate: {} as any, issues: [], rowState: "commit_failed" as const, canonicalVendorId: null, reviewReasonCode: null, commitError: { code: "vendor_commit_failed", message: "m" }, ...overlay },
    { rowId: "6", sourceRowNumber: 7, candidate: {} as any, issues: [], rowState: "approved" as const, canonicalVendorId: null, reviewReasonCode: null, commitError: null, ...overlay },
  ];

  assert.deepEqual(summarizeVendorImportRows(rows), {
    processed: 6,
    committed: 2,
    validationFailed: 1,
    needsReview: 1,
    commitFailed: 1,
    approvedPendingCommit: 1,
    warnings: 1,
  });
});

test("summarizeVendorImportRows: an empty run reports all-zero counts, not a whole-file success", () => {
  assert.deepEqual(summarizeVendorImportRows([]), {
    processed: 0,
    committed: 0,
    validationFailed: 0,
    needsReview: 0,
    commitFailed: 0,
    approvedPendingCommit: 0,
    warnings: 0,
  });
});
