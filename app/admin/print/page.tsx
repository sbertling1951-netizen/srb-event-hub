// REPLACED BY REQUEST
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
type SortType = "alpha" | "first_timers_first_alpha" | "returnees_first_alpha";

type PrintEditOverride = {
  pilot_first?: string;
  pilot_last?: string;
  nickname?: string;
  copilot_first?: string;
  copilot_last?: string;
  copilot_nickname?: string;
  membership_number?: string;
  city?: string;
  state?: string;
  is_first_timer?: boolean;
};

type ManualPrintEntryKind = "name_tag" | "coach_plate";

type NameTagRow = {
  key: string;
  attendeeId: string;
  eventName: string;
  memberNumber: string;
  firstName: string;
  lastName: string;
  cityState: string;
  isFirstTimer: boolean;
};

function createEmptyManualAttendee(kind: ManualPrintEntryKind): AttendeeRow {
  const uniqueId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    id: `manual-${kind}-${uniqueId}`,
    event_id: "manual",
    entry_id: null,
    email: null,
    pilot_first: kind === "coach_plate" ? "Guest" : "",
    pilot_last: "",
    copilot_first: "",
    copilot_last: "",
    nickname: "",
    copilot_nickname: "",
    membership_number: "",
    city: "",
    state: "",
    assigned_site: null,
    has_arrived: null,
    is_first_timer: false,
    coach_manufacturer: null,
    coach_model: null,
    coach_length: null,
    is_active: true,
  };
}

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

function sameLastName(row: AttendeeRow) {
  const pilotLast = (row.pilot_last || "").trim();
  const copilotLast = (row.copilot_last || "").trim();

  return (
    !!pilotLast &&
    !!copilotLast &&
    pilotLast.toLowerCase() === copilotLast.toLowerCase()
  );
}

