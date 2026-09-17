import type { ShellNavItem, ShellNavSection } from "@/components/shell/types";
import type { AdminTenantAuthorityResult } from "@/lib/adminTenantAuthority";
import type { AdminAccessResult } from "@/lib/getCurrentAdminAccess";
import { hasPermission } from "@/lib/getCurrentAdminAccess";

/**
 * Single canonical Admin navigation model (Central Navigation Batch 1).
 * Pure function over already-resolved Admin access and Tenant-authority
 * results -- reads legacy permissions via the existing `hasPermission()`
 * projection and never computes or grants Authority itself, unchanged from
 * the prior flat model.
 *
 * Regrouped around Pap's approved plain-language Admin map: one flat list
 * of top-level destinations (no abstract "Operations"/"Content"/
 * "Intelligence"/"Staff & Setup" section buckets -- each destination's own
 * submenu now carries the structure those buckets used to), where most
 * top-level items are an EXISTING page promoted to also be a group's
 * landing/parent (its href, guard, and page content are completely
 * unchanged -- only its nav *label* may be the shorter group name and its
 * nav *position* may have moved), with their related destinations nested
 * as an accessible submenu (`ShellNavItem.children`) rather than flattened
 * beside them.
 *
 * Every existing gate is reused EXACTLY as it already was in the prior
 * flat model -- none loosened, tightened, replaced, or duplicated. Four
 * destinations (Validation Rules, Export, Reports, Vendor Access) had no
 * nav presence at all before this batch; each is given the closest
 * existing legacy `hasPermission` key as a best-fit visibility PROXY,
 * following exactly the precedent this file already established for
 * Imports/Event Staff (a proxy is never the authoritative gate -- the
 * real, authoritative check is always the destination route's own guard,
 * documented per item below).
 */
