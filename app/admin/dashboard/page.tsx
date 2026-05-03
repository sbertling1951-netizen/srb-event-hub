"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { getAdminEvent } from "@/lib/getAdminEvent";
import {
  type AdminAccessResult,
  canAccessEvent,
  getCurrentAdminAccess,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

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

type SystemStatus = {
  status: string;
  commit: string | null;
  lastDeployedAt: string | null;
};

type HouseholdMember = {
  id: string;
  attendee_id: string;
};

function percent(value: number, total: number) {
  if (!total) {
    return 0;
  }
  return Math.round((value / total) * 100);
}

function formatEventLabel(evt: EventRow) {
  const name = evt.name || "Untitled event";
  const dates = [evt.start_date, evt.end_date].filter(Boolean).join(" – ");
  const loc = evt.location || "";
  // Status icon logic always shows an icon (green for active, yellow otherwise)
  const statusIcon = isActiveEventStatus(evt.status) ? "🟢" : "🟡";
  return [statusIcon, name, dates, loc].filter(Boolean).join(" — ");
}

function formatEventDateRange(evt: EventRow | null) {
  if (!evt) {
    return "";
  }
  if (evt.start_date && evt.end_date) {
    return `${evt.start_date} – ${evt.end_date}`;
  }
  return evt.start_date || evt.end_date || "";
}

function normalizeEventStatus(status?: string | null) {
  return String(status || "")
    .trim()
    .toLowerCase();
}

function isActiveEventStatus(status?: string | null) {
  const normalized = normalizeEventStatus(status);

  if (!normalized) {
    return false;
  }

  if (
    normalized === "inactive" ||
    normalized === "complete" ||
    normalized === "completed" ||
    normalized === "closed" ||
    normalized === "archived"
  ) {
    return false;
  }

  return (
    normalized === "active" ||
    normalized === "live" ||
    normalized === "open" ||
    normalized === "current" ||
    normalized.includes("active")
  );
}

function getInitialAdminEvent(): EventRow | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = getAdminEvent() as {
      id?: string;
      name?: string | null;
      location?: string | null;
      start_date?: string | null;
      end_date?: string | null;
    } | null;

    if (!stored?.id) {
      return null;
    }

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
    permission: "can_manage_events",
  },
  {
    title: "Parking",
    description: "Assign sites, track arrivals, and manage coach parking.",
    href: "/admin/parking",
    permission: "can_manage_parking",
  },
  {
    title: "Announcements",
    description: "Post updates, alerts, and member-facing notices.",
    href: "/admin/announcements",
    permission: "can_manage_announcements",
  },
  {
    title: "Nearby",
    description: "Manage nearby places shown to members for this event.",
    href: "/admin/nearby",
    permission: "can_manage_nearby",
  },
  {
    title: "Master Maps",
    description: "Manage map images and reusable master map layouts.",
    href: "/admin/master-maps",
    permission: "can_manage_master_maps",
  },
  {
    title: "Agenda",
    description: "Build and manage the event schedule and published items.",
    href: "/admin/agenda",
    permission: "can_manage_agenda",
  },
  {
    title: "Check-In",
    description: "Manage arrivals, check-in flow, and site-ready coaches.",
    href: "/admin/checkin",
    permission: "can_manage_checkin",
  },
  {
    title: "Vendors",
    description:
      "Manage event vendors, member actions, signup links, and service requests.",
    href: "/admin/vendors",
    permission: "can_manage_events",
  },
  {
    title: "Reports",
    description:
      "View and export event rosters, parking, and activity reports.",
    href: "/admin/reports",
    permission: "can_manage_reports",
  },
  {
    title: "Event Staff",
    description: "Assign event staff and manage role-based permissions.",
    href: "/admin/event-staff",
    permission: "can_manage_event_staff",
  },
  {
    title: "Locations",
    description: "Manage event locations and map-linked place details.",
    href: "/admin/locations",
    permission: "can_manage_locations",
  },
  {
    title: "Imports",
    description: "Import attendee, registration, and event source data.",
    href: "/admin/imports",
    permission: "can_manage_imports",
  },
] as const;

