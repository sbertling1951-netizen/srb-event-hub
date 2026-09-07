"use client";

import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { buildPlatformShellBrand } from "@/components/shell/brand";
import { buildOrganizerNavSections } from "@/components/shell/navigation/organizerNav";
import type { ShellContentMode } from "@/components/shell/types";

export type OrganizerShellAdapterProps = {
  pageTitle?: string;
  pageSubtitle?: string;
  contentMode?: ShellContentMode;
  children: ReactNode;
};

/**
 * Thin Organizer adapter -- the deliberately minimal role adapter.
 *
 * Every other adapter (Member/Admin/Vendor) assembles its ShellConfig from
 * already-resolved workspace context. This one resolves nothing: the
 * self-service organizer routes are platform-neutral and pre-tenant, so
 * there is no tenant, workspace, event, member, admin, or vendor context to
 * present, and no sign-out here (shared Supabase sign-out semantics are a
 * separate product decision). It supplies only:
 *
 *   - a static, non-tenant-resolved platform brand ("Event Hub"), so the
 *     Saint George / FCOC admin identity never leaks into `/organize`;
 *   - the two fixed Organizer nav links; and
 *   - no workspace identity and no account actions.
 *
 * AppShell stays presentation-only, exactly as for the other roles. This
 * adapter adds no authority, session-resolution, localStorage,
 * tenant, or event-selection logic.
 */
export function OrganizerShellAdapter({
  pageTitle,
  pageSubtitle,
  contentMode,
  children,
}: OrganizerShellAdapterProps) {
  return (
    <AppShell
      config={{
        role: "organizer",
        brand: buildPlatformShellBrand(),
        workspace: null,
        pageTitle,
        pageSubtitle,
        navSections: buildOrganizerNavSections(),
        backTarget: null,
        contentMode,
      }}
    >
      {children}
    </AppShell>
  );
}
