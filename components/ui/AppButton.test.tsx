import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { AppButton, AppLinkButton } from "@/components/ui/AppButton";

// Focused tests for the shared AppButton/AppLinkButton primitive and its
// canonical action semantics (System 3, approved 2026-08-19 -- see
// /admin/ui-reference Section 15). These check the className contract
// only (renderToStaticMarkup can't evaluate computed CSS); the actual
// visual treatment lives in app/globals.css's STANDARD APP BUTTON SYSTEM
// block, exercised manually via the reference page.
// Run with: npx tsx --test components/ui/AppButton.test.tsx

test("the default (unset) variant applies no app-button-* modifier class -- this IS the ordinary/secondary ghost treatment, not a separate opt-in", () => {
  const html = renderToStaticMarkup(<AppButton>Edit</AppButton>);
  assert.match(html, /class="app-button"/);
  assert.equal(/app-button-\w+/.test(html), false);
});

test("every canonical variant applies its exact modifier class", () => {
  for (const variant of [
    "primary",
    "success",
    "danger",
    "warning",
    "muted",
    "start",
    "stop",
  ] as const) {
    const html = renderToStaticMarkup(<AppButton variant={variant}>Go</AppButton>);
    assert.match(html, new RegExp(`class="app-button app-button-${variant}"`));
  }
});

test("AppButton defaults to type=\"button\" -- never submits a form by accident", () => {
  const html = renderToStaticMarkup(<AppButton>Save</AppButton>);
  assert.match(html, /type="button"/);
});

test("disabled state passes straight through to the native button", () => {
  const html = renderToStaticMarkup(<AppButton disabled>Save</AppButton>);
  assert.match(html, /disabled=""/);
});

test("AppLinkButton with no variant renders a plain <a class=\"app-button\"> -- the navigation/handoff treatment is carried entirely by the a.app-button CSS rule, not a separate component prop", () => {
  const html = renderToStaticMarkup(<AppLinkButton href="/admin/parking">View in Parking</AppLinkButton>);
  assert.match(html, /<a class="app-button" href="\/admin\/parking">View in Parking<\/a>/);
});

test("AppLinkButton still accepts an explicit variant (e.g. a primary-styled link) as an escape hatch from the default nav-link treatment", () => {
  const html = renderToStaticMarkup(
    <AppLinkButton href="/admin/parking" variant="primary">
      View in Parking
    </AppLinkButton>,
  );
  assert.match(html, /class="app-button app-button-primary"/);
});
