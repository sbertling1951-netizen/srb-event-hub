"use client";

import { useEffect, useId } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (busy) {
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        void onConfirm();
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, busy, onConfirm, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div
      role="presentation"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(460px, 100%)",
          borderRadius: 18,
          background: "#ffffff",
          boxShadow: "0 24px 60px rgba(15, 23, 42, 0.28)",
          padding: 22,
        }}
      >
        <h2
          id={titleId}
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 800,
            color: "#0f172a",
          }}
        >
          {title}
        </h2>

        <p
          style={{
            margin: "12px 0 0",
            fontSize: 15,
            lineHeight: 1.5,
            color: "#475569",
          }}
        >
          {message}
        </p>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            marginTop: 22,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#334155",
              borderRadius: 12,
              padding: "10px 14px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            autoFocus
            onClick={() => {
              void onConfirm();
            }}
            disabled={busy}
            style={{
              border: "none",
              background: danger ? "#dc2626" : "#2563eb",
              color: "#ffffff",
              borderRadius: 12,
              padding: "10px 14px",
              fontWeight: 800,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
