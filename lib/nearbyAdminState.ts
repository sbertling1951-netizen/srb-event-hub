export type StoredAreaSelectionCandidate = {
  id: string;
  name: string;
};

/** A completed request may only update Nearby state for the still-current Event. */
export function isCurrentNearbyEventRequest(
  requestEventId: string,
  currentEventId: string | null | undefined,
): boolean {
  return requestEventId === currentEventId;
}

/**
 * Stored Areas are an independent reusable collection. Explicit operator
 * selections therefore take precedence over optional Event-based suggestions.
 */
export function resolveStoredAreaSelection(
  areas: StoredAreaSelectionCandidate[],
  currentAreaId: string,
  persistedAreaId: string | null,
  adminEvent: { name?: string | null; location?: string | null } | null,
): string {
  const hasArea = (id: string | null | undefined) =>
    !!id && areas.some((area) => area.id === id);

  if (hasArea(currentAreaId)) {
    return currentAreaId;
  }

  if (hasArea(persistedAreaId)) {
    return persistedAreaId!;
  }

  if (adminEvent?.name) {
    const normalizedEventName = adminEvent.name.toLowerCase().trim();
    const matchingByName = areas.find((area) => {
      const normalizedAreaName = area.name.toLowerCase().trim();
      return (
        normalizedAreaName.includes(normalizedEventName) ||
        normalizedEventName.includes(normalizedAreaName)
      );
    });

    if (matchingByName) {
      return matchingByName.id;
    }
  }

  if (adminEvent?.location) {
    const locationParts = adminEvent.location
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    const possibleCity = locationParts.length >= 2 ? locationParts[1] : "";
    const matchingByCity = possibleCity
      ? areas.find((area) => area.name.toLowerCase().trim().includes(possibleCity))
      : null;

    if (matchingByCity) {
      return matchingByCity.id;
    }
  }

  return areas[0]?.id || "";
}
