import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  SearchField,
  TableToolbar,
  TableToolbarDisclosure,
  TableToolbarPrimaryRow,
} from "@/components/ui/TableToolbar";

// Focused tests for the shared list/table toolbar (UI Phase 4). Run with:
//   npx tsx --test components/ui/TableToolbar.test.tsx

test("TableToolbar renders its children inside the shared toolbar class -- no configuration object, pure composition", () => {
  const html = renderToStaticMarkup(
    <TableToolbar>
      <div>Custom content</div>
    </TableToolbar>,
  );

  assert.ok(html.includes('class="table-toolbar"'));
  assert.ok(html.includes("Custom content"));
});

test("TableToolbarPrimaryRow and TableToolbarDisclosure compose independently -- no shared state between them", () => {
  const html = renderToStaticMarkup(
    <TableToolbar>
      <TableToolbarPrimaryRow>
        <div>Search</div>
      </TableToolbarPrimaryRow>
      <TableToolbarDisclosure label="More filters">
        <div>Secondary filter</div>
      </TableToolbarDisclosure>
    </TableToolbar>,
  );

  assert.ok(html.includes("Search"));
  assert.ok(html.includes("More filters"));
  assert.ok(html.includes("Secondary filter"));
});

test("TableToolbarDisclosure uses native <details>/<summary> -- free keyboard and screen-reader semantics, no JS open-state", () => {
  const html = renderToStaticMarkup(
    <TableToolbarDisclosure label="More filters">
      <div>Field</div>
    </TableToolbarDisclosure>,
  );

  assert.match(html, /<details[^>]*><summary/);
});

test("TableToolbarDisclosure shows an active-filter count badge when filters are active, and omits it when zero -- active filter state is never hidden", () => {
  const withActive = renderToStaticMarkup(
    <TableToolbarDisclosure label="More filters" activeCount={2}>
      <div>Field</div>
    </TableToolbarDisclosure>,
  );
  const withoutActive = renderToStaticMarkup(
    <TableToolbarDisclosure label="More filters" activeCount={0}>
      <div>Field</div>
    </TableToolbarDisclosure>,
  );

  assert.ok(withActive.includes("2 active"));
  assert.equal(withoutActive.includes("active"), false);
});

test("SearchField renders a labeled, real search input wired to the caller's own value/onChange -- no internal state of its own", () => {
  const html = renderToStaticMarkup(
    <SearchField label="Search" value="acme" onChange={() => {}} id="my-search" />,
  );

  assert.match(html, /<input[^>]*type="search"[^>]*value="acme"/);
  assert.ok(html.includes('for="my-search"'));
  assert.ok(html.includes(">Search<"));
});
