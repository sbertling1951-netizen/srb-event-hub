"use client";

import { useEffect, useState } from "react";

/**
 * Shared shell-level responsive breakpoints (§H).
 *
 * Existing page-local responsive code uses inconsistent breakpoints today
 * (800 / 900 / 1100 across different pages -- see UI Stage 2 report). The
 * shell itself uses exactly one compact threshold, aligned with
 * `components/layout/Sidebar.tsx`'s existing `MOBILE_BREAKPOINT` (900) so
 * the new shell's own compact/expanded boundary does not visually disagree
 * with the legacy Sidebar it coexists with during the migration period.
 * This hook is additive -- it does not replace or modify any page-local
 * check; those may be migrated to it individually in later stages.
 */
export const SHELL_BREAKPOINT_COMPACT = 900;
export const SHELL_BREAKPOINT_WIDE = 1200;

export type ShellViewportClass = "compact" | "standard" | "wide";

/**
 * Deterministic presentation facts resolved from the current browser
 * environment. This is intentionally not a device identity, preference,
 * remembered-device record, or authority input.
 */
export type ShellInterfaceCapabilities = {
  isCompact: boolean;
  supportsPersistentNavigation: boolean;
  prefersReducedMotion: boolean;
  viewportClass: ShellViewportClass;
};

export function resolveShellInterfaceCapabilities(
  width: number,
  prefersReducedMotion = false,
): ShellInterfaceCapabilities {
  const viewportClass: ShellViewportClass =
    width < SHELL_BREAKPOINT_COMPACT
      ? "compact"
      : width < SHELL_BREAKPOINT_WIDE
        ? "standard"
        : "wide";

  const isCompact = viewportClass === "compact";

  return {
    viewportClass,
    isCompact,
    supportsPersistentNavigation: !isCompact,
    prefersReducedMotion,
  };
}

const SERVER_CAPABILITIES = resolveShellInterfaceCapabilities(
  SHELL_BREAKPOINT_COMPACT,
);

/**
 * The shell's single deterministic presentation-capability hook. Its fixed
 * server/first-client result preserves hydration safety; the browser is read
 * only after hydration, then updates width and reduced-motion facts together.
 * CSS remains authoritative for safe-area geometry.
 */
export function useShellInterfaceCapabilities(): ShellInterfaceCapabilities {
  const [capabilities, setCapabilities] = useState<ShellInterfaceCapabilities>(
    SERVER_CAPABILITIES,
  );

  useEffect(() => {
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const update = () => {
      setCapabilities(
        resolveShellInterfaceCapabilities(
          window.innerWidth,
          reducedMotionQuery.matches,
        ),
      );
    };

    update();

    const compactQuery = window.matchMedia(
      `(max-width: ${SHELL_BREAKPOINT_COMPACT - 1}px)`,
    );
    const wideQuery = window.matchMedia(
      `(min-width: ${SHELL_BREAKPOINT_WIDE}px)`,
    );

    compactQuery.addEventListener("change", update);
    wideQuery.addEventListener("change", update);
    reducedMotionQuery.addEventListener("change", update);
    window.addEventListener("resize", update);

    return () => {
      compactQuery.removeEventListener("change", update);
      wideQuery.removeEventListener("change", update);
      reducedMotionQuery.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return capabilities;
}
