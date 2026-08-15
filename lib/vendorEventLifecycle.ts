"use client";

import { supabase } from "@/lib/supabase";

/**
 * Thin, typed wrappers around the governed Vendor Admission Lifecycle
 * RPCs (Stages 2/3/Metadata Bridge). Every event_vendors mutation and
 * every lifecycle-aware read goes through exactly one of these -- no
 * caller reimplements admission logic or queries event_vendors/
 * vendor_event_applications/vendor_event_dispositions directly. Shared
 * by /admin/vendors and (for its existing minimal assign/unassign/
 * metadata paths) /admin/imports, so the two surfaces cannot drift into
 * two different call shapes for the same governed operation.
 *
 * Database RPC authority (has_event_task_authority) remains the actual
 * security boundary regardless of anything in this file -- these
 * wrappers add types and a single call site per operation, nothing more.
 */

export type ReasonClassification =
  | "operational_capacity"
  | "performance_quality"
  | "administrative_other";

export type VendorDispositionReasonCode = {
  code: string;
  classification: ReasonClassification;
  label: string;
  is_active: boolean;
};

export type CandidacyStatus = "pending" | "admitted" | "rejected" | "withdrawn";
export type AdmissionState = "admitted" | "revoked";

/**
 * The single derived display state a review UI actually needs --
 * computed here once so no caller re-derives the admitted-vs-revoked
 * distinction ad hoc. vendor_event_applications.status is the historical
 * candidacy outcome; event_vendors.admission_state is current
 * participation; they can legitimately disagree (an admitted candidacy
 * whose admission was later revoked stays historically "admitted").
 */
export type VendorEventDisplayStatus =
  | "not_considered"
  | "pending"
  | "admitted"
  | "rejected"
  | "withdrawn"
  | "revoked";

export function deriveVendorEventDisplayStatus(
  candidacyStatus: CandidacyStatus | null,
  currentParticipationState: AdmissionState | null,
): VendorEventDisplayStatus {
  if (!candidacyStatus) {
    return "not_considered";
  }
  // Current participation is authoritative for "revoked" even though the
  // candidacy's own historical outcome remains "admitted" -- never
  // display an admitted-but-revoked vendor as currently participating.
  if (currentParticipationState === "revoked") {
    return "revoked";
  }
  return candidacyStatus;
}

export type VendorEventAction = "consider" | "admit" | "reject" | "revoke" | "reconsider";

/**
 * Which governed actions a review UI may offer for a given display
 * status -- centralized so the action set for "not yet considered"
 * (both catalog-reuse paths: register a candidacy, or admit outright)
 * and for "rejected/revoked/withdrawn" (reconsider via admit) is defined
 * once, not re-derived per caller.
 */
export function getAvailableVendorEventActions(
  status: VendorEventDisplayStatus,
): VendorEventAction[] {
  switch (status) {
    case "not_considered":
      return ["consider", "admit"];
    case "pending":
      return ["admit", "reject"];
    case "admitted":
      return ["revoke"];
    case "rejected":
    case "revoked":
    case "withdrawn":
      return ["reconsider"];
    default:
      return [];
  }
}

export type VendorEventApplicationRow = {
  application_id: string;
  vendor_id: string;
  vendor_business_name: string;
  vendor_is_active: boolean;
  event_id: string;
  candidacy_status: CandidacyStatus;
  current_participation_state: AdmissionState | null;
  event_vendor_id: string | null;
  submitted_at: string;
  submitted_by_admin_user_id: string | null;
  latest_disposition_id: string | null;
  latest_decision_type: "admitted" | "rejected" | "revoked" | null;
  latest_reason_code: string | null;
  latest_reason_classification: ReasonClassification | null;
  latest_occurred_at: string | null;
};

export type VendorEventDispositionRow = {
  disposition_id: string;
  vendor_id: string;
  application_id: string | null;
  event_id: string;
  decision_type: "admitted" | "rejected" | "revoked";
  reason_code: string | null;
  reason_classification: ReasonClassification | null;
  reason_text: string | null;
  actor_auth_user_id: string | null;
  actor_admin_user_id: string | null;
  authority_basis: "platform" | "tenant" | "event_grant" | "backfill";
  backfill_note: string | null;
  occurred_at: string;
};

export type VendorIntelligenceSummary = {
  vendor_id: string;
  has_quality_concerns: boolean;
  quality_concern_count: number;
  most_recent_quality_concern_at: string | null;
  distinct_events_with_concern_count: number;
  distinct_tenants_with_concern_count: number;
};

