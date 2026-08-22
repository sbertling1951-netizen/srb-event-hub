"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import {
  REASON_CLASSIFICATION_COLORS,
  REASON_CLASSIFICATION_LABELS,
  type VendorEventDispositionRow,
} from "@/lib/vendorEventLifecycle";

type Props = {
  dispositions: VendorEventDispositionRow[];
  loading?: boolean;
};

const DECISION_LABELS: Record<VendorEventDispositionRow["decision_type"], string> = {
  admitted: "Admitted",
  rejected: "Rejected",
  revoked: "Revoked",
};

/**
 * Raw disposition history for one vendor within the current Event only
 * -- backed by list_vendor_event_dispositions, which itself scopes to a
 * single p_event_id the caller already holds event.vendors.view
 * authority for. This component never queries across Events/Tenants and
 * never accepts one as a prop, so there is no client-side path to a
 * cross-Tenant history query.
 */
export default function VendorDispositionHistory({ dispositions, loading = false }: Props) {
  if (loading) {
    return <LoadingState message="Loading history..." />;
  }

  if (dispositions.length === 0) {
    return <EmptyState message="No decisions recorded for this Event yet." />;
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {dispositions.map((row) => {
        const colors = row.reason_classification
          ? REASON_CLASSIFICATION_COLORS[row.reason_classification]
          : { background: "#f8fafc", border: "#e2e8f0", text: "#334155" };

        return (
          <div
            key={row.disposition_id}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: 10,
              display: "grid",
              gap: 4,
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontWeight: 800, fontSize: 13 }}>{DECISION_LABELS[row.decision_type]}</span>
              {row.reason_classification ? (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: colors.text,
                    background: colors.background,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 999,
                    padding: "2px 8px",
                  }}
                >
                  {REASON_CLASSIFICATION_LABELS[row.reason_classification]}
                </span>
              ) : null}
              <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: "auto" }}>
                {new Date(row.occurred_at).toLocaleString()}
              </span>
            </div>
            {row.reason_code ? (
              <div style={{ fontSize: 13, color: "#334155" }}>{row.reason_code.replace(/_/g, " ")}</div>
            ) : null}
            {row.reason_text ? (
              <div style={{ fontSize: 13, color: "#475569", overflowWrap: "anywhere" }}>
                {row.reason_text}
              </div>
            ) : null}
            {row.authority_basis === "backfill" ? (
              <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>
                Migrated historical record -- original actor not recorded.
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
