"use client";

import type { CSSProperties } from "react";
import Link from "next/link";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";

const headerCardStyle: CSSProperties = {
  padding: 18,
  borderRadius: 14,
  border: "1px solid #ddd",
  background: "white",
};

const toolGridStyle: CSSProperties = {
  display: "grid",
  gap: 18,
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  alignItems: "stretch",
};

const baseToolCardStyle: CSSProperties = {
  minHeight: 300,
  padding: 28,
  borderRadius: 18,
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  gap: 22,
  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
};

const toolButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  width: "100%",
  maxWidth: 340,
  minHeight: 54,
  padding: "12px 16px",
  borderRadius: 14,
  border: "none",
  background: "#111827",
  color: "#ffffff",
  WebkitTextFillColor: "#ffffff",
  fontWeight: 800,
  textDecoration: "none",
  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.18)",
};

const iconCircleStyle: CSSProperties = {
  width: 66,
  height: 66,
  borderRadius: 999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 30,
  marginBottom: 18,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 28,
  lineHeight: 1.1,
  fontWeight: 900,
};

const descriptionStyle: CSSProperties = {
  margin: "16px 0 0",
  fontSize: 17,
  lineHeight: 1.45,
  color: "#374151",
};

const mapCards = [
  {
    title: "Park Maps",
    description: "Manage master park maps, site markers, and published park maps.",
    href: "/admin/master-maps",
    buttonLabel: "Open Park Maps",
    icon: "🗺️",
    cardStyle: {
      background: "linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%)",
      border: "1px solid #bbf7d0",
    },
    iconStyle: {
      background: "#dcfce7",
      color: "#16a34a",
      border: "1px solid #bbf7d0",
    },
  },
  {
    title: "Map Locations",
    description: "Manage event map locations and marker placement.",
    href: "/admin/locations",
    buttonLabel: "Open Map Locations",
    icon: "📍",
    cardStyle: {
      background: "linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)",
      border: "1px solid #bfdbfe",
    },
    iconStyle: {
      background: "#dbeafe",
      color: "#2563eb",
      border: "1px solid #bfdbfe",
    },
  },
  {
    title: "Nearby Admin",
    description: "Manage nearby places, stored area lists, and event nearby lists.",
    href: "/admin/nearby",
    buttonLabel: "Open Nearby Admin",
    icon: "👥",
    cardStyle: {
      background: "linear-gradient(135deg, #faf5ff 0%, #ffffff 100%)",
      border: "1px solid #e9d5ff",
    },
    iconStyle: {
      background: "#f3e8ff",
      color: "#9333ea",
      border: "1px solid #e9d5ff",
    },
  },
] as const;

function MapAdminPageInner() {
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card" style={headerCardStyle}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Map Admin</h1>

        <div style={{ fontSize: 14, opacity: 0.8 }}>
          Manage park maps, map markers, locations, and nearby places from one
          workspace.
        </div>
      </div>

      <div style={toolGridStyle}>
        {mapCards.map((card) => (
          <div
            key={card.href}
            className="card"
            style={{ ...baseToolCardStyle, ...card.cardStyle }}
          >
            <div>
              <div style={{ ...iconCircleStyle, ...card.iconStyle }}>
                {card.icon}
              </div>

              <h2 style={titleStyle}>{card.title}</h2>

              <p style={descriptionStyle}>{card.description}</p>
            </div>

            <Link href={card.href} style={toolButtonStyle}>
              <span>{card.buttonLabel}</span>
              <span aria-hidden="true">›</span>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MapAdminPage() {
  return (
    <AdminRouteGuard>
      <MapAdminPageInner />
    </AdminRouteGuard>
  );
}
