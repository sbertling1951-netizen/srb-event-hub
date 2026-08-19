import type { ReactNode } from "react";

type RowActionsProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Layout-only wrapper for a row's action buttons (UI Phase 2) -- shared
 * by the desktop table's actions cell and the narrow-viewport list card,
 * so both presentations give row actions identical spacing and touch-
 * target sizing (`.row-actions .app-button` in app/globals.css). Takes
 * no action definitions or configuration; the caller supplies its own
 * buttons/links as children, exactly as it already would without this
 * wrapper -- this only standardizes the container around them.
 */
export function RowActions({ children, className }: RowActionsProps) {
  const classes = ["row-actions", className].filter(Boolean).join(" ");

  return <div className={classes}>{children}</div>;
}
