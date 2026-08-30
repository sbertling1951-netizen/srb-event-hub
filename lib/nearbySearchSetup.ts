/**
 * Pure helpers for the "Google Maps Search Setup" panel on
 * app/admin/nearby/page.tsx.
 *
 * `selectedSearchCategoryCodes` (a Set of live `place_categories` codes)
 * stays the single source of truth for what Google discovery searches for.
 * These helpers only derive display / bulk-toggle state from it -- they
 * never introduce a second category vocabulary or a hard-coded marker list.
 */

export type SearchCategoryOption = { code: string };

/**
 * True when every currently-available place type is selected. Used to drive
 * a single "Select all / Deselect all" control. An empty catalog is not
 * "all selected".
 */
export function allSearchCategoriesSelected(
  options: readonly SearchCategoryOption[],
  selected: ReadonlySet<string>,
): boolean {
  if (options.length === 0) {
    return false;
  }
  return options.every((option) => selected.has(option.code));
}

/** Every available place-type code -- the target of "Select all". */
export function allSearchCategoryCodes(
  options: readonly SearchCategoryOption[],
): string[] {
  return options.map((option) => option.code);
}

/**
 * Human summary of the active search configuration, e.g.
 *   "Searching 6 marker types within 10 miles"
 *   "Searching 2 marker types plus “urgent care” within 8 miles"
 *   "Searching for “kayak rental” within 10 miles"
 *   "No place types selected — choose at least one, or enter a search term"
 */
export function describeActiveSearch(input: {
  selectedTypeCount: number;
  radiusMiles: number;
  freeText: string;
}): string {
  const freeText = input.freeText.trim();
  const radius = Number.isFinite(input.radiusMiles) && input.radiusMiles > 0
    ? input.radiusMiles
    : 10;
  const within = `within ${radius} mile${radius === 1 ? "" : "s"}`;

  if (input.selectedTypeCount === 0 && !freeText) {
    return "No place types selected — choose at least one, or enter a search term";
  }

  const typePhrase =
    input.selectedTypeCount > 0
      ? `${input.selectedTypeCount} marker type${input.selectedTypeCount === 1 ? "" : "s"}`
      : "";

  if (typePhrase && freeText) {
    return `Searching ${typePhrase} plus “${freeText}” ${within}`;
  }
  if (typePhrase) {
    return `Searching ${typePhrase} ${within}`;
  }
  return `Searching for “${freeText}” ${within}`;
}
