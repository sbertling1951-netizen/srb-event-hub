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

export type ShellViewport = {
  isCompact: boolean;
  isWide: boolean;
  viewportClass: ShellViewportClass;
  /**
   * False until the post-mount effect has read the real viewport once.
   * Before that, `viewportClass` is the fixed "standard" default, not a
   * measurement -- exposed so a consumer that cares about the brief
   * post-hydration correction (e.g. to suppress a transition/animation
   * during it) can detect that window, though neither AppShell nor
   * ShellNav currently need to.
   */
  measured: boolean;
};

function computeViewportClass(width: number): ShellViewportClass {
  if (width < SHELL_BREAKPOINT_COMPACT) {
    return "compact";
  }
  if (width < SHELL_BREAKPOINT_WIDE) {
    return "standard";
  }
  return "wide";
}

/**
 * The shell's single shared responsive hook. Isolates the one remaining
 * JS-driven viewport check the shell needs (nav trigger/drawer vs. static
 * desktop nav) rather than letting matchMedia/innerWidth logic spread
 * across shell files. Governed, static breakpoints only -- carries no
 * learned or remembered device state (§J); this is not the Adaptive UI
 * Architecture's device-presentation layer, which remains Proposed.
 *
 * Hydration-safe by construction (§F, "deterministic initial state +
 * effect update"): the initial state is a fixed constant ("standard"),
 * identical on the server and on the client's first render -- it never
 * reads `window.innerWidth` synchronously during render, which is what
 * would produce a server/client markup mismatch. The real viewport is
 * measured only inside `useEffect`, strictly after hydration completes,
 * so React never compares two different DOM shapes for the same render.
 * Breakpoint semantics are kept consistent with the shell's CSS: this
 * hook's `SHELL_BREAKPOINT_COMPACT` (900) is the exact value the
 * `.shell-nav-desktop` / `.shell-nav-trigger` media queries in
 * `app/globals.css` also use, so JS and CSS never disagree about where
 * "compact" begins once both have settled (no 899/900 off-by-one).
 */
export function useShellViewport(): ShellViewport {
  const [state, setState] = useState<{ viewportClass: ShellViewportClass; measured: boolean }>({
    viewportClass: "standard",
    measured: false,
  });

  useEffect(() => {
    const update = () => setState({ viewportClass: computeViewportClass(window.innerWidth), measured: true });
    update();

    const compactQuery = window.matchMedia(`(max-width: ${SHELL_BREAKPOINT_COMPACT - 1}px)`);
    const wideQuery = window.matchMedia(`(min-width: ${SHELL_BREAKPOINT_WIDE}px)`);

    compactQuery.addEventListener("change", update);
    wideQuery.addEventListener("change", update);
    window.addEventListener("resize", update);

    return () => {
      compactQuery.removeEventListener("change", update);
      wideQuery.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return {
    isCompact: state.viewportClass === "compact",
    isWide: state.viewportClass === "wide",
    viewportClass: state.viewportClass,
    measured: state.measured,
  };
}
