"use client";

import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { OrganizerShellAdapter } from "@/components/shell/adapters/OrganizerShellAdapter";
import type { ShellBackTarget } from "@/components/shell/types";

/**
 * Wraps the entire `/organize` route family (`/organize`,
 * `/organize/account`, `/organize/[eventId]`, `/organize/[eventId]/**`) in
 * the platform-neutral Organizer shell. The shell route registry resolves
 * `/organize/**` to `canonical-organizer`, so root `ShellTransition` adds
 * no legacy chrome around this layout -- one shell only.
 *
 * Unlike Admin/Member/Vendor, no Organizer page renders its own role
 * adapter -- this layout is the single mount point for all of them, by
 * design (the Organizer shell resolves nothing page-specific today). The
 * parent-return control therefore cannot be a per-page prop the way
 * `backTarget` is passed on Admin pages; it is derived here, once, from
 * the already-resolved route shape (`usePathname()` + the `eventId`
 * dynamic segment `useParams()` exposes when present) -- not a second
 * navigation/back mechanism, just this one shared shell's own `backTarget`
 * field computed at its single existing call site instead of duplicated
 * across 8 call sites that don't otherwise exist.
 */
export function resolveOrganizerBackTarget(
  pathname: string | null | undefined,
  eventId: string | undefined,
): ShellBackTarget | null {
  if (!eventId) {
    return null;
  }

  const eventRoot = `/organize/${encodeURIComponent(eventId)}`;
  return pathname === eventRoot
    ? { href: "/organize", label: "Your Event Spaces" }
    : { href: eventRoot, label: "This Event" };
}

export default function OrganizeLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const eventId = typeof params?.eventId === "string" ? params.eventId : undefined;

  return (
    <OrganizerShellAdapter backTarget={resolveOrganizerBackTarget(pathname, eventId)}>
      {children}
    </OrganizerShellAdapter>
  );
}
