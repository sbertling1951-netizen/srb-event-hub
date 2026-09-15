import "./globals.css";

import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";

import LegacyTransferInitiator from "@/components/auth/LegacyTransferInitiator";
import { ShellTransition } from "@/components/shell/ShellTransition";
import { AdminProvider } from "@/lib/adminContext";
import { AdminWorkspaceProvider } from "@/lib/AdminWorkspaceProvider";
import { MemberWorkspaceProvider } from "@/lib/memberWorkspace";
import { TenantProvider } from "@/lib/providers/TenantProvider";
import { resolveCurrentRequestTenant } from "@/lib/server/tenantResolver";
import { buildTenantBrandOverrides } from "@/lib/tenantBrandOverrides";
import { toTenantPresentation } from "@/lib/tenantContext";
import { DEFAULT_TENANT_LABELS } from "@/lib/tenantLabels";

export async function generateMetadata(): Promise<Metadata> {
  const resolution = await resolveCurrentRequestTenant();
  const tenant = resolution.state === "resolved" ? resolution.tenant : null;

  return {
    title: tenant?.appTitle || DEFAULT_TENANT_LABELS.app_title,
    description: DEFAULT_TENANT_LABELS.app_description,
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const resolution = await resolveCurrentRequestTenant();
  const tenant = resolution.state === "resolved" ? resolution.tenant : null;
  const tenantPresentation = toTenantPresentation(tenant);

  const brandTitle = tenant?.appTitle || DEFAULT_TENANT_LABELS.app_title;
  const brandTagline = tenant?.appTagline || DEFAULT_TENANT_LABELS.app_tagline;
  const brandLogoUrl = tenant?.logoUrl;
  const brandLogoAlt = tenant?.displayName || "Event logo";

  // Tier 1 -> Tier 2: only after a successful resolution does the already-
  // resolved presentation-safe color data get projected into the runtime
  // CSS custom-property layer (docs/architecture/
  // EPICENTRAX_RUNTIME_TENANT_BRANDING_TOKEN_CONTRACT.md). An unresolved
  // Tenant, or a Tenant with no usable brand colors, yields no style
  // attribute at all -- ordinary neutral Tier 3 rendering, unchanged.
  const tenantBrandOverrides = tenant
    ? buildTenantBrandOverrides({
        primaryColor: tenant.primaryColor,
        secondaryColor: tenant.secondaryColor,
        accentColor: tenant.accentColor,
      })
    : {};
  const htmlStyle =
    Object.keys(tenantBrandOverrides).length > 0
      ? (tenantBrandOverrides as CSSProperties)
      : undefined;

  return (
    <html lang="en" suppressHydrationWarning style={htmlStyle}>
      <body className="app-body" suppressHydrationWarning>
        <TenantProvider tenant={tenantPresentation}>
          <AdminProvider>
            <AdminWorkspaceProvider>
              <LegacyTransferInitiator />
              <script
                dangerouslySetInnerHTML={{
                  __html: `
                  try {
                    if (window.location.pathname.startsWith("/coach-map")) {
                      document.documentElement.classList.add("coach-map-lock");
                      document.body.classList.add("coach-map-lock");
                    }
                  } catch {}
                  `,
                }}
              />

            <MemberWorkspaceProvider>
              <ShellTransition
                brandTitle={brandTitle}
                brandTagline={brandTagline}
                brandLogoUrl={brandLogoUrl}
                brandLogoAlt={brandLogoAlt}
              >
                {children}
              </ShellTransition>
            </MemberWorkspaceProvider>
            </AdminWorkspaceProvider>
          </AdminProvider>
        </TenantProvider>
      </body>
    </html>
  );
}
