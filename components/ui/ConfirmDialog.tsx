"use client";

import { type RefObject, useRef } from "react";

import { AppButton } from "@/components/ui/AppButton";
import { Dialog } from "@/components/ui/Dialog";

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

type ConfirmDialogFooterProps = Pick<
  ConfirmDialogProps,
  "confirmLabel" | "cancelLabel" | "danger" | "busy" | "onConfirm" | "onCancel"
> & {
  confirmButtonRef: RefObject<HTMLButtonElement | null>;
};

/**
 * The action-variant decision (System 3), split out so it can be
 * exercised with a plain `renderToStaticMarkup` test the same way the
 * rest of `components/ui/*` is -- see `Dialog.tsx`'s own `DialogSurface`
 * for why the portal-wrapped default export cannot be tested this way.
 */
function ConfirmDialogFooter({
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
  confirmButtonRef,
}: ConfirmDialogFooterProps) {
  return (
    <>
      {/* Ordinary/secondary mutation (System 3, approved 2026-08-19):
          the shared ghost AppButton treatment. */}
      <AppButton onClick={onCancel} disabled={busy}>
        {cancelLabel}
      </AppButton>

      {/* Destructive confirmation (System 3): the one place a solid
          destructive fill belongs -- variant="stop" -- reserved for
          this exact moment. A non-destructive confirm uses the same
          solid weight via variant="primary" instead. */}
      <AppButton
        ref={confirmButtonRef}
        variant={danger ? "stop" : "primary"}
        onClick={() => {
          void onConfirm();
        }}
        loading={busy}
      >
        {confirmLabel}
      </AppButton>
    </>
  );
}

/**
 * The specialized confirm/cancel semantic (Central UI Standard, Stage 2):
 * built on the canonical `Dialog` foundation, so it gets the same focus/
 * Escape/backdrop/stack mechanics as every other dialog, rather than
 * maintaining a second interaction engine. `danger`/`busy` remain its own
 * concern -- picking the destructive-confirmation button treatment and
 * the loading label -- since those are specific to what "confirm" means,
 * not something `Dialog` itself should know about.
 */
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
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      initialFocusRef={confirmButtonRef}
      footer={
        <ConfirmDialogFooter
          confirmLabel={confirmLabel}
          cancelLabel={cancelLabel}
          danger={danger}
          busy={busy}
          onConfirm={onConfirm}
          onCancel={onCancel}
          confirmButtonRef={confirmButtonRef}
        />
      }
    />
  );
}

export { ConfirmDialogFooter };
