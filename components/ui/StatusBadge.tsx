import type { ReactNode } from "react";

export type StatusBadgeTone = "neutral" | "info" | "warning" | "danger" | "success";

type StatusBadgeProps = {
  tone?: StatusBadgeTone;
  children: ReactNode;
  className?: string;
};

const TONE_CLASS: Record<StatusBadgeTone, string> = {
  neutral: "",
  info: "app-status-pill-info",
  warning: "app-status-pill-warning",
  danger: "app-status-pill-danger",
  success: "app-status-pill-success",
};

/**
 * Standard status/priority pill (UI Phase 2). Wraps the existing
 * `.app-status-pill` token system (app/globals.css) that the Dashboard
 * pilot already extended with warning/danger/info variants. Text is
 * always the sole carrier of meaning -- tone only adds a redundant color
 * cue, never a substitute for the label itself.
 */
export function StatusBadge({ tone = "neutral", children, className }: StatusBadgeProps) {
  const classes = ["app-status-pill", TONE_CLASS[tone], className]
    .filter(Boolean)
    .join(" ");

  return <span className={classes}>{children}</span>;
}
