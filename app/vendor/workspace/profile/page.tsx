"use client";

import { useEffect, useState } from "react";

import VendorWorkspaceShell from "@/components/vendor/VendorWorkspaceShell";

type SummaryPayload = {
  ok: boolean;
  error?: string;
  canEdit?: boolean;
  vendor?: {
    id: string;
    business_name: string | null;
    contact_name: string | null;
    business_description: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    preferred_contact_method: string | null;
    is_active: boolean | null;
  } | null;
};

export default function VendorWorkspaceProfilePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vendor, setVendor] = useState<SummaryPayload["vendor"]>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);

  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
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
      ) : error ? (
        <div style={{ color: "#991b1b", fontWeight: 700 }}>{error}</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 14, color: "#555" }}>
            {canEdit
              ? "As vendor_admin, you can update canonical organization profile details."
              : "Read-only: only vendor_admin can update organization profile details."}
          </div>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Business Name</div>
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              disabled={!canEdit || saving}
              style={{ width: "100%", padding: 10 }}
            />
          </label>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Contact Name</div>
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              disabled={!canEdit || saving}
              style={{ width: "100%", padding: 10 }}
            />
          </label>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Email</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!canEdit || saving}
              style={{ width: "100%", padding: 10 }}
            />
          </label>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Phone</div>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={!canEdit || saving}
              style={{ width: "100%", padding: 10 }}
            />
          </label>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Website</div>
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              disabled={!canEdit || saving}
              style={{ width: "100%", padding: 10 }}
            />
          </label>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Preferred Contact Method</div>
            <select
              value={preferredContactMethod}
              onChange={(e) => setPreferredContactMethod(e.target.value)}
              disabled={!canEdit || saving}
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
              disabled={!canEdit || saving}
              style={{ width: "100%", minHeight: 96, padding: 10 }}
            />
          </label>
          {canEdit ? (
            <div>
              <button
                type="button"
                onClick={() => void saveProfile()}
                disabled={saving}
                className="app-button app-button-primary"
              >
                {saving ? "Saving..." : "Save Profile"}
              </button>
            </div>
          ) : null}
          <div><strong>Active:</strong> {vendor?.is_active === false ? "No" : "Yes"}</div>
        </div>
      )}
    </VendorWorkspaceShell>
  );
}
