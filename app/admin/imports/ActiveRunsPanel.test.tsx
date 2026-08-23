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
