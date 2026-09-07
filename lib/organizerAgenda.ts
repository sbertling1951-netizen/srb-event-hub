/**
 * Browser adapter for the P-3B organizer private-draft Agenda RPC surface.
 * The database commands remain the authoritative authorization and validation
 * boundary (self-service organizer-owner rule only -- never Event task
 * authority); this module only keeps route components from constructing RPC
 * argument objects ad hoc, and normalizes the shared optimistic-concurrency
 * "stale" outcome.
 */

type RpcResult = { data: unknown; error: { message: string } | null };

export type OrganizerAgendaRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
};

export type OrganizerAgendaItem = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  speaker: string | null;
  agendaDate: string | null;
  startTime: string | null;
  endTime: string | null;
};

export type OrganizerAgenda = {
  /** The shared per-Event agenda version -- pass it back on every edit/delete. */
  version: number;
  items: OrganizerAgendaItem[];
};

/**
 * The organizer agenda-item field values. `startTime` is required (the shared
 * `agenda_items.start_time` column is NOT NULL); everything else is optional.
 */
export type OrganizerAgendaItemInput = {
  title: string;
  description: string;
  location: string;
  speaker: string;
  agendaDate: string;
  startTime: string;
  endTime: string;
};

export type SaveAgendaItemResult =
  | { status: "saved"; version: number; item: OrganizerAgendaItem }
  | { status: "stale" };

export type DeleteAgendaItemResult =
  | { status: "deleted"; version: number; deletedId: string }
  | { status: "stale" };

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function isTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function organizerAgendaItemError(input: OrganizerAgendaItemInput): string | null {
  if (!input.title.trim()) {
    return "Enter a title for this agenda item.";
  }
  if (input.title.trim().length > 200) {
    return "The title must be 200 characters or fewer.";
  }
  if (!isTime(input.startTime)) {
    return "Choose a start time.";
  }
  if (input.endTime && !isTime(input.endTime)) {
    return "Choose a valid end time, or leave it blank.";
  }
  if (input.endTime && input.endTime < input.startTime) {
    return "The end time cannot be before the start time.";
  }
  if (input.agendaDate && !isIsoDate(input.agendaDate)) {
    return "Choose a valid date, or leave it blank.";
  }
  return null;
}

function coerceItem(row: unknown): OrganizerAgendaItem {
  const value = (row ?? {}) as Record<string, unknown>;
  return {
    id: String(value.id ?? ""),
    title: String(value.title ?? ""),
    description: (value.description as string | null) ?? null,
    location: (value.location as string | null) ?? null,
    speaker: (value.speaker as string | null) ?? null,
    agendaDate: (value.agenda_date as string | null) ?? null,
    startTime: (value.start_time as string | null) ?? null,
    endTime: (value.end_time as string | null) ?? null,
  };
}

function oneRow(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("EpicentraX did not return the expected agenda result.");
  }
  return row as Record<string, unknown>;
}

export async function getMyPrivateDraftAgenda(
  client: OrganizerAgendaRpcClient,
  eventId: string,
): Promise<OrganizerAgenda> {
  if (!eventId) {
    throw new Error("Choose a draft to plan.");
  }
  const { data, error } = await client.rpc("get_my_private_draft_agenda", {
    p_event_id: eventId,
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = oneRow(data);
  const items = Array.isArray(row.items) ? row.items : [];
  return {
    version: Number(row.agenda_version ?? 0),
    items: items.map(coerceItem),
  };
}

function itemArgs(input: OrganizerAgendaItemInput) {
  return {
    p_title: input.title.trim(),
    p_description: input.description.trim() || null,
    p_location: input.location.trim() || null,
    p_speaker: input.speaker.trim() || null,
    p_agenda_date: input.agendaDate || null,
    p_start_time: input.startTime,
    p_end_time: input.endTime || null,
  };
}

export async function createMyPrivateDraftAgendaItem(
  client: OrganizerAgendaRpcClient,
  input: { eventId: string; values: OrganizerAgendaItemInput },
): Promise<{ version: number; item: OrganizerAgendaItem }> {
  const validationError = organizerAgendaItemError(input.values);
  if (validationError) {
    throw new Error(validationError);
  }
  const { data, error } = await client.rpc("create_my_private_draft_agenda_item", {
    p_event_id: input.eventId,
    ...itemArgs(input.values),
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = oneRow(data);
  return { version: Number(row.agenda_version ?? 0), item: coerceItem(row.item) };
}

export async function updateMyPrivateDraftAgendaItem(
  client: OrganizerAgendaRpcClient,
  input: {
    eventId: string;
    itemId: string;
    expectedVersion: number;
    values: OrganizerAgendaItemInput;
  },
): Promise<SaveAgendaItemResult> {
  const validationError = organizerAgendaItemError(input.values);
  if (validationError) {
    throw new Error(validationError);
  }
  const { data, error } = await client.rpc("update_my_private_draft_agenda_item", {
    p_event_id: input.eventId,
    p_item_id: input.itemId,
    p_expected_agenda_version: input.expectedVersion,
    ...itemArgs(input.values),
  });
  if (error) {
    if (error.message === "stale_agenda_version") {
      return { status: "stale" };
    }
    throw new Error(error.message);
  }
  const row = oneRow(data);
  return {
    status: "saved",
    version: Number(row.agenda_version ?? 0),
    item: coerceItem(row.item),
  };
}

export async function deleteMyPrivateDraftAgendaItem(
  client: OrganizerAgendaRpcClient,
  input: { eventId: string; itemId: string; expectedVersion: number },
): Promise<DeleteAgendaItemResult> {
  const { data, error } = await client.rpc("delete_my_private_draft_agenda_item", {
    p_event_id: input.eventId,
    p_item_id: input.itemId,
    p_expected_agenda_version: input.expectedVersion,
  });
  if (error) {
    if (error.message === "stale_agenda_version") {
      return { status: "stale" };
    }
    throw new Error(error.message);
  }
  const row = oneRow(data);
  return {
    status: "deleted",
    version: Number(row.agenda_version ?? 0),
    deletedId: String(row.deleted_id ?? input.itemId),
  };
}
