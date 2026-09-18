import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { ImportHistoryPanel } from "@/app/admin/imports/ImportHistoryPanel";

// Structural + static-render coverage for the read-only Import History
// browser. History's own data (listFinalizedImportRunHistory /
// getFinalizedImportRunHistoryDetail) loads lazily on <details> toggle,
// which does not fire under renderToStaticMarkup -- the RPC round trip
// and the manage/view authority split are proven structurally against
// source instead, matching this repo's established precedent.
//
// Run with: npx tsx --test app/admin/imports/ImportHistoryPanel.test.tsx

const SOURCE = readFileSync(fileURLToPath(new URL("./ImportHistoryPanel.tsx", import.meta.url)), "utf8");

test("renders nothing when no Event is selected", () => {
  const html = renderToStaticMarkup(<ImportHistoryPanel eventId="" importType="attendee" />);
  assert.equal(html, "");
});

test("collapsed by default and does not fetch until the admin opens it -- History loading is not automatic on the door's page load", () => {
  const html = renderToStaticMarkup(<ImportHistoryPanel eventId="event-1" importType="attendee" />);
  assert.match(html, /<details[^>]*>/);
  assert.equal(/<details[^>]*\sopen(=""|>|\s)/.test(html), false);
  assert.match(html, />Import History</);
});

test("list load is deferred to the details onToggle handler, not an effect that fires on mount", () => {
  const bodyBeforeReturn = SOURCE.slice(SOURCE.indexOf("export function ImportHistoryPanel"));
  assert.equal(/useEffect/.test(bodyBeforeReturn), false);
  assert.match(SOURCE, /onToggle=\{.*loadHistory\(\).*\}/);
});

