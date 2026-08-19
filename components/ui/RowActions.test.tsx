import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { RowActions } from "@/components/ui/RowActions";

// Focused tests for the shared row-actions layout wrapper (UI Phase 2).
// Run with: npx tsx --test components/ui/RowActions.test.tsx

test("renders its children unmodified -- purely a layout wrapper, no action definitions of its own", () => {
  const html = renderToStaticMarkup(
    <RowActions>
      <button type="button">Edit</button>
      <button type="button">Delete</button>
    </RowActions>,
  );

  assert.ok(html.includes(">Edit<"));
  assert.ok(html.includes(">Delete<"));
  assert.equal((html.match(/<button/g) || []).length, 2);
});

test("applies the shared row-actions class every consumer gets identical spacing/touch-target rules from", () => {
  const html = renderToStaticMarkup(
    <RowActions>
      <button type="button">Edit</button>
    </RowActions>,
  );

  assert.ok(html.includes('class="row-actions"'));
});

test("is a single root element, not a fragment -- safe to style/measure as one row-action group", () => {
  const html = renderToStaticMarkup(
    <RowActions>
      <button type="button">Edit</button>
      <button type="button">Delete</button>
    </RowActions>,
  );

  assert.ok(html.startsWith("<div"));
});
