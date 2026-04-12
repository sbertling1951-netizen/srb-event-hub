"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import {
  getCurrentAdminAccess,
  canAccessEvent,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";

type EventContext = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type AttendeeRow = {
  id: string;
  event_id: string;
  entry_id: string | null;
  email: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  nickname: string | null;
  copilot_nickname: string | null;
  membership_number: string | null;
  primary_phone: string | null;
  cell_phone: string | null;
  city: string | null;
  state: string | null;
  wants_to_volunteer: boolean | null;
  is_first_timer: boolean | null;
  coach_manufacturer: string | null;
  coach_model: string | null;
  special_events_raw: string | null;
  assigned_site: string | null;
  has_arrived: boolean | null;
  share_with_attendees: boolean | null;
  is_active: boolean;
  inactive_reason: string | null;
  participant_type?: string | null;
  source_type?: string | null;
  include_in_headcount?: boolean | null;
  needs_name_tag?: boolean | null;
  needs_coach_plate?: boolean | null;
  needs_parking?: boolean | null;
  notes?: string | null;
  created_at?: string | null;
};

type ParkingSiteRow = {
  id: string;
  event_id: string;
  site_number: string | null;
  display_label: string | null;
  assigned_attendee_id: string | null;
};

type ViewFilter =
  | "all"
  | "active"
  | "inactive"
  | "arrived"
  | "not_arrived"
  | "first_timers"
  | "volunteers"
  | "vendors"
  | "staff_hosts_helpers"
  | "needs_parking"
  | "assigned_site"
  | "unassigned_site";

type SortType = "name_asc" | "name_desc" | "site_asc" | "site_desc";

type DisplayRow = {
  id: string;
  site: string;
  participantType: string;
  pilot: string;
  copilot: string;
  email: string;
  cityState: string;
  arrived: string;
  active: string;
  firstTimer: string;
  volunteer: string;
  source: string;
  pilotFirst: string;
  pilotLast: string;
  copilotFirst: string;
  copilotLast: string;
  membershipNumber: string;
  needsParking: string;
};

const ADMIN_EVENT_STORAGE_KEY = "fcoc-admin-event-context";

