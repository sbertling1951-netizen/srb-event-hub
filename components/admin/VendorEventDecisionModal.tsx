"use client";

import { useEffect, useId, useMemo, useState } from "react";

import {
  listVendorDispositionReasonCodes,
  REASON_CLASSIFICATION_COLORS,
  REASON_CLASSIFICATION_LABELS,
  type ReasonClassification,
  type VendorDispositionReasonCode,
} from "@/lib/vendorEventLifecycle";

type Props = {
  open: boolean;
  mode: "reject" | "revoke";
  vendorName: string;
  eventName: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reasonCode: string, reasonText: string | null) => void | Promise<void>;
};

/**
 * Structured reject/revoke interaction shared by both governed decisions
 * -- they take the identical (reason_code, reason_text) shape against
 * the same reason-code catalog, differing only in which RPC the caller
 * wires onConfirm to. Reason choices are read live from
 * vendor_disposition_reason_codes (governed reference data, RLS
 * authenticated/USING(true)) rather than a second, hardcoded list that
 * could drift from the database's own taxonomy.
 */
export default function VendorEventDecisionModal({
  open,
  mode,
  vendorName,
  eventName,
  busy = false,
  onCancel,
  onConfirm,
}: Props) {
  const titleId = useId();
  const [reasonCodes, setReasonCodes] = useState<VendorDispositionReasonCode[]>([]);
  const [loadingReasons, setLoadingReasons] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedCode("");
    setReasonText("");
    setValidationError(null);
    setLoadError(null);
    setLoadingReasons(true);

    listVendorDispositionReasonCodes()
      .then((rows) => setReasonCodes(rows))
      .catch((err: any) => setLoadError(err?.message || "Could not load reason codes."))
      .finally(() => setLoadingReasons(false));
  }, [open]);

  const grouped = useMemo(() => {
    const byClassification = new Map<ReasonClassification, VendorDispositionReasonCode[]>();
    for (const row of reasonCodes) {
      const list = byClassification.get(row.classification) || [];
      list.push(row);
      byClassification.set(row.classification, list);
    }
    return byClassification;
  }, [reasonCodes]);

  if (!open) {
    return null;
  }

  const title = mode === "reject" ? "Reject candidacy" : "Revoke admission";
  const helperText =
    mode === "reject"
      ? `This applies only to ${eventName}. It does not remove ${vendorName} from the EpicentraX vendor catalog, and does not prevent ${vendorName} from being considered for a different Event.`
      : `${vendorName} was admitted to ${eventName}. Revoking ends their current participation in this Event -- the admission history is preserved, not deleted, and ${vendorName} can be re-admitted later if circumstances change.`;

  function handleConfirm() {
    if (!selectedCode) {
      setValidationError("Select a reason before continuing.");
      return;
    }
    setValidationError(null);
    void onConfirm(selectedCode, reasonText.trim() || null);
  }

  return (
    <div
      role="presentation"
      onClick={busy ? undefined : onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        overflowY: "auto",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          borderRadius: 18,
          background: "#ffffff",
          boxShadow: "0 24px 60px rgba(15, 23, 42, 0.28)",
          padding: 22,
          display: "grid",
          gap: 14,
        }}
      >
        <div>
          <h2 id={titleId} style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#0f172a" }}>
            {title}
          </h2>
          <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5, color: "#475569" }}>
            {helperText}
          </p>
        </div>

        {loadError ? (
          <div role="alert" style={{ fontSize: 13, color: "#b91c1c" }}>
            {loadError}
          </div>
        ) : null}

        {loadingReasons ? (
          <div style={{ fontSize: 13, color: "#64748b" }}>Loading reason options...</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {(["operational_capacity", "performance_quality", "administrative_other"] as ReasonClassification[]).map(
              (classification) => {
                const codes = grouped.get(classification) || [];
                if (codes.length === 0) {
                  return null;
                }
                const colors = REASON_CLASSIFICATION_COLORS[classification];
                return (
                  <div key={classification} style={{ display: "grid", gap: 6 }}>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 800,
                        color: colors.text,
                        background: colors.background,
                        border: `1px solid ${colors.border}`,
                        borderRadius: 999,
                        padding: "3px 10px",
                        width: "fit-content",
                      }}
                    >
                      {REASON_CLASSIFICATION_LABELS[classification]}
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {codes.map((code) => (
                        <label
                          key={code.code}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "8px 10px",
                            borderRadius: 10,
                            border:
                              selectedCode === code.code
                                ? `1px solid ${colors.border}`
                                : "1px solid #e5e7eb",
                            background: selectedCode === code.code ? colors.background : "#ffffff",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="radio"
                            name="vendor-event-decision-reason"
                            value={code.code}
                            checked={selectedCode === code.code}
                            onChange={() => setSelectedCode(code.code)}
                          />
                          <span style={{ fontSize: 14 }}>{code.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              },
            )}
          </div>
        )}

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>
            Supporting detail (optional)
          </span>
          <textarea
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            rows={3}
            placeholder="Additional context for this decision"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #d1d5db" }}
          />
        </label>

        {validationError ? (
          <div role="alert" style={{ fontSize: 13, color: "#b91c1c" }}>
            {validationError}
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#334155",
              borderRadius: 12,
              padding: "10px 14px",
              fontWeight: 700,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || loadingReasons}
            style={{
              border: "none",
              background: "#dc2626",
              color: "#ffffff",
              borderRadius: 12,
              padding: "10px 14px",
              fontWeight: 800,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "Working..." : title}
          </button>
        </div>
      </div>
    </div>
  );
}
