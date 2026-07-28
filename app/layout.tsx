import "./globals.css";

import type { Metadata, Viewport } from "next";

import Sidebar from "@/components/layout/Sidebar";
import { AdminProvider } from "@/lib/adminContext";
import { AdminWorkspaceProvider } from "@/lib/AdminWorkspaceProvider";
import { MemberWorkspaceProvider } from "@/lib/memberWorkspace";
import { getTenantLabel } from "@/lib/tenantLabels";

const appTitle = getTenantLabel("app_title");
const appDescription = getTenantLabel("app_description");
const appTagline = getTenantLabel("app_tagline");

export const metadata: Metadata = {
  title: appTitle,
  description: appDescription,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="app-body" suppressHydrationWarning>
        <AdminProvider>
          <AdminWorkspaceProvider>
            <script
              dangerouslySetInnerHTML={{
                __html: `
                  try {
                    if (window.location.search.includes("embedded=1")) {
                      document.documentElement.classList.add("admin-embedded-mode");
                      document.body.classList.add("admin-embedded-mode");
                    }

                    if (window.location.pathname.startsWith("/coach-map")) {
                      document.documentElement.classList.add("coach-map-lock");
                      document.body.classList.add("coach-map-lock");
                    }
                  } catch {}
                `,
              }}
            />

            <MemberWorkspaceProvider>
              <Sidebar />

              <main className="app-main">
                <div className="app-inner">
                  <div className="app-header-card">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <img
                        src="/fcoc-logo.png"
                        alt="FCOC"
                        style={{
                          height: 48,
                          width: "auto",
                          flexShrink: 0,
                        }}
                      />

                      <div>
                        <div className="app-brand">{appTitle}</div>
                        <div className="app-subtle">{appTagline}</div>
                      </div>
                    </div>
                  </div>

                  {children}
                </div>
              </main>
            </MemberWorkspaceProvider>
          </AdminWorkspaceProvider>
        </AdminProvider>
      </body>
    </html>
  );
}