test("a manage-only admin (no event.imports.view) sees the panel disappear silently on the specific not_authorized/42501 denial -- not a scary error for a legitimate, expected authority boundary", () => {
  assert.match(SOURCE, /function isAuthorityDenial/);
  assert.match(SOURCE, /message === "not_authorized" \|\| code === "42501"/);
  const loadFn = SOURCE.slice(SOURCE.indexOf("async function loadHistory"), SOURCE.indexOf("if (!eventId)"));
  assert.match(loadFn, /if \(isAuthorityDenial\(err\)\) \{\s*setHidden\(true\);/);
  assert.match(SOURCE, /if \(hidden\) \{\s*return null;/);
});

test("a non-authority error is still surfaced (not silently swallowed) via describeLifecycleError", () => {
  const loadFn = SOURCE.slice(SOURCE.indexOf("async function loadHistory"), SOURCE.indexOf("if (!eventId)"));
  assert.match(loadFn, /setError\(describeLifecycleError\(err\)\)/);
});

test("this panel never lists an active (staging/ready_for_review) run -- it calls only list_finalized_import_run_history, never list_active_import_runs", () => {
  assert.match(SOURCE, /listFinalizedImportRunHistory\(/);
  assert.equal(/listActiveImportRuns/.test(SOURCE), false);
});

test("import_type filtering is display-only, applied client-side after the authoritative event_id-scoped fetch", () => {
  assert.match(SOURCE, /page\.filter\(\(r\) => r\.importType === importType\)/);
});

test("finalized-run detail never references the raw staged candidate or the raw commit_result payload -- only the redacted fields the governed detail RPC already returns", () => {
  for (const forbidden of ["normalized_candidate", "commit_result", ".candidate", "raw_source"]) {
    assert.equal(SOURCE.includes(forbidden), false, `must not reference ${forbidden}`);
  }
});

test("a grandfathered finalized run with no recorded finalizer is handled, not crashed on -- falls back to an em dash", () => {
  assert.match(SOURCE, /run\.finalizedByDisplayIdentity \|\| "—"/);
});

test("the derived final outcome is shown via the shared describeFinalOutcome vocabulary, never recomputed from row counts client-side", () => {
  assert.match(SOURCE, /describeFinalOutcome\(run\.finalOutcome\)/);
  assert.match(SOURCE, /describeFinalOutcome\(detail\.run\.finalOutcome\)/);
  assert.equal(/committedCount \/ rowTotal|rowTotal === committedCount/.test(SOURCE), false);
});

test("this module makes no direct table read and calls only the two governed History RPCs", () => {
  assert.equal(/\.from\(/.test(SOURCE), false);
  assert.equal(/\.rpc\(/.test(SOURCE), false);
  assert.match(SOURCE, /listFinalizedImportRunHistory\(/);
  assert.match(SOURCE, /getFinalizedImportRunHistoryDetail\(/);
});

// -- Central UI: Imports Interior, Slice 2 Error States -------------------
//
// Both a history-list load failure and a run-detail-dialog load failure
// previously rendered via EmptyState -- wrong for a real failure, distinct
// from the panel's one genuine no-content case ("No finalized import runs
// yet..."). Neither RPC round trip resolves under renderToStaticMarkup
// (no Supabase mocking/jsdom in this repo, per this file's own header
// comment), so the error branches are proven structurally against source,
// matching the established precedent above; the two synchronously-
// reachable branches (no Event selected, collapsed-by-default) remain
// exercised by actually rendering the real production component.

test("the history-list load failure renders through the shared Alert (tone danger) at its exact existing location, not EmptyState", () => {
  const bodyStart = SOURCE.indexOf('<summary style={{ cursor: "pointer", fontWeight: 600 }}>Import History</summary>');
  const bodyEnd = SOURCE.indexOf("{runs.length ? (", bodyStart);
  const body = SOURCE.slice(bodyStart, bodyEnd);
  assert.match(body, /\{error \? <Alert tone="danger">\{error\}<\/Alert> : null\}/);
  assert.equal(/<EmptyState message=\{error\}/.test(body), false);
});

test("the run-detail dialog's load failure renders through the shared Alert (tone danger) at its exact existing location, not EmptyState", () => {
  const dialogStart = SOURCE.indexOf("function RunDetailDialog");
  const dialogEnd = SOURCE.indexOf("\nexport type ImportHistoryPanelProps");
  const body = SOURCE.slice(dialogStart, dialogEnd);
  assert.match(body, /\{loading \? <LoadingState message="Loading run detail\.\.\." \/> : null\}\s*\n\s*\{error \? <Alert tone="danger">\{error\}<\/Alert> : null\}/);
  assert.equal(/<EmptyState message=\{error\}/.test(body), false);
});

test("exactly two danger Alerts exist (list load + detail dialog), Alert is imported, and no error is ever rendered through EmptyState anywhere in this file", () => {
  assert.match(SOURCE, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
  assert.equal((SOURCE.match(/<Alert tone="danger">\{error\}<\/Alert>/g) || []).length, 2);
  assert.equal(/<EmptyState message=\{error\}/.test(SOURCE), false);
});

test("the genuine no-content EmptyState (no finalized runs yet) keeps its exact prior message and import, unaffected by the error-path change", () => {
  assert.match(SOURCE, /import \{ EmptyState \} from "@\/components\/ui\/EmptyState";/);
  assert.match(
    SOURCE,
    /<EmptyState message="No finalized import runs yet for this door on this Event\." \/>/,
  );
  assert.equal((SOURCE.match(/<EmptyState\b/g) || []).length, 1);
});

test("loading, table, dialog, details/summary, status-badge, and Load More form-action behavior are all unchanged around the error-path edits", () => {
  assert.match(SOURCE, /<details onToggle=\{/);
  assert.match(SOURCE, /<DataTable caption="Finalized import run history">/);
  assert.match(SOURCE, /<DataTable caption="Finalized run rows">/);
  assert.match(SOURCE, /<Dialog\s*\n\s*open\s*\n\s*onClose=\{onClose\}/);
  assert.match(SOURCE, /<StatusBadge tone=\{outcome\.tone\}>\{outcome\.label\}<\/StatusBadge>/);
  assert.match(SOURCE, /<FormActions>\s*\n\s*<AppButton\s*\n\s*variant="secondary"\s*\n\s*loading=\{loading\}/);
});

test("the authority-denial silent-hide path and describeLifecycleError/RPC call sites are unchanged by the error-path edits", () => {
  assert.match(SOURCE, /if \(isAuthorityDenial\(err\)\) \{\s*\n\s*setHidden\(true\);/);
  assert.match(SOURCE, /if \(hidden\) \{\s*\n\s*return null;\s*\n\s*\}/);
  assert.match(SOURCE, /setError\(describeLifecycleError\(err\)\)/g);
  assert.equal((SOURCE.match(/describeLifecycleError\(err\)/g) || []).length, 2);
});

test("renders nothing when no Event is selected, and stays collapsed/unfetched until opened -- both real production component branches remain unaffected by the error-path change", () => {
  const emptyHtml = renderToStaticMarkup(<ImportHistoryPanel eventId="" importType="attendee" />);
  assert.equal(emptyHtml, "");

  const collapsedHtml = renderToStaticMarkup(<ImportHistoryPanel eventId="event-1" importType="attendee" />);
  assert.match(collapsedHtml, /<details[^>]*>/);
  assert.equal(/<details[^>]*\sopen(=""|>|\s)/.test(collapsedHtml), false);
});
