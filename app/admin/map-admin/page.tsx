
"use client";

import Link from "next/link";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";

const cardStyle = {

  padding: 18,

  borderRadius: 14,

  border: "1px solid #ddd",

  background: "white",

};

const primaryButtonStyle = {

  display: "inline-block",

  padding: "10px 14px",

  borderRadius: 10,

  border: "none",

  background: "#111827",

  color: "white",

  fontWeight: 700,

  textDecoration: "none",

};

const secondaryButtonStyle = {

  display: "inline-block",

  padding: "10px 14px",

  borderRadius: 10,

  border: "1px solid #ccc",

  background: "white",

  color: "#111827",

  fontWeight: 700,

  textDecoration: "none",

};

function MapAdminPageInner() {

  return (

    <div style={{ display: "grid", gap: 18 }}>

      <div className="card" style={cardStyle}>

        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Map Admin</h1>

        <div style={{ fontSize: 14, opacity: 0.8 }}>

          Manage park maps, map markers, locations, and nearby places from one

          workspace.

        </div>

      </div>

      <div

        style={{

          display: "grid",

          gap: 18,

          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",

        }}

      >

        <div className="card" style={cardStyle}>

          <h2 style={{ marginTop: 0 }}>Park Maps</h2>

          <p>Manage master park maps, site markers, and published park maps.</p>

          <Link href="/admin/master-maps" style={primaryButtonStyle}>

            Open Park Maps

          </Link>

        </div>

        <div className="card" style={cardStyle}>

          <h2 style={{ marginTop: 0 }}>Map Locations</h2>

          <p>Manage event map locations and marker placement.</p>

          <Link href="/admin/locations" style={secondaryButtonStyle}>

            Open Map Locations

          </Link>

        </div>

        <div className="card" style={cardStyle}>

          <h2 style={{ marginTop: 0 }}>Nearby Admin</h2>

          <p>Manage nearby places, stored area lists, and event nearby lists.</p>

          <Link href="/admin/nearby" style={secondaryButtonStyle}>

            Open Nearby Admin

          </Link>

        </div>

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

