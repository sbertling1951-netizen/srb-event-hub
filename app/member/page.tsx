"use client";

import Link from "next/link";
import AnnouncementBanner from "@/components/AnnouncementBanner";
import { useEffect, useState } from "react";

type EventContext = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

export default function MemberDashboardPage() {
  const [ready, setReady] = useState(false);
  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);

  useEffect(() => {
    try {
      const rawEvent = localStorage.getItem("fcoc-member-event-context");
      const attendeeId = localStorage.getItem("fcoc-member-attendee-id");
      const hasArrived = localStorage.getItem("fcoc-member-has-arrived");

      if (!rawEvent) {
        window.location.href = "/member/login";
        return;
      }

      if (!attendeeId || hasArrived !== "true") {
        window.location.href = "/member/checkin";
        return;
      }

      const parsed = JSON.parse(rawEvent);
      setCurrentEvent(parsed);
    } catch (err) {
      console.error("Member dashboard load error:", err);
      window.location.href = "/member/login";
      return;
    } finally {
      setReady(true);
    }
  }, []);

  if (!ready) {
    return <div style={{ padding: 30 }}>Loading...</div>;
  }

  if (!currentEvent) {
    return null;
  }

  return (
    <div style={{ display: "grid", gap: 18, padding: 16 }}>
      <AnnouncementBanner />

      <div
        className="card"
        style={{
          padding: 18,
          border: "1px solid #ddd",
          borderRadius: 12,
          background: "#fff",
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>
          {currentEvent.name || currentEvent.eventName || "Member Dashboard"}
        </h1>

        <div style={{ fontSize: 14, opacity: 0.8 }}>
          {currentEvent.location || ""}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        <Link
          href="/agenda"
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
          Agenda
        </Link>

        <Link
          href="/member/announcements"
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
          Announcements
        </Link>

        <Link
          href="/member/attendees"
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
          Attendees
        </Link>

        <Link
          href="/member/nearby"
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
          Nearby
        </Link>
      </div>
    </div>
  );
}
