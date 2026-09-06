/**
 * Browser adapter for the deliberately narrow P-2A organizer RPC surface.
 * The database command remains the authoritative validation and authority
 * boundary; this module only keeps route components from constructing RPC
 * argument objects ad hoc.
 */

export type OrganizerDraft = {
  tenant_id: string;
  organizer_appointment_id: string;
  /** The organizer's canonical Person UUID (P-2B). Stable across contexts. */
  organizer_person_id: string;
  event_id: string;
  organization_name: string;
  event_name: string;
  start_date: string | null;
  end_date: string;
  timezone: string;
  location: string | null;
  location_mode: "location" | "online" | "no_location";
  starter_template: string;
  status: "Draft";
  is_active: false;
  visible_to_members: false;
  created_at: string;
};

export type CreateOrganizerDraftInput = {
  organizationName: string;
  eventName: string;
  startDate: string;
  endDate: string;
  timezone: string;
  locationMode: "location" | "online" | "no_location";
  location: string;
  starterTemplate: string;
  idempotencyKey: string;
};

type RpcResult = {
  data: unknown;
  error: { message: string } | null;
};

export type OrganizerDraftRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
};

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function isIanaTimezone(value: string) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function organizerDraftInputError(
  input: CreateOrganizerDraftInput,
): string | null {
  if (!input.organizationName.trim()) {
    return "Enter an organization name.";
  }
  if (!input.eventName.trim()) {
    return "Enter an Event name.";
  }
  if (!isIsoDate(input.endDate) || (input.startDate && !isIsoDate(input.startDate))) {
    return "Choose an end date and, if provided, a valid start date.";
  }
  if (input.startDate && input.endDate < input.startDate) {
    return "The Event end date cannot be before its start date.";
  }
  if (!isIanaTimezone(input.timezone)) {
    return "Choose a valid time zone.";
  }
  if (input.locationMode === "location" && !input.location.trim()) {
    return "Enter a location or choose Online or no location yet.";
  }
  if (input.locationMode !== "location" && input.location.trim()) {
    return "Location text is only used when the Event has a location.";
  }
  if (!input.idempotencyKey) {
    return "Your browser could not start a secure draft. Use an up-to-date browser over a secure (https) connection, then try again.";
  }
  return null;
}

function oneDraft(data: unknown): OrganizerDraft {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("EpicentraX did not return the private draft it created.");
  }
  return row as OrganizerDraft;
}

/**
 * P-2B: the governed command resolves the organizer's canonical Person before
 * creating anything. When that resolution is uncertain it returns an explicit
 * `outcome` discriminator (not an error) -- the server has still written its
 * durable resolution-audit row, and nothing else has been created. The browser
 * routes the organizer through the existing identity-claim verification first.
 */
export type CreateOrganizerDraftResult =
  | { status: "created"; draft: OrganizerDraft }
  | { status: "identity_confirmation_required" }
  | { status: "identity_review_required" };

export async function createMyPrivateEventDraft(
  client: OrganizerDraftRpcClient,
  input: CreateOrganizerDraftInput,
): Promise<CreateOrganizerDraftResult> {
  const inputError = organizerDraftInputError(input);
  if (inputError) {
    throw new Error(inputError);
  }

  const { data, error } = await client.rpc("create_self_service_organizer_draft", {
    p_organization_name: input.organizationName.trim(),
    p_event_name: input.eventName.trim(),
    // The start date is optional. An unset field must reach the RPC as a
    // real null (p_start_date DEFAULT NULL), never "" -- PostgREST would
    // otherwise try to cast an empty string to `date` and fail the call.
    p_start_date: input.startDate || null,
    p_end_date: input.endDate,
    p_timezone: input.timezone,
    p_location_mode: input.locationMode,
    p_location: input.location.trim() || null,
    p_starter_template: input.starterTemplate,
    p_idempotency_key: input.idempotencyKey,
  });

  // Hard errors (bad input, idempotency conflict, unauthorized) are still real
  // errors. The expected uncertain identity outcomes are NOT errors.
  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const outcome =
    row && typeof row === "object" && "outcome" in row
      ? (row as { outcome?: unknown }).outcome
      : undefined;

  if (outcome === "identity_confirmation_required") {
    return { status: "identity_confirmation_required" };
  }
  if (outcome === "identity_review_required") {
    return { status: "identity_review_required" };
  }
  return { status: "created", draft: oneDraft(data) };
}

export async function listMyPrivateEventDrafts(
  client: OrganizerDraftRpcClient,
): Promise<OrganizerDraft[]> {
  const { data, error } = await client.rpc("list_my_self_service_private_drafts");
  if (error) {
    throw new Error(error.message);
  }
  return Array.isArray(data) ? (data as OrganizerDraft[]) : [];
}

export async function getMyPrivateEventDraft(
  client: OrganizerDraftRpcClient,
  eventId: string,
): Promise<OrganizerDraft | null> {
  const { data, error } = await client.rpc("get_my_self_service_private_draft", {
    p_event_id: eventId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return Array.isArray(data) && data.length > 0 ? oneDraft(data) : null;
}
