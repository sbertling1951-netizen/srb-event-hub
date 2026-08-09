import type { ReactNode } from "react";

import Sidebar from "@/components/layout/Sidebar";

export type LegacyChromeCompatProps = {
  brandTitle: string;
  brandTagline: string;
  brandLogoUrl?: string | null;
  brandLogoAlt: string;
  children: ReactNode;
};

/**
 * Legacy chrome compatibility layer (EPICENTRAX UI STAGE 2, §D; wired
 * conditionally as of STAGE 2B, §C).
 *
 * This is deliberately NOT the canonical shell (`components/shell/AppShell`).
 * It reproduces, unchanged, the exact Sidebar + tenant-brand-banner +
 * main/inner markup that previously lived inline in `app/layout.tsx`.
 * `components/layout/Sidebar.tsx` itself is untouched, per ADR-011 §18.
 *
 * As of Stage 2B, this component is rendered ONLY for routes that
 * `components/shell/routeRegistry.ts` resolves to `"legacy"` mode -- via
 * `components/shell/ShellTransition.tsx`, the sole caller. It is no
 * longer rendered unconditionally, which is what eliminated the Stage 2
 * Vendor double-shell defect (Vendor workspace routes resolve
 * `"canonical-vendor"` and never reach this component). Do not import or
 * render this component from anywhere else; that would reintroduce a
 * second, competing chrome-selection path.
 *
 * It should be retired once Member/Admin pages migrate to the canonical
 * shell (`MemberShellAdapter` / `AdminShellAdapter`) in a later,
 * separately authorized stage -- at that point Sidebar's own
 * pathname-driven mode detection becomes fully redundant with the
 * canonical shell's per-role adapters, and this wrapper (not Sidebar
 * itself) is what should be deleted first.
 */
export function LegacyChromeCompat({
  brandTitle,
  brandTagline,
  brandLogoUrl,
  brandLogoAlt,
  children,
}: LegacyChromeCompatProps) {
  return (
    <>
      <Sidebar />

      <main className="app-main">
        <div className="app-inner">
          <div className="app-header-card">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {brandLogoUrl ? (
                <img src={brandLogoUrl} alt={brandLogoAlt} style={{ height: 48, width: "auto", flexShrink: 0 }} />
              ) : null}

              <div>
                <div className="app-brand">{brandTitle}</div>
                <div className="app-subtle">{brandTagline}</div>
              </div>
            </div>
          </div>

          {children}
        </div>
      </main>
    </>
  );
}
