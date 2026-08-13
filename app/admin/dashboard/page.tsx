"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import AdminSummaryLink from "@/components/admin/AdminSummaryLink";
import AdminTrustIndicator from "@/components/admin/AdminTrustIndicator";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  resolveAdminWorkingEvent,
  setCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import {
  type AdminAccessResult,
  canAccessEvent,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

// First implementation governed by
// docs/architecture/EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md and
// docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md. The
// Dashboard's job is now exactly what §3 ("the dashboard assembles entry
// points and current context; it does not become the owner of every
// operational statistic") and the Module Architecture's "Dashboard /
// Entry Surface" section require: the working-event switcher (current
// context), a Trust Indicator, at most one Context Card, and Summary
// Links to the Level-1 modules. It owns no statistic of its own -- every
// count this page previously recomputed (registered/arrived coaches,
// parked/queue/assigned-site percentages) belonged to Attendees'/
// Check-In's/Parking's own modules already
// (EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md, "C4/C5"), and is removed here,
// not relocated into a different dashboard-owned form. The underlying
// `attendees`/`attendee_household_members` data and the RPCs/tables that
// produce it are untouched; only this page's own duplicate recomputation
// of them is removed.
//
// Context Card: intentionally omitted. No Admin Experience Resolver or
// governed Admin PrimaryExperienceSignal exists yet (lib/experienceContext
// is member-only). Per EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md §6, the
// Context Card must consume governed resolver output, never UI-invented
// priority logic -- an absent card is architecturally correct here, not
// an oversight.
//
// Trust Indicator: renders a neutral, non-computing placeholder
// (components/admin/AdminTrustIndicator.tsx). The prior "Super Admin
// System Status" card polled a bespoke endpoint
// (/api/admin/system-status) and rendered its own ad hoc health display
// -- exactly the kind of non-governed, independently-aggregated status
// computation this task requires be removed rather than relabeled as the
// new Trust Indicator. That fetch and its state are removed entirely,
// not demoted into the placeholder.

type EventRow = {
  id: string;
  name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
};

function formatEventLabel(evt: EventRow) {
  const name = evt.name || "Untitled event";
  const dates = [evt.start_date, evt.end_date].filter(Boolean).join(" – ");
  const loc = evt.location || "";
  const statusIcon = isActiveEventStatus(evt.status) ? "🟢" : "🟡";
  return [statusIcon, name, dates, loc].filter(Boolean).join(" — ");
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
    const stored = getCurrentAdminEvent() as {
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

// The Level-1 Admin modules (docs/architecture/
// EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md, "Which modules deserve direct
// (Level 1) navigation"). Second-level modules (Event Configuration,
// Maps & Locations, Admin Governance, Engagement/Intelligence) are
// deliberately not represented here -- they remain reachable through
// Sidebar's existing governed navigation without crowding this surface,
// per that document's own determination.
//
// Each destination is the module's existing canonical entry route today
// -- no route is moved or merged by this change. `permission` mirrors
// components/layout/Sidebar.tsx's own gate for that exact destination
// (Attendees' three-way OR included), so a Summary Link is visible if
// and only if the equivalent Sidebar entry would be.
export type AdminSummaryLinkDefinition = {
  title: string;
  description: string;
  href: string;
  permission: readonly string[];
};

export const ADMIN_LEVEL1_SUMMARY_LINKS: readonly AdminSummaryLinkDefinition[] =
  [
    {
      title: "Attendees",
      description: "Search, edit, and review the attendee roster.",
      href: "/admin/attendees",
      permission: [
        "can_manage_attendees",
        "can_manage_checkin",
        "can_manage_parking",
      ],
    },
    {
      title: "Check-In",
      description: "Mark arrivals and confirm parking sites.",
      href: "/admin/checkin",
      permission: ["can_manage_checkin"],
    },
    {
      title: "Parking",
      description: "Assign and track coach parking sites.",
      href: "/admin/parking",
      permission: ["can_manage_parking"],
    },
    {
      title: "Agenda",
      description: "Build and publish the event schedule.",
      href: "/admin/agenda",
      permission: ["can_manage_agenda"],
    },
    {
      title: "Communications",
      description: "Post announcements and event updates.",
      href: "/admin/announcements",
      permission: ["can_manage_announcements"],
    },
    {
      title: "Media",
      description: "Review and moderate member photo uploads.",
      href: "/admin/photos",
      permission: ["can_manage_reports"],
    },
    {
      title: "Vendors",
      description: "Manage event vendors and service requests.",
      href: "/admin/vendors",
      permission: ["can_manage_vendors"],
    },
    {
      title: "Reporting",
      description: "Generate reports and print name tags or coach plates.",
      href: "/admin/print",
      permission: ["can_manage_reports"],
    },
  ];

// Pure: no I/O. Visibility is governed entirely by the already-resolved
// AdminAccessResult and the same hasPermission(...) function Sidebar.tsx
// and AdminRouteGuard already use -- never an independently-derived or
// page-local permission check.
export function visibleAdminSummaryLinks(
  admin: AdminAccessResult | null,
): AdminSummaryLinkDefinition[] {
  if (!admin) {
    return [];
  }

  return ADMIN_LEVEL1_SUMMARY_LINKS.filter((link) =>
    link.permission.some((key) => hasPermission(admin, key)),
  );
}

function AdminDashboardPageInner() {
  const initialEvent = getInitialAdminEvent();

  const { admin: adminAccess } = useAdmin();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState(
    initialEvent?.id || "",
  );
  const [status, setStatus] = useState(
    initialEvent ? "" : "Loading dashboard...",
  );
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  const didInitialLoad = useRef(false);

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

  const loadPage = useCallback(async () => {
    try {
      setLoading(true);
      if (!adminAccess) {
        setSelectedEventId("");
        setStatus("No admin access.");
        setLoading(false);
        return;
      }

      const loadedEvents = await loadEvents(adminAccess);
      setEvents(loadedEvents);

      if (loadedEvents.length === 0) {
        setSelectedEventId("");
        setStatus("No events found.");
        return;
      }

      const stored = getCurrentAdminEvent();
      const activeEvents = loadedEvents.filter((e) =>
        isActiveEventStatus(e.status),
      );

      // ADR-006 §2: a stored Event ID is restored unchanged if it still
      // exists in the admin's full accessible set, regardless of
      // lifecycle status. Only when no Event has ever been stored does
      // this page apply its own default policy (prefer the first active
      // Event, else the first accessible Event).
      const { event: resolved, invalidStoredContext } =
        resolveAdminWorkingEvent(
          loadedEvents,
          stored,
          activeEvents[0] || loadedEvents[0] || null,
        );

      if (!resolved) {
        setSelectedEventId("");
        setStatus(
          invalidStoredContext
            ? "Your previously selected event is no longer available. Choose one above."
            : "No event selected. Choose one above.",
        );
        return;
      }

      setSelectedEventId(resolved.id);
      setStatus("");
      setCurrentAdminEvent({
        id: resolved.id,
        name: resolved.name || "Selected Event",
        eventName: resolved.name || "Selected Event",
        location: resolved.location || null,
        start_date: resolved.start_date || null,
        end_date: resolved.end_date || null,
      });
    } catch (err: any) {
      console.error("loadDashboard error:", err);
      setStatus(err?.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, [adminAccess]);

  useEffect(() => {
    if (didInitialLoad.current) {
      return;
    }
    didInitialLoad.current = true;

    void loadPage();

    const unsubscribe = subscribeToAdminWorkspace(() => {
      void loadPage();
    });

    return unsubscribe;
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
      setCurrentAdminEvent({
        id: nextEvent.id,
        name: nextEvent.name || "Selected Event",
        eventName: nextEvent.name || "Selected Event",
        location: nextEvent.location || null,
        start_date: nextEvent.start_date || null,
        end_date: nextEvent.end_date || null,
      });
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

  const visibleLinks = visibleAdminSummaryLinks(adminAccess);

  return (
    <div style={pageStyle}>
      <div className="card" style={headerCardStyle}>
        <div style={eventSelectorGridStyle}>
          <div style={{ minWidth: 0 }}>
            <label style={labelStyle} htmlFor="admin-working-event">
              Admin Working Event
            </label>
            <select
              id="admin-working-event"
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

          {(switching || loading || status) && (
            <div style={statusBoxStyle} aria-live="polite">
              {switching
                ? "Switching event..."
                : loading
                  ? "Loading..."
                  : status}
            </div>
          )}
        </div>
      </div>

      <AdminTrustIndicator />

      {/* No Context Card: no governed Admin Experience Resolver exists
          yet. An absent card is architecturally correct here (see
          module-level comment above), not an omission to fill in. */}

      <div style={summaryLinkGridStyle}>
        {visibleLinks.map((link) => (
          <AdminSummaryLink
            key={link.href}
            title={link.title}
            description={link.description}
            href={link.href}
          />
        ))}

        {visibleLinks.length === 0 ? (
          <div style={emptyCardStyle}>
            No admin modules are enabled for your current permissions.
          </div>
        ) : null}
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  display: "grid",
  gap: 18,
  minWidth: 0,
};

const headerCardStyle: React.CSSProperties = {
  padding: 18,
  minWidth: 0,
};

// Standards-first responsive layout only (Adaptive UI Architecture §10):
// a single CSS grid that reflows by available space, no JS-computed
// breakpoint state. Matches the pattern already used elsewhere in this
// app (e.g. app/member/page.tsx's own nav grid) rather than the
// dashboard's own prior window.innerWidth-driven layout state.
const eventSelectorGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
  gap: 14,
  alignItems: "end",
  marginTop: 4,
  minWidth: 0,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontWeight: 600,
  fontSize: 14,
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  background: "#fff",
  fontSize: 14,
  minHeight: 44,
};

const statusBoxStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #ddd",
  borderRadius: 10,
  background: "#f8f9fb",
  padding: "10px 12px",
  fontSize: 14,
  color: "#444",
  minHeight: 42,
  display: "flex",
  alignItems: "center",
  minWidth: 0,
  overflowWrap: "anywhere",
};

const summaryLinkGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
  gap: 14,
  minWidth: 0,
};

const emptyCardStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 12,
  background: "white",
  padding: 18,
  color: "#555",
  minWidth: 0,
  overflowWrap: "anywhere",
};

export default function AdminDashboardPage() {
  return (
    <AdminRouteGuard requiredPermission="can_view_admin_dashboard">
      <AdminShellAdapter pageTitle="Admin Dashboard">
        <AdminDashboardPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
