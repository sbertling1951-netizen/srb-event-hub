import type { ReactNode } from "react";

export type AlertTone = "neutral" | "info" | "warning" | "danger" | "success";

type AlertProps = {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
};

const TONE_CLASS: Record<AlertTone, string> = {
  neutral: "",
  info: "app-alert-info",
  warning: "app-alert-warning",
  danger: "app-alert-danger",
  success: "app-alert-success",
};

/**
 * Standard loading/empty/error/success/informational message treatment
 * (UI Phase 1). One consistent visual and semantic shape for every page
 * that previously rendered its own ad hoc status box.
 *
 * `danger` renders `role="alert"` (assistive technology interrupts to
 * announce it, appropriate for a failure surfacing after the page has
 * already loaded); every other tone renders `role="status"` with
 * `aria-live="polite"` (announced without interrupting). Meaning is never
 * carried by color alone -- the icon is decorative (`aria-hidden`) and the
 * text content is the sole carrier of what happened.
 */
export function Alert({ tone = "neutral", children, className }: AlertProps) {
  const classes = ["app-alert", TONE_CLASS[tone], className]
    .filter(Boolean)
    .join(" ");
  const isDanger = tone === "danger";

  return (
    <div
      className={classes}
      role={isDanger ? "alert" : "status"}
      aria-live={isDanger ? undefined : "polite"}
    >
      <span className="app-alert-icon" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
