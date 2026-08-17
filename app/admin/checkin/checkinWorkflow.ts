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
};

export type CheckinEditState<TSharingField extends string = string> = {
  siteNumber: string;
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
    const arrivalOrder = Number(!!left.has_arrived) - Number(!!right.has_arrived);
    return arrivalOrder || attendeeSortName(left).localeCompare(attendeeSortName(right));
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
  if (!selectedAttendeeId || !selectedIsDirty || !currentState[selectedAttendeeId]) {
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

export function checkinServerFingerprint(
  attendee: Pick<
    CheckinBrowseAttendee,
    "id" | "assigned_site" | "has_arrived" | "arrival_status"
  >,
  sharedFields: string[],
): string {
  return JSON.stringify({
    id: attendee.id,
    assignedSite: attendee.assigned_site || null,
    hasArrived: !!attendee.has_arrived,
    arrivalStatus: attendee.arrival_status || null,
    sharedFields: [...sharedFields].sort(),
  });
}