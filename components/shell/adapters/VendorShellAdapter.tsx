"use client";

import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { buildShellBrand } from "@/components/shell/brand";
import { buildVendorNavSections } from "@/components/shell/navigation/vendorNav";
import type { ShellAccountAction, ShellBackTarget, ShellContentMode } from "@/components/shell/types";
import { useVendorWorkspace } from "@/components/vendor/useVendorWorkspace";
import { useTenant } from "@/lib/providers/TenantProvider";
import { signOutOfVendorWorkspace } from "@/lib/vendorSession";

function contactDisplayName(
  contact: { firstName: string | null; lastName: string | null; email: string | null } | null,
): string {
  if (!contact) {
    return "Vendor Contact";
  }
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  return fullName || contact.email || "Vendor Contact";
}

export type VendorShellAdapterProps = {
  pageTitle?: string;
  pageSubtitle?: string;
  backTarget?: ShellBackTarget | null;
  contentMode?: ShellContentMode;
  children: ReactNode;
};

/**
 * Thin Vendor adapter (§E). Replaces `VendorWorkspaceShell`'s former
 * independent shell implementation -- Vendor now renders the identical
 * canonical AppShell that Member and Admin render, via this adapter.
 * `VendorWorkspaceShell` itself becomes a compatibility wrapper around this
 * component (components/vendor/VendorWorkspaceShell.tsx) so none of its
 * seven existing page call sites require any change.
 *
 * Vendor's workspace resolution (`useVendorWorkspace`) can be loading, in
 * error, or awaiting an explicit vendor-organization selection before any
 * Workspace exists to present chrome for -- exactly as before, those three
 * states render a minimal, chrome-free card rather than the full shell,
 * since there is no resolved Workspace yet to build a ShellConfig from.
 * Only the resolved state renders through AppShell.
 *
 * The `statusContent` slot below (organization / signed-in-as / role) is
 * also where a future, separately authorized Vendor notice/communication
 * capability would render (§N) -- this task does not invent that data
 * source, only preserves a consistent slot for it.
 */
export function VendorShellAdapter({ pageTitle, pageSubtitle, backTarget, contentMode, children }: VendorShellAdapterProps) {
  const { loading, error, reason, context, selectVendor } = useVendorWorkspace();
  const { tenant } = useTenant();
  const [pendingVendorId, setPendingVendorId] = useState("");
  const [selectError, setSelectError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const selectedVendor = context?.selectedVendor || null;

  const currentContactLabel = useMemo(() => contactDisplayName(selectedVendor?.contact || null), [selectedVendor]);

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

  async function signOut() {
    setSignOutError(null);
    try {
      setSigningOut(true);
      await signOutOfVendorWorkspace();
      window.location.assign("/vendor/login");
    } catch (err) {
      setSigningOut(false);
      setSignOutError(err instanceof Error ? err.message : "Could not sign out. Please try again.");
    }
  }

  if (loading) {
    return <div style={{ padding: 24 }}>Loading vendor workspace...</div>;
  }

  if (error || !context) {
    const noActiveAccess = reason === "no_vendor_access";

    return (
      <div style={{ padding: 24, display: "grid", gap: 12 }}>
        <div className="card" style={{ padding: 18 }}>
          <h1 style={{ marginTop: 0 }}>Vendor Access</h1>
          <div style={{ color: "#991b1b", fontWeight: 700 }}>{error || "Vendor access is unavailable."}</div>
          <div style={{ marginTop: 10, fontSize: 14, color: "#555" }}>
            {noActiveAccess
              ? "You're signed in, but this account doesn't have active vendor access yet. Complete registration below, or sign in with a different account if you were expecting an invitation."
              : "Sign in with your vendor email, or register a new vendor organization."}
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {noActiveAccess ? (
                <>
                  <Link href="/vendor/register" className="app-button app-button-primary">
                    Complete Vendor Registration
                  </Link>
                  <Link href="/vendor/login" className="app-button">
                    Vendor Login
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/vendor/login" className="app-button app-button-primary">
                    Vendor Login
                  </Link>
                  <Link href="/vendor/register" className="app-button">
                    Vendor Register
                  </Link>
                </>
              )}
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
              onChange={(event) => setPendingVendorId(event.target.value)}
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

          {selectError ? <div style={{ color: "#991b1b", fontWeight: 700 }}>{selectError}</div> : null}

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

  const accountActions: ShellAccountAction[] = [
    {
      id: "sign-out",
      label: signingOut ? "Signing out..." : "Sign Out",
      onClick: () => {
        void signOut();
      },
      disabled: signingOut,
      variant: "danger",
    },
  ];

  const statusContent = (
    <div style={{ fontSize: 14, color: "#555", display: "grid", gap: 2 }}>
      <div>
        Organization: <strong>{selectedVendor?.vendorName || "Vendor"}</strong>
      </div>
      <div>
        Signed in as: <strong>{currentContactLabel}</strong>
        {context.authenticatedUserEmail ? ` (${context.authenticatedUserEmail})` : ""}
      </div>
      <div>
        Access role: <strong>{selectedVendor?.role || "vendor_member"}</strong>
      </div>
      {signOutError ? (
        // Visible regardless of drawer state (§A.5): the mobile nav
        // drawer already closes as soon as Sign Out is tapped, but this
        // status area is not part of the drawer, so a failure surfaces
        // here whether the attempt was made from the desktop header or
        // the mobile drawer. Clears on the next attempt (`signOut()`
        // resets it first), on success (redirect away), or on navigating
        // to a different page (a fresh VendorShellAdapter instance).
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#991b1b", fontWeight: 600 }}>
          <span>{signOutError}</span>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className="app-button app-button-muted"
            style={{ padding: "2px 10px", fontSize: 12, fontWeight: 600 }}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <AppShell
      config={{
        role: "vendor",
        brand: buildShellBrand(tenant),
        workspace: selectedVendor ? { name: selectedVendor.vendorName } : null,
        pageTitle,
        pageSubtitle,
        navSections: buildVendorNavSections(),
        accountActions,
        statusContent,
        backTarget: backTarget ?? null,
        contentMode,
      }}
    >
      {children}
    </AppShell>
  );
}
