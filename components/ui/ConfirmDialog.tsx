"use client";

import { useEffect, useId } from "react";

import { AppButton } from "@/components/ui/AppButton";

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
          {/* Ordinary/secondary mutation (System 3, approved 2026-08-19):
              the shared ghost AppButton treatment. */}
          <AppButton onClick={onCancel}>{cancelLabel}</AppButton>

          {/* Destructive confirmation (System 3): the one place a solid
              destructive fill belongs -- variant="stop" -- reserved for
              this exact moment. A non-destructive confirm uses the same
              solid weight via variant="primary" instead. */}
          <AppButton
            variant={danger ? "stop" : "primary"}
            autoFocus
            onClick={() => {
              void onConfirm();
            }}
            disabled={busy}
          >
            {busy ? "Working..." : confirmLabel}
          </AppButton>
        </div>
      </div>
    </div>
  );
}
