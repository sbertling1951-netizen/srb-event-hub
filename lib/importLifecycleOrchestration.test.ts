import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ABANDONMENT_REASON_OPTIONS,
  describeFinalOutcome,
  describeLifecycleError,
} from "./importLifecycleOrchestration.ts";

// Same precedent as the other orchestration modules (see
// lib/attendeeImportOrchestration.test.ts): this repo has no HTTP/Supabase
// mocking infrastructure, so the actual RPC round trips are proven
// structurally against source; pure functions are executed for real.
//
// Run with: npx tsx --test lib/importLifecycleOrchestration.test.ts

const SOURCE = readFileSync(fileURLToPath(new URL("./importLifecycleOrchestration.ts", import.meta.url)), "utf8");

test("calls only the eight governed Row Lifecycle / History RPCs -- no other RPC, no direct table access", () => {
  const allowed = new Set([
    "list_active_import_runs",
    "list_finalized_import_run_history",
    "get_finalized_import_run_history_detail",
    "get_import_run_status",
    "close_import_run_staging",
    "abandon_import_run_row",
    "abandon_import_run_open_rows",
    "finalize_import_run",
  ]);
  const calls = [...SOURCE.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.equal(calls.length, 8);
  for (const call of calls) {
    assert.ok(allowed.has(call), `unexpected RPC call: ${call}`);
  }
  assert.equal(/\.from\(/.test(SOURCE), false);
});

test("getImportRunStatus is documented as event.imports.view-gated and distinct from the manage-gated active-run list, so callers can handle a legitimate denial", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("export type ImportRunStatus"), SOURCE.indexOf("export async function closeImportRunStaging"));
  assert.match(fn, /event\.imports\.view/);
  assert.match(fn, /\.rpc\("get_import_run_status"/);
});

test("never calls a canonical Attendee/Vendor commit, admission, or identity RPC -- lifecycle is Imports-domain-only", () => {
  for (const forbidden of [
    "commit_attendee_import_run_row",
    "commit_vendor_import_run_row",
    "record_attendee_import_run_row_commit_failure",
    "record_vendor_import_run_row_commit_failure",
    "admit_vendor_for_event",
    "revoke_vendor_admission",
    "update_event_vendor_metadata",
    "manage_attendee_household_member",
    "get_managed_import_run_recovery",
  ]) {
    assert.equal(SOURCE.includes(forbidden), false, `must not reference ${forbidden}`);
  }
});

test("list_active_import_runs is called with only the Event id -- no client-side filtering claims to replace the server's own event_id scoping", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("export async function listActiveImportRuns"), SOURCE.indexOf("export async function listFinalizedImportRunHistory"));
  assert.match(fn, /p_event_id: eventId/);
});

test("abandonImportRunRow and abandonImportRunOpenRows both require a bounded reason code parameter -- no free-text reason path", () => {
  const rowFn = SOURCE.slice(SOURCE.indexOf("export async function abandonImportRunRow"), SOURCE.indexOf("export async function abandonImportRunOpenRows"));
  const runFn = SOURCE.slice(SOURCE.indexOf("export async function abandonImportRunOpenRows"), SOURCE.indexOf("export async function finalizeImportRun"));
  assert.match(rowFn, /reasonCode: AbandonmentReasonCode/);
  assert.match(rowFn, /p_abandonment_reason_code: reasonCode/);
  assert.match(runFn, /reasonCode: AbandonmentReasonCode/);
  assert.match(runFn, /p_abandonment_reason_code: reasonCode/);
});

test("ABANDONMENT_REASON_OPTIONS matches exactly the five codes bounded by the 20260822170000 CHECK constraint", () => {
  const codes = ABANDONMENT_REASON_OPTIONS.map((o) => o.code).sort();
  assert.deepEqual(codes, [
    "cannot_resolve",
    "duplicate_intentionally_dismissed",
    "operator_declined",
    "other",
    "source_superseded",
  ]);
  for (const option of ABANDONMENT_REASON_OPTIONS) {
    assert.ok(option.label.length > 0, option.code);
  }
});

test("describeFinalOutcome: every approved derived-outcome value maps to a distinct label/tone, and an unfinalized run is distinguishable from every finalized outcome", () => {
  const completed = describeFinalOutcome("completed");
  const withErrors = describeFinalOutcome("completed_with_errors");
  const abandoned = describeFinalOutcome("abandoned");
  const mixed = describeFinalOutcome("mixed");
  const none = describeFinalOutcome(null);

  const labels = [completed.label, withErrors.label, abandoned.label, mixed.label, none.label];
  assert.equal(new Set(labels).size, labels.length, "every outcome has a distinct label");

  assert.equal(completed.tone, "success");
  assert.equal(withErrors.tone, "warning");
  assert.equal(abandoned.tone, "danger");
  assert.equal(mixed.tone, "warning");
  assert.equal(none.tone, "neutral");
});

test("describeLifecycleError: bounded governed denial codes map to admin-readable text, never the raw code or PostgrestError text", () => {
  for (const message of [
    "not_authorized",
    "import_run_not_closable",
    "import_run_not_mutable",
    "import_row_terminal_or_retry_owned",
    "import_row_terminal",
    "import_row_already_abandoned",
    "invalid_abandonment_reason_code",
    "import_run_not_ready_for_review",
    "import_run_has_open_rows",
    "event_archived",
  ]) {
    const described = describeLifecycleError({ message });
    assert.notEqual(described, message, message);
    assert.ok(described.length > 0);
  }
});

test("describeLifecycleError: an anon-style 42501 or an unrecognized error never leaks raw SQL/PostgREST text", () => {
  assert.equal(describeLifecycleError({ code: "42501", message: "permission denied for function close_import_run_staging" }), "You do not have the required authority for this action.");
  const fallback = describeLifecycleError({ message: "column import_run_rows.foo does not exist" });
  assert.equal(/column|does not exist|SQLSTATE/.test(fallback), false);
});
