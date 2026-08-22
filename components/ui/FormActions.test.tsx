import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { FormActions } from "@/components/ui/FormActions";

// Focused tests for FormActions (Central UI Standard) -- the canonical
// name for the app-button-row layout most forms already hand-write
// inline; this component owns no button logic of its own.
// Run with: npx tsx --test components/ui/FormActions.test.tsx

test("wraps children in the existing app-button-row layout class -- not a new, competing layout system", () => {
  const html = renderToStaticMarkup(
    <FormActions>
      <button type="button">Cancel</button>
      <button type="button">Save</button>
    </FormActions>,
  );
  assert.match(
    html,
    /<div class="app-button-row"><button type="button">Cancel<\/button><button type="button">Save<\/button><\/div>/,
  );
});

test("className is appended alongside (not instead of) app-button-row", () => {
  const html = renderToStaticMarkup(
    <FormActions className="ui-ref-form-actions-demo">
      <button type="button">Save</button>
    </FormActions>,
  );
  assert.match(html, /class="app-button-row ui-ref-form-actions-demo"/);
});

test("renders children in the exact order given -- no reordering, no implicit primary/cancel positioning", () => {
  const html = renderToStaticMarkup(
    <FormActions>
      <span>first</span>
      <span>second</span>
      <span>third</span>
    </FormActions>,
  );
  const firstIdx = html.indexOf("first");
  const secondIdx = html.indexOf("second");
  const thirdIdx = html.indexOf("third");
  assert.ok(firstIdx < secondIdx && secondIdx < thirdIdx);
});