function getStoredAdminEvent(): EventContext | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(ADMIN_EVENT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fullName(first?: string | null, last?: string | null) {
  return [first, last].filter(Boolean).join(" ").trim();
}

function pilotName(row: AttendeeRow) {
  return fullName(row.pilot_first, row.pilot_last);
}

function coPilotName(row: AttendeeRow) {
  return fullName(row.copilot_first, row.copilot_last);
}

function cityState(row: AttendeeRow) {
  return [row.city, row.state].filter(Boolean).join(", ");
}

function participantTypeLabel(value?: string | null) {
  if (!value) return "attendee";
  return value.replace(/_/g, " ");
}

function normalize(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

function downloadXlsx(filename: string, sheetName: string, rows: string[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename);
}

function attendeeToDisplayRow(row: AttendeeRow): DisplayRow {
  return {
    id: row.id,
    site: row.assigned_site || "",
    participantType: participantTypeLabel(row.participant_type),
    pilot: pilotName(row),
    copilot: coPilotName(row),
    email: row.email || "",
    cityState: cityState(row),
    arrived: row.has_arrived ? "YES" : "NO",
    active: row.is_active ? "YES" : "NO",
    firstTimer: row.is_first_timer ? "YES" : "NO",
    volunteer: row.wants_to_volunteer ? "YES" : "NO",
    source: row.source_type || "imported",
    pilotFirst: row.pilot_first || "",
    pilotLast: row.pilot_last || "",
    copilotFirst: row.copilot_first || "",
    copilotLast: row.copilot_last || "",
    membershipNumber: row.membership_number || "",
    needsParking: row.needs_parking ? "YES" : "NO",
  };
}

function sortDisplayRows(rows: DisplayRow[], sortType: SortType) {
  return [...rows].sort((a, b) => {
    const byName =
      normalize(a.pilotLast).localeCompare(normalize(b.pilotLast), undefined, {
        sensitivity: "base",
      }) ||
      normalize(a.pilotFirst).localeCompare(
        normalize(b.pilotFirst),
        undefined,
        { sensitivity: "base" },
      ) ||
      normalize(a.copilotLast).localeCompare(
        normalize(b.copilotLast),
        undefined,
        { sensitivity: "base" },
      ) ||
      normalize(a.copilotFirst).localeCompare(
        normalize(b.copilotFirst),
        undefined,
        { sensitivity: "base" },
      ) ||
      normalize(a.site).localeCompare(normalize(b.site), undefined, {
        numeric: true,
        sensitivity: "base",
      });

    const bySite =
      normalize(a.site).localeCompare(normalize(b.site), undefined, {
        numeric: true,
        sensitivity: "base",
      }) || byName;

    switch (sortType) {
      case "name_asc":
        return byName;
      case "name_desc":
        return -byName;
      case "site_asc":
        return bySite;
      case "site_desc":
        return -bySite;
      default:
        return byName;
    }
  });
}

function AdminAttendeesPageInner() {
  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [parkingSites, setParkingSites] = useState<ParkingSiteRow[]>([]);
  const [search, setSearch] = useState("");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [sortType, setSortType] = useState<SortType>("name_asc");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading attendees...");
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [canExport, setCanExport] = useState(false);

  useEffect(() => {
    async function init() {
      setCanExport(false);
      setLoading(true);
      setError(null);
      setStatus("Checking admin access...");
      setAccessDenied(false);

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setCanExport(false);
        setCurrentEvent(null);
        setAttendees([]);
        setParkingSites([]);
        setSearch("");
        setViewFilter("all");
        setSortType("name_asc");
        setError("No admin access.");
        setStatus("Access denied.");
        setLoading(false);
        setAccessDenied(true);
        return;
      }

      if (!hasPermission(admin, "can_edit_attendees")) {
        setCanExport(false);
        setCurrentEvent(null);
        setAttendees([]);
        setParkingSites([]);
        setSearch("");
        setViewFilter("all");
        setSortType("name_asc");
        setError("You do not have permission to manage attendees.");
        setStatus("Access denied.");
        setLoading(false);
        setAccessDenied(true);
        return;
      }

      setCanExport(hasPermission(admin, "can_export_reports"));

      const event = getStoredAdminEvent();

      if (!event?.id) {
        setCurrentEvent(null);
        setAttendees([]);
        setParkingSites([]);
        setSearch("");
        setViewFilter("all");
        setSortType("name_asc");
        setStatus("No admin event selected.");
        setLoading(false);
        return;
      }

      if (!canAccessEvent(admin, event.id)) {
        setCurrentEvent(null);
        setAttendees([]);
        setParkingSites([]);
        setSearch("");
        setViewFilter("all");
        setSortType("name_asc");
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        setLoading(false);
        setAccessDenied(true);
        return;
      }

      setCurrentEvent(event);
      await loadData(event.id);
    }

    void init();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-admin-event-context" ||
        e.key === "fcoc-admin-event-changed" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
      ) {
        void init();
      }
    }

    function handleAdminEventUpdated() {
      void init();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      "fcoc-admin-event-updated",
      handleAdminEventUpdated,
    );

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "fcoc-admin-event-updated",
        handleAdminEventUpdated,
      );
    };
  }, []);

  async function loadData(activeEventId: string) {
    setLoading(true);
    setError(null);
    setAccessDenied(false);
    setStatus("Loading attendees...");

    const admin = await getCurrentAdminAccess();

    if (!admin) {
      setCanExport(false);
      setCurrentEvent(null);
      setAttendees([]);
      setParkingSites([]);
      setError("No admin access.");
      setStatus("Access denied.");
      setLoading(false);
      setAccessDenied(true);
      return;
    }

    if (!hasPermission(admin, "can_edit_attendees")) {
      setCanExport(false);
      setCurrentEvent(null);
      setAttendees([]);
      setParkingSites([]);
      setError("You do not have permission to manage attendees.");
      setStatus("Access denied.");
      setLoading(false);
      setAccessDenied(true);
      return;
    }

    if (!canAccessEvent(admin, activeEventId)) {
      setCanExport(false);
      setCurrentEvent(null);
      setAttendees([]);
      setParkingSites([]);
      setError("You do not have access to this event.");
      setStatus("Access denied.");
      setLoading(false);
      setAccessDenied(true);
      return;
    }

    setCanExport(hasPermission(admin, "can_export_reports"));

    const [
      { data: attendeeData, error: attendeeError },
      { data: parkingData, error: parkingError },
    ] = await Promise.all([
      supabase
        .from("attendees")
        .select(
          `
            id,
            event_id,
            entry_id,
            email,
            pilot_first,
            pilot_last,
            copilot_first,
            copilot_last,
            nickname,
            copilot_nickname,
            membership_number,
            primary_phone,
            cell_phone,
            city,
            state,
            wants_to_volunteer,
            is_first_timer,
            coach_manufacturer,
            coach_model,
            special_events_raw,
            assigned_site,
            has_arrived,
            share_with_attendees,
            is_active,
            inactive_reason,
            participant_type,
            source_type,
            include_in_headcount,
            needs_name_tag,
            needs_coach_plate,
            needs_parking,
            notes,
            created_at
          `,
        )
        .eq("event_id", activeEventId)
        .order("pilot_last", { ascending: true })
        .order("pilot_first", { ascending: true }),

      supabase
        .from("parking_sites")
        .select("*")
        .eq("event_id", activeEventId)
        .order("site_number", { ascending: true }),
    ]);

    if (attendeeError) {
      setError(attendeeError.message);
      setStatus("Could not load attendees.");
      setLoading(false);
      return;
    }

    if (parkingError) {
      setError(parkingError.message);
      setStatus("Could not load parking sites.");
      setLoading(false);
      return;
    }

    setAttendees((attendeeData || []) as AttendeeRow[]);
    setParkingSites((parkingData || []) as ParkingSiteRow[]);
    setStatus("");
    setLoading(false);
  }

  const filteredAttendees = useMemo(() => {
    let rows = [...attendees];

    switch (viewFilter) {
      case "active":
        rows = rows.filter((row) => row.is_active);
        break;
      case "inactive":
        rows = rows.filter((row) => !row.is_active);
        break;
      case "arrived":
        rows = rows.filter((row) => row.has_arrived);
        break;
      case "not_arrived":
        rows = rows.filter((row) => !row.has_arrived);
        break;
      case "first_timers":
        rows = rows.filter((row) => row.is_first_timer);
        break;
      case "volunteers":
        rows = rows.filter((row) => row.wants_to_volunteer);
        break;
      case "vendors":
        rows = rows.filter((row) => (row.participant_type || "") === "vendor");
        break;
      case "staff_hosts_helpers":
        rows = rows.filter((row) =>
          ["staff", "host", "helper", "volunteer", "vip"].includes(
            row.participant_type || "",
          ),
        );
        break;
      case "needs_parking":
        rows = rows.filter((row) => row.needs_parking);
        break;
      case "assigned_site":
        rows = rows.filter((row) => !!row.assigned_site);
        break;
      case "unassigned_site":
        rows = rows.filter((row) => !row.assigned_site);
        break;
      default:
        break;
    }

    const term = search.trim().toLowerCase();
    if (!term) return rows;

    return rows.filter((row) =>
      [
        row.pilot_first,
        row.pilot_last,
        row.copilot_first,
        row.copilot_last,
        row.email,
        row.assigned_site,
        row.city,
        row.state,
        row.membership_number,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [attendees, viewFilter, search]);

  const displayRows = useMemo(() => {
    return sortDisplayRows(
      filteredAttendees.map(attendeeToDisplayRow),
      sortType,
    );
  }, [filteredAttendees, sortType]);

  const summary = useMemo(() => {
    const totalAttendees = attendees.length;
    const activeCount = attendees.filter((x) => x.is_active).length;
    const inactiveCount = attendees.filter((x) => !x.is_active).length;
    const arrivedCount = attendees.filter((x) => x.has_arrived).length;
    const firstTimers = attendees.filter((x) => x.is_first_timer).length;
    const volunteerCount = attendees.filter((x) => x.wants_to_volunteer).length;
    const needsParking = attendees.filter((x) => x.needs_parking).length;
    const unassignedSiteCount = attendees.filter(
      (x) => !x.assigned_site,
    ).length;

    return {
      totalAttendees,
      activeCount,
      inactiveCount,
      arrivedCount,
      firstTimers,
      volunteerCount,
      needsParking,
      unassignedSiteCount,
      totalSites: parkingSites.length,
    };
  }, [attendees, parkingSites]);

  function buildExportRows(): string[][] {
    return [
      ["Attendees"],
      ["Event", currentEvent?.name || currentEvent?.eventName || ""],
      ["Location", currentEvent?.location || ""],
      ["View", viewFilter],
      ["Sort", sortType],
      ["Search", search],
      [],
      [
        "Site",
        "Participant Type",
        "Pilot",
        "Co-Pilot",
        "Email",
        "City/State",
        "Arrived",
        "Active",
        "First Timer",
        "Volunteer",
        "Needs Parking",
        "Membership Number",
        "Source",
      ],
      ...displayRows.map((row) => [
        row.site,
        row.participantType,
        row.pilot,
        row.copilot,
        row.email,
        row.cityState,
        row.arrived,
        row.active,
        row.firstTimer,
        row.volunteer,
        row.needsParking,
        row.membershipNumber,
        row.source,
      ]),
    ];
  }

  function handleExportCsv() {
    const rows = buildExportRows();
    const filenameBase = `${(
      currentEvent?.name ||
      currentEvent?.eventName ||
      "event"
    )
      .replace(/\s+/g, "_")
      .replace(/[^\w\-]+/g, "")
      .toLowerCase()}_attendees`;

    downloadCsv(`${filenameBase}.csv`, rows);
  }

  function handleExportXlsx() {
    const rows = buildExportRows();
    const filenameBase = `${(
      currentEvent?.name ||
      currentEvent?.eventName ||
      "event"
    )
      .replace(/\s+/g, "_")
      .replace(/[^\w\-]+/g, "")
      .toLowerCase()}_attendees`;

    downloadXlsx(`${filenameBase}.xlsx`, "Attendees", rows);
  }

  if (!loading && accessDenied) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Attendees</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          You do not have access to this page.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Attendees</h1>

        <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 12 }}>
          {currentEvent?.name || currentEvent?.eventName || "No event selected"}
          {currentEvent?.location ? ` • ${currentEvent.location}` : ""}
        </div>

        {status ? (
          <div style={{ marginBottom: 12, fontSize: 14 }}>{status}</div>
        ) : null}

        {error ? <div style={errorBoxStyle}>{error}</div> : null}

        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns:
              "minmax(260px, 1.5fr) minmax(220px, 1fr) minmax(220px, 1fr) auto",
            marginTop: 12,
          }}
        >
          <div>
            <label style={labelStyle}>Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search last name, first name, site, email..."
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>View</label>
            <select
              value={viewFilter}
              onChange={(e) => setViewFilter(e.target.value as ViewFilter)}
              style={inputStyle}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="arrived">Arrived</option>
              <option value="not_arrived">Not Arrived</option>
              <option value="first_timers">First Timers</option>
              <option value="volunteers">Volunteers</option>
              <option value="vendors">Vendors</option>
              <option value="staff_hosts_helpers">
                Staff / Hosts / Helpers
              </option>
              <option value="needs_parking">Needs Parking</option>
              <option value="assigned_site">Assigned Site</option>
              <option value="unassigned_site">Unassigned Site</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Sort</label>
            <select
              value={sortType}
              onChange={(e) => setSortType(e.target.value as SortType)}
              style={inputStyle}
            >
              <option value="name_asc">Last Name A–Z</option>
              <option value="name_desc">Last Name Z–A</option>
              <option value="site_asc">Site 0–9 / A–Z</option>
              <option value="site_desc">Site 9–0 / Z–A</option>
            </select>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "end",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={handleExportCsv}
              style={secondaryButtonStyle}
              disabled={loading || !canExport}
            >
              Export CSV
            </button>

            <button
              type="button"
              onClick={handleExportXlsx}
              style={primaryButtonStyle}
              disabled={loading || !canExport}
            >
              Export XLSX
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        }}
      >
        <div className="card" style={summaryCardStyle}>
          <strong>Total</strong>
          <div style={summaryValueStyle}>{summary.totalAttendees}</div>
        </div>
        <div className="card" style={summaryCardStyle}>
          <strong>Active</strong>
          <div style={summaryValueStyle}>{summary.activeCount}</div>
        </div>
        <div className="card" style={summaryCardStyle}>
          <strong>Inactive</strong>
          <div style={summaryValueStyle}>{summary.inactiveCount}</div>
        </div>
        <div className="card" style={summaryCardStyle}>
          <strong>Arrived</strong>
          <div style={summaryValueStyle}>{summary.arrivedCount}</div>
        </div>
        <div className="card" style={summaryCardStyle}>
          <strong>First Timers</strong>
          <div style={summaryValueStyle}>{summary.firstTimers}</div>
        </div>
        <div className="card" style={summaryCardStyle}>
          <strong>Volunteers</strong>
          <div style={summaryValueStyle}>{summary.volunteerCount}</div>
        </div>
        <div className="card" style={summaryCardStyle}>
          <strong>Needs Parking</strong>
          <div style={summaryValueStyle}>{summary.needsParking}</div>
        </div>
        <div className="card" style={summaryCardStyle}>
          <strong>Unassigned Site</strong>
          <div style={summaryValueStyle}>{summary.unassignedSiteCount}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div style={{ marginBottom: 14 }}>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>
            Working Attendee List
          </h2>
          <div style={{ fontSize: 14, opacity: 0.8 }}>
            {displayRows.length} attendee rows
          </div>
        </div>

        {loading ? (
          <div>Loading...</div>
        ) : displayRows.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No attendees found for this view.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Site</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Pilot</th>
                  <th style={thStyle}>Co-Pilot</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>City / State</th>
                  <th style={thStyle}>Arrived</th>
                  <th style={thStyle}>Active</th>
                  <th style={thStyle}>First Timer</th>
                  <th style={thStyle}>Volunteer</th>
                  <th style={thStyle}>Needs Parking</th>
                  <th style={thStyle}>Source</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{row.site}</td>
                    <td style={tdStyle}>{row.participantType}</td>
                    <td style={tdStyle}>{row.pilot}</td>
                    <td style={tdStyle}>{row.copilot}</td>
                    <td style={tdStyle}>{row.email}</td>
                    <td style={tdStyle}>{row.cityState}</td>
                    <td style={tdStyle}>{row.arrived}</td>
                    <td style={tdStyle}>{row.active}</td>
                    <td style={tdStyle}>{row.firstTimer}</td>
                    <td style={tdStyle}>{row.volunteer}</td>
                    <td style={tdStyle}>{row.needsParking}</td>
                    <td style={tdStyle}>{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontWeight: 600,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "white",
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const errorBoxStyle: CSSProperties = {
  marginBottom: 12,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e2b4b4",
  background: "#fff3f3",
  color: "#8a1f1f",
};

const summaryCardStyle: CSSProperties = {
  padding: 16,
};

const summaryValueStyle: CSSProperties = {
  fontSize: 26,
  fontWeight: 800,
  marginTop: 8,
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "2px solid #ddd",
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderTop: "1px solid #ddd",
  verticalAlign: "top",
};

export default function AdminAttendeesPage() {
  return (
    <AdminRouteGuard requiredPermission="can_edit_attendees">
      <AdminAttendeesPageInner />
    </AdminRouteGuard>
  );
}
