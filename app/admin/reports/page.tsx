"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";
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

type ActivityRow = {
  id: string;
  event_id: string;
  entry_id: string;
  attendee_email: string | null;
  activity_name: string;
  quantity: number;
  price: number | null;
  raw_name: string | null;
  source_column_prefix: string;
  created_at?: string | null;
};

type ParkingSiteRow = {
  id: string;
  event_id: string;
  site_number: string | null;
  display_label: string | null;
  assigned_attendee_id: string | null;
};

type ReportType =
  | "first_timers"
  | "volunteers"
  | "vendors"
  | "staff_hosts_helpers"
  | "parking_assignments"
  | "unassigned_parking_needed"
  | "activity_summary";

type SortType = "name_asc" | "name_desc" | "site_asc" | "site_desc";

type RosterRow = {
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

function siteLabel(site: ParkingSiteRow) {
  return site.display_label || site.site_number || "";
}

function normalizeSortValue(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function attendeeToRosterRow(row: AttendeeRow): RosterRow {
  return {
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
  };
}

function sortRosterRows(rows: RosterRow[], sortType: SortType) {
  return [...rows].sort((a, b) => {
    const byName =
      normalizeSortValue(a.pilotLast).localeCompare(
        normalizeSortValue(b.pilotLast),
        undefined,
        { sensitivity: "base" },
      ) ||
      normalizeSortValue(a.pilotFirst).localeCompare(
        normalizeSortValue(b.pilotFirst),
        undefined,
        { sensitivity: "base" },
      ) ||
      normalizeSortValue(a.copilotLast).localeCompare(
        normalizeSortValue(b.copilotLast),
        undefined,
        { sensitivity: "base" },
      ) ||
      normalizeSortValue(a.copilotFirst).localeCompare(
        normalizeSortValue(b.copilotFirst),
        undefined,
        { sensitivity: "base" },
      ) ||
      normalizeSortValue(a.site).localeCompare(
        normalizeSortValue(b.site),
        undefined,
        { numeric: true, sensitivity: "base" },
      );

    const bySite =
      normalizeSortValue(a.site).localeCompare(
        normalizeSortValue(b.site),
        undefined,
        { numeric: true, sensitivity: "base" },
      ) || byName;

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

export default function AdminReportsPage() {
  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [parkingSites, setParkingSites] = useState<ParkingSiteRow[]>([]);
  const [reportType, setReportType] = useState<ReportType>(
    "parking_assignments",
  );
  const [sortType, setSortType] = useState<SortType>("name_asc");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading reports...");
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [canExport, setCanExport] = useState(false);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      setStatus("Checking admin access...");
      setAccessDenied(false);
      setCanExport(false);

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setCurrentEvent(null);
        setAttendees([]);
        setActivities([]);
        setParkingSites([]);
        setError("No admin access.");
        setStatus("Access denied.");
        setLoading(false);
        setAccessDenied(true);
        return;
      }

      if (!hasPermission(admin, "can_view_reports")) {
        setCurrentEvent(null);
        setAttendees([]);
        setActivities([]);
        setParkingSites([]);
        setError("You do not have permission to view reports.");
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
        setActivities([]);
        setParkingSites([]);
        setStatus("No admin event selected.");
        setLoading(false);
        return;
      }

      if (!canAccessEvent(admin, event.id)) {
        setCurrentEvent(null);
        setAttendees([]);
        setActivities([]);
        setParkingSites([]);
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
      if (e.key === "fcoc-admin-event-changed") {
        void init();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (reportType === "parking_assignments") {
      setSortType("site_asc");
    } else if (reportType === "unassigned_parking_needed") {
      setSortType("name_asc");
    }
  }, [reportType]);

  async function loadData(activeEventId: string) {
    setLoading(true);
    setError(null);
    setStatus("Loading reports...");

    const [
      { data: attendeeData, error: attendeeError },
      { data: activityData, error: activityError },
      { data: parkingData, error: parkingError },
    ] = await Promise.all([
      supabase
        .from("attendees")
        .select("*")
        .eq("event_id", activeEventId)
        .order("pilot_last", { ascending: true })
        .order("pilot_first", { ascending: true }),

      supabase
        .from("attendee_activities")
        .select("*")
        .eq("event_id", activeEventId)
        .order("activity_name", { ascending: true }),

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

    if (activityError) {
      setError(activityError.message);
      setStatus("Could not load activities.");
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
    setActivities((activityData || []) as ActivityRow[]);
    setParkingSites((parkingData || []) as ParkingSiteRow[]);
    setStatus("");
    setLoading(false);
  }

  const attendeeById = useMemo(() => {
    const map = new Map<string, AttendeeRow>();
    for (const attendee of attendees) {
      map.set(attendee.id, attendee);
    }
    return map;
  }, [attendees]);

  const rosterRows = useMemo(() => {
    switch (reportType) {
      case "first_timers":
        return attendees
          .filter((row) => row.is_first_timer)
          .map(attendeeToRosterRow);

      case "volunteers":
        return attendees
          .filter((row) => row.wants_to_volunteer)
          .map(attendeeToRosterRow);

      case "vendors":
        return attendees
          .filter((row) => (row.participant_type || "") === "vendor")
          .map(attendeeToRosterRow);

      case "staff_hosts_helpers":
        return attendees
          .filter((row) =>
            ["staff", "host", "helper", "volunteer", "vip"].includes(
              row.participant_type || "",
            ),
          )
          .map(attendeeToRosterRow);

      case "parking_assignments":
        return parkingSites
          .filter((site) => !!site.assigned_attendee_id)
          .map((site) => {
            const assigned = site.assigned_attendee_id
              ? attendeeById.get(site.assigned_attendee_id)
              : null;

            return {
              site: siteLabel(site),
              participantType: assigned
                ? participantTypeLabel(assigned.participant_type)
                : "",
              pilot: assigned ? pilotName(assigned) : "",
              copilot: assigned ? coPilotName(assigned) : "",
              email: assigned?.email || "",
              cityState: assigned ? cityState(assigned) : "",
              arrived: assigned?.has_arrived ? "YES" : assigned ? "NO" : "",
              active: assigned?.is_active ? "YES" : assigned ? "NO" : "",
              firstTimer: assigned?.is_first_timer
                ? "YES"
                : assigned
                  ? "NO"
                  : "",
              volunteer: assigned?.wants_to_volunteer
                ? "YES"
                : assigned
                  ? "NO"
                  : "",
              source: assigned?.source_type || "",
              pilotFirst: assigned?.pilot_first || "",
              pilotLast: assigned?.pilot_last || "",
              copilotFirst: assigned?.copilot_first || "",
              copilotLast: assigned?.copilot_last || "",
            };
          });

      case "unassigned_parking_needed":
        return attendees
          .filter((row) => row.needs_parking && !row.assigned_site)
          .map(attendeeToRosterRow);

      default:
        return [];
    }
  }, [reportType, attendees, parkingSites, attendeeById]);

  const sortedRosterRows = useMemo(() => {
    if (reportType === "activity_summary") return [];
    return sortRosterRows(rosterRows, sortType);
  }, [rosterRows, sortType, reportType]);

  const activitySummaryRows = useMemo(() => {
    const summary = new Map<
      string,
      {
        activityName: string;
        totalQty: number;
        participantCount: number;
        totalRevenue: number;
      }
    >();

    const uniqueParticipantsByActivity = new Map<string, Set<string>>();

    for (const activity of activities) {
      const key = activity.activity_name || "Unnamed Activity";

      if (!summary.has(key)) {
        summary.set(key, {
          activityName: key,
          totalQty: 0,
          participantCount: 0,
          totalRevenue: 0,
        });
      }

      const row = summary.get(key)!;
      row.totalQty += Number(activity.quantity || 0);
      row.totalRevenue +=
        (Number(activity.price || 0) || 0) *
        (Number(activity.quantity || 0) || 0);

      if (!uniqueParticipantsByActivity.has(key)) {
        uniqueParticipantsByActivity.set(key, new Set());
      }

      const entryKey = activity.entry_id || activity.id;
      uniqueParticipantsByActivity.get(key)!.add(entryKey);
    }

    for (const [key, set] of uniqueParticipantsByActivity.entries()) {
      const row = summary.get(key);
      if (row) row.participantCount = set.size;
    }

    return Array.from(summary.values()).sort((a, b) =>
      a.activityName.localeCompare(b.activityName, undefined, {
        sensitivity: "base",
      }),
    );
  }, [activities]);

  const reportTitle = useMemo(() => {
    switch (reportType) {
      case "first_timers":
        return "First Timers";
      case "volunteers":
        return "Volunteers";
      case "vendors":
        return "Vendors";
      case "staff_hosts_helpers":
        return "Staff / Hosts / Helpers";
      case "parking_assignments":
        return "Parking Assignments";
      case "unassigned_parking_needed":
        return "Needs Parking / Unassigned";
      case "activity_summary":
        return "Activity Summary";
      default:
        return "Report";
    }
  }, [reportType]);

  const summary = useMemo(() => {
    const totalAttendees = attendees.length;
    const activeCount = attendees.filter((x) => x.is_active).length;
    const inactiveCount = attendees.filter((x) => !x.is_active).length;
    const firstTimers = attendees.filter((x) => x.is_first_timer).length;
    const volunteerCount = attendees.filter((x) => x.wants_to_volunteer).length;
    const vendorCount = attendees.filter(
      (x) => (x.participant_type || "") === "vendor",
    ).length;
    const parkingAssigned = attendees.filter((x) => !!x.assigned_site).length;
    const parkingNeededUnassigned = attendees.filter(
      (x) => x.needs_parking && !x.assigned_site,
    ).length;

    return {
      totalAttendees,
      activeCount,
      inactiveCount,
      firstTimers,
      volunteerCount,
      vendorCount,
      parkingAssigned,
      parkingNeededUnassigned,
    };
  }, [attendees]);

  function buildExportRows(): string[][] {
    if (reportType === "activity_summary") {
      return [
        [reportTitle],
        ["Event", currentEvent?.name || currentEvent?.eventName || ""],
        ["Location", currentEvent?.location || ""],
        [],
        ["Activity", "Participant Count", "Total Quantity", "Total Revenue"],
        ...activitySummaryRows.map((row) => [
          row.activityName,
          String(row.participantCount),
          String(row.totalQty),
          row.totalRevenue.toFixed(2),
        ]),
      ];
    }

    return [
      [reportTitle],
      ["Event", currentEvent?.name || currentEvent?.eventName || ""],
      ["Location", currentEvent?.location || ""],
      ["Sort", sortType],
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
        "Source",
      ],
      ...sortedRosterRows.map((row) => [
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
        row.source,
      ]),
    ];
  }

  function handleExportCsv() {
    if (!canExport) return;

    const rows = buildExportRows();
    const filenameBase = `${(
      currentEvent?.name ||
      currentEvent?.eventName ||
      "event"
    )
      .replace(/\s+/g, "_")
      .replace(/[^\w\-]+/g, "")
      .toLowerCase()}_${reportType}`;

    downloadCsv(`${filenameBase}.csv`, rows);
  }

  function handleExportXlsx() {
    if (!canExport) return;

    const rows = buildExportRows();
    const filenameBase = `${(
      currentEvent?.name ||
      currentEvent?.eventName ||
      "event"
    )
      .replace(/\s+/g, "_")
      .replace(/[^\w\-]+/g, "")
      .toLowerCase()}_${reportType}`;

    downloadXlsx(`${filenameBase}.xlsx`, reportTitle.slice(0, 31), rows);
  }

  if (!loading && accessDenied) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Reports</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          You do not have access to this page.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Reports</h1>

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
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            marginTop: 12,
          }}
        >
          <div>
            <label style={labelStyle}>Report Type</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              style={inputStyle}
            >
              <option value="first_timers">First Timers</option>
              <option value="volunteers">Volunteers</option>
              <option value="vendors">Vendors</option>
              <option value="staff_hosts_helpers">
                Staff / Hosts / Helpers
              </option>
              <option value="parking_assignments">Parking Assignments</option>
              <option value="unassigned_parking_needed">
                Needs Parking / Unassigned
              </option>
              <option value="activity_summary">Activity Summary</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Sort</label>
            <select
              value={sortType}
              onChange={(e) => setSortType(e.target.value as SortType)}
              style={inputStyle}
              disabled={reportType === "activity_summary"}
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
          <strong>Total Participants</strong>
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
          <strong>First Timers</strong>
          <div style={summaryValueStyle}>{summary.firstTimers}</div>
        </div>
        <div className="card" style={summaryCardStyle}>
          <strong>Volunteers</strong>
          <div style={summaryValueStyle}>{summary.volunteerCount}</div>
        </div>
        <div className="card" style={summaryCardStyle}>
          <strong>Vendors</strong>
          <div style={summaryValueStyle}>{summary.vendorCount}</div>
        </div>
        <div className="card" style={summaryCardStyle}>
          <strong>Parking Assigned</strong>
          <div style={summaryValueStyle}>{summary.parkingAssigned}</div>
        </div>
        <div className="card" style={summaryCardStyle}>
          <strong>Parking Needed / Unassigned</strong>
          <div style={summaryValueStyle}>{summary.parkingNeededUnassigned}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div style={{ marginBottom: 14 }}>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>{reportTitle}</h2>
          <div style={{ fontSize: 14, opacity: 0.8 }}>
            {reportType === "activity_summary"
              ? `${activitySummaryRows.length} activity rows`
              : `${sortedRosterRows.length} roster rows`}
          </div>
        </div>

        {loading ? (
          <div>Loading...</div>
        ) : reportType === "activity_summary" ? (
          activitySummaryRows.length === 0 ? (
            <div style={{ opacity: 0.8 }}>No activity rows found.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Activity</th>
                    <th style={thStyle}>Participants</th>
                    <th style={thStyle}>Total Qty</th>
                    <th style={thStyle}>Total Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {activitySummaryRows.map((row) => (
                    <tr key={row.activityName}>
                      <td style={tdStyle}>{row.activityName}</td>
                      <td style={tdStyle}>{row.participantCount}</td>
                      <td style={tdStyle}>{row.totalQty}</td>
                      <td style={tdStyle}>${row.totalRevenue.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : sortedRosterRows.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No rows found for this report.</div>
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
                  <th style={thStyle}>Source</th>
                </tr>
              </thead>
              <tbody>
                {sortedRosterRows.map((row, index) => (
                  <tr key={`${row.site}-${row.email}-${index}`}>
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
