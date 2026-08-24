import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import {
  AbandonRowButton,
  isRowAbandonEligible,
  RunLifecycleActions,
} from "@/app/admin/imports/RunLifecycleActions";

// Focused coverage for the Import Run Lifecycle + History UI hookup's
// shared run-level control strip and per-row abandon control. Dialog's own
// portal/focus/Escape mechanics are not testable via renderToStaticMarkup
// in this repo (see components/ui/Dialog.tsx's own doc comment) -- every
// case below exercises the open="false" (server-rendered) shape, which is
// exactly the gating logic (which controls a given status/row-state shows)
// this stage needs to prove.
//
// Run with: npx tsx --test app/admin/imports/RunLifecycleActions.test.tsx

const noop = () => {};

test("isRowAbandonEligible: committed and validation_failed rows are never eligible -- these are terminal by rowState alone", () => {
  assert.equal(isRowAbandonEligible({ rowId: "1", rowState: "committed", abandonedAt: null }), false);
  assert.equal(isRowAbandonEligible({ rowId: "2", rowState: "validation_failed", abandonedAt: null }), false);
});

test("isRowAbandonEligible: an already-abandoned row is never eligible again, regardless of rowState", () => {
  assert.equal(
    isRowAbandonEligible({ rowId: "3", rowState: "needs_review", abandonedAt: "2026-08-22T00:00:00Z" }),
    false,
  );
});

test("isRowAbandonEligible: needs_review, approved, and commit_failed rows (not yet abandoned) are eligible", () => {
  for (const rowState of ["needs_review", "approved", "commit_failed", "parsed"]) {
    assert.equal(isRowAbandonEligible({ rowId: "x", rowState, abandonedAt: null }), true, rowState);
  }
});

test("AbandonRowButton renders nothing for a terminal row -- committed, validation_failed, and already-abandoned rows offer no control", () => {
  for (const row of [
    { rowId: "1", rowState: "committed", abandonedAt: null },
    { rowId: "2", rowState: "validation_failed", abandonedAt: null },
    { rowId: "3", rowState: "approved", abandonedAt: "2026-08-22T00:00:00Z" },
  ]) {
    const html = renderToStaticMarkup(<AbandonRowButton row={row} onAbandoned={noop} onError={noop} />);
    assert.equal(html, "");
  }
});

test("AbandonRowButton renders an Abandon trigger for an open row, using the initiation-step danger treatment (not the dialog's solid stop fill)", () => {
  const html = renderToStaticMarkup(
    <AbandonRowButton row={{ rowId: "1", rowState: "needs_review", abandonedAt: null }} onAbandoned={noop} onError={noop} />,
  );
  assert.match(html, /class="app-button app-button-danger"[^>]*>Abandon</);
});

test("RunLifecycleActions renders nothing once the run is finalized -- read-only after finalization", () => {
  const html = renderToStaticMarkup(
    <RunLifecycleActions
      runId="run-1"
      status="finalized"
      rows={[{ rowId: "1", rowState: "committed", abandonedAt: null }]}
      onStagingClosed={noop}
      onOpenRowsAbandoned={noop}
      onFinalized={noop}
      onError={noop}
    />,
  );
  assert.equal(html, "");
});

test("staging status: only Close Source Staging is offered -- no abandon-all or finalize control yet", () => {
  const html = renderToStaticMarkup(
    <RunLifecycleActions
      runId="run-1"
      status="staging"
      rows={[{ rowId: "1", rowState: "approved", abandonedAt: null }]}
      onStagingClosed={noop}
      onOpenRowsAbandoned={noop}
      onFinalized={noop}
      onError={noop}
    />,
  );
  assert.match(html, />Close Source Staging</);
  assert.equal(/>Abandon Remaining Open Rows</.test(html), false);
  assert.equal(/>Finalize Run</.test(html), false);
});

test("ready_for_review with open rows: Abandon Remaining Open Rows is offered, and Finalize Run is present but disabled -- blocked while rows remain open", () => {
  const html = renderToStaticMarkup(
    <RunLifecycleActions
      runId="run-1"
      status="ready_for_review"
      rows={[
        { rowId: "1", rowState: "committed", abandonedAt: null },
        { rowId: "2", rowState: "needs_review", abandonedAt: null },
      ]}
      onStagingClosed={noop}
      onOpenRowsAbandoned={noop}
      onFinalized={noop}
      onError={noop}
    />,
  );
  assert.match(html, />Abandon Remaining Open Rows</);
  assert.match(html, /disabled=""[^>]*>Finalize Run</);
});

