/**
 * Browser adapter for the P-3F organizer private-draft registry-plan RPC
 * surface.
 *
 * A registry plan entry is PLANNING DATA ONLY -- it records WHERE an organizer
 * intends to keep a registry. It is not a registry, not an account at a
 * provider, not an integration, not a published link, and not commerce.
 *
 * THE URL IS INERT TEXT. This module -- and every component built on it --
 * must never fetch, validate, preview, unfurl, crawl, health-check,
 * screenshot, link-preview, or otherwise contact the recorded URL, and must
 * never render it as a navigable link. Every outbound request would tell a
 * third party that an event exists, when it exists, and that someone is
 * looking at it. There is deliberately no URL-format validation here either:
 * format-checking is the first step toward dereferencing. The only
 * transformation ever applied is trimming.
 *
 * "selected" is a private note to self: it publishes nothing, activates
 * nothing, and changes no Event state.
 *
 * The database commands remain the authoritative authorization and validation
 * boundary (the self-service organizer-owner rule only -- never Event task
 * authority); this module only keeps route components from constructing RPC
 * argument objects ad hoc.
 */

type RpcResult = { data: unknown; error: { message: string } | null };

export type OrganizerRegistryPlanRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
};

/** The three private planning statuses the contract allows, and only these. */
export const REGISTRY_PLAN_STATUSES = ["considering", "contacted", "selected"] as const;
export type RegistryPlanStatus = (typeof REGISTRY_PLAN_STATUSES)[number];

export const REGISTRY_PLAN_STATUS_LABELS: Record<RegistryPlanStatus, string> = {
  considering: "Considering",
  contacted: "Contacted",
  selected: "Selected",
};

export function isRegistryPlanStatus(value: unknown): value is RegistryPlanStatus {
  return REGISTRY_PLAN_STATUSES.includes(value as RegistryPlanStatus);
}

export type RegistryPlanEntry = {
  id: string;
  providerName: string;
  /** Opaque, inert text. Never dereferenced, never rendered as a link. */
  registryUrl: string | null;
  planningStatus: RegistryPlanStatus;
  organizerNote: string | null;
};

/**
 * The registry-plan field values. `providerName` is required and `status` is
 * always one of the three; the URL and note are optional private notes.
 */
export type RegistryPlanInput = {
  providerName: string;
  registryUrl: string;
  status: RegistryPlanStatus;
  note: string;
};

export function emptyRegistryPlan(): RegistryPlanInput {
  return { providerName: "", registryUrl: "", status: "considering", note: "" };
}

export function registryPlanValues(entry: RegistryPlanEntry): RegistryPlanInput {
  return {
    providerName: entry.providerName ?? "",
    registryUrl: entry.registryUrl ?? "",
    status: isRegistryPlanStatus(entry.planningStatus) ? entry.planningStatus : "considering",
    note: entry.organizerNote ?? "",
  };
}

export function registryPlanError(input: RegistryPlanInput): string | null {
  if (!input.providerName.trim()) {
    return "Enter a name for this registry.";
  }
  if (input.providerName.trim().length > 200) {
    return "The name must be 200 characters or fewer.";
  }
  if (!isRegistryPlanStatus(input.status)) {
    return "Choose considering, contacted, or selected.";
  }
  // Length only. Deliberately NOT a URL format check -- the value is opaque
  // text the organizer wrote down, and may not be a URL at all.
  if (input.registryUrl.trim().length > 2000) {
    return "The link must be 2000 characters or fewer.";
  }
  if (input.note.trim().length > 2000) {
    return "The note must be 2000 characters or fewer.";
  }
  return null;
}

function coerceEntry(row: unknown): RegistryPlanEntry {
  const value = (row ?? {}) as Record<string, unknown>;
  const status = value.planning_status;
  return {
    id: String(value.id ?? ""),
    providerName: String(value.provider_name ?? ""),
    registryUrl: (value.registry_url as string | null) ?? null,
    planningStatus: isRegistryPlanStatus(status) ? status : "considering",
    organizerNote: (value.organizer_note as string | null) ?? null,
  };
}

function oneRow(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("EpicentraX did not return the expected registry-plan result.");
  }
  return row as Record<string, unknown>;
}

