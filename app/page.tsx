import Link from "next/link";
import type { Route } from "next";

export default function HomePage() {
  const links = [
    { href: "/member/login", label: "Member Login" },
    { href: "/admin/login", label: "Admin Login" },
    { href: "/member/events", label: "Events" },

    { href: "/coach-map/public", label: "Coach Map (Public)" },

    { href: "/admin/imports", label: "Admin CSV Import" },
    { href: "/admin/parking", label: "Parking Map Admin" },
    { href: "/admin/dashboard", label: "Admin Dashboard" },
  ];

  return (
    <div style={{ padding: 30 }}>
      <h1 style={{ marginTop: 0 }}>FCOC Event Hub</h1>

      <p>Welcome to the Freightliner Chassis Owners Club event app.</p>

      <div
        style={{
          display: "grid",
          gap: 14,
          marginTop: 20,
        }}
      >
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href as Route}
            style={{
              display: "block",
              padding: "14px 16px",
              border: "1px solid #ddd",
              borderRadius: 10,
              textDecoration: "none",
              color: "#111",
              background: "white",
              fontWeight: 600,
            }}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
