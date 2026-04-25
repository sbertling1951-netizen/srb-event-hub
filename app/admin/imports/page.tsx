"use client";

import { useSearchParams } from "next/navigation";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import {
  canAccessEvent,
  getCurrentAdminAccess,
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

type RawRow = Record<string, unknown>;

type ActivityGroup = {
  prefix: string;
  nameCol: string;
  priceCol: string;
  qtyCol: string;
};

type ActivityPreview = {
  activity_name: string;
  quantity: number;
  price: number | null;
  raw_name: string;
  source_column_prefix: string;
};

type ParsedRegistration = {
  rowNumber: number;
  entry_id: string;
  email: string;
  pilot_first: string;
  pilot_last: string;
  copilot_first: string;
  copilot_last: string;
  nickname: string;
  copilot_nickname: string;
  additional_attendees: string;
  membership_number: string;
  primary_phone: string;
  cell_phone: string;
  city: string;
  state: string;
  wants_to_volunteer: boolean;
  is_first_timer: boolean;
  coach_manufacturer: string;
  coach_model: string;
  share_with_attendees: boolean;
  special_events_raw: string;
  raw_import: RawRow;
  activities: ActivityPreview[];
  warnings: string[];
};

type ReviewIssue = {
  key: string;
  rowNumber: number;
  attendeeKey: string;
  field: string;
  label: string;
  message: string;
  severity: "error" | "warning";
  currentValue: string;
  isResolved: boolean;
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

type PrintSettingsRow = {
  id?: string;
  event_id: string;
  name_tag_bg_url: string | null;
  coach_plate_bg_url: string | null;
};

const ADMIN_EVENT_STORAGE_KEY = "fcoc-admin-event-context";

type SavedAttendeeManagementView = {
  showFullImportTable: boolean;
  savedAttendeePageSize: "25" | "50" | "100" | "all";
  importPreviewPageSize: "25" | "50" | "100" | "all";
};

function getAttendeeManagementViewStorageKey(eventId: string) {
  return `fcoc-attendee-management-view::${eventId}`;
}

function loadSavedAttendeeManagementView(
  eventId: string,
): SavedAttendeeManagementView | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(
      getAttendeeManagementViewStorageKey(eventId),
    );
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as SavedAttendeeManagementView;
  } catch {
    return null;
  }
}

function saveAttendeeManagementView(
  eventId: string,
  view: SavedAttendeeManagementView,
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(
      getAttendeeManagementViewStorageKey(eventId),
      JSON.stringify(view),
    );
  } catch {
    // ignore storage errors
  }
}

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

function cityStateFromAttendee(row: AttendeeRow) {
  return [row.city, row.state].filter(Boolean).join(", ");
}

function normalizeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function text(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function digitsOnly(value: string) {
  return value.replace(/\D+/g, "");
}

function normalizePhone(value: unknown) {
  const raw = text(value);
  if (!raw) {
    return "";
  }
  const digits = digitsOnly(raw);

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    const local = digits.slice(1);
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }

  return raw;
}

function normalizedRowEntries(row: RawRow) {
  return Object.entries(row).map(
    ([key, value]) => [normalizeKey(key), value] as const,
  );
}

function getValueByAliases(row: RawRow, aliases: readonly string[]) {
  const normalizedEntries = normalizedRowEntries(row);

  for (const alias of aliases) {
    const target = normalizeKey(alias);
    const direct = row[alias];
    if (direct !== undefined) {
      return direct;
    }

    const found = normalizedEntries.find(([key]) => key === target);
    if (found) {
      return found[1];
    }
  }

  return "";
}

function parseMoney(value: unknown): number | null {
  const raw = text(value).replace(/[$,]/g, "");
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: unknown): number | null {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed);
}

function parseBoolYesNo(value: unknown) {
  const raw = text(value).toLowerCase();
  return raw.startsWith("yes");
}

function getValue(row: RawRow, key: string) {
  return getValueByAliases(row, [key]);
}

const FIELD_ALIASES = {
  entry_id: ["Entry Id", "Entry ID", "EntryId", "Order Id", "Order ID"],
  email: ["Email Address", "Email", "E-mail", "Email address"],
  pilot_first: [
    "Pilot Name (First)",
    "Pilot First Name",
    "Pilot First",
    "First Name",
  ],
  pilot_last: [
    "Pilot Name (Last)",
    "Pilot Last Name",
    "Pilot Last",
    "Last Name",
  ],
  copilot_first: [
    "Co-Pilot Name (First)",
    "Copilot Name (First)",
    "Co-Pilot First Name",
    "Copilot First Name",
    "Co-Pilot First",
    "Copilot First",
  ],
  copilot_last: [
    "Co-Pilot Name (Last)",
    "Copilot Name (Last)",
    "Co-Pilot Last Name",
    "Copilot Last Name",
    "Co-Pilot Last",
    "Copilot Last",
  ],
  nickname: [
    "Nickname for Badge",
    "Pilot Nickname for Badge",
    "Pilot Badge Nickname",
    "Badge Nickname",
  ],
  copilot_nickname: [
    "Nickname for Badge.1",
    "Co-Pilot Nickname for Badge",
    "Copilot Nickname for Badge",
    "Co-Pilot Badge Nickname",
    "Copilot Badge Nickname",
  ],
  additional_attendees: [
    "Additional attendees, if so give name(s) and age(s)",
    "Additional Attendees",
    "Additional Guests",
    "Additional Household Members",
  ],
  membership_number: [
    "FCOC Membership Number",
    "Membership Number",
    "Member Number",
  ],
  primary_phone: ["Primary Phone #", "Primary Phone", "Phone", "Phone Number"],
  cell_phone: ["Cell Phone #", "Cell Phone", "Mobile Phone", "Mobile"],
  city: ["Address (City)", "City", "Mailing City"],
  state: [
    "Address (State / Province)",
    "State",
    "State / Province",
    "Province",
  ],
  coach_manufacturer: [
    "Coach Manufacturer",
    "Coach Make",
    "Motorhome Manufacturer",
    "RV Manufacturer",
  ],
  coach_model: ["Coach Model", "Model", "RV Model"],
  special_events_raw: [
    "Special Events",
    "Special Event Selections",
    "Activities",
  ],
  share_with_attendees: [
    "Ok to share your email with other attendees?",
    "OK to share your email with other attendees?",
    "Share email with attendees",
    "Share with attendees",
  ],
  wants_to_volunteer: [
    "Would you like to volunteer to help with the event?",
    "Volunteer to help with event",
    "Would you like to volunteer?",
    "Volunteer",
  ],
  is_first_timer: [
    "First time at an FCOC event?",
    "First Timer",
    "First time attendee",
    "Is First Timer",
  ],
} as const;

