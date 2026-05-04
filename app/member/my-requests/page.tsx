"use client";

import { useState, useEffect } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";

const memberGridButtonStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 12,
  border: "1px solid #ddd",
  background: "#fff",
  fontWeight: "bold",
  fontSize: 16,
  cursor: "pointer",
};

export default function MemberDashboardPage() {
  const [memberName, setMemberName] = useState<string | null>(null);

  useEffect(() => {
    const name = localStorage.getItem("fcoc-member-name");
    setMemberName(name);
  }, []);

  return (
    <MemberRouteGuard>
      <div style={{ padding: 18 }}>
        <h1>Member Dashboard</h1>
        {memberName && <p>Welcome, {memberName}!</p>}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginTop: 24,
          }}
        >
          <button
            type="button"
            onClick={() => (window.location.href = "/member/agenda")}
            style={memberGridButtonStyle}
          >
            📅 Agenda
          </button>

          <button
            type="button"
            onClick={() => (window.location.href = "/member/announcements")}
            style={memberGridButtonStyle}
          >
            📢 Announcements
          </button>

          <button
            type="button"
            onClick={() => (window.location.href = "/member/attendees")}
            style={memberGridButtonStyle}
          >
            👥 Attendees
          </button>

          <button
            type="button"
            onClick={() => (window.location.href = "/member/nearby")}
            style={memberGridButtonStyle}
          >
            📍 Nearby
          </button>

          <button
            type="button"
            onClick={() => (window.location.href = "/member/my-requests")}
            style={memberGridButtonStyle}
          >
            🧾 My Requests
          </button>
        </div>
      </div>
    </MemberRouteGuard>
  );
}
