type Geocode = (input: { address: string }) => Promise<{ lat: number | null; lng: number | null }>;
export type EventCoordinateResolution = { kind: "manual" | "geocoded"; lat: number; lng: number } | { kind: "no_location" } | { kind: "unresolved"; message: string };

function coordinate(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number.`);
  return parsed;
}

export async function resolveEventCoordinates(input: { location: string; lat: string; lng: string }, geocode: Geocode): Promise<EventCoordinateResolution> {
  const lat = coordinate(input.lat, "Latitude");
  const lng = coordinate(input.lng, "Longitude");
  if ((lat === null) !== (lng === null)) throw new Error("Latitude and longitude must be entered together.");
  if (lat !== null && (lat < -90 || lat > 90)) throw new Error("Latitude must be between -90 and 90.");
  if (lng !== null && (lng < -180 || lng > 180)) throw new Error("Longitude must be between -180 and 180.");
  if (lat !== null && lng !== null) return { kind: "manual", lat, lng };
  const location = input.location.trim();
  if (!location) return { kind: "no_location" };
  const resolved = await geocode({ address: location });
  return resolved.lat !== null && resolved.lng !== null ? { kind: "geocoded", lat: resolved.lat, lng: resolved.lng } : { kind: "unresolved", message: "Could not resolve coordinates for this location. Enter a complete manual coordinate pair or correct the location before saving." };
}

// Whether an Event save needs to run coordinate resolution at all. A manual
// pair being entered must always be validated; a changed location text must
// be geocoded; a brand-new Event always resolves. An EDIT that touched
// neither the coordinate fields nor the location text must NOT re-geocode
// an unchanged location merely because the stored coordinate fields render
// blank -- it keeps whatever is stored.
export function eventSaveShouldResolveCoordinates(input: {
  mode: "create" | "edit";
  hasManualCoordinateInput: boolean;
  locationChanged: boolean;
}): boolean {
  return (
    input.mode === "create" ||
    input.hasManualCoordinateInput ||
    input.locationChanged
  );
}

export type CoordinatePersistencePlan =
  | { kind: "write"; lat: number; lng: number; notice: null }
  | { kind: "clear"; notice: null }
  | { kind: "preserve"; notice: string | null };

// Turn a resolution into what the save should actually persist. An
// unresolved geocode NEVER blocks the save and NEVER nulls a stored pair --
// it preserves whatever is stored and surfaces a non-blocking notice. On
// create there is nothing to preserve, so an absent location writes NULL
// coordinates; on edit an absent location leaves a stored pair alone.
export function planCoordinatePersistence(
  resolution: EventCoordinateResolution,
  mode: "create" | "edit",
): CoordinatePersistencePlan {
  if (resolution.kind === "manual" || resolution.kind === "geocoded") {
    return { kind: "write", lat: resolution.lat, lng: resolution.lng, notice: null };
  }

  if (resolution.kind === "no_location") {
    return mode === "create"
      ? { kind: "clear", notice: null }
      : { kind: "preserve", notice: null };
  }

  return {
    kind: "preserve",
    notice:
      "Coordinates could not be resolved automatically for this location. " +
      (mode === "create"
        ? "The Event was created; open it in Event Admin to enter a latitude and longitude pair."
        : "The rest of the Event was saved; enter a latitude and longitude pair manually."),
  };
}