function buildCoachPlateNameLines(row: AttendeeRow) {
  const pilotFirst = (row.nickname || row.pilot_first || "").trim();
  const pilotLast = (row.pilot_last || "").trim();

  const copilotFirst = (row.copilot_nickname || row.copilot_first || "").trim();
  const copilotLast = (row.copilot_last || "").trim();

  if (pilotFirst && copilotFirst && sameLastName(row)) {
    return {
      line1: `${pilotFirst} & ${copilotFirst}`,
      line2: pilotLast || copilotLast,
    };
  }

  if (pilotFirst || pilotLast || copilotFirst || copilotLast) {
    return {
      line1:
        [pilotFirst, pilotLast].filter(Boolean).join(" ").trim() || "Guest",
      line2: [copilotFirst, copilotLast].filter(Boolean).join(" ").trim(),
    };
  }

  return {
    line1: "Guest",
    line2: "",
  };
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

function applyPrintOverride(
  row: AttendeeRow,
  overrides?: PrintEditOverride,
): AttendeeRow {
  if (!overrides) return row;

  return {
    ...row,
    pilot_first: overrides.pilot_first ?? row.pilot_first,
    pilot_last: overrides.pilot_last ?? row.pilot_last,
    nickname: overrides.nickname ?? row.nickname,
    copilot_first: overrides.copilot_first ?? row.copilot_first,
    copilot_last: overrides.copilot_last ?? row.copilot_last,
    copilot_nickname: overrides.copilot_nickname ?? row.copilot_nickname,
    membership_number: overrides.membership_number ?? row.membership_number,
    city: overrides.city ?? row.city,
    state: overrides.state ?? row.state,
    is_first_timer: overrides.is_first_timer ?? row.is_first_timer,
  };
}

function compareRowsByAlpha(a: AttendeeRow, b: AttendeeRow) {
  const aLast = String(a.pilot_last || "")
    .trim()
    .toLowerCase();
  const bLast = String(b.pilot_last || "")
    .trim()
    .toLowerCase();
  const aFirst = String(a.nickname || a.pilot_first || "")
    .trim()
    .toLowerCase();
  const bFirst = String(b.nickname || b.pilot_first || "")
    .trim()
    .toLowerCase();

  return (
    aLast.localeCompare(bLast, undefined, { sensitivity: "base" }) ||
    aFirst.localeCompare(bFirst, undefined, { sensitivity: "base" }) ||
    String(a.id).localeCompare(String(b.id), undefined, { sensitivity: "base" })
  );
}

function sortRowsForPrint(rows: AttendeeRow[], sortType: SortType) {
  const sorted = [...rows];

  sorted.sort((a, b) => {
    if (sortType === "first_timers_first_alpha") {
      const aFirst = a.is_first_timer ? 0 : 1;
      const bFirst = b.is_first_timer ? 0 : 1;
      if (aFirst !== bFirst) return aFirst - bFirst;
    }

    if (sortType === "returnees_first_alpha") {
      const aReturnee = a.is_first_timer ? 1 : 0;
      const bReturnee = b.is_first_timer ? 1 : 0;
      if (aReturnee !== bReturnee) return aReturnee - bReturnee;
    }

    return compareRowsByAlpha(a, b);
  });

  return sorted;
}

function AdminPrintPageInner() {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [settings, setSettings] = useState<PrintSettingsRow | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading print center...");
  const [editAttendeeId, setEditAttendeeId] = useState<string | null>(null);
  const [printOverrides, setPrintOverrides] = useState<
    Record<string, PrintEditOverride>
  >({});
  const [manualAttendees, setManualAttendees] = useState<AttendeeRow[]>([]);

  const [printMode, setPrintMode] = useState<PrintMode>("name_tags");
  const [printFilter, setPrintFilter] = useState<PrintFilter>("all");
  const [sortType, setSortType] = useState<SortType>("alpha");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showFirstTimerOnNameTags, setShowFirstTimerOnNameTags] =
    useState(false);
  const [nameTagTextColor, setNameTagTextColor] = useState("#000000");
  const [coachPlateTextColor, setCoachPlateTextColor] = useState("#000000");
  const printEditorRef = useRef<HTMLDivElement | null>(null);

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
        setManualAttendees([]);
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
      setManualAttendees([]);
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
    let rows = [...attendees, ...manualAttendees];

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
  }, [attendees, manualAttendees, printFilter, includeInactive]);

  const sortedFilteredAttendees = useMemo(() => {
    const rowsWithOverrides = filteredAttendees.map((row) =>
      applyPrintOverride(row, printOverrides[row.id]),
    );
    return sortRowsForPrint(rowsWithOverrides, sortType);
  }, [filteredAttendees, printOverrides, sortType]);

  const printableRows = useMemo(() => {
    return sortedFilteredAttendees.filter((row) =>
      selectedIds.includes(row.id),
    );
  }, [sortedFilteredAttendees, selectedIds]);

  const printableNameTags = useMemo<NameTagRow[]>(() => {
    const rawEventName = event?.name?.trim() || "FCOC Event";
    const eventYear = (event?.start_date || "").slice(0, 4).trim();
    const eventName = eventYear
      ? `${rawEventName.replace(new RegExp(`\\s*${eventYear}$`), "").trim()} ${eventYear}`.trim()
      : rawEventName;

    return printableRows.flatMap((row) => {
      const nextTags: NameTagRow[] = [];
      const memberNumber = row.membership_number || "";
      const place = cityState(row);
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
        });
      }

      return nextTags;
    });
  }, [event?.name, event?.start_date, printableRows]);

  const dateRange = formatDateRange(event?.start_date, event?.end_date);

  const editRow = useMemo(() => {
    if (!editAttendeeId) return null;
    return (
      [...attendees, ...manualAttendees].find(
        (row) => row.id === editAttendeeId,
      ) || null
    );
  }, [attendees, manualAttendees, editAttendeeId]);

  const editPreviewRow = useMemo(() => {
    if (!editRow) return null;
    return applyPrintOverride(editRow, printOverrides[editRow.id]);
  }, [editRow, printOverrides]);

  useEffect(() => {
    if (!editPreviewRow || !printEditorRef.current) return;

    requestAnimationFrame(() => {
      printEditorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [editPreviewRow]);

  function toggleSelected(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function selectAllFiltered() {
    setSelectedIds(sortedFilteredAttendees.map((row) => row.id));
  }

  function clearSelected() {
    setSelectedIds([]);
  }

  function updatePrintOverride(
    attendeeId: string,
    field: keyof PrintEditOverride,
    value: string | boolean,
  ) {
    setPrintOverrides((prev) => ({
      ...prev,
      [attendeeId]: {
        ...prev[attendeeId],
        [field]: value,
      },
    }));
  }

  function clearPrintOverride(attendeeId: string) {
    setPrintOverrides((prev) => {
      const next = { ...prev };
      delete next[attendeeId];
      return next;
    });
  }

  function createManualEntry(kind: ManualPrintEntryKind) {
    const nextRow = createEmptyManualAttendee(kind);

    setManualAttendees((prev) => [...prev, nextRow]);
    setSelectedIds((prev) => [...prev, nextRow.id]);
    setEditAttendeeId(nextRow.id);
    setPrintMode(kind === "name_tag" ? "name_tags" : "coach_plates");
  }

  function printOnlyAttendee(attendeeId: string) {
    setSelectedIds([attendeeId]);

    requestAnimationFrame(() => {
      window.print();
    });
  }

  function removeManualEntry(attendeeId: string) {
    setManualAttendees((prev) => prev.filter((row) => row.id !== attendeeId));
    setSelectedIds((prev) => prev.filter((id) => id !== attendeeId));
    setPrintOverrides((prev) => {
      const next = { ...prev };
      delete next[attendeeId];
      return next;
    });
    setEditAttendeeId((prev) => (prev === attendeeId ? null : prev));
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
  const clubLogoUrl = "/fcoc-logo.svg";
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
      size: ${printMode === "coach_plates" ? "letter landscape" : "letter portrait"};
      margin: ${printMode === "coach_plates" ? "0" : "0.2in"};
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

    .coach-plate-sheet {
      display: block !important;
      page-break-before: auto !important;
    }

    .coach-plate-card {
      width: 11in !important;
      height: 8.5in !important;
      margin: 0 !important;
      border: none !important;
      border-radius: 0 !important;
      break-after: page !important;
      page-break-after: always !important;
      page-break-inside: avoid !important;
      break-inside: avoid-page !important;
    }

    .coach-plate-card:last-child {
      break-after: auto !important;
      page-break-after: auto !important;
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
            <label style={labelStyle}>Sort</label>
            <select
              value={sortType}
              onChange={(e) => setSortType(e.target.value as SortType)}
              style={inputStyle}
            >
              <option value="alpha">Alphabetical</option>
              <option value="first_timers_first_alpha">
                First Timers, Then Returnees
              </option>
              <option value="returnees_first_alpha">
                Returnees, Then First Timers
              </option>
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
              onClick={() => createManualEntry("name_tag")}
              style={secondaryButtonStyle}
            >
              Create Name Tag
            </button>
            <button
              type="button"
              onClick={() => createManualEntry("coach_plate")}
              style={secondaryButtonStyle}
            >
              Create Coach Plate
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
          Selected {printableRows.length} of {sortedFilteredAttendees.length}{" "}
          filtered attendees.
          {printMode === "name_tags"
            ? ` This will print ${printableNameTags.length} name tag${printableNameTags.length === 1 ? "" : "s"}.`
            : ""}
        </div>
      </div>

      <div className="card no-print" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Who Will Print</h2>

        {loading ? (
          <div>Loading...</div>
        ) : sortedFilteredAttendees.length === 0 ? (
          <div style={{ opacity: 0.8 }}>
            No attendees found for this filter.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {sortedFilteredAttendees.map((row) => {
              const pilot = displayPilotName(row) || "Unnamed";
              const copilot = displayCopilotName(row);

              return (
                <div
                  key={row.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "start",
                    padding: "10px 12px",
                    border: "1px solid #ddd",
                    borderRadius: 10,
                    background: row.id.startsWith("manual-")
                      ? "#fff7ed"
                      : selectedIds.includes(row.id)
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
                      {row.id.startsWith("manual-") ? " • Manual" : ""}
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditAttendeeId(row.id);
                        }}
                        style={secondaryButtonStyle}
                      >
                        Edit For Print
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          printOnlyAttendee(row.id);
                        }}
                        style={secondaryButtonStyle}
                      >
                        Print This Only
                      </button>
                      {row.id.startsWith("manual-") ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeManualEntry(row.id);
                          }}
                          style={secondaryButtonStyle}
                        >
                          Delete Manual
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editPreviewRow ? (
        <div
          ref={printEditorRef}
          className="card no-print"
          style={{ padding: 18 }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 12 }}>Print Editor</h2>
          <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 14 }}>
            {editPreviewRow.id.startsWith("manual-")
              ? "Manual print entry"
              : "Session-only print overrides for"}{" "}
            {displayPilotName(editPreviewRow) || "Guest"}
            {displayCopilotName(editPreviewRow)
              ? ` / ${displayCopilotName(editPreviewRow)}`
              : ""}
          </div>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <div>
              <label style={labelStyle}>Pilot First</label>
              <input
                value={editPreviewRow.pilot_first || ""}
                onChange={(e) =>
                  updatePrintOverride(
                    editPreviewRow.id,
                    "pilot_first",
                    e.target.value,
                  )
                }
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Pilot Last</label>
              <input
                value={editPreviewRow.pilot_last || ""}
                onChange={(e) =>
                  updatePrintOverride(
                    editPreviewRow.id,
                    "pilot_last",
                    e.target.value,
                  )
                }
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Pilot Nickname</label>
              <input
                value={editPreviewRow.nickname || ""}
                onChange={(e) =>
                  updatePrintOverride(
                    editPreviewRow.id,
                    "nickname",
                    e.target.value,
                  )
                }
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Co-Pilot First</label>
              <input
                value={editPreviewRow.copilot_first || ""}
                onChange={(e) =>
                  updatePrintOverride(
                    editPreviewRow.id,
                    "copilot_first",
                    e.target.value,
                  )
                }
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Co-Pilot Last</label>
              <input
                value={editPreviewRow.copilot_last || ""}
                onChange={(e) =>
                  updatePrintOverride(
                    editPreviewRow.id,
                    "copilot_last",
                    e.target.value,
                  )
                }
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Co-Pilot Nickname</label>
              <input
                value={editPreviewRow.copilot_nickname || ""}
                onChange={(e) =>
                  updatePrintOverride(
                    editPreviewRow.id,
                    "copilot_nickname",
                    e.target.value,
                  )
                }
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Member Number</label>
              <input
                value={editPreviewRow.membership_number || ""}
                onChange={(e) =>
                  updatePrintOverride(
                    editPreviewRow.id,
                    "membership_number",
                    e.target.value,
                  )
                }
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>City</label>
              <input
                value={editPreviewRow.city || ""}
                onChange={(e) =>
                  updatePrintOverride(editPreviewRow.id, "city", e.target.value)
                }
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>State</label>
              <input
                value={editPreviewRow.state || ""}
                onChange={(e) =>
                  updatePrintOverride(
                    editPreviewRow.id,
                    "state",
                    e.target.value,
                  )
                }
                style={inputStyle}
              />
            </div>
          </div>

          <div
            style={{
              marginTop: 14,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!editPreviewRow.is_first_timer}
                onChange={(e) =>
                  updatePrintOverride(
                    editPreviewRow.id,
                    "is_first_timer",
                    e.target.checked,
                  )
                }
              />
              First Timer for print
            </label>
          </div>

          <div
            style={{
              marginTop: 14,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={() => clearPrintOverride(editPreviewRow.id)}
              style={secondaryButtonStyle}
            >
              Clear Overrides
            </button>
            {editPreviewRow.id.startsWith("manual-") ? (
              <button
                type="button"
                onClick={() => removeManualEntry(editPreviewRow.id)}
                style={secondaryButtonStyle}
              >
                Delete Manual Entry
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => printOnlyAttendee(editPreviewRow.id)}
              style={primaryButtonStyle}
            >
              Print This Only
            </button>
            <button
              type="button"
              onClick={() => setEditAttendeeId(null)}
              style={secondaryButtonStyle}
            >
              Close Editor
            </button>
          </div>
        </div>
      ) : null}

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
                          width: 150,
                          maxHeight: 80,
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
          <div
            className="coach-plate-sheet"
            style={{ display: "grid", gap: 20 }}
          >
            {printableRows.map((row) => {
              const rawEventName = event?.name?.trim() || "FCOC Event";
              const eventYear = (event?.start_date || "").slice(0, 4).trim();
              const eventName = eventYear
                ? `${rawEventName.replace(new RegExp(`\\s*${eventYear}$`), "").trim()} ${eventYear}`.trim()
                : rawEventName;

              const memberNumber = row.membership_number || "";
              const place = cityState(row);
              const nameLines = buildCoachPlateNameLines(row);

              return (
                <div
                  key={row.id}
                  className="coach-plate-card"
                  style={{
                    position: "relative",
                    width: "11in",
                    height: "8.5in",
                    minHeight: "8.5in",
                    border: "none",
                    borderRadius: 0,
                    overflow: "hidden",
                    background: "#fff",
                    pageBreakInside: "avoid",
                    breakInside: "avoid-page",
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
                      minHeight: "0",
                      padding: "0.35in 0.6in",
                      display: "grid",
                      gridTemplateRows: "auto auto auto auto 1fr auto",
                      rowGap: "0.12in",
                      alignItems: "center",
                      justifyItems: "center",
                      textAlign: "center",
                      color: coachPlateTextColor,
                      boxSizing: "border-box",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 36,
                        fontWeight: 800,
                        lineHeight: 1.05,
                        color: coachPlateTextColor,
                      }}
                    >
                      {eventName}
                    </div>

                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <img
                        src={clubLogoUrl}
                        alt="FCOC logo"
                        style={{
                          width: "7in",
                          maxHeight: "3.2in",
                          objectFit: "contain",
                        }}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    </div>

                    <div
                      style={{
                        fontSize: 34,
                        fontWeight: 700,
                        lineHeight: 1,
                        color: coachPlateTextColor,
                      }}
                    >
                      {memberNumber || " "}
                    </div>

                    <div
                      style={{
                        display: "grid",
                        alignContent: "center",
                        justifyItems: "center",
                        gap: 8,
                        marginTop: "0.5in",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 100,
                          fontWeight: 900,
                          lineHeight: 0.95,
                          color: coachPlateTextColor,
                        }}
                      >
                        {nameLines.line1 || " "}
                      </div>

                      <div
                        style={{
                          fontSize: 64,
                          fontWeight: 700,
                          lineHeight: 1.05,
                          color: coachPlateTextColor,
                        }}
                      >
                        {nameLines.line2 || " "}
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: 34,
                        fontWeight: 600,
                        lineHeight: 1.1,
                        marginTop: 10,
                        color: coachPlateTextColor,
                      }}
                    >
                      {place || " "}
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
