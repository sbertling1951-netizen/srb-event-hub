"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
import { Alert, type AlertTone } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox, Field, Input, Select } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageSection } from "@/components/ui/PageSection";
import { RowActions } from "@/components/ui/RowActions";
import { useAdmin } from "@/lib/adminContext";
import { checkAdminEventTaskAuthority } from "@/lib/adminTaskAuthority";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { canAccessEvent, hasPermission } from "@/lib/getCurrentAdminAccess";
import { useTenant } from "@/lib/providers/TenantProvider";
import { supabase } from "@/lib/supabase";

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

export type AttendeeRow = {
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
  has_arrived: boolean | null;
  is_first_timer: boolean | null;
  coach_manufacturer: string | null;
  coach_model: string | null;
  coach_length: string | null;
  is_active: boolean;
  registration_status: string | null;
};

// Canonical current placement -- parking_sites.assigned_attendee_id, per
// docs/architecture/EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md
// and EPICENTRAX_CANONICAL_PARKING_READ_MIGRATION_PLAN.md §6.2. Mirrors
// the same bulk canonical read app/admin/reports/page.tsx already uses;
// attendees.assigned_site is never read for Print's Site display.
type ParkingSiteRow = {
  id: string;
  event_id: string;
  site_number: string | null;
  display_label: string | null;
  assigned_attendee_id: string | null;
};

function siteLabel(site: ParkingSiteRow) {
  return site.display_label || site.site_number || "";
}

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
    has_arrived: null,
    is_first_timer: false,
    coach_manufacturer: null,
    coach_model: null,
    coach_length: null,
    registration_status: "registered",
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
  if (!startDate && !endDate) {
    return "";
  }
  if (startDate && endDate) {
    return `${startDate} – ${endDate}`;
  }
  return startDate || endDate || "";
}

function toTitleCase(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function normalizeStateCode(value?: string | null) {
  return String(value || "")
    .trim()
    .replace(/[^a-z]/gi, "")
    .slice(0, 2)
    .toUpperCase();
}

function cityState(row: AttendeeRow) {
  const city = toTitleCase(row.city);
  const state = normalizeStateCode(row.state);
  return [city, state].filter(Boolean).join(", ");
}

function displayPilotName(row: AttendeeRow) {
  const displayFirst = toTitleCase(row.nickname || row.pilot_first);
  const pilotLast = toTitleCase(row.pilot_last);
  const copilotLast = toTitleCase(row.copilot_last);

  if (!displayFirst) {
    return pilotLast;
  }

  if (!pilotLast) {
    return displayFirst;
  }

  if (!copilotLast || pilotLast.toLowerCase() !== copilotLast.toLowerCase()) {
    return `${displayFirst} ${pilotLast}`;
  }

  return displayFirst;
}

function displayCopilotName(row: AttendeeRow) {
  const nickname = toTitleCase(row.copilot_nickname);
  if (nickname) {
    return nickname;
  }
  return fullName(
    toTitleCase(row.copilot_first),
    toTitleCase(row.copilot_last),
  );
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

// Coach-plate name-line formatting. A shared-last-name couple keeps the
// existing "Pilot & Copilot" / "LastName" structure (line2 rendered in
// the smaller, subordinate style) exactly as before. A couple with
// different last names -- or any other case not eligible for the shared
// format -- gets one full-name line per person instead; `sameSurname`
// tells the caller which style line2 should render with, since only the
// shared-last-name case may use the smaller/subordinate treatment.
export function buildCoachPlateNameLines(row: AttendeeRow) {
  const pilotFirst = toTitleCase(row.nickname || row.pilot_first || "");
  const pilotLast = toTitleCase(row.pilot_last || "");

  const copilotFirst = toTitleCase(
    row.copilot_nickname || row.copilot_first || "",
  );
  const copilotLast = toTitleCase(row.copilot_last || "");

  if (pilotFirst && copilotFirst && sameLastName(row)) {
    return {
      line1: `${pilotFirst} & ${copilotFirst}`,
      line2: pilotLast || copilotLast,
      sameSurname: true,
    };
  }

  if (pilotFirst || pilotLast || copilotFirst || copilotLast) {
    return {
      line1:
        [pilotFirst, pilotLast].filter(Boolean).join(" ").trim() || "Guest",
      line2: [copilotFirst, copilotLast].filter(Boolean).join(" ").trim(),
      sameSurname: false,
    };
  }

  return {
    line1: "Guest",
    line2: "",
    sameSurname: false,
  };
}

function buildNameParts(
  first?: string | null,
  last?: string | null,
  nickname?: string | null,
) {
  const trimmedNickname = toTitleCase(nickname);
  const trimmedFirst = toTitleCase(first);
  const trimmedLast = toTitleCase(last);

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
  if (!overrides) {
    return row;
  }

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
function getPrintComparableSnapshot(row: AttendeeRow) {
  return {
    pilot_first: toTitleCase(row.pilot_first),
    pilot_last: toTitleCase(row.pilot_last),
    nickname: toTitleCase(row.nickname),
    copilot_first: toTitleCase(row.copilot_first),
    copilot_last: toTitleCase(row.copilot_last),
    copilot_nickname: toTitleCase(row.copilot_nickname),
    membership_number: String(row.membership_number || "").trim(),
    city: toTitleCase(row.city),
    state: normalizeStateCode(row.state),
    is_first_timer: !!row.is_first_timer,
  };
}

function hasPrintChanges(
  baseRow: AttendeeRow | null,
  previewRow: AttendeeRow | null,
) {
  if (!baseRow || !previewRow) {
    return false;
  }

  return (
    JSON.stringify(getPrintComparableSnapshot(baseRow)) !==
    JSON.stringify(getPrintComparableSnapshot(previewRow))
  );
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
      if (aFirst !== bFirst) {
        return aFirst - bFirst;
      }
    }

    if (sortType === "returnees_first_alpha") {
      const aReturnee = a.is_first_timer ? 1 : 0;
      const bReturnee = b.is_first_timer ? 1 : 0;
      if (aReturnee !== bReturnee) {
        return aReturnee - bReturnee;
      }
    }

    return compareRowsByAlpha(a, b);
  });

  return sorted;
}

