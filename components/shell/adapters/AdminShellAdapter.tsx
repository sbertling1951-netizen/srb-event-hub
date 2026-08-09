"use client";

import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { buildShellBrand } from "@/components/shell/brand";
import { buildAdminNavSections } from "@/components/shell/navigation/adminNav";
import type { ShellAccountAction, ShellBackTarget, ShellContentMode } from "@/components/shell/types";
import { useAdmin } from "@/lib/adminContext";
import { useAdminWorkspace } from "@/lib/AdminWorkspaceProvider";
import { useTenant } from "@/lib/providers/TenantProvider";
import { supabase } from "@/lib/supabase";

export type AdminShellAdapterProps = {
  pageTitle?: string;
  pageSubtitle?: string;
  statusContent?: ReactNode;
  backTarget?: ShellBackTarget | null;
  contentMode?: ShellContentMode;
  children: ReactNode;
};

/**
 * Thin Admin adapter (§E). Assembles the canonical ShellConfig from
 * already-resolved Admin identity/permission context (`useAdmin`) and
 * workspace context (`useAdminWorkspace`). Navigation sections come from
 * the shared `buildAdminNavSections` model (components/shell/navigation/
 * adminNav.ts, §G) -- the same model Stage 2B introduced as the single
 * canonical source for Admin nav, consumed here and documented as the
 * source of truth `components/layout/Sidebar.tsx`'s own (currently
 * identical, currently un-deduplicated per ADR-011 §18) array should be
 * checked against.
 */
export function AdminShellAdapter({
  pageTitle,
  pageSubtitle,
  statusContent,
  backTarget,
  contentMode,
  children,
}: AdminShellAdapterProps) {
  const { admin } = useAdmin();
  const { currentEvent } = useAdminWorkspace();
  const { tenant } = useTenant();
  const navSections = buildAdminNavSections(admin);

  const accountActions: ShellAccountAction[] = [
    {
      id: "sign-out",
      label: "Sign Out",
      variant: "danger",
      onClick: () => {
        void supabase.auth.signOut().finally(() => {
          window.location.href = "/admin/login";
        });
      },
    },
  ];

  return (
    <AppShell
      config={{
        role: "admin",
        brand: buildShellBrand(tenant),
        workspace: currentEvent
          ? {
              name: currentEvent.name || currentEvent.eventName || null,
              location: currentEvent.location || currentEvent.venue_name || null,
              startDate: currentEvent.start_date || null,
              endDate: currentEvent.end_date || null,
            }
          : null,
        pageTitle,
        pageSubtitle,
        navSections,
        accountActions,
        statusContent,
        backTarget: backTarget ?? null,
        contentMode,
      }}
    >
      {children}
    </AppShell>
  );
}
