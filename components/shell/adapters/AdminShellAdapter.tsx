"use client";

import { type ReactNode, useEffect, useState } from "react";

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
 *
 * Central Navigation Batch 2A: also derives `homeAction` (the header's
 * persistent "Dashboard" escape path) from that exact same nav model's
 * own output -- never a second `can_view_admin_dashboard` check. This is
 * the sole place `homeAction` is populated today; every other role
 * adapter leaves it unset.
 */
export function AdminShellAdapter({
  pageTitle,
  pageSubtitle,
  statusContent,
  backTarget,
  contentMode,
  children,
}: AdminShellAdapterProps) {
  const { admin, tenantAuthority } = useAdmin();
  const { currentEvent } = useAdminWorkspace();
  const { tenant } = useTenant();
  const [pendingPassportRefundCount, setPendingPassportRefundCount] = useState(0);

  useEffect(() => {
    if (!admin?.isSuperAdmin) {
      setPendingPassportRefundCount(0);
      return;
    }

    let active = true;
    void supabase
      .rpc("list_self_service_event_passport_refund_review", { p_filter: "pending" })
      .then(({ data, error }) => {
        if (active) {
          setPendingPassportRefundCount(!error && Array.isArray(data) ? data.length : 0);
        }
      });

    return () => {
      active = false;
    };
  }, [admin?.isSuperAdmin]);

  const navSections = buildAdminNavSections(admin, tenantAuthority, pendingPassportRefundCount);

  // Central Navigation Batch 2A: a persistent header "Dashboard" escape
  // path on every canonical Admin page, derived from the canonical nav
  // model's own already-computed Dashboard visibility -- never a second,
  // duplicate can_view_admin_dashboard check. Absent entirely (null) for
  // an account the nav model itself would not show Dashboard to.
  const dashboardNavItem = navSections.flatMap((section) => section.items).find((item) => item.id === "dashboard");
  const homeAction = dashboardNavItem ? { href: dashboardNavItem.href, label: dashboardNavItem.label } : null;

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
        homeAction,
        contentMode,
      }}
    >
      {children}
    </AppShell>
  );
}
