import type { ReactNode } from "react";

import { OrganizerShellAdapter } from "@/components/shell/adapters/OrganizerShellAdapter";

/**
 * Wraps the entire `/organize` route family (`/organize`,
 * `/organize/account`, `/organize/[eventId]`) in the platform-neutral
 * Organizer shell. The shell route registry resolves `/organize/**` to
 * `canonical-organizer`, so root `ShellTransition` adds no legacy chrome
 * around this layout -- one shell only.
 */
export default function OrganizeLayout({ children }: { children: ReactNode }) {
  return <OrganizerShellAdapter>{children}</OrganizerShellAdapter>;
}
