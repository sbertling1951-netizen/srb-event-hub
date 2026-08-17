// Canonical Admin attendee-target handoff contract (docs/architecture --
// see the Attendees Stage A prerequisite review). Lets one Admin surface
// (for example, a future Attendees "View in Check-In" / "View in
// Parking" link) hand a specific attendee to another Admin surface
// through a durable, inspectable URL search parameter, without ever
// carrying an Event switch alongside it.
//
// Per ADR-006 §2, Event context is owned exclusively by the canonical
// Admin workspace store and must never be silently replaced by
// navigation. This contract therefore carries only an attendee id -- it
// has no Event field at all, so there is nothing for a destination page
// to read as an Event-switch instruction. A destination page resolves
// the target against whatever Event it has already, independently,
// loaded through its own existing Event-context flow; see
// resolveAdminAttendeeTarget below.

export const ADMIN_ATTENDEE_TARGET_PARAM = "attendee";

/**
 * Builds an href to `pathname` carrying the canonical attendee-target
 * parameter. Reusable by any Admin surface that wants to hand a specific
 * attendee to another Admin surface (Check-In, Parking, and any future
 * consumer) -- one shared parameter name and shape, not a per-destination
 * scheme.
 */
export function buildAdminAttendeeTargetHref(
  pathname: string,
  attendeeId: string,
): string {
  const params = new URLSearchParams();
  params.set(ADMIN_ATTENDEE_TARGET_PARAM, attendeeId);
  return `${pathname}?${params.toString()}`;
}

/**
 * Reads the raw attendee-target id from a page's search params, if
 * present. Returns null for a missing or blank value. This is a pure
 * read of the URL -- it makes no claim that the id is valid, current, or
 * in the current Event; see resolveAdminAttendeeTarget for that.
 */
export function readAdminAttendeeTarget(
  searchParams: { get(name: string): string | null } | null | undefined,
): string | null {
  if (!searchParams) {
    return null;
  }

  const raw = (searchParams.get(ADMIN_ATTENDEE_TARGET_PARAM) || "").trim();
  return raw || null;
}

export type AdminAttendeeTargetResolution =
  // No target parameter was present -- ordinary direct navigation.
  | { status: "none" }
  // The target id is present in the destination's own already
  // Event-scoped, already-loaded attendee roster.
  | { status: "valid"; attendeeId: string }
  // The target id was supplied but is not in the destination's own
  // already Event-scoped roster -- missing, deleted, stale, or
  // belonging to a different Event. These are deliberately not
  // distinguished from one another: the destination never re-queries to
  // find out which, and never treats any of them as a cue to look in a
  // different Event.
  | { status: "invalid"; attendeeId: string };

/**
 * Resolves a raw attendee-target id against a destination page's own,
 * already-loaded, already Event-scoped attendee list -- never a fresh
 * fetch, never a different Event. Every current consumer (Check-In,
 * Parking) already loads its attendee roster filtered to the current
 * working Event before this ever runs, so an id absent from that list is
 * definitionally not a valid target in the current Event: this function
 * makes no additional network request and cannot itself request or
 * receive cross-Event data. This is what guarantees Rule C/D of the
 * Attendees Stage A prerequisite: an invalid or cross-Event target fails
 * safely and visibly, and can never cause a different attendee or a
 * different Event to be silently selected.
 */
export function resolveAdminAttendeeTarget<T extends { id: string }>(
  targetId: string | null,
  eventScopedAttendees: readonly T[],
): AdminAttendeeTargetResolution {
  if (!targetId) {
    return { status: "none" };
  }

  const found = eventScopedAttendees.some((row) => row.id === targetId);

  return found
    ? { status: "valid", attendeeId: targetId }
    : { status: "invalid", attendeeId: targetId };
}
