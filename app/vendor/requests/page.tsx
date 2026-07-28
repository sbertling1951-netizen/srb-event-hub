"use client";

import Link from "next/link";

export default function VendorRequestsPage() {
  return (
    <div style={{ padding: 24, maxWidth: 760, margin: "0 auto", display: "grid", gap: 14 }}>
      <div className="card" style={{ padding: 18, display: "grid", gap: 10 }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>Vendor Request Link Retired</h1>
        <div style={{ color: "#555", fontSize: 14 }}>
          Shared token links are no longer supported. Vendor access is now person-specific,
          authenticated, and managed through the Vendor Workspace.
        </div>
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
  );
}
