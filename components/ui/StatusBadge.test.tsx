import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { StatusBadge } from "@/components/ui/StatusBadge";

// Focused tests for the shared status/priority badge (UI Phase 2). Run
// with: npx tsx --test components/ui/StatusBadge.test.tsx

test("renders its text content verbatim -- text is the sole carrier of meaning", () => {
  const html = renderToStaticMarkup(<StatusBadge tone="success">Published</StatusBadge>);

  assert.ok(html.includes("Published"));
});

test("every tone renders visible text -- never a color-only swatch", () => {
  const tones = ["neutral", "info", "warning", "danger", "success"] as const;

  for (const tone of tones) {
    const html = renderToStaticMarkup(<StatusBadge tone={tone}>Status</StatusBadge>);
    const textOnly = html.replace(/<[^>]*>/g, "");
    assert.equal(textOnly, "Status", `tone "${tone}" must still render its label text`);
  }
});

test("tone selects the matching app-status-pill-* class, base class always present", () => {
  const dangerHtml = renderToStaticMarkup(<StatusBadge tone="danger">Urgent</StatusBadge>);
  assert.ok(dangerHtml.includes("app-status-pill"));
  assert.ok(dangerHtml.includes("app-status-pill-danger"));

  const neutralHtml = renderToStaticMarkup(<StatusBadge>Draft</StatusBadge>);
  assert.ok(neutralHtml.includes("app-status-pill"));
  assert.equal(/app-status-pill-\w+/.test(neutralHtml), false);
});

test("renders a single inline <span>, not an interactive element", () => {
  const html = renderToStaticMarkup(<StatusBadge tone="info">Normal</StatusBadge>);

  assert.ok(html.startsWith("<span"));
  assert.equal(!html.includes("<button") && !html.includes("<a "), true);
});
