import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ConfirmDialogFooter } from "@/components/ui/ConfirmDialog";

// Focused tests for ConfirmDialog's canonical action semantics (System 3,
// approved 2026-08-19): Cancel is the shared ordinary/ghost AppButton,
// Confirm is the ONE place the solid destructive fill (variant="stop")
// belongs when danger is set, and a non-destructive confirm uses the
// same solid weight via variant="primary" instead.
//
// ConfirmDialog itself (the default export) now renders through the
// canonical `Dialog` foundation, which portals -- see Dialog.tsx's own
// `DialogSurface` for why that half is not testable via
// `renderToStaticMarkup` in this repo. `ConfirmDialogFooter` is the
// portal-free half carrying ConfirmDialog's own decision logic (which
// variant, which label, busy state), tested directly here.
// Run with: npx tsx --test components/ui/ConfirmDialog.test.tsx

const NOOP_REF = { current: null };

const BASE_PROPS = {
  onConfirm: () => {},
  onCancel: () => {},
  confirmButtonRef: NOOP_REF,
};

test("danger=true: Confirm uses the solid destructive fill (variant=\"stop\"), Cancel stays the ordinary/ghost treatment", () => {
  const html = renderToStaticMarkup(<ConfirmDialogFooter {...BASE_PROPS} danger />);
  assert.match(html, /class="app-button app-button-stop"/);
  assert.equal(/app-button-danger/.test(html), false);
  // Cancel: a bare "app-button" with no modifier class.
  assert.match(html, /<button type="button" class="app-button"[^>]*>Cancel<\/button>/);
});

test("danger=false (default): Confirm uses the solid primary treatment, never the destructive fill", () => {
  const html = renderToStaticMarkup(<ConfirmDialogFooter {...BASE_PROPS} />);
  assert.match(html, /class="app-button app-button-primary"/);
  assert.equal(/app-button-stop/.test(html), false);
});

test("busy state disables Confirm and shows the shared loading spinner, via the real AppButton loading prop -- not a page-local disabled look", () => {
  const html = renderToStaticMarkup(<ConfirmDialogFooter {...BASE_PROPS} busy />);
  assert.match(html, /class="app-button-spinner"/);
  assert.match(html, /aria-busy="true"/);
  // Both Confirm (via loading) and Cancel (via explicit disabled) are inert while busy.
  const disabledCount = (html.match(/disabled=""/g) || []).length;
  assert.equal(disabledCount, 2);
});

test("confirmLabel/cancelLabel are respected", () => {
  const html = renderToStaticMarkup(
    <ConfirmDialogFooter {...BASE_PROPS} confirmLabel="Delete Forever" cancelLabel="Keep It" danger />,
  );
  assert.ok(html.includes("Delete Forever"));
  assert.ok(html.includes("Keep It"));
});
