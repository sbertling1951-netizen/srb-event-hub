import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural regression coverage for the Stage 5B.3 Vendor Import UI. This
// repo has no React-rendering test harness for this page (see
// app/admin/imports/page.test.ts's own precedent) -- these assertions read
// the component source directly.
//
// Run with: npx tsx --test app/admin/imports/VendorImportWorkflow.test.ts

const SOURCE = readFileSync(fileURLToPath(new URL("./VendorImportWorkflow.tsx", import.meta.url)), "utf8");

test("the only direct Supabase table access is a read of events (for the target-Event picker) -- everything else routes through the orchestration module", () => {
  const fromCalls = [...SOURCE.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(fromCalls, ["events"]);
  assert.equal(/\.insert\(/.test(SOURCE), false);
  assert.equal(/\.update\(/.test(SOURCE), false);
  assert.equal(/\.upsert\(/.test(SOURCE), false);
  assert.equal(/\.delete\(/.test(SOURCE), false);
});

test("no direct RPC call is made from this component -- every governed mutation goes through lib/vendorImportOrchestration.ts", () => {
  assert.equal(/\.rpc\(/.test(SOURCE), false);
});

test("no canonical Vendor identity write, admission grant, metadata write, or revoke is referenced anywhere in this file", () => {
  for (const forbidden of [
    "register_vendor_self",
    "admit_vendor_for_event",
    "revoke_vendor_admission",
    "update_event_vendor_metadata",
    'from("vendors")',
    'from("event_vendors")',
    'from("vendor_event_applications")',
    'from("vendor_event_dispositions")',
    'from("import_runs")',
    'from("import_run_rows")',
  ]) {
    assert.equal(SOURCE.includes(forbidden), false, `must not reference ${forbidden}`);
  }
});

test("imports the governed orchestration functions from lib/vendorImportOrchestration -- does not reimplement commit/retry/recovery inline", () => {
  const importIdx = SOURCE.indexOf('from "@/lib/vendorImportOrchestration"');
  assert.notEqual(importIdx, -1);
  const importBlock = SOURCE.slice(SOURCE.lastIndexOf("import", importIdx), importIdx);
  for (const name of ["runGovernedVendorImport", "retryVendorImportRowCommit", "recoverVendorImportRun"]) {
    assert.match(importBlock, new RegExp(name));
  }
});

test("normalizes/previews rows exclusively through the Stage 5B.1 contract, not a page-local parser", () => {
  assert.match(SOURCE, /import\s*\{[^}]*interpretVendorImportRow[^}]*\}\s*from\s*"@\/lib\/vendorImportContract"/s);
  assert.equal(/function interpretVendorRow|function parseVendorRow/.test(SOURCE), false);
});

test("Import is only enabled for approved-eligible state and never claims blanket success from a mixed result", () => {
  assert.match(SOURCE, /disabled=\{importing \|\| parsing \|\| !selectedEventId \|\| !rawRows\.length \|\| eventChangedSinceLoad\}/);
  assert.match(SOURCE, /summary\.committed > 0 && summary\.committed === summary\.processed/);
});

test("retry is offered only for commit_failed rows and reuses the shared retry path -- no second commit implementation", () => {
  assert.match(SOURCE, /row\.rowState === "commit_failed"/);
  assert.match(SOURCE, /retryVendorImportRowCommit\(\{ rowId: row\.rowId \}\)/);
});

test("the Vendors-workspace handoff is offered only for review reasons that actually require canonical identity work", () => {
  assert.match(SOURCE, /vendorReviewRequiresIdentityWork\(row\.reviewReasonCode\)/);
  assert.match(SOURCE, /href="\/admin\/vendors"/);
});

test("row-state presentation uses the shared StatusBadge primitive, not page-local color logic", () => {
  assert.match(SOURCE, /import\s*\{\s*StatusBadge/);
  assert.equal(/background:\s*["'`]#/.test(SOURCE), false);
});

test("actions use the shared AppButton/AppLinkButton primitives, not raw hand-styled <button>/<a>", () => {
  assert.match(SOURCE, /import\s*\{\s*AppButton,\s*AppLinkButton\s*\}\s*from\s*"@\/components\/ui\/AppButton"/);
  assert.equal(/<button\b/.test(SOURCE), false);
});

test("only the run ID is persisted as a browser locator -- never row/matching truth -- and recovery always re-reads the server", () => {
  const storageBlock = SOURCE.slice(SOURCE.indexOf("function activeVendorRunStorageKey"), SOURCE.indexOf("const ROW_STATE_TONE"));
  assert.match(storageBlock, /localStorage\.(setItem|getItem|removeItem)\(activeVendorRunStorageKey/);
  assert.equal(/JSON\.stringify\(/.test(storageBlock), false);
  assert.match(SOURCE, /recoverVendorImportRun\(storedRunId\)/);
});

// -- Import Run Lifecycle + History UI hookup ------------------------------
//
// docs/architecture/EPICENTRAX_GOVERNED_IMPORT_STAGING_ARCHITECTURE.md,
// Stage 20260822170000. The Vendor door wires discovery (ActiveRunsPanel),
// run-level lifecycle control (RunLifecycleActions), per-row abandonment
// (AbandonRowButton), and read-only History (ImportHistoryPanel) around the
// existing, unmodified Stage 5B.3 governed workflow.

test("Active Runs discovery is wired for the Vendor door, scoped to importType=\"vendor\"", () => {
  const start = SOURCE.indexOf("<ActiveRunsPanel");
  assert.notEqual(start, -1);
  const jsx = SOURCE.slice(start, SOURCE.indexOf("/>", start));
  assert.match(jsx, /importType="vendor"/);
  assert.match(jsx, /eventId=\{selectedEventId\}/);
});

test("Resume goes through the same governed recovery path as the mount-time locator recovery -- recoverVendorImportRun, never a fabricated local run state", () => {
  const start = SOURCE.indexOf("async function handleResumeRun(");
  const body = SOURCE.slice(start, SOURCE.indexOf("\n  const eventChangedSinceLoad"));
  assert.match(body, /recoverVendorImportRun\(runId\)/);
  assert.match(body, /saveActiveVendorRunId\(selectedEventId, runId\)/);
});

test("RunLifecycleActions is only rendered once the recovered/created run's own lifecycle status is known -- never assumed", () => {
  const start = SOURCE.indexOf("<RunLifecycleActions");
  assert.notEqual(start, -1);
  const guardedBlock = SOURCE.slice(SOURCE.lastIndexOf("runStatus ?", start), start);
  assert.match(guardedBlock, /runStatus \? \(/);
  const jsx = SOURCE.slice(start, SOURCE.indexOf("/>", start));
  assert.match(jsx, /runId=\{runResult\.runId\}/);
  assert.match(jsx, /status=\{runStatus\}/);
  assert.match(jsx, /rows=\{runResult\.rows\}/);
});

test("abandoning remaining open rows re-reads the governed recovery RPC rather than guessing which rows changed -- abandon_import_run_open_rows returns only a count, not per-row detail", () => {
  const start = SOURCE.indexOf("async function handleOpenRowsAbandoned(");
  const body = SOURCE.slice(start, SOURCE.indexOf("\n  function handleStagingClosed"));
  assert.match(body, /recoverVendorImportRun\(runResult\.runId\)/);
});

test("a single row abandon merges only the exact overlay the governed RPC returned -- no other field is touched", () => {
  const start = SOURCE.indexOf("function handleRowAbandoned(");
  const body = SOURCE.slice(start, SOURCE.indexOf("\n  async function handleOpenRowsAbandoned"));
  assert.match(body, /r\.rowId === rowId \? \{ \.\.\.r, \.\.\.overlay \} : r/);
});

test("finalizing a run clears the localStorage run-id locator and drops the run out of local editable state -- the run becomes read-only and moves to History", () => {
  const start = SOURCE.indexOf("function handleFinalized(");
  const body = SOURCE.slice(start, SOURCE.indexOf("\n  const selectedEvent"));
  assert.match(body, /saveActiveVendorRunId\(selectedEventId, null\)/);
  assert.match(body, /setRunResult\(null\)/);
});

test("AbandonRowButton is offered in the results Action cell, alongside the existing unmodified Retry and Vendor-workspace-handoff controls", () => {
  const start = SOURCE.indexOf("<AbandonRowButton");
  assert.notEqual(start, -1);
  const jsx = SOURCE.slice(start, SOURCE.indexOf("/>", start));
  assert.match(jsx, /onAbandoned=\{handleRowAbandoned\}/);
  assert.match(SOURCE, /row\.rowState === "commit_failed" \? \(/);
  assert.match(SOURCE, /vendorReviewRequiresIdentityWork\(row\.reviewReasonCode\)/);
});

test("Import History is wired for the Vendor door, scoped to importType=\"vendor\"", () => {
  assert.match(SOURCE, /<ImportHistoryPanel eventId=\{selectedEventId\} importType="vendor" \/>/);
});

test("a stale/invalid stored run id fails recovery safely -- the locator is cleared and local run state is nulled, never left showing stale data", () => {
  const start = SOURCE.indexOf("const storedRunId = loadActiveVendorRunId(selectedEventId);");
  const body = SOURCE.slice(start, SOURCE.indexOf("\n  // Explicit resume from the Active Runs panel"));
  const catchBlock = body.slice(body.indexOf("} catch (err) {"));
  assert.match(catchBlock, /saveActiveVendorRunId\(selectedEventId, null\)/);
  assert.match(catchBlock, /setRunResult\(null\)/);
});

test("localStorage is a locator only, never the sole source of truth for active-run discovery -- ActiveRunsPanel discovers runs server-side independent of any stored id", () => {
  const activeRunsPanelJsx = SOURCE.slice(SOURCE.indexOf("<ActiveRunsPanel"), SOURCE.indexOf("<ActiveRunsPanel") + 400);
  assert.equal(/loadActiveVendorRunId|localStorage/.test(activeRunsPanelJsx), false);
});

test("the lifecycle/history components are imported from their own shared modules, not defined inline in this file", () => {
  assert.match(SOURCE, /import \{ ActiveRunsPanel \} from "\.\/ActiveRunsPanel";/);
  assert.match(SOURCE, /import \{ ImportHistoryPanel \} from "\.\/ImportHistoryPanel";/);
  assert.match(
    SOURCE,
    /import \{ AbandonRowButton, RunLifecycleActions \} from "\.\/RunLifecycleActions";/,
  );
});
