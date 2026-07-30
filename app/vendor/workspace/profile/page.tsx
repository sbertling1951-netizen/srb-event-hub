"use client";

import { useEffect, useRef, useState } from "react";

import VendorWorkspaceShell from "@/components/vendor/VendorWorkspaceShell";
import { supabase } from "@/lib/supabase";

type VendorProfile = {
  id: string;
  business_name: string | null;
  contact_name: string | null;
  business_description: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  logo_url: string | null;
  preferred_contact_method: string | null;
  is_active: boolean | null;
};

type SummaryPayload = {
  ok: boolean;
  error?: string;
  canEdit?: boolean;
  vendor?: VendorProfile | null;
};

function readOnlyRow(label: string, value: string | null | undefined) {
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 13, color: "#555" }}>{label}</div>
      <div style={{ fontSize: 15 }}>{value?.trim() || "—"}</div>
    </div>
  );
}

export default function VendorWorkspaceProfilePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [preferredContactMethod, setPreferredContactMethod] = useState("email");

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch("/api/vendor/workspace/profile", {
          method: "GET",
          credentials: "include",
        });

        const payload = (await response.json()) as SummaryPayload;

        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Could not load vendor profile.");
        }

        if (!cancelled) {
          setVendor(payload.vendor || null);
          setCanEdit(!!payload.canEdit);
          setBusinessName(payload.vendor?.business_name || "");
          setContactName(payload.vendor?.contact_name || "");
          setEmail(payload.vendor?.email || "");
          setPhone(payload.vendor?.phone || "");
          setWebsite(payload.vendor?.website || "");
          setLogoUrl(payload.vendor?.logo_url || "");
          setBusinessDescription(payload.vendor?.business_description || "");
          setPreferredContactMethod(
            payload.vendor?.preferred_contact_method || "email",
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load vendor profile.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  async function uploadLogo(file: File) {
    try {
      setUploadingLogo(true);
      setError(null);

      const fileExt = file.name.split(".").pop() || "png";
      const safeBusinessName =
        businessName
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

      setLogoUrl(publicUrlData.publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload logo.");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function saveProfile() {
    try {
      setSaving(true);
      setError(null);

      const response = await fetch("/api/vendor/workspace/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          business_name: businessName,
          contact_name: contactName,
          email,
          phone,
          website,
          logo_url: logoUrl,
          business_description: businessDescription,
          preferred_contact_method: preferredContactMethod,
        }),
      });

      const payload = (await response.json()) as SummaryPayload;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not save vendor profile.");
      }

      setVendor(payload.vendor || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save vendor profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <VendorWorkspaceShell title="Organization Profile">
      {loading ? (
        <div>Loading organization profile...</div>
      ) : error && !vendor ? (
        <div style={{ color: "#991b1b", fontWeight: 700 }}>{error}</div>
      ) : !canEdit ? (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ fontSize: 14, color: "#555" }}>
            Only your organization&apos;s Vendor Administrator can edit
            organization information.
          </div>

          {vendor?.logo_url ? (
            <img
              src={vendor.logo_url}
              alt={`${vendor.business_name || "Vendor"} logo`}
              style={{ maxHeight: 90, maxWidth: 240, objectFit: "contain" }}
            />
          ) : null}

          <div style={{ display: "grid", gap: 12 }}>
            {readOnlyRow("Business Name", vendor?.business_name)}
            {readOnlyRow("Public Contact Name", vendor?.contact_name)}
            {readOnlyRow("Email", vendor?.email)}
            {readOnlyRow("Phone", vendor?.phone)}
            {readOnlyRow("Website", vendor?.website)}
            {readOnlyRow("Preferred Contact Method", vendor?.preferred_contact_method)}
            {readOnlyRow("Description", vendor?.business_description)}
            {readOnlyRow("Active", vendor?.is_active === false ? "No" : "Yes")}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 14, color: "#555" }}>
            As vendor_admin, you can update canonical organization profile details.
          </div>

          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Organization Logo</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Organization logo"
                  style={{
                    maxHeight: 70,
                    maxWidth: 160,
                    objectFit: "contain",
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    padding: 6,
                    background: "white",
                  }}
                />
              ) : (
                <div style={{ fontSize: 13, color: "#777" }}>No logo uploaded</div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                disabled={uploadingLogo || saving}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void uploadLogo(file);
                  }
                }}
                style={{ display: "none" }}
              />
              <button
                type="button"
                className="app-button app-button-muted"
                disabled={uploadingLogo || saving}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadingLogo ? "Uploading..." : logoUrl ? "Replace Logo" : "Upload Logo"}
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
              This logo is used everywhere your organization appears in EpicentraX.
              Save the profile to keep it after uploading.
            </div>
          </label>

          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Business Name</div>
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              disabled={saving}
              style={{ width: "100%", padding: 10 }}
            />
          </label>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Public Contact Name</div>
            <div style={{ fontSize: 12, color: "#777", marginBottom: 6 }}>
              A free-text label shown on the organization profile only. It does
              not change any person&apos;s identity or the named contacts
              listed on the Contacts page.
            </div>
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              disabled={saving}
              style={{ width: "100%", padding: 10 }}
            />
          </label>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Email</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={saving}
              style={{ width: "100%", padding: 10 }}
            />
          </label>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Phone</div>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={saving}
              style={{ width: "100%", padding: 10 }}
            />
          </label>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Website</div>
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              disabled={saving}
              style={{ width: "100%", padding: 10 }}
            />
          </label>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Preferred Contact Method</div>
            <select
              value={preferredContactMethod}
              onChange={(e) => setPreferredContactMethod(e.target.value)}
              disabled={saving}
              style={{ width: "100%", padding: 10 }}
            >
              <option value="email">email</option>
              <option value="phone">phone</option>
              <option value="text">text</option>
            </select>
          </label>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Description</div>
            <textarea
              value={businessDescription}
              onChange={(e) => setBusinessDescription(e.target.value)}
              disabled={saving}
              style={{ width: "100%", minHeight: 96, padding: 10 }}
            />
          </label>

          {error ? (
            <div style={{ color: "#991b1b", fontWeight: 700 }}>{error}</div>
          ) : null}

          <div>
            <button
              type="button"
              onClick={() => void saveProfile()}
              disabled={saving || uploadingLogo}
              className="app-button app-button-primary"
            >
              {saving ? "Saving..." : "Save Profile"}
            </button>
          </div>
          <div><strong>Active:</strong> {vendor?.is_active === false ? "No" : "Yes"}</div>
        </div>
      )}
    </VendorWorkspaceShell>
  );
}