test("ready_for_review with every row terminal: no abandon-all control (nothing open to abandon), and Finalize Run is enabled", () => {
  const html = renderToStaticMarkup(
    <RunLifecycleActions
      runId="run-1"
      status="ready_for_review"
      rows={[
        { rowId: "1", rowState: "committed", abandonedAt: null },
        { rowId: "2", rowState: "needs_review", abandonedAt: "2026-08-22T00:00:00Z" },
      ]}
      onStagingClosed={noop}
      onOpenRowsAbandoned={noop}
      onFinalized={noop}
      onError={noop}
    />,
  );
  assert.equal(/>Abandon Remaining Open Rows</.test(html), false);
  assert.match(html, />Finalize Run</);
  assert.equal(/disabled=""[^>]*>Finalize Run</.test(html), false);
});

test("ready_for_review with zero rows: Finalize Run is enabled -- an empty run is vacuously all-terminal, not blocked", () => {
  const html = renderToStaticMarkup(
    <RunLifecycleActions
      runId="run-1"
      status="ready_for_review"
      rows={[]}
      onStagingClosed={noop}
      onOpenRowsAbandoned={noop}
      onFinalized={noop}
      onError={noop}
    />,
  );
  assert.equal(/disabled=""[^>]*>Finalize Run</.test(html), false);
});

test("every lifecycle mutation is gated behind a confirm/reason dialog -- every visible trigger button only opens a dialog (setXOpen(true)), never calls a governed RPC wrapper directly", () => {
  const SOURCE = readFileSync(
    fileURLToPath(new URL("./RunLifecycleActions.tsx", import.meta.url)),
    "utf8",
  ) as string;

  // Every trigger AppButton (the ones rendered directly in RunLifecycleActions'
  // and AbandonRowButton's JSX, outside any dialog) has an onClick that only
  // flips an "open" boolean -- confirmed by requiring every onClick in the
  // file to match one of: opening a dialog, canceling a dialog (guarded by
  // busy), or the dialog's own onConfirm wiring (a named handler reference,
  // not an inline RPC call).
  const onClicks = [...SOURCE.matchAll(/onClick=\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(onClicks.length >= 5);
  for (const body of onClicks) {
    const isDialogOpen = /set\w*Open\(true\)/.test(body);
    const isDialogCancel = /\(?\w+ \? null : set\w*Open\(false\)\)?/.test(body);
    // The dialog's own Cancel/Confirm buttons (inside AbandonReasonDialog)
    // delegate to the props the caller supplied -- a bare "onCancel"
    // reference, or "() => void onConfirm(reasonCode)" invoking the
    // caller-supplied confirm handler with the user's picked reason code.
    const isDialogPropDelegate = /^on\w+$/.test(body.trim()) || /^\(\) => void on\w+\(.*\)$/.test(body.trim());
    assert.ok(
      isDialogOpen || isDialogCancel || isDialogPropDelegate,
      `onClick body is not a recognized safe shape: ${body}`,
    );
    assert.equal(/closeImportRunStaging|abandonImportRunOpenRows|abandonImportRunRow|finalizeImportRun/.test(body), false);
  }

  // The RPC wrappers themselves are only called from named handler
  // functions (handleCloseStaging/handleAbandonAllOpenRows/handleFinalize/
  // handleConfirm), each wired to a dialog's onConfirm -- never inlined
  // into a trigger's onClick.
  for (const call of ["closeImportRunStaging(", "abandonImportRunOpenRows(", "abandonImportRunRow(", "finalizeImportRun("]) {
    assert.ok(SOURCE.includes(call), call);
  }
  assert.match(SOURCE, /onConfirm=\{handleCloseStaging\}/);
  assert.match(SOURCE, /onConfirm=\{handleAbandonAllOpenRows\}/);
  assert.match(SOURCE, /onConfirm=\{handleFinalize\}/);
  assert.match(SOURCE, /onConfirm=\{handleConfirm\}/);
});
