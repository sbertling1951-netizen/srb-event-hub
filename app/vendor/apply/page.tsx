"use client";

import React, { useEffect, useState } from "react";

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
  is_active: false,
};

function AdminVendorsPageInner() {
  const [form, setForm] = useState<VendorForm>(emptyVendor);
  const [status, setStatus] = useState("Complete the form below.");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadPage() {
    setStatus("Ready.");
    setError(null);
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
        name: form.business_name.trim(),
        contact_name: form.contact_name.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        website: form.website.trim() || null,
        logo_url: form.logo_url.trim() || null,
        business_description: form.business_description.trim() || null,
        preferred_contact_method: form.preferred_contact_method,
        is_active: false,
        vendor_portal_enabled: false,
      };

      if (form.id) {
        const { error } = await supabase
          .from("vendors")
          .update(payload)
          .eq("id", form.id);

        if (error) {
          throw error;
        }
        setStatus("Vendor information submitted successfully.");
      } else {
        console.log("Vendor payload:", payload);
        const { data, error } = await supabase
          .from("vendors")
          .insert(payload)
          .select("*")
          .single();

        if (error) {
          throw error;
        }
        setForm((prev) => ({ ...prev, id: data.id }));
        setStatus(
          "Thank you. Your vendor information has been submitted for review.",
        );
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

  useEffect(() => {
    void loadPage();
  }, []);

  return (
    <div style={{ padding: 24, display: "grid", gap: 18 }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0 }}>Become an Event Vendor</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          Thank you for your interest in participating in EpicentraX-enabled
          events. Please complete the information below. An event administrator
          will review your submission and contact you if additional information
          is needed.
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
        className="card"
        style={{
          padding: 18,
          display: "grid",
          gap: 12,
        }}
      >
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
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            placeholder="Email"
            style={{ padding: 10 }}
          />

          <input
            value={form.phone}
            onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
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

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={saveVendor} disabled={saving}>
              {saving ? "Submitting..." : "Submit Vendor Information"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VendorApplyPage() {
  return <AdminVendorsPageInner />;
}
