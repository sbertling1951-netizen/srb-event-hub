import './globals.css';
import type { Metadata } from 'next';
import Sidebar from '@/components/layout/Sidebar';
export const metadata: Metadata = {
  title: 'FCOC Event Hub',
  description: 'Event operations PWA starter for FCOC.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="page-shell" style={{ maxWidth: 1320 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '280px minmax(0, 1fr)',
              gap: 16,
              alignItems: 'start',
            }}
          >
            <div className="desktop-sidebar" style={{ position: 'sticky', top: 16 }}>
<Sidebar />
            </div>

            <main style={{ minWidth: 0, display: 'grid', gap: 16 }}>
              <div className="card" style={{ padding: 14 }}>
                <div className="brand">FCOC Event Hub</div>
                <div className="subtle">Your guide to schedules, parking, people, places, and admin tools.</div>
              </div>
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
