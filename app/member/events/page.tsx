"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { MemberShellAdapter } from "@/components/shell/adapters/MemberShellAdapter";
import { setCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import { supabase } from "@/lib/supabase";

type EventRow = {
  id: string;
  name: string | null;
  venue_name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  event_code: string | null;
  participant_capacity: number | null;
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

export default function MemberEventsPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [status, setStatus] = useState("Loading events...");
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      setStatus("Loading events...");
      setError(null);

      const { data, error } = await supabase
        .from("events")
        .select(
          "id,name,venue_name,location,start_date,end_date,event_code,participant_capacity,lat,lng,visible_to_members,registration_open",
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
    } catch (err) {
      console.error("loadEvents error:", err);
      setEvents([]);
      setError(err instanceof Error ? err.message : "Failed to load events.");
      setStatus("");
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  function handleSelectEvent(event: EventRow) {
    setCurrentMemberEvent(event);
    router.push("/nearby");
  }

  return (
    <MemberShellAdapter pageTitle="Member Events">
      <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
        <p style={{ margin: 0 }}>Select an event to continue.</p>

        {status ? (
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "#f8f9fb",
              padding: 14,
              fontSize: 13,
              color: "#555",
            }}
          >
            {status}
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            style={{
              border: "1px solid #fecaca",
              borderRadius: 10,
              background: "#fef2f2",
              color: "#991b1b",
              padding: 14,
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 14 }}>
          {events.map((event) => (
            <div
              key={event.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 10,
                background: "white",
                padding: 16,
                minWidth: 0,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 18, overflowWrap: "anywhere" }}>
                {event.name || "Untitled event"}
              </div>

              {event.venue_name ? (
                <div style={{ color: "#555", marginTop: 4, overflowWrap: "anywhere" }}>
                  {event.venue_name}
                </div>
              ) : null}

              {event.location ? (
                <div style={{ color: "#555", marginTop: 4, overflowWrap: "anywhere" }}>
                  {event.location}
                </div>
              ) : null}

              <div style={{ fontSize: 13, color: "#666", marginTop: 6, overflowWrap: "anywhere" }}>
                {formatDateRange(event.start_date, event.end_date)}
              </div>

              {event.event_code ? (
                <div style={{ fontSize: 13, color: "#666", marginTop: 4, overflowWrap: "anywhere" }}>
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
    </MemberShellAdapter>
  );
}
