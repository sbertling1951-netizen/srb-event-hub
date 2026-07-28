"use client";

import { useEffect, useState } from "react";

import VendorWorkspaceShell from "@/components/vendor/VendorWorkspaceShell";

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile_phone: string | null;
  role_title: string | null;
  is_primary: boolean;
  status: string;
};

type ContactsPayload = {
  ok: boolean;
  error?: string;
  contacts?: ContactRow[];
};

export default function VendorWorkspaceContactsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadContacts() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch("/api/vendor/workspace/contacts", {
          method: "GET",
          credentials: "include",
        });

        const payload = (await response.json()) as ContactsPayload;

        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Could not load contacts.");
        }

        if (!cancelled) {
          setContacts(payload.contacts || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load contacts.");
          setContacts([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadContacts();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <VendorWorkspaceShell title="Contacts">
      {loading ? (
        <div>Loading contacts...</div>
      ) : error ? (
        <div style={{ color: "#991b1b", fontWeight: 700 }}>{error}</div>
      ) : contacts.length === 0 ? (
        <div>No contacts available for this vendor organization.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {contacts.map((contact) => {
            const fullName = [contact.first_name, contact.last_name]
              .filter(Boolean)
              .join(" ")
              .trim();

            return (
              <div key={contact.id} className="app-card-section-muted" style={{ display: "grid", gap: 4 }}>
                <div style={{ fontWeight: 800 }}>
                  {fullName || contact.email || "Vendor Contact"}
                  {contact.is_primary ? " (Primary)" : ""}
                </div>
                <div>Email: {contact.email || "—"}</div>
                <div>Mobile: {contact.mobile_phone || "—"}</div>
                <div>Role/Title: {contact.role_title || "—"}</div>
                <div>Status: {contact.status || "active"}</div>
              </div>
            );
          })}
        </div>
      )}
    </VendorWorkspaceShell>
  );
}
