import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { EmptyState } from "@/components/ui/EmptyState";

// Focused tests for EmptyState (Central UI Standard) -- a thin Alert
// wrapper, not a second container; see components/ui/Alert.test.tsx for
// the shared mechanics (icon/action/role) this component relies on.
// Run with: npx tsx --test components/ui/EmptyState.test.tsx

test("renders through the real Alert primitive at tone=\"neutral\" -- role=\"status\", the default dot icon, no danger semantics for an ordinary empty collection", () => {
  const html = renderToStaticMarkup(<EmptyState message="No records match your search or filters." />);
  assert.match(html, /class="app-alert"/);
  assert.equal(html.includes("app-alert-info"), false);
  assert.equal(html.includes("app-alert-danger"), false);
  assert.match(html, /role="status"/);
  assert.match(html, /<span class="app-alert-icon" aria-hidden="true">/);
  assert.match(
    html,
    /<span class="app-alert-message">No records match your search or filters\.<\/span>/,
  );
});

test("an optional action renders, and is omitted entirely when not supplied", () => {
  const withAction = renderToStaticMarkup(
    <EmptyState message="No results." action={<button type="button">Clear filters</button>} />,
  );
  assert.match(withAction, /<span class="app-alert-action"><button type="button">Clear filters<\/button><\/span>/);

  const withoutAction = renderToStaticMarkup(<EmptyState message="No results." />);
  assert.equal(withoutAction.includes("app-alert-action"), false);
});

test("className passes through to the underlying Alert", () => {
  const html = renderToStaticMarkup(<EmptyState message="No results." className="ui-ref-empty-demo" />);
  assert.match(html, /class="app-alert ui-ref-empty-demo"/);
});
