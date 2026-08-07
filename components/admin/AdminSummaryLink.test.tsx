import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import AdminSummaryLink from "@/components/admin/AdminSummaryLink";

// Focused tests for the first bounded Admin Summary Link
// (docs/architecture/EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md §5). Run
// with:
//   npx tsx --test components/admin/AdminSummaryLink.test.tsx

test("renders the module's title and description directly, with no recomputed statistic", () => {
  const html = renderToStaticMarkup(
    <AdminSummaryLink
      title="Vendors"
      description="Manage event vendors and service requests."
      href="/admin/vendors"
    />,
  );

  assert.ok(html.includes("Vendors"));
  assert.ok(html.includes("Manage event vendors and service requests."));
  // Strip markup/inline-style attributes (which legitimately contain
  // digits, e.g. border-radius) so only rendered text content is
  // checked for an invented count/statistic.
  const textOnly = html.replace(/<[^>]*>/g, "");
  assert.ok(
    !/\d/.test(textOnly),
    "no digit/count should appear in the card's visible text",
  );
});

test("renders a real link element (not a synthetic button/onClick control) pointed at the destination", () => {
  const html = renderToStaticMarkup(
    <AdminSummaryLink
      title="Agenda"
      description="Build and publish the event schedule."
      href="/admin/agenda"
    />,
  );

  assert.ok(html.startsWith("<a "));
  assert.ok(html.includes('href="/admin/agenda"'));
});

test("the whole card is the single interactive surface -- no nested interactive control inside it", () => {
  const html = renderToStaticMarkup(
    <AdminSummaryLink
      title="Check-In"
      description="Mark arrivals and confirm parking sites."
      href="/admin/checkin"
    />,
  );

  assert.ok(!html.includes("<button"));
  assert.ok((html.match(/<a /g) || []).length === 1);
});

test("destination is used directly -- two links with the same title still route to their own href", () => {
  const first = renderToStaticMarkup(
    <AdminSummaryLink title="Media" description="a" href="/admin/photos" />,
  );
  const second = renderToStaticMarkup(
    <AdminSummaryLink title="Media" description="b" href="/admin/reports" />,
  );

  assert.ok(first.includes('href="/admin/photos"'));
  assert.ok(second.includes('href="/admin/reports"'));
});

test("no I/O: the component source issues no fetch, Supabase, storage, or RPC access", () => {
  const sourcePath = fileURLToPath(
    new URL("./AdminSummaryLink.tsx", import.meta.url),
  );
  const source = readFileSync(sourcePath, "utf8");

  for (const forbidden of [
    "fetch(",
    "supabase",
    "localStorage",
    "sessionStorage",
    ".rpc(",
    "useRouter",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `AdminSummaryLink.tsx must not contain "${forbidden}" -- it is presentation-only`,
    );
  }
});