// Pure, presentation-only classification of this page's own existing
// `status` confirmation/guidance text into an Alert tone -- never a second
// source of any message itself (every setStatus call site is unchanged).
// Mirrors the same heuristic already established for Announcements/Admin
// Users/Locations/Master Maps/Events/Event Staff/Reports.
export function printStatusTone(message: string): AlertTone {
  const lower = message.toLowerCase();

  if (
    lower.startsWith("failed to") ||
    lower.startsWith("access denied") ||
    lower.startsWith("no events available") ||
    lower.startsWith("no admin working event")
  ) {
    return "danger";
  }

  if (lower.endsWith("...")) {
    return "info";
  }

  if (lower.startsWith("loaded")) {
    return "success";
  }

  return "neutral";
}

function AdminPrintPageInner() {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [availableEvents, setAvailableEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [canSelectPrintEvent, setCanSelectPrintEvent] = useState(false);
  const [settings, setSettings] = useState<PrintSettingsRow | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [parkingSites, setParkingSites] = useState<ParkingSiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { admin } = useAdmin();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading print center...");
  const [editAttendeeId, setEditAttendeeId] = useState<string | null>(null);
  const [printOverrides, setPrintOverrides] = useState<
    Record<string, PrintEditOverride>
  >({});
  const [manualAttendees, setManualAttendees] = useState<AttendeeRow[]>([]);
  const { tenant } = useTenant();

  const { isCompact: isMobile } = useShellInterfaceCapabilities();

  const [printMode, setPrintMode] = useState<PrintMode>("name_tags");
  const [printFilter, setPrintFilter] = useState<PrintFilter>("all");
  const [sortType, setSortType] = useState<SortType>("alpha");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showFirstTimerOnNameTags, setShowFirstTimerOnNameTags] =
    useState(false);
  const [nameTagTextColor, setNameTagTextColor] = useState("#000000");
  const [coachPlateTextColor, setCoachPlateTextColor] = useState("#000000");
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  // Print Settings is a manage-only surface (background upload/removal,
  // no distinct view mode) -- its link here is shown only when the
  // admin holds event.print.manage for their own current working
  // Event, the same scope Print Settings' own route guard checks.
  // Replaces the dead can_manage_print_settings key, never granted to
  // any non-super-admin.
  const [canManagePrintSettings, setCanManagePrintSettings] = useState(false);
  const printSettingsCheckGeneration = useRef(0);

  const runPrintSettingsAuthorityCheck = useCallback(() => {
    const generation = ++printSettingsCheckGeneration.current;
    const eventId = getCurrentAdminEvent()?.id ?? null;

    // Reset before the async check resolves: a prior Event's authority
    // must never remain effective while the new Event's check is still
    // unresolved.
    setCanManagePrintSettings(false);

    if (!eventId) {
      return;
    }

    void checkAdminEventTaskAuthority("event.print.manage", eventId).then(
      (result) => {
        if (printSettingsCheckGeneration.current === generation) {
          setCanManagePrintSettings(result.status === "allowed");
        }
      },
    );
  }, []);

  useEffect(() => {
    runPrintSettingsAuthorityCheck();

    return subscribeToAdminWorkspace(runPrintSettingsAuthorityCheck);
  }, [runPrintSettingsAuthorityCheck]);

  useEffect(() => {
    if (!admin) {
      return;
    }

    async function init() {
      setLoading(true);
      setError(null);
      setStatus("Loading print center...");

      const adminEvent = getCurrentAdminEvent();
      const superAdminCanSelectEvents = hasPermission(
        admin,
        "can_manage_admins",
      );
      setCanSelectPrintEvent(superAdminCanSelectEvents);

      if (superAdminCanSelectEvents) {
        const { data: eventData, error: eventError } = await supabase
          .from("events")
          .select("id,name,location,venue_name,start_date,end_date")
          .order("start_date", { ascending: false })
          .order("name", { ascending: true });
        if (eventError) {
          throw eventError;
        }
        const eventRows = (eventData || []) as EventRow[];
        setAvailableEvents(eventRows);
        const preferredEventId =
          selectedEventId ||
          (adminEvent?.id && eventRows.some((r) => r.id === adminEvent.id)
            ? adminEvent.id
            : eventRows[0]?.id || "");
        setSelectedEventId(preferredEventId);
        if (!preferredEventId) {
          setEvent(null);
          setSettings(null);
          setAttendees([]);
          setParkingSites([]);
          setManualAttendees([]);
          setSelectedIds([]);
          setStatus("No events available for printing.");
          setLoading(false);
          return;
        }
        await loadPage(preferredEventId);
        return;
      }

      setAvailableEvents([]);

      if (!adminEvent?.id) {
        setEvent(null);
        setSettings(null);
        setAttendees([]);
        setParkingSites([]);
        setManualAttendees([]);
        setSelectedIds([]);
        setStatus("No admin working event selected.");
        setLoading(false);
        return;
      }

      if (!canAccessEvent(admin, adminEvent.id)) {
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      setSelectedEventId(adminEvent.id);
      await loadPage(adminEvent.id);
    }

    void init();
    const unsubscribe = subscribeToAdminWorkspace(() => {
      void init();
    });
    return unsubscribe;
  }, [admin, selectedEventId]);

  async function handleSelectedPrintEventChange(eventId: string) {
    setSelectedEventId(eventId);
    setPrintOverrides({});
    setEditAttendeeId(null);
    await loadPage(eventId);
  }

  async function loadPage(eventId: string) {
    try {
      setLoading(true);
      setError(null);
      setStatus("Loading print center...");

      const [
        { data: eventData, error: eventError },
        { data: settingsData, error: settingsError },
        { data: attendeeData, error: attendeeError },
        { data: parkingData, error: parkingError },
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
            has_arrived,
            is_first_timer,
            coach_manufacturer,
            coach_model,
            coach_length,
            is_active,
            registration_status
          `,
          )
          .eq("event_id", eventId)
          .order("pilot_last", { ascending: true })
          .order("pilot_first", { ascending: true }),
        supabase
          .from("parking_sites")
          .select("id,event_id,site_number,display_label,assigned_attendee_id")
          .eq("event_id", eventId),
      ]);

      if (eventError) {
        throw eventError;
      }
      if (settingsError) {
        throw settingsError;
      }
      if (attendeeError) {
        throw attendeeError;
      }
      if (parkingError) {
        throw parkingError;
      }

      const eventRow = eventData as EventRow;
      const attendeeRows = (attendeeData || []) as AttendeeRow[];
      const parkingRows = (parkingData || []) as ParkingSiteRow[];
      const settingsRow = (settingsData as PrintSettingsRow | null) || {
        event_id: eventId,
        name_tag_bg_url: null,
        coach_plate_bg_url: null,
      };

      setEvent(eventRow);
      setSettings(settingsRow);
      setAttendees(attendeeRows);
      setParkingSites(parkingRows);
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

  // Row-level Site display -- canonical parking_sites occupancy only, per
  // docs/architecture/EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md
  // and EPICENTRAX_CANONICAL_PARKING_READ_MIGRATION_PLAN.md §6.2. A manual
  // print entry's id never appears in parkingSites, so it stays blank/"—"
  // exactly as before -- manual entries are never treated as a canonical
  // registration.
  const canonicalSiteLabelByAttendeeId = useMemo(() => {
    const labels = new Map<string, string>();
    for (const site of parkingSites) {
      if (site.assigned_attendee_id) {
        labels.set(site.assigned_attendee_id, siteLabel(site));
      }
    }
    return labels;
  }, [parkingSites]);

  const filteredAttendees = useMemo(() => {
    // Cancelled registrations are excluded from Print regardless of
    // includeInactive -- "include inactive" and "cancelled" are separately
    // reportable categories per the canonical Active Registration
    // definition (registration_status != 'cancelled' AND is_active = true;
    // docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md, Canonical
    // Event Operational Summary Read Contract).
    let rows = [...attendees, ...manualAttendees].filter(
      (row) => row.registration_status !== "cancelled",
    );

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
    const rawEventName =
      event?.name?.trim() ||
      (tenant?.displayName ? `${tenant.displayName} Event` : "Event");
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
  }, [event?.name, event?.start_date, printableRows, tenant?.displayName]);

  const printableNameTagSheetCount = useMemo(() => {
    return Math.ceil(printableNameTags.length / 6);
  }, [printableNameTags.length]);

  const printableNameTagSheets = useMemo(() => {
    const sheets: NameTagRow[][] = [];

    for (let index = 0; index < printableNameTags.length; index += 6) {
      sheets.push(printableNameTags.slice(index, index + 6));
    }

    return sheets;
  }, [printableNameTags]);

  const dateRange = formatDateRange(event?.start_date, event?.end_date);

  const editRow = useMemo(() => {
    if (!editAttendeeId) {
      return null;
    }
    return (
      [...attendees, ...manualAttendees].find(
        (row) => row.id === editAttendeeId,
      ) || null
    );
  }, [attendees, manualAttendees, editAttendeeId]);

  const editPreviewRow = useMemo(() => {
    if (!editRow) {
      return null;
    }
    return applyPrintOverride(editRow, printOverrides[editRow.id]);
  }, [editRow, printOverrides]);
  const editHasUnsavedChanges = useMemo(() => {
    return hasPrintChanges(editRow, editPreviewRow);
  }, [editRow, editPreviewRow]);

  function toggleSelected(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function selectAllFiltered() {
    setSelectedIds(sortedFilteredAttendees.map((row) => row.id));
    showFlashMessage(
      `${sortedFilteredAttendees.length} attendee${sortedFilteredAttendees.length === 1 ? "" : "s"} added to print queue.`,
    );
  }

  function clearSelected() {
    setSelectedIds([]);
    showFlashMessage("Print queue cleared.");
  }

  function openPrintEditor(attendeeId: string) {
    setSelectedIds((prev) =>
      prev.includes(attendeeId) ? prev : [...prev, attendeeId],
    );
    setEditAttendeeId(attendeeId);
  }

  function addToPrintQueue(attendeeId: string) {
    const row = [...attendees, ...manualAttendees].find(
      (item) => item.id === attendeeId,
    );
    const label = row ? displayPilotName(row) || "Attendee" : "Attendee";

    setSelectedIds((prev) => {
      if (prev.includes(attendeeId)) {
        showFlashMessage(`${label} is already in the print queue.`);
        return prev;
      }

      showFlashMessage(`${label} added to print queue.`);
      return [...prev, attendeeId];
    });
  }

  function removeFromPrintQueue(attendeeId: string) {
    const row = [...attendees, ...manualAttendees].find(
      (item) => item.id === attendeeId,
    );
    const label = row ? displayPilotName(row) || "Attendee" : "Attendee";

    setSelectedIds((prev) => {
      if (!prev.includes(attendeeId)) {
        showFlashMessage(`${label} is not currently in the print queue.`);
        return prev;
      }

      showFlashMessage(`${label} removed from print queue.`);
      return prev.filter((id) => id !== attendeeId);
    });
  }

  function showFlashMessage(message: string) {
    setFlashMessage(message);
    window.setTimeout(() => {
      setFlashMessage((current) => (current === message ? null : current));
    }, 1600);
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
    showFlashMessage("Print overrides cleared.");
  }

  function createManualEntry(kind: ManualPrintEntryKind) {
    const nextRow = createEmptyManualAttendee(kind);

    setManualAttendees((prev) => [...prev, nextRow]);
    setSelectedIds((prev) => [...prev, nextRow.id]);
    setEditAttendeeId(nextRow.id);
    setPrintMode(kind === "name_tag" ? "name_tags" : "coach_plates");
    showFlashMessage(
      kind === "name_tag"
        ? "Manual name tag created and added to print queue."
        : "Manual coach plate created and added to print queue.",
    );
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
    showFlashMessage("Manual print entry deleted.");
    setEditAttendeeId((prev) => (prev === attendeeId ? null : prev));
  }

  function handlePrint() {
    window.print();
  }

  const backgroundUrl =
    printMode === "name_tags"
      ? settings?.name_tag_bg_url || null
      : settings?.coach_plate_bg_url || null;
  const clubLogoUrl = "/fcoc-logo.svg";
  const clubLogoAlt = tenant?.displayName
    ? `${tenant.displayName} logo`
    : "Event logo";
  const activeTextColor =
    printMode === "name_tags" ? nameTagTextColor : coachPlateTextColor;

  return (
    <div
      style={{
        padding: "var(--space-6)",
        display: "grid",
        gap: "var(--space-5)",
        minWidth: 0,
      }}
    >
      {/* Print Center intentionally renders without AdminShellAdapter --
          window.print()'s `body * { visibility: hidden }` rule (below)
          must hide every DOM node except .print-area with nothing else
          interposed, so this page owns its own minimal "no-print"
          navigation instead of the canonical shell chrome. Central UI
          Standard primitives are still used throughout the controls
          region for exactly that reason -- this is a deliberate,
          print-driven exception to the shell requirement, not an
          oversight. */}
      <nav
        aria-label="Print Center navigation"
        className="no-print"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          flexWrap: "wrap",
        }}
      >
        <Link href="/admin/dashboard" className="app-button">
          ← Dashboard
        </Link>
        <Link href="/admin/reports" className="app-button">
          Reports
        </Link>
        {canManagePrintSettings ? (
          <Link href="/admin/print-settings" className="app-button">
            Print Settings
          </Link>
        ) : null}
      </nav>
      <style>{`
  @media print {
    body * {
      visibility: hidden;
    }

    .print-area, .print-area * {
      visibility: visible;
    }

    html,
body {
  margin: 0 !important;
  padding: 0 !important;
}

.print-area {
  position: absolute !important;
left: 0 !important;
top: 0 !important;
  width: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  background: white;
}

.name-tag-sheets {
  display: block !important;
  margin: 0 !important;
  padding: 0 !important;
}

    .no-print {
      display: none !important;
    }

    @page {
      size: ${printMode === "coach_plates" ? "landscape" : "portrait"};
      margin: ${printMode === "coach_plates" ? "0" : "0.2in"};
    }

    .name-tag-sheet {
      display: grid !important;
      grid-template-columns: 4in 4in !important;
      grid-template-rows: 3in 3in 3in !important;
      width: 8in !important;
      height: 9in !important;
      margin: 0 auto !important;
      padding: 0 !important;
      gap: 0 !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
      page-break-inside: avoid !important;
      break-inside: avoid-page !important;
    }

    .name-tag-sheet:last-child {
      page-break-after: auto !important;
      break-after: auto !important;
    }

    .name-tag-card {
      width: 4in !important;
      height: 3in !important;

      margin: 0 !important;
      padding: 0 !important;

      overflow: hidden !important;
      box-sizing: border-box !important;

      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    .coach-plate-sheet {
      display: block !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .coach-plate-card {
      display: block !important;
      width: 11in !important;
      height: 8.5in !important;
      min-height: 8.5in !important;
      max-height: 8.5in !important;

      margin: 0 !important;
      padding: 0 !important;

      overflow: hidden !important;
      box-sizing: border-box !important;

      border: none !important;
      border-radius: 0 !important;

      page-break-before: always !important;
      page-break-after: always !important;
      page-break-inside: avoid !important;

      break-before: page !important;
      break-after: page !important;
      break-inside: avoid !important;

      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

  }
`}</style>
      <div className="no-print">
        <PageSection variant="card">
        <p className="app-subtle-text" style={{ margin: 0 }}>
          {event?.name || "No event selected"}
          {event?.location ? ` • ${event.location}` : ""}
          {dateRange ? ` • ${dateRange}` : ""}
        </p>

        {canSelectPrintEvent ? (
          <div style={{ marginTop: "var(--space-4)", maxWidth: 520 }}>
            <Field
              label="Print Event"
              help="Super Admin can select any event to print. Event Admins remain locked to their assigned working event."
            >
              {(controlProps) => (
                <Select
                  {...controlProps}
                  value={selectedEventId}
                  onChange={(e) =>
                    void handleSelectedPrintEventChange(e.target.value)
                  }
                  disabled={loading || availableEvents.length === 0}
                >
                  {availableEvents.map((eventRow) => {
                    const eventLabelParts = [
                      eventRow.name || "Unnamed Event",
                      eventRow.venue_name || eventRow.location || "",
                      formatDateRange(eventRow.start_date, eventRow.end_date),
                    ].filter(Boolean);

                    return (
                      <option key={eventRow.id} value={eventRow.id}>
                        {eventLabelParts.join(" • ")}
                      </option>
                    );
                  })}
                </Select>
              )}
            </Field>
          </div>
        ) : null}

        {status ? (
          <div style={{ marginTop: "var(--space-3)" }}>
            <Alert tone={printStatusTone(status)}>{status}</Alert>
          </div>
        ) : null}
        {flashMessage ? (
          <div style={{ marginTop: "var(--space-3)" }}>
            <Alert tone="info">{flashMessage}</Alert>
          </div>
        ) : null}
        {error ? (
          <div style={{ marginTop: "var(--space-3)" }}>
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}
        </PageSection>
      </div>

      <div className="no-print">
        <PageSection variant="card">
        <div
          style={{
            display: "grid",
            gap: "var(--space-4)",
            gridTemplateColumns: isMobile
              ? "1fr"
              : "repeat(auto-fit, minmax(220px, 1fr))",
            alignItems: "end",
          }}
        >
          <Field label="Print Type">
            {(controlProps) => (
              <Select
                {...controlProps}
                value={printMode}
                onChange={(e) => setPrintMode(e.target.value as PrintMode)}
              >
                <option value="name_tags">Name Tags</option>
                <option value="coach_plates">Coach Plates</option>
              </Select>
            )}
          </Field>

          <Field label="Filter">
            {(controlProps) => (
              <Select
                {...controlProps}
                value={printFilter}
                onChange={(e) => setPrintFilter(e.target.value as PrintFilter)}
              >
                <option value="all">All Active Registrations</option>
                <option value="arrived">Arrived Only</option>
                <option value="first_timers">First Timers Only</option>
              </Select>
            )}
          </Field>

          <Field label="Sort">
            {(controlProps) => (
              <Select
                {...controlProps}
                value={sortType}
                onChange={(e) => setSortType(e.target.value as SortType)}
              >
                <option value="alpha">Alphabetical</option>
                <option value="first_timers_first_alpha">
                  First Timers, Then Returnees
                </option>
                <option value="returnees_first_alpha">
                  Returnees, Then First Timers
                </option>
              </Select>
            )}
          </Field>

          <Field label="Font Color">
            {(controlProps) => (
              <div
                style={{
                  display: "flex",
                  gap: "var(--space-3)",
                  alignItems: "center",
                  minHeight: 42,
                }}
              >
                <Input
                  {...controlProps}
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
                  style={{ width: 52, height: 42, padding: 0, cursor: "pointer" }}
                />
                <div className="app-subtle-text">{activeTextColor}</div>
              </div>
            )}
          </Field>

          <div style={{ display: "grid", gap: "var(--space-2)", alignItems: "end" }}>
            <Checkbox
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              label="Include inactive attendees"
            />

            {printMode === "name_tags" ? (
              <Checkbox
                checked={showFirstTimerOnNameTags}
                onChange={(e) => setShowFirstTimerOnNameTags(e.target.checked)}
                label="Print FIRST TIMER on name tags"
              />
            ) : null}
          </div>

          <FormActions>
            <AppButton onClick={selectAllFiltered}>
              Select All Filtered
            </AppButton>
            <AppButton onClick={clearSelected}>
              Clear Selected
            </AppButton>
            <AppButton onClick={() => createManualEntry("name_tag")}>
              Create Name Tag
            </AppButton>
            <AppButton onClick={() => createManualEntry("coach_plate")}>
              Create Coach Plate
            </AppButton>
            <AppButton
              variant="primary"
              onClick={handlePrint}
              disabled={printableRows.length === 0}
            >
              Print
            </AppButton>
          </FormActions>
        </div>

        <p className="app-subtle-text" style={{ marginTop: "var(--space-4)" }}>
          Print queue contains {printableRows.length} of{" "}
          {sortedFilteredAttendees.length} filtered attendees.
          {printMode === "name_tags"
            ? ` This will print ${printableNameTags.length} name tag${printableNameTags.length === 1 ? "" : "s"} on ${printableNameTagSheetCount} Avery 5164 sheet${printableNameTagSheetCount === 1 ? "" : "s"}.`
            : ""}
        </p>
        </PageSection>
      </div>

      <div className="no-print">
        <PageSection variant="card" title="Who Will Print">
        {loading ? (
          <LoadingState message="Loading..." />
        ) : sortedFilteredAttendees.length === 0 ? (
          <EmptyState message="No attendees found for this filter." />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            {sortedFilteredAttendees.map((row) => {
              const pilot = displayPilotName(row) || "Unnamed";
              const copilot = displayCopilotName(row);

              return (
                <div
                  key={row.id}
                  style={{
                    display: "flex",
                    flexDirection: isMobile ? "column" : "row",
                    gap: "var(--space-3)",
                    alignItems: isMobile ? "stretch" : "start",
                    padding: "var(--space-3)",
                    border: "var(--border-width-default) solid var(--color-border-default)",
                    borderRadius: "var(--radius-medium)",
                    background: row.id.startsWith("manual-")
                      ? "#fff7ed"
                      : selectedIds.includes(row.id)
                        ? "var(--color-bg-muted)"
                        : "var(--color-bg-panel)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(row.id)}
                    onChange={() => toggleSelected(row.id)}
                    aria-label={`Select ${pilot} for the print queue`}
                    style={{ marginTop: 3 }}
                  />
                  <div>
                    <div className="data-table-cell-primary">
                      {pilot}
                      {copilot ? ` / ${copilot}` : ""}
                    </div>
                    <div className="data-table-cell-meta" style={{ marginTop: "var(--space-1)" }}>
                      Site: {canonicalSiteLabelByAttendeeId.get(row.id) || "—"}
                      {row.membership_number
                        ? ` • Member #: ${row.membership_number}`
                        : ""}
                      {row.has_arrived ? " • Arrived" : ""}
                      {row.is_first_timer ? " • First Timer" : ""}
                      {row.id.startsWith("manual-") ? " • Manual" : ""}
                    </div>
                    <RowActions>
                      <AppButton
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openPrintEditor(row.id);
                        }}
                      >
                        Edit For Print
                      </AppButton>
                      <AppButton
                        variant={selectedIds.includes(row.id) ? "primary" : "default"}
                        aria-pressed={selectedIds.includes(row.id)}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (selectedIds.includes(row.id)) {
                            removeFromPrintQueue(row.id);
                          } else {
                            addToPrintQueue(row.id);
                          }
                        }}
                      >
                        {selectedIds.includes(row.id)
                          ? "In Print Queue"
                          : "Add To Print Queue"}
                      </AppButton>
                      <AppButton
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          printOnlyAttendee(row.id);
                        }}
                      >
                        Print This Only
                      </AppButton>
                      {row.id.startsWith("manual-") ? (
                        <AppButton
                          variant="danger"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeManualEntry(row.id);
                          }}
                        >
                          Delete Manual
                        </AppButton>
                      ) : null}
                    </RowActions>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </PageSection>
      </div>
      <Dialog
        open={!!editPreviewRow}
        onClose={() => setEditAttendeeId(null)}
        className="no-print"
        title="Print Editor"
        description={
          editPreviewRow ? (
            <>
              {editPreviewRow.id.startsWith("manual-")
                ? "Manual print entry"
                : "Session-only print overrides for"}{" "}
              {displayPilotName(editPreviewRow) || "Guest"}
              {displayCopilotName(editPreviewRow)
                ? ` / ${displayCopilotName(editPreviewRow)}`
                : ""}
              <br />
              Edits stay in this session and remain in the current print
              queue until you clear or print them.
            </>
          ) : undefined
        }
        footer={
          editPreviewRow ? (
            <>
              <AppButton onClick={() => clearPrintOverride(editPreviewRow.id)}>
                Clear Overrides
              </AppButton>
              {editPreviewRow.id.startsWith("manual-") ? (
                <AppButton onClick={() => removeManualEntry(editPreviewRow.id)}>
                  Delete Manual Entry
                </AppButton>
              ) : null}
              <AppButton
                variant={selectedIds.includes(editPreviewRow.id) ? "primary" : "default"}
                aria-pressed={selectedIds.includes(editPreviewRow.id)}
                onClick={() => {
                  if (selectedIds.includes(editPreviewRow.id)) {
                    removeFromPrintQueue(editPreviewRow.id);
                  } else {
                    addToPrintQueue(editPreviewRow.id);
                  }
                }}
              >
                {selectedIds.includes(editPreviewRow.id)
                  ? "In Print Queue"
                  : "Add To Print Queue"}
              </AppButton>
              <AppButton onClick={() => printOnlyAttendee(editPreviewRow.id)}>
                Print This Only
              </AppButton>
              <AppButton
                variant="primary"
                onClick={() => setEditAttendeeId(null)}
              >
                {editHasUnsavedChanges ? "Save Changes" : "Close"}
              </AppButton>
            </>
          ) : undefined
        }
      >
        {editPreviewRow ? (
          <div style={{ display: "grid", gap: "var(--space-5)", minWidth: 0 }}>
            <div
              style={{
                display: "grid",
                gap: "var(--space-4)",
                gridTemplateColumns: isMobile
                  ? "1fr"
                  : "repeat(auto-fit, minmax(220px, 1fr))",
              }}
            >
              <Field label="Pilot First">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={editPreviewRow.pilot_first || ""}
                    onChange={(e) =>
                      updatePrintOverride(
                        editPreviewRow.id,
                        "pilot_first",
                        toTitleCase(e.target.value),
                      )
                    }
                  />
                )}
              </Field>
              <Field label="Pilot Last">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={editPreviewRow.pilot_last || ""}
                    onChange={(e) =>
                      updatePrintOverride(
                        editPreviewRow.id,
                        "pilot_last",
                        toTitleCase(e.target.value),
                      )
                    }
                  />
                )}
              </Field>
              <Field label="Pilot Nickname">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={editPreviewRow.nickname || ""}
                    onChange={(e) =>
                      updatePrintOverride(
                        editPreviewRow.id,
                        "nickname",
                        toTitleCase(e.target.value),
                      )
                    }
                  />
                )}
              </Field>
              <Field label="Co-Pilot First">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={editPreviewRow.copilot_first || ""}
                    onChange={(e) =>
                      updatePrintOverride(
                        editPreviewRow.id,
                        "copilot_first",
                        toTitleCase(e.target.value),
                      )
                    }
                  />
                )}
              </Field>
              <Field label="Co-Pilot Last">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={editPreviewRow.copilot_last || ""}
                    onChange={(e) =>
                      updatePrintOverride(
                        editPreviewRow.id,
                        "copilot_last",
                        toTitleCase(e.target.value),
                      )
                    }
                  />
                )}
              </Field>
              <Field label="Co-Pilot Nickname">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={editPreviewRow.copilot_nickname || ""}
                    onChange={(e) =>
                      updatePrintOverride(
                        editPreviewRow.id,
                        "copilot_nickname",
                        toTitleCase(e.target.value),
                      )
                    }
                  />
                )}
              </Field>
              <Field label="Member Number">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={editPreviewRow.membership_number || ""}
                    onChange={(e) =>
                      updatePrintOverride(
                        editPreviewRow.id,
                        "membership_number",
                        e.target.value,
                      )
                    }
                  />
                )}
              </Field>
              <Field label="City">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={editPreviewRow.city || ""}
                    onChange={(e) =>
                      updatePrintOverride(
                        editPreviewRow.id,
                        "city",
                        toTitleCase(e.target.value),
                      )
                    }
                  />
                )}
              </Field>
              <Field label="State">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={normalizeStateCode(editPreviewRow.state)}
                    onChange={(e) =>
                      updatePrintOverride(
                        editPreviewRow.id,
                        "state",
                        normalizeStateCode(e.target.value),
                      )
                    }
                    maxLength={2}
                  />
                )}
              </Field>
            </div>

            <div style={{ display: "flex", alignItems: "end", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <Checkbox
                checked={!!editPreviewRow.is_first_timer}
                onChange={(e) =>
                  updatePrintOverride(
                    editPreviewRow.id,
                    "is_first_timer",
                    e.target.checked,
                  )
                }
                label="First Timer for print"
              />

              <Checkbox
                checked={selectedIds.includes(editPreviewRow.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    addToPrintQueue(editPreviewRow.id);
                  } else {
                    removeFromPrintQueue(editPreviewRow.id);
                  }
                }}
                label="Keep in print queue"
              />
            </div>
          </div>
        ) : null}
      </Dialog>
      <div
        className="print-area"
        style={{
          width: "100%",
          overflow: "visible",
          padding: 0,
          margin: 0,
        }}
      >
        {" "}
        {printMode === "name_tags" ? (
          <div
            className="name-tag-sheets"
            style={{
              display: "block",
              margin: 0,
              padding: 0,
            }}
          >
            {" "}
            {printableNameTagSheets.map((sheet, sheetIndex) => (
              <div
                key={`name-tag-sheet-${sheetIndex}`}
                className="name-tag-sheet"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 4in)",
                  gridTemplateRows: "repeat(3, 3in)",
                  justifyContent: "center",
                  gap: 0,
                  width: "8in",
                  height: "9in",
                  margin: "0 auto",
                  pageBreakInside: "avoid",
                  breakInside: "avoid-page",
                  padding: 0,
                  overflow: "hidden",
                  boxSizing: "border-box",
                }}
              >
                {sheet.map((tag) => (
                  <div
                    key={tag.key}
                    className="name-tag-card"
                    style={{
                      position: "relative",
                      width: "4in",
                      minWidth: "4in",
                      maxWidth: "4in",
                      height: "3in",
                      minHeight: "3in",
                      maxHeight: "3in",
                      boxSizing: "border-box",
                      overflow: "hidden",
                      border: "1px solid #ddd",
                      borderRadius: 12,
                      background: "#fff",
                      pageBreakInside: "avoid",
                      breakInside: "avoid",
                      flexShrink: 0,
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
                        height: "3in",
                        boxSizing: "border-box",
                        overflow: "hidden",
                        padding: "0.12in",
                        display: "grid",
                        gridTemplateRows:
                          "auto auto auto 1fr auto auto auto auto",
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

                      <div
                        style={{ display: "flex", justifyContent: "center" }}
                      >
                        <img
                          src={clubLogoUrl}
                          alt={clubLogoAlt}
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
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div
            className="coach-plate-sheet"
            style={{ display: "grid", gap: 20 }}
          >
            {printableRows.map((row) => {
              const rawEventName =
                event?.name?.trim() ||
                (tenant?.displayName ? `${tenant.displayName} Event` : "Event");
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
                        alt={clubLogoAlt}
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
                        style={
                          !nameLines.sameSurname && nameLines.line2
                            ? {
                                // Different last names: this line is a
                                // second person's full name, not a
                                // shared surname -- it gets the same
                                // large/bold treatment as line1, never
                                // the smaller subordinate style. A blank
                                // line2 (no second person at all) keeps
                                // the original smaller style below --
                                // there is no name to give equal
                                // visual weight to.
                                fontSize: 100,
                                fontWeight: 900,
                                lineHeight: 0.95,
                                color: coachPlateTextColor,
                              }
                            : {
                                fontSize: 64,
                                fontWeight: 700,
                                lineHeight: 1.05,
                                color: coachPlateTextColor,
                              }
                        }
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

export default function AdminPrintPage() {
  return (
    <AdminRouteGuard requiredTask="event.print.view">
      <AdminPrintPageInner />
    </AdminRouteGuard>
  );
}
