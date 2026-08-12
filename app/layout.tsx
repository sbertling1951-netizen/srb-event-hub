import "./globals.css";

import type { Metadata, Viewport } from "next";

import { ShellTransition } from "@/components/shell/ShellTransition";
import { AdminProvider } from "@/lib/adminContext";
import { AdminWorkspaceProvider } from "@/lib/AdminWorkspaceProvider";
import { MemberWorkspaceProvider } from "@/lib/memberWorkspace";
import { TenantProvider } from "@/lib/providers/TenantProvider";
import { resolveCurrentRequestTenant } from "@/lib/server/tenantResolver";
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

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="app-body" suppressHydrationWarning>
        <TenantProvider tenant={tenantPresentation}>
          <AdminProvider>
            <AdminWorkspaceProvider>
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
