"use client";

import { useState } from "react";

import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { MemberShellAdapter } from "@/components/shell/adapters/MemberShellAdapter";
import { VendorShellAdapter } from "@/components/shell/adapters/VendorShellAdapter";

type PreviewRole = "member" | "admin" | "vendor";

/**
 * Dev-only shell-plumbing proof (EPICENTRAX UI STAGE 2 §M / STAGE 2B §E).
 *
 * Not a pilot page migration -- no production route renders through this
 * component. It exists solely to demonstrate that Member, Admin, and
 * Vendor role adapters compile and render through the identical canonical
 * AppShell. Root layout already provides every context these adapters
 * need (TenantProvider, AdminProvider, AdminWorkspaceProvider,
 * MemberWorkspaceProvider), so no additional wrapping is required here.
 *
 * This component carries no production gating itself -- that is enforced
 * one layer up, server-side, by `app/dev/shell-preview/page.tsx`'s
 * `notFound()` check, which runs before this component is ever imported
 * for a request. Do not add a client-side `NODE_ENV` check here; per §E
 * that is explicitly insufficient (client bundles/inspection can still
 * reveal a client-only guard).
 */
export function ShellPreviewClient() {
  const [role, setRole] = useState<PreviewRole>("member");

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ padding: 12, display: "flex", gap: 8 }}>
        <button type="button" className="app-button" onClick={() => setRole("member")}>
          Member
        </button>
        <button type="button" className="app-button" onClick={() => setRole("admin")}>
          Admin
        </button>
        <button type="button" className="app-button" onClick={() => setRole("vendor")}>
          Vendor
        </button>
      </div>

      {role === "member" ? (
        <MemberShellAdapter pageTitle="Shell Preview" pageSubtitle="Member adapter">
          <div className="card" style={{ padding: 18 }}>Member adapter content slot.</div>
        </MemberShellAdapter>
      ) : null}

      {role === "admin" ? (
        <AdminShellAdapter pageTitle="Shell Preview" pageSubtitle="Admin adapter">
          <div className="card" style={{ padding: 18 }}>Admin adapter content slot.</div>
        </AdminShellAdapter>
      ) : null}

      {role === "vendor" ? (
        <VendorShellAdapter pageTitle="Shell Preview">
          <div className="card" style={{ padding: 18 }}>Vendor adapter content slot.</div>
        </VendorShellAdapter>
      ) : null}
    </div>
  );
}