function detectActivityGroups(headers: string[]) {
  const defs: Record<
    string,
    { prefix: string; nameCol?: string; priceCol?: string; qtyCol?: string }
  > = {};

  for (const original of headers) {
    const header = normalizeKey(original);
    const match = header.match(/^(.*)\s+\((Name|Price|Quantity)\)$/i);
    if (!match) {
      continue;
    }

    const prefix = match[1].trim();
    const kind = match[2].toLowerCase();

    if (!defs[prefix]) {
      defs[prefix] = { prefix };
    }

    if (kind === "name") {
      defs[prefix].nameCol = original;
    }
    if (kind === "price") {
      defs[prefix].priceCol = original;
    }
    if (kind === "quantity") {
      defs[prefix].qtyCol = original;
    }
  }

  return Object.values(defs)
    .filter(
      (item): item is ActivityGroup =>
        !!item.nameCol && !!item.priceCol && !!item.qtyCol,
    )
    .filter((item) => {
      const skip = [
        "Product Name",
        "Credit Card",
        "Pilot Name",
        "Co-Pilot Name",
      ];
      return !skip.some((prefix) => item.prefix.startsWith(prefix));
    });
}

function buildActivities(row: RawRow, groups: ActivityGroup[]) {
  const activities: ActivityPreview[] = [];

  for (const group of groups) {
    const quantity = parseInteger(getValue(row, group.qtyCol));
    if (!quantity || quantity <= 0) {
      continue;
    }

    const rawName = text(getValue(row, group.nameCol)) || group.prefix;
    const price = parseMoney(getValue(row, group.priceCol));

    activities.push({
      activity_name: group.prefix,
      quantity,
      price,
      raw_name: rawName,
      source_column_prefix: group.prefix,
    });
  }

  return activities;
}

function mapRow(row: RawRow, rowNumber: number, groups: ActivityGroup[]) {
  const entry_id = text(getValueByAliases(row, FIELD_ALIASES.entry_id));
  const email = text(getValueByAliases(row, FIELD_ALIASES.email)).toLowerCase();
  const pilot_first = text(getValueByAliases(row, FIELD_ALIASES.pilot_first));
  const pilot_last = text(getValueByAliases(row, FIELD_ALIASES.pilot_last));
  const copilot_first = text(
    getValueByAliases(row, FIELD_ALIASES.copilot_first),
  );
  const copilot_last = text(getValueByAliases(row, FIELD_ALIASES.copilot_last));
  const nickname = text(getValueByAliases(row, FIELD_ALIASES.nickname));
  const copilot_nickname = text(
    getValueByAliases(row, FIELD_ALIASES.copilot_nickname),
  );
  const additional_attendees = text(
    getValueByAliases(row, FIELD_ALIASES.additional_attendees),
  );
  const membership_number = text(
    getValueByAliases(row, FIELD_ALIASES.membership_number),
  );
  const primary_phone = normalizePhone(
    getValueByAliases(row, FIELD_ALIASES.primary_phone),
  );
  const cell_phone = normalizePhone(
    getValueByAliases(row, FIELD_ALIASES.cell_phone),
  );
  const city = text(getValueByAliases(row, FIELD_ALIASES.city));
  const state = text(getValueByAliases(row, FIELD_ALIASES.state));
  const coach_manufacturer = text(
    getValueByAliases(row, FIELD_ALIASES.coach_manufacturer),
  );
  const coach_model = text(getValueByAliases(row, FIELD_ALIASES.coach_model));
  const special_events_raw = text(
    getValueByAliases(row, FIELD_ALIASES.special_events_raw),
  );
  const share_with_attendees = parseBoolYesNo(
    getValueByAliases(row, FIELD_ALIASES.share_with_attendees),
  );
  const wants_to_volunteer = parseBoolYesNo(
    getValueByAliases(row, FIELD_ALIASES.wants_to_volunteer),
  );
  const is_first_timer = parseBoolYesNo(
    getValueByAliases(row, FIELD_ALIASES.is_first_timer),
  );

  const warnings: string[] = [];

  if (!entry_id) {
    warnings.push("Missing Entry Id");
  }
  if (!email) {
    warnings.push("Missing Email Address");
  }
  if (!pilot_first && !pilot_last) {
    warnings.push("Missing pilot name");
  }
  if (!membership_number) {
    warnings.push("Missing membership number");
  }
  if (
    membership_number &&
    !membership_number.trim().toUpperCase().startsWith("F")
  ) {
    warnings.push("Invalid membership number (must begin with 'F')");
  }
  if (!coach_manufacturer && !coach_model) {
    warnings.push("Missing coach information");
  }
  if (!primary_phone && !cell_phone) {
    warnings.push("Missing phone number");
  }

  return {
    rowNumber,
    entry_id,
    email,
    pilot_first,
    pilot_last,
    copilot_first,
    copilot_last,
    nickname,
    copilot_nickname,
    additional_attendees,
    membership_number,
    primary_phone,
    cell_phone,
    city,
    state,
    wants_to_volunteer,
    is_first_timer,
    coach_manufacturer,
    coach_model,
    share_with_attendees,
    special_events_raw,
    raw_import: row,
    activities: buildActivities(row, groups),
    warnings,
  };
}

export default function AdminAttendeeImportsPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_imports">
      <AdminAttendeeImportsPageInner />
    </AdminRouteGuard>
  );
}

