"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import VendorWorkspaceShell from "@/components/vendor/VendorWorkspaceShell";
import { signOutOfVendorWorkspace } from "@/lib/vendorSession";

export default function VendorWorkspaceSignOutPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function signOut() {
    try {
      setBusy(true);
      setStatus("Signing out...");

      await signOutOfVendorWorkspace();

      setStatus("Signed out.");
      router.replace("/vendor/login");
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <VendorWorkspaceShell title="Sign Out">
      <div style={{ display: "grid", gap: 10 }}>
        <div>Sign out of the Vendor Workspace for this browser session.</div>
        <div>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={busy}
            className="app-button app-button-danger"
          >
            {busy ? "Signing out..." : "Sign Out"}
          </button>
        </div>
        {status ? <div style={{ color: "#555" }}>{status}</div> : null}
      </div>
    </VendorWorkspaceShell>
  );
}
