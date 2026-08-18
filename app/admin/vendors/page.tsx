"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import VendorDispositionHistory from "@/components/admin/VendorDispositionHistory";
import VendorEventDecisionModal from "@/components/admin/VendorEventDecisionModal";
import VendorIntelligenceBadge from "@/components/admin/VendorIntelligenceBadge";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
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

const dashboardLinkStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 54,
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid #d1d5db",
  background: "#f8fafc",
  color: "#0f172a",
  fontWeight: 800,
  textDecoration: "none",
  textAlign: "center",
  transition: "all 0.2s ease",
};

export const STATUS_LABELS: Record<VendorEventDisplayStatus, string> = {
  not_considered: "Not yet considered",
  pending: "Pending review",
  admitted: "Admitted -- currently participating",
  rejected: "Rejected for this Event",
  withdrawn: "Withdrawn by vendor",
  revoked: "Admitted historically -- revoked, not currently participating",
};

export const STATUS_COLORS: Record<VendorEventDisplayStatus, { background: string; border: string; text: string }> = {
  not_considered: { background: "#f8fafc", border: "#e2e8f0", text: "#64748b" },
  pending: { background: "#fffbeb", border: "#fde68a", text: "#92400e" },
  admitted: { background: "#f0fdf4", border: "#bbf7d0", text: "#166534" },
  rejected: { background: "#fef2f2", border: "#fecaca", text: "#b91c1c" },
  withdrawn: { background: "#f8fafc", border: "#e2e8f0", text: "#64748b" },
  revoked: { background: "#fff7ed", border: "#fed7aa", text: "#9a3412" },
};

