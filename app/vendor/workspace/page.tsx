"use client";

import { useEffect, useState } from "react";

import VendorWorkspaceShell from "@/components/vendor/VendorWorkspaceShell";

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
  participation?: {
    total: number;
    byStatus: Record<string, number>;
    serviceEnabled: number;
    visibleToMembers: number;
  };
};

export default function VendorWorkspaceHomePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
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

        if (!cancelled) {
          setSummary(payload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load vendor summary.");
          setSummary(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSummary();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <VendorWorkspaceShell title="Vendor Home">
      {loading ? (
        <div>Loading vendor summary...</div>
      ) : error ? (
        <div style={{ color: "#991b1b", fontWeight: 700 }}>{error}</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <strong>Organization:</strong> {summary?.vendor?.business_name || "Vendor"}
          </div>
          <div>
            <strong>Profile access:</strong> You can maintain your vendor-owned
            organization facts based on your access role.
          </div>
          <div>
            <strong>Event participation:</strong> Event approval and publication
            decisions remain administrator-controlled.
          </div>

          <div className="app-card-section-muted" style={{ display: "grid", gap: 6 }}>
            <div>
              <strong>Total event participation records:</strong>{" "}
              {summary?.participation?.total || 0}
            </div>
            <div>
              <strong>Service requests enabled:</strong>{" "}
              {summary?.participation?.serviceEnabled || 0}
            </div>
            <div>
              <strong>Visible to members:</strong>{" "}
              {summary?.participation?.visibleToMembers || 0}
            </div>
            <div>
              <strong>Status summary:</strong>{" "}
              {Object.entries(summary?.participation?.byStatus || {}).length === 0
                ? "No status records"
                : Object.entries(summary?.participation?.byStatus || {})
                    .map(([status, count]) => `${status}: ${count}`)
                    .join("; ")}
            </div>
          </div>
        </div>
      )}
    </VendorWorkspaceShell>
  );
}
