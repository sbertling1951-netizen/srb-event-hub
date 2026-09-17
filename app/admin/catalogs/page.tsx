"use client";

import Link from "next/link";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { buildAdminNavSections } from "@/components/shell/navigation/adminNav";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { useAdmin } from "@/lib/adminContext";

/**
 * Catalogs workspace overview (Batch 3A) -- the landing page for the
 * "Catalogs" parent nav item. Reusable, curated platform reference data
 * lives here, distinct from operational workspaces.
 *
 * This page performs NO permission check of its own beyond the route
 * guard below: it derives what to show by calling the exact same
 * `buildAdminNavSections()` the canonical Admin nav already calls, then
 * renders only the "catalogs" item's own `children` -- there is no
 * second permission map here, and there never can be one, since nothing
 * on this page inspects `admin`/`tenantAuthority` directly. Whatever the
 * sidebar/drawer would show under "Catalogs" is exactly, and only, what
 * this page shows.
 *
 * No data query, no RPC, no mutation, and no catalog/vendor/venue/
 * Organizer/Event/private-plan data of any kind -- this page reads only
 * the already-resolved Admin identity/authority context every other
 * Admin page already reads via `useAdmin()` (the same hook
 * `AdminShellAdapter` itself uses), and renders static navigation links.
 *
 * The projected children list cannot actually be empty in practice --
 * this page's own route guard and the "catalogs" nav item's own
 * visibility condition are the same Super-Admin gate, and its one
 * current child (Registry Provider Catalog) shares that same gate too --
 * but the workspace section is still rendered conditionally on the real
 * projection, not asserted non-empty, so nothing here invents a second
 * access decision or a fallback for a case the nav model does not
 * actually produce.
 */
function CatalogsWorkspaceInner() {
  const { admin, tenantAuthority } = useAdmin();
  const sections = buildAdminNavSections(admin, tenantAuthority);
  const catalogsItem = sections.flatMap((section) => section.items).find((item) => item.id === "catalogs");
  const catalogLinks = catalogsItem?.children ?? [];

  return (
    <Page style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 16 }}>
      <PageHeader
        title="Catalogs"
        headingLevel="h1"
        description="Reusable, curated reference data maintained by the platform, separate from day-to-day operational workspaces."
      />

      {catalogLinks.length > 0 ? (
        <PageSection variant="card">
          <div style={{ display: "grid", gap: 10 }}>
            {catalogLinks.map((link) => (
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
        </PageSection>
      ) : null}
    </Page>
  );
}

export default function CatalogsWorkspacePage() {
  return (
    // Door guard matches the "Catalogs" parent nav item's own visibility
    // condition exactly -- the same gate its own Registry Provider
    // Catalog child, and that child's own route guard, both already use.
    // Using a broader gate could show this parent link in the nav while
    // rejecting its own destination; a narrower one could hide the
    // destination behind a visible link.
    <AdminRouteGuard requiredPlatformAuthority>
      <AdminShellAdapter pageTitle="Catalogs" backTarget={{ href: "/admin/dashboard", label: "Dashboard" }}>
        <CatalogsWorkspaceInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
