import type { ReactNode } from "react";

import { Alert } from "@/components/ui/Alert";

type LoadingStateProps = {
  message?: ReactNode;
  className?: string;
};

/**
 * Canonical "this is loading" presentation -- replaces the ~40 hand-
 * written `"Loading X..."` status strings scattered across the app. A
 * thin `Alert` wrapper (`tone="info"`), reusing `AppButton`'s own
 * spinner (`.app-button-spinner`) as `Alert`'s icon override rather than
 * a second spinner implementation or a competing container.
 */
export function LoadingState({ message = "Loading…", className }: LoadingStateProps) {
  return (
    <Alert tone="info" icon={<span className="app-button-spinner" aria-hidden="true" />} className={className}>
      {message}
    </Alert>
  );
}
