import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { LoadingState } from "@/components/ui/LoadingState";

// Focused tests for LoadingState (Central UI Standard) -- a thin Alert
// wrapper reusing AppButton's own spinner, not a second spinner
// implementation; see components/ui/Alert.test.tsx for the shared
// mechanics (icon override/role) this component relies on.
// Run with: npx tsx --test components/ui/LoadingState.test.tsx

test("renders through the real Alert primitive at tone=\"info\", with AppButton's own spinner as the icon -- not a second spinner implementation", () => {
  const html = renderToStaticMarkup(<LoadingState message="Loading records..." />);
  assert.match(html, /class="app-alert app-alert-info"/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<span class="app-button-spinner" aria-hidden="true">/);
  assert.equal(html.includes("app-alert-icon"), false);
  assert.match(html, /<span class="app-alert-message">Loading records\.\.\.<\/span>/);
});

test("message defaults to a plain ellipsis-terminated string when not supplied", () => {
  const html = renderToStaticMarkup(<LoadingState />);
  assert.match(html, /<span class="app-alert-message">Loading…<\/span>/);
});

test("className passes through to the underlying Alert", () => {
  const html = renderToStaticMarkup(<LoadingState className="ui-ref-loading-demo" />);
  assert.match(html, /class="app-alert app-alert-info ui-ref-loading-demo"/);
});
