// Canonical Imports Service Center door contract (Stage 5A). Lets any
// domain workspace (Attendees, Agenda, Vendors) hand the shared
// `/admin/imports` workspace a specific import type to open, through a
// durable, inspectable URL search parameter -- never localStorage, and
// never an implicit authority grant. The destination still resolves its
// own authority independently; this contract only selects which door
// opens.
//
// Pattern: Domain Workspace -> Contextual Action -> Shared Service Center.
// "Multiple doors, one governed workflow" -- see
// docs/architecture/EPICENTRAX_GOVERNED_IMPORT_STAGING_ARCHITECTURE.md.

export const IMPORT_TYPES = ["attendee-roster", "agenda", "vendors"] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export const IMPORT_TYPE_PARAM = "type";

export function isImportType(value: string | null | undefined): value is ImportType {
  return !!value && (IMPORT_TYPES as readonly string[]).includes(value);
}

/**
 * Builds an href to the shared Imports Service Center carrying the
 * canonical `type` parameter. Reusable by any domain workspace's
 * contextual "Import X" action -- one shared parameter name and shape,
 * not a per-destination scheme.
 */
export function buildImportsHref(type: ImportType): string {
  const params = new URLSearchParams();
  params.set(IMPORT_TYPE_PARAM, type);
  return `/admin/imports?${params.toString()}`;
}

/**
 * Reads the import type from a page's search params. Returns null for a
 * missing or unrecognized value -- callers fall back to the landing view
 * rather than guessing or throwing. This is a pure read of the URL; it
 * makes no authority claim. The destination's own governed workflow
 * (Stage 1's `event.imports.manage`, Stage 3's added
 * `event.attendees.manage`, Agenda's `event.agenda.manage`, etc.) is what
 * actually authorizes any action inside the selected door.
 */
export function readImportType(
  searchParams: { get(name: string): string | null } | null | undefined,
): ImportType | null {
  if (!searchParams) {
    return null;
  }

  const raw = searchParams.get(IMPORT_TYPE_PARAM);
  return isImportType(raw) ? raw : null;
}
