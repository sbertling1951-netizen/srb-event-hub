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
