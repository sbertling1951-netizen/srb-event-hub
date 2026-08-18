import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import ReportsSummaryCards from "@/components/admin/reports/ReportsSummaryCards";
import type { CanonicalEventOperationalSummary } from "@/lib/eventOperationalSummary";

// Reports consumer reconciliation with the canonical Event Operational
// Summary Read Contract --
// docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md, "Consumer
// implications" for Reports. Run with:
//   npx tsx --test components/admin/reports/ReportsSummaryCards.test.tsx

const CANONICAL_SUMMARY: CanonicalEventOperationalSummary = {
  eventId: "event-1",
  totalRegistrations: 100,
  activeRegistrations: 80,
  cancelledRegistrations: 15,
  inactiveRegistrations: 5,
  activeArrived: 30,
  activeNotArrived: 50,
  currentPlacements: 28,
  activeNeedsParkingUnplaced: 12,
};

function baseProps() {
  return {
    registrationTypeBreakdown: [],
    dataStatusBreakdown: [],
    operationalSummary: CANONICAL_SUMMARY,
    operationalSummaryError: null,
    // Deliberately a different length from the canonical counts so the
    // test proves the card headline is not silently derived from the
    // page-local detail rows.
    arrivedRows: [
      { site: "", pilot: "Arrived One", email: "", cityState: "", participantType: "" },
    ],
    unassignedParkingRows: [],
    notArrivedRows: [],
    firstTimerCount: 0,
    firstTimerRows: [],
    vendorStaffCount: 0,
    vendorStaffRows: [],
  };
}

test("Arrived reflects canonical active_arrived, not the local preview row count", () => {
  const markup = renderToStaticMarkup(<ReportsSummaryCards {...baseProps()} />);
  assert.match(markup, /30 active registrations/);
});

test("Not Arrived reflects canonical active_not_arrived", () => {
  const markup = renderToStaticMarkup(<ReportsSummaryCards {...baseProps()} />);
  assert.match(markup, /50 active registrations/);
});

test("Unassigned Parking Needed reflects canonical active_needs_parking_unplaced", () => {
  const markup = renderToStaticMarkup(<ReportsSummaryCards {...baseProps()} />);
  assert.match(markup, /12 active registrations/);
});

test("cancelled/inactive registrations cannot inflate active Arrival metrics -- the canonical count wins over a larger local row count", () => {
  const props = baseProps();
  props.arrivedRows = Array.from({ length: 500 }, (_, i) => ({
    site: "",
    pilot: `Row ${i}`,
    email: "",
    cityState: "",
    participantType: "",
  }));
  const markup = renderToStaticMarkup(<ReportsSummaryCards {...props} />);
  assert.match(markup, /30 active registrations/);
  assert.ok(!markup.includes("500 active registration"));
});

test("when the canonical summary failed to load, cards report the failure instead of inventing a number", () => {
  const props = baseProps();
  props.operationalSummary = null;
  props.operationalSummaryError = "You do not have access to the operational summary for this event.";
  const markup = renderToStaticMarkup(<ReportsSummaryCards {...props} />);
  assert.match(
    markup,
    /You do not have access to the operational summary for this event\./,
  );
  assert.ok(!markup.includes("30 active registration"));
});

test("registration-oriented breakdown no longer claims participant/headcount semantics", () => {
  const markup = renderToStaticMarkup(<ReportsSummaryCards {...baseProps()} />);
  assert.match(markup, /Registration Type Breakdown/);
  assert.ok(!markup.includes("Participant Breakdown"));
});
