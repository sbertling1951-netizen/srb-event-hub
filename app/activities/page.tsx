"use client";

import { useEffect, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";

type MemberEventRow = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) {return "";}
  if (startDate && endDate) {return `${startDate} – ${endDate}`;}
  return startDate || endDate || "";
}

function ActivitiesPageInner() {
  const [event, setEvent] = useState<MemberEventRow | null>(null);
  const [status, setStatus] = useState("Loading activities...");

  useEffect(() => {
    loadPage();

    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-member-event-changed") {
        loadPage();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  function loadPage() {
    const memberEvent = getCurrentMemberEvent();

    if (!memberEvent?.id) {
      setEvent(null);
      setStatus("No current event selected.");
      return;
    }

    setEvent(memberEvent);
    setStatus("Activities page ready.");
  }

  const dateRange = formatDateRange(event?.start_date, event?.end_date);

  return (
    <div style={{ padding: 24, display: "grid", gap: 16 }}>
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Activities</h1>

        <div style={{ fontWeight: 700 }}>
          Current event: {event?.name || event?.eventName || "No current event"}
        </div>

        {event?.venue_name ? (
          <div style={{ color: "#555", marginTop: 4 }}>{event.venue_name}</div>
        ) : null}

        {event?.location ? (
          <div style={{ color: "#555", marginTop: 4 }}>{event.location}</div>
        ) : null}

        {dateRange ? (
          <div style={{ color: "#666", marginTop: 4, fontSize: 13 }}>
            {dateRange}
          </div>
        ) : null}

        <div style={{ marginTop: 10, fontSize: 13, color: "#666" }}>
          {status}
        </div>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 16,
          color: "#666",
        }}
      >
        Activities content can be added here next.
      </div>
    </div>
  );
}

export default function ActivitiesPage() {
  return (
    <MemberRouteGuard>
      <ActivitiesPageInner />
    </MemberRouteGuard>
  );
}
