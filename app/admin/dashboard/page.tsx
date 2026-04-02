"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type AdminCard = {
  title: string;
  description: string;
  href: string;
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

function getInitialAdminEvent(): EventRow | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = getAdminEvent() as {
      id?: string;
      name?: string | null;
      location?: string | null;
      start_date?: string | null;
      end_date?: string | null;
    } | null;

    if (!stored?.id) return null;

    return {
      id: stored.id,
      name: stored.name || "Selected Event",
      location: stored.location || null,
      start_date: stored.start_date || null,
      end_date: stored.end_date || null,
      status: null,
    };
  } catch (err) {
    console.error("Could not read initial admin event:", err);
    return null;
  }
}

const adminCards = [
  {
    title: "Events",
    description: "Create, edit, activate, and manage event records.",
    href: "/admin/events",
  },
  {
    title: "Parking",
    description: "Assign sites, track arrivals, and manage coach parking.",
    href: "/admin/parking",
  },
  {
    title: "Announcements",
    description: "Post updates, alerts, and member-facing notices.",
    href: "/admin/announcements",
  },
  {
    title: "Nearby",
    description: "Manage nearby places shown to members for this event.",
    href: "/admin/nearby",
  },
  {
    title: "Master Maps",
    description: "Manage map images and reusable master map layouts.",
    href: "/admin/master-maps",
  },
  {
    title: "Agenda",
    description: "Build and manage the event schedule and published items.",
    href: "/admin/agenda",
  },
];

function AdminDashboardPageInner() {
  const initialEvent = getInitialAdminEvent();

  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState(
    initialEvent?.id || "",
  );
  const [activeEvent, setActiveEvent] = useState<EventRow | null>(initialEvent);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [status, setStatus] = useState(
    initialEvent ? "Loading attendees..." : "Loading dashboard...",
  );
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [isWide, setIsWide] = useState(false);

  const didInitialLoad = useRef(false);

  useEffect(() => {
    function handleResize() {
      setIsWide(window.innerWidth > 1200);
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function setAdminWorkingEventContext(evt: EventRow | null) {
    try {
      if (!evt?.id) return;

      const payload = {
        id: evt.id,
        name: evt.name || "Selected Event",
        eventName: evt.name || "Selected Event",
        location: evt.location || null,
        start_date: evt.start_date || null,
        end_date: evt.end_date || null,
      };

      const nextValue = JSON.stringify(payload);
      const currentValue = localStorage.getItem("fcoc-admin-event-context");

      if (currentValue !== nextValue) {
        localStorage.setItem("fcoc-admin-event-context", nextValue);
        localStorage.setItem("fcoc-admin-event-changed", String(Date.now()));
      }
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

    if (error) throw error;

    return (data || []) as EventRow[];
  }

  async function loadDashboardForEvent(selected: EventRow | null) {
    if (!selected) {
      setActiveEvent(null);
      setAttendees([]);
      setStatus("No event selected. Choose one above.");
      return;
    }

    setActiveEvent(selected);
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

      if (!activeEvent) {
        setStatus("Loading dashboard...");
      }

      const loadedEvents = await loadEvents();
      setEvents(loadedEvents);

      if (loadedEvents.length === 0) {
        setSelectedEventId("");
        setActiveEvent(null);
        setAttendees([]);
        setStatus("No events found.");
        return;
      }

      const stored = getAdminEvent();
      const preferred =
        loadedEvents.find((e) => e.id === stored?.id) ||
        loadedEvents.find((e) => e.id === activeEvent?.id) ||
        loadedEvents.find((e) => e.status !== "Archived") ||
        loadedEvents[0];

      if (!preferred) {
        setSelectedEventId("");
        setActiveEvent(null);
        setAttendees([]);
        setStatus("No event selected. Choose one above.");
        return;
      }

      setSelectedEventId(preferred.id);
      setActiveEvent(preferred);
      setAdminWorkingEventContext(preferred);
      await loadDashboardForEvent(preferred);
    } catch (err: any) {
      console.error("loadDashboard error:", err);
      setStatus(err?.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (didInitialLoad.current) return;
    didInitialLoad.current = true;

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
      setActiveEvent(nextEvent);
      setStatus("Switching event...");
      setAdminWorkingEventContext(nextEvent);
      await loadDashboardForEvent(nextEvent);
      setStatus(
        `Admin working event changed to ${nextEvent.name || "Selected Event"}.`,
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

  function goTo(href: string) {
    window.location.href = href;
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginTop: 0, marginBottom: 18 }}>Admin Dashboard</h1>

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
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
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
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {activeEvent?.name ?? "No selected event"}
          </div>
          <div style={{ color: "#555", marginTop: 4 }}>
            {activeEvent?.location ?? ""}
          </div>
          {!!activeEvent?.start_date && (
            <div style={{ color: "#555", fontSize: 13, marginTop: 4 }}>
              {activeEvent.start_date}
              {activeEvent.end_date ? ` – ${activeEvent.end_date}` : ""}
            </div>
          )}
          <div style={{ fontSize: 13, marginTop: 8 }}>
            {switching
              ? "Switching event..."
              : loading && activeEvent
                ? "Refreshing dashboard..."
                : status}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isWide
            ? "repeat(5, 1fr)"
            : "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
          marginBottom: 22,
        }}
      >
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 14,
          }}
        >
          <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>
            Total Attendees
          </div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>
            {loading && attendees.length === 0 ? "…" : metrics.total}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 14,
          }}
        >
          <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>
            Arrived
          </div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>
            {loading && attendees.length === 0
              ? "…"
              : `${metrics.arrivedPercent}%`}
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
            padding: 14,
          }}
        >
          <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>
            Parked
          </div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>
            {loading && attendees.length === 0
              ? "…"
              : `${metrics.parkedPercent}%`}
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
            padding: 14,
          }}
        >
          <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>
            Queue Size
          </div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>
            {loading && attendees.length === 0 ? "…" : metrics.queueSize}
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
            padding: 14,
          }}
        >
          <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>
            Assigned Sites
          </div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>
            {loading && attendees.length === 0
              ? "…"
              : `${metrics.assignedPercent}%`}
          </div>
          <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>
            {metrics.assignedCount} of {metrics.total}
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 10,
          marginBottom: 10,
          fontWeight: 700,
          fontSize: 18,
        }}
      >
        Admin Tools
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
        }}
      >
        {adminCards.map((card) => (
          <button
            key={card.href}
            type="button"
            onClick={() => goTo(card.href)}
            style={{
              textAlign: "left",
              border: "1px solid #d7dce3",
              borderRadius: 12,
              background: "white",
              padding: 18,
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              {card.title}
            </div>
            <div style={{ fontSize: 13, color: "#555", lineHeight: 1.45 }}>
              {card.description}
            </div>
          </button>
        ))}
      </div>

      {/*
        If /admin/locations exists later, add this to adminCards:

        {
          title: "Locations",
          description: "Manage event locations, venue references, and place data.",
          href: "/admin/locations",
        }
      */}
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
