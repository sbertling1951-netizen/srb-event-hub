import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { STATUS_LABELS, StatusBadge } from "@/app/admin/vendors/page";
import type { VendorEventDisplayStatus } from "@/lib/vendorEventLifecycle";

// Focused tests for the Stage 4 Admin Vendor workflow's status
// presentation. Run with:
//   npx tsx --test app/admin/vendors/page.test.tsx

const ALL_STATUSES: VendorEventDisplayStatus[] = [
  "not_considered",
  "pending",
  "admitted",
  "rejected",
  "withdrawn",
  "revoked",
];

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("StatusBadge renders every display status's own label, with no crossover", () => {
  for (const status of ALL_STATUSES) {
    const markup = renderToStaticMarkup(<StatusBadge status={status} />);
    assert.match(markup, new RegExp(STATUS_LABELS[status]));

    for (const other of ALL_STATUSES) {
      if (other === status) {continue;}
      // Guard against a copy-paste label collision -- every status's
      // label must be exclusive to that status's badge.
      if (STATUS_LABELS[other] !== STATUS_LABELS[status]) {
        assert.doesNotMatch(markup, new RegExp(`^${STATUS_LABELS[other]}$`));
      }
    }
  }
});

test("the revoked label is distinct from the admitted label -- the admitted-vs-revoked invariant is visible, not just internally derived", () => {
  const admittedMarkup = renderToStaticMarkup(<StatusBadge status="admitted" />);
  const revokedMarkup = renderToStaticMarkup(<StatusBadge status="revoked" />);

  assert.notEqual(admittedMarkup, revokedMarkup);
  assert.match(revokedMarkup, /revoked/i);
  assert.match(admittedMarkup, /currently participating/i);
});

test("an Admin Event switch starts a fresh Vendor load and rejects late prior-Event responses", () => {
  assert.match(PAGE_SOURCE, /const scopedEvent = getCurrentAdminEvent\(\);/);
  assert.match(PAGE_SOURCE, /const generation = \+\+loadGenerationRef\.current;/);
  assert.match(
    PAGE_SOURCE,
    /getCurrentAdminEvent\(\)\?\.id === scopedEvent\?\.id/,
  );
  assert.match(PAGE_SOURCE, /\.eq\("event_id", scopedEvent\.id\)/);
  assert.match(PAGE_SOURCE, /listVendorEventApplications\(scopedEvent\.id\)/);
  assert.match(PAGE_SOURCE, /if \(!isCurrentLoad\(\)\) \{return;\}/);
  assert.match(PAGE_SOURCE, /setEventVendors\(\[\]\);/);
  assert.match(PAGE_SOURCE, /setApplications\(\[\]\);/);
});

test("a denied Vendor application read is visible instead of being presented as an empty queue", () => {
  assert.match(PAGE_SOURCE, /Vendor applications could not be loaded for this Event\./);
  assert.match(PAGE_SOURCE, /application review is unavailable\./);
  assert.doesNotMatch(PAGE_SOURCE, /denied by the RPC -- fail closed to an empty/);
});
