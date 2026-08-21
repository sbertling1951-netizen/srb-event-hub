import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { DataTable, ResponsiveList } from "@/components/ui/DataTable";

// Focused tests for the shared desktop table / narrow-viewport list
// shells (UI Phase 2). Run with:
//   npx tsx --test components/ui/DataTable.test.tsx

const CSS_SOURCE = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

test("DataTable renders a real semantic <table> with an accessible caption", () => {
  const html = renderToStaticMarkup(
    <DataTable caption="Existing announcements for this event">
      <thead>
        <tr>
          <th scope="col">Title</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Weekend Schedule Change</td>
        </tr>
      </tbody>
    </DataTable>,
  );

  assert.match(html, /<table[^>]*>/);
  assert.ok(html.includes("<caption"));
  assert.ok(html.includes("Existing announcements for this event"));
  assert.ok(html.includes("Weekend Schedule Change"));
});

test("DataTable's caption is visually hidden, not a second visible heading", () => {
  const html = renderToStaticMarkup(
    <DataTable caption="Existing announcements for this event">
      <tbody>
        <tr>
          <td>Row</td>
        </tr>
      </tbody>
    </DataTable>,
  );

  assert.match(html, /<caption class="sr-only">/);
});

test("DataTable wraps the table in a horizontal-scroll container, never clipping content silently", () => {
  const html = renderToStaticMarkup(
    <DataTable caption="Caption">
      <tbody>
        <tr>
          <td>Row</td>
        </tr>
      </tbody>
    </DataTable>,
  );

  assert.match(html, /<div class="data-table-scroll"><table/);
});

// Real defect, found via /admin/ui-reference's Mid-Size UI Scale section
// (confirmed with document.documentElement.scrollWidth vs clientWidth at
// 390px): DataTable's own <caption class="sr-only"> is position:absolute
// with no explicit offsets, so it uses its own "static position" as its
// anchor. With no containing block anywhere in DataTable's own template
// (.data-table-scroll/.data-table/.card/.app-card-section all lack
// position:relative), that static position falls back to the initial
// containing block wherever no ancestor further up happens to be
// positioned -- which can land the (invisible, 1x1px, fully clipped)
// caption far outside any local overflow-x:auto wrapper, inflating the
// WHOLE PAGE's scrollable width even though nothing is visibly wrong.
// .data-table-scroll already exists specifically to contain the table's
// own overflow locally; position:relative (no offsets, so no visual/
// layout effect on its own) extends that same containment to its
// caption too, everywhere DataTable is used -- not just this one page.
test(".data-table-scroll establishes a containing block, so its own sr-only caption can never escape to inflate the document's scrollable width", () => {
  const match = CSS_SOURCE.match(/\.data-table-scroll\s*\{[^}]*\}/);
  assert.ok(match, "expected to find the .data-table-scroll rule in app/globals.css");
  assert.match(match![0], /position:\s*relative/);
});

test("DataTable renders exactly the children it was given -- no injected columns/rows", () => {
  const html = renderToStaticMarkup(
    <DataTable caption="Caption">
      <tbody>
        <tr>
          <td>Only Row</td>
        </tr>
      </tbody>
    </DataTable>,
  );

  assert.equal((html.match(/<tr/g) || []).length, 1);
});

test("ResponsiveList renders a real <ul> with explicit list semantics", () => {
  const html = renderToStaticMarkup(
    <ResponsiveList>
      <li>First announcement</li>
      <li>Second announcement</li>
    </ResponsiveList>,
  );

  assert.match(html, /<ul[^>]*role="list"[^>]*>/);
  assert.equal((html.match(/<li/g) || []).length, 2);
});

test("ResponsiveList applies the shared responsive-list class", () => {
  const html = renderToStaticMarkup(
    <ResponsiveList>
      <li>Row</li>
    </ResponsiveList>,
  );

  assert.ok(html.includes('class="responsive-list"'));
});

test("ResponsiveList has no accessible name by default", () => {
  const html = renderToStaticMarkup(
    <ResponsiveList>
      <li>Row</li>
    </ResponsiveList>,
  );

  assert.ok(!html.includes("aria-label"));
  assert.ok(!html.includes("aria-labelledby"));
});

test("ResponsiveList forwards aria-label as the list's accessible name", () => {
  const html = renderToStaticMarkup(
    <ResponsiveList aria-label="Check-in attendees">
      <li>Row</li>
    </ResponsiveList>,
  );

  assert.match(html, /<ul[^>]*aria-label="Check-in attendees"[^>]*>/);
  assert.match(html, /<ul[^>]*role="list"[^>]*>/);
});

test("ResponsiveList forwards aria-labelledby to reference an existing heading", () => {
  const html = renderToStaticMarkup(
    <>
      <h2 id="attendees-heading">Attendees</h2>
      <ResponsiveList aria-labelledby="attendees-heading">
        <li>Row</li>
      </ResponsiveList>
    </>,
  );

  assert.match(html, /<ul[^>]*aria-labelledby="attendees-heading"[^>]*>/);
});

test("ResponsiveList still renders exactly the item semantics and children it was given when named", () => {
  const html = renderToStaticMarkup(
    <ResponsiveList aria-label="Check-in attendees">
      <li>First</li>
      <li>Second</li>
    </ResponsiveList>,
  );

  assert.match(html, /<ul[^>]*role="list"[^>]*>/);
  assert.equal((html.match(/<li/g) || []).length, 2);
  assert.ok(html.includes('class="responsive-list"'));
});
