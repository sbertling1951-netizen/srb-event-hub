import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ImportRunSummary } from "@/app/admin/imports/ImportRunSummary";

test("renders an accessible, import-type-agnostic definition list with supplied counts", () => {
  const html = renderToStaticMarkup(
    <ImportRunSummary
      label="Agenda import summary"
      items={[
        { label: "Total Rows", value: 4 },
        { label: "Ready to Import", value: 2, description: "Approved" },
      ]}
    />,
  );

  assert.match(html, /<dl[^>]*aria-label="Agenda import summary"/);
  assert.match(html, /<dt[^>]*>Total Rows<\/dt>/);
  assert.match(html, /<dd[^>]*><span[^>]*>4<\/span><\/dd>/);
  assert.match(html, />Ready to Import</);
  assert.match(html, />Approved</);
});

test("uses fluid auto-fit tiles without fixed viewport or device assumptions", () => {
  const html = renderToStaticMarkup(
    <ImportRunSummary label="Run summary" items={[{ label: "Rows", value: 1 }]} />,
  );

  assert.match(html, /repeat\(auto-fit, minmax\(132px, 1fr\)\)/);
  assert.doesNotMatch(html, /width:\d+px/);
});