function AdminAttendeeImportsPageInner() {
  const searchParams = useSearchParams();
  const isEmbedded = searchParams.get("embedded") === "1";
  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [availableEvents, setAvailableEvents] = useState<EventContext[]>([]);
  const [selectedImportEventId, setSelectedImportEventId] = useState("");
  const [loadedForEventId, setLoadedForEventId] = useState("");

  const [rows, setRows] = useState<ParsedRegistration[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [reviewIssues, setReviewIssues] = useState<ReviewIssue[]>([]);

  const [savedAttendees, setSavedAttendees] = useState<AttendeeRow[]>([]);
  const [loadingSavedAttendees, setLoadingSavedAttendees] = useState(false);
  const [savedAttendeePageSize, setSavedAttendeePageSize] = useState<
    "25" | "50" | "100" | "all"
  >("all");

  const [importPreviewPageSize, setImportPreviewPageSize] = useState<
    "25" | "50" | "100" | "all"
  >("all");

  const [loadingEvent, setLoadingEvent] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("Load a CSV or XLSX file to begin.");
  const [error, setError] = useState<string | null>(null);

  const [printSettings, setPrintSettings] = useState<PrintSettingsRow | null>(
    null,
  );
  const [nameTagFile, setNameTagFile] = useState<File | null>(null);
  const [coachPlateFile, setCoachPlateFile] = useState<File | null>(null);
  const [assetStatus, setAssetStatus] = useState("");
  const [assetError, setAssetError] = useState<string | null>(null);
  const [savingNameTagBg, setSavingNameTagBg] = useState(false);
  const [savingCoachPlateBg, setSavingCoachPlateBg] = useState(false);
  const [showFullImportTable, setShowFullImportTable] = useState(false);

  useEffect(() => {
    async function loadEvents() {
      setLoadingEvent(true);
      setError(null);
      setStatus("Checking admin access...");

      try {
        const admin = await getCurrentAdminAccess();

        if (!admin) {
          setCurrentEvent(null);
          setAvailableEvents([]);
          setSelectedImportEventId("");
          setLoadedForEventId("");
          setRows([]);
          setHeaders([]);
          setFileName("");
          setShowFullImportTable(false);
          setError("No admin access.");
          setStatus("Access denied.");
          return;
        }

        const stored = getStoredAdminEvent();
        setCurrentEvent(stored);

        const { data, error } = await supabase
          .from("events")
          .select("id, name, venue_name, location, start_date, end_date")
          .order("start_date", { ascending: false });

        if (error) {
          throw error;
        }

        const accessibleEvents = ((data || []) as EventContext[]).filter(
          (event) => !!event.id && canAccessEvent(admin, event.id),
        );

        setAvailableEvents(accessibleEvents);

        if (stored?.id && canAccessEvent(admin, stored.id)) {
          setSelectedImportEventId(stored.id);
        } else if (accessibleEvents.length > 0 && accessibleEvents[0].id) {
          setSelectedImportEventId(accessibleEvents[0].id);
        } else {
          setSelectedImportEventId("");
          setLoadedForEventId("");
          setRows([]);
          setHeaders([]);
          setFileName("");
          setShowFullImportTable(false);
          setStatus("No accessible events available for import.");
        }
      } catch (err) {
        console.error("Error loading events:", err);
        setCurrentEvent(null);
        setAvailableEvents([]);
        setSelectedImportEventId("");
        setLoadedForEventId("");
        setRows([]);
        setHeaders([]);
        setFileName("");
        setShowFullImportTable(false);
        setStatus("Could not load events.");
      } finally {
        setLoadingEvent(false);
      }
    }

    void loadEvents();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-admin-event-context" ||
        e.key === "fcoc-admin-event-changed" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
      ) {
        void loadEvents();
      }
    }

    function handleAdminEventUpdated() {
      void loadEvents();
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

  useEffect(() => {
    async function loadPrintSettings() {
      if (!selectedImportEventId) {
        setPrintSettings(null);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("event_print_settings")
          .select("*")
          .eq("event_id", selectedImportEventId)
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (data) {
          setPrintSettings(data as PrintSettingsRow);
        } else {
          setPrintSettings({
            event_id: selectedImportEventId,
            name_tag_bg_url: null,
            coach_plate_bg_url: null,
          });
        }

        setAssetStatus("");
        setAssetError(null);
      } catch (err: any) {
        console.error("Error loading print settings:", err);
        setPrintSettings({
          event_id: selectedImportEventId,
          name_tag_bg_url: null,
          coach_plate_bg_url: null,
        });
        setAssetError(err?.message || "Could not load print settings.");
      }
    }

    void loadPrintSettings();
  }, [selectedImportEventId]);

  useEffect(() => {
    if (!selectedImportEventId) {
      return;
    }

    const saved = loadSavedAttendeeManagementView(selectedImportEventId);
    if (!saved) {
      setShowFullImportTable(false);
      setSavedAttendeePageSize("all");
      setImportPreviewPageSize("all");
      return;
    }

    setShowFullImportTable(!!saved.showFullImportTable);
    setSavedAttendeePageSize(saved.savedAttendeePageSize || "all");
    setImportPreviewPageSize(saved.importPreviewPageSize || "all");
  }, [selectedImportEventId]);
  useEffect(() => {
    if (!selectedImportEventId) {
      setSavedAttendees([]);
      return;
    }

    void loadSavedAttendees(selectedImportEventId);
  }, [selectedImportEventId]);

  useEffect(() => {
    function refreshFromStorageAndReload() {
      const stored = getStoredAdminEvent();

      if (stored) {
        setCurrentEvent(stored);

        if (stored.id && stored.id !== selectedImportEventId) {
          setSelectedImportEventId(stored.id);
          return;
        }
      }

      if (selectedImportEventId) {
        void loadSavedAttendees(selectedImportEventId);
      }
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        refreshFromStorageAndReload();
      }
    }

    function handleWindowFocus() {
      refreshFromStorageAndReload();
    }

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [selectedImportEventId]);

  useEffect(() => {
    if (!selectedImportEventId) {
      return;
    }

    saveAttendeeManagementView(selectedImportEventId, {
      showFullImportTable,
      savedAttendeePageSize,
      importPreviewPageSize,
    });
  }, [
    selectedImportEventId,
    showFullImportTable,
    savedAttendeePageSize,
    importPreviewPageSize,
  ]);

  const validRows = useMemo(
    () => rows.filter((row) => row.entry_id && row.email),
    [rows],
  );

  const parsedReviewIssues = useMemo<ReviewIssue[]>(() => {
    return rows.flatMap((row) => {
      const attendeeKey = row.entry_id || row.email || `row-${row.rowNumber}`;
      const issues: ReviewIssue[] = [];

      if (!row.membership_number) {
        issues.push({
          key: `${attendeeKey}-membership-missing`,
          rowNumber: row.rowNumber,
          attendeeKey,
          field: "membership_number",
          label: "Member #",
          message: "Missing membership number",
          severity: "warning",
          currentValue: "",
          isResolved: false,
        });
      } else if (!row.membership_number.trim().toUpperCase().startsWith("F")) {
        issues.push({
          key: `${attendeeKey}-membership-invalid`,
          rowNumber: row.rowNumber,
          attendeeKey,
          field: "membership_number",
          label: "Member #",
          message: "Membership number must begin with F",
          severity: "error",
          currentValue: row.membership_number,
          isResolved: false,
        });
      }

      if (!row.email) {
        issues.push({
          key: `${attendeeKey}-email-missing`,
          rowNumber: row.rowNumber,
          attendeeKey,
          field: "email",
          label: "Email",
          message: "Missing Email Address",
          severity: "error",
          currentValue: "",
          isResolved: false,
        });
      }

      if (!row.pilot_first && !row.pilot_last) {
        issues.push({
          key: `${attendeeKey}-pilot-missing`,
          rowNumber: row.rowNumber,
          attendeeKey,
          field: "pilot_name",
          label: "Pilot Name",
          message: "Missing pilot name",
          severity: "error",
          currentValue: "",
          isResolved: false,
        });
      }

      return issues;
    });
  }, [rows]);

  useEffect(() => {
    setReviewIssues(parsedReviewIssues);
  }, [parsedReviewIssues]);

  const visiblePreviewRows = useMemo(() => {
    if (importPreviewPageSize === "all") {
      return rows;
    }

    const limit = Number(importPreviewPageSize);
    return rows.slice(0, limit);
  }, [rows, importPreviewPageSize]);

  const previewRows = useMemo(() => visiblePreviewRows, [visiblePreviewRows]);
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.rowNumber - b.rowNumber),
    [rows],
  );

  const activityCount = useMemo(
    () => rows.reduce((sum, row) => sum + row.activities.length, 0),
    [rows],
  );
  const visibleSavedAttendees = useMemo(() => {
    if (savedAttendeePageSize === "all") {
      return savedAttendees;
    }

    const limit = Number(savedAttendeePageSize);
    return savedAttendees.slice(0, limit);
  }, [savedAttendees, savedAttendeePageSize]);

  async function loadSavedAttendees(eventId: string) {
    try {
      setLoadingSavedAttendees(true);

      const { data, error } = await supabase
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
        .eq("event_id", eventId)
        .order("pilot_last", { ascending: true })
        .order("pilot_first", { ascending: true });

      if (error) {
        throw error;
      }

      setSavedAttendees((data || []) as AttendeeRow[]);
    } catch (err: any) {
      console.error("loadSavedAttendees error:", err);
      setSavedAttendees([]);
      setError(err?.message || "Could not load saved attendees.");
    } finally {
      setLoadingSavedAttendees(false);
    }
  }

  const selectedImportEvent =
    availableEvents.find((event) => event.id === selectedImportEventId) || null;
  const pageTitle = isEmbedded ? "Imports" : "Attendee Imports";

  const eventChangedSinceLoad =
    !!rows.length &&
    !!loadedForEventId &&
    !!selectedImportEventId &&
    loadedForEventId !== selectedImportEventId;

  async function handleFileChange(file: File) {
    if (!selectedImportEventId) {
      setError("Select a target event before loading a file.");
      return;
    }

    setParsing(true);
    setError(null);
    setStatus(`Reading ${file.name}...`);
    setFileName(file.name);
    setShowFullImportTable(false);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      const json = XLSX.utils.sheet_to_json<RawRow>(worksheet, {
        defval: "",
        raw: false,
      });

      if (!json.length) {
        setRows([]);
        setHeaders([]);
        setLoadedForEventId("");
        setStatus("No rows found in file.");
        return;
      }

      const foundHeaders = Object.keys(json[0] || {});
      const groups = detectActivityGroups(foundHeaders);
      const parsed = json.map((row, index) => mapRow(row, index + 2, groups));

      setHeaders(foundHeaders);
      console.log("Detected import headers:", foundHeaders);
      console.log("Detected activity groups:", groups);
      setRows(parsed);
      setLoadedForEventId(selectedImportEventId);
      setStatus(
        `Loaded ${parsed.length} rows. ${groups.length} activity groups detected.`,
      );
    } catch (err) {
      console.error(err);
      setError("Could not parse file.");
      setRows([]);
      setHeaders([]);
      setLoadedForEventId("");
      setShowFullImportTable(false);
      setStatus("Parse failed.");
    } finally {
      setParsing(false);
    }
  }

  async function ensurePrintSettingsRow(nextValues: Partial<PrintSettingsRow>) {
    if (!selectedImportEventId) {
      return null;
    }

    const payload = {
      event_id: selectedImportEventId,
      name_tag_bg_url:
        nextValues.name_tag_bg_url ?? printSettings?.name_tag_bg_url ?? null,
      coach_plate_bg_url:
        nextValues.coach_plate_bg_url ??
        printSettings?.coach_plate_bg_url ??
        null,
    };

    const { data, error } = await supabase
      .from("event_print_settings")
      .upsert(payload, { onConflict: "event_id" })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    const row = data as PrintSettingsRow;
    setPrintSettings(row);
    return row;
  }

  async function uploadFileToBucket(file: File, path: string) {
    const { error: uploadError } = await supabase.storage
      .from("event-assets")
      .upload(path, file, {
        upsert: true,
        contentType: file.type || "image/png",
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from("event-assets").getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleUploadNameTagBackground() {
    if (!selectedImportEventId || !nameTagFile) {
      return;
    }

    try {
      setSavingNameTagBg(true);
      setAssetError(null);
      setAssetStatus("Uploading name tag background...");

      const ext = nameTagFile.name.split(".").pop() || "png";
      const path = `${selectedImportEventId}/name-tag-bg.${ext}`;
      const publicUrl = await uploadFileToBucket(nameTagFile, path);

      await ensurePrintSettingsRow({ name_tag_bg_url: publicUrl });
      setNameTagFile(null);
      setAssetStatus("Name tag background saved.");
    } catch (err: any) {
      console.error(err);
      setAssetError(err?.message || "Could not save name tag background.");
      setAssetStatus("");
    } finally {
      setSavingNameTagBg(false);
    }
  }

  async function handleUploadCoachPlateBackground() {
    if (!selectedImportEventId || !coachPlateFile) {
      return;
    }

    try {
      setSavingCoachPlateBg(true);
      setAssetError(null);
      setAssetStatus("Uploading coach plate background...");

      const ext = coachPlateFile.name.split(".").pop() || "png";
      const path = `${selectedImportEventId}/coach-plate-bg.${ext}`;
      const publicUrl = await uploadFileToBucket(coachPlateFile, path);

      await ensurePrintSettingsRow({ coach_plate_bg_url: publicUrl });
      setCoachPlateFile(null);
      setAssetStatus("Coach plate background saved.");
    } catch (err: any) {
      console.error(err);
      setAssetError(err?.message || "Could not save coach plate background.");
      setAssetStatus("");
    } finally {
      setSavingCoachPlateBg(false);
    }
  }

  async function clearNameTagBackground() {
    if (!selectedImportEventId) {
      return;
    }

    try {
      setAssetError(null);
      setAssetStatus("Removing name tag background...");
      await ensurePrintSettingsRow({ name_tag_bg_url: null });
      setAssetStatus("Name tag background removed.");
    } catch (err: any) {
      console.error(err);
      setAssetError(err?.message || "Could not remove name tag background.");
      setAssetStatus("");
    }
  }

  async function clearCoachPlateBackground() {
    if (!selectedImportEventId) {
      return;
    }

    try {
      setAssetError(null);
      setAssetStatus("Removing coach plate background...");
      await ensurePrintSettingsRow({ coach_plate_bg_url: null });
      setAssetStatus("Coach plate background removed.");
    } catch (err: any) {
      console.error(err);
      setAssetError(err?.message || "Could not remove coach plate background.");
      setAssetStatus("");
    }
  }

  async function handleImport() {
    if (!selectedImportEventId) {
      setError("No target event selected.");
      return;
    }

    if (eventChangedSinceLoad) {
      setError("Target event changed after file load. Reload the file first.");
      return;
    }

    if (!validRows.length) {
      setError("No valid rows to import.");
      return;
    }

    setImporting(true);
    setError(null);
    setStatus("Importing attendees...");

    try {
      const importEmails = Array.from(
        new Set(validRows.map((row) => row.email).filter(Boolean)),
      );

      const importEntryIds = Array.from(
        new Set(validRows.map((row) => row.entry_id).filter(Boolean)),
      );

      let existingAttendees: any[] = [];

      if (importEmails.length || importEntryIds.length) {
        const emailFilter = importEmails.length
          ? `email.in.(${importEmails.map((e) => `"${e}"`).join(",")})`
          : null;

        const entryFilter = importEntryIds.length
          ? `entry_id.in.(${importEntryIds.map((e) => `"${e}"`).join(",")})`
          : null;

        const orFilter = [emailFilter, entryFilter].filter(Boolean).join(",");

        const { data, error } = await supabase
          .from("attendees")
          .select("id, event_id, entry_id, email")
          .eq("event_id", selectedImportEventId)
          .or(orFilter);

        if (error) {
          throw error;
        }
        existingAttendees = data || [];
      }

      const existingByEmail = new Map(
        existingAttendees
          .filter((item) => item.email)
          .map((item) => [String(item.email).toLowerCase(), item]),
      );

      const existingByEntryId = new Map(
        existingAttendees
          .filter((item) => item.entry_id)
          .map((item) => [String(item.entry_id), item]),
      );

      const attendeePayload = validRows.map((row) => {
        const existingMatch =
          existingByEmail.get(row.email) || existingByEntryId.get(row.entry_id);

        return {
          existingId: existingMatch?.id ?? null,
          event_id: selectedImportEventId,
          entry_id: row.entry_id,
          email: row.email || null,
          pilot_first: row.pilot_first || null,
          pilot_last: row.pilot_last || null,
          copilot_first: row.copilot_first || null,
          copilot_last: row.copilot_last || null,
          nickname: row.nickname || null,
          copilot_nickname: row.copilot_nickname || null,
          membership_number: row.membership_number || null,
          primary_phone: row.primary_phone || null,
          cell_phone: row.cell_phone || null,
          city: row.city || null,
          state: row.state || null,
          wants_to_volunteer: row.wants_to_volunteer,
          is_first_timer: row.is_first_timer,
          coach_manufacturer: row.coach_manufacturer || null,
          coach_model: row.coach_model || null,
          share_with_attendees: row.share_with_attendees,
          special_events_raw: row.special_events_raw || null,
          raw_import: row.raw_import,
        };
      });

      const importRowPayload = validRows.map((row) => ({
        event_id: selectedImportEventId,
        import_type: "attendee_roster",
        source_filename: fileName || null,
        row_number: row.rowNumber,
        entry_id: row.entry_id || null,
        email: row.email || null,
        membership_number: row.membership_number || null,
        pilot_first: row.pilot_first || null,
        pilot_last: row.pilot_last || null,
        pilot_badge_nickname: row.nickname || null,
        copilot_first: row.copilot_first || null,
        copilot_last: row.copilot_last || null,
        copilot_badge_nickname: row.copilot_nickname || null,
        additional_attendees: row.additional_attendees || null,
        city: row.city || null,
        state: row.state || null,
        primary_phone: row.primary_phone || null,
        cell_phone: row.cell_phone || null,
        share_with_attendees: row.share_with_attendees,
        wants_to_volunteer: row.wants_to_volunteer,
        is_first_timer: row.is_first_timer,
        coach_manufacturer: row.coach_manufacturer || null,
        coach_model: row.coach_model || null,
        special_events_raw: row.special_events_raw || null,
        raw_import: row.raw_import,
      }));

      const rowsToUpdate = attendeePayload
        .filter((row) => row.existingId)
        .map(({ existingId: _existingId, ...rest }) => ({
          id: _existingId,
          ...rest,
        }));

      const rowsToInsert = attendeePayload
        .filter((row) => !row.existingId)
        .map(({ existingId: _existingId, ...rest }) => rest);

      if (rowsToUpdate.length) {
        const { error: updateError } = await supabase
          .from("attendees")
          .upsert(rowsToUpdate, {
            onConflict: "id",
          });

        if (updateError) {
          throw updateError;
        }
      }

      if (rowsToInsert.length) {
        const { error: insertError } = await supabase
          .from("attendees")
          .insert(rowsToInsert);

        if (insertError) {
          throw insertError;
        }
      }

      const activityPayload = validRows.flatMap((row) =>
        row.activities.map((activity) => ({
          event_id: selectedImportEventId,
          entry_id: row.entry_id,
          attendee_email: row.email,
          activity_name: activity.activity_name,
          quantity: activity.quantity,
          price: activity.price,
          raw_name: activity.raw_name,
          source_column_prefix: activity.source_column_prefix,
        })),
      );

      const importedEntryIds = validRows
        .map((row) => row.entry_id)
        .filter(Boolean);

      const headerMetadataEntryId = `__headers__${selectedImportEventId}`;

      const headerMetadataRow = {
        event_id: selectedImportEventId,
        import_type: "attendee_roster_headers",
        source_filename: fileName || null,
        row_number: 1,
        entry_id: headerMetadataEntryId,
        email: null,
        membership_number: null,
        pilot_first: null,
        pilot_last: null,
        pilot_badge_nickname: null,
        copilot_first: null,
        copilot_last: null,
        copilot_badge_nickname: null,
        additional_attendees: null,
        city: null,
        state: null,
        primary_phone: null,
        cell_phone: null,
        share_with_attendees: false,
        wants_to_volunteer: false,
        is_first_timer: false,
        coach_manufacturer: null,
        coach_model: null,
        special_events_raw: null,
        raw_import: {
          __source_headers: headers,
        },
      };

      if (importedEntryIds.length) {
        const { error: deleteImportRowsError } = await supabase
          .from("event_import_rows")
          .delete()
          .eq("event_id", selectedImportEventId)
          .eq("import_type", "attendee_roster")
          .in("entry_id", importedEntryIds);

        if (deleteImportRowsError) {
          throw deleteImportRowsError;
        }
      }

      const { error: deleteHeaderMetadataError } = await supabase
        .from("event_import_rows")
        .delete()
        .eq("event_id", selectedImportEventId)
        .eq("import_type", "attendee_roster_headers")
        .eq("entry_id", headerMetadataEntryId);

      if (deleteHeaderMetadataError) {
        throw deleteHeaderMetadataError;
      }

      if (importRowPayload.length) {
        const { error: importRowsError } = await supabase
          .from("event_import_rows")
          .insert(importRowPayload);

        if (importRowsError) {
          throw importRowsError;
        }
      }

      const { error: headerMetadataInsertError } = await supabase
        .from("event_import_rows")
        .insert(headerMetadataRow);

      if (headerMetadataInsertError) {
        throw headerMetadataInsertError;
      }

      if (importedEntryIds.length) {
        const { error: deleteError } = await supabase
          .from("attendee_activities")
          .delete()
          .eq("event_id", selectedImportEventId)
          .in("entry_id", importedEntryIds);

        if (deleteError) {
          throw deleteError;
        }
      }

      if (activityPayload.length) {
        const { error: activityError } = await supabase
          .from("attendee_activities")
          .insert(activityPayload);

        if (activityError) {
          throw activityError;
        }
      }
      await loadSavedAttendees(selectedImportEventId);

      setStatus(
        `Imported ${validRows.length} attendees, ${importRowPayload.length} source rows, and ${activityPayload.length} activity rows into ${
          selectedImportEvent?.name || "selected event"
        }.`,
      );
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Import failed.");
      setStatus("Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {!isEmbedded ? (
        <a href="/admin/attendees" style={backLinkStyle}>
          ← Back to Attendee Management
        </a>
      ) : null}

      <div className="card" style={{ padding: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "end",
            marginBottom: 14,
          }}
        >
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Data Review Queue</h2>
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              {reviewIssues.filter((issue) => !issue.isResolved).length} item
              {reviewIssues.filter((issue) => !issue.isResolved).length === 1
                ? ""
                : "s"}{" "}
              need review or correction
            </div>
          </div>
        </div>

        {reviewIssues.filter((issue) => !issue.isResolved).length === 0 ? (
          <div style={{ opacity: 0.8 }}>
            No data review items currently flagged.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {reviewIssues
              .filter((issue) => !issue.isResolved)
              .map((issue) => (
                <div
                  key={issue.key}
                  style={{
                    border: `1px solid ${
                      issue.severity === "error" ? "#fca5a5" : "#fcd34d"
                    }`,
                    background:
                      issue.severity === "error" ? "#fef2f2" : "#fffbeb",
                    borderRadius: 12,
                    padding: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    Row {issue.rowNumber} • {issue.label}
                  </div>
                  <div style={{ fontSize: 14, marginBottom: 6 }}>
                    {issue.message}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>
                    Current value: {issue.currentValue || "—"}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 18 }}>
        {!isEmbedded ? (
          <h1 style={{ marginTop: 0, marginBottom: 8 }}>{pageTitle}</h1>
        ) : (
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>{pageTitle}</h2>
        )}

        <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
          <div style={{ fontWeight: 600 }}>Target Event</div>

          <select
            value={selectedImportEventId}
            onChange={(e) => setSelectedImportEventId(e.target.value)}
            disabled={loadingEvent}
            style={{
              width: "100%",
              maxWidth: 560,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "white",
            }}
          >
            <option value="">Select an event</option>
            {availableEvents.map((event) => (
              <option key={event.id} value={event.id || ""}>
                {event.name || event.eventName || "Untitled Event"}
                {event.location ? ` • ${event.location}` : ""}
                {event.start_date ? ` • ${event.start_date}` : ""}
              </option>
            ))}
          </select>

          <div style={{ fontSize: 14, opacity: 0.8 }}>
            {loadingEvent
              ? "Loading events..."
              : selectedImportEvent?.name ||
                selectedImportEvent?.eventName ||
                "No event selected"}
            {selectedImportEvent?.location
              ? ` • ${selectedImportEvent.location}`
              : ""}
          </div>

          {currentEvent?.id ? (
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Current admin event:{" "}
              {currentEvent.name || currentEvent.eventName || "Unknown"}
            </div>
          ) : null}
        </div>

        <div style={{ fontSize: 14, marginBottom: 12 }}>{status}</div>

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
            Embedded imports mode is active. Imported attendees and preview
            settings stay tied to the selected event.
          </div>
        ) : null}
        {error ? (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #e2b4b4",
              background: "#fff3f3",
              color: "#8a1f1f",
            }}
          >
            {error}
          </div>
        ) : null}

        {eventChangedSinceLoad ? (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #f59e0b",
              background: "#fffbeb",
              color: "#92400e",
              fontSize: 14,
            }}
          >
            Target event changed after file load. Reload the file before
            importing to avoid importing into the wrong event.
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label
              style={{ display: "block", fontWeight: 600, marginBottom: 6 }}
            >
              Attendee CSV or XLSX file
            </label>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={loadingEvent || !selectedImportEventId}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void handleFileChange(file);
                }
              }}
            />
          </div>

          {fileName ? (
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              Loaded file: <strong>{fileName}</strong>
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={
                importing ||
                parsing ||
                !selectedImportEventId ||
                !validRows.length ||
                eventChangedSinceLoad
              }
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                background: "#111827",
                color: "white",
                fontWeight: 700,
                cursor: "pointer",
                opacity:
                  importing ||
                  parsing ||
                  !selectedImportEventId ||
                  !validRows.length ||
                  eventChangedSinceLoad
                    ? 0.6
                    : 1,
              }}
            >
              {importing ? "Importing..." : "Import Attendees"}
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Print Assets</h2>
        <p style={{ marginTop: 0, opacity: 0.8 }}>
          Optional PNG or image uploads for event-specific name tag and coach
          plate backgrounds.
        </p>

        {assetError ? (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #e2b4b4",
              background: "#fff3f3",
              color: "#8a1f1f",
            }}
          >
            {assetError}
          </div>
        ) : null}

        {assetStatus ? (
          <div style={{ fontSize: 14, marginBottom: 12 }}>{assetStatus}</div>
        ) : null}

        <div
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          }}
        >
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 14,
              background: "#fafafa",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 10 }}>
              Name Tag Background
            </h3>

            <input
              type="file"
              accept="image/*"
              disabled={loadingEvent || !selectedImportEventId}
              onChange={(e) => setNameTagFile(e.target.files?.[0] || null)}
            />

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 12,
              }}
            >
              <button
                type="button"
                onClick={() => void handleUploadNameTagBackground()}
                disabled={
                  !selectedImportEventId || !nameTagFile || savingNameTagBg
                }
              >
                {savingNameTagBg
                  ? "Uploading..."
                  : "Upload Name Tag Background"}
              </button>

              <button
                type="button"
                onClick={() => void clearNameTagBackground()}
                disabled={
                  !selectedImportEventId || !printSettings?.name_tag_bg_url
                }
              >
                Remove Background
              </button>
            </div>

            {printSettings?.name_tag_bg_url ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, marginBottom: 8, opacity: 0.8 }}>
                  Current background
                </div>
                <img
                  src={printSettings.name_tag_bg_url}
                  alt="Name tag background preview"
                  style={{
                    width: "100%",
                    maxWidth: 360,
                    border: "1px solid #ddd",
                    borderRadius: 12,
                  }}
                />
              </div>
            ) : (
              <div style={{ marginTop: 14, opacity: 0.7 }}>
                No name tag background set.
              </div>
            )}
          </div>

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 14,
              background: "#fafafa",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 10 }}>
              Coach Plate Background
            </h3>

            <input
              type="file"
              accept="image/*"
              disabled={loadingEvent || !selectedImportEventId}
              onChange={(e) => setCoachPlateFile(e.target.files?.[0] || null)}
            />

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 12,
              }}
            >
              <button
                type="button"
                onClick={() => void handleUploadCoachPlateBackground()}
                disabled={
                  !selectedImportEventId ||
                  !coachPlateFile ||
                  savingCoachPlateBg
                }
              >
                {savingCoachPlateBg
                  ? "Uploading..."
                  : "Upload Coach Plate Background"}
              </button>

              <button
                type="button"
                onClick={() => void clearCoachPlateBackground()}
                disabled={
                  !selectedImportEventId || !printSettings?.coach_plate_bg_url
                }
              >
                Remove Background
              </button>
            </div>

            {printSettings?.coach_plate_bg_url ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, marginBottom: 8, opacity: 0.8 }}>
                  Current background
                </div>
                <img
                  src={printSettings.coach_plate_bg_url}
                  alt="Coach plate background preview"
                  style={{
                    width: "100%",
                    maxWidth: 520,
                    border: "1px solid #ddd",
                    borderRadius: 12,
                  }}
                />
              </div>
            ) : (
              <div style={{ marginTop: 14, opacity: 0.7 }}>
                No coach plate background set.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Import Summary</h2>
        <div style={{ marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => setShowFullImportTable((prev) => !prev)}
            disabled={!rows.length}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: rows.length ? "white" : "#f3f4f6",
              fontWeight: 700,
              cursor: rows.length ? "pointer" : "default",
              opacity: rows.length ? 1 : 0.7,
            }}
          >
            {showFullImportTable
              ? "Hide Imported Data Preview"
              : "Show Imported Data Preview"}
          </button>
        </div>

        {showFullImportTable ? (
          <div
            style={{
              marginBottom: 14,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #bfdbfe",
              background: "#eff6ff",
              color: "#1d4ed8",
              fontSize: 14,
            }}
          >
            Imported data preview is shown below in its own section.
          </div>
        ) : null}

        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          <div
            style={{ padding: 12, border: "1px solid #ddd", borderRadius: 10 }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>Rows Loaded</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{rows.length}</div>
          </div>

          <div
            style={{ padding: 12, border: "1px solid #ddd", borderRadius: 10 }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>Valid Rows</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>
              {validRows.length}
            </div>
          </div>

          <div
            style={{ padding: 12, border: "1px solid #ddd", borderRadius: 10 }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>Activity Rows</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{activityCount}</div>
          </div>

          <div
            style={{ padding: 12, border: "1px solid #ddd", borderRadius: 10 }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>Detected Headers</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>
              {headers.length}
            </div>
          </div>
        </div>

        {showFullImportTable ? (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>
              Imported Data Preview
            </h3>

            {!rows.length ? (
              <div style={{ opacity: 0.8 }}>No file loaded yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 1300,
                  }}
                >
                  <thead>
                    <tr>
                      <th style={tableHeadStyle}>Row</th>
                      <th style={tableHeadStyle}>Entry ID</th>
                      <th style={tableHeadStyle}>Pilot</th>
                      <th style={tableHeadStyle}>Co-Pilot</th>
                      <th style={tableHeadStyle}>Email</th>
                      <th style={tableHeadStyle}>Phones</th>
                      <th style={tableHeadStyle}>City / State</th>
                      <th style={tableHeadStyle}>Coach</th>
                      <th style={tableHeadStyle}>Share</th>
                      <th style={tableHeadStyle}>Volunteer</th>
                      <th style={tableHeadStyle}>First Timer</th>
                      <th style={tableHeadStyle}>Activities</th>
                      <th style={tableHeadStyle}>Warnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row) => (
                      <tr key={row.rowNumber}>
                        <td style={tableCellStyle}>{row.rowNumber}</td>
                        <td style={tableCellStyle}>{row.entry_id || "—"}</td>
                        <td style={tableCellStyle}>
                          {[row.pilot_first, row.pilot_last]
                            .filter(Boolean)
                            .join(" ") || "—"}
                        </td>
                        <td style={tableCellStyle}>
                          {[row.copilot_first, row.copilot_last]
                            .filter(Boolean)
                            .join(" ") || "—"}
                        </td>
                        <td style={tableCellStyle}>{row.email || "—"}</td>
                        <td style={tableCellStyle}>
                          {[row.primary_phone, row.cell_phone]
                            .filter(Boolean)
                            .join(" / ") || "—"}
                        </td>
                        <td style={tableCellStyle}>
                          {[row.city, row.state].filter(Boolean).join(", ") ||
                            "—"}
                        </td>
                        <td style={tableCellStyle}>
                          {[row.coach_manufacturer, row.coach_model]
                            .filter(Boolean)
                            .join(" ") || "—"}
                        </td>
                        <td style={tableCellStyle}>
                          {row.share_with_attendees ? "Yes" : "No"}
                        </td>
                        <td style={tableCellStyle}>
                          {row.wants_to_volunteer ? "Yes" : "No"}
                        </td>
                        <td style={tableCellStyle}>
                          {row.is_first_timer ? "Yes" : "No"}
                        </td>
                        <td style={tableCellStyle}>
                          {row.activities.length
                            ? row.activities
                                .map(
                                  (activity) =>
                                    `${activity.activity_name} x${activity.quantity}${
                                      activity.price !== null
                                        ? ` ($${activity.price})`
                                        : ""
                                    }`,
                                )
                                .join(" • ")
                            : "—"}
                        </td>
                        <td style={tableCellStyle}>
                          {row.warnings.length
                            ? row.warnings.join(" • ")
                            : "None"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </div>
      <div className="card" style={{ padding: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "end",
            marginBottom: 14,
          }}
        >
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>
              Saved Attendee List
            </h2>
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              {savedAttendees.length} saved attendee
              {savedAttendees.length === 1 ? "" : "s"} for this event
            </div>
          </div>

          <div style={{ minWidth: 180 }}>
            <label
              style={{ display: "block", fontWeight: 600, marginBottom: 6 }}
            >
              Rows to Show
            </label>
            <select
              value={savedAttendeePageSize}
              onChange={(e) =>
                setSavedAttendeePageSize(
                  e.target.value as "25" | "50" | "100" | "all",
                )
              }
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ccc",
                background: "white",
              }}
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="all">Entire List</option>
            </select>
          </div>
          <div>
            <button
              type="button"
              onClick={() => void loadSavedAttendees(selectedImportEventId)}
              disabled={!selectedImportEventId || loadingSavedAttendees}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #ccc",
                background: "white",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Refresh Saved List
            </button>
          </div>
        </div>

        {loadingSavedAttendees ? (
          <div>Loading saved attendees...</div>
        ) : savedAttendees.length === 0 ? (
          <div style={{ opacity: 0.8 }}>
            No saved attendees found for this event yet.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 10 }}>
              Showing {visibleSavedAttendees.length} of {savedAttendees.length}
            </div>

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: 1200,
                }}
              >
                <thead>
                  <tr>
                    <th style={tableHeadStyle}>Pilot</th>
                    <th style={tableHeadStyle}>Co-Pilot</th>
                    <th style={tableHeadStyle}>Email</th>
                    <th style={tableHeadStyle}>City / State</th>
                    <th style={tableHeadStyle}>Member #</th>
                    <th style={tableHeadStyle}>Site</th>
                    <th style={tableHeadStyle}>Arrived</th>
                    <th style={tableHeadStyle}>First Timer</th>
                    <th style={tableHeadStyle}>Volunteer</th>
                    <th style={tableHeadStyle}>Source</th>
                    <th style={tableHeadStyle}>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSavedAttendees.map((row) => (
                    <tr key={row.id}>
                      <td style={tableCellStyle}>
                        {fullName(row.pilot_first, row.pilot_last) || "—"}
                      </td>
                      <td style={tableCellStyle}>
                        {fullName(row.copilot_first, row.copilot_last) || "—"}
                      </td>
                      <td style={tableCellStyle}>{row.email || "—"}</td>
                      <td style={tableCellStyle}>
                        {cityStateFromAttendee(row) || "—"}
                      </td>
                      <td style={tableCellStyle}>
                        {row.membership_number || "—"}
                      </td>
                      <td style={tableCellStyle}>{row.assigned_site || "—"}</td>
                      <td style={tableCellStyle}>
                        {row.has_arrived ? "Yes" : "No"}
                      </td>
                      <td style={tableCellStyle}>
                        {row.is_first_timer ? "Yes" : "No"}
                      </td>
                      <td style={tableCellStyle}>
                        {row.wants_to_volunteer ? "Yes" : "No"}
                      </td>
                      <td style={tableCellStyle}>
                        {row.source_type || "imported"}
                      </td>
                      <td style={tableCellStyle}>
                        {row.is_active ? "Yes" : "No"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "end",
            marginBottom: 14,
          }}
        >
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Row Preview</h2>{" "}
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              {rows.length} imported row{rows.length === 1 ? "" : "s"}
            </div>
          </div>

          <div style={{ minWidth: 180 }}>
            <label
              style={{ display: "block", fontWeight: 600, marginBottom: 6 }}
            >
              Rows to Show
            </label>
            <select
              value={importPreviewPageSize}
              onChange={(e) =>
                setImportPreviewPageSize(
                  e.target.value as "25" | "50" | "100" | "all",
                )
              }
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ccc",
                background: "white",
              }}
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="all">Entire List</option>
            </select>
          </div>
        </div>

        {!rows.length ? (
          <div style={{ opacity: 0.8 }}>No file loaded yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 10 }}>
              Showing {previewRows.length} of {rows.length}
            </div>
            {previewRows.map((row) => (
              <div
                key={`${row.entry_id}-${row.rowNumber}`}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 12,
                  padding: 14,
                  background: "#fafafa",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {row.pilot_first} {row.pilot_last}
                    {row.copilot_first || row.copilot_last
                      ? ` / ${row.copilot_first} ${row.copilot_last}`
                      : ""}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.75 }}>
                    Entry ID: {row.entry_id || "Missing"}
                  </div>
                </div>

                <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                  <div>Email: {row.email || "—"}</div>
                  <div>
                    {row.city || "—"}
                    {row.state ? `, ${row.state}` : ""}
                  </div>
                  <div>
                    Phones:{" "}
                    {[row.primary_phone, row.cell_phone]
                      .filter(Boolean)
                      .join(" / ") || "—"}
                  </div>
                  <div>
                    Volunteer: {row.wants_to_volunteer ? "Yes" : "No"} • First
                    Timer: {row.is_first_timer ? "Yes" : "No"}
                  </div>
                  <div>
                    Coach:{" "}
                    {[row.coach_manufacturer, row.coach_model]
                      .filter(Boolean)
                      .join(" ") || "—"}
                  </div>
                  <div>
                    Share with attendees:{" "}
                    {row.share_with_attendees ? "Yes" : "No"}
                  </div>
                  {row.additional_attendees ? (
                    <div>Additional attendees: {row.additional_attendees}</div>
                  ) : null}
                </div>

                {row.activities.length ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      Activities
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {row.activities.map((activity, index) => (
                        <div
                          key={`${row.entry_id}-${activity.source_column_prefix}-${index}`}
                          style={{ fontSize: 14 }}
                        >
                          {activity.activity_name} • Qty {activity.quantity}
                          {activity.price !== null
                            ? ` • $${activity.price}`
                            : ""}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {row.warnings.length ? (
                  <div
                    style={{ marginTop: 10, color: "#8a1f1f", fontSize: 13 }}
                  >
                    Warnings: {row.warnings.join(" • ")}
                  </div>
                ) : (
                  <div
                    style={{ marginTop: 10, color: "#166534", fontSize: 13 }}
                  >
                    No warnings detected.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
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

const tableHeadStyle = {
  textAlign: "left" as const,
  padding: "10px 8px",
  borderBottom: "2px solid #ddd",
  background: "#f8f9fb",
  whiteSpace: "nowrap" as const,
  fontSize: 13,
};

const tableCellStyle = {
  textAlign: "left" as const,
  padding: "10px 8px",
  borderBottom: "1px solid #eee",
  verticalAlign: "top" as const,
  fontSize: 13,
};
