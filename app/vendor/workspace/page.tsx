"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import VendorWorkspaceShell from "@/components/vendor/VendorWorkspaceShell";
import { isVendorNoticeCurrentlyDisplayable, type VendorNotice } from "@/lib/vendorNotice";

type ParticipationRow = {
  id: string;
  event_id: string;
  currentNotice: VendorNotice | null;
};

type SummaryPayload = {
  ok: boolean;
  error?: string;
  vendor?: {
    id: string;
    business_name: string | null;
    business_description: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    is_active: boolean | null;
  } | null;
  participationRows?: ParticipationRow[];
  participation?: {
    total: number;
    byStatus: Record<string, number>;
    serviceEnabled: number;
    visibleToMembers: number;
  };
  openRequestsCount?: number;
};

export default function VendorWorkspaceHomePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/vendor/workspace/summary", {
        method: "GET",
        credentials: "include",
      });

      const payload = (await response.json()) as SummaryPayload;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not load vendor summary.");
      }

      setSummary(payload);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load vendor summary.",
      );
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const participationRows = summary?.participationRows || [];
  const activeNoticeCount = participationRows.filter((row) =>
    isVendorNoticeCurrentlyDisplayable(row.currentNotice),
  ).length;

  return (
    <VendorWorkspaceShell title="Vendor Home">
      {loading ? (
        <div>Loading vendor summary...</div>
      ) : error ? (
        <div style={{ color: "#991b1b", fontWeight: 700 }}>{error}</div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <strong>Organization:</strong> {summary?.vendor?.business_name || "Vendor"}
          </div>

          <div
            className="app-card-section-muted"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div>
              <strong>Open requests:</strong> {summary?.openRequestsCount ?? 0}
            </div>
            <Link href="/vendor/workspace/requests" className="app-button app-button-muted">
              View Requests
            </Link>
          </div>

          <div
            className="app-card-section-muted"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div>
              <strong>Active notices:</strong> {activeNoticeCount} of{" "}
              {participationRows.length} event{participationRows.length === 1 ? "" : "s"}
            </div>
            <Link href="/vendor/workspace/notices" className="app-button app-button-muted">
              Manage Notices
            </Link>
          </div>
        </div>
      )}
    </VendorWorkspaceShell>
  );
}
