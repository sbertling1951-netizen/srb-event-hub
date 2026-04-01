"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { getAdminEvent } from "@/lib/getAdminEvent";

type EventRow = {
  id: string;
  name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
};

type Attendee = {
  id: string;
  arrival_status: string | null;
  assigned_site: string | null;
};

function percent(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function formatEventLabel(evt: EventRow) {
  const name = evt.name || "Untitled event";
  const dates = [evt.start_date, evt.end_date].filter(Boolean).join(" – ");
  const loc = evt.location || "";
  return [name, dates, loc].filter(Boolean).join(" — ");
}

function AdminDashboardPageInner() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [event, setEvent] = useState<EventRow | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [status, setStatus] = useState("Loading...");
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  function setAdminWorkingEventContext(evt: EventRow | null) {
    try {
      if (!evt?.id) return;

      const payload = {
        id: evt.id,
        name: evt.name || evt.title || "Selected Event",
        title: evt.title || evt.name || "Selected Event",
        eventName: evt.name || evt.title || "Selected Event",
        location: evt.location || evt.city_state || evt.venue_name || null,
        start_date: evt.start_date || null,
        end_date: evt.end_date || null,
        event_code: evt.event_code || null,
      };

      localStorage.setItem("fcoc-admin-event-context", JSON.stringify(payload));
      localStorage.setItem("fcoc-admin-event-changed", String(Date.now()));
    } catch (err) {
      console.error("Could not persist admin event context:", err);
    }
  }

  async function loadEvents() {
    const { data, error } = await supabase
      .from("events")
      .select("id,name,location,start_date,end_date,status")
      .neq("status", "Archived")
      .order("start_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (data || []) as EventRow[];
  }

  async function loadDashboardForEvent(eventId: string) {
    const selected = events.find((e) => e.id === eventId) || null;

    if (!selected) {
      setEvent(null);
      setAttendees([]);
      setStatus("No admin working event selected.");
      return;
    }

    setEvent(selected);
    setStatus("Loading attendees...");

    const { data, error } = await supabase
      .from("attendees")
      .select("id,arrival_status,assigned_site")
      .eq("event_id", selected.id);

    if (error) {
      setAttendees([]);
      setStatus(`Could not load attendees: ${error.message}`);
      return;
    }

    setAttendees((data || []) as Attendee[]);
    setStatus(`Loaded ${(data || []).length} attendees.`);
  }

  async function loadPage() {
    try {
      setLoading(true);
      setStatus("Loading dashboard...");

      const loadedEvents = await loadEvents();
      setEvents(loadedEvents);

      if (loadedEvents.length === 0) {
        setSelectedEventId("");
        setEvent(null);
        setAttendees([]);
        setStatus("No events found.");
        return;
      }

      const stored = getAdminEvent();
      const preferred =
        loadedEvents.find((e) => e.id === stored?.id) ||
        loadedEvents.find((e) => e.status !== "Archived") ||
        loadedEvents[0];

      if (!preferred) {
        setSelectedEventId("");
        setEvent(null);
        setAttendees([]);
        setStatus("No admin working event selected.");
        return;
      }

      setSelectedEventId(preferred.id);
      setAdminWorkingEventContext(preferred);
      await loadDashboardForEvent(preferred.id);
    } catch (err: any) {
      console.error("loadDashboard error:", err);
      setStatus(err?.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPage();

    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-admin-event-changed") {
        void loadPage();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  async function handleSwitchEvent(nextEventId: string) {
    if (!nextEventId) return;

    const nextEvent = events.find((e) => e.id === nextEventId) || null;
    if (!nextEvent) return;

    try {
      setSwitching(true);
      setSelectedEventId(nextEventId);
      setAdminWorkingEventContext(nextEvent);
      await loadDashboardForEvent(nextEventId);
      setStatus(
        `Admin working event changed to ${nextEvent.name || nextEvent.title || "Selected Event"}.`,
      );
    } catch (err: any) {
      console.error("handleSwitchEvent error:", err);
      setStatus(err?.message || "Failed to switch admin event.");
    } finally {
      setSwitching(false);
    }
  }

  const metrics = useMemo(() => {
    const total = attendees.length;

    const arrivedCount = attendees.filter(
      (a) => a.arrival_status === "arrived" || a.arrival_status === "parked",
    ).length;

    const parkedCount = attendees.filter(
      (a) => a.arrival_status === "parked",
    ).length;

    const queueSize = attendees.filter(
      (a) => a.arrival_status !== "parked",
    ).length;

    const assignedCount = attendees.filter((a) => !!a.assigned_site).length;

    return {
      total,
      arrivedCount,
      parkedCount,
      queueSize,
      assignedCount,
      arrivedPercent: percent(arrivedCount, total),
      parkedPercent: percent(parkedCount, total),
      assignedPercent: percent(assignedCount, total),
    };
  }, [attendees]);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Admin Dashboard</h1>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
          marginBottom: 20,
          display: "grid",
          gap: 12,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 18 }}>Admin Working Event</div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(280px, 520px)",
            gap: 10,
          }}
        >
          <select
            value={selectedEventId}
            onChange={(e) => void handleSwitchEvent(e.target.value)}
            disabled={loading || switching}
            style={{
              padding: "10px 12px",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              background: "#fff",
              fontSize: 14,
            }}
          >
            <option value="">Select an event</option>
            {events.map((evt) => (
              <option key={evt.id} value={evt.id}>
                {formatEventLabel(evt)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ fontWeight: 700 }}>
            {event?.name || event?.title || "No selected event"}
          </div>
          <div style={{ color: "#555" }}>
            {event?.location || event?.city_state || event?.venue_name || ""}
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {switching ? "Switching event..." : status}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 18,
          }}
        >
          <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
            Total Attendees
          </div>
          <div style={{ fontSize: 34, fontWeight: 800 }}>{metrics.total}</div>
        </div>

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 18,
          }}
        >
          <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
            Arrived
          </div>
          <div style={{ fontSize: 34, fontWeight: 800 }}>
            {metrics.arrivedPercent}%
          </div>
          <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>
            {metrics.arrivedCount} of {metrics.total}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 18,
          }}
        >
          <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
            Parked
          </div>
          <div style={{ fontSize: 34, fontWeight: 800 }}>
            {metrics.parkedPercent}%
          </div>
          <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>
            {metrics.parkedCount} of {metrics.total}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 18,
          }}
        >
          <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
            Queue Size
          </div>
          <div style={{ fontSize: 34, fontWeight: 800 }}>
            {metrics.queueSize}
          </div>
          <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>
            still needing final parking
          </div>
        </div>

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 18,
          }}
        >
          <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
            Assigned Sites
          </div>
          <div style={{ fontSize: 34, fontWeight: 800 }}>
            {metrics.assignedPercent}%
          </div>
          <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>
            {metrics.assignedCount} of {metrics.total}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  return (
    <AdminRouteGuard>
      <AdminDashboardPageInner />
    </AdminRouteGuard>
  );
}
