import type { Route } from "next";
import Link from "next/link";

import { getTenantLabel } from "@/lib/tenantLabels";

export function LoginSelector() {
  const appTitle = getTenantLabel("app_title");
  const welcomeMessage = getTenantLabel("welcome_message");
  const memberLoginLabel = getTenantLabel("member_login_label");
  const adminLoginLabel = getTenantLabel("admin_login_label");
  const links = [
    { href: "/member/login", label: memberLoginLabel },
    { href: "/admin/login", label: adminLoginLabel },
    { href: "/vendor/login", label: "Vendor Login" },
  ];

  return (
    <div style={{ padding: 30, maxWidth: 700, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>{appTitle}</h1>

      <p>{welcomeMessage}</p>

      <h2 style={{ fontSize: 16, color: "#555", marginTop: 24, marginBottom: 0 }}>
        Choose Login Type
      </h2>

      <div
        style={{
          display: "grid",
          gap: 14,
          marginTop: 12,
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
