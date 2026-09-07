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

/**
 * P-2C: a personal event space the caller personally organizes (an internal
 * self-service private tenant). Never carries membership, invitation, attendee,
 * Event Admin, or Tenant Admin context -- the RPC only reads the caller's own
 * organizer appointments.
 */
export type OrganizerPrivateOrganization = {
  tenant_id: string;
  organizer_appointment_id: string;
  organizer_person_id: string;
  organization_name: string;
  draft_event_count: number;
  created_at: string;
};

/** Event-only inputs shared by "new event space" and "add event to a space". */
export type OrganizerEventInput = {
  eventName: string;
  startDate: string;
  endDate: string;
  timezone: string;
  locationMode: "location" | "online" | "no_location";
  location: string;
  starterTemplate: string;
  idempotencyKey: string;
};

export type CreateOrganizerDraftInput = OrganizerEventInput & {
  organizationName: string;
};

export type AddOrganizerEventInput = OrganizerEventInput & {
  /** An event space the caller already organizes (from listMyPrivateOrganizations). */
  organizationTenantId: string;
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

function organizerEventInputError(input: OrganizerEventInput): string | null {
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

export function organizerDraftInputError(
  input: CreateOrganizerDraftInput,
): string | null {
  if (!input.organizationName.trim()) {
    return "Enter an organization name.";
  }
  return organizerEventInputError(input);
}

export function addOrganizerEventInputError(
  input: AddOrganizerEventInput,
): string | null {
  if (!input.organizationTenantId) {
    return "Choose one of your event spaces.";
  }
  return organizerEventInputError(input);
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

function interpretCreateResult(
  data: unknown,
  error: { message: string } | null,
): CreateOrganizerDraftResult {
  // Hard errors (bad input, idempotency conflict, unauthorized, unknown event
  // space) are still real errors. The expected uncertain identity outcomes are
  // returned rows, NOT errors.
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

  return interpretCreateResult(data, error);
}

/**
 * P-2C: add another private draft event to an event space the caller already
 * organizes. Same governed command family, same discriminated identity
 * outcomes -- it creates no new tenant, organizer appointment, or authority.
 * An event space the caller does not personally organize (or one that is
 * ordinary, inactive, or someone else's) comes back as a plain
 * "Organization not found." error, never an enumeration.
 */
export async function createEventInMyOrganization(
  client: OrganizerDraftRpcClient,
  input: AddOrganizerEventInput,
): Promise<CreateOrganizerDraftResult> {
  const inputError = addOrganizerEventInputError(input);
  if (inputError) {
    throw new Error(inputError);
  }

  const { data, error } = await client.rpc("create_self_service_organizer_event", {
    p_organization_tenant_id: input.organizationTenantId,
    p_event_name: input.eventName.trim(),
    p_start_date: input.startDate || null,
    p_end_date: input.endDate,
    p_timezone: input.timezone,
    p_location_mode: input.locationMode,
    p_location: input.location.trim() || null,
    p_starter_template: input.starterTemplate,
    p_idempotency_key: input.idempotencyKey,
  });

  return interpretCreateResult(data, error);
}

export async function listMyPrivateOrganizations(
  client: OrganizerDraftRpcClient,
): Promise<OrganizerPrivateOrganization[]> {
  const { data, error } = await client.rpc(
    "list_my_self_service_private_organizations",
  );
  if (error) {
    throw new Error(error.message);
  }
  return Array.isArray(data) ? (data as OrganizerPrivateOrganization[]) : [];
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

/**
 * P-2D: the server-owned capacity contract. `active_event_limit` is 1 by
 * default; a future subscription raises it server-side without any change
 * here. `can_start_another_event` is the only value the UI should gate on --
 * never a client-side count.
 */
export type OrganizerCapacity = {
  active_event_limit: number;
  active_unfinished_event_count: number;
  can_start_another_event: boolean;
};

export async function getMyOrganizerCapacity(
  client: OrganizerDraftRpcClient,
): Promise<OrganizerCapacity | null> {
  const { data, error } = await client.rpc(
    "get_my_self_service_organizer_capacity",
  );
  if (error) {
    throw new Error(error.message);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return null;
  }
  const value = row as Partial<OrganizerCapacity>;
  return {
    active_event_limit: Number(value.active_event_limit ?? 0),
    active_unfinished_event_count: Number(value.active_unfinished_event_count ?? 0),
    can_start_another_event: value.can_start_another_event === true,
  };
}

/**
 * P-2D: permanently delete one unfinished private Draft event through the one
 * governed command. When it was the last event in its private workspace, the
 * workspace (internal tenant + organizer appointment) is removed too. The
 * server keeps only a minimal, non-content deletion-audit fact. A non-owned,
 * non-existent, non-deletable, or dependency-carrying event comes back as a
 * plain "Event not found." (or dependency) error, never an enumeration.
 */
export type DeleteOrganizerEventResult = {
  status: "deleted";
  deletedEventId: string;
  deletionScope: "event_only" | "event_and_empty_workspace";
  deletedWorkspace: boolean;
};

export async function deleteMyUnfinishedEvent(
  client: OrganizerDraftRpcClient,
  input: { eventId: string; idempotencyKey: string },
): Promise<DeleteOrganizerEventResult> {
  if (!input.eventId) {
    throw new Error("Choose an unfinished event to delete.");
  }
  if (!input.idempotencyKey) {
    throw new Error(
      "Your browser could not start a secure request. Use an up-to-date browser over a secure (https) connection, then try again.",
    );
  }

  const { data, error } = await client.rpc("delete_self_service_organizer_event", {
    p_event_id: input.eventId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("EpicentraX did not confirm the deletion.");
  }
  const value = row as {
    deleted_event_id?: string;
    deletion_scope?: string;
  };
  const scope =
    value.deletion_scope === "event_and_empty_workspace"
      ? "event_and_empty_workspace"
      : "event_only";
  return {
    status: "deleted",
    deletedEventId: value.deleted_event_id ?? input.eventId,
    deletionScope: scope,
    deletedWorkspace: scope === "event_and_empty_workspace",
  };
}
