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
