import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import VendorDispositionHistory from "@/components/admin/VendorDispositionHistory";
import type { VendorEventDispositionRow } from "@/lib/vendorEventLifecycle";

// Focused tests for the Stage 4 raw disposition history presentation.
// Run with:
//   npx tsx --test components/admin/VendorDispositionHistory.test.tsx

function baseDisposition(
  overrides: Partial<VendorEventDispositionRow> = {},
): VendorEventDispositionRow {
  return {
    disposition_id: "11111111-1111-1111-1111-111111111111",
    vendor_id: "22222222-2222-2222-2222-222222222222",
    application_id: "33333333-3333-3333-3333-333333333333",
    event_id: "44444444-4444-4444-4444-444444444444",
    decision_type: "admitted",
    reason_code: null,
    reason_classification: null,
    reason_text: null,
    actor_auth_user_id: "55555555-5555-5555-5555-555555555555",
    actor_admin_user_id: "66666666-6666-6666-6666-666666666666",
    authority_basis: "event_grant",
    backfill_note: null,
    occurred_at: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

test("shows an empty-state message when there is no history for this Event", () => {
  const markup = renderToStaticMarkup(<VendorDispositionHistory dispositions={[]} />);
  assert.match(markup, /no decisions recorded/i);
});

test("shows a loading indicator while history is being fetched", () => {
  const markup = renderToStaticMarkup(<VendorDispositionHistory dispositions={[]} loading />);
  assert.match(markup, /loading history/i);
});

test("renders the decision type, reason classification badge, and reason text for a governed decision", () => {
  const markup = renderToStaticMarkup(
    <VendorDispositionHistory
      dispositions={[
        baseDisposition({
          decision_type: "revoked",
          reason_code: "vendor_no_show",
          reason_classification: "performance_quality",
          reason_text: "Did not appear for setup.",
        }),
      ]}
    />,
  );

  assert.match(markup, /Revoked/);
  assert.match(markup, /Performance \/ quality/i);
  assert.match(markup, /vendor no show/i);
  assert.match(markup, /Did not appear for setup/);
});

test("shows the backfill note only for migrated historical rows, never for a live governed decision", () => {
  const backfilled = renderToStaticMarkup(
    <VendorDispositionHistory
      dispositions={[baseDisposition({ authority_basis: "backfill", actor_admin_user_id: null, actor_auth_user_id: null })]}
    />,
  );
  assert.match(backfilled, /migrated historical record/i);

  const live = renderToStaticMarkup(
    <VendorDispositionHistory dispositions={[baseDisposition({ authority_basis: "event_grant" })]} />,
  );
  assert.doesNotMatch(live, /migrated historical record/i);
});

test("renders one card per disposition, oldest-vs-newest order left entirely to the caller's array order", () => {
  const rows = [
    baseDisposition({ disposition_id: "a", decision_type: "admitted" }),
    baseDisposition({ disposition_id: "b", decision_type: "revoked" }),
  ];
  const markup = renderToStaticMarkup(<VendorDispositionHistory dispositions={rows} />);

  const admittedIndex = markup.indexOf("Admitted");
  const revokedIndex = markup.indexOf("Revoked");
  assert.ok(admittedIndex !== -1 && revokedIndex !== -1);
  assert.ok(admittedIndex < revokedIndex);
});
