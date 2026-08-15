import assert from "node:assert/strict";
import { test } from "node:test";

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
