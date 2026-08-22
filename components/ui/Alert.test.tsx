import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { Alert } from "@/components/ui/Alert";

// Focused tests for Alert (UI Phase 1; icon/action props added by the
// Central UI Standard so EmptyState/LoadingState can be thin wrappers
// around this one primitive -- see those components' own tests for their
// half of this contract).
// Run with: npx tsx --test components/ui/Alert.test.tsx

test("default tone renders the default dot icon and role=\"status\"/aria-live=\"polite\"", () => {
  const html = renderToStaticMarkup(<Alert>Loading records...</Alert>);
  assert.match(html, /<span class="app-alert-icon" aria-hidden="true">/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<span class="app-alert-message">Loading records\.\.\.<\/span>/);
});

test("danger tone renders role=\"alert\" with no aria-live, unaffected by the icon/action additions", () => {
  const html = renderToStaticMarkup(<Alert tone="danger">We couldn't load these records.</Alert>);
  assert.match(html, /role="alert"/);
  assert.equal(html.includes("aria-live"), false);
});

test("a custom icon overrides the default dot, still aria-hidden", () => {
  const html = renderToStaticMarkup(
    <Alert tone="info" icon={<span className="app-button-spinner" aria-hidden="true" />}>
      Loading...
    </Alert>,
  );
  assert.equal(html.includes("app-alert-icon"), false);
  assert.match(html, /<span class="app-button-spinner" aria-hidden="true">/);
});

test("without an explicit icon prop, the default dot renders exactly as before this change", () => {
  const html = renderToStaticMarkup(<Alert tone="success">Saved.</Alert>);
  assert.match(html, /<span class="app-alert-icon" aria-hidden="true">/);
});

test("an action renders after the message, inside app-alert-action, and is omitted entirely when not supplied", () => {
  const withAction = renderToStaticMarkup(
    <Alert action={<button type="button">Clear filters</button>}>No results match your filters.</Alert>,
  );
  assert.match(withAction, /<span class="app-alert-action"><button type="button">Clear filters<\/button><\/span>/);
  const messageIdx = withAction.indexOf("app-alert-message");
  const actionIdx = withAction.indexOf("app-alert-action");
  assert.ok(messageIdx < actionIdx, "message must render before the action");

  const withoutAction = renderToStaticMarkup(<Alert>No results.</Alert>);
  assert.equal(withoutAction.includes("app-alert-action"), false);
});

test("tone classes are unaffected by the icon/action additions", () => {
  for (const [tone, expectedClass] of [
    ["info", "app-alert-info"],
    ["warning", "app-alert-warning"],
    ["danger", "app-alert-danger"],
    ["success", "app-alert-success"],
  ] as const) {
    const html = renderToStaticMarkup(<Alert tone={tone}>Message</Alert>);
    assert.match(html, new RegExp(`class="app-alert ${expectedClass}"`));
  }
});
