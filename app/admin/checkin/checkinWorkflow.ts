export type CheckinBrowseAttendee = {
  id: string;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  email: string | null;
  assigned_site: string | null;
  has_arrived: boolean | null;
  arrival_status: string | null;
  coach_make: string | null;
  coach_model: string | null;
  is_active: boolean | null;
  registration_status: string | null;
};

// Registration eligibility, record activity, and arrival state are three
// independent facts. Only the first two decide whether a registration may be
// checked in at all; arrival state is what Check-In writes.
//
// This mirrors the existing Admin operational-summary predicate
// (20260817180000_create_event_operational_summary_read.sql), which is the
// source of the Admin "active registrations" figure operators compare against:
//   is_active IS TRUE AND registration_status IS DISTINCT FROM 'cancelled'
// Non-cancelled statuses therefore stay eligible, deliberately -- the Member
// roster's stricter allowlist is a different rule for a different surface and
// is not imported here. Missing activity is treated as ineligible.
export function isCheckinEligible(
  attendee: Pick<CheckinBrowseAttendee, "is_active" | "registration_status">,
): boolean {
  return (
    attendee.is_active === true && attendee.registration_status !== "cancelled"
  );
}

// The one page-local reduction every Check-In surface derives from: loaded
// totals, browse/search, waiting counts, and selected-record resolution all
// read the eligible set, so no surface can act on a record another surface
// has already excluded.
export function selectEligibleCheckinAttendees<T extends CheckinBrowseAttendee>(
  attendees: T[],
): T[] {
  return attendees.filter((attendee) => isCheckinEligible(attendee));
}

export type CheckinEditState<TSharingField extends string = string> = {
  sharedFields: TSharingField[];
};

function attendeeSortName(attendee: CheckinBrowseAttendee) {
  return [attendee.pilot_last, attendee.pilot_first]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

export function sortCheckinBrowseAttendees<T extends CheckinBrowseAttendee>(
  attendees: T[],
): T[] {
  return [...attendees].sort((left, right) => {
    const arrivalOrder =
      Number(!!left.has_arrived) - Number(!!right.has_arrived);
    return (
      arrivalOrder ||
      attendeeSortName(left).localeCompare(attendeeSortName(right))
    );
  });
}

export function filterCheckinBrowseAttendees<T extends CheckinBrowseAttendee>(
  attendees: T[],
  search: string,
  showArrived: boolean,
  extraSearchText: (attendee: T) => string = () => "",
): T[] {
  const query = search.trim().toLocaleLowerCase();
  return sortCheckinBrowseAttendees(attendees).filter((attendee) => {
    // Eligibility is not a convenience filter: neither a search term nor
    // "show already checked-in" may surface a cancelled or inactive
    // registration. Applied here as well as at the page's eligible-set
    // reduction so this tested helper remains the browse authority.
    if (!isCheckinEligible(attendee)) {
      return false;
    }

    if (!query && !showArrived && attendee.has_arrived) {
      return false;
    }

    if (!query) {
      return true;
    }

    return [
      attendee.pilot_first,
      attendee.pilot_last,
      attendee.copilot_first,
      attendee.copilot_last,
      attendee.email,
      attendee.assigned_site,
      attendee.coach_make,
      attendee.coach_model,
      extraSearchText(attendee),
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(query);
  });
}

export function reconcileCheckinEditState<T extends CheckinEditState>(
  serverState: Record<string, T>,
  currentState: Record<string, T>,
  selectedAttendeeId: string | null,
  selectedIsDirty: boolean,
): Record<string, T> {
  if (
    !selectedAttendeeId ||
    !selectedIsDirty ||
    !currentState[selectedAttendeeId]
  ) {
    return serverState;
  }

  return {
    ...serverState,
    [selectedAttendeeId]: currentState[selectedAttendeeId],
  };
}

export function selectedAttendeeChangedRemotely(
  baselineFingerprint: string | null,
  serverFingerprint: string | null,
  selectedIsDirty: boolean,
): boolean {
  return !!(
    selectedIsDirty &&
    baselineFingerprint &&
    serverFingerprint &&
    baselineFingerprint !== serverFingerprint
  );
}

// Deliberately excludes assigned_site -- Check-In no longer owns or edits
// placement (Admin Check-In / Parking ownership cutover, Stage A), so a
// Parking-originated site change must never trip Check-In's own "changed at
// another Check-In station" conflict banner.
export function checkinServerFingerprint(
  attendee: Pick<CheckinBrowseAttendee, "id" | "has_arrived" | "arrival_status">,
  sharedFields: string[],
): string {
  return JSON.stringify({
    id: attendee.id,
    hasArrived: !!attendee.has_arrived,
    arrivalStatus: attendee.arrival_status || null,
    sharedFields: [...sharedFields].sort(),
  });
}
