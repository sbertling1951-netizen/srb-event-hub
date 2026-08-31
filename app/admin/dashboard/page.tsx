"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import AdminSummaryLink from "@/components/admin/AdminSummaryLink";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { Alert, type AlertTone } from "@/components/ui/Alert";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  resolveAdminWorkingEvent,
  setCurrentAdminEvent,
  shouldPersistResolvedAdminEvent,
  useAdminWorkingEventScope,
} from "@/lib/adminWorkspaceContext";
import { isActiveEventStatus, normalizeEventStatus } from "@/lib/eventStatus";
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
// Trust Indicator: no UI is rendered until the future governed signal
// exists (components/admin/AdminTrustIndicator.tsx). The prior "Super Admin
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

type SystemStatus = {
  status: string;
  commit: string | null;
  dirty: boolean;
  environment: string;
  lastDeployedAt: string;
};

function formatEventLabel(evt: EventRow) {
  const name = evt.name || "Untitled event";
  const dates = [evt.start_date, evt.end_date].filter(Boolean).join(" – ");
  const loc = evt.location || "";
  const statusIcon = isActiveEventStatus(evt.status) ? "🟢" : "🟡";
  return [statusIcon, name, dates, loc].filter(Boolean).join(" — ");
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

// UI Phase 1 presentation grouping only -- purely a rendering/ordering
// concern layered over the same ADMIN_LEVEL1_SUMMARY_LINKS array above
// (its own order, titles, hrefs, and permissions are unchanged). Groups
// the Level-1 modules by operational likelihood (Part 4: "organize them
// by likely operational importance") without inventing any statistic:
// day-of-operations modules first, event content/support next, output
// last. A module missing from this map renders in an unlabeled trailing
// group rather than silently disappearing.
type DashboardModuleCategory = "operations" | "content" | "output";

const SUMMARY_LINK_CATEGORY: Record<string, DashboardModuleCategory> = {
  Attendees: "operations",
  "Check-In": "operations",
  Parking: "operations",
  Agenda: "content",
  Communications: "content",
  Media: "content",
  Vendors: "content",
  Reporting: "output",
};

const DASHBOARD_MODULE_SECTIONS: readonly {
  key: DashboardModuleCategory;
  title: string;
  description: string;
}[] = [
  {
    key: "operations",
    title: "Day-of Operations",
    description: "The modules you'll reach for most while the event is running.",
  },
  {
    key: "content",
    title: "Event Content & Support",
    description: "Schedule, communications, media, and vendor management.",
  },
  {
    key: "output",
    title: "Reporting & Output",
    description: "Generate reports and print name tags or coach plates.",
  },
];

// Pure, presentation-only. Derived entirely from the Event's own already-
// loaded `status` field (Event Configuration's own data, not a module-
// owned operational statistic) -- answers "am I in the expected
// workspace right now," never a count.
function eventStatusPresentation(
  status: string | null | undefined,
): { label: string; tone: "success" | "warning" | "info" } | null {
  const normalized = normalizeEventStatus(status);
  if (!normalized) {
    return null;
  }
  if (isActiveEventStatus(status)) {
    return { label: "Active", tone: "success" };
  }
  if (normalized === "draft") {
    return { label: "Draft", tone: "warning" };
  }
  if (normalized === "archived" || normalized === "inactive") {
    return { label: normalized === "archived" ? "Archived" : "Inactive", tone: "info" };
  }
  if (normalized === "closed" || normalized === "complete" || normalized === "completed") {
    return { label: "Completed", tone: "info" };
  }
  return { label: status as string, tone: "info" };
}

// Pure, presentation-only classification of the page's own existing
// status text into an Alert tone -- never a second source of the message
// itself, only how it is styled.
function dashboardStatusTone(message: string): AlertTone {
  const lower = message.toLowerCase();
  if (lower.startsWith("we couldn't") || lower.includes("no admin access")) {
    return "danger";
  }
  if (lower.includes("no longer available")) {
    return "warning";
  }
  if (lower.startsWith("admin working event changed")) {
    return "success";
  }
  return "neutral";
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
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [systemStatusState, setSystemStatusState] = useState<
    "idle" | "loading" | "unavailable"
  >(adminAccess?.isSuperAdmin ? "loading" : "idle");

  const didInitialLoad = useRef(false);
  const loadPageRef = useRef<() => void>(() => {});

  // Working-Event change (this tab or another): synchronously realign the
  // selector and drop Event A's summary data so nothing stale renders under
  // Event B's header, then reload. `captureGeneration` / `isCurrent` let
  // loadPage() reject an in-flight Event-A response.
  const { captureGeneration, isCurrent: isWorkingEventScopeCurrent } =
    useAdminWorkingEventScope(() => {
      setEvents([]);
      setSelectedEventId(getCurrentAdminEvent()?.id ?? "");
      setLoading(true);
      loadPageRef.current();
    });

  // ADR-006 §2.1/§3.1/§4: this is the admin's full *accessible* Event set
  // -- authorization-filtered only. Lifecycle status (including
  // "archived") must never gate the set Event-context resolution
  // validates a stored Event ID against ("inactive is not invalid", and
  // the ADR names "archived" as an explicit example). Archived-exclusion
  // for the picker's own display list is computed separately, below, from
  // this same full set -- exactly the accessibleEvents/loadedEvents split
  // app/admin/events/page.tsx already established for this identical
  // defect class.
  async function loadEvents(admin: AdminAccessResult | null) {
    const { data, error } = await supabase
      .from("events")
      .select("id,name,location,start_date,end_date,status")
      .order("start_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    const allEvents = (data || []) as EventRow[];

    if (!admin) {
      return [];
    }
    if (admin.isSuperAdmin) {
      return allEvents;
    }

    return allEvents.filter((evt) => canAccessEvent(admin, evt.id));
  }

  const loadPage = useCallback(async () => {
    const generation = captureGeneration();
    try {
      setLoading(true);
      if (!adminAccess) {
        setSelectedEventId("");
        setStatus("No admin access.");
        setLoading(false);
        return;
      }

      const loadedEvents = await loadEvents(adminAccess);
      // A working-Event change started a newer load while this one was in
      // flight -- discard this (Event A) result rather than clobbering the
      // selector and summary the newer load is populating for Event B.
      if (!isWorkingEventScopeCurrent(generation)) {
        return;
      }
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

      // Persist the resolved working Event back to storage ONLY when it
      // actually differs from what is already stored. setCurrentAdminEvent()
      // notifies this page's own working-Event subscription (now
      // useAdminWorkingEventScope); writing it on every load re-triggers
      // loadPage(). subscribeToAdminEventChange's scope coalescing now also
      // absorbs a redundant same-scope write, but this guard is still the
      // first line of defense: when stored === resolved the store is
      // already correct -- no write, no event, no self-trigger. A genuine
      // change (first establishment, or a different Event) persists once;
      // the follow-up load then sees equality and converges.
      if (shouldPersistResolvedAdminEvent(stored?.id, resolved.id)) {
        setCurrentAdminEvent({
          id: resolved.id,
          name: resolved.name || "Selected Event",
          eventName: resolved.name || "Selected Event",
          location: resolved.location || null,
          start_date: resolved.start_date || null,
          end_date: resolved.end_date || null,
        });
      }
    } catch (err: any) {
      console.error("loadDashboard error:", err);
      if (isWorkingEventScopeCurrent(generation)) {
        setStatus("We couldn't load the dashboard. Please try again.");
      }
    } finally {
      // A superseded (Event A) load must not clear the loading state the
      // newer Event-B load has set.
      if (isWorkingEventScopeCurrent(generation)) {
        setLoading(false);
      }
    }
  }, [adminAccess, captureGeneration, isWorkingEventScopeCurrent]);

  useEffect(() => {
    loadPageRef.current = () => void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (didInitialLoad.current) {
      return;
    }
    didInitialLoad.current = true;

    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (!adminAccess?.isSuperAdmin) {
      setSystemStatus(null);
      setSystemStatusState("idle");
      return;
    }

    let cancelled = false;
    setSystemStatusState("loading");
    void supabase.auth
      .getSession()
      .then(({ data }) => data.session?.access_token || null)
      .then((accessToken) =>
        accessToken
          ? fetch("/api/admin/system-status", {
              headers: { Authorization: `Bearer ${accessToken}` },
            })
          : null,
      )
      .then((response) => (response?.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) {
          if (!cancelled) setSystemStatusState("unavailable");
          return;
        }
        setSystemStatus(data as SystemStatus);
        setSystemStatusState("idle");
      })
      .catch(() => {
        if (!cancelled) setSystemStatusState("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [adminAccess?.isSuperAdmin]);

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
      setStatus("We couldn't switch events. Please try again.");
    } finally {
      setSwitching(false);
    }
  }

  const selectedEvent = events.find((e) => e.id === selectedEventId) || null;

  // ADR-006 §4: archived-exclusion here is presentation/discovery logic
  // only -- it governs the switcher's own option list, never the set
  // loadPage() resolves the working Event against (loadEvents, above).
  // The current working Event always remains selectable, and always
  // renders in the "Working Event" line below, even when archived --
  // an authorized archived Event stays a valid, visible working context,
  // never silently dropped from view.
  const pickerEvents = events.filter(
    (evt) =>
      evt.id === selectedEventId ||
      normalizeEventStatus(evt.status) !== "archived",
  );

  const visibleLinks = visibleAdminSummaryLinks(adminAccess);
  const eventStatus = eventStatusPresentation(selectedEvent?.status);
  const statusMessage = switching
    ? "Switching event..."
    : loading
      ? "Loading..."
      : status;
  const statusTone: AlertTone =
    switching || loading ? "info" : dashboardStatusTone(statusMessage);

  return (
    <div style={pageStyle}>
      <section aria-labelledby="dashboard-event-heading" style={sectionStyle}>
        <PageHeader
          title="Working Event"
          titleId="dashboard-event-heading"
          headingLevel="h2"
          titleClassName="app-section-title"
        />
        <div className="card" style={{ minWidth: 0 }}>
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
                className="app-form-input"
                style={{ minHeight: 44 }}
              >
                <option value="">Select an event</option>
                {pickerEvents.map((evt) => (
                  <option key={evt.id} value={evt.id}>
                    {formatEventLabel(evt)}
                  </option>
                ))}
              </select>
              {selectedEvent ? (
                <div style={workingEventLineStyle}>
                  <span>Working Event: {formatEventLabel(selectedEvent)}</span>
                  {eventStatus ? (
                    <span
                      className={`app-status-pill app-status-pill-${eventStatus.tone}`}
                    >
                      {eventStatus.label}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            {switching || loading || status ? (
              <Alert tone={statusTone}>{statusMessage}</Alert>
            ) : null}
          </div>
        </div>
      </section>

      {/* No Context Card: no governed Admin Experience Resolver exists
          yet. An absent card is architecturally correct here (see
          module-level comment above), not an omission to fill in. */}

      {visibleLinks.length === 0 ? (
        <Alert tone="neutral">
          No admin modules are enabled for your current permissions.
        </Alert>
      ) : (
        DASHBOARD_MODULE_SECTIONS.map((section) => {
          const links = visibleLinks.filter(
            (link) => (SUMMARY_LINK_CATEGORY[link.title] ?? "output") === section.key,
          );

          if (links.length === 0) {
            return null;
          }

          return (
            <section
              key={section.key}
              aria-labelledby={`dashboard-${section.key}-heading`}
              style={sectionStyle}
            >
              <PageHeader
                title={section.title}
                titleId={`dashboard-${section.key}-heading`}
                headingLevel="h2"
                titleClassName="app-section-title"
                description={section.description}
                descriptionClassName="app-subtle-text"
              />
              <div style={summaryLinkGridStyle}>
                {links.map((link) => (
                  <AdminSummaryLink
                    key={link.href}
                    title={link.title}
                    description={link.description}
                    href={link.href}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}

      {adminAccess?.isSuperAdmin && (
        <section
          aria-labelledby="dashboard-production-heading"
          className="admin-dashboard-diagnostics"
        >
          <h2
            id="dashboard-production-heading"
            className="admin-dashboard-diagnostics-heading"
          >
            Production Status
          </h2>
          {systemStatusState === "loading" ? (
            <Alert tone="neutral">Checking deployment status…</Alert>
          ) : systemStatusState === "unavailable" || !systemStatus ? (
            <Alert tone="neutral">
              Production status is currently unavailable.
            </Alert>
          ) : (
            <div className="admin-dashboard-diagnostics-grid">
              <div>Service: {systemStatus.status}</div>
              <div>Environment: {systemStatus.environment}</div>
              <div>Commit: {systemStatus.commit || "Unavailable"}</div>
              <div>Working tree: {systemStatus.dirty ? "Dirty" : "Clean"}</div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  display: "grid",
  gap: "var(--space-10)",
  minWidth: 0,
};

const sectionStyle: React.CSSProperties = {
  display: "grid",
  gap: "var(--space-4)",
  minWidth: 0,
};

// Standards-first responsive layout only (Adaptive UI Architecture §10):
// a single CSS grid that reflows by available space, no JS-computed
// breakpoint state. Matches the pattern already used elsewhere in this
// app (e.g. app/member/page.tsx's own nav grid) rather than the
// dashboard's own prior window.innerWidth-driven layout state. UI Phase
// 1: deliberately no new fixed breakpoint was added for tablet -- a
// fluid `auto-fit`/`minmax` grid already reflows continuously across
// portrait/landscape tablet widths without a hard cutoff, which is a
// stronger fit for the "test tablet, don't assume 900px" instruction
// than adding a second breakpoint would have been.
const eventSelectorGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
  gap: "var(--space-6)",
  alignItems: "end",
  marginTop: "var(--space-1)",
  minWidth: 0,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "var(--space-2)",
  fontWeight: 600,
  fontSize: "var(--font-size-body)",
  color: "var(--color-text-secondary)",
};

const workingEventLineStyle: React.CSSProperties = {
  marginTop: "var(--space-2)",
  fontSize: "var(--font-size-small)",
  color: "var(--color-text-muted)",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  flexWrap: "wrap",
};

const summaryLinkGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
  gap: "var(--space-6)",
  minWidth: 0,
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
