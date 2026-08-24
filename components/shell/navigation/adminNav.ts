import type { ShellNavItem, ShellNavSection } from "@/components/shell/types";
import type { AdminTenantAuthorityResult } from "@/lib/adminTenantAuthority";
import type { AdminAccessResult } from "@/lib/getCurrentAdminAccess";
import { hasPermission } from "@/lib/getCurrentAdminAccess";

/**
 * Single canonical Admin navigation model (§G, Stage 2B). Pure function
 * over already-resolved Admin access and Tenant-authority results. It reads
 * legacy permissions via the existing `hasPermission()` projection and the
 * Event-provisioning entry from the exact canonical
 * `AdminTenantAuthorityResult`; it never computes or grants Authority itself
 * (§L). Existing labels, hrefs, permission keys, section ordering, and the
 * one existing bypass (`Engagement` gated on
 * `privilege_group === "super_admin"` directly rather than through
 * `hasPermission`) remain faithful to the prior model; T6 adds only the
 * separately-governed Add Event entry.
 *
 * Consumed today by `AdminShellAdapter`. `Sidebar.tsx` remains frozen per
 * ADR-011 §18 and is not an Admin navigation consumer for the canonical
 * Admin route cohort; T6 therefore does not duplicate its Tenant-authority
 * projection there.
 */
export function buildAdminNavSections(
  admin: AdminAccessResult | null,
  tenantAuthority: AdminTenantAuthorityResult | null = null,
): ShellNavSection[] {
  const adminSection: ShellNavItem[] = [
    hasPermission(admin, "can_view_admin_dashboard") && { id: "dashboard", label: "Dashboard", href: "/admin/dashboard" },
    hasPermission(admin, "can_manage_events") && { id: "events", label: "Event Admin", href: "/admin/events" },
    Boolean(admin) && tenantAuthority?.status === "allowed" && {
      id: "add-event",
      label: "Add Event",
      href: "/admin/events/new",
    },
    hasPermission(admin, "can_manage_admins") && { id: "admin-users", label: "Admin Users", href: "/admin/admin-users" },
    admin?.isSuperAdmin && { id: "tenants", label: "Tenant Administration", href: "/admin/tenants" },
    hasPermission(admin, "can_manage_admins") && { id: "permissions", label: "Permissions", href: "/admin/permissions" },
  ].filter(Boolean) as ShellNavItem[];

  const opsSection: ShellNavItem[] = [
    (hasPermission(admin, "can_manage_attendees") ||
      hasPermission(admin, "can_manage_checkin") ||
      hasPermission(admin, "can_manage_parking")) && {
      id: "attendees",
      label: "Attendees Management",
      href: "/admin/attendees",
    },
    // /admin/imports itself gates on the governed event.imports.manage
    // Task Authority (AdminRouteGuard requiredTask), not this legacy
    // permission -- can_manage_imports is used here only as the nav
    // model's existing best-fit visibility proxy, the same pattern
    // already used for other Task-Authority-gated pages (Agenda,
    // Photos) in this file. It is a purpose-built key, not an
    // approximation: it already exists in the Permissions/Admin Users
    // pages and is granted to exactly the same profile
    // (event_admin, plus the super_admin bypass hasPermission always
    // grants) that the page's own event.imports.manage task defaults
    // to. The real, authoritative, per-Event check still happens at
    // the route guard regardless of what this shows.
    hasPermission(admin, "can_manage_imports") && {
      id: "imports",
      label: "Imports",
      href: "/admin/imports",
    },
    hasPermission(admin, "can_manage_checkin") && { id: "checkin", label: "Check-In", href: "/admin/checkin" },
    hasPermission(admin, "can_manage_parking") && { id: "parking", label: "Parking Admin", href: "/admin/parking" },
    hasPermission(admin, "can_manage_reports") && { id: "print", label: "Print Center", href: "/admin/print" },
    hasPermission(admin, "can_manage_vendors") && { id: "vendors", label: "Vendor Management", href: "/admin/vendors" },
  ].filter(Boolean) as ShellNavItem[];

  const contentSection: ShellNavItem[] = [
    hasPermission(admin, "can_manage_agenda") && { id: "agenda", label: "Agenda Admin", href: "/admin/agenda" },
    hasPermission(admin, "can_manage_announcements") && {
      id: "announcements",
      label: "Announcements",
      href: "/admin/announcements",
    },
    hasPermission(admin, "can_manage_reports") && { id: "photos", label: "Photos", href: "/admin/photos" },
    hasPermission(admin, "can_manage_master_maps") && { id: "map-admin", label: "Map Admin", href: "/admin/map-admin" },
  ].filter(Boolean) as ShellNavItem[];

  const intelligenceSection: ShellNavItem[] = [
    admin?.privilege_group === "super_admin" && { id: "engagement", label: "Engagement", href: "/admin/engagement" },
  ].filter(Boolean) as ShellNavItem[];

  const staffSection: ShellNavItem[] = [
    (hasPermission(admin, "can_manage_event_staff") || hasPermission(admin, "can_manage_admins")) && {
      id: "event-staff",
      label: "Event Staff",
      href: "/admin/event-staff",
    },
    hasPermission(admin, "can_manage_events") && { id: "checklist", label: "Pre-Event Checklist", href: "/admin/checklist" },
  ].filter(Boolean) as ShellNavItem[];

  const sections: (ShellNavSection | null)[] = [
    adminSection.length ? { id: "admin", title: "Admin", items: adminSection } : null,
    opsSection.length ? { id: "operations", title: "Operations", items: opsSection } : null,
    contentSection.length ? { id: "content", title: "Content", items: contentSection } : null,
    intelligenceSection.length ? { id: "intelligence", title: "Intelligence", items: intelligenceSection } : null,
    staffSection.length ? { id: "staff-setup", title: "Staff & Setup", items: staffSection } : null,
  ];

  return sections.filter((section): section is ShellNavSection => section !== null);
}
