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

import ReportControlsPanel from "@/components/admin/reports/ReportControlsPanel";
import { buildExportRows } from "@/components/admin/reports/reportExport";
import {
  loadStoredReportPresets,
  saveStoredReportPresets,
} from "@/components/admin/reports/reportPresets";
import { printReportPack } from "@/components/admin/reports/reportPrintPack";
import ReportsPanel from "@/components/admin/reports/ReportsPanel";
import ReportsSummaryCards from "@/components/admin/reports/ReportsSummaryCards";
import SavedPresetsCard from "@/components/admin/reports/SavedPresetsCard";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import PageNavigation from "@/components/layout/PageNavigation";
import { useAdmin } from "@/lib/adminContext";
import { canAccessEvent, hasPermission } from "@/lib/getCurrentAdminAccess";
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
  | "all_attendees"
  | "household_contact_sheet"
  | "arrived"
  | "not_arrived"
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

const ADMIN_EVENT_STORAGE_KEY = "fcoc-admin-event-context";
const ADMIN_EVENT_CHANGED_KEY = "fcoc-admin-event-changed";
const USER_MODE_KEY = "fcoc-user-mode";
const USER_MODE_CHANGED_KEY = "fcoc-user-mode-changed";
const ADMIN_EVENT_UPDATED_EVENT = "fcoc-admin-event-updated";
const REPORT_PRESETS_STORAGE_KEY = "fcoc-admin-report-presets";

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
  const { admin } = useAdmin();
  const searchParams = useSearchParams();
  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [parkingSites, setParkingSites] = useState<ParkingSiteRow[]>([]);
  const [reportType, setReportType] = useState<ReportType>("all_attendees");
  const [sortType, setSortType] = useState<SortType>("name_asc");
  const [participantTypeFilter, setParticipantTypeFilter] =
    useState<ParticipantTypeFilter>("all");

  const [dataStatusFilter, setDataStatusFilter] =
    useState<DataStatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading reports...");
  const [error, setError] = useState<string | null>(null);
  const [canExport, setCanExport] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [showReports, setShowReports] = useState(false);
  const [showReportMenu, setShowReportMenu] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
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
  }

  const loadData = useCallback(
    async (activeEventId: string) => {
      setLoading(true);
      setError(null);
      setStatus("Loading reports...");

      if (!admin) {
        resetPageState();
        setError("No admin access.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      if (
        !hasPermission(admin, "can_manage_reports") &&
        !hasPermission(admin, "can_edit_attendees")
      ) {
        resetPageState();
        setError("You do not have permission to manage reports.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      if (!canAccessEvent(admin, activeEventId)) {
        resetPageState();
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      setCanExport(
        hasPermission(admin, "can_export_reports") ||
          hasPermission(admin, "can_manage_reports") ||
          hasPermission(admin, "can_edit_attendees"),
      );

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
      setLoading(false);
    },
    [admin],
  );

  useEffect(() => {
    setSavedPresets(loadStoredReportPresets());
  }, []);

  useEffect(() => {
    if (!admin) {
      return;
    }

    if (
      !hasPermission(admin, "can_manage_reports") &&
      !hasPermission(admin, "can_edit_attendees")
    ) {
      resetPageState();
      setError("You do not have permission to manage reports.");
      setStatus("Access denied.");
      setLoading(false);
      return;
    }

    setCanExport(
      hasPermission(admin, "can_export_reports") ||
        hasPermission(admin, "can_manage_reports") ||
        hasPermission(admin, "can_edit_attendees"),
    );

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
      return;
    }

    setCurrentEvent(event);
    void loadData(event.id);

    function handleStorage(e: StorageEvent) {
      if (
        e.key === ADMIN_EVENT_CHANGED_KEY ||
        e.key === ADMIN_EVENT_STORAGE_KEY ||
        e.key === USER_MODE_KEY ||
        e.key === USER_MODE_CHANGED_KEY
      ) {
        const nextEvent = getStoredAdminEvent();

        if (!nextEvent?.id) {
          resetPageState();
          setStatus("No admin event selected.");
          setLoading(false);
          return;
        }

        if (!canAccessEvent(admin, nextEvent.id)) {
          resetPageState();
          setError("You do not have access to this event.");
          setStatus("Access denied.");
          setLoading(false);
          return;
        }

        setCurrentEvent(nextEvent);
        void loadData(nextEvent.id);
      }
    }

    function handleAdminEventUpdated() {
      const nextEvent = getStoredAdminEvent();

      if (!nextEvent?.id) {
        resetPageState();
        setStatus("No admin event selected.");
        setLoading(false);
        return;
      }

      if (!canAccessEvent(admin, nextEvent.id)) {
        resetPageState();
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      setCurrentEvent(nextEvent);
      void loadData(nextEvent.id);
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
  }, [admin, loadData]);

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
      case "all_attendees":
        return attendees
          .filter((row) =>
            attendeeMatchesFilters(
              row,
              participantTypeFilter,
              dataStatusFilter,
            ),
          )
          .map(attendeeToRosterRow);
      case "household_contact_sheet":
        return attendees
          .filter((row) =>
            attendeeMatchesFilters(
              row,
              participantTypeFilter,
              dataStatusFilter,
            ),
          )
          .map(attendeeToRosterRow);

      case "arrived":
        return attendees
          .filter((row) => !!row.has_arrived)
          .filter((row) =>
            attendeeMatchesFilters(
              row,
              participantTypeFilter,
              dataStatusFilter,
            ),
          )
          .map(attendeeToRosterRow);

      case "not_arrived":
        return attendees
          .filter((row) => !row.has_arrived)
          .filter((row) =>
            attendeeMatchesFilters(
              row,
              participantTypeFilter,
              dataStatusFilter,
            ),
          )
          .map(attendeeToRosterRow);

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
            ["staff", "event_host", "volunteer", "speaker"].includes(
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
      case "all_attendees":
        return "All Attendees";
      case "household_contact_sheet":
        return "Household Contact Sheet";
      case "arrived":
        return "Arrived";
      case "not_arrived":
        return "Not Arrived";
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

  function handleExportCsv() {
    if (!canExport) {
      return;
    }

    const rows = buildExportRows({
      reportType,
      reportTitle,
      currentEvent,
      sortType,
      participantTypeFilter,
      dataStatusFilter,
      activitySummaryRows,
      sortedRosterRows,
    });
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

    const rows = buildExportRows({
      reportType,
      reportTitle,
      currentEvent,
      sortType,
      participantTypeFilter,
      dataStatusFilter,
      activitySummaryRows,
      sortedRosterRows,
    });
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
    printReportPack({
      reportPackType,
      sortedRosterRows,
      unassignedParkingRows,
      notArrivedRows,
      firstTimerRows,
      vendorStaffRows,
    });
  }

  return (
    <>
      <ReportsPrintStyles />
      <div style={{ display: "grid", gap: 18 }}>
        {!isEmbedded ? (
          <PageNavigation
            homeHref="/admin/dashboard"
            homeLabel="Dashboard"
            parentHref="/admin/attendees"
            parentLabel="Attendees"
          />
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

          <div style={{ marginBottom: 12 }}>
            <button
              className="btn"
              onClick={() => setShowReportMenu((v) => !v)}
            >
              {showReportMenu ? "▼ Select Report" : "▶ Select Report"}
            </button>
          </div>

          {showReportMenu ? (
            <div className="card" style={{ padding: 18, marginBottom: 12 }}>
              <h3 style={{ marginTop: 0 }}>Reports</h3>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 12,
                  marginBottom: 18,
                }}
              >
                <button
                  className="btn"
                  onClick={() => setReportType("all_attendees")}
                >
                  All Attendees
                </button>
                <button
                  className="btn"
                  onClick={() => setReportType("household_contact_sheet")}
                >
                  Contact Sheet
                </button>

                <button
                  className="btn"
                  onClick={() => setReportType("arrived")}
                >
                  Arrived
                </button>
                <button
                  className="btn"
                  onClick={() => setReportType("not_arrived")}
                >
                  Not Arrived
                </button>
                <button
                  className="btn"
                  onClick={() => setReportType("parking_assignments")}
                >
                  Parking Assignments
                </button>
                <button
                  className="btn"
                  onClick={() => setReportType("unassigned_parking_needed")}
                >
                  Needs Parking
                </button>
                <button
                  className="btn"
                  onClick={() => setReportType("first_timers")}
                >
                  First Timers
                </button>
                <button
                  className="btn"
                  onClick={() => setReportType("volunteers")}
                >
                  Volunteers
                </button>
                <button
                  className="btn"
                  onClick={() => setReportType("vendors")}
                >
                  Vendors
                </button>
                <button
                  className="btn"
                  onClick={() => setReportType("staff_hosts_helpers")}
                >
                  Staff / Speakers
                </button>
                <button
                  className="btn"
                  onClick={() => setReportType("activity_summary")}
                >
                  Activity Summary
                </button>
              </div>

              <div style={{ marginBottom: 12 }}>
                <button
                  className="btn"
                  onClick={() => setShowControls((v) => !v)}
                >
                  {showControls ? "▼ Report Controls" : "▶ Report Controls"}
                </button>
              </div>

              {showControls ? (
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
              ) : null}

              <div style={{ marginTop: 12 }}>
                <SavedPresetsCard
                  presets={savedPresets}
                  onApply={handleApplyPreset}
                  onDelete={handleDeletePreset}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ marginBottom: 12 }}>
          <button className="btn" onClick={() => setShowSummary((v) => !v)}>
            {showSummary ? "▼ Hide Summary" : "▶ Summary"}
          </button>
        </div>

        {showSummary ? (
          <ReportsSummaryCards
            participantBreakdown={participantBreakdown}
            dataStatusBreakdown={dataStatusBreakdown}
            unassignedParkingCount={unassignedParkingRows.length}
            unassignedParkingRows={unassignedParkingRows}
            notArrivedCount={notArrivedRows.length}
            notArrivedRows={notArrivedRows}
            firstTimerCount={firstTimerRows.length}
            firstTimerRows={firstTimerRows}
            vendorStaffCount={vendorStaffRows.length}
            vendorStaffRows={vendorStaffRows}
          />
        ) : null}

        <ReportsPanel
          reportTitle={reportTitle}
          loading={loading}
          reportType={reportType}
          participantTypeFilter={participantTypeFilter}
          dataStatusFilter={dataStatusFilter}
          activitySummaryRows={activitySummaryRows}
          sortedRosterRows={sortedRosterRows}
        />
      </div>
    </>
  );
}

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

const errorBoxStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#b91c1c",
  marginBottom: 12,
};
