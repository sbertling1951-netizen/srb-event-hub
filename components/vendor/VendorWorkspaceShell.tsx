"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useVendorWorkspace } from "@/components/vendor/useVendorWorkspace";

type VendorWorkspaceShellProps = {
  title: string;
  children: React.ReactNode;
};

function contactDisplayName(contact: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
} | null) {
  if (!contact) {
    return "Vendor Contact";
  }

  const fullName = [contact.firstName, contact.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return fullName || contact.email || "Vendor Contact";
}

export default function VendorWorkspaceShell({
  title,
  children,
}: VendorWorkspaceShellProps) {
  const { loading, error, context, selectVendor } = useVendorWorkspace();
  const [pendingVendorId, setPendingVendorId] = useState("");
  const [selectError, setSelectError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);

  const selectedVendor = context?.selectedVendor || null;

  const currentContactLabel = useMemo(() => {
    return contactDisplayName(selectedVendor?.contact || null);
  }, [selectedVendor]);

  async function submitSelection() {
    if (!pendingVendorId.trim()) {
      setSelectError("Select a vendor organization.");
      return;
    }

    try {
      setSelecting(true);
      setSelectError(null);
      await selectVendor(pendingVendorId.trim());
    } catch (err) {
      setSelectError(err instanceof Error ? err.message : "Could not select vendor.");
    } finally {
      setSelecting(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 24 }}>Loading vendor workspace...</div>;
  }

  if (error || !context) {
    return (
      <div style={{ padding: 24, display: "grid", gap: 12 }}>
        <div className="card" style={{ padding: 18 }}>
          <h1 style={{ marginTop: 0 }}>Vendor Access</h1>
          <div style={{ color: "#991b1b", fontWeight: 700 }}>
            {error || "Vendor access is unavailable."}
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href="/vendor/login" className="app-button app-button-primary">
                Vendor Login
              </Link>
              <Link href="/vendor/register" className="app-button">
                Vendor Register
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (context.requiresVendorSelection && !selectedVendor) {
    return (
      <div style={{ padding: 24, display: "grid", gap: 12, maxWidth: 720 }}>
        <div className="card" style={{ padding: 18, display: "grid", gap: 12 }}>
          <h1 style={{ marginTop: 0, marginBottom: 0 }}>Choose Vendor Organization</h1>
          <div style={{ fontSize: 14, color: "#555" }}>
            Your account can access multiple vendor organizations. Select one to continue.
          </div>

          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Vendor Organization</div>
            <select
              value={pendingVendorId}
              onChange={(e) => setPendingVendorId(e.target.value)}
              style={{ width: "100%", padding: 10 }}
            >
              <option value="">Select organization</option>
              {context.permittedVendors.map((entry) => (
                <option key={entry.vendorId} value={entry.vendorId}>
                  {entry.vendorName} ({entry.role})
                </option>
              ))}
            </select>
          </label>

          {selectError ? (
            <div style={{ color: "#991b1b", fontWeight: 700 }}>{selectError}</div>
          ) : null}

          <div>
            <button
              type="button"
              onClick={() => void submitSelection()}
              disabled={selecting}
              className="app-button app-button-primary"
            >
              {selecting ? "Selecting..." : "Continue"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, display: "grid", gap: 14 }}>
      <div className="card" style={{ padding: 18, display: "grid", gap: 8 }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>{title}</h1>
        <div style={{ fontSize: 14, color: "#555" }}>
          Organization: <strong>{selectedVendor?.vendorName || "Vendor"}</strong>
        </div>
        <div style={{ fontSize: 14, color: "#555" }}>
          Signed in as: <strong>{currentContactLabel}</strong>
          {context.authenticatedUserEmail ? ` (${context.authenticatedUserEmail})` : ""}
        </div>
        <div style={{ fontSize: 14, color: "#555" }}>
          Access role: <strong>{selectedVendor?.role || "vendor_member"}</strong>
        </div>
      </div>

      <div className="card" style={{ padding: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/vendor/workspace" className="app-button app-button-muted">
          Vendor Home
        </Link>
        <Link href="/vendor/workspace/profile" className="app-button app-button-muted">
          Organization Profile
        </Link>
        <Link href="/vendor/workspace/contacts" className="app-button app-button-muted">
          Contacts
        </Link>
        <Link href="/vendor/workspace/notices" className="app-button app-button-muted">
          Notices
        </Link>
        <Link href="/vendor/workspace/requests" className="app-button app-button-muted">
          Requests
        </Link>
        <Link href="/vendor/workspace/participation" className="app-button app-button-muted">
          Event Participation
        </Link>
        <Link href="/vendor/workspace/sign-out" className="app-button app-button-danger">
          Sign Out
        </Link>
      </div>

      <div className="card" style={{ padding: 18 }}>{children}</div>
    </div>
  );
}
