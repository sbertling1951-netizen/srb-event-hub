"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import {
  validateField,
  type ValidationRule,
} from "@/app/admin/attendees/attendeesWorkflow";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import PageNavigation from "@/components/layout/PageNavigation";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { interpretAttendeeImportRow } from "@/lib/attendeeImportContract";
import {
  type AttendeeImportRowResult,
  type AttendeeImportRunResult,
  recoverAttendeeImportRun,
  retryAttendeeImportRowCommit,
  runGovernedAttendeeImport,
  summarizeAttendeeImportRows,
} from "@/lib/attendeeImportOrchestration";
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

type RawRow = Record<string, unknown>;

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
  participant_capacity: number;
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
  vendor_master_id?: string | null;
  vendor_assigned_event_id?: string | null;
};

type PrintSettingsRow = {
  id?: string;
  event_id: string;
  name_tag_bg_url: string | null;
  coach_plate_bg_url: string | null;
};

type VendorRow = {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  services: string | null;
  logo_url: string | null;
  preferred_contact_method: string | null;
  is_active: boolean;
  notes: string | null;
  created_at?: string | null;
};

type EventVendorRow = {
  id: string;
  event_id: string;
  vendor_id: string;
  booth_location: string | null;
  show_on_member_dashboard: boolean;
  allow_service_requests: boolean;
  status: string;
  notes: string | null;
  vendors?: VendorRow | null;
};

type VendorFormState = {
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  website: string;
  services: string;
  preferred_contact_method: string;
  notes: string;
};

const emptyVendorForm: VendorFormState = {
  name: "",
  contact_name: "",
  email: "",
  phone: "",
  website: "",
  services: "",
  preferred_contact_method: "email",
  notes: "",
};


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

// Stores only the active governed import_runs.id per Event -- a locator, not
// authoritative state. get_managed_import_run_recovery(run_id) revalidates
// authority and returns the actual persisted row states on every reload; the
// run ID itself conveys no authority.
function getActiveImportRunStorageKey(eventId: string) {
  return `fcoc-attendee-import-run::${eventId}`;
}

function loadActiveImportRunId(eventId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return localStorage.getItem(getActiveImportRunStorageKey(eventId));
  } catch {
    return null;
  }
}

function saveActiveImportRunId(eventId: string, runId: string | null) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (runId) {
      localStorage.setItem(getActiveImportRunStorageKey(eventId), runId);
    } else {
      localStorage.removeItem(getActiveImportRunStorageKey(eventId));
    }
  } catch {
    // ignore storage errors
  }
}

function fullName(first?: string | null, last?: string | null) {
  return [first, last].filter(Boolean).join(" ").trim();
}

function cityStateFromAttendee(row: AttendeeRow) {
  return [row.city, row.state].filter(Boolean).join(", ");
}

// Thin UI adapter: reuses the Stage 2 governed contract (field/header
// mapping, normalization, validation, activities, Co-Pilot/reference-only
// evidence) to build the client-local preview shown before a real governed
// run is created. It carries no mapping/validation authority of its own --
// the same Stage 2 interpretation is what actually gets staged through
// Stage 1 when the operator clicks Import (see runGovernedAttendeeImport).
function previewAttendeeImportRow(
  row: RawRow,
  rowNumber: number,
  headers: string[],
  rules: ValidationRule[],
  eventId: string | null,
): ParsedRegistration {
  const { candidate, issues } = interpretAttendeeImportRow(row, rowNumber, headers);
  const warnings = issues.map((issue) => issue.message);

  if (candidate.registration.membership_number) {
    const membershipIssue = validateField(
      "membership_number",
      candidate.registration.membership_number,
      rules,
      eventId,
    );
    if (membershipIssue) {
      warnings.push(membershipIssue.issue);
    }
  } else {
    warnings.push("Missing membership number");
  }

  return {
    rowNumber,
    entry_id: candidate.registration.entry_id,
    email: candidate.registration.email,
    pilot_first: candidate.registration.pilot_first,
    pilot_last: candidate.registration.pilot_last,
    copilot_first: candidate.copilot.first,
    copilot_last: candidate.copilot.last,
    nickname: candidate.registration.nickname,
    copilot_nickname: candidate.copilot.nickname,
    additional_attendees: candidate.reference_only.additional_attendees,
    participant_capacity:
      candidate.capacity_evidence.imported_capacity ??
      candidate.capacity_evidence.structured_participant_minimum,
    membership_number: candidate.registration.membership_number,
    primary_phone: candidate.registration.primary_phone,
    cell_phone: candidate.registration.cell_phone,
    city: candidate.registration.city,
    state: candidate.registration.state,
    wants_to_volunteer: candidate.registration.wants_to_volunteer,
    is_first_timer: candidate.registration.is_first_timer,
    coach_manufacturer: candidate.registration.coach_manufacturer,
    coach_model: candidate.registration.coach_model,
    share_with_attendees: candidate.registration.share_with_attendees,
    special_events_raw: candidate.registration.special_events_raw,
    raw_import: row,
    activities: candidate.activities,
    warnings,
  };
}

