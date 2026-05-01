"use client";

import { useEffect, useMemo, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { getAdminEvent } from "@/lib/getAdminEvent";
import {
  canAccessEvent,
  getCurrentAdminAccess,
} from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

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

function AdminVendorsPageInner() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [eventVendors, setEventVendors] = useState<EventVendor[]>([]);
  const [form, setForm] = useState<VendorForm>(emptyVendor);
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [status, setStatus] = useState("Loading vendors...");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const adminEvent = getAdminEvent();

  async function loadPage() {
    try {
      setStatus("Loading vendors...");
      setError(null);

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setError("No admin access.");
        setStatus("Access denied.");
        return;
      }

      if (adminEvent?.id && !canAccessEvent(admin, adminEvent.id)) {
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        return;
      }

      const [{ data: vendorData, error: vendorError }, eventVendorResult] =
        await Promise.all([
          supabase
            .from("vendors")
            .select("*")
            .order("business_name", { ascending: true }),

          adminEvent?.id
            ? supabase
                .from("event_vendors")
                .select("*")
                .eq("event_id", adminEvent.id)
            : Promise.resolve({ data: [], error: null }),
        ]);

      if (vendorError) {
        throw vendorError;
      }
      if (eventVendorResult.error) {
        throw eventVendorResult.error;
      }

      setVendors((vendorData || []) as Vendor[]);
      setEventVendors((eventVendorResult.data || []) as EventVendor[]);
      setStatus(
        `Loaded ${(vendorData || []).length} vendors for ${
          adminEvent?.name || "current event"
        }.`,
      );
    } catch (err: any) {
      console.error("load vendors error:", err);
      setError(err?.message || "Could not load vendors.");
      setStatus("Could not load vendors.");
    }
  }

  useEffect(() => {
    void loadPage();
  }, []);

  const selectedVendor = useMemo(
    () => vendors.find((v) => v.id === selectedVendorId) || null,
    [vendors, selectedVendorId],
  );

  const eventVendorByVendorId = useMemo(() => {
    const map = new Map<string, EventVendor>();
    eventVendors.forEach((row) => map.set(row.vendor_id, row));
    return map;
  }, [eventVendors]);

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

  async function toggleEventVendor(vendor: Vendor) {
    if (!adminEvent?.id) {
      setError("Select an admin event first.");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const existing = eventVendorByVendorId.get(vendor.id);

      if (existing) {
        const { error } = await supabase
          .from("event_vendors")
          .delete()
          .eq("id", existing.id);

        if (error) {
          throw error;
        }
        setStatus(`${vendor.business_name} removed from this event.`);
      } else {
        const { error } = await supabase.from("event_vendors").insert({
          event_id: adminEvent.id,
          vendor_id: vendor.id,
          is_featured: false,
          display_order: 100,
          signup_url: null,
          event_note: null,
          is_visible_to_members: true,
        });

        if (error) {
          throw error;
        }
        setStatus(`${vendor.business_name} assigned to this event.`);
      }

      await loadPage();
    } catch (err: any) {
      console.error("toggle event vendor error:", err);
      setError(err?.message || "Could not update event vendor.");
    } finally {
      setSaving(false);
    }
  }

  async function updateEventVendor(
    row: EventVendor,
    patch: Partial<EventVendor>,
  ) {
    try {
      setSaving(true);
      setError(null);

      const { error } = await supabase
        .from("event_vendors")
        .update(patch)
        .eq("id", row.id);

      if (error) {
        throw error;
      }

      setStatus("Event vendor settings updated.");
      await loadPage();
    } catch (err: any) {
      console.error("update event vendor error:", err);
      setError(err?.message || "Could not update event vendor settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 24, display: "grid", gap: 18 }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0 }}>Vendor Manager</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          Current event: {adminEvent?.name || "No event selected"}
        </div>
        <div style={{ marginTop: 8, fontSize: 13 }}>{status}</div>
        {error ? (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 8,
              border: "1px solid #e2b4b4",
              background: "#fff3f3",
              color: "#8a1f1f",
            }}
          >
            {error}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(360px, 100%), 1fr))",
          gap: 18,
        }}
      >
        <div className="card" style={{ padding: 18 }}>
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

            <input
              value={form.logo_url}
              onChange={(e) =>
                setForm((p) => ({ ...p, logo_url: e.target.value }))
              }
              placeholder="Logo URL"
              style={{ padding: 10 }}
            />

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

        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ marginTop: 0 }}>Vendors</h2>

          <div style={{ display: "grid", gap: 10 }}>
            {vendors.map((vendor) => {
              const eventVendor = eventVendorByVendorId.get(vendor.id);
              const assigned = !!eventVendor;

              return (
                <div
                  key={vendor.id}
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 10,
                    padding: 12,
                    background: assigned ? "#f0fdf4" : "white",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{vendor.business_name}</div>
                  <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
                    {vendor.contact_name || "No contact"} •{" "}
                    {vendor.preferred_contact_method || "email"}
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
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => void toggleEventVendor(vendor)}
                      disabled={saving}
                    >
                      {assigned ? "Remove from Event" : "Add to Event"}
                    </button>
                  </div>

                  {eventVendor ? (
                    <div
                      style={{
                        marginTop: 12,
                        padding: 10,
                        borderRadius: 8,
                        background: "#fafafa",
                        border: "1px solid #eee",
                        display: "grid",
                        gap: 8,
                      }}
                    >
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
    </div>
  );
}

export default function AdminVendorsPage() {
  return (
    <AdminRouteGuard>
      <AdminVendorsPageInner />
    </AdminRouteGuard>
  );
}