export function buildAdminNavSections(
  admin: AdminAccessResult | null,
  tenantAuthority: AdminTenantAuthorityResult | null = null,
  pendingPassportRefundCount = 0,
): ShellNavSection[] {
  // -- Admin workspace (new parent; Admin Users / Permissions / Tenant
  //    Administration / Registry Provider Catalog / Passport Refunds) --
  const adminWorkspaceChildren: ShellNavItem[] = [
    hasPermission(admin, "can_manage_admins") && { id: "admin-users", label: "Admin Users", href: "/admin/admin-users" },
    hasPermission(admin, "can_manage_admins") && { id: "permissions", label: "Permissions", href: "/admin/permissions" },
    admin?.isSuperAdmin && { id: "tenants", label: "Tenant Administration", href: "/admin/tenants" },
    admin?.isSuperAdmin && {
      id: "registry-providers",
      label: "Registry Provider Catalog",
      href: "/admin/registry-providers",
    },
    admin?.isSuperAdmin && {
      id: "passport-refunds",
      label: "Passport Refunds",
      href: "/admin/passport-refunds",
      ...(pendingPassportRefundCount > 0 ? { badgeCount: pendingPassportRefundCount } : {}),
    },
  ].filter(Boolean) as ShellNavItem[];

  // The Admin workspace page (/admin/admin) has no independent content of
  // its own beyond listing these five children -- unlike every other
  // parent below, which each already have a fully meaningful landing page
  // even with zero visible children. So (and only here) the parent itself
  // is also hidden once it would have nothing to show -- the general
  // "hidden children never produce a dead parent" rule extended one level
  // further for this one content-dependent case.
  const adminWorkspaceItem: ShellNavItem | false =
    adminWorkspaceChildren.length > 0 && {
      id: "admin-workspace",
      label: "Admin",
      href: "/admin/admin",
      children: adminWorkspaceChildren,
    };

  // -- Event (existing Event Admin page promoted to this group's parent;
  //    Add Event / Pre-Event Checklist / Event Staff / Engagement /
  //    Evaluations) --
  const eventChildren: ShellNavItem[] = [
    Boolean(admin) && tenantAuthority?.status === "allowed" && {
      id: "add-event",
      label: "Add Event",
      href: "/admin/events/new",
    },
    hasPermission(admin, "can_manage_events") && { id: "checklist", label: "Pre-Event Checklist", href: "/admin/checklist" },
    // Event Staff visibility hint only -- NOT an authorization boundary.
    // can_manage_event_staff is the coarse Event-Admin-preset hint;
    // tenantAuthority "allowed" covers a legitimate Tenant/Platform admin
    // regardless of an unrelated legacy global privilege preset. The
    // authoritative gate is the route's own
    // requiredEventStaffDelegationAuthority check
    // (has_any_event_staff_delegation_authority) plus, per operation,
    // resolve_event_staff_delegation() inside each governed RPC.
    (hasPermission(admin, "can_manage_event_staff") || tenantAuthority?.status === "allowed") && {
      id: "event-staff",
      label: "Event Staff",
      href: "/admin/event-staff",
    },
    // Engagement's one existing, faithfully-reproduced bypass: gated on
    // `privilege_group === "super_admin"` directly rather than through
    // `hasPermission()`, exactly as it was in the prior flat model and,
    // before that, in Sidebar.tsx's own equivalent check.
    admin?.privilege_group === "super_admin" && { id: "engagement", label: "Engagement", href: "/admin/engagement" },
    hasPermission(admin, "can_manage_reports") && { id: "evaluations", label: "Evaluations", href: "/admin/evaluations" },
  ].filter(Boolean) as ShellNavItem[];

  const eventItem: ShellNavItem | false = hasPermission(admin, "can_manage_events") && {
    id: "events",
    label: "Event",
    href: "/admin/events",
    ...(eventChildren.length > 0 ? { children: eventChildren } : {}),
  };

  // -- Attendees (existing Attendees Management page promoted to this
  //    group's parent; Check-In / Imports / Validation Rules) --
  const attendeesChildren: ShellNavItem[] = [
    hasPermission(admin, "can_manage_checkin") && { id: "checkin", label: "Check-In", href: "/admin/checkin" },
    // /admin/imports itself gates on the governed event.imports.manage
    // Task Authority (AdminRouteGuard requiredTask), not this legacy
    // permission -- can_manage_imports is used here only as the nav
    // model's existing best-fit visibility proxy, unchanged from the
    // prior flat model. The real, authoritative, per-Event check still
    // happens at the route guard regardless of what this shows.
    hasPermission(admin, "can_manage_imports") && { id: "imports", label: "Imports", href: "/admin/imports" },
    // NEW: /admin/validation-rules gates on event.validation_rules.manage,
    // a Task deliberately excluded from every default privilege-group
    // grant (supabase/migrations/20260811170000, the profile-materialization
    // seed) -- it is manual-grant-only. isSuperAdmin is the only
    // automatic grant path that ever surfaces it, so it is the closest
    // faithful proxy (a manually-granted non-super-admin simply won't see
    // this link, exactly as an under-proxied Imports-only admin already
    // doesn't see Imports today -- the route guard is still what actually
    // decides).
    admin?.isSuperAdmin && { id: "validation-rules", label: "Validation Rules", href: "/admin/validation-rules" },
  ].filter(Boolean) as ShellNavItem[];

  const attendeesItem: ShellNavItem | false =
    (hasPermission(admin, "can_manage_attendees") ||
      hasPermission(admin, "can_manage_checkin") ||
      hasPermission(admin, "can_manage_parking")) && {
      id: "attendees",
      label: "Attendees",
      href: "/admin/attendees",
      ...(attendeesChildren.length > 0 ? { children: attendeesChildren } : {}),
    };

  // -- Agenda (existing Agenda Admin page promoted to this group's
  //    parent; Agenda Categories) --
  const agendaChildren: ShellNavItem[] = [
    // /admin/agenda/categories itself carries only a bare AdminRouteGuard
    // (any authenticated admin) -- no permission or task key of its own.
    // can_manage_agenda, its parent's own gate, is the closest faithful,
    // conservative proxy: it never shows this link to fewer people than
    // could already reach Agenda itself.
    hasPermission(admin, "can_manage_agenda") && { id: "agenda-categories", label: "Agenda Categories", href: "/admin/agenda/categories" },
  ].filter(Boolean) as ShellNavItem[];

  const agendaItem: ShellNavItem | false = hasPermission(admin, "can_manage_agenda") && {
    id: "agenda",
    label: "Agenda",
    href: "/admin/agenda",
    ...(agendaChildren.length > 0 ? { children: agendaChildren } : {}),
  };

  const announcementsItem: ShellNavItem | false = hasPermission(admin, "can_manage_announcements") && {
    id: "announcements",
    label: "Announcements",
    href: "/admin/announcements",
  };

  // -- Maps (existing Map Admin page promoted to this group's parent;
  //    Master Maps / Nearby / Nearby Settings / Locations) --
  const mapsChildren: ShellNavItem[] = [
    hasPermission(admin, "can_manage_master_maps") && { id: "master-maps", label: "Master Maps", href: "/admin/master-maps" },
    hasPermission(admin, "can_manage_nearby") && { id: "nearby", label: "Nearby", href: "/admin/nearby" },
    // /admin/nearby-settings itself gates on requiredTenantAuthority, not
    // any legacy permission -- tenantAuthority "allowed" is therefore the
    // EXACT match, not a proxy.
    tenantAuthority?.status === "allowed" && { id: "nearby-settings", label: "Nearby Settings", href: "/admin/nearby-settings" },
    hasPermission(admin, "can_manage_locations") && { id: "locations", label: "Locations", href: "/admin/locations" },
  ].filter(Boolean) as ShellNavItem[];

  const mapsItem: ShellNavItem | false = hasPermission(admin, "can_manage_master_maps") && {
    id: "map-admin",
    label: "Maps",
    href: "/admin/map-admin",
    ...(mapsChildren.length > 0 ? { children: mapsChildren } : {}),
  };

  // Parking is a direct, flat top-level item per the approved map -- it is
  // deliberately NOT nested under Maps in this navigation model, even
  // though /admin/parking's own page-level `backTarget` still points to
  // Map Admin (a separate, page-content "back" affordance this batch does
  // not touch, per "do not modify destination pages").
  const parkingItem: ShellNavItem | false = hasPermission(admin, "can_manage_parking") && {
    id: "parking",
    label: "Parking",
    href: "/admin/parking",
  };

  // -- Photos (existing Photos page promoted to this group's parent;
  //    Photo Library / Slideshow) --
  const photosChildren: ShellNavItem[] = [
    // /admin/photo-library and /admin/slideshow each gate on their own
    // Task Authority (event.photos.manage / event.slideshow.manage), not
    // a legacy permission -- can_manage_reports, the parent Photos item's
    // own existing gate, is the closest faithful sibling proxy.
    hasPermission(admin, "can_manage_reports") && { id: "photo-library", label: "Photo Library", href: "/admin/photo-library" },
    hasPermission(admin, "can_manage_reports") && { id: "slideshow", label: "Slideshow", href: "/admin/slideshow" },
  ].filter(Boolean) as ShellNavItem[];

  const photosItem: ShellNavItem | false = hasPermission(admin, "can_manage_reports") && {
    id: "photos",
    label: "Photos",
    href: "/admin/photos",
    ...(photosChildren.length > 0 ? { children: photosChildren } : {}),
  };

  // -- Print (existing Print Center page promoted to this group's parent;
  //    Print Settings / Reports / Export) --
  const printChildren: ShellNavItem[] = [
    // /admin/print-settings gates on event.print.manage (Task Authority).
    hasPermission(admin, "can_manage_reports") && { id: "print-settings", label: "Print Settings", href: "/admin/print-settings" },
    // NEW: /admin/reports gates on event.reports.view (Task Authority) --
    // previously reachable only via a link inside /admin/print itself,
    // never listed in this nav model at all. Same sibling proxy as its
    // Print Center parent.
    hasPermission(admin, "can_manage_reports") && { id: "reports", label: "Reports", href: "/admin/reports" },
    // NEW: /admin/export gates on event.reports.export (Task Authority),
    // granted to the same default profile tier as every other reports
    // task except Validation Rules -- same sibling proxy.
    hasPermission(admin, "can_manage_reports") && { id: "export", label: "Export", href: "/admin/export" },
  ].filter(Boolean) as ShellNavItem[];

  const printItem: ShellNavItem | false = hasPermission(admin, "can_manage_reports") && {
    id: "print",
    label: "Print",
    href: "/admin/print",
    ...(printChildren.length > 0 ? { children: printChildren } : {}),
  };

  // -- Vendors (existing Vendor Management page promoted to this group's
  //    parent; Vendor Requests / Vendor Access) --
  const vendorsChildren: ShellNavItem[] = [
    // /admin/vendor-requests gates on event.vendors.manage (Task
    // Authority) -- can_manage_vendors, the parent's own gate, is the
    // closest faithful sibling proxy.
    hasPermission(admin, "can_manage_vendors") && { id: "vendor-requests", label: "Vendor Requests", href: "/admin/vendor-requests" },
    // NEW: /admin/vendors/access gates on requiredVendorCatalogAuthority,
    // a distinct authority check with no direct legacy permission key --
    // can_manage_vendors is the closest faithful sibling proxy, same
    // reasoning as Vendor Requests immediately above.
    hasPermission(admin, "can_manage_vendors") && { id: "vendors-access", label: "Vendor Access", href: "/admin/vendors/access" },
  ].filter(Boolean) as ShellNavItem[];

  const vendorsItem: ShellNavItem | false = hasPermission(admin, "can_manage_vendors") && {
    id: "vendors",
    label: "Vendors",
    href: "/admin/vendors",
    ...(vendorsChildren.length > 0 ? { children: vendorsChildren } : {}),
  };

  const items: ShellNavItem[] = [
    hasPermission(admin, "can_view_admin_dashboard") && { id: "dashboard", label: "Dashboard", href: "/admin/dashboard" },
    adminWorkspaceItem,
    eventItem,
    attendeesItem,
    agendaItem,
    announcementsItem,
    mapsItem,
    parkingItem,
    photosItem,
    printItem,
    vendorsItem,
  ].filter(Boolean) as ShellNavItem[];

  // One flat list, no section buckets -- Pap's approved architecture
  // replaces "Operations"/"Content"/"Intelligence"/"Staff & Setup" with
  // each destination's own submenu, not with a different set of section
  // labels. `ShellNavSection.title` stays optional/undefined here exactly
  // as the Organizer and Vendor nav models already do for their own
  // single untitled section.
  return items.length ? [{ id: "admin", items }] : [];
}

/**
 * Minimal shared projection of `buildAdminNavSections()`'s own output
 * (Central Navigation Batch 2A): the visible submenu children of exactly
 * one top-level Admin nav item, by id, for a parent-workspace "entry
 * area" surface (e.g. `/admin/events`, `/admin/attendees`) to render as
 * real links. Never a second permission/visibility computation -- calls
 * `buildAdminNavSections()` itself and reads its result, so a workspace
 * page can only ever show a link the sidebar/drawer would also show for
 * the same admin. Returns an empty array when the parent item itself is
 * not visible, or has no visible children, for this admin.
 */
export function getAdminNavItemChildren(
  admin: AdminAccessResult | null,
  tenantAuthority: AdminTenantAuthorityResult | null,
  parentId: string,
): ShellNavItem[] {
  const sections = buildAdminNavSections(admin, tenantAuthority);
  const parent = sections.flatMap((section) => section.items).find((item) => item.id === parentId);
  return parent?.children ?? [];
}
