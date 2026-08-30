/**
 * EpicentraX category code -> Google Places (legacy Nearby Search) request
 * mapping.
 *
 * The visible category catalog is ALWAYS `public.place_categories` (fetched
 * live by the admin UI). This module never defines that catalog. It only
 * answers a narrower question: given one category code, how should the
 * legacy Google Places `nearbysearch` request be shaped?
 *
 * Two shapes exist, and the distinction is deliberately honest:
 *
 *  - `type`   -- a clean, first-class Google Places type exists for this
 *               category (`exact: true`). The request uses `type=` and,
 *               where it sharpens results without contradicting the type,
 *               an additional `keyword=`.
 *  - `keyword`-- no clean Google type exists (`exact: false`). The request
 *               falls back to a `keyword=` text match only. Results are
 *               best-effort, never authoritative.
 *
 * A category code with no explicit entry here is not an error: it falls
 * back to `{ keyword: <label>, exact: false }` so newly-seeded or
 * free-text-backfilled `place_categories` rows still produce a usable
 * (if imprecise) search.
 */

export type GooglePlaceTypeMapping = {
  /** Legacy Google Places type, when a clean one exists. */
  googleType: string | null;
  /** Free-text keyword sent alongside (or instead of) the type. */
  keyword: string | null;
  /**
   * True only when `googleType` is a faithful match for the category.
   * False for keyword-only fallbacks and for approximate type matches --
   * callers surface this so the admin knows the mapping is not exact.
   */
  exact: boolean;
};

/**
 * Explicit mappings for the seeded `place_categories` codes
 * (`20260811120000_create_nearby_knowledge_tenant_curation_foundation.sql`).
 * Keyed by category `code`. Approximate type matches carry `exact: false`.
 */
const EXPLICIT_MAPPINGS: Record<string, GooglePlaceTypeMapping> = {
  restaurant: { googleType: "restaurant", keyword: null, exact: true },
  grocery: { googleType: "supermarket", keyword: "grocery", exact: true },
  pharmacy: { googleType: "pharmacy", keyword: null, exact: true },
  hospital: { googleType: "hospital", keyword: "urgent care", exact: true },
  fuel: { googleType: "gas_station", keyword: null, exact: true },
  attraction: { googleType: "tourist_attraction", keyword: null, exact: true },
  // Google has no single "retail" type; shopping_mall is the closest
  // first-class type but misses stand-alone stores, so it is not exact.
  shopping: { googleType: "shopping_mall", keyword: "shopping", exact: false },
  rv_repair: { googleType: null, keyword: "RV repair service", exact: false },
  chassis_service: {
    googleType: null,
    keyword: "chassis service truck repair",
    exact: false,
  },
  propane: { googleType: null, keyword: "propane", exact: false },
  florist: { googleType: "florist", keyword: null, exact: true },
  lodging: { googleType: "lodging", keyword: null, exact: true },
  airport: { googleType: "airport", keyword: null, exact: true },
};

function fallbackKeyword(label: string, code: string): string {
  const trimmed = label.trim();
  if (trimmed) {
    return trimmed;
  }
  // Last resort: turn "urgent_care" into "urgent care".
  return code.trim().replace(/_/g, " ");
}

/**
 * Resolve one category to its Google request mapping. Unknown codes fall
 * back to a keyword built from the category label.
 */
export function resolveGooglePlaceTypeMapping(category: {
  code: string;
  label?: string | null;
}): GooglePlaceTypeMapping {
  const code = category.code?.trim() ?? "";
  const explicit = EXPLICIT_MAPPINGS[code];
  if (explicit) {
    return explicit;
  }

  return {
    googleType: null,
    keyword: fallbackKeyword(category.label ?? "", code),
    exact: false,
  };
}

export type GoogleNearbyProviderRequest = {
  /** The originating EpicentraX category code (provenance for merge). */
  categoryCode: string;
  googleType: string | null;
  keyword: string | null;
  exact: boolean;
};

/**
 * Build the de-duplicated set of provider requests for a search. Each
 * distinct category code yields exactly one request. An optional free-text
 * term yields one additional keyword-only request (categoryCode `""`).
 *
 * Requests with neither a type nor a keyword are dropped -- there is
 * nothing to ask Google.
 */
export function buildGoogleNearbyProviderRequests(
  categories: ReadonlyArray<{ code: string; label?: string | null }>,
  freeText?: string | null,
): GoogleNearbyProviderRequest[] {
  const requests: GoogleNearbyProviderRequest[] = [];
  const seenCodes = new Set<string>();

  for (const category of categories) {
    const code = category.code?.trim() ?? "";
    if (!code || seenCodes.has(code)) {
      continue;
    }
    seenCodes.add(code);

    const mapping = resolveGooglePlaceTypeMapping(category);
    if (!mapping.googleType && !mapping.keyword) {
      continue;
    }

    requests.push({
      categoryCode: code,
      googleType: mapping.googleType,
      keyword: mapping.keyword,
      exact: mapping.exact,
    });
  }

  const trimmedFreeText = freeText?.trim();
  if (trimmedFreeText) {
    requests.push({
      categoryCode: "",
      googleType: null,
      keyword: trimmedFreeText,
      exact: false,
    });
  }

  return requests;
}