export type EventVendorMetadataUpdate = Partial<{
  is_featured: boolean;
  is_visible_to_members: boolean;
  action_type: "service_request" | "external_signup" | "info_only";
  signup_url: string | null;
  display_order: number;
  event_note: string | null;
  booth_location: string | null;
  show_on_member_dashboard: boolean;
  allow_service_requests: boolean;
  notes: string | null;
}>;

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (result.data === null) {
    throw new Error("The governed operation returned no result.");
  }
  return result.data;
}

/** Reference data -- classification labels, not a decision. Safe to read directly (RLS: authenticated, USING (true)). */
export async function listVendorDispositionReasonCodes(): Promise<VendorDispositionReasonCode[]> {
  const { data, error } = await supabase
    .from("vendor_disposition_reason_codes")
    .select("code,classification,label,is_active")
    .eq("is_active", true)
    .order("classification", { ascending: true })
    .order("label", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }
  return (data || []) as VendorDispositionReasonCode[];
}

export async function registerVendorEventCandidacy(vendorId: string, eventId: string) {
  const result = await supabase.rpc("register_vendor_event_candidacy", {
    p_vendor_id: vendorId,
    p_event_id: eventId,
  });
  return unwrap(result as any);
}

export async function admitVendorForEvent(vendorId: string, eventId: string) {
  const result = await supabase.rpc("admit_vendor_for_event", {
    p_vendor_id: vendorId,
    p_event_id: eventId,
  });
  return unwrap(result as any);
}

export async function rejectVendorEventCandidacy(
  vendorId: string,
  eventId: string,
  reasonCode: string,
  reasonText: string | null,
) {
  const result = await supabase.rpc("reject_vendor_event_candidacy", {
    p_vendor_id: vendorId,
    p_event_id: eventId,
    p_reason_code: reasonCode,
    p_reason_text: reasonText,
  });
  return unwrap(result as any);
}

export async function revokeVendorAdmission(
  vendorId: string,
  eventId: string,
  reasonCode: string,
  reasonText: string | null,
) {
  const result = await supabase.rpc("revoke_vendor_admission", {
    p_vendor_id: vendorId,
    p_event_id: eventId,
    p_reason_code: reasonCode,
    p_reason_text: reasonText,
  });
  return unwrap(result as any);
}

export async function listVendorEventApplications(eventId: string): Promise<VendorEventApplicationRow[]> {
  const { data, error } = await supabase.rpc("list_vendor_event_applications", {
    p_event_id: eventId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return (data || []) as VendorEventApplicationRow[];
}

export async function listVendorEventDispositions(
  eventId: string,
  vendorId?: string,
): Promise<VendorEventDispositionRow[]> {
  const { data, error } = await supabase.rpc("list_vendor_event_dispositions", {
    p_event_id: eventId,
    p_vendor_id: vendorId ?? null,
  });
  if (error) {
    throw new Error(error.message);
  }
  return (data || []) as VendorEventDispositionRow[];
}

export async function getVendorIntelligenceSummary(
  vendorId: string,
  eventId: string,
): Promise<VendorIntelligenceSummary> {
  const { data, error } = await supabase.rpc("get_vendor_intelligence_summary", {
    p_vendor_id: vendorId,
    p_event_id: eventId,
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error("The intelligence summary returned no result.");
  }
  return row as VendorIntelligenceSummary;
}

export async function updateEventVendorMetadata(
  vendorId: string,
  eventId: string,
  updates: EventVendorMetadataUpdate,
) {
  const result = await supabase.rpc("update_event_vendor_metadata", {
    p_vendor_id: vendorId,
    p_event_id: eventId,
    p_updates: updates,
  });
  return unwrap(result as any);
}

export const REASON_CLASSIFICATION_LABELS: Record<ReasonClassification, string> = {
  operational_capacity: "Operational / capacity",
  performance_quality: "Performance / quality",
  administrative_other: "Administrative / other",
};

export const REASON_CLASSIFICATION_COLORS: Record<
  ReasonClassification,
  { background: string; border: string; text: string }
> = {
  operational_capacity: { background: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" },
  performance_quality: { background: "#fef2f2", border: "#fecaca", text: "#b91c1c" },
  administrative_other: { background: "#f8fafc", border: "#e2e8f0", text: "#475569" },
};
