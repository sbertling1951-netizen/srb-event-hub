"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { supabase } from "@/lib/supabase";

type VendorRow = {
  id: string;
  business_name: string | null;
  is_active: boolean | null;
};

type ContactRow = {
  id: string;
  vendor_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile_phone: string | null;
  role_title: string | null;
  is_primary: boolean;
  status: string;
};

type AccessRow = {
  id: string;
  vendor_id: string;
  vendor_contact_id: string;
  auth_user_id: string | null;
  invitation_email: string;
  access_role: "vendor_admin" | "vendor_member";
  status: "pending" | "active" | "revoked" | "suspended";
  invited_for_event_id: string | null;
  invited_at: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
};

function contactName(contact: ContactRow | undefined) {
  if (!contact) {
    return "Contact";
  }

  const full = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim();
  return full || contact.email || "Contact";
}

function AdminVendorAccessInner() {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [accessRows, setAccessRows] = useState<AccessRow[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [contactId, setContactId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [mobilePhone, setMobilePhone] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [accessRole, setAccessRole] = useState<"vendor_admin" | "vendor_member">("vendor_member");
  const [status, setStatus] = useState("Loading vendor access...");
  const [busy, setBusy] = useState(false);

  const contactsForVendor = useMemo(() => {
    return contacts.filter((c) => c.vendor_id === selectedVendorId);
  }, [contacts, selectedVendorId]);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    return session?.access_token || "";
  }, []);

  const load = useCallback(async () => {
    try {
      setStatus("Loading vendor access...");

      const token = await getAccessToken();
      if (!token) {
        setStatus("Admin authentication is required.");
        return;
      }

      const response = await fetch("/api/admin/vendors/invitations", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        vendors?: VendorRow[];
        contacts?: ContactRow[];
        access?: AccessRow[];
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not load vendor access.");
      }

      setVendors(payload.vendors || []);
      setContacts(payload.contacts || []);
      setAccessRows(payload.access || []);
      setStatus("Vendor access loaded.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not load vendor access.");
    }
  }, [getAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendInvite(action: "invite" | "resend") {
    if (!selectedVendorId) {
      setStatus("Select a vendor organization.");
      return;
    }

    const selectedContact = contactsForVendor.find((c) => c.id === contactId);
    const inviteEmail = (selectedContact?.email || email).trim().toLowerCase();

    if (!inviteEmail) {
      setStatus("Contact email is required.");
      return;
    }

    try {
      setBusy(true);
      setStatus(action === "invite" ? "Sending invitation..." : "Resending invitation...");

      const token = await getAccessToken();
      if (!token) {
        throw new Error("Admin authentication is required.");
      }

      const response = await fetch("/api/admin/vendors/invitations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action,
          vendorId: selectedVendorId,
          accessRole,
          contact: selectedContact
            ? { id: selectedContact.id, email: selectedContact.email }
            : {
                firstName,
                lastName,
                email: inviteEmail,
                mobilePhone,
                roleTitle,
                isPrimary: false,
              },
        }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        alreadyActive?: boolean;
        existingAccountMatched?: boolean;
        emailSent?: boolean;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not send invitation.");
      }

      if (payload.alreadyActive) {
        setStatus("This contact already has active vendor access. No invitation was needed.");
      } else if (payload.existingAccountMatched) {
        setStatus(
          payload.emailSent
            ? "This email already has an EpicentraX account. A vendor-access notification was sent to it."
            : "This email already has an EpicentraX account and vendor access is ready, but the notification email could not be sent — share the Vendor Login page with them directly.",
        );
      } else {
        setStatus(action === "invite" ? "Invitation sent." : "Invitation resent.");
      }

      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not process invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(accessId: string) {
    try {
      setBusy(true);
      setStatus("Revoking access...");

      const token = await getAccessToken();
      if (!token) {
        throw new Error("Admin authentication is required.");
      }

      const response = await fetch("/api/admin/vendors/invitations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "revoke",
          accessId,
        }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not revoke access.");
      }

      setStatus("Access revoked.");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not revoke access.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <div className="card" style={{ padding: 18, minWidth: 0 }}>
        <div
          role="status"
          style={{ fontSize: 14, color: "#555", overflowWrap: "anywhere" }}
        >
          {status}
        </div>
      </div>

      <div
        className="card"
        style={{ padding: 18, display: "grid", gap: 12, minWidth: 0 }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 0 }}>Invite or Resend</h2>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Vendor Organization</div>
          <select
            value={selectedVendorId}
            onChange={(e) => {
              setSelectedVendorId(e.target.value);
              setContactId("");
            }}
            style={{ width: "100%", padding: 10 }}
          >
            <option value="">Select vendor</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.business_name || "Vendor"}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Existing Contact (optional)</div>
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            style={{ width: "100%", padding: 10 }}
            disabled={!selectedVendorId}
          >
            <option value="">Create/select by email</option>
            {contactsForVendor.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contactName(contact)}{contact.email ? ` (${contact.email})` : ""}
              </option>
            ))}
          </select>
        </label>

        {!contactId ? (
          <div style={{ display: "grid", gap: 10 }}>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" style={{ padding: 10 }} />
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" style={{ padding: 10 }} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={{ padding: 10 }} />
            <input value={mobilePhone} onChange={(e) => setMobilePhone(e.target.value)} placeholder="Mobile phone" style={{ padding: 10 }} />
            <input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Role/Title" style={{ padding: 10 }} />
          </div>
        ) : null}

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Access role</div>
          <select
            value={accessRole}
            onChange={(e) => setAccessRole(e.target.value as "vendor_admin" | "vendor_member")}
            style={{ width: "100%", padding: 10 }}
          >
            <option value="vendor_member">vendor_member</option>
            <option value="vendor_admin">vendor_admin</option>
          </select>
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="app-button app-button-primary" disabled={busy} onClick={() => void sendInvite("invite")}>Send Invitation</button>
          <button type="button" className="app-button" disabled={busy} onClick={() => void sendInvite("resend")}>Resend Invitation</button>
          <button type="button" className="app-button app-button-muted" disabled={busy} onClick={() => void load()}>Refresh</button>
        </div>
      </div>

      <div
        className="card"
        style={{ padding: 18, display: "grid", gap: 10, minWidth: 0 }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 0 }}>Current Vendor Access</h2>

        {accessRows.length === 0 ? (
          <div>No vendor access records yet.</div>
        ) : (
          accessRows.map((row) => {
            const vendorName =
              vendors.find((vendor) => vendor.id === row.vendor_id)?.business_name ||
              "Vendor";
            const contact = contacts.find((c) => c.id === row.vendor_contact_id);

            return (
              <div
                key={row.id}
                className="app-card-section-muted"
                style={{ display: "grid", gap: 5, minWidth: 0, overflowWrap: "anywhere" }}
              >
                <div style={{ fontWeight: 800, overflowWrap: "anywhere" }}>
                  {vendorName}
                </div>
                <div>Contact: {contactName(contact)}</div>
                <div>Email: {row.invitation_email}</div>
                <div>Role: {row.access_role}</div>
                <div>Status: {row.status}</div>
                <div>Invited: {row.invited_at || "—"}</div>
                <div>Accepted: {row.accepted_at || "—"}</div>
                <div>Revoked: {row.revoked_at || "—"}</div>

                {row.status !== "revoked" ? (
                  <div>
                    <button
                      type="button"
                      className="app-button app-button-danger"
                      disabled={busy}
                      onClick={() => void revoke(row.id)}
                    >
                      Revoke Access
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function AdminVendorAccessPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_vendors">
      <AdminShellAdapter pageTitle="Vendor Access Invitations">
        <AdminVendorAccessInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
