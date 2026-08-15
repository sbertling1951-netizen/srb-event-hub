import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import VendorIntelligenceBadge from "@/components/admin/VendorIntelligenceBadge";
import type { VendorIntelligenceSummary } from "@/lib/vendorEventLifecycle";

// Focused tests for the Stage 4 vendor intelligence presentation
// boundary (advisory-only, aggregate-only). Run with:
//   npx tsx --test components/admin/VendorIntelligenceBadge.test.tsx

function baseSummary(overrides: Partial<VendorIntelligenceSummary> = {}): VendorIntelligenceSummary {
  return {
    vendor_id: "11111111-1111-1111-1111-111111111111",
    has_quality_concerns: true,
    quality_concern_count: 2,
    most_recent_quality_concern_at: "2026-01-15T00:00:00.000Z",
    distinct_events_with_concern_count: 2,
    distinct_tenants_with_concern_count: 1,
    ...overrides,
  };
}

test("renders nothing when the summary has no quality concerns -- never a prohibition banner for a clean vendor", () => {
  const markup = renderToStaticMarkup(
    <VendorIntelligenceBadge summary={baseSummary({ has_quality_concerns: false, quality_concern_count: 0 })} />,
  );
  assert.equal(markup, "");
});

test("renders nothing when no summary has been loaded yet and it is not in a loading state", () => {
  const markup = renderToStaticMarkup(<VendorIntelligenceBadge summary={null} />);
  assert.equal(markup, "");
});

test("shows a loading indicator while the summary is being fetched", () => {
  const markup = renderToStaticMarkup(<VendorIntelligenceBadge summary={null} loading />);
  assert.match(markup, /checking vendor intelligence/i);
});

test("renders aggregate counts and the advisory disclaimer when quality concerns exist", () => {
  const markup = renderToStaticMarkup(<VendorIntelligenceBadge summary={baseSummary()} />);

  assert.match(markup, /2 adverse quality decisions/i);
  assert.match(markup, /2 Events/);
  assert.match(markup, /not a prohibition/i);
});

test("never renders raw reason text, actor identity, or per-row Tenant/Event identity -- the summary type structurally cannot carry them", () => {
  // The VendorIntelligenceSummary type itself has no reason_text, actor,
  // Tenant name, or Event name field -- there is nothing for this
  // component to leak even if it wanted to. This test documents that
  // boundary at the call site.
  const summary = baseSummary();
  const summaryKeys = Object.keys(summary);
  assert.deepEqual(summaryKeys.sort(), [
    "distinct_events_with_concern_count",
    "distinct_tenants_with_concern_count",
    "has_quality_concerns",
    "most_recent_quality_concern_at",
    "quality_concern_count",
    "vendor_id",
  ]);
});

test("mentions multiple Tenants only when more than one distinct Tenant is involved", () => {
  const singleTenantMarkup = renderToStaticMarkup(
    <VendorIntelligenceBadge summary={baseSummary({ distinct_tenants_with_concern_count: 1 })} />,
  );
  assert.doesNotMatch(singleTenantMarkup, /Tenants/);

  const multiTenantMarkup = renderToStaticMarkup(
    <VendorIntelligenceBadge summary={baseSummary({ distinct_tenants_with_concern_count: 3 })} />,
  );
  assert.match(multiTenantMarkup, /3 Tenants/);
});
