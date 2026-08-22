import type { ReactNode } from "react";

type FormActionsProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Save/Cancel (or any other end-of-form action set) grouping -- the
 * canonical name for what most forms already hand-write inline as
 * `<div className="app-button-row">`. Wraps that same layout class
 * (flex-wrap, consistent gap, vertically centered) so a form's action row
 * reads as one recognizable pattern across pages rather than a page-local
 * div; it owns no button logic or semantics of its own -- callers still
 * decide which `AppButton` variants belong here and in what order.
 */
export function FormActions({ children, className }: FormActionsProps) {
  return <div className={["app-button-row", className].filter(Boolean).join(" ")}>{children}</div>;
}
