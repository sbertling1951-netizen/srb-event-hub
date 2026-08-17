import { supabase } from "@/lib/supabase";

// Canonical Event Operational Summary Read Contract --
// docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md, section
// "Canonical Event Operational Summary Read Contract".
//
// This module is the contract's layer 2: a small shared presentation
// adapter over the governed public.get_event_operational_summary(uuid)
// database read (layer 1). It only formats, labels, and composes values
// the database already computed -- it must never independently calculate
// or redefine a canonical fact. There is deliberately no arithmetic here
// (no addition, subtraction, or derived boolean) beyond copying a field
// and, in formatArrivedOfActive, joining two already-canonical numbers
// into one display string.

export type CanonicalEventOperationalSummary = {
  eventId: string;
  totalRegistrations: number;
  activeRegistrations: number;
  cancelledRegistrations: number;
  inactiveRegistrations: number;
  activeArrived: number;
  activeNotArrived: number;
  currentPlacements: number;
  activeNeedsParkingUnplaced: number;
};

export type EventOperationalSummaryResult =
  | { ok: true; summary: CanonicalEventOperationalSummary }
  // The caller holds none of the contract's authorized read
  // capabilities (event.attendees.view / event.checkin.view /
  // event.parking.view / event.reports.view) for this Event, or the
  // Event does not exist -- the database fails both closed identically.
  | { ok: false; reason: "authorization_denied" }
  | { ok: false; reason: "load_failed"; message: string };

type RawSummaryRow = {
  event_id: string;
  total_registrations: number;
  active_registrations: number;
  cancelled_registrations: number;
  inactive_registrations: number;
  active_arrived: number;
  active_not_arrived: number;
  current_placements: number;
  active_needs_parking_unplaced: number;
};

function toCanonicalSummary(row: RawSummaryRow): CanonicalEventOperationalSummary {
  return {
    eventId: row.event_id,
    totalRegistrations: row.total_registrations,
    activeRegistrations: row.active_registrations,
    cancelledRegistrations: row.cancelled_registrations,
    inactiveRegistrations: row.inactive_registrations,
    activeArrived: row.active_arrived,
    activeNotArrived: row.active_not_arrived,
    currentPlacements: row.current_placements,
    activeNeedsParkingUnplaced: row.active_needs_parking_unplaced,
  };
}

/**
 * Fetches the governed Event-scoped operational summary for `eventId`
 * through public.get_event_operational_summary(uuid). Authority is
 * enforced entirely inside that database function -- this wrapper adds
 * no permission check of its own and cannot widen or bypass it.
 */
export async function fetchEventOperationalSummary(
  eventId: string,
): Promise<EventOperationalSummaryResult> {
  if (!eventId) {
    return { ok: false, reason: "load_failed", message: "eventId is required" };
  }

  const { data, error } = await supabase
    .rpc("get_event_operational_summary", { p_event_id: eventId })
    .maybeSingle();

  if (error) {
    if (/authorization_denied/i.test(error.message)) {
      return { ok: false, reason: "authorization_denied" };
    }
    return { ok: false, reason: "load_failed", message: error.message };
  }

  if (!data) {
    return { ok: false, reason: "load_failed", message: "no summary row returned" };
  }

  return { ok: true, summary: toCanonicalSummary(data as RawSummaryRow) };
}

export type EventOperationalSummaryCardKey =
  | "totalRegistrations"
  | "activeRegistrations"
  | "cancelledRegistrations"
  | "inactiveRegistrations"
  | "activeArrived"
  | "activeNotArrived"
  | "currentPlacements"
  | "activeNeedsParkingUnplaced";

export type EventOperationalSummaryCard = {
  key: EventOperationalSummaryCardKey;
  label: string;
  value: number;
};

const CARD_LABELS: Record<EventOperationalSummaryCardKey, string> = {
  totalRegistrations: "Total Registrations",
  activeRegistrations: "Active Registrations",
  cancelledRegistrations: "Cancelled Registrations",
  inactiveRegistrations: "Inactive Registrations",
  activeArrived: "Active Arrived",
  activeNotArrived: "Active Not Arrived",
  currentPlacements: "Current Placements",
  activeNeedsParkingUnplaced: "Active Needs-Parking / Unplaced",
};

const CARD_ORDER: EventOperationalSummaryCardKey[] = [
  "totalRegistrations",
  "activeRegistrations",
  "cancelledRegistrations",
  "inactiveRegistrations",
  "activeArrived",
  "activeNotArrived",
  "currentPlacements",
  "activeNeedsParkingUnplaced",
];

/**
 * Turns the canonical summary into an ordered, labelled list a page can
 * render directly as cards. Every `value` is copied verbatim from
 * `summary` -- nothing here recomputes or combines fields.
 */
export function toEventOperationalSummaryCards(
  summary: CanonicalEventOperationalSummary,
): EventOperationalSummaryCard[] {
  return CARD_ORDER.map((key) => ({
    key,
    label: CARD_LABELS[key],
    value: summary[key],
  }));
}

/**
 * "N of M" display for a consumer like Check-In's arrival summary (per
 * the contract's Consumer implications: its "X of Y" summary "consumes
 * the canonical active Arrival values rather than a page-local queue
 * filter"). Pure string composition of two already-canonical numbers --
 * it does not add, subtract, or otherwise derive a new fact.
 */
export function formatArrivedOfActive(summary: CanonicalEventOperationalSummary): string {
  return `${summary.activeArrived} of ${summary.activeRegistrations}`;
}
