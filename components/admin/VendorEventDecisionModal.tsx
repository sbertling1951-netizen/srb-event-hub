"use client";

import { useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Textarea } from "@/components/ui/Field";
import { LoadingState } from "@/components/ui/LoadingState";
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
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) {
          onCancel();
        }
      }}
      title={title}
      description={helperText}
      footer={
        <>
          <AppButton onClick={onCancel} disabled={busy}>
            Cancel
          </AppButton>
          <AppButton
            variant="stop"
            onClick={handleConfirm}
            loading={busy}
            disabled={loadingReasons}
          >
            {title}
          </AppButton>
        </>
      }
    >
      <div style={{ display: "grid", gap: "var(--space-4)", minWidth: 0 }}>
        {loadError ? <Alert tone="danger">{loadError}</Alert> : null}

        {loadingReasons ? (
          <LoadingState message="Loading reason options..." />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {(["operational_capacity", "performance_quality", "administrative_other"] as ReasonClassification[]).map(
              (classification) => {
                const codes = grouped.get(classification) || [];
                if (codes.length === 0) {
                  return null;
                }
                const colors = REASON_CLASSIFICATION_COLORS[classification];
                return (
                  <div key={classification} style={{ display: "grid", gap: "var(--space-2)" }}>
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
                    <div style={{ display: "grid", gap: "var(--space-2)" }}>
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

        <Field label="Supporting detail (optional)">
          {(controlProps) => (
            <Textarea
              {...controlProps}
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              rows={3}
              placeholder="Additional context for this decision"
            />
          )}
        </Field>

        {validationError ? <Alert tone="danger">{validationError}</Alert> : null}
      </div>
    </Dialog>
  );
}
