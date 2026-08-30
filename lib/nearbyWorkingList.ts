/**
 * The Nearby curated-list builder "Working List" -- a pure, client-side
 * state model that sits between transient Google Search Candidates and the
 * final additive save into an Event's Nearby list.
 *
 * Design rules (from the builder spec):
 *  - Search results are candidates only. Nothing enters the Working List
 *    without an explicit `addCandidatesToWorkingList` / `addManualEntry`.
 *  - The Working List survives subsequent searches -- it is never derived
 *    from current candidate state.
 *  - Exact Google Place ID is the ONLY provider identity. The same
 *    `googlePlaceId` never appears twice. No fuzzy auto-merge.
 *  - Manual entries are first class, share the list, and never receive a
 *    fabricated Google Place ID.
 *  - No database model. This is in-memory only for this phase.
 */

export type WorkingListEntrySource = "google" | "manual";

export type WorkingListDetailsStatus = "none" | "fetched" | "failed";

export type WorkingListEntry = {
  /** Stable within a session. `google:<placeId>` or `manual:<key>`. */
  key: string;
  source: WorkingListEntrySource;
  /** Present only for Google entries. Never fabricated for manual ones. */
  googlePlaceId: string | null;
  name: string;
  /** EpicentraX category code (from `place_categories`), best-effort. */
  categoryCode: string;
  /** EpicentraX `place_categories.id`, filled in by the editor. */
  categoryId: string;
  address: string;
  phone: string;
  website: string;
  notes: string;
  /** Plus code / location code, when known. */
  locationCode: string;
  lat: number | null;
  lng: number | null;
  /** Lazy provider-details enrichment state for Google entries. */
  detailsStatus: WorkingListDetailsStatus;
  /** Google types Google returned (provenance; not shown as-is). */
  googleTypes: string[];
  /** EpicentraX category codes whose search produced this candidate. */
  producingCategoryCodes: string[];
  /** True when the source mapping was an exact Google type match. */
  mappingExact: boolean;
  /**
   * Set once this entry has been persisted as an Event-only place (or
   * matched to an existing Event place by the D1 duplicate check) so a
   * retry after partial failure never double-inserts it. Holds an
   * `event_nearby_places.id`.
   */
  savedEventPlaceId: string | null;
  /**
   * Result of the governed `reuse_nearby_places_by_google_place_id_for_event`
   * call at final save. `reused` / `already_associated` mean the canonical
   * place is associated with the Event (retry-safe, no Event-only insert);
   * `not_reusable` means the entry falls through to the Event-only path.
   * The browser never learns the canonical `nearby_master.id`.
   */
  reuseOutcome: "reused" | "already_associated" | "not_reusable" | null;
};

/** The shape `addCandidatesToWorkingList` accepts (a search candidate). */
export type WorkingListCandidateInput = {
  id: string | null;
  name: string | null;
  address?: string | null;
  category?: string | null;
  categoryCode?: string | null;
  /** Resolved `place_categories.id` for the producing category, if known. */
  categoryId?: string | null;
  lat?: number | null;
  lng?: number | null;
  googleTypes?: string[];
  producingCategoryCodes?: string[];
  mappingExact?: boolean;
};

/** The fields a manual add / editor round-trip supplies. */
export type WorkingListManualInput = {
  name: string;
  categoryCode?: string;
  categoryId?: string;
  address?: string;
  phone?: string;
  website?: string;
  notes?: string;
  locationCode?: string;
  lat?: number | null;
  lng?: number | null;
};

export type WorkingListState = {
  entries: WorkingListEntry[];
};

export const EMPTY_WORKING_LIST: WorkingListState = { entries: [] };

export function googleEntryKey(googlePlaceId: string): string {
  return `google:${googlePlaceId}`;
}

