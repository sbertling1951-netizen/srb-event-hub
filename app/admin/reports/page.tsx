"use client";

import { useSearchParams } from "next/navigation";
import {
  type CSSProperties,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as XLSX from "xlsx";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import {
  canAccessEvent,
  getCurrentAdminAccess,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

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
  participant_type: string | null;
  source_type: string | null;
  include_in_headcount: boolean | null;
  needs_name_tag: boolean | null;
  needs_coach_plate: boolean | null;
  needs_parking: boolean | null;
  notes: string | null;
  data_status?: string | null;
  created_at: string | null;
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
type ParticipantTypeFilter =
  | "all"
  | "attendee"
  | "vendor"
  | "staff"
  | "speaker"
  | "volunteer"
  | "event_host";

type DataStatusFilter = "all" | "pending" | "corrected" | "reviewed" | "locked";

type ReportPreset = {
  id: string;
  name: string;
  reportType: ReportType;
  sortType: SortType;
  participantTypeFilter: ParticipantTypeFilter;
  dataStatusFilter: DataStatusFilter;
};

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

const ADMIN_EVENT_STORAGE_KEY = "srb-event-hub-admin-event-context";
const ADMIN_EVENT_CHANGED_KEY = "srb-event-hub-admin-event-changed";
const USER_MODE_KEY = "srb-event-hub-user-mode";
const USER_MODE_CHANGED_KEY = "srb-event-hub-user-mode-changed";
const ADMIN_EVENT_UPDATED_EVENT = "srb-event-hub-admin-event-updated";
const REPORT_PRESETS_STORAGE_KEY = "srb-event-hub-admin-report-presets";

function getStoredAdminEvent(): EventContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(ADMIN_EVENT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
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
  if (!value) {
    return "attendee";
  }
  return value.replace(/_/g, " ");
}

function dataStatusLabel(value?: string | null) {
  if (!value) {
    return "pending";
  }
  if (value === "pending") {
    return "pending";
  }
  if (value === "reviewed") {
    return "reviewed";
  }
  if (value === "corrected") {
    return "corrected";
  }
  if (value === "locked") {
    return "locked";
  }
  return value;
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

function loadStoredReportPresets(): ReportPreset[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = localStorage.getItem(REPORT_PRESETS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ReportPreset[]) : [];
  } catch {
    return [];
  }
}

function saveStoredReportPresets(presets: ReportPreset[]) {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(REPORT_PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

export default function AdminReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="card" style={{ padding: 18 }}>
          Loading reports...
        </div>
      }
    >
      <AdminReportsPageContent />
    </Suspense>
  );
}

function AdminReportsPageContent() {
  const searchParams = useSearchParams();
  const isEmbedded = searchParams.get("embedded") === "1";

  if (isEmbedded) {
    return <AdminReportsPageInner />;
  }

  return (
    <AdminRouteGuard requiredPermission="can_manage_reports">
      <AdminReportsPageInner />
    </AdminRouteGuard>
  );
}

function AdminReportsPageInner() {
  const searchParams = useSearchParams();
  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [parkingSites, setParkingSites] = useState<ParkingSiteRow[]>([]);
  const [reportType, setReportType] = useState<ReportType>(
    "parking_assignments",
  );
  const [sortType, setSortType] = useState<SortType>("name_asc");
  const [participantTypeFilter, setParticipantTypeFilter] =
    useState<ParticipantTypeFilter>("all");

  const [dataStatusFilter, setDataStatusFilter] =
    useState<DataStatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading reports...");
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [savedPresets, setSavedPresets] = useState<ReportPreset[]>([]);
  const [reportPackType, setReportPackType] = useState<
    "parking_ops" | "checkin_ops" | "hospitality_ops"
  >("parking_ops");

  const isEmbedded = searchParams.get("embedded") === "1";

  useEffect(() => {
    if (!isEmbedded) {
      return;
    }

    document.body.classList.add("admin-embedded-shell");

    return () => {
      document.body.classList.remove("admin-embedded-shell");
    };
  }, [isEmbedded]);

  function resetPageState() {
    setCurrentEvent(null);
    setAttendees([]);
    setActivities([]);
    setParkingSites([]);
    setCanExport(false);
    setAccessDenied(false);
  }

  const loadData = useCallback(async (activeEventId: string) => {
    setLoading(true);
    setError(null);
    setStatus("Loading reports...");

    const admin = await getCurrentAdminAccess();

    if (!admin) {
      resetPageState();
      setError("No admin access.");
      setStatus("Access denied.");
      setLoading(false);
      setAccessDenied(true);
      return;
    }

    if (!hasPermission(admin, "can_manage_reports")) {
      resetPageState();
      setError("You do not have permission to manage reports.");
      setStatus("Access denied.");
      setLoading(false);
      setAccessDenied(true);
      return;
    }

    if (!canAccessEvent(admin, activeEventId)) {
      resetPageState();
      setError("You do not have access to this event.");
      setStatus("Access denied.");
      setLoading(false);
      setAccessDenied(true);
      return;
    }

    setCanExport(hasPermission(admin, "can_export_reports"));

    const [
      { data: attendeeData, error: attendeeError },
      { data: activityData, error: activityError },
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
            data_status,
            created_at
          `,
        )
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
        .select("id,event_id,site_number,display_label,assigned_attendee_id")
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
    setCurrentEvent((prev) =>
      prev?.id === activeEventId
        ? prev
        : { ...(prev || {}), id: activeEventId },
    );
    setStatus("Reports ready.");
    setAccessDenied(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    setSavedPresets(loadStoredReportPresets());
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      setStatus("Checking admin access...");
      setAccessDenied(false);
      setCanExport(false);

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        resetPageState();
        setError("No admin access.");
        setStatus("Access denied.");
        setLoading(false);
        setAccessDenied(true);
        return;
      }

      if (!hasPermission(admin, "can_manage_reports")) {
        resetPageState();
        setError("You do not have permission to manage reports.");
        setStatus("Access denied.");
        setLoading(false);
        setAccessDenied(true);
        return;
      }

      setCanExport(hasPermission(admin, "can_export_reports"));

      const event = getStoredAdminEvent();

      if (!event?.id) {
        resetPageState();
        setStatus("No admin event selected.");
        setLoading(false);
        return;
      }

      if (!canAccessEvent(admin, event.id)) {
        resetPageState();
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
        e.key === ADMIN_EVENT_CHANGED_KEY ||
        e.key === ADMIN_EVENT_STORAGE_KEY ||
        e.key === USER_MODE_KEY ||
        e.key === USER_MODE_CHANGED_KEY
      ) {
        void init();
      }
    }

    function handleAdminEventUpdated() {
      void init();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      ADMIN_EVENT_UPDATED_EVENT,
      handleAdminEventUpdated as EventListener,
    );

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        ADMIN_EVENT_UPDATED_EVENT,
        handleAdminEventUpdated as EventListener,
      );
    };
  }, [loadData]);

  useEffect(() => {
    if (reportType === "parking_assignments") {
      setSortType("site_asc");
    } else if (reportType === "unassigned_parking_needed") {
      setSortType("name_asc");
    }
  }, [reportType]);

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
          .filter((row) =>
            attendeeMatchesFilters(
              row,
              participantTypeFilter,
              dataStatusFilter,
            ),
          )
          .map(attendeeToRosterRow);

      case "volunteers":
        return attendees
          .filter((row) => row.wants_to_volunteer)
          .filter((row) =>
            attendeeMatchesFilters(
              row,
              participantTypeFilter,
              dataStatusFilter,
            ),
          )
          .map(attendeeToRosterRow);

      case "vendors":
        return attendees
          .filter((row) => (row.participant_type || "") === "vendor")
          .filter((row) =>
            attendeeMatchesFilters(
              row,
              participantTypeFilter,
              dataStatusFilter,
            ),
          )
          .map(attendeeToRosterRow);

      case "staff_hosts_helpers":
        return attendees
          .filter((row) =>
            ["staff", "host", "helper", "volunteer", "vip"].includes(
              row.participant_type || "",
            ),
          )
          .filter((row) =>
            attendeeMatchesFilters(
              row,
              participantTypeFilter,
              dataStatusFilter,
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

            if (
              assigned &&
              !attendeeMatchesFilters(
                assigned,
                participantTypeFilter,
                dataStatusFilter,
              )
            ) {
              return null;
            }

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
          })
          .filter(Boolean) as RosterRow[];

      case "unassigned_parking_needed":
        return attendees
          .filter((row) => row.needs_parking && !row.assigned_site)
          .filter((row) =>
            attendeeMatchesFilters(
              row,
              participantTypeFilter,
              dataStatusFilter,
            ),
          )
          .map(attendeeToRosterRow);

      default:
        return [];
    }
  }, [
    reportType,
    attendees,
    parkingSites,
    attendeeById,
    participantTypeFilter,
    dataStatusFilter,
  ]);

  const sortedRosterRows = useMemo(() => {
    if (reportType === "activity_summary") {
      return [];
    }
    return sortRosterRows(rosterRows, sortType);
  }, [rosterRows, sortType, reportType]);

  function attendeeMatchesFilters(
    attendee: AttendeeRow,
    participantTypeFilter: ParticipantTypeFilter,
    dataStatusFilter: DataStatusFilter,
  ) {
    const matchesParticipantType =
      participantTypeFilter === "all"
        ? true
        : (attendee.participant_type || "attendee") === participantTypeFilter;

    const matchesDataStatus =
      dataStatusFilter === "all"
        ? true
        : dataStatusLabel(attendee.data_status) === dataStatusFilter;

    return matchesParticipantType && matchesDataStatus;
  }

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
      if (row) {
        row.participantCount = set.size;
      }
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

  const participantBreakdown = useMemo(() => {
    const counts = new Map<string, number>();

    for (const attendee of attendees) {
      const key = participantTypeLabel(attendee.participant_type);
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      );
  }, [attendees]);

  const dataStatusBreakdown = useMemo(() => {
    const counts = new Map<string, number>();

    for (const attendee of attendees) {
      const key = dataStatusLabel(attendee.data_status);
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      );
  }, [attendees]);

  const unassignedParkingRows = useMemo(() => {
    return sortRosterRows(
      attendees
        .filter((row) => row.needs_parking && !row.assigned_site)
        .filter((row) =>
          attendeeMatchesFilters(row, participantTypeFilter, dataStatusFilter),
        )
        .map(attendeeToRosterRow),
      "name_asc",
    );
  }, [attendees, participantTypeFilter, dataStatusFilter]);

  const notArrivedRows = useMemo(() => {
    return sortRosterRows(
      attendees
        .filter((row) => !row.has_arrived)
        .filter((row) =>
          attendeeMatchesFilters(row, participantTypeFilter, dataStatusFilter),
        )
        .map(attendeeToRosterRow),
      "name_asc",
    );
  }, [attendees, participantTypeFilter, dataStatusFilter]);

  const firstTimerRows = useMemo(() => {
    return sortRosterRows(
      attendees
        .filter((row) => !!row.is_first_timer)
        .filter((row) =>
          attendeeMatchesFilters(row, participantTypeFilter, dataStatusFilter),
        )
        .map(attendeeToRosterRow),
      "name_asc",
    );
  }, [attendees, participantTypeFilter, dataStatusFilter]);

  const vendorStaffRows = useMemo(() => {
    return sortRosterRows(
      attendees
        .filter((row) =>
          ["vendor", "staff", "speaker", "event_host"].includes(
            row.participant_type || "",
          ),
        )
        .filter((row) =>
          attendeeMatchesFilters(row, participantTypeFilter, dataStatusFilter),
        )
        .map(attendeeToRosterRow),
      "name_asc",
    );
  }, [attendees, participantTypeFilter, dataStatusFilter]);

  function buildExportRows(): string[][] {
    if (reportType === "activity_summary") {
      return [
        [reportTitle],
        ["Event", currentEvent?.name || currentEvent?.eventName || ""],
        ["Location", currentEvent?.location || ""],
        ["Sort", sortType],
        ["Participant Type Filter", participantTypeFilter],
        ["Data Status Filter", dataStatusFilter],
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
      ["Participant Type Filter", participantTypeFilter],
      ["Data Status Filter", dataStatusFilter],
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
    if (!canExport) {
      return;
    }

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
    if (!canExport) {
      return;
    }

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

  function handleSavePreset() {
    const trimmedName = presetName.trim();

    if (!trimmedName) {
      setError("Enter a preset name first.");
      return;
    }

    const nextPreset: ReportPreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmedName,
      reportType,
      sortType,
      participantTypeFilter,
      dataStatusFilter,
    };

    const nextPresets = [
      nextPreset,
      ...savedPresets.filter((p) => p.name !== trimmedName),
    ];

    setSavedPresets(nextPresets);
    saveStoredReportPresets(nextPresets);
    setPresetName("");
    setError(null);
    setStatus(`Saved report preset "${trimmedName}".`);
  }

  function handleApplyPreset(preset: ReportPreset) {
    setReportType(preset.reportType);
    setSortType(preset.sortType);
    setParticipantTypeFilter(preset.participantTypeFilter);
    setDataStatusFilter(preset.dataStatusFilter);
    setError(null);
    setStatus(`Applied report preset "${preset.name}".`);
  }

  function handleDeletePreset(presetId: string) {
    const nextPresets = savedPresets.filter((preset) => preset.id !== presetId);
    setSavedPresets(nextPresets);
    saveStoredReportPresets(nextPresets);
    setStatus("Report preset deleted.");
  }

  function handlePrintPack() {
    const titleMap = {
      parking_ops: "Parking Operations Pack",
      checkin_ops: "Check-In Pack",
      hospitality_ops: "Hospitality Pack",
    };

    const packTitle = titleMap[reportPackType];

    function makeSection(title: string, rows: RosterRow[]) {
      return `
      <h2>${title}</h2>
      <table>
        <thead>
          <tr>
            <th>Site</th>
            <th>Pilot</th>
            <th>Co-Pilot</th>
            <th>Email</th>
            <th>City/State</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length === 0
              ? `<tr><td colspan="5">No data</td></tr>`
              : rows
                  .map(
                    (r) => `
              <tr>
                <td>${r.site}</td>
                <td>${r.pilot}</td>
                <td>${r.copilot}</td>
                <td>${r.email}</td>
                <td>${r.cityState}</td>
              </tr>
            `,
                  )
                  .join("")
          }
        </tbody>
      </table>
    `;
    }

    let sections = "";

    if (reportPackType === "parking_ops") {
      sections += makeSection("Parking Assignments", sortedRosterRows);
      sections += makeSection("Needs Parking", unassignedParkingRows);
    }

    if (reportPackType === "checkin_ops") {
      sections += makeSection("Not Arrived", notArrivedRows);
      sections += makeSection("First Timers", firstTimerRows);
    }

    if (reportPackType === "hospitality_ops") {
      sections += makeSection("First Timers", firstTimerRows);
      sections += makeSection("Volunteers", vendorStaffRows);
    }

    const html = `
    <html>
      <head>
        <title>${packTitle}</title>
        <style>
          body { font-family: Arial; margin: 20px; }
          h1 { margin-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th, td { border: 1px solid #ccc; padding: 6px; font-size: 12px; }
          th { background: #f3f4f6; }
        </style>
      </head>
      <body>
        <h1>${packTitle}</h1>
        ${sections}
      </body>
    </html>
  `;

    const win = window.open("", "_blank");
    if (!win) {
      return;
    }

    win.document.write(html);
    win.document.close();
    win.print();
  }

  if (!loading && accessDenied) {
    return (
      <div className="card" style={{ padding: 18 }}>
        {isEmbedded ? (
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Reports</h2>
        ) : (
          <h1 style={{ marginTop: 0, marginBottom: 8 }}>Reports</h1>
        )}
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          You do not have access to this page.
        </div>
      </div>
    );
  }

  return (
    <>
      <ReportsPrintStyles />
      <div style={{ display: "grid", gap: 18 }}>
        {!isEmbedded ? (
          <a href="/admin/attendees" style={backLinkStyle}>
            ← Back to Attendee Management
          </a>
        ) : null}

        <div className="card" style={{ padding: 18 }}>
          {isEmbedded ? (
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>Reports</h2>
          ) : (
            <h1 style={{ marginTop: 0, marginBottom: 8 }}>Reports</h1>
          )}

          <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 12 }}>
            {currentEvent?.name ||
              currentEvent?.eventName ||
              "No event selected"}
            {currentEvent?.location ? ` • ${currentEvent.location}` : ""}
          </div>

          {status ? (
            <div style={{ marginBottom: 12, fontSize: 14 }}>{status}</div>
          ) : null}

          {isEmbedded ? (
            <div
              style={{
                marginBottom: 12,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #dbeafe",
                background: "#eff6ff",
                color: "#1d4ed8",
                fontSize: 14,
              }}
            >
              Embedded reports mode is active. Use the controls below to adjust
              the report shown inside attendee management.
            </div>
          ) : null}

          {error ? <div style={errorBoxStyle}>{error}</div> : null}

          <ReportControlsPanel
            reportType={reportType}
            setReportType={setReportType}
            sortType={sortType}
            setSortType={setSortType}
            participantTypeFilter={participantTypeFilter}
            setParticipantTypeFilter={setParticipantTypeFilter}
            dataStatusFilter={dataStatusFilter}
            setDataStatusFilter={setDataStatusFilter}
            loading={loading}
            canExport={canExport}
            onExportCsv={handleExportCsv}
            onExportXlsx={handleExportXlsx}
            presetName={presetName}
            setPresetName={setPresetName}
            onSavePreset={handleSavePreset}
            reportPackType={reportPackType}
            setReportPackType={setReportPackType}
            onPrintPack={handlePrintPack}
          />
        </div>
        <SavedPresetsCard
          presets={savedPresets}
          onApply={handleApplyPreset}
          onDelete={handleDeletePreset}
        />
        <div
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          }}
        >
          <div className="card" style={{ padding: 18 }}>
            <h2 style={{ marginTop: 0, marginBottom: 10 }}>
              Participant Breakdown
            </h2>
            {participantBreakdown.length === 0 ? (
              <div style={{ opacity: 0.8 }}>No participant data found.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {participantBreakdown.map((row) => (
                  <div
                    key={row.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      borderTop: "1px solid #eee",
                      paddingTop: 8,
                    }}
                  >
                    <span style={{ textTransform: "capitalize" }}>
                      {row.label}
                    </span>
                    <strong>{row.count}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card" style={{ padding: 18 }}>
            <h2 style={{ marginTop: 0, marginBottom: 10 }}>
              Data Status Breakdown
            </h2>
            {dataStatusBreakdown.length === 0 ? (
              <div style={{ opacity: 0.8 }}>No data status records found.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {dataStatusBreakdown.map((row) => (
                  <div
                    key={row.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      borderTop: "1px solid #eee",
                      paddingTop: 8,
                    }}
                  >
                    <span style={{ textTransform: "capitalize" }}>
                      {row.label}
                    </span>
                    <strong>{row.count}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          }}
        >
          <div className="card" style={{ padding: 18 }}>
            <h2 style={{ marginTop: 0, marginBottom: 10 }}>
              Unassigned Parking Needed
            </h2>
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 10 }}>
              {unassignedParkingRows.length} attendee
              {unassignedParkingRows.length === 1 ? "" : "s"}
            </div>
            {unassignedParkingRows.length === 0 ? (
              <div style={{ opacity: 0.8 }}>
                No unassigned parking-needed attendees.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {unassignedParkingRows.slice(0, 12).map((row, index) => (
                  <div
                    key={`${row.pilot}-${row.email}-${index}`}
                    style={quickListRowStyle}
                  >
                    <strong>{row.pilot || "Unnamed"}</strong>
                    <div style={quickListMetaStyle}>
                      {row.email || "No email"}
                      {row.cityState ? ` • ${row.cityState}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card" style={{ padding: 18 }}>
            <h2 style={{ marginTop: 0, marginBottom: 10 }}>Not Arrived</h2>
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 10 }}>
              {notArrivedRows.length} attendee
              {notArrivedRows.length === 1 ? "" : "s"}
            </div>
            {notArrivedRows.length === 0 ? (
              <div style={{ opacity: 0.8 }}>
                All attendees are marked arrived.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {notArrivedRows.slice(0, 12).map((row, index) => (
                  <div
                    key={`${row.pilot}-${row.email}-${index}`}
                    style={quickListRowStyle}
                  >
                    <strong>{row.pilot || "Unnamed"}</strong>
                    <div style={quickListMetaStyle}>
                      {row.site ? `Site ${row.site}` : "No site assigned"}
                      {row.email ? ` • ${row.email}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card" style={{ padding: 18 }}>
            <h2 style={{ marginTop: 0, marginBottom: 10 }}>First Timers</h2>
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 10 }}>
              {firstTimerRows.length} attendee
              {firstTimerRows.length === 1 ? "" : "s"}
            </div>
            {firstTimerRows.length === 0 ? (
              <div style={{ opacity: 0.8 }}>No first timers found.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {firstTimerRows.slice(0, 12).map((row, index) => (
                  <div
                    key={`${row.pilot}-${row.email}-${index}`}
                    style={quickListRowStyle}
                  >
                    <strong>{row.pilot || "Unnamed"}</strong>
                    <div style={quickListMetaStyle}>
                      {row.cityState || "No city/state"}
                      {row.email ? ` • ${row.email}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card" style={{ padding: 18 }}>
            <h2 style={{ marginTop: 0, marginBottom: 10 }}>
              Vendors / Staff / Speakers / Hosts
            </h2>
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 10 }}>
              {vendorStaffRows.length} attendee
              {vendorStaffRows.length === 1 ? "" : "s"}
            </div>
            {vendorStaffRows.length === 0 ? (
              <div style={{ opacity: 0.8 }}>
                No vendor or staff-type attendees found.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {vendorStaffRows.slice(0, 12).map((row, index) => (
                  <div
                    key={`${row.pilot}-${row.email}-${index}`}
                    style={quickListRowStyle}
                  >
                    <strong>{row.pilot || "Unnamed"}</strong>
                    <div style={quickListMetaStyle}>
                      {row.participantType}
                      {row.site ? ` • Site ${row.site}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ marginBottom: 14 }}>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>{reportTitle}</h2>
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              {reportType === "activity_summary"
                ? `${activitySummaryRows.length} activity rows`
                : `${sortedRosterRows.length} roster rows`}{" "}
              • Participant type:{" "}
              {participantTypeFilter === "all"
                ? "All Types"
                : participantTypeLabel(participantTypeFilter)}{" "}
              • Data status:{" "}
              {dataStatusFilter === "all"
                ? "All Statuses"
                : dataStatusLabel(dataStatusFilter)}
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
    </>
  );
}

function ReportControlsPanel(props: {
  reportType: ReportType;
  setReportType: (value: ReportType) => void;
  sortType: SortType;
  setSortType: (value: SortType) => void;
  participantTypeFilter: ParticipantTypeFilter;
  setParticipantTypeFilter: (value: ParticipantTypeFilter) => void;
  dataStatusFilter: DataStatusFilter;
  setDataStatusFilter: (value: DataStatusFilter) => void;
  loading: boolean;
  canExport: boolean;
  onExportCsv: () => void;
  onExportXlsx: () => void;
  presetName: string;
  setPresetName: (value: string) => void;
  onSavePreset: () => void;
  reportPackType: "parking_ops" | "checkin_ops" | "hospitality_ops";
  setReportPackType: (
    value: "parking_ops" | "checkin_ops" | "hospitality_ops",
  ) => void;
  onPrintPack: () => void;
}) {
  const {
    reportType,
    setReportType,
    sortType,
    setSortType,
    participantTypeFilter,
    setParticipantTypeFilter,
    dataStatusFilter,
    setDataStatusFilter,
    loading,
    canExport,
    onExportCsv,
    onExportXlsx,
    presetName,
    setPresetName,
    onSavePreset,
    reportPackType,
    setReportPackType,
    onPrintPack,
  } = props;

  return (
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
          <option value="staff_hosts_helpers">Staff / Hosts / Helpers</option>
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

      <div>
        <label style={labelStyle}>Participant Type</label>
        <select
          value={participantTypeFilter}
          onChange={(e) =>
            setParticipantTypeFilter(e.target.value as ParticipantTypeFilter)
          }
          style={inputStyle}
        >
          <option value="all">All Types</option>
          <option value="attendee">Attendee</option>
          <option value="vendor">Vendor</option>
          <option value="staff">Staff</option>
          <option value="speaker">Speaker</option>
          <option value="volunteer">Volunteer</option>
          <option value="event_host">Event Host</option>
        </select>
      </div>

      <div>
        <label style={labelStyle}>Data Status</label>
        <select
          value={dataStatusFilter}
          onChange={(e) =>
            setDataStatusFilter(e.target.value as DataStatusFilter)
          }
          style={inputStyle}
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="corrected">Corrected</option>
          <option value="reviewed">Reviewed</option>
          <option value="locked">Locked</option>
        </select>
      </div>

      <div>
        <label style={labelStyle}>Report Pack</label>
        <select
          value={reportPackType}
          onChange={(e) => setReportPackType(e.target.value as any)}
          style={inputStyle}
        >
          <option value="parking_ops">Parking Operations Pack</option>
          <option value="checkin_ops">Check-In Pack</option>
          <option value="hospitality_ops">Hospitality Pack</option>
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
          onClick={onExportCsv}
          style={secondaryButtonStyle}
          disabled={loading || !canExport}
        >
          Export CSV
        </button>

        <button
          type="button"
          onClick={onExportXlsx}
          style={primaryButtonStyle}
          disabled={loading || !canExport}
        >
          Export XLSX
        </button>

        <button
          type="button"
          onClick={() => window.print()}
          style={secondaryButtonStyle}
        >
          Print
        </button>
        <button
          type="button"
          onClick={onPrintPack}
          style={secondaryButtonStyle}
          disabled={loading}
        >
          Print Pack
        </button>
      </div>

      <div>
        <label style={labelStyle}>Preset Name</label>
        <input
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          style={inputStyle}
          placeholder="Save current report settings"
        />
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
          onClick={onSavePreset}
          style={secondaryButtonStyle}
          disabled={loading}
        >
          Save Preset
        </button>
      </div>
    </div>
  );
}

function SavedPresetsCard(props: {
  presets: ReportPreset[];
  onApply: (preset: ReportPreset) => void;
  onDelete: (presetId: string) => void;
}) {
  const { presets, onApply, onDelete } = props;

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, marginBottom: 6 }}>Saved Report Presets</h2>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          Save your current report type, sort, and filters for quick reuse on
          this device.
        </div>
      </div>

      {presets.length === 0 ? (
        <div style={{ opacity: 0.8 }}>No saved report presets yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {presets.map((preset) => (
            <div
              key={preset.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                padding: 12,
                background: "white",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>{preset.name}</div>
                <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
                  {preset.reportType.replace(/_/g, " ")} • {preset.sortType} •{" "}
                  {preset.participantTypeFilter} • {preset.dataStatusFilter}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => onApply(preset)}
                  style={secondaryButtonStyle}
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(preset.id)}
                  style={secondaryButtonStyle}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const backLinkStyle: CSSProperties = {
  display: "inline-block",
  width: "fit-content",
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "white",
  color: "#111827",
  fontWeight: 700,
  textDecoration: "none",
};

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

function ReportsPrintStyles() {
  useEffect(() => {
    const existing = document.getElementById("print-styles");
    if (existing) {
      return;
    }

    const style = document.createElement("style");
    style.id = "print-styles";
    style.innerHTML = `
      body.admin-embedded-shell > :first-child {
        display: none !important;
      }

      body.admin-embedded-shell .app-main {
        margin-left: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
      }

      body.admin-embedded-shell .app-inner {
        max-width: 100% !important;
        padding: 0 !important;
      }

      body.admin-embedded-shell .app-header-card {
        display: none !important;
      }

      @media print {
        body {
          background: white !important;
        }

        .card {
          box-shadow: none !important;
          border: none !important;
        }

        button,
        select,
        input {
          display: none !important;
        }
      }
    `;
    document.head.appendChild(style);

    return () => {
      style.remove();
    };
  }, []);

  return null;
}

const quickListRowStyle: CSSProperties = {
  borderTop: "1px solid #eee",
  paddingTop: 8,
};

const quickListMetaStyle: CSSProperties = {
  fontSize: 13,
  color: "#666",
  marginTop: 2,
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
