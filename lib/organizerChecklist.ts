/**
 * Browser adapter for the P-3G organizer private-draft planning-checklist RPC
 * surface.
 *
 * This is A BLANK NOTEBOOK WITH CHECKBOXES. Three rules from the contract
 * (§B) govern every line of it, and of anything built on it:
 *
 *   1. The list starts empty and stays empty until the organizer writes in it.
 *      This module supplies, generates, suggests, orders, and scores NOTHING.
 *      There is deliberately no starter list, no template, and no default item
 *      anywhere in this file.
 *   2. An empty checklist says nothing about whether the event is ready.
 *   3. Marking every item complete says nothing about whether the event is
 *      ready. Completion is a personal marker on one row: it is never
 *      aggregated, counted, turned into a percentage, or read as a signal.
 *      This module exports NO progress, total, ratio, or "remaining" helper.
 *
 * The target date is inert: date only, no time, and nothing acts on it -- no
 * reminder, notification, calendar entry, overdue state, or escalation. A
 * date in the past is simply a date in the past.
 *
 * The database commands remain the authoritative authorization and validation
 * boundary (the self-service organizer-owner rule only -- never Event task
 * authority); this module only keeps route components from constructing RPC
 * argument objects ad hoc.
 */

type RpcResult = { data: unknown; error: { message: string } | null };

export type OrganizerChecklistRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
};

export type ChecklistItem = {
  id: string;
  title: string;
  organizerNote: string | null;
  /** Date only (YYYY-MM-DD) as the organizer entered it. Inert. */
  targetDate: string | null;
  isCompleted: boolean;
};

/** The checklist field values. `title` is required; everything else optional. */
export type ChecklistItemInput = {
  title: string;
  note: string;
  targetDate: string;
  isCompleted: boolean;
};

export function emptyChecklistItem(): ChecklistItemInput {
  return { title: "", note: "", targetDate: "", isCompleted: false };
}

export function checklistItemValues(item: ChecklistItem): ChecklistItemInput {
  return {
    title: item.title ?? "",
    note: item.organizerNote ?? "",
    targetDate: item.targetDate ?? "",
    isCompleted: Boolean(item.isCompleted),
  };
}

export function checklistItemError(input: ChecklistItemInput): string | null {
  if (!input.title.trim()) {
    return "Enter something for this item.";
  }
  if (input.title.trim().length > 300) {
    return "The item must be 300 characters or fewer.";
  }
  if (input.note.trim().length > 2000) {
    return "The note must be 2000 characters or fewer.";
  }
  return null;
}

function coerceItem(row: unknown): ChecklistItem {
  const value = (row ?? {}) as Record<string, unknown>;
  return {
    id: String(value.id ?? ""),
    title: String(value.item_title ?? ""),
    organizerNote: (value.organizer_note as string | null) ?? null,
    targetDate: (value.target_date as string | null) ?? null,
    isCompleted: Boolean(value.is_completed),
  };
}

function oneRow(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("EpicentraX did not return the expected checklist result.");
  }
  return row as Record<string, unknown>;
}

function itemArgs(input: ChecklistItemInput) {
  return {
    p_item_title: input.title.trim(),
    p_organizer_note: input.note.trim() || null,
    p_target_date: input.targetDate.trim() || null,
    p_is_completed: input.isCompleted,
  };
}

export async function listMyPrivateDraftChecklistItems(
  client: OrganizerChecklistRpcClient,
  eventId: string,
): Promise<ChecklistItem[]> {
  if (!eventId) {
    throw new Error("Choose a draft to plan.");
  }
  const { data, error } = await client.rpc("list_my_private_draft_checklist_items", {
    p_event_id: eventId,
  });
  if (error) {
    throw new Error(error.message);
  }
  // Whatever the organizer wrote, in stable creation order -- and nothing else.
  // An empty result is an empty list, not a prompt to fill one in.
  return Array.isArray(data) ? data.map(coerceItem) : [];
}

export async function addMyPrivateDraftChecklistItem(
  client: OrganizerChecklistRpcClient,
  input: { eventId: string; values: ChecklistItemInput },
): Promise<ChecklistItem> {
  const validationError = checklistItemError(input.values);
  if (validationError) {
    throw new Error(validationError);
  }
  const { data, error } = await client.rpc("add_my_private_draft_checklist_item", {
    p_event_id: input.eventId,
    ...itemArgs(input.values),
  });
  if (error) {
    throw new Error(error.message);
  }
  return coerceItem(oneRow(data));
}

export async function updateMyPrivateDraftChecklistItem(
  client: OrganizerChecklistRpcClient,
  input: { eventId: string; checklistItemId: string; values: ChecklistItemInput },
): Promise<ChecklistItem> {
  const validationError = checklistItemError(input.values);
  if (validationError) {
    throw new Error(validationError);
  }
  const { data, error } = await client.rpc("update_my_private_draft_checklist_item", {
    p_event_id: input.eventId,
    p_checklist_item_id: input.checklistItemId,
    ...itemArgs(input.values),
  });
  if (error) {
    throw new Error(error.message);
  }
  return coerceItem(oneRow(data));
}

export async function deleteMyPrivateDraftChecklistItem(
  client: OrganizerChecklistRpcClient,
  input: { eventId: string; checklistItemId: string },
): Promise<{ deletedId: string }> {
  const { data, error } = await client.rpc("delete_my_private_draft_checklist_item", {
    p_event_id: input.eventId,
    p_checklist_item_id: input.checklistItemId,
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = oneRow(data);
  return { deletedId: String(row.deleted_id ?? input.checklistItemId) };
}