export function manualEntryKey(seed: string): string {
  return `manual:${seed}`;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Exact-ID membership check -- the ONLY identity comparison for Google. */
export function workingListHasGooglePlaceId(
  state: WorkingListState,
  googlePlaceId: string | null | undefined,
): boolean {
  const id = googlePlaceId?.trim();
  if (!id) {
    return false;
  }
  return state.entries.some((entry) => entry.googlePlaceId === id);
}

function candidateToEntry(
  candidate: WorkingListCandidateInput,
): WorkingListEntry {
  const placeId = candidate.id?.trim() || null;
  const producing = candidate.producingCategoryCodes?.filter(Boolean) ?? [];

  return {
    key: placeId ? googleEntryKey(placeId) : manualEntryKey(cryptoRandom()),
    source: placeId ? "google" : "manual",
    googlePlaceId: placeId,
    name: candidate.name?.trim() || "",
    categoryCode: (candidate.categoryCode || producing[0] || "").trim(),
    categoryId: (candidate.categoryId ?? "").trim(),
    address: candidate.address?.trim() || "",
    phone: "",
    website: "",
    notes: "",
    locationCode: "",
    lat: typeof candidate.lat === "number" ? candidate.lat : null,
    lng: typeof candidate.lng === "number" ? candidate.lng : null,
    detailsStatus: "none",
    googleTypes: candidate.googleTypes ? [...candidate.googleTypes] : [],
    producingCategoryCodes: producing,
    mappingExact: candidate.mappingExact ?? false,
    savedEventPlaceId: null,
    reuseOutcome: null,
  };
}

// Isolated so a non-crypto environment (older test runners) still works.
function cryptoRandom(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export type AddCandidatesResult = {
  state: WorkingListState;
  added: number;
  skippedExistingGoogleIds: number;
  skippedNoPlaceId: number;
};

/**
 * Add explicitly-selected candidates. Candidates whose exact Google Place
 * ID is already in the list are skipped (not re-added, not merged).
 * Candidates with no place_id are NOT added here -- a place without a
 * provider identity must go through the manual path so it is never given a
 * fabricated identity or silently duplicated.
 */
export function addCandidatesToWorkingList(
  state: WorkingListState,
  candidates: ReadonlyArray<WorkingListCandidateInput>,
): AddCandidatesResult {
  const entries = [...state.entries];
  const seenThisCall = new Set<string>();
  let added = 0;
  let skippedExistingGoogleIds = 0;
  let skippedNoPlaceId = 0;

  for (const candidate of candidates) {
    const placeId = candidate.id?.trim() || "";

    if (!placeId) {
      skippedNoPlaceId += 1;
      continue;
    }

    if (
      seenThisCall.has(placeId) ||
      entries.some((entry) => entry.googlePlaceId === placeId)
    ) {
      skippedExistingGoogleIds += 1;
      continue;
    }

    seenThisCall.add(placeId);
    entries.push(candidateToEntry(candidate));
    added += 1;
  }

  return {
    state: { entries },
    added,
    skippedExistingGoogleIds,
    skippedNoPlaceId,
  };
}

/** Add a manual (non-provider) place. Never assigns a Google Place ID. */
export function addManualWorkingListEntry(
  state: WorkingListState,
  input: WorkingListManualInput,
  seed: string = cryptoRandom(),
): { state: WorkingListState; entry: WorkingListEntry } {
  const entry: WorkingListEntry = {
    key: manualEntryKey(seed),
    source: "manual",
    googlePlaceId: null,
    name: input.name.trim(),
    categoryCode: (input.categoryCode ?? "").trim(),
    categoryId: (input.categoryId ?? "").trim(),
    address: (input.address ?? "").trim(),
    phone: (input.phone ?? "").trim(),
    website: (input.website ?? "").trim(),
    notes: (input.notes ?? "").trim(),
    locationCode: (input.locationCode ?? "").trim(),
    lat: typeof input.lat === "number" ? input.lat : null,
    lng: typeof input.lng === "number" ? input.lng : null,
    detailsStatus: "none",
    googleTypes: [],
    producingCategoryCodes: [],
    mappingExact: false,
    savedEventPlaceId: null,
    reuseOutcome: null,
  };

  return { state: { entries: [...state.entries, entry] }, entry };
}

export function removeWorkingListEntry(
  state: WorkingListState,
  key: string,
): WorkingListState {
  return { entries: state.entries.filter((entry) => entry.key !== key) };
}

/**
 * Patch one entry's editable fields. Identity (`key`, `source`,
 * `googlePlaceId`) and settled state (`reuseOutcome`, `savedEventPlaceId`)
 * are stripped from the patch at runtime, not merely disallowed by the
 * type -- a Google entry keeps its provider identity, and a settled entry
 * stays settled, through every edit (including details enrichment).
 */
const NON_PATCHABLE_ENTRY_KEYS = [
  "key",
  "source",
  "googlePlaceId",
  "reuseOutcome",
  "savedEventPlaceId",
] as const;

export function updateWorkingListEntry(
  state: WorkingListState,
  key: string,
  patch: Partial<
    Omit<WorkingListEntry, (typeof NON_PATCHABLE_ENTRY_KEYS)[number]>
  >,
): WorkingListState {
  const safePatch: Record<string, unknown> = { ...patch };
  for (const forbidden of NON_PATCHABLE_ENTRY_KEYS) {
    delete safePatch[forbidden];
  }
  return {
    entries: state.entries.map((entry) =>
      entry.key === key ? { ...entry, ...safePatch } : entry,
    ),
  };
}

export type PlaceDetailsPatch = {
  phone?: string | null;
  website?: string | null;
  locationCode?: string | null;
  notes?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  googleTypes?: string[];
};

/**
 * Apply lazily-fetched provider details to a Google entry. On `failed`,
 * the entry is left fully intact (search-derived name/address/category/
 * coords preserved) and only `detailsStatus` changes -- the admin can
 * still complete it by hand.
 */
export function applyPlaceDetails(
  state: WorkingListState,
  key: string,
  status: "fetched" | "failed",
  patch?: PlaceDetailsPatch,
): WorkingListState {
  return {
    entries: state.entries.map((entry) => {
      if (entry.key !== key) {
        return entry;
      }
      if (status === "failed" || !patch) {
        return { ...entry, detailsStatus: status };
      }
      return {
        ...entry,
        detailsStatus: "fetched",
        // Only fill blanks / add value; never clobber an admin edit.
        phone: entry.phone || (patch.phone ?? "").trim(),
        website: entry.website || (patch.website ?? "").trim(),
        locationCode: entry.locationCode || (patch.locationCode ?? "").trim(),
        notes: entry.notes || (patch.notes ?? "").trim(),
        address: entry.address || (patch.address ?? "").trim(),
        lat: entry.lat ?? (typeof patch.lat === "number" ? patch.lat : null),
        lng: entry.lng ?? (typeof patch.lng === "number" ? patch.lng : null),
        googleTypes:
          entry.googleTypes.length > 0
            ? entry.googleTypes
            : patch.googleTypes ?? [],
      };
    }),
  };
}

/**
 * Mark entries as successfully persisted. Saved entries stay in the list
 * (so the admin sees what happened) but carry `savedEventPlaceId`, which
 * `entriesPendingSave` excludes -- a retry never re-inserts them.
 */
export function markWorkingListEntriesSaved(
  state: WorkingListState,
  saved: ReadonlyArray<{ key: string; eventPlaceId: string }>,
): WorkingListState {
  const byKey = new Map(saved.map((s) => [s.key, s.eventPlaceId]));
  return {
    entries: state.entries.map((entry) =>
      byKey.has(entry.key)
        ? { ...entry, savedEventPlaceId: byKey.get(entry.key) ?? null }
        : entry,
    ),
  };
}

/**
 * Record the governed reuse outcome per entry after
 * `reuse_nearby_places_by_google_place_id_for_event`. `reused` /
 * `already_associated` settle the entry (the canonical place is
 * associated with the Event); `not_reusable` does not settle it -- it
 * still needs the Event-only save path.
 */
export function markWorkingListEntriesReuseOutcome(
  state: WorkingListState,
  outcomes: ReadonlyArray<{
    key: string;
    outcome: "reused" | "already_associated" | "not_reusable";
  }>,
): WorkingListState {
  const byKey = new Map(outcomes.map((o) => [o.key, o.outcome]));
  return {
    entries: state.entries.map((entry) =>
      byKey.has(entry.key)
        ? { ...entry, reuseOutcome: byKey.get(entry.key) ?? null }
        : entry,
    ),
  };
}

/** An entry is settled once it is Event-associated (Event-only insert, D1
 * skip-match, or a canonical reuse) -- retrying must never touch it. */
export function isWorkingListEntrySettled(entry: WorkingListEntry): boolean {
  return (
    entry.savedEventPlaceId !== null ||
    entry.reuseOutcome === "reused" ||
    entry.reuseOutcome === "already_associated"
  );
}

/** Drop settled entries -- the explicit "clear saved" post-save action. */
export function clearSavedWorkingListEntries(
  state: WorkingListState,
): WorkingListState {
  return {
    entries: state.entries.filter((entry) => !isWorkingListEntrySettled(entry)),
  };
}

/** Entries still needing a save attempt (never settled). */
export function entriesPendingSave(state: WorkingListState): WorkingListEntry[] {
  return state.entries.filter((entry) => !isWorkingListEntrySettled(entry));
}

export type WorkingListDuplicateMatch = {
  entry: WorkingListEntry;
  reason: "name+address" | "name";
};

/**
 * Client-side, normalized, non-fuzzy duplicate check against the current
 * Working List only. Same normalized name AND address is a strong match;
 * same normalized name alone is a weak match. Never auto-merges -- the
 * caller shows "Add anyway / Cancel".
 */
export function findWorkingListDuplicates(
  state: WorkingListState,
  candidate: { name: string; address?: string | null },
): WorkingListDuplicateMatch[] {
  const name = normalizeText(candidate.name);
  if (!name) {
    return [];
  }
  const address = normalizeText(candidate.address);
  const matches: WorkingListDuplicateMatch[] = [];

  for (const entry of state.entries) {
    if (normalizeText(entry.name) !== name) {
      continue;
    }
    if (address && normalizeText(entry.address) === address) {
      matches.push({ entry, reason: "name+address" });
    } else {
      matches.push({ entry, reason: "name" });
    }
  }

  return matches;
}

/**
 * D1: conservative, non-fuzzy check of one Working List entry against the
 * Event's already-loaded Nearby list. Returns the matching
 * `event_nearby_places.id` ONLY when confident the entry is the same
 * place, which means one of:
 *   - normalized name matches AND both sides have a normalized address AND
 *     those addresses are equal; or
 *   - normalized name matches AND *neither* side has a usable address.
 * A one-sided blank address is NOT confident -- the entry is inserted,
 * not skipped, because a false skip silently drops a place the admin
 * wanted and mis-reports it as already present. Never merges.
 */
export function findExistingEventPlaceMatch(
  entry: { name: string; address: string },
  eventPlaces: ReadonlyArray<{
    id: string;
    name: string | null;
    address: string | null;
  }>,
): string | null {
  const name = normalizeText(entry.name);
  if (!name) {
    return null;
  }
  const entryAddress = normalizeText(entry.address);

  for (const place of eventPlaces) {
    if (normalizeText(place.name) !== name) {
      continue;
    }
    const placeAddress = normalizeText(place.address);

    if (entryAddress && placeAddress) {
      if (entryAddress === placeAddress) {
        return place.id;
      }
      continue;
    }

    if (!entryAddress && !placeAddress) {
      // Name matches and there is no address on either side to disagree on.
      return place.id;
    }

    // Exactly one side has an address -> not confident enough to skip.
  }

  return null;
}

/**
 * D7: decide what a change in observed Admin Working Event means for the
 * Working List, given the last *confirmed real* Event id.
 *
 *  - `hold`  -- do nothing. A transient/absent context
 *               (`currentEventId` null/undefined) is NOT an Event switch;
 *               nor is the same Event re-confirmed.
 *  - `stamp` -- record `eventId` as the confirmed Event (first real Event
 *               observed, or first sight after establishment). NEVER
 *               clears the Working List.
 *  - `clear` -- a confirmed real change: the previous confirmed id and
 *               the current id are both real, non-null, and different
 *               (Event A -> Event B, including A -> null -> B). The
 *               caller clears the Working List and records `eventId`.
 *
 * Explicit user "Clear" is a separate action and does not go through here.
 */
export type WorkingListEventTransition =
  | { action: "hold" }
  | { action: "stamp"; eventId: string }
  | { action: "clear"; eventId: string };

export function resolveWorkingListEventTransition(
  previousConfirmedEventId: string | null,
  currentEventId: string | null | undefined,
): WorkingListEventTransition {
  if (!currentEventId) {
    return { action: "hold" };
  }
  if (previousConfirmedEventId && previousConfirmedEventId !== currentEventId) {
    return { action: "clear", eventId: currentEventId };
  }
  if (previousConfirmedEventId !== currentEventId) {
    return { action: "stamp", eventId: currentEventId };
  }
  return { action: "hold" };
}