export default function AdminAttendeeImportsPage() {
  return (
    <AdminRouteGuard requiredTask="event.imports.manage">
      <AdminShellAdapter pageTitle="Attendee Imports">
        <AdminAttendeeImportsPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function AdminAttendeeImportsPageInner() {
  const { admin, loading: adminLoading } = useAdmin();

  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [availableEvents, setAvailableEvents] = useState<EventContext[]>([]);
  const [selectedImportEventId, setSelectedImportEventId] = useState("");
  const [loadedForEventId, setLoadedForEventId] = useState("");
  const [rules, setRules] = useState<ValidationRule[]>([]);

  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [rows, setRows] = useState<ParsedRegistration[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [reviewIssues, setReviewIssues] = useState<ReviewIssue[]>([]);

  // Governed Stage 4 run state. importRunResult is the persisted truth for
  // the most recent (or recovered) run. Only its runId is ever persisted to
  // localStorage (as a locator, via saveActiveImportRunId) --
  // get_managed_import_run_recovery(run_id) revalidates authority and
  // returns the actual persisted row states on every reload.
  const [importRunResult, setImportRunResult] =
    useState<AttendeeImportRunResult | null>(null);
  const [retryingRowId, setRetryingRowId] = useState<string | null>(null);

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

  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [eventVendors, setEventVendors] = useState<EventVendorRow[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [vendorSaving, setVendorSaving] = useState(false);
  const [vendorStatus, setVendorStatus] = useState("");
  const [vendorError, setVendorError] = useState<string | null>(null);
  const [vendorForm, setVendorForm] =
    useState<VendorFormState>(emptyVendorForm);
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [editingVendorForm, setEditingVendorForm] =
    useState<VendorFormState>(emptyVendorForm);

  useEffect(() => {
    async function loadEvents() {
      setLoadingEvent(true);
      setError(null);

      try {
        if (adminLoading) {
          setLoadingEvent(false);
          return;
        }

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

        const stored = getCurrentAdminEvent();
        setCurrentEvent(stored);

        const [{ data, error }, { data: rulesData, error: rulesError }] =
          await Promise.all([
            supabase
              .from("events")
              .select("id, name, venue_name, location, start_date, end_date")
              .order("start_date", { ascending: false }),
            supabase
              .from("validation_rules")
              .select("*")
              .order("priority", { ascending: true })
              .order("created_at", { ascending: true }),
          ]);

        if (error) {
          throw error;
        }
        if (rulesError) {
          throw rulesError;
        }

        setRules((rulesData || []) as ValidationRule[]);

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

    const unsubscribe = subscribeToAdminWorkspace(() => {
      void loadEvents();
    });

    return unsubscribe;
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
      setEventVendors([]);
      return;
    }

    void loadSavedAttendees(selectedImportEventId);
    void loadVendors(selectedImportEventId);
  }, [selectedImportEventId]);

  useEffect(() => {
    if (!selectedImportEventId) {
      setImportRunResult(null);
      return;
    }

    const storedRunId = loadActiveImportRunId(selectedImportEventId);
    if (!storedRunId) {
      setImportRunResult(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const recovered = await recoverAttendeeImportRun(storedRunId);
        if (cancelled) {
          return;
        }
        setImportRunResult({
          runId: recovered.run.id,
          eventId: recovered.run.eventId,
          sourceFilename: recovered.run.sourceFilename,
          rows: recovered.rows,
        });
        setStatus(`Recovered import run from ${recovered.run.sourceFilename || "a prior session"}.`);
      } catch (err) {
        console.error("Could not recover import run:", err);
        if (!cancelled) {
          saveActiveImportRunId(selectedImportEventId, null);
          setImportRunResult(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedImportEventId]);

  useEffect(() => {
    function refreshFromStorageAndReload() {
      const stored = getCurrentAdminEvent();

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
      } else {
        const membershipIssue = validateField(
          "membership_number",
          row.membership_number,
          rules,
          selectedImportEventId || null,
        );

        if (membershipIssue) {
          issues.push({
            key: `${attendeeKey}-membership-invalid`,
            rowNumber: row.rowNumber,
            attendeeKey,
            field: "membership_number",
            label: "Member #",
            message: membershipIssue.issue,
            severity: membershipIssue.severity,
            currentValue: row.membership_number,
            isResolved: false,
          });
        }
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
  }, [rows, rules, selectedImportEventId]);

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

  const savedAttendeeIssues = useMemo(() => {
    return savedAttendees.flatMap((attendee) => {
      const issues: {
        key: string;
        attendee: AttendeeRow;
        label: string;
        message: string;
        currentValue: string;
        severity: "error" | "warning";
      }[] = [];

      if (attendee.participant_type === "vendor") {
        return issues;
      }
      const memberNumber = String(attendee.membership_number || "").trim();

      if (!memberNumber) {
        issues.push({
          key: `${attendee.id}-membership-missing`,
          attendee,
          label: "Member #",
          message: "Missing membership number",
          currentValue: "",
          severity: "warning",
        });
      } else {
        const membershipIssue = validateField(
          "membership_number",
          memberNumber,
          rules,
          selectedImportEventId || null,
        );

        if (membershipIssue) {
          issues.push({
            key: `${attendee.id}-membership-invalid`,
            attendee,
            label: "Member #",
            message: membershipIssue.issue,
            currentValue: memberNumber,
            severity: membershipIssue.severity,
          });
        }
      }

      return issues;
    });
  }, [savedAttendees, rules, selectedImportEventId]);

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
            created_at,
            vendor_master_id,
            vendor_assigned_event_id
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

  async function loadVendors(eventId: string) {
    try {
      setLoadingVendors(true);
      setVendorError(null);

      const [
        { data: vendorData, error: vendorLoadError },
        { data: assignmentData, error: assignmentLoadError },
      ] = await Promise.all([
        supabase.from("vendors").select("*").order("name", { ascending: true }),
        supabase
          .from("event_vendors")
          .select(
            `
                id,
                event_id,
                vendor_id,
                booth_location,
                show_on_member_dashboard,
                allow_service_requests,
                status,
                notes,
                vendor:vendors (
                  id,
                  name,
                  contact_name,
                  email,
                  phone,
                  website,
                  services,
                  logo_url,
                  preferred_contact_method,
                  is_active,
                  notes,
                  created_at
                )
              `,
          )
          .eq("event_id", eventId)
          .order("created_at", { ascending: true }),
      ]);

      if (vendorLoadError) {
        throw vendorLoadError;
      }

      if (assignmentLoadError) {
        throw assignmentLoadError;
      }

      setVendors((vendorData || []) as VendorRow[]);
      setEventVendors(
        (assignmentData || []).map((assignment: any) => ({
          ...assignment,
          vendors: Array.isArray(assignment.vendor)
            ? assignment.vendor[0] || null
            : assignment.vendor || null,
        })) as EventVendorRow[],
      );
    } catch (err: any) {
      console.error("loadVendors error:", err);
      setVendors([]);
      setEventVendors([]);
      setVendorError(err?.message || "Could not load vendors.");
    } finally {
      setLoadingVendors(false);
    }
  }

  function updateVendorForm(key: keyof VendorFormState, value: string) {
    setVendorForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateEditingVendorForm(key: keyof VendorFormState, value: string) {
    setEditingVendorForm((prev) => ({ ...prev, [key]: value }));
  }

  function startEditVendor(vendor: VendorRow) {
    setEditingVendorId(vendor.id);
    setEditingVendorForm({
      name: vendor.name || "",
      contact_name: vendor.contact_name || "",
      email: vendor.email || "",
      phone: vendor.phone || "",
      website: vendor.website || "",
      services: vendor.services || "",
      preferred_contact_method: vendor.preferred_contact_method || "email",
      notes: vendor.notes || "",
    });
    setVendorError(null);
    setVendorStatus("");
  }

  function cancelEditVendor() {
    setEditingVendorId(null);
    setEditingVendorForm(emptyVendorForm);
    setVendorError(null);
  }

  async function saveEditedVendor() {
    if (!editingVendorId) {
      return;
    }

    const vendorName = editingVendorForm.name.trim();

    if (!vendorName) {
      setVendorError("Vendor name is required.");
      return;
    }

    try {
      setVendorSaving(true);
      setVendorError(null);
      setVendorStatus("Saving vendor changes...");

      const payload = {
        name: vendorName,
        business_name: vendorName,
        contact_name: editingVendorForm.contact_name.trim() || null,
        email: editingVendorForm.email.trim() || null,
        phone: editingVendorForm.phone.trim() || null,
        website: editingVendorForm.website.trim() || null,
        services: editingVendorForm.services.trim() || null,
        preferred_contact_method:
          editingVendorForm.preferred_contact_method || null,
        notes: editingVendorForm.notes.trim() || null,
      };

      const { error: updateError } = await supabase
        .from("vendors")
        .update(payload)
        .eq("id", editingVendorId);

      if (updateError) {
        throw updateError;
      }

      setEditingVendorId(null);
      setEditingVendorForm(emptyVendorForm);
      setVendorStatus("Vendor updated.");

      if (selectedImportEventId) {
        await loadVendors(selectedImportEventId);
      }
    } catch (err: any) {
      console.error("saveEditedVendor error:", err);
      setVendorError(err?.message || "Could not update vendor.");
      setVendorStatus("");
    } finally {
      setVendorSaving(false);
    }
  }

  async function createVendor() {
    const vendorName = vendorForm.name.trim();

    if (!vendorName) {
      setVendorError("Vendor name is required.");
      return;
    }

    try {
      setVendorSaving(true);
      setVendorError(null);
      setVendorStatus("Saving vendor...");

      const payload = {
        name: vendorName,
        business_name: vendorName,
        contact_name: vendorForm.contact_name.trim() || null,
        email: vendorForm.email.trim() || null,
        phone: vendorForm.phone.trim() || null,
        website: vendorForm.website.trim() || null,
        services: vendorForm.services.trim() || null,
        preferred_contact_method: vendorForm.preferred_contact_method || null,
        notes: vendorForm.notes.trim() || null,
        is_active: true,
      };

      const { error: insertError } = await supabase
        .from("vendors")
        .insert(payload);

      if (insertError) {
        throw insertError;
      }

      setVendorForm(emptyVendorForm);
      setVendorStatus("Vendor saved to the library.");

      if (selectedImportEventId) {
        await loadVendors(selectedImportEventId);
      }
    } catch (err: any) {
      console.error("createVendor error:", err);
      setVendorError(err?.message || "Could not save vendor.");
      setVendorStatus("");
    } finally {
      setVendorSaving(false);
    }
  }

  async function assignVendorToEvent(vendorId: string) {
    if (!selectedImportEventId) {
      setVendorError("Select an event before assigning vendors.");
      return;
    }

    try {
      setVendorSaving(true);
      setVendorError(null);
      setVendorStatus("Assigning vendor to event...");

      // Governed admission (Stage 3): direct event_vendors DML is no longer
      // permitted. admit_vendor_for_event's table defaults
      // (show_on_member_dashboard=true, allow_service_requests=false,
      // status='assigned') reproduce exactly what this upsert used to set
      // explicitly, and the RPC is idempotent if the vendor is already
      // admitted.
      const { error: admitError } = await supabase.rpc("admit_vendor_for_event", {
        p_vendor_id: vendorId,
        p_event_id: selectedImportEventId,
      });

      if (admitError) {
        throw admitError;
      }

      setVendorStatus("Vendor assigned to this event.");
      await loadVendors(selectedImportEventId);
    } catch (err: any) {
      console.error("assignVendorToEvent error:", err);
      setVendorError(err?.message || "Could not assign vendor to event.");
      setVendorStatus("");
    } finally {
      setVendorSaving(false);
    }
  }

  async function unassignVendorFromEvent(vendorId: string) {
    if (!selectedImportEventId) {
      return;
    }

    const reason = window.prompt(
      "Reason for removing this vendor from the event (required):",
    );
    if (reason === null) {
      return;
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setVendorError("A reason is required to remove a vendor from this event.");
      return;
    }

    try {
      setVendorSaving(true);
      setVendorError(null);
      setVendorStatus("Removing vendor from this event...");

      // Governed revocation (Stage 3): direct event_vendors DML is no
      // longer permitted. This quick-action UI has no structured reason
      // picker yet, so it supplies the admin's own typed reason as
      // reason_text under the non-quality-implying "other_administrative"
      // code rather than guessing a more specific classification.
      const { error: revokeError } = await supabase.rpc("revoke_vendor_admission", {
        p_vendor_id: vendorId,
        p_event_id: selectedImportEventId,
        p_reason_code: "other_administrative",
        p_reason_text: trimmedReason,
      });

      if (revokeError) {
        throw revokeError;
      }

      setVendorStatus(
        "Vendor removed from this event. It remains in the library.",
      );
      await loadVendors(selectedImportEventId);
    } catch (err: any) {
      console.error("unassignVendorFromEvent error:", err);
      setVendorError(err?.message || "Could not remove vendor from event.");
      setVendorStatus("");
    } finally {
      setVendorSaving(false);
    }
  }

  // Metadata Governance Bridge: direct event_vendors DML remains
  // permanently closed (Stage 3). This now calls the governed
  // update_event_vendor_metadata RPC, which accepts only this same
  // metadata allowlist (booth_location/show_on_member_dashboard/
  // allow_service_requests/notes) and is structurally incapable of
  // touching admission-lifecycle state. Takes vendor_id rather than the
  // assignment row id -- the RPC identifies the event_vendors
  // relationship by (vendor_id, event_id) server-side.
  async function updateEventVendorSetting(
    vendorId: string,
    updates: Partial<
      Pick<
        EventVendorRow,
        | "booth_location"
        | "show_on_member_dashboard"
        | "allow_service_requests"
        | "notes"
      >
    >,
  ) {
    if (!selectedImportEventId) {
      return;
    }

    try {
      setVendorSaving(true);
      setVendorError(null);
      setVendorStatus("Updating event vendor...");

      const { error } = await supabase.rpc("update_event_vendor_metadata", {
        p_vendor_id: vendorId,
        p_event_id: selectedImportEventId,
        p_updates: updates,
      });

      if (error) {
        throw error;
      }

      setVendorStatus("Event vendor updated.");
      await loadVendors(selectedImportEventId);
    } catch (err: any) {
      console.error("update event vendor metadata error:", err);
      setVendorError(err?.message || "Could not update event vendor.");
      setVendorStatus("");
    } finally {
      setVendorSaving(false);
    }
  }

  const selectedImportEvent =
    availableEvents.find((event) => event.id === selectedImportEventId) || null;
  const pageTitle = "Attendee Imports";

  const assignedVendorIds = useMemo(
    () => new Set(eventVendors.map((assignment) => assignment.vendor_id)),
    [eventVendors],
  );

  const unassignedVendors = useMemo(
    () => vendors.filter((vendor) => !assignedVendorIds.has(vendor.id)),
    [vendors, assignedVendorIds],
  );

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
    setImportRunResult(null);

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
        setRawRows([]);
        setRows([]);
        setHeaders([]);
        setLoadedForEventId("");
        setStatus("No rows found in file.");
        return;
      }

      const foundHeaders = Object.keys(json[0] || {});
      const parsed = json.map((row, index) =>
        previewAttendeeImportRow(
          row,
          index + 2,
          foundHeaders,
          rules,
          selectedImportEventId || null,
        ),
      );

      setHeaders(foundHeaders);
      setRawRows(json);
      setRows(parsed);
      setLoadedForEventId(selectedImportEventId);
      setStatus(`Loaded ${parsed.length} rows from ${file.name}.`);
    } catch (err) {
      console.error(err);
      setError("Could not parse file.");
      setRawRows([]);
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

    if (!rawRows.length) {
      setError("No rows to import.");
      return;
    }

    setImporting(true);
    setError(null);
    setImportRunResult(null);
    setStatus("Creating governed import run...");

    try {
      const result = await runGovernedAttendeeImport({
        eventId: selectedImportEventId,
        sourceFilename: fileName || null,
        rows: rawRows,
        headers,
      });

      setImportRunResult(result);
      saveActiveImportRunId(selectedImportEventId, result.runId);

      const summary = summarizeAttendeeImportRows(result.rows);
      await loadSavedAttendees(selectedImportEventId);

      setStatus(
        `Processed ${summary.processed} rows into ${
          selectedImportEvent?.name || "selected event"
        }: ${summary.committed} committed, ${summary.needsReview} need review, ` +
          `${summary.validationFailed} failed validation, ${summary.commitFailed} failed to commit` +
          (summary.warnings ? `, ${summary.warnings} with warnings.` : "."),
      );
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Import failed.");
      setStatus("Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function handleRetryImportRow(row: AttendeeImportRowResult) {
    setRetryingRowId(row.rowId);
    setError(null);

    try {
      const outcome = await retryAttendeeImportRowCommit({
        rowId: row.rowId,
        issues: row.issues,
      });

      setImportRunResult((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          rows: prev.rows.map((r) =>
            r.rowId === row.rowId
              ? {
                  ...r,
                  rowState: outcome.rowState,
                  canonicalTargetId: outcome.canonicalTargetId,
                  commitError: outcome.commitError,
                }
              : r,
          ),
        };
      });

      if (outcome.rowState === "committed" && selectedImportEventId) {
        await loadSavedAttendees(selectedImportEventId);
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Retry failed.");
    } finally {
      setRetryingRowId(null);
    }
  }
  function openIssueInAttendeeManagement(issue: ReviewIssue) {
    const match = savedAttendees.find((row) => {
      return (
        row.entry_id === issue.attendeeKey ||
        row.email?.toLowerCase() === issue.attendeeKey.toLowerCase() ||
        row.membership_number === issue.currentValue
      );
    });

    if (!match) {
      setError(null);
      setStatus(
        "This review item belongs to the imported file preview. Import this attendee first, then click the review item again.",
      );
      return;
    }

    setError(null);
    localStorage.setItem("fcoc-attendee-open-edit-id", match.id);

    window.top?.location.assign("/admin/attendees");
  }

  function openSavedIssueInAttendeeManagement(issue: {
    attendee: AttendeeRow;
  }) {
    setError(null);
    setStatus("Opening saved attendee in Attendee Management...");
    localStorage.setItem("fcoc-attendee-open-edit-id", issue.attendee.id);
    window.top?.location.assign("/admin/attendees");
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <PageNavigation
        homeHref="/admin/dashboard"
        homeLabel="Dashboard"
        parentHref="/admin/attendees"
        parentLabel="Attendees"
      />

      <div className="card" style={{ padding: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "start",
            marginBottom: 14,
          }}
        >
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Vendor Library</h2>
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              Store vendors once, then assign them only to the selected event.
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              selectedImportEventId
                ? void loadVendors(selectedImportEventId)
                : null
            }
            disabled={!selectedImportEventId || loadingVendors}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "#ffffff",
              color: "#111827",
              WebkitTextFillColor: "#111827",
              fontWeight: 700,
              lineHeight: 1.2,
              cursor: "pointer",
            }}
          >
            Refresh Vendors
          </button>
        </div>

        {vendorError ? (
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
            {vendorError}
          </div>
        ) : null}

        {vendorStatus ? (
          <div style={{ fontSize: 14, marginBottom: 12 }}>{vendorStatus}</div>
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
              Add Vendor to Library
            </h3>

            <div style={{ display: "grid", gap: 10 }}>
              <input
                value={vendorForm.name}
                onChange={(e) => updateVendorForm("name", e.target.value)}
                placeholder="Vendor name"
                style={inputStyle}
              />
              <input
                value={vendorForm.contact_name}
                onChange={(e) =>
                  updateVendorForm("contact_name", e.target.value)
                }
                placeholder="Contact name"
                style={inputStyle}
              />
              <input
                value={vendorForm.email}
                onChange={(e) => updateVendorForm("email", e.target.value)}
                placeholder="Email"
                style={inputStyle}
              />
              <input
                value={vendorForm.phone}
                onChange={(e) => updateVendorForm("phone", e.target.value)}
                placeholder="Phone"
                style={inputStyle}
              />
              <input
                value={vendorForm.website}
                onChange={(e) => updateVendorForm("website", e.target.value)}
                placeholder="Website"
                style={inputStyle}
              />
              <textarea
                value={vendorForm.services}
                onChange={(e) => updateVendorForm("services", e.target.value)}
                placeholder="Services offered"
                rows={3}
                style={inputStyle}
              />
              <select
                value={vendorForm.preferred_contact_method}
                onChange={(e) =>
                  updateVendorForm("preferred_contact_method", e.target.value)
                }
                style={inputStyle}
              >
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="text">Text</option>
                <option value="in_app">In-app request</option>
              </select>
              <textarea
                value={vendorForm.notes}
                onChange={(e) => updateVendorForm("notes", e.target.value)}
                placeholder="Internal notes"
                rows={3}
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => void createVendor()}
                disabled={vendorSaving || !vendorForm.name.trim()}
                style={{
                  ...darkButtonStyle,
                  opacity: vendorSaving || !vendorForm.name.trim() ? 0.6 : 1,
                }}
              >
                {vendorSaving ? "Saving..." : "Save Vendor"}
              </button>
            </div>
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
              Assigned to Selected Event
            </h3>

            {!selectedImportEventId ? (
              <div style={{ opacity: 0.8 }}>Select an event first.</div>
            ) : loadingVendors ? (
              <div>Loading vendors...</div>
            ) : eventVendors.length === 0 ? (
              <div style={{ opacity: 0.8 }}>
                No vendors assigned to this event yet.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {eventVendors.map((assignment) => {
                  const vendor = assignment.vendors;
                  return (
                    <div
                      key={assignment.id}
                      style={{
                        border: "1px solid #ddd",
                        borderRadius: 12,
                        padding: 12,
                        background: "white",
                      }}
                    >
                      <div style={{ fontWeight: 800, marginBottom: 4 }}>
                        {vendor?.name || "Vendor"}
                      </div>
                      <div
                        style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}
                      >
                        {[vendor?.contact_name, vendor?.email, vendor?.phone]
                          .filter(Boolean)
                          .join(" • ") || "No contact details"}
                      </div>
                      {vendor?.services ? (
                        <div style={{ fontSize: 13, marginBottom: 8 }}>
                          {vendor.services}
                        </div>
                      ) : null}
                      <input
                        defaultValue={assignment.booth_location || ""}
                        onBlur={(e) =>
                          void updateEventVendorSetting(assignment.vendor_id, {
                            booth_location: e.target.value.trim() || null,
                          })
                        }
                        placeholder="Booth / site / location"
                        style={{ ...inputStyle, marginBottom: 8 }}
                      />
                      <label
                        style={{
                          display: "block",
                          fontSize: 13,
                          marginBottom: 6,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={assignment.show_on_member_dashboard}
                          onChange={(e) =>
                            void updateEventVendorSetting(assignment.vendor_id, {
                              show_on_member_dashboard: e.target.checked,
                            })
                          }
                        />{" "}
                        Show on member dashboard
                      </label>
                      <label
                        style={{
                          display: "block",
                          fontSize: 13,
                          marginBottom: 10,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={assignment.allow_service_requests}
                          onChange={(e) =>
                            void updateEventVendorSetting(assignment.vendor_id, {
                              allow_service_requests: e.target.checked,
                            })
                          }
                        />{" "}
                        Allow service requests
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          void unassignVendorFromEvent(assignment.vendor_id)
                        }
                        // UI-alignment only, not the security boundary --
                        // see the Assign button above for rationale.
                        disabled={
                          vendorSaving || !hasPermission(admin, "can_manage_vendors")
                        }
                        style={{
                          padding: "8px 12px",
                          borderRadius: 10,
                          border: "1px solid #fca5a5",
                          background: "#fff7f7",
                          color: "#991b1b",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Remove from this event
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <h3 style={{ marginTop: 0, marginBottom: 10 }}>Library Vendors</h3>
          {vendors.length === 0 ? (
            <div style={{ opacity: 0.8 }}>No vendors in the library yet.</div>
          ) : unassignedVendors.length === 0 ? (
            <div style={{ opacity: 0.8 }}>
              All active library vendors are assigned to this event.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              }}
            >
              {unassignedVendors.map((vendor) => {
                const isEditing = editingVendorId === vendor.id;

                return (
                  <div
                    key={vendor.id}
                    style={{
                      border: "1px solid #ddd",
                      borderRadius: 12,
                      padding: 12,
                      background: "#ffffff",
                    }}
                  >
                    {isEditing ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <input
                          value={editingVendorForm.name}
                          onChange={(e) =>
                            updateEditingVendorForm("name", e.target.value)
                          }
                          placeholder="Vendor name"
                          style={inputStyle}
                        />
                        <input
                          value={editingVendorForm.contact_name}
                          onChange={(e) =>
                            updateEditingVendorForm(
                              "contact_name",
                              e.target.value,
                            )
                          }
                          placeholder="Contact name"
                          style={inputStyle}
                        />
                        <input
                          value={editingVendorForm.email}
                          onChange={(e) =>
                            updateEditingVendorForm("email", e.target.value)
                          }
                          placeholder="Email"
                          style={inputStyle}
                        />
                        <input
                          value={editingVendorForm.phone}
                          onChange={(e) =>
                            updateEditingVendorForm("phone", e.target.value)
                          }
                          placeholder="Phone"
                          style={inputStyle}
                        />
                        <input
                          value={editingVendorForm.website}
                          onChange={(e) =>
                            updateEditingVendorForm("website", e.target.value)
                          }
                          placeholder="Website"
                          style={inputStyle}
                        />
                        <textarea
                          value={editingVendorForm.services}
                          onChange={(e) =>
                            updateEditingVendorForm("services", e.target.value)
                          }
                          placeholder="Services offered"
                          rows={3}
                          style={inputStyle}
                        />
                        <select
                          value={editingVendorForm.preferred_contact_method}
                          onChange={(e) =>
                            updateEditingVendorForm(
                              "preferred_contact_method",
                              e.target.value,
                            )
                          }
                          style={inputStyle}
                        >
                          <option value="email">Email</option>
                          <option value="phone">Phone</option>
                          <option value="text">Text</option>
                          <option value="in_app">In-app request</option>
                        </select>
                        <textarea
                          value={editingVendorForm.notes}
                          onChange={(e) =>
                            updateEditingVendorForm("notes", e.target.value)
                          }
                          placeholder="Internal notes"
                          rows={2}
                          style={inputStyle}
                        />
                        <div
                          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                        >
                          <button
                            type="button"
                            onClick={() => void saveEditedVendor()}
                            disabled={
                              vendorSaving || !editingVendorForm.name.trim()
                            }
                            style={{
                              ...darkButtonStyle,
                              opacity:
                                vendorSaving || !editingVendorForm.name.trim()
                                  ? 0.6
                                  : 1,
                            }}
                          >
                            Save Changes
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditVendor}
                            disabled={vendorSaving}
                            style={secondaryButtonStyle}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 800, marginBottom: 4 }}>
                          {vendor.name || "Unnamed Vendor"}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            opacity: 0.8,
                            marginBottom: 8,
                          }}
                        >
                          {[vendor.contact_name, vendor.email, vendor.phone]
                            .filter(Boolean)
                            .join(" • ") || "No contact details"}
                        </div>
                        {vendor.services ? (
                          <div style={{ fontSize: 13, marginBottom: 8 }}>
                            {vendor.services}
                          </div>
                        ) : null}
                        <div
                          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                        >
                          <button
                            type="button"
                            onClick={() => void assignVendorToEvent(vendor.id)}
                            // UI-alignment only, not the security boundary
                            // (admit_vendor_for_event's own
                            // has_event_task_authority check is
                            // authoritative) -- can_manage_vendors is the
                            // existing, coarser permission key; no
                            // client-side adapter for the canonical
                            // per-Event event.vendors.manage task exists
                            // yet.
                            disabled={
                              !selectedImportEventId ||
                              vendorSaving ||
                              !hasPermission(admin, "can_manage_vendors")
                            }
                            style={darkButtonStyle}
                          >
                            Assign to Selected Event
                          </button>
                          <button
                            type="button"
                            onClick={() => startEditVendor(vendor)}
                            disabled={vendorSaving}
                            style={secondaryButtonStyle}
                          >
                            Edit
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Data Review Queue</h2>
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              {reviewIssues.filter((issue) => !issue.isResolved).length +
                savedAttendeeIssues.length}{" "}
              item
              {reviewIssues.filter((issue) => !issue.isResolved).length +
                savedAttendeeIssues.length ===
              1
                ? ""
                : "s"}{" "}
              need review or correction from the import preview or saved
              attendee list
            </div>
          </div>
        </div>

        {reviewIssues.filter((issue) => !issue.isResolved).length === 0 &&
        savedAttendeeIssues.length === 0 ? (
          <div style={{ opacity: 0.8 }}>
            No data review items currently flagged for the import preview or
            saved attendee list.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {reviewIssues
              .filter((issue) => !issue.isResolved)
              .map((issue) => (
                <div
                  key={issue.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => openIssueInAttendeeManagement(issue)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openIssueInAttendeeManagement(issue);
                    }
                  }}
                  title="Open this attendee for editing"
                  style={{
                    cursor: "pointer",
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
                    Import Row {issue.rowNumber} • {issue.label}
                  </div>
                  <div style={{ fontSize: 14, marginBottom: 6 }}>
                    {issue.message}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>
                    Current value: {issue.currentValue || "—"}
                  </div>
                </div>
              ))}
            {savedAttendeeIssues.map((issue) => (
              <div
                key={issue.key}
                role="button"
                tabIndex={0}
                onClick={() => openSavedIssueInAttendeeManagement(issue)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openSavedIssueInAttendeeManagement(issue);
                  }
                }}
                title="Open this attendee for editing"
                style={{
                  cursor: "pointer",
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
                  Saved Attendee •{" "}
                  {fullName(
                    issue.attendee.pilot_first,
                    issue.attendee.pilot_last,
                  ) || "Unnamed"}{" "}
                  • {issue.label}
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
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>{pageTitle}</h1>

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
                !rawRows.length ||
                eventChangedSinceLoad
              }
              style={{
                ...darkButtonStyle,
                opacity:
                  importing ||
                  parsing ||
                  !selectedImportEventId ||
                  !rawRows.length ||
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

      {importRunResult ? (
        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>Governed Import Results</h2>
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 14 }}>
            Run {importRunResult.runId}
            {importRunResult.sourceFilename ? ` • ${importRunResult.sourceFilename}` : ""}
          </div>

          {(() => {
            const summary = summarizeAttendeeImportRows(importRunResult.rows);
            const tiles: { label: string; value: number }[] = [
              { label: "Processed", value: summary.processed },
              { label: "Committed", value: summary.committed },
              { label: "Validation Failed", value: summary.validationFailed },
              { label: "Needs Review", value: summary.needsReview },
              { label: "Commit Failed", value: summary.commitFailed },
              { label: "Warnings", value: summary.warnings },
            ];
            return (
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  marginBottom: 16,
                }}
              >
                {tiles.map((tile) => (
                  <div
                    key={tile.label}
                    style={{ padding: 12, border: "1px solid #ddd", borderRadius: 10 }}
                  >
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{tile.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>{tile.value}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={tableHeadStyle}>Row</th>
                  <th style={tableHeadStyle}>Entry ID</th>
                  <th style={tableHeadStyle}>Email</th>
                  <th style={tableHeadStyle}>State</th>
                  <th style={tableHeadStyle}>Detail</th>
                  <th style={tableHeadStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {importRunResult.rows.map((row) => {
                  const detail =
                    row.commitError?.message ||
                    row.issues.map((issue) => issue.message).join("; ") ||
                    "—";
                  return (
                    <tr key={row.rowId}>
                      <td style={tableCellStyle}>{row.sourceRowNumber || "—"}</td>
                      <td style={tableCellStyle}>
                        {row.candidate?.registration?.entry_id || "—"}
                      </td>
                      <td style={tableCellStyle}>
                        {row.candidate?.registration?.email || "—"}
                      </td>
                      <td style={tableCellStyle}>{row.rowState}</td>
                      <td style={tableCellStyle}>{detail}</td>
                      <td style={tableCellStyle}>
                        {row.rowState === "commit_failed" ? (
                          <button
                            type="button"
                            onClick={() => void handleRetryImportRow(row)}
                            disabled={retryingRowId === row.rowId}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 8,
                              border: "1px solid #ccc",
                              background: "white",
                              cursor: "pointer",
                              opacity: retryingRowId === row.rowId ? 0.6 : 1,
                            }}
                          >
                            {retryingRowId === row.rowId ? "Retrying..." : "Retry"}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

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
                background: "#ffffff",
                color: "#111827",
                WebkitTextFillColor: "#111827",
                fontWeight: 700,
                lineHeight: 1.2,
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
                    <th style={tableHeadStyle}>Event Scope</th>
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
                        {row.participant_type === "vendor"
                          ? row.vendor_assigned_event_id ===
                            selectedImportEventId
                            ? "Assigned to this event"
                            : "Vendor library only"
                          : "This event"}
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

const darkButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "#ffffff",
  WebkitTextFillColor: "#ffffff",
  fontWeight: 700,
  lineHeight: 1.2,
  cursor: "pointer",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "white",
  color: "#111827",
  WebkitTextFillColor: "#111827",
  boxSizing: "border-box",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "#ffffff",
  color: "#111827",
  WebkitTextFillColor: "#111827",
  fontWeight: 700,
  lineHeight: 1.2,
  cursor: "pointer",
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
