import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { ActiveRunsPanel } from "@/app/admin/imports/ActiveRunsPanel";

// Structural + static-render coverage for the active-run discovery panel.
// The panel's own data comes from an effect (listActiveImportRuns), which
// does not fire under renderToStaticMarkup -- see
// lib/importLifecycleOrchestration.test.ts and this repo's established
// precedent (no Supabase mocking, no jsdom) for why the RPC round trip
// itself is proven structurally against source instead.
//
// Run with: npx tsx --test app/admin/imports/ActiveRunsPanel.test.tsx

const SOURCE = readFileSync(fileURLToPath(new URL("./ActiveRunsPanel.tsx", import.meta.url)), "utf8");

test("renders nothing when no Event is selected -- discovery has nothing to scope to", () => {
  const html = renderToStaticMarkup(
    <ActiveRunsPanel eventId="" importType="attendee" onResume={() => {}} />,
  );
  assert.equal(html, "");
});

test("calls list_active_import_runs (via listActiveImportRuns) scoped only by the Event id -- no import_type or status param claims to replace server-side authority scoping", () => {
  const callSite = SOURCE.slice(SOURCE.indexOf("listActiveImportRuns("), SOURCE.indexOf("listActiveImportRuns(") + 40);
  assert.match(callSite, /listActiveImportRuns\(eventId\)/);
});

test("import_type filtering is display-only, applied after the authoritative event_id-scoped fetch resolves -- never a server-call parameter", () => {
  assert.match(SOURCE, /\.filter\(\(run\) => run\.importType === importType\)/);
});

test("Resume triggers the caller-supplied onResume with the run id -- this panel never calls recovery itself, so resume always goes through the door's own governed recovery path", () => {
  assert.match(SOURCE, /onClick=\{\(\) => onResume\(run\.importRunId\)\}/);
  // Excludes // comment lines -- the module's own doc comment names
  // recoverAttendeeImportRun/recoverVendorImportRun as *not* this
  // component's concern, which would otherwise false-positive here.
  const executable = SOURCE.replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/recover\w*ImportRun\(/.test(executable), false);
});

test("this module makes no direct table read and no RPC other than listActiveImportRuns -- discovery is entirely owned by the governed list_active_import_runs RPC", () => {
  assert.equal(/\.from\(/.test(SOURCE), false);
  assert.equal(/\.rpc\(/.test(SOURCE), false);
});

test("status presentation uses the shared StatusBadge primitive, not page-local color logic", () => {
  assert.match(SOURCE, /import\s*\{\s*StatusBadge/);
});

test("a fetch failure is described via describeLifecycleError -- never the raw PostgrestError surfaced to the admin", () => {
  assert.match(SOURCE, /describeLifecycleError\(err\)/);
});

test("a door can receive the governed active-run count and disable creation of a competing run", () => {
  assert.match(SOURCE, /onRunCountChanged\?: \(count: number \| null\) => void/);
  assert.match(SOURCE, /onRunCountChanged\?\.\(matchingRuns\.length\)/);
  assert.match(SOURCE, /onRunCountChanged\?\.\(null\)/);
});

// -- Central UI: Imports Interior, Slice 2 Error States -------------------
//
// A fetch failure (listActiveImportRuns rejecting) previously rendered via
// EmptyState -- a "there is nothing here" neutral presentation, wrong for
// a real failure. discovery has no Supabase mocking/jsdom in this repo
// (see this file's own header comment), so the error branch itself is
// proven structurally against source, exactly like the RPC round trip
// above; the "no Event selected" branch remains the one path exercised by
// actually rendering the real production component.

test("a fetch failure renders through the shared Alert (tone danger) at its exact existing location -- exactly once, and never through EmptyState", () => {
  assert.match(SOURCE, /if \(error\) \{\s*\n\s*return <Alert tone="danger">\{error\}<\/Alert>;\s*\n\s*\}/);
  assert.equal((SOURCE.match(/<Alert tone="danger">/g) || []).length, 1);
  assert.equal(/<EmptyState/.test(SOURCE), false);
  assert.match(SOURCE, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
});

test("the now-fully-unused EmptyState import was removed -- this panel has no genuine no-content EmptyState case (zero active runs renders nothing, not an empty state)", () => {
  assert.equal(/from "@\/components\/ui\/EmptyState"/.test(SOURCE), false);
  assert.match(SOURCE, /if \(!runs\.length\) \{\s*\n\s*return null;\s*\n\s*\}/);
});

test("the error branch sits before the loading/table branches are reachable, and does not disturb them -- loading and the DataTable render exactly as before", () => {
  assert.match(SOURCE, /if \(loading\) \{\s*\n\s*return <LoadingState message="Checking for active import runs\.\.\." \/>;\s*\n\s*\}/);
  const errorIdx = SOURCE.indexOf("if (error) {");
  const loadingIdx = SOURCE.indexOf("if (loading) {");
  assert.ok(loadingIdx > -1 && loadingIdx < errorIdx, "loading is still checked before error, unchanged order");
  assert.match(SOURCE, /<DataTable caption="Active import runs on this Event">/);
});

test("renders nothing when no Event is selected -- the real production component's one synchronously-reachable branch is unaffected by the error-path change", () => {
  const html = renderToStaticMarkup(
    <ActiveRunsPanel eventId="" importType="attendee" onResume={() => {}} />,
  );
  assert.equal(html, "");
});
