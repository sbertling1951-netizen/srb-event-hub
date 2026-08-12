"use client";

import { usePathname } from "next/navigation";
import { type ReactNode,useRef, useState } from "react";

import { ShellHeader } from "@/components/shell/ShellHeader";
import { ShellNav } from "@/components/shell/ShellNav";
import type { ShellConfig } from "@/components/shell/types";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";

export type AppShellProps = {
  config: ShellConfig;
  children: ReactNode;
};

/**
 * The canonical EpicentraX shell (EPICENTRAX UI STAGE 2 / 2B).
 *
 * Role-neutral infrastructure. Member, Admin, and Vendor all render this
 * exact component via their own thin adapter (components/shell/adapters/*).
 * AppShell owns shared presentation only -- brand/tenant identity,
 * workspace/Event identity, page title/context, primary navigation, mobile
 * nav trigger/drawer, account controls, optional status area, back
 * navigation, the main content frame, and responsive/safe-area behavior. It
 * never resolves business authority, infers workspace from the URL when a
 * governed value is available, or uses Experience Context to grant access
 * -- every value it renders arrives already resolved, via `config`.
 *
 * As of Stage 2B, exactly one component (`components/shell/
 * ShellTransition.tsx`) decides whether AppShell renders at all for a
 * given route (via the route registry) -- AppShell itself never renders
 * nested inside the legacy chrome frame; it owns the entire `<main>`
 * landmark and content scroll region for any route that reaches it.
 */
export function AppShell({ config, children }: AppShellProps) {
  const pathname = usePathname();
  const capabilities = useShellInterfaceCapabilities();
  const [navOpen, setNavOpen] = useState(false);
  const navTriggerRef = useRef<HTMLButtonElement>(null);

  const activeHref = config.activeHref ?? pathname ?? undefined;

  return (
    <div className={`shell-root shell-role-${config.role}`}>
      <ShellNav
        sections={config.navSections}
        accountActions={capabilities.isCompact ? config.accountActions : undefined}
        activeHref={activeHref}
        isCompact={capabilities.isCompact}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        triggerRef={navTriggerRef}
      />

      <div className="shell-body">
        <ShellHeader
          config={config}
          isCompact={capabilities.isCompact}
          navOpen={navOpen}
          onToggleNav={() => setNavOpen((value) => !value)}
          navTriggerRef={navTriggerRef}
        />

        <main className={"shell-main" + (config.contentMode === "full-bleed" ? " shell-main-full-bleed" : "")}>
          <div className="shell-content">{children}</div>
        </main>
      </div>
    </div>
  );
}
