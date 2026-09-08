/**
 * Browser adapter for the P-3C organizer private-draft guest-list RPC surface.
 *
 * A planned guest is PLANNING DATA ONLY -- not an invitation, a registration,
 * an attendee, an account, or any access grant. The database commands remain
 * the authoritative authorization and validation boundary (the self-service
 * organizer-owner rule only -- never Event task authority); this module only
 * keeps route components from constructing RPC argument objects ad hoc.
 */

type RpcResult = { data: unknown; error: { message: string } | null };

export type OrganizerGuestListRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
};

export type PlannedGuest = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  organizerNote: string | null;
};

/**
 * The planned-guest field values. `displayName` is required; `email`, `phone`,
 * and `note` are optional private organizer planning notes.
 */
export type PlannedGuestInput = {
  displayName: string;
  email: string;
  phone: string;
  note: string;
};

export function emptyPlannedGuest(): PlannedGuestInput {
  return { displayName: "", email: "", phone: "", note: "" };
}

export function plannedGuestValues(guest: PlannedGuest): PlannedGuestInput {
  return {
    displayName: guest.displayName ?? "",
    email: guest.email ?? "",
    phone: guest.phone ?? "",
    note: guest.organizerNote ?? "",
  };
}

export function plannedGuestError(input: PlannedGuestInput): string | null {
  if (!input.displayName.trim()) {
    return "Enter a name for this guest.";
  }
  if (input.displayName.trim().length > 200) {
    return "The name must be 200 characters or fewer.";
  }
  if (input.email.trim().length > 320) {
    return "The email must be 320 characters or fewer.";
  }
  if (input.phone.trim().length > 50) {
    return "The phone number must be 50 characters or fewer.";
  }
  if (input.note.trim().length > 2000) {
    return "The note must be 2000 characters or fewer.";
  }
  return null;
}

function coerceGuest(row: unknown): PlannedGuest {
  const value = (row ?? {}) as Record<string, unknown>;
  return {
    id: String(value.id ?? ""),
    displayName: String(value.display_name ?? ""),
    email: (value.email as string | null) ?? null,
    phone: (value.phone as string | null) ?? null,
    organizerNote: (value.organizer_note as string | null) ?? null,
  };
}

function oneRow(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("EpicentraX did not return the expected guest-list result.");
  }
  return row as Record<string, unknown>;
}

function guestArgs(input: PlannedGuestInput) {
  return {
    p_display_name: input.displayName.trim(),
    p_email: input.email.trim() || null,
    p_phone: input.phone.trim() || null,
    p_organizer_note: input.note.trim() || null,
  };
}

export async function listMyPrivateDraftPlannedGuests(
  client: OrganizerGuestListRpcClient,
  eventId: string,
): Promise<PlannedGuest[]> {
  if (!eventId) {
    throw new Error("Choose a draft to plan.");
  }
  const { data, error } = await client.rpc("list_my_private_draft_planned_guests", {
    p_event_id: eventId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return Array.isArray(data) ? data.map(coerceGuest) : [];
}

export async function addMyPrivateDraftPlannedGuest(
  client: OrganizerGuestListRpcClient,
  input: { eventId: string; values: PlannedGuestInput },
): Promise<PlannedGuest> {
  const validationError = plannedGuestError(input.values);
  if (validationError) {
    throw new Error(validationError);
  }
  const { data, error } = await client.rpc("add_my_private_draft_planned_guest", {
    p_event_id: input.eventId,
    ...guestArgs(input.values),
  });
  if (error) {
    throw new Error(error.message);
  }
  return coerceGuest(oneRow(data));
}

export async function updateMyPrivateDraftPlannedGuest(
  client: OrganizerGuestListRpcClient,
  input: { eventId: string; guestId: string; values: PlannedGuestInput },
): Promise<PlannedGuest> {
  const validationError = plannedGuestError(input.values);
  if (validationError) {
    throw new Error(validationError);
  }
  const { data, error } = await client.rpc("update_my_private_draft_planned_guest", {
    p_event_id: input.eventId,
    p_guest_id: input.guestId,
    ...guestArgs(input.values),
  });
  if (error) {
    throw new Error(error.message);
  }
  return coerceGuest(oneRow(data));
}

export async function deleteMyPrivateDraftPlannedGuest(
  client: OrganizerGuestListRpcClient,
  input: { eventId: string; guestId: string },
): Promise<{ deletedId: string }> {
  const { data, error } = await client.rpc("delete_my_private_draft_planned_guest", {
    p_event_id: input.eventId,
    p_guest_id: input.guestId,
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = oneRow(data);
  return { deletedId: String(row.deleted_id ?? input.guestId) };
}
