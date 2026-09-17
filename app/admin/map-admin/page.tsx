"use client";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { getAdminNavItemChildren } from "@/components/shell/navigation/adminNav";
import { AppLinkButton } from "@/components/ui/AppButton";
import { FormActions } from "@/components/ui/FormActions";
import { PageSection } from "@/components/ui/PageSection";
import { useAdmin } from "@/lib/adminContext";
import type { AdminTenantAuthorityResult } from "@/lib/adminTenantAuthority";
import type { AdminAccessResult } from "@/lib/getCurrentAdminAccess";

/**
 * Maps parent workspace (Central Navigation Batch 2B) -- the same
 * canonical orientation-and-entry pattern already used by the Event and
 * Attendees workspaces, replacing the page's former hand-authored
 * static card grid. Links are exactly the canonical "map-admin" nav
 * item's own visible children (Master Maps, Nearby, Nearby Settings,
 * Locations) -- derived from `getAdminNavItemChildren()`, never a second
 * permission/visibility list of its own. Parking is a separate top-level
 * workspace and is never a child of "map-admin", so it never appears
 * here without any extra filtering needed.
 *
 * This page owns no map/location/nearby data of its own -- no
 * dashboard, no statistics, no search, no preview, no image -- each
 * destination module keeps full ownership of its own content.
 *
 * Exported (not merely a local closure of `MapAdminPageInner`) so the
 * test file can render this exact production component with
 * `renderToStaticMarkup`, passing already-resolved `admin`/
 * `tenantAuthority` values directly -- the same values `useAdmin()`
 * would otherwise supply -- and exercising the real
 * `getAdminNavItemChildren()` call itself, not a precomputed or
 * separately re-derived link list.
 */
export function MapsWorkspaceSection({
  admin,
  tenantAuthority,
}: {
  admin: AdminAccessResult | null;
  tenantAuthority: AdminTenantAuthorityResult | null;
}) {
  const mapsWorkspaceLinks = getAdminNavItemChildren(admin, tenantAuthority, "map-admin");

  if (mapsWorkspaceLinks.length === 0) {
    return null;
  }

  return (
    <PageSection variant="card" title="Maps Workspace">
      <p className="app-subtle-text" style={{ marginTop: 0 }}>
        The Maps workspace for park/campground maps, locations, and nearby
        places.
      </p>
      <FormActions>
        {mapsWorkspaceLinks.map((link) => (
          <AppLinkButton key={link.id} href={link.href} variant="default">
            {link.label}
          </AppLinkButton>
        ))}
      </FormActions>
    </PageSection>
  );
}

function MapAdminPageInner() {
  const { admin, tenantAuthority } = useAdmin();

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <MapsWorkspaceSection admin={admin} tenantAuthority={tenantAuthority} />
    </div>
  );
}

export default function MapAdminPage() {
  return (
    <AdminRouteGuard>
      <AdminShellAdapter pageTitle="Map Admin">
        <MapAdminPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
