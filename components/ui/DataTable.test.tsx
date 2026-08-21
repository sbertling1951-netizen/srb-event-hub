import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { DataTable, ResponsiveList } from "@/components/ui/DataTable";

// Focused tests for the shared desktop table / narrow-viewport list
// shells (UI Phase 2). Run with:
//   npx tsx --test components/ui/DataTable.test.tsx

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
