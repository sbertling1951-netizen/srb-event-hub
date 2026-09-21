"use client";

import { type ReactNode, useRef, useState } from "react";

import { AppButton } from "@/components/ui/AppButton";
import { Dialog } from "@/components/ui/Dialog";

/** Operation-specific instructions using the shared dialog interaction. */
export function HelpButton({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const instructionsRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <AppButton
        variant="tertiary"
        aria-label={`Help: ${title}`}
        aria-haspopup="dialog"
        onClick={(event) => {
          // Safari pointer clicks do not always focus buttons; capture a
          // reliable return target before the dialog moves focus inside.
          event.currentTarget.focus();
          setOpen(true);
        }}
        style={{ minWidth: "var(--touch-target-min)", padding: 0 }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6" />
          <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      </AppButton>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        initialFocusRef={instructionsRef}
        footer={
          <AppButton variant="secondary" onClick={() => setOpen(false)}>
            Close
          </AppButton>
        }
      >
        <div ref={instructionsRef} tabIndex={-1} style={{ outline: "none" }}>
          {children}
        </div>
      </Dialog>
    </>
  );
}
