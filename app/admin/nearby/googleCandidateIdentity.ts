/**
 * Exact Google Place-ID candidate handling for Nearby Admin.
 *
 * Google results remain discovery data. A candidate is suppressed only when
 * the governed server-side comparison has returned this exact provider ID;
 * names, addresses, and coordinates deliberately never participate.
 */
export type GooglePlaceCandidateIdentity = {
  id: string | null;
};

function exactGooglePlaceId(value: string | null): string | null {
  const placeId = value?.trim();
  return placeId ? placeId : null;
}

export function googlePlaceIdsFromCandidates(
  candidates: readonly GooglePlaceCandidateIdentity[],
): string[] {
  return [...new Set(candidates.map((candidate) => exactGooglePlaceId(candidate.id)).filter(
    (placeId): placeId is string => placeId !== null,
  ))];
}

export function pendingGooglePlaceCandidates<T extends GooglePlaceCandidateIdentity>(
  candidates: readonly T[],
  matchedGooglePlaceIds: ReadonlySet<string>,
): T[] {
  return candidates.filter((candidate) => {
    const placeId = exactGooglePlaceId(candidate.id);
    return placeId === null || !matchedGooglePlaceIds.has(placeId);
  });
}
