"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { getAdminEvent } from "@/lib/getAdminEvent";
import {
  getCurrentAdminAccess,
  canAccessEvent,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";

type AdminEventContext = {
  id?: string | null;
  name?: string | null;
};

type EventRow = {
  id: string;
  name: string | null;
  location: string | null;
  venue_name: string | null;
  start_date: string | null;
  end_date: string | null;
};

type PrintSettingsRow = {
  id?: string;
  event_id: string;
  name_tag_bg_url: string | null;
  coach_plate_bg_url: string | null;
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
  city: string | null;
  state: string | null;
  assigned_site: string | null;
  has_arrived: boolean | null;
  is_first_timer: boolean | null;
  coach_manufacturer: string | null;
  coach_model: string | null;
  coach_length: string | null;
  is_active: boolean;
};

type PrintMode = "name_tags" | "coach_plates";
type PrintFilter = "all" | "arrived" | "first_timers";

type NameTagRow = {
  key: string;
  attendeeId: string;
  eventName: string;
  memberNumber: string;
  firstName: string;
  lastName: string;
  cityState: string;
  isFirstTimer: boolean;
  pilotSortLast: string;
  pilotSortFirst: string;
};

function fullName(first?: string | null, last?: string | null) {
  return [first, last].filter(Boolean).join(" ").trim();
}

function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) return "";
  if (startDate && endDate) return `${startDate} – ${endDate}`;
  return startDate || endDate || "";
}

function cityState(row: AttendeeRow) {
  return [row.city, row.state].filter(Boolean).join(", ");
}

function displayPilotName(row: AttendeeRow) {
  return row.nickname?.trim() || fullName(row.pilot_first, row.pilot_last);
}

function displayCopilotName(row: AttendeeRow) {
  return (
    row.copilot_nickname?.trim() ||
    fullName(row.copilot_first, row.copilot_last)
  );
}

