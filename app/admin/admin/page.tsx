"use client";

import Link from "next/link";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { buildAdminNavSections } from "@/components/shell/navigation/adminNav";
import { EmptyState } from "@/components/ui/EmptyState";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { useAdmin } from "@/lib/adminContext";

/**
 * Admin workspace overview (Central Navigation Batch 1) -- the landing
 * page for the "Admin" parent nav item (Admin Users, Permissions, Tenant
 * Administration, Registry Provider Catalog, Passport Refunds).
 *
 * This page performs NO permission check of its own beyond the route
 * guard below: it derives what to show by calling the exact same
 * `buildAdminNavSections()` the canonical Admin nav already calls, then
 * renders only the "admin-workspace" item's own `children` -- there is no
 * second permission map here, and there never can be one, since nothing
 * on this page inspects `admin`/`tenantAuthority` directly. Whatever the
 * sidebar/drawer would show under "Admin" is exactly, and only, what this
 * page shows -- proven by construction, not by keeping two lists in sync.
 *
 * No data query, no RPC, no mutation -- this page reads only the
 * already-resolved Admin identity/authority context every other Admin
 * page already reads via `useAdmin()` (the same hook `AdminShellAdapter`
 * itself uses), and renders static navigation cards.
 */
function AdminWorkspaceInner() {
  const { admin, tenantAuthority } = useAdmin();
  const sections = buildAdminNavSections(admin, tenantAuthority);
  const adminWorkspaceItem = sections
    .flatMap((section) => section.items)
    .find((item) => item.id === "admin-workspace");
  const links = adminWorkspaceItem?.children ?? [];

  return (
    <Page style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 16 }}>
      <PageHeader
        title="Admin"
        headingLevel="h1"
        description="Manage admin accounts, permissions, and platform-level administration."
      />

      <PageSection variant="card">
        {links.length === 0 ? (
          <EmptyState message="No admin functions are available for your account." />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {links.map((link) => (
              <Link
                key={link.id}
                href={link.href}
                className="app-card-section-muted"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: 16,
                  textDecoration: "none",
                  color: "inherit",
                  fontWeight: 600,
                }}
              >
                <span>{link.label}</span>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        )}
      </PageSection>
    </Page>
  );
}

export default function AdminWorkspacePage() {
  return (
    // Door guard matches the "Admin" parent nav item's own visibility
    // condition exactly (adminNav.ts: can_manage_admins -- every Super
    // Admin account also carries this permission by default, under
    // every base access preset in this codebase) -- not
    // can_view_admin_dashboard, an unrelated permission independently
    // toggleable via the override table keyed by privilege group and
    // permission key. Using that unrelated key could show this parent
    // link in the nav (because a child was visible) while rejecting the
    // parent's own destination.
    <AdminRouteGuard requiredPermission="can_manage_admins">
      <AdminShellAdapter pageTitle="Admin" backTarget={{ href: "/admin/dashboard", label: "Dashboard" }}>
        <AdminWorkspaceInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
