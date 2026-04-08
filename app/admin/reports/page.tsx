"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type EventItem = {
  id: string;
  name: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type Attendee = {
  id: string;
  event_id: string;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  email: string | null;
  assigned_site: string | null;
  has_arrived: boolean | null;
  share_with_attendees?: boolean | null;
  is_first_timer?: boolean | null;
};

type ParkingSite = {
  id: string;
  event_id: string;
  site_number: string | null;
  display_label: string | null;
  assigned_attendee_id: string | null;
};

type ReportType =
  | "all_attendees"
  | "parking"
  | "checked_in"
  | "not_arrived"
  | "first_time_attendees"
  | "first_time_arrived"
  | "first_time_not_arrived"
  | "unassigned_sites"
  | "site_assignments";

type SortType = "site_asc" | "site_desc" | "name_asc" | "name_desc";

type ReportRow = {
  site: string;
  pilot: string;
  copilot: string;
  email: string;
  arrived: string;
  firstTimer: string;
};

function getStoredAdminEventId(): string {
  if (typeof window === "undefined") return "";

  try {
    const raw = localStorage.getItem("fcoc-admin-event-context");
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return parsed?.id || "";
  } catch {
    return "";
  }
}

function fullName(first?: string | null, last?: string | null) {
  return `${first || ""} ${last || ""}`.trim();
}

function pilotName(attendee: Attendee) {
  return fullName(attendee.pilot_first, attendee.pilot_last);
}

