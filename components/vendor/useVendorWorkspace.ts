"use client";

import { useCallback, useEffect, useState } from "react";

export type VendorWorkspaceContext = {
  authenticatedUserId: string;
  authenticatedUserEmail: string | null;
  permittedVendors: Array<{
    accessId: string;
    vendorId: string;
    vendorName: string;
    vendorIsActive: boolean;
    vendorContactId: string;
    personId: string | null;
    role: "vendor_admin" | "vendor_member";
    status: "active";
    invitationEmail: string;
    invitedForEventId: string | null;
    invitedAt: string | null;
    acceptedAt: string | null;
    contact: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      mobilePhone: string | null;
      roleTitle: string | null;
      isPrimary: boolean;
      status: string;
    } | null;
  }>;
  selectedVendorId: string | null;
  selectedVendor: {
    accessId: string;
    vendorId: string;
    vendorName: string;
    vendorIsActive: boolean;
    vendorContactId: string;
    personId: string | null;
    role: "vendor_admin" | "vendor_member";
    status: "active";
    invitationEmail: string;
    invitedForEventId: string | null;
    invitedAt: string | null;
    acceptedAt: string | null;
    contact: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      mobilePhone: string | null;
      roleTitle: string | null;
      isPrimary: boolean;
      status: string;
    } | null;
  } | null;
  requiresVendorSelection: boolean;
};

export type VendorWorkspaceAccessReason =
  | "missing_vendor_session"
  | "invalid_vendor_session"
  | "no_vendor_access";

export function useVendorWorkspace() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<VendorWorkspaceAccessReason | null>(null);
  const [context, setContext] = useState<VendorWorkspaceContext | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setReason(null);

      const response = await fetch("/api/vendor/access/context", {
        method: "GET",
        credentials: "include",
      });

      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        error?: string;
        reason?: VendorWorkspaceAccessReason;
        context?: VendorWorkspaceContext;
      };

      if (!response.ok || !payload.ok || !payload.context) {
        setContext(null);
        setError(payload.error || payload.message || "Vendor access denied.");
        setReason(payload.reason || null);
        return;
      }

      setContext(payload.context);
    } catch (err) {
      setContext(null);
      setError(err instanceof Error ? err.message : "Could not load vendor workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  const selectVendor = useCallback(async (vendorId: string) => {
    const response = await fetch("/api/vendor/access/select", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ vendorId }),
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: string;
    };

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Could not select vendor organization.");
    }

    await load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    loading,
    error,
    reason,
    context,
    reload: load,
    selectVendor,
  };
}
