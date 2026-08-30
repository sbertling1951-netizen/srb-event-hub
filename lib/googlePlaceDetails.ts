/**
 * Lazy Google Place Details (legacy Places API) lookup for the Nearby
 * curated-list builder.
 *
 * Details are fetched only when an admin moves a specific Google candidate
 * into the Working List -- never for every search result. Only fields the
 * existing Add/Edit Nearby editor actually uses are requested. A failure
 * here is always non-fatal: the caller keeps the search-derived entry and
 * surfaces a warning.
 */

import type { FetchLike } from "@/lib/googleNearby";

const DETAILS_ENDPOINT =
  "https://maps.googleapis.com/maps/api/place/details/json";

// Only what the Nearby editor consumes. `editorial_summary` is Atmosphere
// data and may be unavailable on some keys -- that is handled as a normal
// "field simply absent" case, not an error.
const REQUESTED_FIELDS = [
  "formatted_phone_number",
  "international_phone_number",
  "website",
  "plus_code",
  "editorial_summary",
  "formatted_address",
  "geometry/location",
  "types",
].join(",");

export type GooglePlaceDetails = {
  phone: string | null;
  website: string | null;
  plusCode: string | null;
  editorialSummary: string | null;
  formattedAddress: string | null;
  lat: number | null;
  lng: number | null;
  types: string[];
};

export type GooglePlaceDetailsResult =
  | { ok: true; details: GooglePlaceDetails }
  | { ok: false; status: string; httpStatus: number };

type RawDetailsPayload = {
  status?: string;
  result?: {
    formatted_phone_number?: string;
    international_phone_number?: string;
    website?: string;
    plus_code?: { global_code?: string; compound_code?: string };
    editorial_summary?: { overview?: string };
    formatted_address?: string;
    geometry?: { location?: { lat?: unknown; lng?: unknown } };
    types?: string[];
  };
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function fetchGooglePlaceDetails(
  fetchImpl: FetchLike,
  apiKey: string,
  placeId: string,
): Promise<GooglePlaceDetailsResult> {
  const url = new URL(DETAILS_ENDPOINT);
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", REQUESTED_FIELDS);
  url.searchParams.set("key", apiKey);

  let response: Awaited<ReturnType<FetchLike>>;
  let data: RawDetailsPayload;
  try {
    response = await fetchImpl(url.toString());
    data = (await response.json()) as RawDetailsPayload;
  } catch {
    return { ok: false, status: "FETCH_FAILED", httpStatus: 0 };
  }

  const status = data.status || "UNKNOWN_ERROR";
  if (!response.ok || status !== "OK" || !data.result) {
    return { ok: false, status, httpStatus: response.status };
  }

  const result = data.result;

  return {
    ok: true,
    details: {
      phone:
        result.formatted_phone_number ||
        result.international_phone_number ||
        null,
      website: result.website || null,
      plusCode:
        result.plus_code?.global_code ||
        result.plus_code?.compound_code ||
        null,
      editorialSummary: result.editorial_summary?.overview || null,
      formattedAddress: result.formatted_address || null,
      lat: numberOrNull(result.geometry?.location?.lat),
      lng: numberOrNull(result.geometry?.location?.lng),
      types: Array.isArray(result.types) ? [...result.types] : [],
    },
  };
}
