"use client";

import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { buildShellBrand } from "@/components/shell/brand";
import { buildMemberNavSections } from "@/components/shell/navigation/memberNav";
import type { ShellAccountAction, ShellBackTarget, ShellContentMode } from "@/components/shell/types";
import { useMemberWorkspace } from "@/lib/memberWorkspace";
import { useTenant } from "@/lib/providers/TenantProvider";
import { supabase } from "@/lib/supabase";
import { getTenantLabel } from "@/lib/tenantLabels";

export type MemberShellAdapterProps = {
  pageTitle?: string;
  pageSubtitle?: string;
  statusContent?: ReactNode;
  backTarget?: ShellBackTarget | null;
  contentMode?: ShellContentMode;
  children: ReactNode;
};

/**
 * Thin Member adapter (§E). Assembles the canonical ShellConfig from
 * already-resolved Member workspace context; owns no shell presentation of
 * its own. Renders the same AppShell as Admin and Vendor.
 */
export function MemberShellAdapter({
  pageTitle,
  pageSubtitle,
  statusContent,
  backTarget,
  contentMode,
  children,
}: MemberShellAdapterProps) {
  const { event } = useMemberWorkspace();
  const { tenant } = useTenant();
  const navSections = buildMemberNavSections({ mapNavLabel: getTenantLabel("map_nav_label") });

  // Combines two already-resolved fields (`event.venue_name`, `event.location`)
  // into the single `location` slot ShellWorkspaceIdentity carries -- not a
  // new context source, just reshaping already-fetched data for display, so
  // the shell's one workspace-metadata line fully covers what the former
  // page-local event block (Stage 3, removed) showed as two separate lines.
  const combinedLocation = event ? [event.venue_name, event.location].filter(Boolean).join(" — ") || null : null;

  const accountActions: ShellAccountAction[] = [
    {
      id: "sign-out",
      label: "Sign Out",
      variant: "danger",
      onClick: () => {
        void supabase.auth.signOut().finally(() => {
          window.location.href = "/member/login";
        });
      },
    },
  ];

  return (
    <AppShell
      config={{
        role: "member",
        brand: buildShellBrand(tenant),
        workspace: event
          ? {
              name: event.name || event.eventName,
              location: combinedLocation,
              startDate: event.start_date,
              endDate: event.end_date,
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
