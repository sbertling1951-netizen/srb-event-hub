import "./globals.css";
import type { Metadata, Viewport } from "next";
import Sidebar from "@/components/layout/Sidebar";

export const metadata: Metadata = {
  title: "FCOC Event Hub",
  description: "Event operations PWA starter for FCOC.",
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
    <html lang="en">
      <body className="app-body">
        <Sidebar />

        <main className="app-main">
          <div className="app-inner">
            <div className="app-header-card">
              <div className="app-brand">FCOC Event Hub</div>
              <div className="app-subtle">
                Your guide to schedules, parking, people, places, and admin
                tools.
              </div>
            </div>

            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
