/**
 * Server-side Google Places (legacy) helpers for the Nearby curated-list
 * builder: Event-location geocoding, radius handling, and the bounded
 * multi-request "fan-out" that one visible admin Search action expands
 * into.
 *
 * Everything here is pure and provider-agnostic in the sense that the
 * `fetch` implementation is injected -- the route passes the real
 * `globalThis.fetch`, tests pass a stub. No credential, key rotation, or
 * endpoint configuration decision lives here; the API key is passed in.
 */

import {
  buildGoogleNearbyProviderRequests,
  type GoogleNearbyProviderRequest,
} from "@/lib/googlePlaceTypeMapping";

export type FetchLike = (input: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";
const NEARBY_ENDPOINT =
  "https://maps.googleapis.com/maps/api/place/nearbysearch/json";

// Google Places Nearby Search caps `radius` at 50 000 m. Keep a small
// floor so a fat-fingered 0 does not become a point search.
const MIN_RADIUS_MILES = 0.25;
const MAX_RADIUS_MILES = 31; // ~= 49 890 m
const DEFAULT_RADIUS_MILES = 10;
const METERS_PER_MILE = 1609;
const DEFAULT_CONCURRENCY = 3;

export function normalizeRadiusMiles(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RADIUS_MILES;
  }

  return Math.min(Math.max(parsed, MIN_RADIUS_MILES), MAX_RADIUS_MILES);
}

export function radiusMilesToMeters(radiusMiles: number): number {
  return Math.round(normalizeRadiusMiles(radiusMiles) * METERS_PER_MILE);
}

type GoogleStatusPayload = {
  status?: string;
  results?: unknown[];
};

export type GeocodeResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; status: string; httpStatus: number };

export async function geocodeEventLocationViaGoogle(
  fetchImpl: FetchLike,
  apiKey: string,
  address: string,
): Promise<GeocodeResult> {
  const url = new URL(GEOCODE_ENDPOINT);
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);

  const response = await fetchImpl(url.toString());
  const data = (await response.json()) as GoogleStatusPayload & {
    results?: Array<{
      geometry?: { location?: { lat?: unknown; lng?: unknown } };
    }>;
  };

  if (!response.ok || data.status !== "OK") {
    return {
      ok: false,
      status: data.status || "UNKNOWN_ERROR",
      httpStatus: response.status,
    };
  }

  const location = data.results?.[0]?.geometry?.location;
  if (
    typeof location?.lat !== "number" ||
    typeof location?.lng !== "number"
  ) {
    return { ok: false, status: "MISSING_COORDINATES", httpStatus: 422 };
  }

  return { ok: true, lat: location.lat, lng: location.lng };
}

export type NearbyCandidate = {
  id: string | null;
  name: string | null;
  address: string;
  rating?: number;
  /** First Google type -- the existing single-type "category" field. */
  category: string | null;
  lat: number | null;
  lng: number | null;
  /** All Google types Google returned for this place (merge-preserved). */
  googleTypes: string[];
  /**
   * EpicentraX category codes whose provider request produced this
   * candidate. Explains why a place appears; multiple when the same
   * place matched several requested categories.
   */
  producingCategoryCodes: string[];
  /** True when at least one producing request also matched free text. */
  fromFreeText: boolean;
  /**
   * True only when every producing request used an exact Google type.
   * False when any producing request was a keyword/approximate fallback.
   */
  mappingExact: boolean;
};

export type FanOutRequestOutcome = {
  categoryCode: string;
  keyword: string | null;
  googleType: string | null;
  status: string;
  httpStatus: number;
  count: number;
};

export type FanOutResult = {
  candidates: NearbyCandidate[];
  perRequest: FanOutRequestOutcome[];
  /** True when at least one provider request completed (OK/ZERO_RESULTS). */
  hadAnySuccess: boolean;
};

