/**
 * Pure presentation logic for the Reusable Area List "Add eligible Stored
 * Place" picker (components/nearby/NearbyAreaListManager.tsx).
 *
 * The governed read (`list_nearby_master_places_for_area_list`,
 * 20260914000000) returns every canonical place the admin is authorized to
 * add to the selected Area List, now carrying the place's own geographic
 * Area identity (`area_id` / `area_name`, from `nearby_master.area_id` ->
 * `nearby_areas`). This module only ORGANIZES that authorized set for
 * display:
 *
 *   Area  ->  marker / place type  ->  place name
 *
 * with an "Unassigned" Area group for places whose `area_id` is NULL and an
 * "Uncategorized" type group for places with no `category_id`. It never
 * filters on authority or scope (the RPC already did), never writes
 * anything, and never invents identity. Marker/place types are the live
 * `place_categories` vocabulary, carried on each candidate as
 * `category_id` / `category_label`.
 */

export type AreaListCandidate = {
  nearby_master_id: string;
  name: string;
  category_id: string | null;
  category_label: string | null;
  scope: "shared_public" | "tenant_specific";
  tenant_id: string | null;
  area_id: string | null;
  area_name: string | null;
};

/** Stable synthetic key for the "no geographic Area" group. */
export const UNASSIGNED_AREA_KEY = "__unassigned_area__";
export const UNASSIGNED_AREA_LABEL = "Unassigned";

/** Stable synthetic key for the "no marker type" group / filter option. */
export const UNCATEGORIZED_KEY = "__uncategorized__";
export const UNCATEGORIZED_LABEL = "Uncategorized";

export type AreaListPickerFilter = {
  /** Case-insensitive substring match against the place name. */
  nameQuery: string;
  /**
   * Selected marker-type keys. A `category_id` string matches that type;
   * `UNCATEGORIZED_KEY` matches places with `category_id === null`. An
   * empty set means "no type filter" (show all).
   */
  categoryKeys: ReadonlySet<string>;
  /** Membership already active in this list -- always excluded. */
  activeMemberIds: ReadonlySet<string>;
};

export function candidateCategoryKey(candidate: AreaListCandidate): string {
  return candidate.category_id ?? UNCATEGORIZED_KEY;
}

export function candidateAreaKey(candidate: AreaListCandidate): string {
  return candidate.area_id ?? UNASSIGNED_AREA_KEY;
}

/**
 * The distinct marker/place types present in the candidate set, ordered by
 * label with "Uncategorized" last. Drives the type-filter control.
 */
export function areaListCandidateTypeOptions(
  candidates: readonly AreaListCandidate[],
): Array<{ key: string; label: string }> {
  const seen = new Map<string, string>();
  let hasUncategorized = false;
  for (const candidate of candidates) {
    if (candidate.category_id) {
      seen.set(candidate.category_id, candidate.category_label || "Unnamed type");
    } else {
      hasUncategorized = true;
    }
  }
  const options = [...seen.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (hasUncategorized) {
    options.push({ key: UNCATEGORIZED_KEY, label: UNCATEGORIZED_LABEL });
  }
  return options;
}

/**
 * Apply the membership exclusion, name query, and marker-type filter. Order
 * is not established here -- see groupAreaListCandidates.
 */
export function filterAreaListCandidates(
  candidates: readonly AreaListCandidate[],
  filter: AreaListPickerFilter,
): AreaListCandidate[] {
  const needle = filter.nameQuery.trim().toLowerCase();
  const typeFilterActive = filter.categoryKeys.size > 0;

  return candidates.filter((candidate) => {
    if (filter.activeMemberIds.has(candidate.nearby_master_id)) {
      return false;
    }
    if (needle && !candidate.name.toLowerCase().includes(needle)) {
      return false;
    }
    if (typeFilterActive && !filter.categoryKeys.has(candidateCategoryKey(candidate))) {
      return false;
    }
    return true;
  });
}

export type AreaListTypeGroup = {
  key: string;
  label: string;
  places: AreaListCandidate[];
};

export type AreaListAreaGroup = {
  key: string;
  /** Human Area name; `UNASSIGNED_AREA_LABEL` for the NULL-area group. */
  label: string;
  isUnassigned: boolean;
  typeGroups: AreaListTypeGroup[];
  /** Flat list of every place under this Area, in display order. */
  places: AreaListCandidate[];
};

/**
 * Group an already-filtered candidate set into Area -> type -> place.
 *
 * - Areas sort by name; the Unassigned group is always last.
 * - Types sort by label; the Uncategorized group is always last.
 * - Places sort by name.
 */
export function groupAreaListCandidates(
  candidates: readonly AreaListCandidate[],
): AreaListAreaGroup[] {
  const byArea = new Map<
    string,
    { label: string; isUnassigned: boolean; byType: Map<string, AreaListTypeGroup> }
  >();

  for (const candidate of candidates) {
    const areaKey = candidateAreaKey(candidate);
    const isUnassigned = candidate.area_id === null;
    let area = byArea.get(areaKey);
    if (!area) {
      area = {
        label: isUnassigned ? UNASSIGNED_AREA_LABEL : candidate.area_name || "Unnamed Area",
        isUnassigned,
        byType: new Map(),
      };
      byArea.set(areaKey, area);
    }

    const typeKey = candidateCategoryKey(candidate);
    let typeGroup = area.byType.get(typeKey);
    if (!typeGroup) {
      typeGroup = {
        key: typeKey,
        label:
          candidate.category_id === null
            ? UNCATEGORIZED_LABEL
            : candidate.category_label || "Unnamed type",
        places: [],
      };
      area.byType.set(typeKey, typeGroup);
    }
    typeGroup.places.push(candidate);
  }

  const areaGroups: AreaListAreaGroup[] = [...byArea.entries()].map(([key, area]) => {
    const typeGroups = [...area.byType.values()]
      .map((group) => ({
        ...group,
        places: [...group.places].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => {
        if (a.key === UNCATEGORIZED_KEY) {
          return 1;
        }
        if (b.key === UNCATEGORIZED_KEY) {
          return -1;
        }
        return a.label.localeCompare(b.label);
      });

    return {
      key,
      label: area.label,
      isUnassigned: area.isUnassigned,
      typeGroups,
      places: typeGroups.flatMap((group) => group.places),
    };
  });

  return areaGroups.sort((a, b) => {
    if (a.isUnassigned) {
      return 1;
    }
    if (b.isUnassigned) {
      return -1;
    }
    return a.label.localeCompare(b.label);
  });
}

/**
 * The ids that a "Select all" acting on the current filtered result set
 * should select. Kept separate so the component never has to re-derive it.
 */
export function selectableAreaListCandidateIds(
  filtered: readonly AreaListCandidate[],
): string[] {
  return filtered.map((candidate) => candidate.nearby_master_id);
}

/**
 * Retain only ids still present in the filtered set -- used to prune a
 * selection when filters change so a hidden row can never be batch-added.
 */
export function pruneSelectionToFiltered(
  selected: ReadonlySet<string>,
  filtered: readonly AreaListCandidate[],
): Set<string> {
  const visible = new Set(selectableAreaListCandidateIds(filtered));
  return new Set([...selected].filter((id) => visible.has(id)));
}
