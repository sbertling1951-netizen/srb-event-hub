import type { ReactNode } from "react";

export type AlertTone = "neutral" | "info" | "warning" | "danger" | "success";

type AlertProps = {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
  /** Overrides the default decorative dot (e.g. a spinner for a loading
   * message) -- still rendered `aria-hidden`; `children` remains the sole
   * carrier of meaning either way. */
  icon?: ReactNode;
  /** Optional trailing action (e.g. "Clear filters" on an empty-state
   * message). Rendered after the text, inside the same alert. */
  action?: ReactNode;
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
 * (UI Phase 1; `icon`/`action` added by the Central UI Standard so
 * `EmptyState`/`LoadingState` can be thin wrappers around this one
 * primitive instead of a second, competing container). One consistent
 * visual and semantic shape for every page that previously rendered its
 * own ad hoc status box.
 *
 * `danger` renders `role="alert"` (assistive technology interrupts to
 * announce it, appropriate for a failure surfacing after the page has
 * already loaded); every other tone renders `role="status"` with
 * `aria-live="polite"` (announced without interrupting). Meaning is never
 * carried by color alone -- the icon is decorative (`aria-hidden`) and the
 * text content is the sole carrier of what happened.
 */
export function Alert({ tone = "neutral", children, className, icon, action }: AlertProps) {
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
      {icon ?? <span className="app-alert-icon" aria-hidden="true" />}
      <span className="app-alert-message">{children}</span>
      {action ? <span className="app-alert-action">{action}</span> : null}
    </div>
  );
}