type RawNearbyPlace = {
  place_id?: string;
  name?: string;
  vicinity?: string;
  formatted_address?: string;
  rating?: number;
  types?: string[];
  geometry?: { location?: { lat?: unknown; lng?: unknown } };
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nearbySearchUrl(
  request: GoogleNearbyProviderRequest,
  params: { apiKey: string; lat: number; lng: number; radiusMeters: number },
): string {
  const url = new URL(NEARBY_ENDPOINT);
  url.searchParams.set("location", `${params.lat},${params.lng}`);
  url.searchParams.set("radius", String(params.radiusMeters));
  url.searchParams.set("key", params.apiKey);

  if (request.googleType) {
    url.searchParams.set("type", request.googleType);
  }
  if (request.keyword) {
    url.searchParams.set("keyword", request.keyword);
  }

  return url.toString();
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function pump(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  const runners = Array.from(
    { length: Math.min(Math.max(1, limit), items.length || 1) },
    () => pump(),
  );
  await Promise.all(runners);
  return results;
}

/**
 * Expand and execute one Search action. `requests` is already the
 * de-duplicated provider request set from
 * `buildGoogleNearbyProviderRequests`.
 */
export async function runGoogleNearbyFanOut(params: {
  fetchImpl: FetchLike;
  apiKey: string;
  lat: number;
  lng: number;
  radiusMiles: number;
  requests: GoogleNearbyProviderRequest[];
  concurrency?: number;
}): Promise<FanOutResult> {
  const radiusMeters = radiusMilesToMeters(params.radiusMiles);
  const merged = new Map<string, NearbyCandidate>();
  // Candidates Google returned without a place_id keep their own slots --
  // never merged, never assigned a fabricated id.
  const unkeyed: NearbyCandidate[] = [];

  const outcomes = await runWithConcurrency(
    params.requests,
    params.concurrency ?? DEFAULT_CONCURRENCY,
    async (request): Promise<FanOutRequestOutcome> => {
      const url = nearbySearchUrl(request, {
        apiKey: params.apiKey,
        lat: params.lat,
        lng: params.lng,
        radiusMeters,
      });

      let response: Awaited<ReturnType<FetchLike>>;
      let data: GoogleStatusPayload & { results?: RawNearbyPlace[] };
      try {
        response = await params.fetchImpl(url);
        data = (await response.json()) as typeof data;
      } catch {
        return {
          categoryCode: request.categoryCode,
          keyword: request.keyword,
          googleType: request.googleType,
          status: "FETCH_FAILED",
          httpStatus: 0,
          count: 0,
        };
      }

      const status = data.status || "UNKNOWN_ERROR";
      if (!response.ok || (status !== "OK" && status !== "ZERO_RESULTS")) {
        return {
          categoryCode: request.categoryCode,
          keyword: request.keyword,
          googleType: request.googleType,
          status,
          httpStatus: response.status,
          count: 0,
        };
      }

      const rawResults = Array.isArray(data.results) ? data.results : [];
      for (const raw of rawResults) {
        const placeId = raw.place_id?.trim() || "";
        const candidate: NearbyCandidate = {
          id: placeId || null,
          name: raw.name ?? null,
          address: raw.vicinity || raw.formatted_address || "",
          rating: raw.rating,
          category: raw.types?.[0] ?? null,
          lat: numberOrNull(raw.geometry?.location?.lat),
          lng: numberOrNull(raw.geometry?.location?.lng),
          googleTypes: Array.isArray(raw.types) ? [...raw.types] : [],
          producingCategoryCodes: request.categoryCode
            ? [request.categoryCode]
            : [],
          fromFreeText: request.categoryCode === "",
          mappingExact: request.exact,
        };

        if (!placeId) {
          unkeyed.push(candidate);
          continue;
        }

        const existing = merged.get(placeId);
        if (!existing) {
          merged.set(placeId, candidate);
          continue;
        }

        // Merge producing-category provenance without duplication.
        for (const code of candidate.producingCategoryCodes) {
          if (!existing.producingCategoryCodes.includes(code)) {
            existing.producingCategoryCodes.push(code);
          }
        }
        for (const type of candidate.googleTypes) {
          if (!existing.googleTypes.includes(type)) {
            existing.googleTypes.push(type);
          }
        }
        existing.fromFreeText = existing.fromFreeText || candidate.fromFreeText;
        // Exact only if every contributing request was exact.
        existing.mappingExact = existing.mappingExact && candidate.mappingExact;
        // Fill gaps from a later result but never overwrite good data.
        existing.name = existing.name ?? candidate.name;
        existing.address = existing.address || candidate.address;
        existing.rating = existing.rating ?? candidate.rating;
        existing.category = existing.category ?? candidate.category;
        existing.lat = existing.lat ?? candidate.lat;
        existing.lng = existing.lng ?? candidate.lng;
      }

      return {
        categoryCode: request.categoryCode,
        keyword: request.keyword,
        googleType: request.googleType,
        status,
        httpStatus: response.status,
        count: rawResults.length,
      };
    },
  );

  const hadAnySuccess = outcomes.some(
    (outcome) => outcome.status === "OK" || outcome.status === "ZERO_RESULTS",
  );

  return {
    candidates: [...merged.values(), ...unkeyed],
    perRequest: outcomes,
    hadAnySuccess,
  };
}

export { buildGoogleNearbyProviderRequests };