function coachText(row: AttendeeRow) {
  const coach = [row.coach_manufacturer, row.coach_model]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (!coach && !row.coach_length) return "";
  if (coach && row.coach_length) return `${coach} • ${row.coach_length} ft`;
  return coach || `${row.coach_length} ft`;
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function buildNameParts(
  first?: string | null,
  last?: string | null,
  nickname?: string | null,
) {
  const trimmedNickname = String(nickname || "").trim();
  const trimmedFirst = String(first || "").trim();
  const trimmedLast = String(last || "").trim();

  if (trimmedNickname) {
    return {
      firstName: trimmedNickname,
      lastName: trimmedLast,
    };
  }

  if (trimmedFirst && trimmedLast) {
    return {
      firstName: trimmedFirst,
      lastName: trimmedLast,
    };
  }

  if (trimmedFirst) {
    return {
      firstName: trimmedFirst,
      lastName: "",
    };
  }

  if (trimmedLast) {
    return {
      firstName: trimmedLast,
      lastName: "",
    };
  }

  return {
    firstName: "Guest",
    lastName: "",
  };
}

function AdminPrintPageInner() {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [settings, setSettings] = useState<PrintSettingsRow | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading print center...");

  const [printMode, setPrintMode] = useState<PrintMode>("name_tags");
  const [printFilter, setPrintFilter] = useState<PrintFilter>("all");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showFirstTimerOnNameTags, setShowFirstTimerOnNameTags] =
    useState(true);
  const [nameTagTextColor, setNameTagTextColor] = useState("#000000");
  const [coachPlateTextColor, setCoachPlateTextColor] = useState("#000000");

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      setAccessDenied(false);
      setStatus("Checking admin access...");

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setError("No admin access.");
        setStatus("Access denied.");
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      if (
        !hasPermission(admin, "can_manage_print_settings") &&
        !hasPermission(admin, "can_manage_reports")
      ) {
        setError("You do not have permission to use the print center.");
        setStatus("Access denied.");
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      const adminEvent = getAdminEvent() as AdminEventContext | null;

      if (!adminEvent?.id) {
        setEvent(null);
        setSettings(null);
        setAttendees([]);
        setSelectedIds([]);
        setStatus("No admin working event selected.");
        setLoading(false);
        return;
      }

      if (!canAccessEvent(admin, adminEvent.id)) {
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      await loadPage(adminEvent.id);
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

  async function loadPage(eventId: string) {
    try {
      setLoading(true);
      setError(null);
      setStatus("Loading print center...");

      const [
        { data: eventData, error: eventError },
        { data: settingsData, error: settingsError },
        { data: attendeeData, error: attendeeError },
      ] = await Promise.all([
        supabase
          .from("events")
          .select("id,name,location,venue_name,start_date,end_date")
          .eq("id", eventId)
          .single(),
        supabase
          .from("event_print_settings")
          .select("*")
          .eq("event_id", eventId)
          .maybeSingle(),
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
            city,
            state,
            assigned_site,
            has_arrived,
            is_first_timer,
            coach_manufacturer,
            coach_model,
            coach_length,
            is_active
          `,
          )
          .eq("event_id", eventId)
          .order("pilot_last", { ascending: true })
          .order("pilot_first", { ascending: true }),
      ]);

      if (eventError) throw eventError;
      if (settingsError) throw settingsError;
      if (attendeeError) throw attendeeError;

      const eventRow = eventData as EventRow;
      const attendeeRows = (attendeeData || []) as AttendeeRow[];
      const settingsRow = (settingsData as PrintSettingsRow | null) || {
        event_id: eventId,
        name_tag_bg_url: null,
        coach_plate_bg_url: null,
      };

      setEvent(eventRow);
      setSettings(settingsRow);
      setAttendees(attendeeRows);
      setSelectedIds(attendeeRows.map((row) => row.id));
      setStatus(`Loaded ${attendeeRows.length} attendees.`);
    } catch (err: any) {
      console.error("loadPage error:", err);
      setError(err?.message || "Failed to load print center.");
      setStatus(err?.message || "Failed to load print center.");
    } finally {
      setLoading(false);
    }
  }

  const filteredAttendees = useMemo(() => {
    let rows = [...attendees];

    if (!includeInactive) {
      rows = rows.filter((row) => row.is_active);
    }

    switch (printFilter) {
      case "arrived":
        rows = rows.filter((row) => row.has_arrived);
        break;
      case "first_timers":
        rows = rows.filter((row) => row.is_first_timer);
        break;
      default:
        break;
    }

    return rows;
  }, [attendees, printFilter, includeInactive]);

  const printableRows = useMemo(() => {
    return filteredAttendees.filter((row) => selectedIds.includes(row.id));
  }, [filteredAttendees, selectedIds]);

  const printableNameTags = useMemo<NameTagRow[]>(() => {
    const rawEventName = event?.name?.trim() || "FCOC Event";
    const eventYear = (event?.start_date || "").slice(0, 4).trim();
    const eventName = eventYear
      ? `${rawEventName.replace(new RegExp(`\\s*${eventYear}$`), "").trim()} ${eventYear}`.trim()
      : rawEventName;

    const tags = printableRows.flatMap((row) => {
      const nextTags: NameTagRow[] = [];
      const memberNumber = row.membership_number || "";
      const place = cityState(row);
      const pilotSortLast = String(row.pilot_last || "")
        .trim()
        .toLowerCase();
      const pilotSortFirst = String(row.nickname || row.pilot_first || "")
        .trim()
        .toLowerCase();
      const isFirstTimer = !!row.is_first_timer;

      const pilotHasName = !!String(
        row.pilot_first || row.pilot_last || row.nickname || "",
      ).trim();

      if (pilotHasName) {
        const pilotName = buildNameParts(
          row.pilot_first,
          row.pilot_last,
          row.nickname,
        );

        nextTags.push({
          key: `${row.id}-pilot`,
          attendeeId: row.id,
          eventName,
          memberNumber,
          firstName: pilotName.firstName,
          lastName: pilotName.lastName,
          cityState: place,
          isFirstTimer,
          pilotSortLast,
          pilotSortFirst,
        });
      }

      const copilotHasName = !!String(
        row.copilot_nickname || row.copilot_first || row.copilot_last || "",
      ).trim();

      if (copilotHasName) {
        const copilotName = {
          firstName:
            (row.copilot_nickname || "").trim() ||
            (row.copilot_first || "").trim() ||
            "Guest",
          lastName: (row.copilot_last || "").trim(),
        };

        nextTags.push({
          key: `${row.id}-copilot`,
          attendeeId: row.id,
          eventName,
          memberNumber,
          firstName: copilotName.firstName,
          lastName: copilotName.lastName,
          cityState: place,
          isFirstTimer,
          pilotSortLast,
          pilotSortFirst,
        });
      }

      return nextTags;
    });

    return tags.sort((a, b) => {
      if (a.isFirstTimer !== b.isFirstTimer) {
        return a.isFirstTimer ? -1 : 1;
      }

      return (
        a.pilotSortLast.localeCompare(b.pilotSortLast, undefined, {
          sensitivity: "base",
        }) ||
        a.pilotSortFirst.localeCompare(b.pilotSortFirst, undefined, {
          sensitivity: "base",
        }) ||
        a.key.localeCompare(b.key, undefined, { sensitivity: "base" })
      );
    });
  }, [event?.name, event?.start_date, printableRows]);

  const dateRange = formatDateRange(event?.start_date, event?.end_date);

  function toggleSelected(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function selectAllFiltered() {
    setSelectedIds(filteredAttendees.map((row) => row.id));
  }

  function clearSelected() {
    setSelectedIds([]);
  }

  function handlePrint() {
    window.print();
  }

  if (!loading && accessDenied) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Print Center</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          You do not have access to this page.
        </div>
      </div>
    );
  }

  const backgroundUrl =
    printMode === "name_tags"
      ? settings?.name_tag_bg_url || null
      : settings?.coach_plate_bg_url || null;
  const clubLogoUrl = "/fcoc-logo.png";
  const activeTextColor =
    printMode === "name_tags" ? nameTagTextColor : coachPlateTextColor;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }

          .print-area, .print-area * {
            visibility: visible;
          }

          .print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: white;
          }

          .no-print {
            display: none !important;
          }

          @page {
            size: letter portrait;
            margin: 0.2in;
          }

          .name-tag-sheet {
            display: grid !important;
            grid-template-columns: repeat(2, 4in) !important;
            grid-auto-rows: 3in !important;
            justify-content: center !important;
            gap: 0.1in !important;
          }

          .name-tag-card {
            width: 4in !important;
            height: 3in !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          .name-tag-card:nth-child(6n) {
            page-break-after: always;
          }
        }
      `}</style>

      <div className="card no-print" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Print Center</h1>

        <div style={{ fontSize: 14, opacity: 0.8 }}>
          {event?.name || "No event selected"}
          {event?.location ? ` • ${event.location}` : ""}
          {dateRange ? ` • ${dateRange}` : ""}
        </div>

        <div style={{ marginTop: 12, fontSize: 14 }}>{status}</div>

        {error ? <div style={errorBoxStyle}>{error}</div> : null}
      </div>

      <div className="card no-print" style={{ padding: 18 }}>
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            alignItems: "end",
          }}
        >
          <div>
            <label style={labelStyle}>Print Type</label>
            <select
              value={printMode}
              onChange={(e) => setPrintMode(e.target.value as PrintMode)}
              style={inputStyle}
            >
              <option value="name_tags">Name Tags</option>
              <option value="coach_plates">Coach Plates</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Filter</label>
            <select
              value={printFilter}
              onChange={(e) => setPrintFilter(e.target.value as PrintFilter)}
              style={inputStyle}
            >
              <option value="all">All Attendees</option>
              <option value="arrived">Arrived Only</option>
              <option value="first_timers">First Timers Only</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Font Color</label>
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                minHeight: 42,
              }}
            >
              <input
                type="color"
                value={activeTextColor}
                onChange={(e) => {
                  const next = e.target.value;
                  if (printMode === "name_tags") {
                    setNameTagTextColor(next);
                  } else {
                    setCoachPlateTextColor(next);
                  }
                }}
                style={{
                  width: 52,
                  height: 42,
                  padding: 0,
                  border: "1px solid #ccc",
                  borderRadius: 8,
                  background: "white",
                  cursor: "pointer",
                }}
              />
              <div style={{ fontSize: 13, color: "#555" }}>
                {activeTextColor}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 8, alignItems: "end" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              Include inactive attendees
            </label>

            {printMode === "name_tags" ? (
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={showFirstTimerOnNameTags}
                  onChange={(e) =>
                    setShowFirstTimerOnNameTags(e.target.checked)
                  }
                />
                Print FIRST TIMER on name tags
              </label>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "end",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={selectAllFiltered}
              style={secondaryButtonStyle}
            >
              Select All Filtered
            </button>
            <button
              type="button"
              onClick={clearSelected}
              style={secondaryButtonStyle}
            >
              Clear Selected
            </button>
            <button
              type="button"
              onClick={handlePrint}
              style={primaryButtonStyle}
              disabled={printableRows.length === 0}
            >
              Print
            </button>
          </div>
        </div>

        <div style={{ marginTop: 14, fontSize: 13, color: "#666" }}>
          Selected {printableRows.length} of {filteredAttendees.length} filtered
          attendees.
          {printMode === "name_tags"
            ? ` This will print ${printableNameTags.length} name tag${printableNameTags.length === 1 ? "" : "s"}.`
            : ""}
        </div>
      </div>

      <div className="card no-print" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Who Will Print</h2>

        {loading ? (
          <div>Loading...</div>
        ) : filteredAttendees.length === 0 ? (
          <div style={{ opacity: 0.8 }}>
            No attendees found for this filter.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {filteredAttendees.map((row) => {
              const pilot = displayPilotName(row) || "Unnamed";
              const copilot = displayCopilotName(row);

              return (
                <label
                  key={row.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "start",
                    padding: "10px 12px",
                    border: "1px solid #ddd",
                    borderRadius: 10,
                    background: selectedIds.includes(row.id)
                      ? "#f8fafc"
                      : "white",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(row.id)}
                    onChange={() => toggleSelected(row.id)}
                    style={{ marginTop: 3 }}
                  />
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {pilot}
                      {copilot ? ` / ${copilot}` : ""}
                    </div>
                    <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
                      Site: {row.assigned_site || "—"}
                      {row.membership_number
                        ? ` • Member #: ${row.membership_number}`
                        : ""}
                      {row.has_arrived ? " • Arrived" : ""}
                      {row.is_first_timer ? " • First Timer" : ""}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="print-area">
        {printMode === "name_tags" ? (
          <div
            className="name-tag-sheet"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 4in)",
              gridAutoRows: "3in",
              justifyContent: "center",
              gap: "0.1in",
            }}
          >
            {printableNameTags.map((tag) => {
              return (
                <div
                  key={tag.key}
                  className="name-tag-card"
                  style={{
                    position: "relative",
                    width: "4in",
                    height: "3in",
                    border: "1px solid #ddd",
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "#fff",
                    pageBreakInside: "avoid",
                    breakInside: "avoid",
                  }}
                >
                  {backgroundUrl ? (
                    <img
                      src={backgroundUrl}
                      alt=""
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : null}

                  <div
                    style={{
                      position: "relative",
                      zIndex: 1,
                      height: "100%",
                      padding: 14,
                      display: "grid",
                      gridTemplateRows: "auto auto auto 1fr auto auto auto",
                      alignItems: "center",
                      textAlign: "center",
                      color: nameTagTextColor,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 800,
                        lineHeight: 1.05,
                        color: nameTagTextColor,
                      }}
                    >
                      {tag.eventName}
                    </div>

                    <div style={{ height: 6 }} />

                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <img
                        src={clubLogoUrl}
                        alt="FCOC logo"
                        style={{
                          width: 120,
                          maxHeight: 64,
                          objectFit: "contain",
                        }}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    </div>

                    <div />

                    <div
                      style={{
                        fontSize: 18,
                        lineHeight: 1,
                        fontWeight: 500,
                        color: nameTagTextColor,
                      }}
                    >
                      {tag.memberNumber || " "}
                    </div>

                    <div
                      style={{
                        fontSize: 48,
                        fontWeight: 800,
                        lineHeight: 0.95,
                        marginTop: 2,
                        color: nameTagTextColor,
                      }}
                    >
                      {tag.firstName}
                    </div>

                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 500,
                        lineHeight: 1.1,
                        marginTop: 4,
                        color: nameTagTextColor,
                      }}
                    >
                      {tag.lastName || " "}
                    </div>

                    <div
                      style={{
                        fontSize: 16,
                        lineHeight: 1.15,
                        marginTop: 4,
                        color: nameTagTextColor,
                      }}
                    >
                      {tag.cityState || " "}
                    </div>

                    {showFirstTimerOnNameTags && tag.isFirstTimer ? (
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 800,
                          lineHeight: 1.1,
                          marginTop: 4,
                          color: nameTagTextColor,
                        }}
                      >
                        FIRST TIMER
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 20 }}>
            {printableRows.map((row) => {
              const pilot = displayPilotName(row) || "Guest";
              const copilot = displayCopilotName(row);
              const site = row.assigned_site || "";
              const coach = coachText(row);

              return (
                <div
                  key={row.id}
                  style={{
                    position: "relative",
                    minHeight: 250,
                    border: "1px solid #ddd",
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "#fff",
                    pageBreakInside: "avoid",
                    breakInside: "avoid",
                  }}
                >
                  {backgroundUrl ? (
                    <img
                      src={backgroundUrl}
                      alt=""
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : null}

                  <div
                    style={{
                      position: "relative",
                      zIndex: 1,
                      minHeight: 250,
                      padding: 24,
                      display: "grid",
                      alignContent: "space-between",
                      color: coachPlateTextColor,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 42,
                          fontWeight: 900,
                          lineHeight: 1.05,
                          textAlign: "center",
                          color: coachPlateTextColor,
                        }}
                      >
                        {pilot}
                      </div>

                      {copilot ? (
                        <div
                          style={{
                            marginTop: 10,
                            fontSize: 28,
                            fontWeight: 700,
                            textAlign: "center",
                            color: coachPlateTextColor,
                          }}
                        >
                          {copilot}
                        </div>
                      ) : null}
                    </div>

                    <div style={{ textAlign: "center" }}>
                      {coach ? (
                        <div
                          style={{
                            fontSize: 18,
                            fontWeight: 700,
                            color: coachPlateTextColor,
                          }}
                        >
                          {coach}
                        </div>
                      ) : null}

                      <div
                        style={{
                          fontSize: 28,
                          fontWeight: 900,
                          marginTop: 10,
                          color: coachPlateTextColor,
                        }}
                      >
                        {site ? `SITE ${site}` : " "}
                      </div>

                      {row.is_first_timer ? (
                        <div
                          style={{
                            marginTop: 8,
                            fontSize: 16,
                            fontWeight: 800,
                            color: coachPlateTextColor,
                          }}
                        >
                          FIRST TIMER
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
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
  marginTop: 12,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e2b4b4",
  background: "#fff3f3",
  color: "#8a1f1f",
};

export default function AdminPrintPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_reports">
      <AdminPrintPageInner />
    </AdminRouteGuard>
  );
}