export function StatusBadge({ status }: { status: VendorEventDisplayStatus }) {
  const colors = STATUS_COLORS[status];
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 12,
        fontWeight: 800,
        color: colors.text,
        background: colors.background,
        border: `1px solid ${colors.border}`,
        borderRadius: 999,
        padding: "3px 10px",
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

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
      setError(err?.message || "Could not load vendors.");
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
      setError(err?.message || "Could not upload vendor logo.");
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
      setError(err?.message || "Could not save vendor.");
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
      setError(err?.message || "Could not register this vendor as a candidate.");
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
      setError(err?.message || "Could not admit this vendor.");
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
      setError(err?.message || `Could not ${mode} this vendor.`);
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
      setError(err?.message || "Could not update event vendor settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 18, minWidth: 0 }}>
      <div role="status" style={{ fontSize: 13 }}>
        {status}
      </div>
      {error ? (
        <div
          role="alert"
          style={{
            padding: 10,
            borderRadius: 8,
            border: "1px solid #e2b4b4",
            background: "#fff3f3",
            color: "#8a1f1f",
            minWidth: 0,
            overflowWrap: "anywhere",
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        className="card"
        style={{
          padding: 18,
          display: "grid",
          gap: 12,
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Vendor Dashboard</h2>
          <span
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: "#0f172a",
              background: "#f1f5f9",
              border: "1px solid #e2e8f0",
              borderRadius: 999,
              padding: "4px 12px",
            }}
          >
            Event: {adminEvent?.name || "None selected"}
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
            gap: 12,
            minWidth: 0,
          }}
        >
          <a href="/admin/vendors" style={dashboardLinkStyle}>
            Manage Vendors
          </a>

          <a href="/admin/vendor-requests" style={dashboardLinkStyle}>
            Vendor Requests
          </a>

          <a href="/admin/vendors/access" style={dashboardLinkStyle}>
            Vendor User Access
          </a>

          <a href="/admin/nearby" style={dashboardLinkStyle}>
            Nearby Services
          </a>

          <a href="/admin/events" style={dashboardLinkStyle}>
            Event Setup
          </a>

          <a href="/admin/dashboard" style={dashboardLinkStyle}>
            Admin Dashboard
          </a>
        </div>
      </div>

      {adminEvent?.id && pendingApplications.length > 0 ? (
        <div className="card" style={{ padding: 18, minWidth: 0 }}>
          <h2 style={{ marginTop: 0 }}>
            Applications Awaiting Review -- {adminEvent.name}
          </h2>
          <div style={{ display: "grid", gap: 10 }}>
            {pendingApplications.map((app) => {
              const vendor = vendors.find((v) => v.id === app.vendor_id);
              if (!vendor) {return null;}
              return (
                <div
                  key={app.application_id}
                  style={{
                    border: "1px solid #fde68a",
                    background: "#fffbeb",
                    borderRadius: 10,
                    padding: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800 }}>{vendor.business_name}</div>
                    <div style={{ fontSize: 12, color: "#92400e" }}>
                      Submitted {new Date(app.submitted_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={() => void admit(vendor)} disabled={saving}>
                      Admit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDecisionModal({ mode: "reject", vendor })}
                      disabled={saving}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(360px, 100%), 1fr))",
          gap: 18,
          minWidth: 0,
        }}
      >
        <div className="card" style={{ padding: 18, minWidth: 0 }}>
          <h2 style={{ marginTop: 0 }}>
            {form.id ? "Edit Vendor" : "Add Vendor"}
          </h2>

          <div style={{ display: "grid", gap: 10 }}>
            <input
              value={form.business_name}
              onChange={(e) =>
                setForm((p) => ({ ...p, business_name: e.target.value }))
              }
              placeholder="Business name"
              style={{ padding: 10 }}
            />

            <input
              value={form.contact_name}
              onChange={(e) =>
                setForm((p) => ({ ...p, contact_name: e.target.value }))
              }
              placeholder="Contact person"
              style={{ padding: 10 }}
            />

            <input
              value={form.email}
              onChange={(e) =>
                setForm((p) => ({ ...p, email: e.target.value }))
              }
              placeholder="Email"
              style={{ padding: 10 }}
            />

            <input
              value={form.phone}
              onChange={(e) =>
                setForm((p) => ({ ...p, phone: e.target.value }))
              }
              placeholder="Phone / text number"
              style={{ padding: 10 }}
            />

            <input
              value={form.website}
              onChange={(e) =>
                setForm((p) => ({ ...p, website: e.target.value }))
              }
              placeholder="Website"
              style={{ padding: 10 }}
            />

            <label
              style={{
                display: "grid",
                gap: 8,
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                padding: 10,
                background: "#fafafa",
              }}
            >
              <div style={{ fontWeight: 700 }}>Vendor Logo</div>

              {form.logo_url ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <img
                    src={form.logo_url}
                    alt="Vendor logo preview"
                    style={{
                      maxWidth: 220,
                      maxHeight: 90,
                      objectFit: "contain",
                      border: "1px solid #ddd",
                      borderRadius: 8,
                      padding: 8,
                      background: "white",
                    }}
                  />

                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, logo_url: "" }))}
                    disabled={saving}
                  >
                    Remove Logo
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "#666" }}>
                  Upload a JPEG or PNG logo for this vendor.
                </div>
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
            </label>

            <textarea
              value={form.business_description}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  business_description: e.target.value,
                }))
              }
              placeholder="Business description"
              rows={5}
              style={{ padding: 10 }}
            />

            <label>
              Preferred contact method
              <select
                value={form.preferred_contact_method}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    preferred_contact_method: e.target.value,
                  }))
                }
                style={{ padding: 10, display: "block", width: "100%" }}
              >
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="text">Text</option>
                <option value="in_app">In-app request</option>
              </select>
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) =>
                  setForm((p) => ({ ...p, is_active: e.target.checked }))
                }
              />
              Vendor is active
            </label>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={saveVendor} disabled={saving}>
                {saving ? "Saving..." : "Save Vendor"}
              </button>

              <button type="button" onClick={startNew}>
                New Vendor
              </button>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 18, minWidth: 0 }}>
          <h2 style={{ marginTop: 0 }}>
            Vendor Catalog {adminEvent?.name ? `-- consider for ${adminEvent.name}` : ""}
          </h2>
          <p style={{ marginTop: -6, fontSize: 13, color: "#64748b" }}>
            Every vendor here is a known EpicentraX catalog vendor. Considering or admitting a
            vendor for this Event never creates a duplicate vendor record and never affects any
            other Event.
          </p>

          <div style={{ display: "grid", gap: 10 }}>
            {vendors.map((vendor) => {
              const eventVendor = eventVendorByVendorId.get(vendor.id);
              const application = applicationByVendorId.get(vendor.id);
              const displayStatus = deriveVendorEventDisplayStatus(
                application?.candidacy_status ?? null,
                application?.current_participation_state ?? null,
              );
              const isExpanded = expandedVendorId === vendor.id;
              const intel = intelligenceByVendorId[vendor.id] || null;
              const dispositions = dispositionsByVendorId[vendor.id] || [];

              return (
                <div
                  key={vendor.id}
                  style={{
                    border:
                      selectedVendorId === vendor.id
                        ? "2px solid #2563eb"
                        : "1px solid #ddd",
                    borderRadius: 10,
                    padding: 12,
                    background: displayStatus === "admitted" ? "#f0fdf4" : "white",
                    minWidth: 0,
                    overflowWrap: "anywhere",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      minWidth: 0,
                      flexWrap: "wrap",
                    }}
                  >
                    {vendor.logo_url ? (
                      <img
                        src={vendor.logo_url}
                        alt={`${vendor.business_name} logo`}
                        style={{
                          width: 72,
                          height: 48,
                          objectFit: "contain",
                          border: "1px solid #ddd",
                          borderRadius: 8,
                          padding: 6,
                          background: "white",
                          flexShrink: 0,
                        }}
                      />
                    ) : null}

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 800 }}>
                        {vendor.business_name}
                      </div>
                      <div
                        style={{ fontSize: 13, color: "#555", marginTop: 4 }}
                      >
                        {vendor.contact_name || "No contact"} •{" "}
                        {vendor.preferred_contact_method || "email"}
                      </div>
                    </div>

                    {adminEvent?.id ? <StatusBadge status={displayStatus} /> : null}
                  </div>

                  {vendor.business_description ? (
                    <div style={{ fontSize: 13, marginTop: 6 }}>
                      {vendor.business_description}
                    </div>
                  ) : null}

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      marginTop: 10,
                    }}
                  >
                    <button type="button" onClick={() => startEdit(vendor)}>
                      Edit Catalog Info
                    </button>

                    {adminEvent?.id ? (
                      <button type="button" onClick={() => toggleReview(vendor.id)}>
                        {isExpanded ? "Hide Review" : "Review for this Event"}
                      </button>
                    ) : null}

                    {adminEvent?.id
                      ? getAvailableVendorEventActions(displayStatus).map((action) => {
                          switch (action) {
                            case "consider":
                              return (
                                <button
                                  key="consider"
                                  type="button"
                                  onClick={() => void considerForEvent(vendor)}
                                  disabled={saving}
                                >
                                  Consider for Event
                                </button>
                              );
                            case "admit":
                              return (
                                <button
                                  key="admit"
                                  type="button"
                                  onClick={() => void admit(vendor)}
                                  disabled={saving}
                                >
                                  {displayStatus === "not_considered" ? "Admit Directly" : "Admit"}
                                </button>
                              );
                            case "reject":
                              return (
                                <button
                                  key="reject"
                                  type="button"
                                  onClick={() => setDecisionModal({ mode: "reject", vendor })}
                                  disabled={saving}
                                >
                                  Reject
                                </button>
                              );
                            case "revoke":
                              return (
                                <button
                                  key="revoke"
                                  type="button"
                                  onClick={() => setDecisionModal({ mode: "revoke", vendor })}
                                  disabled={saving}
                                >
                                  Revoke Admission
                                </button>
                              );
                            case "reconsider":
                              return (
                                <button
                                  key="reconsider"
                                  type="button"
                                  onClick={() => void admit(vendor)}
                                  disabled={saving}
                                >
                                  {displayStatus === "revoked" ? "Re-Admit" : "Admit Anyway"}
                                </button>
                              );
                            default:
                              return null;
                          }
                        })
                      : null}
                  </div>

                  {isExpanded ? (
                    <div
                      style={{
                        marginTop: 12,
                        padding: 12,
                        borderRadius: 8,
                        background: "#fafafa",
                        border: "1px solid #eee",
                        display: "grid",
                        gap: 14,
                      }}
                    >
                      <VendorIntelligenceBadge summary={intel} loading={loadingReview && !intel} />

                      {eventVendor ? (
                        <div style={{ display: "grid", gap: 8 }}>
                          <div style={{ fontWeight: 800, fontSize: 13 }}>
                            Event Presentation Settings
                          </div>
                          <label style={{ display: "flex", gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={!!eventVendor.is_featured}
                              onChange={(e) =>
                                void updateEventVendor(eventVendor, {
                                  is_featured: e.target.checked,
                                })
                              }
                            />
                            Featured on dashboard slideshow
                          </label>

                          <label style={{ display: "flex", gap: 8 }}>
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

                          <label>
                            <div style={{ fontWeight: 700, marginBottom: 4 }}>
                              Member action
                            </div>
                            <select
                              value={eventVendor.action_type || "service_request"}
                              onChange={(e) =>
                                void updateEventVendor(eventVendor, {
                                  action_type: e.target
                                    .value as EventVendorMetadataUpdate["action_type"],
                                })
                              }
                              style={{ padding: 8, width: "100%" }}
                            >
                              <option value="service_request">
                                Request Service in app
                              </option>
                              <option value="external_signup">
                                Use signup/contact link
                              </option>
                              <option value="info_only">Info only</option>
                            </select>
                          </label>

                          <input
                            defaultValue={eventVendor.signup_url || ""}
                            placeholder="Event signup/contact URL"
                            onBlur={(e) =>
                              void updateEventVendor(eventVendor, {
                                signup_url: e.target.value.trim() || null,
                              })
                            }
                            style={{ padding: 8 }}
                          />

                          <input
                            defaultValue={String(eventVendor.display_order ?? 100)}
                            placeholder="Display order"
                            onBlur={(e) =>
                              void updateEventVendor(eventVendor, {
                                display_order: Number(e.target.value) || 100,
                              })
                            }
                            style={{ padding: 8 }}
                          />

                          <textarea
                            defaultValue={eventVendor.event_note || ""}
                            placeholder="Event-specific vendor note"
                            rows={3}
                            onBlur={(e) =>
                              void updateEventVendor(eventVendor, {
                                event_note: e.target.value.trim() || null,
                              })
                            }
                            style={{ padding: 8 }}
                          />
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: "#94a3b8" }}>
                          Presentation settings become available once this vendor is admitted.
                        </div>
                      )}

                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontWeight: 800, fontSize: 13 }}>
                          History for {adminEvent?.name}
                        </div>
                        <VendorDispositionHistory
                          dispositions={dispositions}
                          loading={loadingReview && dispositions.length === 0}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {vendors.length === 0 ? (
              <div style={{ opacity: 0.7 }}>No vendors yet.</div>
            ) : null}
          </div>
        </div>
      </div>

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