function MetricCard({
  label,
  value,
  footer,
}: {
  label: string;
  value: string | number;
  footer?: string;
}) {
  return (
    <div className="card" style={metricCardStyle}>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800 }}>{value}</div>
      {footer ? (
        <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}

function getAdminToolIcon(href: string) {
  if (href.includes("events")) {
    return "📅";
  }
  if (href.includes("parking")) {
    return "🅿️";
  }
  if (href.includes("announcements")) {
    return "📢";
  }
  if (href.includes("nearby")) {
    return "📍";
  }
  if (href.includes("master-maps") || href.includes("map")) {
    return "🗺️";
  }
  if (href.includes("agenda")) {
    return "🗓️";
  }
  if (href.includes("checkin")) {
    return "✅";
  }
  if (href.includes("vendors")) {
    return "🤝";
  }
  if (href.includes("reports")) {
    return "📊";
  }
  if (href.includes("event-staff")) {
    return "👥";
  }
  if (href.includes("locations")) {
    return "📌";
  }
  if (href.includes("imports")) {
    return "⬆️";
  }
  return "⚙️";
}

function getAdminToolClass(href: string) {
  if (href.includes("events")) {
    return "admin-tool-events";
  }
  if (href.includes("parking")) {
    return "admin-tool-parking";
  }
  if (href.includes("announcements")) {
    return "admin-tool-announcements";
  }
  if (href.includes("nearby")) {
    return "admin-tool-nearby";
  }
  if (href.includes("master-maps") || href.includes("map")) {
    return "admin-tool-map";
  }
  if (href.includes("agenda")) {
    return "admin-tool-agenda";
  }
  if (href.includes("checkin")) {
    return "admin-tool-checkin";
  }
  if (href.includes("vendors")) {
    return "admin-tool-vendors";
  }
  if (href.includes("reports")) {
    return "admin-tool-reports";
  }
  if (href.includes("event-staff")) {
    return "admin-tool-staff";
  }
  if (href.includes("locations")) {
    return "admin-tool-locations";
  }
  if (href.includes("imports")) {
    return "admin-tool-imports";
  }
  return "admin-tool-reports";
}

function AdminDashboardPageInner() {
  const initialEvent = getInitialAdminEvent();
  const router = useRouter();

  const [adminAccess, setAdminAccess] = useState<AdminAccessResult | null>(
    null,
  );
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState(
    initialEvent?.id || "",
  );
  const [activeEvent, setActiveEvent] = useState<EventRow | null>(initialEvent);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>(
    [],
  );
  const [status, setStatus] = useState(
    initialEvent ? "Loading attendees..." : "Loading dashboard...",
  );
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [isWide, setIsWide] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);

  const didInitialLoad = useRef(false);

  function setAdminWorkingEventContext(evt: EventRow | null) {
    try {
      if (!evt?.id) {
        return;
      }

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
        window.dispatchEvent(new CustomEvent("fcoc-admin-event-updated"));
      }
    } catch (err) {
      console.error("Could not persist admin event context:", err);
    }
  }

  async function loadEvents(admin: AdminAccessResult | null) {
    const { data, error } = await supabase
      .from("events")
      .select("id,name,location,start_date,end_date,status")
      .order("start_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    const allEvents = ((data || []) as EventRow[]).filter(
      (evt) => normalizeEventStatus(evt.status) !== "archived",
    );

    if (!admin) {
      return [];
    }
    if (admin.isSuperAdmin) {
      return allEvents;
    }

    return allEvents.filter((evt) => canAccessEvent(admin, evt.id));
  }

  async function loadDashboardForEvent(selected: EventRow | null) {
    if (!selected) {
      setActiveEvent(null);
      setAttendees([]);
      setHouseholdMembers([]);
      setStatus("No event selected. Choose one above.");
      return;
    }

    setActiveEvent(selected);
    setStatus("Loading attendees...");

    const [attendeeResult, householdResult] = await Promise.all([
      supabase
        .from("attendees")
        .select("id,arrival_status,assigned_site")
        .eq("event_id", selected.id),
      supabase
        .from("attendee_household_members")
        .select("id,attendee_id")
        .eq("event_id", selected.id),
    ]);

    if (attendeeResult.error) {
      setAttendees([]);
      setHouseholdMembers([]);
      setStatus(`Could not load attendees: ${attendeeResult.error.message}`);
      return;
    }

    if (householdResult.error) {
      setAttendees([]);
      setHouseholdMembers([]);
      setStatus(
        `Could not load household members: ${householdResult.error.message}`,
      );
      return;
    }

    setAttendees((attendeeResult.data || []) as Attendee[]);
    setHouseholdMembers((householdResult.data || []) as HouseholdMember[]);
    setStatus(
      `Loaded ${(attendeeResult.data || []).length} coaches and ${(householdResult.data || []).length} people.`,
    );
  }

  const loadPage = useCallback(async () => {
    try {
      setLoading(true);

      if (!activeEvent) {
        setStatus("Loading dashboard...");
      }

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setAdminAccess(null);
        setSelectedEventId("");
        setActiveEvent(null);
        setAttendees([]);
        setHouseholdMembers([]);
        setStatus("No admin access.");
        return;
      }

      setAdminAccess(admin);

      const loadedEvents = await loadEvents(admin);
      setEvents(loadedEvents);

      if (loadedEvents.length === 0) {
        setSelectedEventId("");
        setActiveEvent(null);
        setAttendees([]);
        setHouseholdMembers([]);
        setStatus("No events found.");
        return;
      }

      const stored = getAdminEvent();
      const activeEvents = loadedEvents.filter((e) =>
        isActiveEventStatus(e.status),
      );
      const storedEvent = loadedEvents.find((e) => e.id === stored?.id) || null;
      const currentEvent =
        loadedEvents.find((e) => e.id === activeEvent?.id) || null;

      const preferred =
        activeEvents.length > 0
          ? isActiveEventStatus(currentEvent?.status)
            ? currentEvent
            : isActiveEventStatus(storedEvent?.status)
              ? storedEvent
              : activeEvents[0]
          : storedEvent || currentEvent || loadedEvents[0];

      if (!preferred) {
        setSelectedEventId("");
        setActiveEvent(null);
        setAttendees([]);
        setHouseholdMembers([]);
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
  }, [activeEvent]);

  useEffect(() => {
    function handleResize() {
      setIsWide(window.innerWidth > 1200);
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!adminAccess?.isSuperAdmin) {
      setSystemStatus(null);
      return;
    }

    fetch("/api/admin/system-status")
      .then((res) => res.json())
      .then((data) => setSystemStatus(data as SystemStatus))
      .catch(() => setSystemStatus(null));
  }, [adminAccess?.isSuperAdmin]);

  useEffect(() => {
    if (didInitialLoad.current) {
      return;
    }
    didInitialLoad.current = true;

    void loadPage();

    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-admin-event-changed") {
        void loadPage();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [loadPage]);

  async function handleSwitchEvent(nextEventId: string) {
    if (!nextEventId) {
      return;
    }

    const nextEvent = events.find((e) => e.id === nextEventId) || null;
    if (!nextEvent) {
      return;
    }

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
    const registeredCoaches = attendees.length;

    const arrivedAttendeeIds = new Set(
      attendees
        .filter(
          (a) =>
            a.arrival_status === "arrived" || a.arrival_status === "parked",
        )
        .map((a) => a.id),
    );

    const coachesArrived = arrivedAttendeeIds.size;
    const peopleRegistered = householdMembers.length;
    const peopleArrived = householdMembers.filter((m) =>
      arrivedAttendeeIds.has(m.attendee_id),
    ).length;

    const parkedCount = attendees.filter(
      (a) => a.arrival_status === "parked",
    ).length;

    const queueSize = attendees.filter(
      (a) => a.arrival_status !== "parked",
    ).length;

    const assignedCount = attendees.filter((a) => !!a.assigned_site).length;

    return {
      registeredCoaches,
      coachesArrived,
      peopleRegistered,
      peopleArrived,
      coachArrivedPercent: percent(coachesArrived, registeredCoaches),
      peopleArrivedPercent: percent(peopleArrived, peopleRegistered),
      parkedCount,
      queueSize,
      assignedCount,
      parkedPercent: percent(parkedCount, registeredCoaches),
      assignedPercent: percent(assignedCount, registeredCoaches),
    };
  }, [attendees, householdMembers]);

  const visibleAdminCards = useMemo(() => {
    if (!adminAccess) {
      return [];
    }

    return adminCards.filter((card) =>
      hasPermission(adminAccess, card.permission),
    );
  }, [adminAccess]);

  function goTo(href: string) {
    const eventForNavigation =
      activeEvent ||
      events.find((evt) => evt.id === selectedEventId) ||
      getInitialAdminEvent();

    if (eventForNavigation?.id) {
      setAdminWorkingEventContext(eventForNavigation);
    }

    router.push(href);
  }

  return (
    <div style={pageStyle}>
      <div className="card" style={headerCardStyle}>
        <div style={headerTopRowStyle}>
          <div>
            <h1 style={{ margin: 0, marginBottom: 8 }}>Admin Dashboard</h1>
            <div style={subtleTextStyle}>
              {activeEvent?.name || "No selected event"}
              {activeEvent?.location ? ` • ${activeEvent.location}` : ""}
              {formatEventDateRange(activeEvent)
                ? ` • ${formatEventDateRange(activeEvent)}`
                : ""}
            </div>
          </div>
        </div>

        <div style={eventSelectorGridStyle}>
          <div>
            <label style={labelStyle}>Admin Working Event</label>
            <select
              value={selectedEventId}
              onChange={(e) => void handleSwitchEvent(e.target.value)}
              disabled={loading || switching}
              style={selectStyle}
            >
              <option value="">Select an event</option>
              {events.map((evt) => (
                <option key={evt.id} value={evt.id}>
                  {formatEventLabel(evt)}
                </option>
              ))}
            </select>
          </div>

          <div style={statusBoxStyle}>
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
            ? "repeat(4, minmax(0, 1fr))"
            : "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
        }}
      >
        <MetricCard
          label="Registered Coaches"
          value={
            loading && attendees.length === 0 ? "…" : metrics.registeredCoaches
          }
        />
        <MetricCard
          label="Coaches Arrived"
          value={
            loading && attendees.length === 0 ? "…" : metrics.coachesArrived
          }
          footer={`${metrics.coachArrivedPercent}%`}
        />
        <MetricCard
          label="People Registered"
          value={
            loading && householdMembers.length === 0
              ? "…"
              : metrics.peopleRegistered
          }
        />
        <MetricCard
          label="People Arrived"
          value={
            loading && householdMembers.length === 0
              ? "…"
              : metrics.peopleArrived
          }
          footer={`${metrics.peopleArrivedPercent}%`}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isWide
            ? "repeat(3, minmax(0, 1fr))"
            : "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
        }}
      >
        <MetricCard
          label="Parked"
          value={
            loading && attendees.length === 0
              ? "…"
              : `${metrics.parkedPercent}%`
          }
          footer={`${metrics.parkedCount} of ${metrics.registeredCoaches}`}
        />
        <MetricCard
          label="Queue Size"
          value={loading && attendees.length === 0 ? "…" : metrics.queueSize}
          footer="still needing final parking"
        />
        <MetricCard
          label="Assigned Sites"
          value={
            loading && attendees.length === 0
              ? "…"
              : `${metrics.assignedPercent}%`
          }
          footer={`${metrics.assignedCount} of ${metrics.registeredCoaches}`}
        />
      </div>

      {adminAccess?.isSuperAdmin && systemStatus ? (
        <div className="card" style={sectionCardStyle}>
          <div style={sectionTitleStyle}>Super Admin System Status</div>

          <div
            style={{
              display: "grid",
              gap: 10,
              fontSize: 14,
            }}
          >
            <div>
              <strong>App Health:</strong> {systemStatus.status}
            </div>

            <div>
              <strong>Last Good Deploy:</strong>{" "}
              {systemStatus.lastDeployedAt
                ? new Date(systemStatus.lastDeployedAt).toLocaleString()
                : "Unknown"}
            </div>

            <div>
              <strong>Version:</strong>{" "}
              {systemStatus.commit
                ? systemStatus.commit.slice(0, 7)
                : "Unknown"}
            </div>
          </div>
        </div>
      ) : null}

      <div className="card" style={sectionCardStyle}>
        <div style={sectionTitleStyle}>Admin Tools</div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          {visibleAdminCards.map((card) => (
            <button
              key={card.href}
              type="button"
              onClick={() => goTo(card.href)}
              className={`admin-tool-button ${getAdminToolClass(card.href)}`}
            >
              <span className="admin-tool-icon" aria-hidden="true">
                {getAdminToolIcon(card.href)}
              </span>

              <span>
                <span className="admin-tool-title">{card.title}</span>
                <span className="admin-tool-description">
                  {card.description}
                </span>
              </span>
            </button>
          ))}

          {visibleAdminCards.length === 0 ? (
            <div style={emptyCardStyle}>
              No admin tools are enabled for your current permissions.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  display: "grid",
  gap: 18,
  padding: 24,
};

const headerCardStyle: React.CSSProperties = {
  padding: 18,
};

const headerTopRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "start",
  flexWrap: "wrap",
  marginBottom: 14,
};

