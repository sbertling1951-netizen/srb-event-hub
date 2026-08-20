import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import ConfirmDialog from "@/components/ui/ConfirmDialog";

// Focused tests for ConfirmDialog's canonical action semantics (System 3,
// approved 2026-08-19): Cancel is the shared ordinary/ghost AppButton,
// Confirm is the ONE place the solid destructive fill (variant="stop")
// belongs when danger is set, and a non-destructive confirm uses the
// same solid weight via variant="primary" instead.
// Run with: npx tsx --test components/ui/ConfirmDialog.test.tsx

const BASE_PROPS = {
  open: true,
  title: "Cancel this registration?",
  message: "This cannot be undone.",
  onConfirm: () => {},
  onCancel: () => {},
};

test("renders nothing when closed", () => {
  const html = renderToStaticMarkup(<ConfirmDialog {...BASE_PROPS} open={false} />);
  assert.equal(html, "");
});

test("danger=true: Confirm uses the solid destructive fill (variant=\"stop\"), Cancel stays the ordinary/ghost treatment", () => {
  const html = renderToStaticMarkup(<ConfirmDialog {...BASE_PROPS} danger />);
  assert.match(html, /class="app-button app-button-stop"/);
  assert.equal(/app-button-danger/.test(html), false);
  // Cancel: a bare "app-button" with no modifier class.
  assert.match(html, /<button type="button" class="app-button"[^>]*>Cancel<\/button>/);
});

test("danger=false (default): Confirm uses the solid primary treatment, never the destructive fill", () => {
  const html = renderToStaticMarkup(<ConfirmDialog {...BASE_PROPS} />);
  assert.match(html, /class="app-button app-button-primary"/);
  assert.equal(/app-button-stop/.test(html), false);
});

test("busy state disables Confirm and swaps its label, via the real AppButton disabled prop -- not a page-local disabled look", () => {
  const html = renderToStaticMarkup(<ConfirmDialog {...BASE_PROPS} busy />);
  assert.match(html, /Working\.\.\./);
  assert.match(html, /disabled=""/);
});

test("confirmLabel/cancelLabel are respected", () => {
  const html = renderToStaticMarkup(
    <ConfirmDialog {...BASE_PROPS} confirmLabel="Delete Forever" cancelLabel="Keep It" danger />,
  );
  assert.ok(html.includes("Delete Forever"));
  assert.ok(html.includes("Keep It"));
});
