"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import VendorDispositionHistory from "@/components/admin/VendorDispositionHistory";
import VendorEventDecisionModal from "@/components/admin/VendorEventDecisionModal";
import VendorIntelligenceBadge from "@/components/admin/VendorIntelligenceBadge";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
import { Alert, type AlertTone } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { DataTable, ResponsiveList } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { RowActions } from "@/components/ui/RowActions";
import {
  StatusBadge as SharedStatusBadge,
  type StatusBadgeTone,
} from "@/components/ui/StatusBadge";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { canAccessEvent } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";
import {
  admitVendorForEvent,
  deriveVendorEventDisplayStatus,
  type EventVendorMetadataUpdate,
  getAvailableVendorEventActions,
  getVendorIntelligenceSummary,
  listVendorEventApplications,
  listVendorEventDispositions,
  registerVendorEventCandidacy,
  rejectVendorEventCandidacy,
  revokeVendorAdmission,
  updateEventVendorMetadata,
  type VendorEventApplicationRow,
  type VendorEventDisplayStatus,
  type VendorEventDispositionRow,
  type VendorIntelligenceSummary,
} from "@/lib/vendorEventLifecycle";

type Vendor = {
  id: string;
  business_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  logo_url: string | null;
  business_description: string | null;
  preferred_contact_method: string | null;
  is_active: boolean | null;
};

type EventVendor = {
  id: string;
  event_id: string;
  vendor_id: string;
  is_featured: boolean | null;
  display_order: number | null;
  signup_url: string | null;
  event_note: string | null;
  is_visible_to_members: boolean | null;
  action_type: "service_request" | "external_signup" | "info_only" | null;
};

type VendorForm = {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone: string;
  website: string;
  logo_url: string;
  business_description: string;
  preferred_contact_method: string;
  is_active: boolean;
};

const emptyVendor: VendorForm = {
  id: "",
  business_name: "",
  contact_name: "",
  email: "",
  phone: "",
  website: "",
  logo_url: "",
  business_description: "",
  preferred_contact_method: "email",
  is_active: true,
};

export const STATUS_LABELS: Record<VendorEventDisplayStatus, string> = {
  not_considered: "Not yet considered",
  pending: "Pending review",
  admitted: "Admitted -- currently participating",
  rejected: "Rejected for this Event",
  withdrawn: "Withdrawn by vendor",
  revoked: "Admitted historically -- revoked, not currently participating",
};

// UI Phase 3: tone only (no more page-local hex triples) -- rendering
// itself now goes through the shared StatusBadge (components/ui/
// StatusBadge.tsx). "pending" and "revoked" intentionally share one tone:
// they were already visually near-identical amber/orange in the prior
// hand-rolled colors below, and the label text -- not the color -- has
// always been the actual distinguisher (STATUS_LABELS above), consistent
// with Part 7/10's "status text independent of color" requirement.
//   pending:  #fffbeb / #fde68a / #92400e
//   revoked:  #fff7ed / #fed7aa / #9a3412
const STATUS_TONE: Record<VendorEventDisplayStatus, StatusBadgeTone> = {
  not_considered: "neutral",
  pending: "warning",
  admitted: "success",
  rejected: "danger",
  withdrawn: "neutral",
  revoked: "warning",
};

// Kept as the exact same exported name/signature the existing tests
// (page.test.tsx) already import and assert against -- only its internal
// rendering changed, from an inline hex-styled <span> to the shared,
// token-driven StatusBadge primitive.
export function StatusBadge({ status }: { status: VendorEventDisplayStatus }) {
  return (
    <SharedStatusBadge tone={STATUS_TONE[status]}>
      {STATUS_LABELS[status]}
    </SharedStatusBadge>
  );
}

// Vendor Catalog identity's own is_active flag -- a distinct concept from
// VendorEventDisplayStatus above (Part 2: catalog identity vs. Event
// governance/lifecycle must not collapse into one badge).
export function catalogStatusTone(isActive: boolean | null): StatusBadgeTone {
  return isActive === false ? "neutral" : "success";
}

// Pure, presentation-only classification of the page's own existing
// `status`/`error` confirmation text into an Alert tone -- never a second
// source of the message itself (every setStatus/setError call site below
// is unchanged).
export function vendorPageStatusTone(message: string): AlertTone {
  const lower = message.toLowerCase();
  if (
    lower.includes("failed") ||
    lower.includes("denied") ||
    lower.startsWith("could not") ||
    lower.startsWith("we couldn't")
  ) {
    return "danger";
  }
  if (lower.includes("unavailable")) {
    return "warning";
  }
  if (lower.endsWith("...")) {
    return "info";
  }
  return "success";
}

const fieldLabelStyle: React.CSSProperties = {
  display: "block",
  fontWeight: 600,
  marginBottom: "var(--space-2)",
  fontSize: "var(--font-size-body)",
  color: "var(--color-text-secondary)",
};

const optionalTagStyle: React.CSSProperties = {
  fontWeight: 400,
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-muted)",
};