const subtleTextStyle: React.CSSProperties = {
  fontSize: 14,
  opacity: 0.8,
};

const eventSelectorGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(280px, 1.5fr) minmax(220px, 1fr)",
  gap: 14,
  alignItems: "end",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontWeight: 600,
  fontSize: 14,
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  background: "#fff",
  fontSize: 14,
};

const statusBoxStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 10,
  background: "#f8f9fb",
  padding: "10px 12px",
  fontSize: 14,
  color: "#444",
  minHeight: 42,
  display: "flex",
  alignItems: "center",
};

const metricCardStyle: React.CSSProperties = {
  padding: 16,
};

const sectionCardStyle: React.CSSProperties = {
  padding: 18,
};

const sectionTitleStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 18,
  marginBottom: 14,
};

const toolCardButtonStyle: React.CSSProperties = {
  textAlign: "left",
  border: "1px solid #d7dce3",
  borderRadius: 12,
  background: "white",
  padding: 18,
  cursor: "pointer",
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const emptyCardStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 12,
  background: "white",
  padding: 18,
  color: "#555",
};

export default function AdminDashboardPage() {
  return (
    <AdminRouteGuard requiredPermission="can_view_admin_dashboard">
      <AdminDashboardPageInner />
    </AdminRouteGuard>
  );
}
