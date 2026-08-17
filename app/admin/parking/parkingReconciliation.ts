export type CanonicalMasterSite = {
  id: string;
  site_number: string;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
};

export type CanonicalParkingAssignment = {
  id: string;
  event_id: string;
  master_site_id: string | null;
  assigned_attendee_id: string | null;
};

export type CanonicalAttendee = {
  id: string;
  assigned_site: string | null;
};

export type CanonicalParkingSite = Omit<CanonicalMasterSite, "id"> & {
  id: string | null;
  event_id: string;
  master_site_id: string;
  assigned_attendee_id: string | null;
};

export type CanonicalParkingSnapshot =
  | { ok: true; sites: CanonicalParkingSite[]; siteLabelByAttendeeId: Map<string, string> }
  | { ok: false; error: string };

function normalizedSiteLabel(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Builds the Parking page's display projection from the one canonical current
 * placement relationship. The attendee projection is diagnostic only: it can
 * reveal drift, but can never supply or replace occupancy.
 */
export function buildCanonicalParkingSnapshot({
  eventId,
  masterSites,
  assignments,
  attendees,
}: {
  eventId: string;
  masterSites: CanonicalMasterSite[];
  assignments: CanonicalParkingAssignment[];
  attendees: CanonicalAttendee[];
}): CanonicalParkingSnapshot {
  const masterSiteById = new Map(masterSites.map((site) => [site.id, site]));
  const attendeeById = new Map(attendees.map((attendee) => [attendee.id, attendee]));
  const assignmentByMasterSiteId = new Map<string, CanonicalParkingAssignment>();
  const siteLabelByAttendeeId = new Map<string, string>();

  for (const assignment of assignments) {
    if (assignment.event_id !== eventId || !assignment.master_site_id) {
      return { ok: false, error: "Canonical parking inventory contains an invalid event or site identity." };
    }
    if (!masterSiteById.has(assignment.master_site_id)) {
      return { ok: false, error: "Canonical parking inventory references a site outside the selected map." };
    }
    if (assignmentByMasterSiteId.has(assignment.master_site_id)) {
      return { ok: false, error: "Canonical parking inventory contains duplicate site records." };
    }
    if (assignment.assigned_attendee_id) {
      if (!attendeeById.has(assignment.assigned_attendee_id)) {
        return { ok: false, error: "Canonical parking occupancy references an attendee outside this event roster." };
      }
      if (siteLabelByAttendeeId.has(assignment.assigned_attendee_id)) {
        return { ok: false, error: "Canonical parking occupancy places one attendee at multiple sites." };
      }
      const masterSite = masterSiteById.get(assignment.master_site_id)!;
      siteLabelByAttendeeId.set(
        assignment.assigned_attendee_id,
        masterSite.display_label || masterSite.site_number,
      );
    }
    assignmentByMasterSiteId.set(assignment.master_site_id, assignment);
  }

  for (const attendee of attendees) {
    const projectedSite = normalizedSiteLabel(attendee.assigned_site);
    if (!projectedSite) {
      continue;
    }
    const canonicalSite = normalizedSiteLabel(siteLabelByAttendeeId.get(attendee.id));
    if (!canonicalSite) {
      return { ok: false, error: "Attendee site projection has no matching canonical parking placement." };
    }
    if (projectedSite !== canonicalSite) {
      return { ok: false, error: "Attendee site projection disagrees with canonical parking placement." };
    }
  }

  return {
    ok: true,
    siteLabelByAttendeeId,
    sites: masterSites.map((masterSite) => {
      const assignment = assignmentByMasterSiteId.get(masterSite.id);
      return {
        ...masterSite,
        id: assignment?.id || null,
        event_id: eventId,
        master_site_id: masterSite.id,
        assigned_attendee_id: assignment?.assigned_attendee_id || null,
      };
    }),
  };
}

export type ParkingSelectionFingerprint = {
  eventId: string;
  attendeeId: string | null;
  attendeeSite: string | null;
  siteId: string | null;
  siteOccupantId: string | null;
};

export function selectionChangedRemotely(
  previous: ParkingSelectionFingerprint | null,
  next: ParkingSelectionFingerprint,
): boolean {
  if (!previous || previous.eventId !== next.eventId) {
    return false;
  }
  return (
    (previous.attendeeId !== null && previous.attendeeSite !== next.attendeeSite) ||
    (previous.siteId !== null && previous.siteOccupantId !== next.siteOccupantId)
  );
}

export function mayApplyParkingLoad({
  requestGeneration,
  latestGeneration,
  requestedEventId,
  currentEventId,
}: {
  requestGeneration: number;
  latestGeneration: number;
  requestedEventId: string;
  currentEventId: string | null | undefined;
}): boolean {
  return (
    requestGeneration === latestGeneration && requestedEventId === currentEventId
  );
}
