/**
 * Browser adapter for the P-3D organizer private-draft vendor-plan RPC surface.
 *
 * A vendor plan entry is PLANNING DATA ONLY -- not an admitted vendor, a vendor
 * account, a contact, an access grant, an invitation, a candidacy, an
 * admission, or a payment. P-3D is private placeholders only: there is no
 * Shared Planning Catalog browse, selection, or reference yet, and deliberately
 * no cost/quote/currency field. The database commands remain the authoritative
 * authorization and validation boundary (the self-service organizer-owner rule
 * only -- never Event task authority); this module only keeps route components
 * from constructing RPC argument objects ad hoc.
 *
 * Contact fields (20261002000000): new entries carry an optional `contactName`
 * and `contactPhone`. Both are opaque planner-entered text -- never
 * normalized, parsed, matched, dialled, messaged, or resolved to a Person.
 *
 * `legacyContactDetail` is the single free-text field entries written before
 * that migration used. It is READ-ONLY here and deliberately NOT parsed into
 * the new fields: the adapter carries whatever the server returned straight
 * back on the next save, so editing an old entry never silently discards it.
 */

type RpcResult = { data: unknown; error: { message: string } | null };

export type OrganizerVendorPlanRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
};

/** The three private planning statuses the contract allows, and only these. */
export const VENDOR_PLAN_STATUSES = ["considering", "contacted", "selected"] as const;
export type VendorPlanStatus = (typeof VENDOR_PLAN_STATUSES)[number];

export const VENDOR_PLAN_STATUS_LABELS: Record<VendorPlanStatus, string> = {
  considering: "Considering",
  contacted: "Contacted",
  selected: "Selected",
};

export function isVendorPlanStatus(value: unknown): value is VendorPlanStatus {
  return VENDOR_PLAN_STATUSES.includes(value as VendorPlanStatus);
}

export type VendorPlanEntry = {
  id: string;
  vendorName: string;
  serviceCategory: string | null;
  planningStatus: VendorPlanStatus;
  website: string | null;
  contactName: string | null;
  contactPhone: string | null;
  /** Pre-20261002000000 free-text contact field. Read-only; never reinterpreted. */
  legacyContactDetail: string | null;
  organizerNote: string | null;
};

/**
 * The vendor-plan field values. `vendorName` is required and `status` is always
 * one of the three; every other field is an optional private planning note.
 */
export type VendorPlanInput = {
  vendorName: string;
  serviceCategory: string;
  status: VendorPlanStatus;
  website: string;
  contactName: string;
  contactPhone: string;
  note: string;
  /**
   * Carried, not edited. Whatever legacy contact_detail the server returned is
   * passed straight back so an edit preserves it verbatim; the form never
   * shows it as an editable contact name or phone number.
   */
  legacyContactDetail: string;
};

export function emptyVendorPlan(): VendorPlanInput {
  return {
    vendorName: "",
    serviceCategory: "",
    status: "considering",
    website: "",
    contactName: "",
    contactPhone: "",
    note: "",
    legacyContactDetail: "",
  };
}

export function vendorPlanValues(entry: VendorPlanEntry): VendorPlanInput {
  return {
    vendorName: entry.vendorName ?? "",
    serviceCategory: entry.serviceCategory ?? "",
    status: isVendorPlanStatus(entry.planningStatus) ? entry.planningStatus : "considering",
    website: entry.website ?? "",
    contactName: entry.contactName ?? "",
    contactPhone: entry.contactPhone ?? "",
    note: entry.organizerNote ?? "",
    // carried through untouched so a save cannot drop it
    legacyContactDetail: entry.legacyContactDetail ?? "",
  };
}

export function vendorPlanError(input: VendorPlanInput): string | null {
  if (!input.vendorName.trim()) {
    return "Enter a name for this vendor.";
  }
  if (input.vendorName.trim().length > 200) {
    return "The name must be 200 characters or fewer.";
  }
  if (!isVendorPlanStatus(input.status)) {
    return "Choose considering, contacted, or selected.";
  }
  if (input.serviceCategory.trim().length > 120) {
    return "The category must be 120 characters or fewer.";
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

function coerceEntry(row: unknown): VendorPlanEntry {
  const value = (row ?? {}) as Record<string, unknown>;
  const status = value.planning_status;
  return {
    id: String(value.id ?? ""),
    vendorName: String(value.vendor_name ?? ""),
    serviceCategory: (value.service_category as string | null) ?? null,
    planningStatus: isVendorPlanStatus(status) ? status : "considering",
    website: (value.website as string | null) ?? null,
    contactName: (value.contact_name as string | null) ?? null,
    contactPhone: (value.contact_phone as string | null) ?? null,
    legacyContactDetail: (value.contact_detail as string | null) ?? null,
    organizerNote: (value.organizer_note as string | null) ?? null,
  };
}

function oneRow(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("EpicentraX did not return the expected vendor-plan result.");
  }
  return row as Record<string, unknown>;
}

function planArgs(input: VendorPlanInput) {
  return {
    p_vendor_name: input.vendorName.trim(),
    p_service_category: input.serviceCategory.trim() || null,
    p_planning_status: input.status,
    p_website: input.website.trim() || null,
    // the legacy value is round-tripped verbatim, never re-derived
    p_contact_detail: input.legacyContactDetail.trim() || null,
    p_organizer_note: input.note.trim() || null,
    p_contact_name: input.contactName.trim() || null,
    p_contact_phone: input.contactPhone.trim() || null,
  };
}

export async function listMyPrivateDraftVendorPlans(
  client: OrganizerVendorPlanRpcClient,
  eventId: string,
): Promise<VendorPlanEntry[]> {
  if (!eventId) {
    throw new Error("Choose a draft to plan.");
  }
  const { data, error } = await client.rpc("list_my_private_draft_vendor_plans", {
    p_event_id: eventId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return Array.isArray(data) ? data.map(coerceEntry) : [];
}

export async function addMyPrivateDraftVendorPlan(
  client: OrganizerVendorPlanRpcClient,
  input: { eventId: string; values: VendorPlanInput },
): Promise<VendorPlanEntry> {
  const validationError = vendorPlanError(input.values);
  if (validationError) {
    throw new Error(validationError);
  }
  const { data, error } = await client.rpc("add_my_private_draft_vendor_plan", {
    p_event_id: input.eventId,
    ...planArgs(input.values),
  });
  if (error) {
    throw new Error(error.message);
  }
  return coerceEntry(oneRow(data));
}

export async function updateMyPrivateDraftVendorPlan(
  client: OrganizerVendorPlanRpcClient,
  input: { eventId: string; vendorPlanId: string; values: VendorPlanInput },
): Promise<VendorPlanEntry> {
  const validationError = vendorPlanError(input.values);
  if (validationError) {
    throw new Error(validationError);
  }
  const { data, error } = await client.rpc("update_my_private_draft_vendor_plan", {
    p_event_id: input.eventId,
    p_vendor_plan_id: input.vendorPlanId,
    ...planArgs(input.values),
  });
  if (error) {
    throw new Error(error.message);
  }
  return coerceEntry(oneRow(data));
}

export async function deleteMyPrivateDraftVendorPlan(
  client: OrganizerVendorPlanRpcClient,
  input: { eventId: string; vendorPlanId: string },
): Promise<{ deletedId: string }> {
  const { data, error } = await client.rpc("delete_my_private_draft_vendor_plan", {
    p_event_id: input.eventId,
    p_vendor_plan_id: input.vendorPlanId,
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = oneRow(data);
  return { deletedId: String(row.deleted_id ?? input.vendorPlanId) };
}
