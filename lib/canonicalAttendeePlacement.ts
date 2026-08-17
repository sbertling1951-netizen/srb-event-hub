import { supabase } from "@/lib/supabase";

// Canonical attendee placement read (Attendees Stage A prerequisite --
// docs/architecture/EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md
// and EPICENTRAX_SITE_PLACEMENT_IMPLEMENTATION_SPECIFICATION.md).
//
// The governance architecture (§2, §3) is explicit: "attendee-entered
// site information is reported evidence, never an independent
// authoritative placement," and the canonical current placement is "the
// occupied relationship in parking_sites(event_id, master_site_id,
// assigned_attendee_id)." The implementation specification (§2, §9)
// names attendees.assigned_site a "governed compatibility projection,
// not a second authoritative placement source" and requires that
// "readers must not use it to resolve occupancy." This module is that
// read path for Attendees: it never selects, filters, or falls back to
// attendees.assigned_site.
//
// This performs a direct client-side read under the same Admin RLS
// posture app/admin/parking/page.tsx and app/admin/checkin/page.tsx
// already rely on for the identical parking_sites/master_map_sites
// tables (both SELECT-grant `authenticated`, gated by their own existing
// RLS policies -- unchanged by this module). No new RPC, grant, or
// policy was required or added: authority is derived server-side by
// Postgres RLS exactly as it already is for Parking and Check-In's own
// reads of these same tables, not re-implemented here.

export type CanonicalAttendeePlacementSite = {
  parkingSiteId: string;
  masterSiteId: string;
  label: string;
};

export type CanonicalAttendeePlacementResult =
  // The attendee exists in the requested Event. `site` is null when the
  // attendee has no current authoritative placement (Unassigned) --
  // this is the correct, safe default for "no parking_sites row," never
  // a fallback to attendees.assigned_site.
  | { ok: true; site: CanonicalAttendeePlacementSite | null }
  // The attendee does not exist, or does not belong to the requested
  // Event (deleted, stale, or a cross-Event id). Deliberately not
  // distinguished further, matching resolveAdminAttendeeTarget's own
  // "invalid" handling -- the caller never re-queries to find out which.
  | { ok: false; reason: "attendee_not_found_in_event" }
  // The read itself failed (network/database error). Distinct from
  // "attendee_not_found_in_event" so a caller never displays a
  // transient failure as though the attendee were confirmed absent.
  | { ok: false; reason: "load_failed"; message: string };

type AttendeeExistsRow = { id: string };

type PlacementQueryRow = {
  id: string;
  master_site_id: string;
  master_map_sites: {
    site_number: string | null;
    display_label: string | null;
  } | null;
};

/**
 * Pure reduction from the two raw query results to the governed result
 * shape. Kept separate from fetchCanonicalAttendeePlacement below so the
 * decision logic -- what "Unassigned" means, what counts as
 * cross-Event -- is unit-testable without a network call, matching the
 * existing buildCanonicalParkingSnapshot / pure-reducer pattern already
 * used in app/admin/parking/parkingReconciliation.ts.
 */
export function reduceCanonicalAttendeePlacement(
  attendeeRow: AttendeeExistsRow | null,
  placementRow: PlacementQueryRow | null,
): CanonicalAttendeePlacementResult {
  if (!attendeeRow) {
    return { ok: false, reason: "attendee_not_found_in_event" };
  }

  if (!placementRow) {
    return { ok: true, site: null };
  }

  const label =
    placementRow.master_map_sites?.display_label ||
    placementRow.master_map_sites?.site_number ||
    placementRow.master_site_id;

  return {
    ok: true,
    site: {
      parkingSiteId: placementRow.id,
      masterSiteId: placementRow.master_site_id,
      label,
    },
  };
}

/**
 * For attendee `attendeeId` in Event `eventId`, returns the current
 * governed Site Placement, derived only from canonical parking_sites
 * occupancy (joined to master_map_sites for its display label) --
 * never from attendees.assigned_site, free-text label matching, or
 * client-side reconstruction of the legacy projection.
 *
 * Event-scoped: both queries filter by eventId, and the attendee-exists
 * check requires the attendee's own event_id to match, so a valid
 * attendee id belonging to a different Event resolves to
 * "attendee_not_found_in_event" here, exactly like a deleted or unknown
 * id -- it can never return another Event's placement.
 */
export async function fetchCanonicalAttendeePlacement(
  eventId: string,
  attendeeId: string,
): Promise<CanonicalAttendeePlacementResult> {
  if (!eventId || !attendeeId) {
    return { ok: false, reason: "attendee_not_found_in_event" };
  }

  const { data: attendeeRow, error: attendeeError } = await supabase
    .from("attendees")
    .select("id")
    .eq("id", attendeeId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (attendeeError) {
    return {
      ok: false,
      reason: "load_failed",
      message: attendeeError.message,
    };
  }

  if (!attendeeRow) {
    return { ok: false, reason: "attendee_not_found_in_event" };
  }

  const { data: placementRow, error: placementError } = await supabase
    .from("parking_sites")
    .select("id,master_site_id,master_map_sites(site_number,display_label)")
    .eq("event_id", eventId)
    .eq("assigned_attendee_id", attendeeId)
    .maybeSingle();

  if (placementError) {
    return {
      ok: false,
      reason: "load_failed",
      message: placementError.message,
    };
  }

  return reduceCanonicalAttendeePlacement(
    attendeeRow as AttendeeExistsRow,
    placementRow as unknown as PlacementQueryRow | null,
  );
}