function planArgs(input: RegistryPlanInput) {
  return {
    p_provider_name: input.providerName.trim(),
    p_registry_url: input.registryUrl.trim() || null,
    p_planning_status: input.status,
    p_organizer_note: input.note.trim() || null,
  };
}

export async function listMyPrivateDraftRegistryPlans(
  client: OrganizerRegistryPlanRpcClient,
  eventId: string,
): Promise<RegistryPlanEntry[]> {
  if (!eventId) {
    throw new Error("Choose a draft to plan.");
  }
  const { data, error } = await client.rpc("list_my_private_draft_registry_plans", {
    p_event_id: eventId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return Array.isArray(data) ? data.map(coerceEntry) : [];
}

export async function addMyPrivateDraftRegistryPlan(
  client: OrganizerRegistryPlanRpcClient,
  input: { eventId: string; values: RegistryPlanInput },
): Promise<RegistryPlanEntry> {
  const validationError = registryPlanError(input.values);
  if (validationError) {
    throw new Error(validationError);
  }
  const { data, error } = await client.rpc("add_my_private_draft_registry_plan", {
    p_event_id: input.eventId,
    ...planArgs(input.values),
  });
  if (error) {
    throw new Error(error.message);
  }
  return coerceEntry(oneRow(data));
}

export async function updateMyPrivateDraftRegistryPlan(
  client: OrganizerRegistryPlanRpcClient,
  input: { eventId: string; registryPlanId: string; values: RegistryPlanInput },
): Promise<RegistryPlanEntry> {
  const validationError = registryPlanError(input.values);
  if (validationError) {
    throw new Error(validationError);
  }
  const { data, error } = await client.rpc("update_my_private_draft_registry_plan", {
    p_event_id: input.eventId,
    p_registry_plan_id: input.registryPlanId,
    ...planArgs(input.values),
  });
  if (error) {
    throw new Error(error.message);
  }
  return coerceEntry(oneRow(data));
}

export async function deleteMyPrivateDraftRegistryPlan(
  client: OrganizerRegistryPlanRpcClient,
  input: { eventId: string; registryPlanId: string },
): Promise<{ deletedId: string }> {
  const { data, error } = await client.rpc("delete_my_private_draft_registry_plan", {
    p_event_id: input.eventId,
    p_registry_plan_id: input.registryPlanId,
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = oneRow(data);
  return { deletedId: String(row.deleted_id ?? input.registryPlanId) };
}

/**
 * Catalog P2: an optional, owner-private search and attachment against the
 * Registry Provider Catalog (migration 20261009000000). Everything above
 * this point (list/add/update/delete, RegistryPlanEntry, coerceEntry) is
 * completely UNCHANGED by Catalog P2 and keeps working for every existing
 * caller, including an account that has not finished identity resolution
 * (the "no_link" case) -- catalog search, attach, detach, and the
 * catalog-aware reader below all instead require an EXACTLY resolved
 * canonical Person and refuse anyone else with
 * RegistryCatalogIdentityResolutionRequiredError, never silently.
 *
 * THE PUBLIC WEBSITE IS INERT TEXT, exactly like the plain registryUrl field
 * above. This module and everything built on it must never fetch, open,
 * preview, unfurl, crawl, or navigate to a catalog card's public website.
 */

/** Thrown when the caller's account has not completed the governed identity
 *  path required for catalog operations (the bare 'identity_resolution_required'
 *  sentinel). A typed error so callers can branch on it without matching
 *  translated text. */
export class RegistryCatalogIdentityResolutionRequiredError extends Error {
  constructor() {
    super("Finish verifying your account to use the registry provider catalog.");
    this.name = "RegistryCatalogIdentityResolutionRequiredError";
  }
}

function catalogRpcError(message: string): Error {
  if (message === "identity_resolution_required") {
    return new RegistryCatalogIdentityResolutionRequiredError();
  }
  if (message === "registry_provider_catalog_asset_inactive") {
    return new Error("That provider is no longer available. Try searching again.");
  }
  return new Error(message);
}

export type CatalogSearchResult = {
  id: string;
  providerName: string;
  shortDescription: string;
  /** Opaque, inert text. Never dereferenced, never rendered as a link. */
  publicWebsite: string;
};

function coerceCatalogResult(row: unknown): CatalogSearchResult {
  const value = (row ?? {}) as Record<string, unknown>;
  return {
    id: String(value.id ?? ""),
    providerName: String(value.provider_name ?? ""),
    shortDescription: String(value.short_description ?? ""),
    publicWebsite: String(value.public_website ?? ""),
  };
}

/** The attached catalog card, snapshotted at the moment the organizer selected it. */
export type RegistryPlanCatalogSnapshot = {
  catalogAssetId: string;
  providerName: string;
  shortDescription: string;
  /** Opaque, inert text. Never dereferenced, never rendered as a link. */
  publicWebsite: string;
};

/** A registry plan entry plus its current catalog attachment, if any. */
export type RegistryPlanEntryWithCatalog = RegistryPlanEntry & {
  catalog: RegistryPlanCatalogSnapshot | null;
};

function coerceEntryWithCatalog(row: unknown): RegistryPlanEntryWithCatalog {
  const base = coerceEntry(row);
  const value = (row ?? {}) as Record<string, unknown>;
  const catalogAssetId = (value.catalog_asset_id as string | null) ?? null;
  return {
    ...base,
    catalog: catalogAssetId
      ? {
          catalogAssetId,
          providerName: String(value.catalog_provider_name_snapshot ?? ""),
          shortDescription: String(value.catalog_description_snapshot ?? ""),
          publicWebsite: String(value.catalog_website_snapshot ?? ""),
        }
      : null,
  };
}

/**
 * Searches active catalog providers by name prefix. Mirrors the server's own
 * two-character minimum client-side so a too-short query never reaches the
 * network -- the server enforces the same rule independently regardless.
 */
export async function searchMyPrivateDraftRegistryProviderCatalog(
  client: OrganizerRegistryPlanRpcClient,
  input: { eventId: string; query: string },
): Promise<CatalogSearchResult[]> {
  const trimmed = input.query.trim();
  if (trimmed.length < 2) {
    return [];
  }
  const { data, error } = await client.rpc("search_my_private_draft_registry_provider_catalog", {
    p_event_id: input.eventId,
    p_query: trimmed,
  });
  if (error) {
    throw catalogRpcError(error.message);
  }
  return Array.isArray(data) ? data.map(coerceCatalogResult) : [];
}

export async function listMyPrivateDraftRegistryPlansWithCatalog(
  client: OrganizerRegistryPlanRpcClient,
  eventId: string,
): Promise<RegistryPlanEntryWithCatalog[]> {
  if (!eventId) {
    throw new Error("Choose a draft to plan.");
  }
  const { data, error } = await client.rpc("list_my_private_draft_registry_plans_with_catalog", {
    p_event_id: eventId,
  });
  if (error) {
    throw catalogRpcError(error.message);
  }
  return Array.isArray(data) ? data.map(coerceEntryWithCatalog) : [];
}

/** Attaches a catalog provider to one existing plan entry, or replaces an
 *  existing selection with a new one. Never touches the entry's typed
 *  provider name, actual URL, status, or note. */
export async function attachMyPrivateDraftRegistryPlanCatalogSelection(
  client: OrganizerRegistryPlanRpcClient,
  input: { eventId: string; registryPlanId: string; catalogAssetId: string },
): Promise<RegistryPlanEntryWithCatalog> {
  const { data, error } = await client.rpc("attach_my_private_draft_registry_plan_catalog_selection", {
    p_event_id: input.eventId,
    p_registry_plan_id: input.registryPlanId,
    p_catalog_asset_id: input.catalogAssetId,
  });
  if (error) {
    throw catalogRpcError(error.message);
  }
  return coerceEntryWithCatalog(oneRow(data));
}

/** Clears the catalog selection from one entry. Preserves every ordinary
 *  typed field untouched. */
export async function detachMyPrivateDraftRegistryPlanCatalogSelection(
  client: OrganizerRegistryPlanRpcClient,
  input: { eventId: string; registryPlanId: string },
): Promise<RegistryPlanEntryWithCatalog> {
  const { data, error } = await client.rpc("detach_my_private_draft_registry_plan_catalog_selection", {
    p_event_id: input.eventId,
    p_registry_plan_id: input.registryPlanId,
  });
  if (error) {
    throw catalogRpcError(error.message);
  }
  return coerceEntryWithCatalog(oneRow(data));
}
