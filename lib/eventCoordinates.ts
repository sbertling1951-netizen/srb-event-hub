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
