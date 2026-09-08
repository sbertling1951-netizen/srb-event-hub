/**
 * Browser adapter for the P-3E organizer private-draft venue/place-plan RPC
 * surface.
 *
 * A venue plan entry is PLANNING DATA ONLY -- a place the organizer is
 * thinking about. It is not a booking, a hold, a contract, a vendor, an
 * admitted participant, a Nearby place, a map object, a catalog asset, or the
 * Event's location.
 *
 * Marking an entry "selected" is a private note to self: it writes nothing
 * outside this planning surface, and in particular never sets the Event's
 * location, venue name, address, or coordinates. Adopting a considered place
 * as the Event's real location remains a separate, deliberate act on the
 * event-details screen.
 *
 * The address/description field is DESCRIPTIVE, NOT POSITIONAL -- it is never
 * geocoded, parsed into coordinates, pinned to a map, or distance-searched.
 * Contact name and phone are opaque planner-entered text: never normalized,
 * matched, resolved, dialled, or messaged.
 *
 * The database commands remain the authoritative authorization and validation
 * boundary (the self-service organizer-owner rule only -- never Event task
 * authority); this module only keeps route components from constructing RPC
 * argument objects ad hoc.
 */

type RpcResult = { data: unknown; error: { message: string } | null };

export type OrganizerVenuePlanRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
};

/** The three private planning statuses the contract allows, and only these. */
export const VENUE_PLAN_STATUSES = ["considering", "contacted", "selected"] as const;
export type VenuePlanStatus = (typeof VENUE_PLAN_STATUSES)[number];

export const VENUE_PLAN_STATUS_LABELS: Record<VenuePlanStatus, string> = {
  considering: "Considering",
  contacted: "Contacted",
  selected: "Selected",
};

export function isVenuePlanStatus(value: unknown): value is VenuePlanStatus {
  return VENUE_PLAN_STATUSES.includes(value as VenuePlanStatus);
}

export type VenuePlanEntry = {
  id: string;
  placeName: string;
  locationDescription: string | null;
  website: string | null;
  contactName: string | null;
  contactPhone: string | null;
  planningStatus: VenuePlanStatus;
  organizerNote: string | null;
};

/**
 * The venue-plan field values. `placeName` is required and `status` is always
 * one of the three; every other field is an optional private planning note.
 */
export type VenuePlanInput = {
  placeName: string;
  locationDescription: string;
  website: string;
  contactName: string;
  contactPhone: string;
  status: VenuePlanStatus;
  note: string;
};

export function emptyVenuePlan(): VenuePlanInput {
  return {
    placeName: "",
    locationDescription: "",
    website: "",
    contactName: "",
    contactPhone: "",
    status: "considering",
    note: "",
  };
}

export function venuePlanValues(entry: VenuePlanEntry): VenuePlanInput {
  return {
    placeName: entry.placeName ?? "",
    locationDescription: entry.locationDescription ?? "",
    website: entry.website ?? "",
    contactName: entry.contactName ?? "",
    contactPhone: entry.contactPhone ?? "",
    status: isVenuePlanStatus(entry.planningStatus) ? entry.planningStatus : "considering",
    note: entry.organizerNote ?? "",
  };
}

export function venuePlanError(input: VenuePlanInput): string | null {
  if (!input.placeName.trim()) {
    return "Enter a name for this place.";
  }
  if (input.placeName.trim().length > 200) {
    return "The name must be 200 characters or fewer.";
  }
  if (!isVenuePlanStatus(input.status)) {
    return "Choose considering, contacted, or selected.";
  }
  if (input.locationDescription.trim().length > 500) {
    return "The address or description must be 500 characters or fewer.";
  }
  if (input.website.trim().length > 500) {
    return "The website must be 500 characters or fewer.";
  }
  if (input.contactName.trim().length > 200) {
    return "The contact name must be 200 characters or fewer.";
  }
  if (input.contactPhone.trim().length > 50) {
    return "The phone number must be 50 characters or fewer.";
  }
  if (input.note.trim().length > 2000) {
    return "The note must be 2000 characters or fewer.";
  }
  return null;
}