function AdminVendorsPageInner() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [eventVendors, setEventVendors] = useState<EventVendor[]>([]);
  const [applications, setApplications] = useState<VendorEventApplicationRow[]>([]);
  const [form, setForm] = useState<VendorForm>(emptyVendor);
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [status, setStatus] = useState("Loading vendors...");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [expandedVendorId, setExpandedVendorId] = useState<string | null>(null);
  const [intelligenceByVendorId, setIntelligenceByVendorId] = useState<
    Record<string, VendorIntelligenceSummary>
  >({});
  const [dispositionsByVendorId, setDispositionsByVendorId] = useState<
    Record<string, VendorEventDispositionRow[]>
  >({});
  const [loadingReview, setLoadingReview] = useState(false);
  const [decisionModal, setDecisionModal] = useState<{
    mode: "reject" | "revoke";
    vendor: Vendor;
  } | null>(null);
  const loadGenerationRef = useRef(0);
  const reviewGenerationRef = useRef(0);

  // Canonical Admin working-Event context (lib/adminEventContext.ts via
  // lib/adminWorkspaceContext.tsx's re-export) -- the same mechanism
  // every other governed Admin page uses. Never reimplemented here.
  const adminEvent = getCurrentAdminEvent();
  const { admin } = useAdmin();
  // Shell's own canonical compact-state signal (UI Phase 2/3) -- decides
  // desktop table vs. narrow-viewport list below, replacing what would
  // otherwise be a page-local resize listener.
  const { isCompact } = useShellInterfaceCapabilities();

  const loadPage = useCallback(async () => {
    // Resolve context when this load begins. The workspace listener must not
    // retain the Event from the render in which it was first registered.
    const scopedEvent = getCurrentAdminEvent();
    const generation = ++loadGenerationRef.current;
    ++reviewGenerationRef.current;
    const isCurrentLoad = () =>
      generation === loadGenerationRef.current &&
      getCurrentAdminEvent()?.id === scopedEvent?.id;

    try {
      setStatus("Loading vendors...");
      setError(null);
      // Do not leave prior Event assignments or applications actionable
      // while the new Event's governed reads are in flight.
      setEventVendors([]);
      setApplications([]);
      setExpandedVendorId(null);
      setIntelligenceByVendorId({});
      setDispositionsByVendorId({});
      setDecisionModal(null);

      if (!admin) {
        if (!isCurrentLoad()) {return;}
        setError("No admin access.");
        setStatus("Access denied.");
        return;
      }

      if (scopedEvent?.id && !canAccessEvent(admin, scopedEvent.id)) {
        if (!isCurrentLoad()) {return;}
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        return;
      }

      const [{ data: vendorData, error: vendorError }, eventVendorResult, applicationResult] =
        await Promise.all([
          supabase
            .from("vendors")
            .select("*")
            .order("business_name", { ascending: true }),

          scopedEvent?.id
            ? supabase
                .from("event_vendors")
                .select("*")
                .eq("event_id", scopedEvent.id)
            : Promise.resolve({ data: [], error: null }),

          scopedEvent?.id
            ? listVendorEventApplications(scopedEvent.id)
                .then((rows) => ({ rows, error: null as unknown }))
                .catch((error: unknown) => ({
                  rows: [] as VendorEventApplicationRow[],
                  error,
                }))
            : Promise.resolve({
                rows: [] as VendorEventApplicationRow[],
                error: null as unknown,
              }),
        ]);

      if (vendorError) {
        throw vendorError;
      }
      if (eventVendorResult.error) {
        throw eventVendorResult.error;
      }
      if (!isCurrentLoad()) {return;}

      setVendors((vendorData || []) as Vendor[]);
      setEventVendors((eventVendorResult.data || []) as EventVendor[]);
      setApplications(applicationResult.rows);
      setExpandedVendorId(null);
      setIntelligenceByVendorId({});
      setDispositionsByVendorId({});
      if (applicationResult.error) {
        console.error(
          "list_vendor_event_applications failed:",
          applicationResult.error,
        );
        setError("Vendor applications could not be loaded for this Event.");
        setStatus("Vendor catalog loaded; application review is unavailable.");
        return;
      }
      setStatus(
        `Loaded ${(vendorData || []).length} vendors for ${
          scopedEvent?.name || "current event"
        }.`,
      );
    } catch (err: any) {
      if (!isCurrentLoad()) {return;}
      console.error("load vendors error:", err);
      setError("We couldn't load vendors. Please try again.");
      setStatus("Could not load vendors.");
    }
  }, [admin]);

  useEffect(() => {
    if (!admin) {return;}

    void loadPage();

    const unsubscribe = subscribeToAdminWorkspace(() => {
      void loadPage();
    });

    return unsubscribe;
  }, [admin, loadPage]);

  const eventVendorByVendorId = useMemo(() => {
    const map = new Map<string, EventVendor>();
    eventVendors.forEach((row) => map.set(row.vendor_id, row));
    return map;
  }, [eventVendors]);

  const applicationByVendorId = useMemo(() => {
    const map = new Map<string, VendorEventApplicationRow>();
    applications.forEach((row) => map.set(row.vendor_id, row));
    return map;
  }, [applications]);

  const pendingApplications = useMemo(
    () => applications.filter((row) => row.candidacy_status === "pending"),
    [applications],
  );

  function startEdit(vendor: Vendor) {
    setSelectedVendorId(vendor.id);
    setForm({
      id: vendor.id,
      business_name: vendor.business_name || "",
      contact_name: vendor.contact_name || "",
      email: vendor.email || "",
      phone: vendor.phone || "",
      website: vendor.website || "",
      logo_url: vendor.logo_url || "",
      business_description: vendor.business_description || "",
      preferred_contact_method: vendor.preferred_contact_method || "email",
      is_active: vendor.is_active !== false,
    });
    // UI Phase 3: the catalog table now renders above the form (Part 8
    // hierarchy), so an Edit click needs to bring the form into view --
    // the same scroll-on-edit pattern already established in Announcements.
    document
      .getElementById("vendor-catalog-form")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startNew() {
    setSelectedVendorId("");
    setForm(emptyVendor);
  }

  async function uploadVendorLogo(file: File) {
    const isJpeg = file.type === "image/jpeg" || file.type === "image/jpg";
    const isPng = file.type === "image/png";

    if (!isJpeg && !isPng) {
      setError("Logo must be a JPEG or PNG image.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setStatus("Uploading vendor logo...");

      const fileExt = isPng ? "png" : "jpg";
      const safeBusinessName =
        form.business_name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "vendor";
      const filePath = `vendor-logos/${safeBusinessName}-${Date.now()}.${fileExt}`;

      const { data, error: uploadError } = await supabase.storage
        .from("vendor-assets")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: true,
          contentType: file.type,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: publicUrlData } = supabase.storage
        .from("vendor-assets")
        .getPublicUrl(data.path);

      setForm((prev) => ({ ...prev, logo_url: publicUrlData.publicUrl }));
      setStatus("Vendor logo uploaded. Save the vendor to keep this logo.");
    } catch (err: any) {
      console.error("upload vendor logo error:", err);
      setError("We couldn't upload the vendor logo. Please try again.");
      setStatus("Logo upload failed.");
    } finally {
      setSaving(false);
    }
  }

  // Catalog identity CRUD (public.vendors) -- a separate authority
  // question from Event admission (has_vendor_catalog_admin_authority,
  // reconciled in the prior Vendor Catalog Authority stage), unchanged
  // and unrelated to the admission lifecycle below.
  async function saveVendor() {
    if (!form.business_name.trim()) {
      setError("Business name is required.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setStatus("Saving vendor...");

      const payload = {
        name: form.business_name.trim(),
        business_name: form.business_name.trim(),
        contact_name: form.contact_name.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        website: form.website.trim() || null,
        logo_url: form.logo_url.trim() || null,
        business_description: form.business_description.trim() || null,
        preferred_contact_method: form.preferred_contact_method,
        is_active: form.is_active,
      };

      if (form.id) {
        const { error } = await supabase
          .from("vendors")
          .update(payload)
          .eq("id", form.id);

        if (error) {
          throw error;
        }
        setStatus("Vendor updated.");
      } else {
        const { data, error } = await supabase
          .from("vendors")
          .insert(payload)
          .select("*")
          .single();

        if (error) {
          throw error;
        }
        setSelectedVendorId(data.id);
        setForm((prev) => ({ ...prev, id: data.id }));
        setStatus("Vendor created.");
      }

      await loadPage();
    } catch (err: any) {
      console.error("save vendor error:", err);
      setError("We couldn't save this vendor. Please try again.");
      setStatus("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function loadReviewData(vendorId: string) {
    const scopedEvent = getCurrentAdminEvent();
    if (!scopedEvent?.id) {
      return;
    }
    const generation = ++reviewGenerationRef.current;
    setLoadingReview(true);
    try {
      const [intel, dispositions] = await Promise.all([
        getVendorIntelligenceSummary(vendorId, scopedEvent.id).catch((err: any) => {
          console.error("get_vendor_intelligence_summary denied:", err);
          return null;
        }),
        listVendorEventDispositions(scopedEvent.id, vendorId).catch((err: any) => {
          console.error("list_vendor_event_dispositions denied:", err);
          return [] as VendorEventDispositionRow[];
        }),
      ]);

      if (
        generation !== reviewGenerationRef.current ||
        getCurrentAdminEvent()?.id !== scopedEvent.id
      ) {
        return;
      }

      if (intel) {
        setIntelligenceByVendorId((prev) => ({ ...prev, [vendorId]: intel }));
      }
      setDispositionsByVendorId((prev) => ({ ...prev, [vendorId]: dispositions }));
    } finally {
      if (generation === reviewGenerationRef.current) {
        setLoadingReview(false);
      }
    }
  }

  function toggleReview(vendorId: string) {
    const next = expandedVendorId === vendorId ? null : vendorId;
    setExpandedVendorId(next);
    if (next && !dispositionsByVendorId[next]) {
      void loadReviewData(next);
    }
  }

  // --- Governed lifecycle actions. Every one of these is a call to a
  // SECURITY DEFINER RPC gated by has_event_task_authority -- none
  // reimplements admission logic or writes event_vendors directly. RPC
  // denial (e.g. an admin without event.vendors.manage for this Event)
  // surfaces as a plain error message; there is no client-side per-Event
  // authority check to short-circuit it with yet (see report).

  async function considerForEvent(vendor: Vendor) {
    if (!adminEvent?.id) {
      setError("Select an admin event first.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await registerVendorEventCandidacy(vendor.id, adminEvent.id);
      setStatus(`${vendor.business_name} is now a candidate for this Event.`);
      await loadPage();
    } catch (err: any) {
      console.error("register vendor event candidacy error:", err);
      setError("We couldn't register this vendor as a candidate. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function admit(vendor: Vendor) {
    if (!adminEvent?.id) {
      setError("Select an admin event first.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await admitVendorForEvent(vendor.id, adminEvent.id);
      setStatus(`${vendor.business_name} admitted for this Event.`);
      await loadPage();
    } catch (err: any) {
      console.error("admit vendor for event error:", err);
      setError("We couldn't admit this vendor. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDecisionConfirm(reasonCode: string, reasonText: string | null) {
    if (!adminEvent?.id || !decisionModal) {
      return;
    }
    const { mode, vendor } = decisionModal;
    try {
      setSaving(true);
      setError(null);
      if (mode === "reject") {
        await rejectVendorEventCandidacy(vendor.id, adminEvent.id, reasonCode, reasonText);
        setStatus(`${vendor.business_name} rejected for this Event.`);
      } else {
        await revokeVendorAdmission(vendor.id, adminEvent.id, reasonCode, reasonText);
        setStatus(`${vendor.business_name}'s admission to this Event was revoked.`);
      }
      setDecisionModal(null);
      await loadPage();
    } catch (err: any) {
      console.error(`${mode} vendor event error:`, err);
      setError(`We couldn't ${mode} this vendor. Please try again.`);
    } finally {
      setSaving(false);
    }
  }

  // Metadata Governance Bridge: presentation/participation-mode fields
  // only (is_featured/is_visible_to_members/action_type/signup_url/
  // display_order/event_note). Structurally incapable of touching
  // admission-lifecycle state -- kept visually separate below from the
  // lifecycle actions above.
  async function updateEventVendor(
    row: EventVendor,
    patch: EventVendorMetadataUpdate,
  ) {
    if (!adminEvent?.id) {
      setError("Select an admin event first.");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      await updateEventVendorMetadata(row.vendor_id, adminEvent.id, patch);

      setStatus("Event vendor settings updated.");
      await loadPage();
    } catch (err: any) {
      console.error("update event vendor metadata error:", err);
      setError("We couldn't update event vendor settings. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // UI Phase 3: shared between the desktop table's actions cell and the
  // narrow-viewport list card, so both presentations offer identical
  // actions -- one render path, two layouts (Announcements' established
  // pattern). Hierarchy per Part 6: routine (Edit/Review) stays default,
  // admission-positive actions (Admit/Re-Admit) use the success variant,
  // destructive/revocation actions (Reject/Revoke) use the danger variant
  // -- so the consequential ones don't visually compete with the routine
  // ones, and don't blend into them either.
  function renderCatalogActions(vendor: Vendor, displayStatus: VendorEventDisplayStatus) {
    const name = vendor.business_name || "this vendor";
    const isExpanded = expandedVendorId === vendor.id;

    return (
      <RowActions>
        <AppButton onClick={() => startEdit(vendor)} aria-label={`Edit "${name}" catalog details`}>
          Edit
        </AppButton>

        {adminEvent?.id ? (
          <AppButton
            onClick={() => toggleReview(vendor.id)}
            aria-label={`${isExpanded ? "Hide" : "Show"} Event review for "${name}"`}
          >
            {isExpanded ? "Hide Review" : "Review"}
          </AppButton>
        ) : null}

        {adminEvent?.id
          ? getAvailableVendorEventActions(displayStatus).map((action) => {
              switch (action) {
                case "consider":
                  return (
                    <AppButton
                      key="consider"
                      onClick={() => void considerForEvent(vendor)}
                      disabled={saving}
                      aria-label={`Consider "${name}" for this Event`}
                    >
                      Consider
                    </AppButton>
                  );
                case "admit":
                  return (
                    <AppButton
                      key="admit"
                      variant="success"
                      onClick={() => void admit(vendor)}
                      disabled={saving}
                      aria-label={`Admit "${name}" for this Event`}
                    >
                      {displayStatus === "not_considered" ? "Admit Directly" : "Admit"}
                    </AppButton>
                  );
                case "reject":
                  return (
                    <AppButton
                      key="reject"
                      variant="danger"
                      onClick={() => setDecisionModal({ mode: "reject", vendor })}
                      disabled={saving}
                      aria-label={`Reject "${name}" for this Event`}
                    >
                      Reject
                    </AppButton>
                  );
                case "revoke":
                  return (
                    <AppButton
                      key="revoke"
                      variant="danger"
                      onClick={() => setDecisionModal({ mode: "revoke", vendor })}
                      disabled={saving}
                      aria-label={`Revoke "${name}"'s admission to this Event`}
                    >
                      Revoke
                    </AppButton>
                  );
                case "reconsider":
                  return (
                    <AppButton
                      key="reconsider"
                      variant="success"
                      onClick={() => void admit(vendor)}
                      disabled={saving}
                      aria-label={`Re-admit "${name}" for this Event`}
                    >
                      {displayStatus === "revoked" ? "Re-Admit" : "Admit Anyway"}
                    </AppButton>
                  );
                default:
                  return null;
              }
            })
          : null}
      </RowActions>
    );
  }

  const subheadingStyle: React.CSSProperties = {
    fontSize: "var(--font-size-small)",
    fontWeight: "var(--font-weight-semibold)" as unknown as number,
    color: "var(--color-text-secondary)",
  };

  // The expandable "Review for this Event" detail -- Vendor Catalog
  // Governance/lifecycle history plus Event Presentation Metadata (Part
  // 2), kept visually distinct from each other and from the row's own
  // identity/status. Shared between the table's expanded <tr> and the
  // list card so both presentations show identical content. None of the
  // fields, RPC calls, or authority checks here changed -- only spacing/
  // labels moved onto shared tokens.
  function renderVendorReviewPanel(
    vendor: Vendor,
    eventVendor: EventVendor | undefined,
    intel: VendorIntelligenceSummary | null,
    dispositions: VendorEventDispositionRow[],
  ) {
    return (
      <div style={{ display: "grid", gap: "var(--space-5)" }}>
        <VendorIntelligenceBadge summary={intel} loading={loadingReview && !intel} />

        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <div style={subheadingStyle}>Event Presentation Metadata</div>
          {eventVendor ? (
            <div style={{ display: "grid", gap: "var(--space-3)" }}>
              <label style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={!!eventVendor.is_featured}
                  onChange={(e) =>
                    void updateEventVendor(eventVendor, { is_featured: e.target.checked })
                  }
                />
                Featured on dashboard slideshow
              </label>

              <label style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={eventVendor.is_visible_to_members !== false}
                  onChange={(e) =>
                    void updateEventVendor(eventVendor, {
                      is_visible_to_members: e.target.checked,
                    })
                  }
                />
                Visible to members
              </label>

              <div>
                <label style={fieldLabelStyle} htmlFor={`event-vendor-action-${vendor.id}`}>
                  Member action
                </label>
                <select
                  id={`event-vendor-action-${vendor.id}`}
                  value={eventVendor.action_type || "service_request"}
                  onChange={(e) =>
                    void updateEventVendor(eventVendor, {
                      action_type: e.target.value as EventVendorMetadataUpdate["action_type"],
                    })
                  }
                >
                  <option value="service_request">Request Service in app</option>
                  <option value="external_signup">Use signup/contact link</option>
                  <option value="info_only">Info only</option>
                </select>
              </div>

              <div>
                <label style={fieldLabelStyle} htmlFor={`event-vendor-signup-${vendor.id}`}>
                  Event signup/contact URL
                </label>
                <input
                  id={`event-vendor-signup-${vendor.id}`}
                  defaultValue={eventVendor.signup_url || ""}
                  placeholder="https://..."
                  onBlur={(e) =>
                    void updateEventVendor(eventVendor, {
                      signup_url: e.target.value.trim() || null,
                    })
                  }
                />
              </div>

              <div>
                <label style={fieldLabelStyle} htmlFor={`event-vendor-order-${vendor.id}`}>
                  Display order
                </label>
                <input
                  id={`event-vendor-order-${vendor.id}`}
                  defaultValue={String(eventVendor.display_order ?? 100)}
                  onBlur={(e) =>
                    void updateEventVendor(eventVendor, {
                      display_order: Number(e.target.value) || 100,
                    })
                  }
                />
              </div>

              <div>
                <label style={fieldLabelStyle} htmlFor={`event-vendor-note-${vendor.id}`}>
                  Event-specific vendor note
                </label>
                <textarea
                  id={`event-vendor-note-${vendor.id}`}
                  defaultValue={eventVendor.event_note || ""}
                  rows={3}
                  onBlur={(e) =>
                    void updateEventVendor(eventVendor, {
                      event_note: e.target.value.trim() || null,
                    })
                  }
                />
              </div>
            </div>
          ) : (
            <Alert tone="neutral">
              Presentation settings become available once this vendor is admitted.
            </Alert>
          )}
        </div>

        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <div style={subheadingStyle}>History for {adminEvent?.name}</div>
          <VendorDispositionHistory
            dispositions={dispositions}
            loading={loadingReview && dispositions.length === 0}
          />
        </div>
      </div>
    );
  }

  const quickLinksGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
    gap: "var(--space-6)",
    minWidth: 0,
  };

  return (
    <div style={{ display: "grid", gap: "var(--space-10)", minWidth: 0 }}>
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : status ? (
        <Alert tone={vendorPageStatusTone(status)}>{status}</Alert>
      ) : null}

      <section style={{ display: "grid", gap: "var(--space-4)" }}>
        <PageHeader title="Vendor Workspace" headingLevel="h2" titleClassName="app-section-title" />
        <div style={quickLinksGridStyle}>
          <a href="/admin/vendors" className="admin-summary-link">
            <div className="admin-summary-link-title">Manage Vendors</div>
            <div className="admin-summary-link-description">Catalog identity and Event admission.</div>
          </a>
          <a href="/admin/vendor-requests" className="admin-summary-link">
            <div className="admin-summary-link-title">Vendor Requests</div>
            <div className="admin-summary-link-description">Triage member-submitted service requests.</div>
          </a>
          <a href="/admin/vendors/access" className="admin-summary-link">
            <div className="admin-summary-link-title">Vendor User Access</div>
            <div className="admin-summary-link-description">Invite and manage vendor portal logins.</div>
          </a>
          <a href="/admin/nearby" className="admin-summary-link">
            <div className="admin-summary-link-title">Nearby Services</div>
            <div className="admin-summary-link-description">Curate the reusable nearby-places library.</div>
          </a>
          <a href="/admin/events" className="admin-summary-link">
            <div className="admin-summary-link-title">Event Setup</div>
            <div className="admin-summary-link-description">Configure the working Event.</div>
          </a>
          <a href="/admin/dashboard" className="admin-summary-link">
            <div className="admin-summary-link-title">Admin Dashboard</div>
            <div className="admin-summary-link-description">Return to the operational launch point.</div>
          </a>
        </div>
      </section>

      {adminEvent?.id && pendingApplications.length > 0 ? (
        <section style={{ display: "grid", gap: "var(--space-4)" }}>
          <PageHeader
            title="Needs Review"
            titleId="vendors-needs-review-heading"
            headingLevel="h2"
            titleClassName="app-section-title"
            description={`Candidacy applications awaiting a decision for ${adminEvent.name}.`}
            descriptionClassName="app-subtle-text"
          />
          <ResponsiveList aria-labelledby="vendors-needs-review-heading">
            {pendingApplications.map((app) => {
              const vendor = vendors.find((v) => v.id === app.vendor_id);
              if (!vendor) {
                return null;
              }
              return (
                <li key={app.application_id} className="responsive-list-item">
                  <div className="responsive-list-item-header">
                    <div className="responsive-list-item-title">{vendor.business_name}</div>
                    <StatusBadge status="pending" />
                  </div>
                  <div className="responsive-list-item-meta">
                    <span>Submitted {new Date(app.submitted_at).toLocaleDateString()}</span>
                  </div>
                  <RowActions>
                    <AppButton
                      variant="success"
                      onClick={() => void admit(vendor)}
                      disabled={saving}
                      aria-label={`Admit "${vendor.business_name}" for this Event`}
                    >
                      Admit
                    </AppButton>
                    <AppButton
                      variant="danger"
                      onClick={() => setDecisionModal({ mode: "reject", vendor })}
                      disabled={saving}
                      aria-label={`Reject "${vendor.business_name}" for this Event`}
                    >
                      Reject
                    </AppButton>
                  </RowActions>
                </li>
              );
            })}
          </ResponsiveList>
        </section>
      ) : null}

      <section style={{ display: "grid", gap: "var(--space-4)" }}>
        <PageHeader
          title="Vendor Catalog"
          titleId="vendors-catalog-heading"
          headingLevel="h2"
          titleClassName="app-section-title"
          description="Every vendor here is a known EpicentraX catalog vendor. Considering or admitting a vendor for the working Event never creates a duplicate vendor record and never affects any other Event."
          descriptionClassName="app-subtle-text"
        />

        {!adminEvent?.id ? (
          <Alert tone="neutral">
            No Event is selected -- Event relationship and admission actions are unavailable until
            one is. Catalog identity can still be viewed and edited below.
          </Alert>
        ) : null}

        {vendors.length === 0 ? (
          <Alert tone="neutral">No vendors in the catalog yet. Add one below.</Alert>
        ) : isCompact ? (
          <ResponsiveList aria-labelledby="vendors-catalog-heading">
            {vendors.map((vendor) => {
              const eventVendor = eventVendorByVendorId.get(vendor.id);
              const application = applicationByVendorId.get(vendor.id);
              const displayStatus = deriveVendorEventDisplayStatus(
                application?.candidacy_status ?? null,
                application?.current_participation_state ?? null,
              );
              const isExpanded = expandedVendorId === vendor.id;

              return (
                <li
                  key={vendor.id}
                  className={
                    "responsive-list-item" +
                    (displayStatus === "admitted" ? " responsive-list-item-pinned" : "") +
                    (selectedVendorId === vendor.id ? " responsive-list-item-selected" : "")
                  }
                >
                  <div className="responsive-list-item-header">
                    <div className="responsive-list-item-title">{vendor.business_name}</div>
                    <SharedStatusBadge tone={catalogStatusTone(vendor.is_active)}>
                      {vendor.is_active === false ? "Inactive" : "Active"}
                    </SharedStatusBadge>
                  </div>

                  <div className="responsive-list-item-badges">
                    {adminEvent?.id ? (
                      <StatusBadge status={displayStatus} />
                    ) : (
                      <SharedStatusBadge tone="neutral">No Event selected</SharedStatusBadge>
                    )}
                  </div>

                  <div className="responsive-list-item-meta">
                    <span>{vendor.contact_name || "No contact"}</span>
                    <span>{vendor.email || vendor.phone || "No contact info"}</span>
                  </div>

                  {renderCatalogActions(vendor, displayStatus)}

                  {isExpanded
                    ? renderVendorReviewPanel(
                        vendor,
                        eventVendor,
                        intelligenceByVendorId[vendor.id] || null,
                        dispositionsByVendorId[vendor.id] || [],
                      )
                    : null}
                </li>
              );
            })}
          </ResponsiveList>
        ) : (
          <DataTable caption="Vendor catalog with Event relationship and status">
            <thead>
              <tr>
                <th scope="col">Vendor</th>
                <th scope="col">Catalog Status</th>
                <th scope="col">Event Status</th>
                <th scope="col">Contact</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((vendor) => {
                const eventVendor = eventVendorByVendorId.get(vendor.id);
                const application = applicationByVendorId.get(vendor.id);
                const displayStatus = deriveVendorEventDisplayStatus(
                  application?.candidacy_status ?? null,
                  application?.current_participation_state ?? null,
                );
                const isExpanded = expandedVendorId === vendor.id;

                return (
                  <React.Fragment key={vendor.id}>
                    <tr
                      className={
                        [
                          displayStatus === "admitted" ? "data-table-row-pinned" : "",
                          selectedVendorId === vendor.id ? "data-table-row-selected" : "",
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                    >
                      <td>
                        <div className="data-table-cell-primary">
                          {vendor.logo_url ? (
                            <img
                              src={vendor.logo_url}
                              alt=""
                              style={{
                                width: 40,
                                height: 32,
                                objectFit: "contain",
                                borderRadius: "var(--radius-small)",
                                border: "var(--border-width-default) solid var(--color-border-default)",
                                background: "var(--color-bg-elevated)",
                                flexShrink: 0,
                              }}
                            />
                          ) : null}
                          {vendor.business_name}
                        </div>
                      </td>
                      <td>
                        <SharedStatusBadge tone={catalogStatusTone(vendor.is_active)}>
                          {vendor.is_active === false ? "Inactive" : "Active"}
                        </SharedStatusBadge>
                      </td>
                      <td>
                        {adminEvent?.id ? (
                          <StatusBadge status={displayStatus} />
                        ) : (
                          <SharedStatusBadge tone="neutral">No Event selected</SharedStatusBadge>
                        )}
                      </td>
                      <td className="data-table-cell-meta">
                        {vendor.contact_name || "No contact"}
                        {vendor.email ? ` · ${vendor.email}` : vendor.phone ? ` · ${vendor.phone}` : ""}
                      </td>
                      <td>{renderCatalogActions(vendor, displayStatus)}</td>
                    </tr>
                    {isExpanded ? (
                      <tr>
                        <td colSpan={5} style={{ background: "var(--color-bg-muted)" }}>
                          {renderVendorReviewPanel(
                            vendor,
                            eventVendor,
                            intelligenceByVendorId[vendor.id] || null,
                            dispositionsByVendorId[vendor.id] || [],
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </section>

      <section id="vendor-catalog-form" style={{ display: "grid", gap: "var(--space-4)" }}>
        <PageHeader
          title={form.id ? "Edit Vendor" : "Add Vendor"}
          headingLevel="h2"
          titleClassName="app-section-title"
        />

        <PageSection variant="section">
          <div style={{ display: "grid", gap: "var(--space-5)" }}>
            <div>
              <label style={fieldLabelStyle} htmlFor="vendor-business-name">
                Business name
              </label>
              <input
                id="vendor-business-name"
                value={form.business_name}
                onChange={(e) => setForm((p) => ({ ...p, business_name: e.target.value }))}
                placeholder="Business name"
              />
            </div>

            <div>
              <label style={fieldLabelStyle} htmlFor="vendor-contact-name">
                Contact person <span style={optionalTagStyle}>Optional</span>
              </label>
              <input
                id="vendor-contact-name"
                value={form.contact_name}
                onChange={(e) => setForm((p) => ({ ...p, contact_name: e.target.value }))}
                placeholder="Contact person"
              />
            </div>

            <div className="app-form-grid-2">
              <div>
                <label style={fieldLabelStyle} htmlFor="vendor-email">
                  Email <span style={optionalTagStyle}>Optional</span>
                </label>
                <input
                  id="vendor-email"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="Email"
                />
              </div>
              <div>
                <label style={fieldLabelStyle} htmlFor="vendor-phone">
                  Phone / text number <span style={optionalTagStyle}>Optional</span>
                </label>
                <input
                  id="vendor-phone"
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="Phone / text number"
                />
              </div>
            </div>

            <div>
              <label style={fieldLabelStyle} htmlFor="vendor-website">
                Website <span style={optionalTagStyle}>Optional</span>
              </label>
              <input
                id="vendor-website"
                value={form.website}
                onChange={(e) => setForm((p) => ({ ...p, website: e.target.value }))}
                placeholder="Website"
              />
            </div>

            <div>
              <div style={fieldLabelStyle}>
                Vendor logo <span style={optionalTagStyle}>Optional</span>
              </div>
              <div
                style={{
                  display: "grid",
                  gap: "var(--space-3)",
                  border: "var(--border-width-default) solid var(--color-border-default)",
                  borderRadius: "var(--radius-medium)",
                  background: "var(--color-bg-muted)",
                  padding: "var(--space-4)",
                }}
              >
                {form.logo_url ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap" }}>
                    <img
                      src={form.logo_url}
                      alt="Vendor logo preview"
                      style={{
                        maxWidth: 220,
                        maxHeight: 90,
                        objectFit: "contain",
                        border: "var(--border-width-default) solid var(--color-border-default)",
                        borderRadius: "var(--radius-small)",
                        padding: "var(--space-2)",
                        background: "var(--color-bg-elevated)",
                      }}
                    />
                    <AppButton onClick={() => setForm((p) => ({ ...p, logo_url: "" }))} disabled={saving}>
                      Remove Logo
                    </AppButton>
                  </div>
                ) : (
                  <div className="app-subtle-text">Upload a JPEG or PNG logo for this vendor.</div>
                )}

                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void uploadVendorLogo(file);
                    }
                    e.currentTarget.value = "";
                  }}
                  disabled={saving}
                />
              </div>
            </div>

            <div>
              <label style={fieldLabelStyle} htmlFor="vendor-description">
                Business description <span style={optionalTagStyle}>Optional</span>
              </label>
              <textarea
                id="vendor-description"
                value={form.business_description}
                onChange={(e) => setForm((p) => ({ ...p, business_description: e.target.value }))}
                placeholder="Business description"
                rows={5}
              />
            </div>

            <div>
              <label style={fieldLabelStyle} htmlFor="vendor-contact-method">
                Preferred contact method
              </label>
              <select
                id="vendor-contact-method"
                value={form.preferred_contact_method}
                onChange={(e) => setForm((p) => ({ ...p, preferred_contact_method: e.target.value }))}
              >
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="text">Text</option>
                <option value="in_app">In-app request</option>
              </select>
            </div>

            <label style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
              />
              Vendor is active
            </label>

            <div className="app-button-row">
              <AppButton variant="primary" onClick={saveVendor} disabled={saving}>
                {saving ? "Saving..." : "Save Vendor"}
              </AppButton>
              <AppButton onClick={startNew} disabled={saving}>
                New Vendor
              </AppButton>
            </div>
          </div>
        </PageSection>
      </section>

      {decisionModal ? (
        <VendorEventDecisionModal
          open
          mode={decisionModal.mode}
          vendorName={decisionModal.vendor.business_name}
          eventName={adminEvent?.name || "this Event"}
          busy={saving}
          onCancel={() => setDecisionModal(null)}
          onConfirm={handleDecisionConfirm}
        />
      ) : null}
    </div>
  );
}

export default function AdminVendorsPage() {
  return (
    // Page-content access is governed by the canonical Event Task
    // Authority resolver (event.vendors.manage), not the legacy
    // can_manage_vendors permission. Event-admission lifecycle RPCs
    // (register/admit/reject/revoke, update_event_vendor_metadata) already
    // independently enforce event.vendors.manage/view server-side
    // (20260814130000, 20260814150000); Vendor Catalog identity CRUD
    // (public.vendors) is a separate, already-independently-governed
    // authority question (has_vendor_catalog_admin_authority, RLS on
    // vendors_insert_policy/vendors_update_policy/vendors_select_policy,
    // 20260814080000) unaffected by this route guard either way. A denied
    // action here still surfaces as a plain RPC/RLS error rather than a
    // hidden control.
    <AdminRouteGuard requiredTask="event.vendors.manage">
      <AdminShellAdapter pageTitle="Vendor Admin">
        <AdminVendorsPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
