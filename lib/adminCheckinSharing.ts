export type SharingBulkAction<T extends string> = {
  label: "Select all" | "Deselect all";
  sharedFields: T[];
};

export function getSharingBulkAction<T extends string>(
  allFields: readonly T[],
  sharedFields: readonly T[],
): SharingBulkAction<T> {
  const allSelected = allFields.every((field) => sharedFields.includes(field));

  return allSelected
    ? { label: "Deselect all", sharedFields: [] }
    : { label: "Select all", sharedFields: [...allFields] };
}