import type { ReactNode } from "react";

import { Alert } from "@/components/ui/Alert";

type EmptyStateProps = {
  /** What there is none of, and why (e.g. "No records match your search
   * or filters. Try clearing them."). */
  message: ReactNode;
  /** Optional recovery action (e.g. "Clear filters"). Typically an
   * `AppButton`/`AppLinkButton`, but left generic so a plain link works
   * too. */
  action?: ReactNode;
  className?: string;
};

/**
 * Canonical "there is nothing here" presentation -- replaces the ~20+
 * hand-written `<p>No results.</p>`/`<div className="card">No X
 * found.</div>` variants scattered across the app. A thin `Alert`
 * wrapper (`tone="neutral"`), not a second, competing container --
 * `Alert` already owns exactly this "loading/empty/error" territory
 * (see its own doc comment); an empty collection is an ordinary state,
 * not something that went wrong, so the neutral tone and `role="status"`
 * apply unchanged.
 */
export function EmptyState({ message, action, className }: EmptyStateProps) {
  return (
    <Alert tone="neutral" action={action} className={className}>
      {message}
    </Alert>
  );
}
