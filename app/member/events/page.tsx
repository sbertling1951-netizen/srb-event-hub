"use client";

import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

type EventRow = {
  id: string;
  name: string | null;
  venue_name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  event_code: string | null;
  lat: number | null;
  lng: number | null;
  visible_to_members?: boolean | null;
  registration_open?: boolean | null;
};

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) {
    return "";
  }
  if (startDate && endDate) {
    return `${startDate} – ${endDate}`;
  }
  return startDate || endDate || "";
}

function setMemberEventContext(event: EventRow) {
  localStorage.setItem(
    "fcoc-member-event-context",
    JSON.stringify({
      id: event.id,
      name: event.name || null,
      eventName: event.name || null,
      venue_name: event.venue_name || null,
      location: event.location || null,
      start_date: event.start_date || null,
      end_date: event.end_date || null,
      event_code: event.event_code || null,
      lat: event.lat || null,
      lng: event.lng || null,
    }),
  );

  localStorage.setItem("fcoc-member-event-changed", String(Date.now()));
}

export default function MemberEventsPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [status, setStatus] = useState("Loading events...");

  const loadEvents = useCallback(async () => {
    try {
      setStatus("Loading events...");

      const { data, error } = await supabase
        .from("events")
        .select(
          "id,name,venue_name,location,start_date,end_date,event_code,lat,lng,visible_to_members,registration_open",
        )
        .eq("visible_to_members", true)
        .order("start_date", { ascending: true, nullsFirst: false });

      if (error) {
        throw error;
      }

      setEvents((data || []) as EventRow[]);
      setStatus(
        `Loaded ${(data || []).length} event${(data || []).length === 1 ? "" : "s"}.`,
      );
    } catch (err: any) {
      console.error("loadEvents error:", err);
      setEvents([]);
      setStatus(err?.message || "Failed to load events.");
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  function handleSelectEvent(event: EventRow) {
    setMemberEventContext(event);
    window.location.href = "/nearby";
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Member Events</h1>
      <p>Select an event to continue.</p>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
          marginBottom: 16,
          fontSize: 13,
          color: "#555",
        }}
      >
        {status}
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        {events.map((event) => (
          <div
            key={event.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "white",
              padding: 16,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 18 }}>
              {event.name || "Untitled event"}
            </div>

            {event.venue_name ? (
              <div style={{ color: "#555", marginTop: 4 }}>
                {event.venue_name}
              </div>
            ) : null}

            {event.location ? (
              <div style={{ color: "#555", marginTop: 4 }}>
                {event.location}
              </div>
            ) : null}

            <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
              {formatDateRange(event.start_date, event.end_date)}
            </div>

            {event.event_code ? (
              <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
                Event code: {event.event_code}
              </div>
            ) : null}

            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={() => handleSelectEvent(event)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Select Event
              </button>
            </div>
          </div>
        ))}

        {events.length === 0 ? (
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "white",
              padding: 16,
              color: "#666",
            }}
          >
            No member events available.
          </div>
        ) : null}
      </div>
    </div>
  );
}