function coPilotName(attendee: Attendee) {
  return fullName(attendee.copilot_first, attendee.copilot_last);
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

function siteLabel(site: ParkingSite) {
  return site.display_label || site.site_number || "";
}

function sortRows(rows: ReportRow[], sortType: SortType) {
  const copy = [...rows];

  copy.sort((a, b) => {
    if (sortType === "site_asc") {
      return a.site.localeCompare(b.site, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }

    if (sortType === "site_desc") {
      return b.site.localeCompare(a.site, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }

    if (sortType === "name_asc") {
      return a.pilot.localeCompare(b.pilot, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }

    return b.pilot.localeCompare(a.pilot, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  return copy;
}

export default function AdminReportsPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [reportType, setReportType] = useState<ReportType>("all_attendees");
  const [sortType, setSortType] = useState<SortType>("site_asc");

  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [parkingSites, setParkingSites] = useState<ParkingSite[]>([]);

  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [status, setStatus] = useState("Loading events...");
  const [printStatus, setPrintStatus] = useState("");

  useEffect(() => {
    async function loadEvents() {
      setLoadingEvents(true);
      setStatus("Loading events...");

      const { data, error } = await supabase
        .from("events")
        .select("id, name, venue_name, location, start_date, end_date")
        .order("start_date", { ascending: false });

      if (error) {
        setStatus(`Could not load events: ${error.message}`);
        setLoadingEvents(false);
        return;
      }

      const eventRows = (data || []) as EventItem[];
      setEvents(eventRows);

      const storedEventId = getStoredAdminEventId();
      const defaultEventId =
        (storedEventId &&
          eventRows.find((event) => event.id === storedEventId)?.id) ||
        eventRows[0]?.id ||
        "";

      setSelectedEventId(defaultEventId);
      setLoadingEvents(false);
      setStatus(defaultEventId ? "Select a report." : "No events found.");
    }

    void loadEvents();
  }, []);

  useEffect(() => {
    async function loadReportData() {
      if (!selectedEventId) {
        setAttendees([]);
        setParkingSites([]);
        return;
      }

      setLoadingReport(true);
      setStatus("Loading report data...");

      const attendeeQuery = supabase
        .from("attendees")
        .select(
          "id, event_id, pilot_first, pilot_last, copilot_first, copilot_last, email, assigned_site, has_arrived, share_with_attendees, is_first_timer",
        )
        .eq("event_id", selectedEventId);

      const parkingQuery = supabase
        .from("parking_sites")
        .select(
          "id, event_id, site_number, display_label, assigned_attendee_id",
        )
        .eq("event_id", selectedEventId);

      const [
        { data: attendeeData, error: attendeeError },
        { data: parkingData, error: parkingError },
      ] = await Promise.all([attendeeQuery, parkingQuery]);

      if (attendeeError) {
        setStatus(`Could not load attendees: ${attendeeError.message}`);
        setLoadingReport(false);
        return;
      }

      if (parkingError) {
        setStatus(`Could not load parking sites: ${parkingError.message}`);
        setLoadingReport(false);
        return;
      }

      setAttendees((attendeeData || []) as Attendee[]);
      setParkingSites((parkingData || []) as ParkingSite[]);
      setStatus("Report ready.");
      setLoadingReport(false);
    }

    void loadReportData();
  }, [selectedEventId]);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) || null,
    [events, selectedEventId],
  );

  const attendeeById = useMemo(() => {
    const map = new Map<string, Attendee>();
    for (const attendee of attendees) {
      map.set(attendee.id, attendee);
    }
    return map;
  }, [attendees]);

  async function generateNameTagsFromEvent() {
    if (!selectedEventId) return;

    setPrintStatus("Loading name tags from event data...");

    const { data, error } = await supabase
      .from("event_import_rows")
      .select("*")
      .eq("event_id", selectedEventId)
      .eq("import_type", "attendee_roster")
      .order("pilot_last", { ascending: true });

    if (error) {
      console.error(error);
      setPrintStatus("Could not load stored attendee import rows.");
      return;
    }

    if (!data || data.length === 0) {
      setPrintStatus("No stored attendee import data found for this event.");
      return;
    }

    const people = data.flatMap((row: any) => {
      const list: any[] = [];
      const pilotLastName = String(row.pilot_last || "").trim();

      if (row.pilot_first || row.pilot_last) {
        list.push({
          displayFirst: row.pilot_badge_nickname || row.pilot_first || "",
          lastName: pilotLastName,
          memberNumber: row.membership_number || "",
          city: row.city || "",
          state: row.state || "",
          firstTimer: !!row.is_first_timer,
          sortName: pilotLastName,
        });
      }

      if (row.copilot_first || row.copilot_last) {
        list.push({
          displayFirst: row.copilot_badge_nickname || row.copilot_first || "",
          lastName: pilotLastName || row.copilot_last || "",
          memberNumber: row.membership_number || "",
          city: row.city || "",
          state: row.state || "",
          firstTimer: !!row.is_first_timer,
          sortName: pilotLastName || row.copilot_last || "",
        });
      }

      if (row.additional_attendees) {
        const extras = String(row.additional_attendees)
          .replace(/\band\b/gi, ",")
          .split(",")
          .map((x: string) => x.trim())
          .filter(Boolean);

        extras.forEach((name: string) => {
          list.push({
            displayFirst: name,
            lastName: pilotLastName,
            memberNumber: row.membership_number || "",
            city: row.city || "",
            state: row.state || "",
            firstTimer: !!row.is_first_timer,
            sortName: pilotLastName,
          });
        });
      }

      return list;
    });

    people.sort((a, b) => {
      if (a.firstTimer !== b.firstTimer) {
        return a.firstTimer ? -1 : 1;
      }

      return String(a.sortName || "").localeCompare(
        String(b.sortName || ""),
        undefined,
        {
          sensitivity: "base",
        },
      );
    });

    sessionStorage.setItem("fcoc-name-tags", JSON.stringify(people));
    sessionStorage.setItem(
      "fcoc-name-tags-event",
      selectedEvent?.name || "Event",
    );

    setPrintStatus(`Ready: ${people.length} name tags.`);
    window.open("/admin/reports/name-tags/print", "_blank");
  }
  async function generateCoachPlatesFromEvent() {
    if (!selectedEventId) return;

    setPrintStatus("Loading coach plates from event data...");

    const { data, error } = await supabase
      .from("event_import_rows")
      .select("*")
      .eq("event_id", selectedEventId)
      .eq("import_type", "attendee_roster")
      .order("pilot_last", { ascending: true });

    if (error) {
      console.error(error);
      setPrintStatus("Could not load stored attendee import rows.");
      return;
    }

    if (!data || data.length === 0) {
      setPrintStatus("No stored attendee import data found for this event.");
      return;
    }

    const plates = data.map((row: any) => {
      const pilotFirst = String(
        row.pilot_badge_nickname || row.pilot_first || "",
      ).trim();
      const pilotLast = String(row.pilot_last || "").trim();

      const copilotFirst = String(
        row.copilot_badge_nickname || row.copilot_first || "",
      ).trim();
      const copilotLast = String(row.copilot_last || pilotLast || "").trim();

      return {
        eventName: selectedEvent?.name || "Event",
        memberNumber: row.membership_number || "",
        pilotDisplay: [pilotFirst, pilotLast].filter(Boolean).join(" "),
        copilotDisplay: copilotFirst
          ? [copilotFirst, copilotLast].filter(Boolean).join(" ")
          : "",
        city: row.city || "",
        state: row.state || "",
        firstTimer: !!row.is_first_timer,
        sortName: pilotLast,
      };
    });

    plates.sort((a, b) => {
      if (a.firstTimer !== b.firstTimer) {
        return a.firstTimer ? -1 : 1;
      }

      return String(a.sortName || "").localeCompare(
        String(b.sortName || ""),
        undefined,
        {
          sensitivity: "base",
        },
      );
    });

    sessionStorage.setItem("fcoc-coach-plates", JSON.stringify(plates));

    setPrintStatus(`Ready: ${plates.length} coach plates.`);
    window.open("/admin/reports/coach-plates/print", "_blank");
  }

  const reportTitle = useMemo(() => {
    switch (reportType) {
      case "all_attendees":
        return "All Attendees";
      case "parking":
        return "Parking Report";
      case "checked_in":
        return "Checked In";
      case "not_arrived":
        return "Not Arrived";
      case "first_time_attendees":
        return "First-Time Attendees";
      case "first_time_arrived":
        return "First-Time Arrived";
      case "first_time_not_arrived":
        return "First-Time Not Arrived";
      case "unassigned_sites":
        return "Unassigned Sites";
      case "site_assignments":
        return "Site Assignments";
      default:
        return "Report";
    }
  }, [reportType]);

  const baseRows = useMemo<ReportRow[]>(() => {
    switch (reportType) {
      case "all_attendees":
        return attendees.map((attendee) => ({
          site: attendee.assigned_site || "",
          pilot: pilotName(attendee),
          copilot: coPilotName(attendee),
          email: attendee.email || "",
          arrived: attendee.has_arrived ? "YES" : "NO",
          firstTimer: attendee.is_first_timer ? "YES" : "NO",
        }));

      case "checked_in":
        return attendees
          .filter((attendee) => attendee.has_arrived)
          .map((attendee) => ({
            site: attendee.assigned_site || "",
            pilot: pilotName(attendee),
            copilot: coPilotName(attendee),
            email: attendee.email || "",
            arrived: "YES",
            firstTimer: attendee.is_first_timer ? "YES" : "NO",
          }));

      case "not_arrived":
        return attendees
          .filter((attendee) => !attendee.has_arrived)
          .map((attendee) => ({
            site: attendee.assigned_site || "",
            pilot: pilotName(attendee),
            copilot: coPilotName(attendee),
            email: attendee.email || "",
            arrived: "NO",
            firstTimer: attendee.is_first_timer ? "YES" : "NO",
          }));

      case "first_time_attendees":
        return attendees
          .filter((attendee) => attendee.is_first_timer)
          .map((attendee) => ({
            site: attendee.assigned_site || "",
            pilot: pilotName(attendee),
            copilot: coPilotName(attendee),
            email: attendee.email || "",
            arrived: attendee.has_arrived ? "YES" : "NO",
            firstTimer: "YES",
          }));

      case "first_time_arrived":
        return attendees
          .filter((attendee) => attendee.is_first_timer && attendee.has_arrived)
          .map((attendee) => ({
            site: attendee.assigned_site || "",
            pilot: pilotName(attendee),
            copilot: coPilotName(attendee),
            email: attendee.email || "",
            arrived: "YES",
            firstTimer: "YES",
          }));

      case "first_time_not_arrived":
        return attendees
          .filter(
            (attendee) => attendee.is_first_timer && !attendee.has_arrived,
          )
          .map((attendee) => ({
            site: attendee.assigned_site || "",
            pilot: pilotName(attendee),
            copilot: coPilotName(attendee),
            email: attendee.email || "",
            arrived: "NO",
            firstTimer: "YES",
          }));

      case "parking":
        return parkingSites.map((site) => {
          const assigned = site.assigned_attendee_id
            ? attendeeById.get(site.assigned_attendee_id)
            : null;

          return {
            site: siteLabel(site),
            pilot: assigned ? pilotName(assigned) : "",
            copilot: assigned ? coPilotName(assigned) : "",
            email: assigned?.email || "",
            arrived: assigned?.has_arrived ? "YES" : "NO",
            firstTimer: assigned?.is_first_timer ? "YES" : "NO",
          };
        });

      case "unassigned_sites":
        return parkingSites
          .filter((site) => !site.assigned_attendee_id)
          .map((site) => ({
            site: siteLabel(site),
            pilot: "",
            copilot: "",
            email: "",
            arrived: "",
            firstTimer: "",
          }));

      case "site_assignments":
        return attendees.map((attendee) => ({
          site: attendee.assigned_site || "",
          pilot: pilotName(attendee),
          copilot: coPilotName(attendee),
          email: attendee.email || "",
          arrived: attendee.has_arrived ? "YES" : "NO",
          firstTimer: attendee.is_first_timer ? "YES" : "NO",
        }));

      default:
        return [];
    }
  }, [reportType, attendees, parkingSites, attendeeById]);

  const reportRows = useMemo(() => {
    return sortRows(baseRows, sortType);
  }, [baseRows, sortType]);

  const summary = useMemo(() => {
    const totalAttendees = attendees.length;
    const arrived = attendees.filter((item) => item.has_arrived).length;
    const notArrived = totalAttendees - arrived;
    const firstTimers = attendees.filter((item) => item.is_first_timer).length;
    const totalSites = parkingSites.length;
    const assignedSites = parkingSites.filter(
      (item) => !!item.assigned_attendee_id,
    ).length;
    const unassignedSites = totalSites - assignedSites;

    return {
      totalAttendees,
      arrived,
      notArrived,
      firstTimers,
      totalSites,
      assignedSites,
      unassignedSites,
      rows: reportRows.length,
    };
  }, [attendees, parkingSites, reportRows]);

  function handleExportCsv() {
    if (!selectedEvent) return;

    const filenameBase =
      `${selectedEvent.name || "event"}_${reportType}_${sortType}`
        .replace(/\s+/g, "_")
        .replace(/[^\w\-]+/g, "")
        .toLowerCase();

    const rows: string[][] = [
      [reportTitle],
      ["Event", selectedEvent.name || ""],
      ["Venue", selectedEvent.venue_name || ""],
      ["Location", selectedEvent.location || ""],
      ["Sort", sortType],
      [],
      ["Site", "Pilot", "Co-Pilot", "Email", "Arrived", "First Timer"],
      ...reportRows.map((row) => [
        row.site,
        row.pilot,
        row.copilot,
        row.email,
        row.arrived,
        row.firstTimer,
      ]),
    ];

    downloadCsv(`${filenameBase}.csv`, rows);
  }

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ marginBottom: 6 }}>Reports</h1>
          <p style={{ marginTop: 0, opacity: 0.8 }}>
            Select an event, report type, and sort order.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={handleExportCsv}
            disabled={
              !selectedEventId || loadingReport || reportRows.length === 0
            }
          >
            Export CSV
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginTop: 20,
          marginBottom: 20,
        }}
      >
        <div>
          <label
            htmlFor="report-event-select"
            style={{ display: "block", marginBottom: 6 }}
          >
            Event
          </label>
          <select
            id="report-event-select"
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            style={{ width: "100%" }}
            disabled={loadingEvents}
          >
            <option value="">Select event</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name || "Untitled Event"}
                {event.location ? ` — ${event.location}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="report-type-select"
            style={{ display: "block", marginBottom: 6 }}
          >
            Report Type
          </label>
          <select
            id="report-type-select"
            value={reportType}
            onChange={(e) => setReportType(e.target.value as ReportType)}
            style={{ width: "100%" }}
          >
            <option value="all_attendees">All Attendees</option>
            <option value="parking">Parking Report</option>
            <option value="checked_in">Checked In</option>
            <option value="not_arrived">Not Arrived</option>
            <option value="first_time_attendees">First-Time Attendees</option>
            <option value="first_time_arrived">First-Time Arrived</option>
            <option value="first_time_not_arrived">
              First-Time Not Arrived
            </option>
            <option value="unassigned_sites">Unassigned Sites</option>
            <option value="site_assignments">Site Assignments</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="report-sort-select"
            style={{ display: "block", marginBottom: 6 }}
          >
            Sort
          </label>
          <select
            id="report-sort-select"
            value={sortType}
            onChange={(e) => setSortType(e.target.value as SortType)}
            style={{ width: "100%" }}
          >
            <option value="site_asc">Site 0–9 / A–Z</option>
            <option value="site_desc">Site 9–0 / Z–A</option>
            <option value="name_asc">Pilot Name A–Z</option>
            <option value="name_desc">Pilot Name Z–A</option>
          </select>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div className="card">
          <strong>Total Attendees</strong>
          <div style={{ fontSize: 24, marginTop: 6 }}>
            {summary.totalAttendees}
          </div>
        </div>
        <div className="card">
          <strong>Arrived</strong>
          <div style={{ fontSize: 24, marginTop: 6 }}>{summary.arrived}</div>
        </div>
        <div className="card">
          <strong>Not Arrived</strong>
          <div style={{ fontSize: 24, marginTop: 6 }}>{summary.notArrived}</div>
        </div>
        <div className="card">
          <strong>First Timers</strong>
          <div style={{ fontSize: 24, marginTop: 6 }}>
            {summary.firstTimers}
          </div>
        </div>
        <div className="card">
          <strong>Total Sites</strong>
          <div style={{ fontSize: 24, marginTop: 6 }}>{summary.totalSites}</div>
        </div>
        <div className="card">
          <strong>Assigned Sites</strong>
          <div style={{ fontSize: 24, marginTop: 6 }}>
            {summary.assignedSites}
          </div>
        </div>
        <div className="card">
          <strong>Open Sites</strong>
          <div style={{ fontSize: 24, marginTop: 6 }}>
            {summary.unassignedSites}
          </div>
        </div>
        <div className="card">
          <strong>Rows in Report</strong>
          <div style={{ fontSize: 24, marginTop: 6 }}>{summary.rows}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ marginBottom: 12 }}>
          <strong>Name Tags / Coach Plates</strong>
          <div style={{ marginTop: 6, opacity: 0.8 }}>
            Use the attendee roster already imported for the selected event.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <button
            onClick={generateNameTagsFromEvent}
            disabled={!selectedEventId}
          >
            Print Name Tags (from Event)
          </button>

          <button
            onClick={generateCoachPlatesFromEvent}
            disabled={!selectedEventId}
          >
            Print Coach Plates (from Event)
          </button>
        </div>

        {printStatus && (
          <p style={{ marginTop: 12, marginBottom: 0 }}>{printStatus}</p>
        )}
      </div>

      <div className="card">
        <div style={{ marginBottom: 12 }}>
          <strong>{reportTitle}</strong>
          {selectedEvent ? (
            <div style={{ marginTop: 6, opacity: 0.8 }}>
              {selectedEvent.name || "Untitled Event"}
              {selectedEvent.location ? ` — ${selectedEvent.location}` : ""}
            </div>
          ) : null}
        </div>

        {(loadingEvents || loadingReport) && <p>{status}</p>}

        {!loadingEvents && !loadingReport && !selectedEventId && (
          <p>Please select an event.</p>
        )}

        {!loadingEvents &&
          !loadingReport &&
          selectedEventId &&
          reportRows.length === 0 && <p>No rows found for this report.</p>}

        {!loadingEvents && !loadingReport && reportRows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "10px 8px" }}>
                    Site
                  </th>
                  <th style={{ textAlign: "left", padding: "10px 8px" }}>
                    Pilot
                  </th>
                  <th style={{ textAlign: "left", padding: "10px 8px" }}>
                    Co-Pilot
                  </th>
                  <th style={{ textAlign: "left", padding: "10px 8px" }}>
                    Email
                  </th>
                  <th style={{ textAlign: "left", padding: "10px 8px" }}>
                    Arrived
                  </th>
                  <th style={{ textAlign: "left", padding: "10px 8px" }}>
                    First Timer
                  </th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map((row, index) => (
                  <tr key={`${row.site}-${row.email}-${index}`}>
                    <td
                      style={{
                        padding: "10px 8px",
                        borderTop: "1px solid #ddd",
                      }}
                    >
                      {row.site}
                    </td>
                    <td
                      style={{
                        padding: "10px 8px",
                        borderTop: "1px solid #ddd",
                      }}
                    >
                      {row.pilot}
                    </td>
                    <td
                      style={{
                        padding: "10px 8px",
                        borderTop: "1px solid #ddd",
                      }}
                    >
                      {row.copilot}
                    </td>
                    <td
                      style={{
                        padding: "10px 8px",
                        borderTop: "1px solid #ddd",
                      }}
                    >
                      {row.email}
                    </td>
                    <td
                      style={{
                        padding: "10px 8px",
                        borderTop: "1px solid #ddd",
                      }}
                    >
                      {row.arrived}
                    </td>
                    <td
                      style={{
                        padding: "10px 8px",
                        borderTop: "1px solid #ddd",
                      }}
                    >
                      {row.firstTimer}
                    </td>
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
