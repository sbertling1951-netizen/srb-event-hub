import Link from "next/link";
import type { Route } from "next";

export default function HomePage() {
  const links = [
    { href: "/member/login", label: "Member" },
    { href: "/admin/login", label: "Admin" },
  ];

  return (
    <div style={{ padding: 30, maxWidth: 700, margin: "0 auto" }}>
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
              padding: "16px 18px",
              border: "1px solid #ddd",
              borderRadius: 10,
              textDecoration: "none",
              color: "#111",
              background: "white",
              fontWeight: 700,
              textAlign: "center",
            }}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
