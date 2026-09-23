// Shared, case- and spacing-insensitive comparison rules for Agenda item
// locations. `agenda_items.location` is the sole source of truth: there is no
// separate location registry, table, or persistence store. Every helper here
// only compares and groups strings that already exist on Agenda items or
// staged import rows -- the admin location picker, the member Agenda columns,
// and the import review advisories all consume the SAME rules so the three
// surfaces cannot disagree about what counts as "the same location".

/** Heading shown for an item whose location is blank. */
export const UNSPECIFIED_LOCATION_LABEL = "Location not specified.";

/**
 * Comparison key: trim, collapse internal whitespace to a single space, and
 * case-fold. Two spellings that differ only by capitalization or spacing share
 * one key, so they must never produce two columns or two picker options. A
 * blank (or whitespace-only) value yields the empty key.
 */
export function locationComparisonKey(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Display normalization: trim and collapse internal whitespace but preserve
 * the operator's capitalization. This is the spelling actually shown and
 * stored; it is never case-folded, because the location text is human-facing.
 */
export function normalizeLocationDisplay(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export type AgendaLocationOption = {
  /** The `locationComparisonKey` these spellings share. */
  key: string;
  /** The first-seen display spelling for this key (what the operator picks). */
  label: string;
};

/**
 * Distinct existing locations from any collection of raw strings (typically
 * the current Event's `agenda_items.location` values, plus the other rows of
 * an in-progress import). The first display spelling seen for a given key
 * wins, so capitalization/spacing variants collapse onto one reusable option;
 * blank values contribute no option. Sorted case-insensitively by label for a
 * stable, readable picker order.
 */
export function collectAgendaLocations(
  values: Iterable<string | null | undefined>,
): AgendaLocationOption[] {
  const byKey = new Map<string, string>();
  for (const raw of values) {
    const display = normalizeLocationDisplay(raw);
    if (!display) {
      continue;
    }
    const key = locationComparisonKey(display);
    if (!byKey.has(key)) {
      byKey.set(key, display);
    }
  }
  return Array.from(byKey, ([key, label]) => ({ key, label })).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

/**
 * The existing option whose comparison key equals the input's, if any. Used to
 * reuse an existing spelling rather than create a capitalization/spacing
 * duplicate: if the operator types "main building" and "Main Building" already
 * exists, the caller adopts the existing "Main Building".
 */
export function findMatchingLocation(
  value: string | null | undefined,
  options: readonly AgendaLocationOption[],
): AgendaLocationOption | null {
  const key = locationComparisonKey(value);
  if (!key) {
    return null;
  }
  return options.find((option) => option.key === key) ?? null;
}

/** Levenshtein edit distance between two short strings. */
export function locationEditDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1, // insertion
        previous[j] + 1, // deletion
        previous[j - 1] + cost, // substitution
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/**
 * How close two comparison keys must be to be treated as a possible typo of
 * one another. Scales with length so short names need a near-exact match while
 * longer names tolerate a transposition (which Levenshtein scores as 2).
 */
function similarityThreshold(maxKeyLength: number): number {
  if (maxKeyLength <= 4) {
    return 1;
  }
  if (maxKeyLength <= 7) {
    return 2;
  }
  return 3;
}

/**
 * Whether two location strings are close enough to be a likely typo of one
 * another WITHOUT being the same location. Exact-key matches return false
 * (they are the same location, handled by `findMatchingLocation`), and a name
 * that merely contains the other as a substring (e.g. "Room" vs "Room A") is
 * NOT a typo -- those are legitimately distinct and must never be merged.
 */
export function locationsAreSimilar(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const keyA = locationComparisonKey(a);
  const keyB = locationComparisonKey(b);
  if (!keyA || !keyB || keyA === keyB) {
    return false;
  }
  // A name that merely adds a separate word to the other -- "Room" vs "Room A",
  // "Pioneer" vs "Pioneer Room" -- is a genuinely distinct location, never a
  // typo to merge. A mistyped or missing character inside a shared token --
  // "Main Hal" vs "Main Hall" -- is NOT excluded here and is judged by edit
  // distance below.
  const [shorter, longer] =
    keyA.length <= keyB.length ? [keyA, keyB] : [keyB, keyA];
  if (longer.startsWith(`${shorter} `) || longer.endsWith(` ${shorter}`)) {
    return false;
  }
  if (Math.min(keyA.length, keyB.length) < 3) {
    return false;
  }
  const distance = locationEditDistance(keyA, keyB);
  return distance <= similarityThreshold(Math.max(keyA.length, keyB.length));
}

/**
 * Existing options that are a likely typo of `value` but not an exact-key
 * match -- offered as "did you mean" suggestions. The caller always keeps the
 * choice explicit: adopt a suggestion or deliberately retain the typed name.
 * Different names are never silently merged. Ordered nearest-first, capped.
 */
export function findSimilarLocations(
  value: string | null | undefined,
  options: readonly AgendaLocationOption[],
  limit = 3,
): AgendaLocationOption[] {
  const key = locationComparisonKey(value);
  if (!key) {
    return [];
  }
  return options
    .filter((option) => option.key !== key && locationsAreSimilar(key, option.key))
    .map((option) => ({
      option,
      distance: locationEditDistance(key, option.key),
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.option);
}

/**
 * A stable signature of a set of comparison options, used to bind a transient
 * "keep this spelling" acknowledgment to the exact comparison universe it was
 * made against: if the options change (a new location appears, or another
 * candidate's location changes), the signature changes and any prior
 * acknowledgment computed from it is no longer valid.
 */
export function locationOptionsSignature(
  options: readonly AgendaLocationOption[],
): string {
  return Array.from(new Set(options.map((option) => option.key)))
    .sort()
    .join("");
}

export type LocationSaveResolution =
  | { status: "ok"; value: string }
  | { status: "needs_choice"; typed: string; suggestions: AgendaLocationOption[] };

/**
 * Resolve a typed location into a deliberate, save-safe value -- the gate the
 * SAVE path (Admin editor and governed Edit Row correction) enforces, not just
 * the picker's keyboard handler:
 *
 * - blank is allowed (optional location);
 * - a case/whitespace variant of an existing location resolves to that
 *   existing spelling (consistent, no duplicate);
 * - a value unchanged from the item's/row's own current value is allowed
 *   (never forces fixing pre-existing data on an unrelated edit);
 * - a genuinely new name is allowed ONLY when the operator explicitly added it
 *   (its comparison key equals `acknowledgedNewKey`);
 * - otherwise the caller must obtain a deliberate choice first -- reuse an
 *   existing name or explicitly keep the new one -- and any likely typos are
 *   offered as `suggestions`. A likely typo is never silently fuzzy-merged.
 */
export function resolveLocationChoiceForSave(
  value: string | null | undefined,
  options: readonly AgendaLocationOption[],
  context: { originalValue?: string | null; acknowledgedNewKey?: string | null } = {},
): LocationSaveResolution {
  const display = normalizeLocationDisplay(value);
  if (display === "") {
    return { status: "ok", value: "" };
  }
  const match = findMatchingLocation(value, options);
  if (match) {
    return { status: "ok", value: match.label };
  }
  const key = locationComparisonKey(value);
  const originalKey = locationComparisonKey(context.originalValue);
  if (originalKey && key === originalKey) {
    return { status: "ok", value: normalizeLocationDisplay(context.originalValue) };
  }
  if (context.acknowledgedNewKey && context.acknowledgedNewKey === key) {
    return { status: "ok", value: display };
  }
  return {
    status: "needs_choice",
    typed: display,
    suggestions: findSimilarLocations(value, options),
  };
}

export type AgendaLocationGroup<T> = {
  /** The shared `locationComparisonKey` (empty string for blank locations). */
  key: string;
  /** Display heading: the first-seen spelling, or `UNSPECIFIED_LOCATION_LABEL`. */
  label: string;
  /** True when this group collects items with no location text. */
  isUnspecified: boolean;
  items: T[];
};

/**
 * Bucket items by location for the member Agenda's dynamic columns. Every item
 * lands in exactly one group (its actual location), capitalization/spacing
 * variants share one group under the first-seen spelling, and blank locations
 * collect under `UNSPECIFIED_LOCATION_LABEL`. Group order follows first
 * appearance in the supplied (already date/time-sorted) list, so column order
 * reads time-forward and stays stable.
 */
export function groupItemsByLocation<T>(
  items: readonly T[],
  getLocation: (item: T) => string | null | undefined,
): AgendaLocationGroup<T>[] {
  const order: string[] = [];
  const byKey = new Map<string, AgendaLocationGroup<T>>();
  for (const item of items) {
    const display = normalizeLocationDisplay(getLocation(item));
    const isUnspecified = display === "";
    const key = isUnspecified ? "" : locationComparisonKey(display);
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        label: isUnspecified ? UNSPECIFIED_LOCATION_LABEL : display,
        isUnspecified,
        items: [],
      };
      byKey.set(key, group);
      order.push(key);
    }
    group.items.push(item);
  }
  return order.map((key) => byKey.get(key) as AgendaLocationGroup<T>);
}
