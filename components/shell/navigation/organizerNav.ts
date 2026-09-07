import type { ShellNavSection } from "@/components/shell/types";

/**
 * Organizer navigation model (platform-neutral organizer shell).
 *
 * Static and deliberately tiny: the self-service organizer flow is a
 * pre-tenant, pre-authority context, so this nav carries no permission
 * gating, no tenant/workspace/event items, and no account (sign-out)
 * action -- unlike Member/Admin/Vendor nav. Exactly two links by product
 * decision:
 *
 *   - "Your event spaces" -> /organize   (the organizer's own start page)
 *   - "Return to EpicentraX" -> /login
 *
 * `/login` is intentional and must not become `/`: root smart-entry
 * (`app/page.tsx`) may redirect an existing admin-mode session straight
 * back into an admin workspace, which would defeat the neutrality this
 * shell exists to provide. `/login` renders the role selector without that
 * routing.
 */
export function buildOrganizerNavSections(): ShellNavSection[] {
  return [
    {
      id: "organizer",
      items: [
        { id: "event-spaces", label: "Your event spaces", href: "/organize" },
        { id: "return", label: "Return to EpicentraX", href: "/login" },
      ],
    },
  ];
}