/**
 * The Location text a planned place pre-fills on the Event-details form, per
 * the contract's §B.1 adoption path:
 *
 *   "Place name — location description"   when a description exists
 *   "Place name"                          when it does not
 *
 * This is a PURE STRING BUILDER. It performs no write, no RPC, and no lookup,
 * and it deliberately returns only text: the entry's id is never part of the
 * result, so a pre-fill can copy a place into the Location field without ever
 * linking the Event back to the planning record (contract §B.1 rule 8,
 * copy-not-link).
 */
export function venuePlanLocationText(entry: VenuePlanEntry): string {
  const name = (entry.placeName ?? "").trim();
  const description = (entry.locationDescription ?? "").trim();
  return description ? `${name} — ${description}` : name;
}

function coerceEntry(row: unknown): VenuePlanEntry {
  const value = (row ?? {}) as Record<string, unknown>;
  const status = value.planning_status;
  return {
    id: String(value.id ?? ""),
    placeName: String(value.place_name ?? ""),
    locationDescription: (value.location_description as string | null) ?? null,
    website: (value.website as string | null) ?? null,
    contactName: (value.contact_name as string | null) ?? null,
    contactPhone: (value.contact_phone as string | null) ?? null,
    planningStatus: isVenuePlanStatus(status) ? status : "considering",
    organizerNote: (value.organizer_note as string | null) ?? null,
  };
}

function oneRow(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("EpicentraX did not return the expected venue-plan result.");
  }
  return row as Record<string, unknown>;
}

function planArgs(input: VenuePlanInput) {
  return {
    p_place_name: input.placeName.trim(),
    p_location_description: input.locationDescription.trim() || null,
    p_website: input.website.trim() || null,
    p_contact_name: input.contactName.trim() || null,
    p_contact_phone: input.contactPhone.trim() || null,
    p_planning_status: input.status,
    p_organizer_note: input.note.trim() || null,
  };
}

export async function listMyPrivateDraftVenuePlans(
  client: OrganizerVenuePlanRpcClient,
  eventId: string,
): Promise<VenuePlanEntry[]> {
  if (!eventId) {
    throw new Error("Choose a draft to plan.");
  }
  const { data, error } = await client.rpc("list_my_private_draft_venue_plans", {
    p_event_id: eventId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return Array.isArray(data) ? data.map(coerceEntry) : [];
}

export async function addMyPrivateDraftVenuePlan(
  client: OrganizerVenuePlanRpcClient,
  input: { eventId: string; values: VenuePlanInput },
): Promise<VenuePlanEntry> {
  const validationError = venuePlanError(input.values);
  if (validationError) {
    throw new Error(validationError);
  }
  const { data, error } = await client.rpc("add_my_private_draft_venue_plan", {
    p_event_id: input.eventId,
    ...planArgs(input.values),
  });
  if (error) {
    throw new Error(error.message);
  }
  return coerceEntry(oneRow(data));
}

export async function updateMyPrivateDraftVenuePlan(
  client: OrganizerVenuePlanRpcClient,
  input: { eventId: string; venuePlanId: string; values: VenuePlanInput },
): Promise<VenuePlanEntry> {
  const validationError = venuePlanError(input.values);
  if (validationError) {
    throw new Error(validationError);
  }
  const { data, error } = await client.rpc("update_my_private_draft_venue_plan", {
    p_event_id: input.eventId,
    p_venue_plan_id: input.venuePlanId,
    ...planArgs(input.values),
  });
  if (error) {
    throw new Error(error.message);
  }
  return coerceEntry(oneRow(data));
}

export async function deleteMyPrivateDraftVenuePlan(
  client: OrganizerVenuePlanRpcClient,
  input: { eventId: string; venuePlanId: string },
): Promise<{ deletedId: string }> {
  const { data, error } = await client.rpc("delete_my_private_draft_venue_plan", {
    p_event_id: input.eventId,
    p_venue_plan_id: input.venuePlanId,
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = oneRow(data);
  return { deletedId: String(row.deleted_id ?? input.venuePlanId) };
}
