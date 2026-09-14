"use client";

import { useCallback, useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { supabase } from "@/lib/supabase";

export type RefundReviewFilter = "all" | "pending" | "refunded";
export type RefundReviewRow = {
  request_id: string;
  event_id: string;
  event_name: string | null;
  requested_at: string;
  completed_at: string | null;
  request_state: string;
  review_status: "pending" | "refunded" | "needs_review";
};

const FILTERS: ReadonlyArray<{ value: RefundReviewFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "refunded", label: "Refunded" },
];

export function presentRefundReviewRow(row: RefundReviewRow) {
  return {
    requestId: row.request_id,
    eventId: row.event_id,
    eventName: row.event_name || "Deleted event",
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    status: row.review_status,
  };
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function PassportRefundsPage() {
  return (
    <AdminRouteGuard requiredPlatformAuthority>
      <AdminShellAdapter
        pageTitle="Passport Refunds"
        pageSubtitle="Review pending and completed Sandbox Passport refunds."
      >
        <PassportRefundsPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function PassportRefundsPageInner() {
  const [filter, setFilter] = useState<RefundReviewFilter>("all");
  const [rows, setRows] = useState<RefundReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<RefundReviewRow | null>(null);
  const [approving, setApproving] = useState(false);

  const load = useCallback(async (nextFilter: RefundReviewFilter) => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(
      "list_self_service_event_passport_refund_review",
      { p_filter: nextFilter },
    );
    if (rpcError || !Array.isArray(data)) {
      setRows([]);
      setError("Passport refund review is unavailable right now.");
    } else {
      setRows(data as RefundReviewRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  async function approveRefund() {
    if (!pendingApproval) return;
    setApproving(true);
    setError(null);
    const response = await fetch("/api/admin/passport/refunds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: pendingApproval.request_id }),
    });
    const result = await response.json().catch(() => null) as { status?: unknown } | null;
    setApproving(false);
    setPendingApproval(null);
    if (response.ok && result?.status === "refund_pending") {
      setFeedback("Refund sent to Stripe Sandbox. It remains pending until the signed webhook confirms it.");
      await load(filter);
      return;
    }
    setError("This refund could not be approved. Refresh the review list before trying again.");
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-5)", minWidth: 0 }}>
      <ConfirmDialog
        open={pendingApproval !== null}
        title="Approve Sandbox refund"
        message="This issues exactly one Sandbox Passport refund for this pending request. The refund is not complete until Stripe’s signed webhook confirms it."
        confirmLabel="Approve refund"
        busy={approving}
        onCancel={() => !approving && setPendingApproval(null)}
        onConfirm={approveRefund}
      />

      <PageHeader
        title="Passport Refunds"
        headingLevel="h1"
        description="Review requests before issuing a Sandbox refund. Completed refunds remain visible here as audit-backed history."
      />

      <div className="app-row-wrap" aria-label="Refund status filter">
        {FILTERS.map((choice) => (
          <AppButton
            key={choice.value}
            variant={filter === choice.value ? "primary" : "secondary"}
            aria-pressed={filter === choice.value}
            onClick={() => {
              setFeedback(null);
              setFilter(choice.value);
            }}
          >
            {choice.label}
          </AppButton>
        ))}
      </div>

      {feedback ? <Alert tone="info">{feedback}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {loading ? <Alert tone="info">Loading Passport refunds…</Alert> : null}

      {!loading && !error && rows.length === 0 ? (
        <Alert tone="neutral">No {filter === "all" ? "Passport refund requests" : `${filter} refunds`} found.</Alert>
      ) : null}

      {!loading && !error ? (
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          {rows.map((row) => {
            const view = presentRefundReviewRow(row);
            const actionable = view.status === "pending";
            return (
              <PageSection key={view.requestId} variant="card">
                <div className="app-row-between-wrap" style={{ gap: "var(--space-4)" }}>
                  <div style={{ minWidth: 0 }}>
                    <strong>{view.eventName}</strong>
                    <div className="app-subtle-text" style={{ marginTop: "var(--space-1)" }}>
                      Requested {formatDate(view.requestedAt)}
                      {view.status === "refunded" ? ` · Refunded ${formatDate(view.completedAt)}` : ""}
                    </div>
                    {view.status === "pending" ? <span>Pending approval</span> : null}
                    {view.status === "refunded" ? <span>Refunded</span> : null}
                    {view.status === "needs_review" ? <span>Needs review</span> : null}
                  </div>
                  {actionable ? (
                    <AppButton variant="primary" onClick={() => setPendingApproval(row)}>
                      Approve refund
                    </AppButton>
                  ) : null}
                </div>
              </PageSection>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
