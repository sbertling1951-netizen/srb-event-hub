"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
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
  primary_phone?: string | null;
  cell_phone?: string | null;
  nickname: string | null;
  copilot_nickname: string | null;
  membership_number: string | null;
  city: string | null;
  state: string | null;
  assigned_site: string | null;
  has_arrived: boolean | null;
  is_first_timer: boolean | null;
  wants_to_volunteer: boolean | null;
  share_with_attendees?: boolean | null;
  participant_type?: string | null;
  notes?: string | null;
  source_type?: string | null;
  is_active: boolean;
  data_status?: string | null;
  created_at?: string | null;
};

type ReviewSeverity = "error" | "warning";

type ReviewFieldIssue = {
  field: string;
  issue: string;
  severity: ReviewSeverity;
};

type ReviewItem = {
  id: string;
  attendee: AttendeeRow;
  issues: ReviewFieldIssue[];
  severity: ReviewSeverity;
};
type AttendeeEditorState = {
  id: string | null;
  pilot_first: string;
  pilot_last: string;
  copilot_first: string;
  copilot_last: string;
  email: string;
  membership_number: string;
  city: string;
  state: string;
  assigned_site: string;
  participant_type: string;
  primary_phone: string;
  cell_phone: string;
  wants_to_volunteer: boolean;
  is_first_timer: boolean;
  has_arrived: boolean;
  share_with_attendees: boolean;
  is_active: boolean;
  data_status: string;
  entry_id: string;
  notes: string;
};

type ValidationRule = {
  id: string;
  field_name: string;
  rule_type: string;
  rule_value: string | null;
  message: string;
  severity: ReviewSeverity;
  is_active: boolean;
  priority: number;
  applies_to_event_id: string | null;
};

function ruleAppliesToEvent(rule: ValidationRule, eventId?: string | null) {
  if (!rule.is_active) return false;
  if (!rule.applies_to_event_id) return true;
  return rule.applies_to_event_id === eventId;
}

function validateField(
  fieldName: string,
  value: string | null | undefined,
  rules: ValidationRule[],
  eventId?: string | null,
): { issue: string; severity: ReviewSeverity } | null {
  const normalizedValue = String(value || "").trim();
  const activeRules = rules
    .filter((rule) => rule.field_name === fieldName)
    .filter((rule) => ruleAppliesToEvent(rule, eventId))
    .sort((a, b) => a.priority - b.priority);

  for (const rule of activeRules) {
    const ruleValue = String(rule.rule_value || "").trim();

    if (rule.rule_type === "required") {
      if (!normalizedValue) {
        return {
          issue: rule.message,
          severity: rule.severity,
        };
      }
    }

    if (rule.rule_type === "starts_with") {
      if (!normalizedValue.startsWith(ruleValue)) {
        return {
          issue: rule.message,
          severity: rule.severity,
        };
      }
    }
    if (rule.rule_type === "starts_with_any") {
      const allowed = ruleValue
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

      if (!allowed.some((prefix) => normalizedValue.startsWith(prefix))) {
        return {
          issue: rule.message,
          severity: rule.severity,
        };
      }
    }

    if (rule.rule_type === "contains") {
      if (!normalizedValue.includes(ruleValue)) {
        return {
          issue: rule.message,
          severity: rule.severity,
        };
      }
    }

    if (rule.rule_type === "min_length") {
      const minLength = Number(ruleValue);
      if (Number.isFinite(minLength) && normalizedValue.length < minLength) {
        return {
          issue: rule.message,
          severity: rule.severity,
        };
      }
    }
  }

  return null;
}

type PageSize = "10" | "25" | "50" | "100" | "all";

type DataStatusFilter = "all" | "pending" | "corrected" | "reviewed" | "locked";

type ParticipantTypeFilter =
  | "all"
  | "attendee"
  | "vendor"
  | "staff"
  | "speaker"
  | "volunteer"
  | "event_host";

function emptyAttendeeEditorState(): AttendeeEditorState {
  return {
    id: null,
    pilot_first: "",
    pilot_last: "",
    copilot_first: "",
    copilot_last: "",
    email: "",
    membership_number: "",
    city: "",
    state: "",
    assigned_site: "",
    participant_type: "attendee",
    primary_phone: "",
    cell_phone: "",
    wants_to_volunteer: false,
    is_first_timer: false,
    has_arrived: false,
    share_with_attendees: false,
    is_active: true,
    data_status: "pending",
    entry_id: "",
    notes: "",
  };
}

function attendeeToEditorState(attendee: AttendeeRow): AttendeeEditorState {
  return {
    id: attendee.id,
    pilot_first: attendee.pilot_first || "",
    pilot_last: attendee.pilot_last || "",
    copilot_first: attendee.copilot_first || "",
    copilot_last: attendee.copilot_last || "",
    email: attendee.email || "",
    membership_number: attendee.membership_number || "",
    city: attendee.city || "",
    state: attendee.state || "",
    assigned_site: attendee.assigned_site || "",
    participant_type: attendee.participant_type || "attendee",
    primary_phone: attendee.primary_phone || "",
    cell_phone: attendee.cell_phone || "",
    wants_to_volunteer: !!attendee.wants_to_volunteer,
    is_first_timer: !!attendee.is_first_timer,
    has_arrived: !!attendee.has_arrived,
    share_with_attendees: !!attendee.share_with_attendees,
    is_active: attendee.is_active,
    data_status: attendee.data_status || "pending",
    entry_id: attendee.entry_id || "",
    notes: attendee.notes || "",
  };
}

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

function displayPilotName(row: AttendeeRow) {
  return fullName(row.pilot_first, row.pilot_last) || "Unnamed";
}

function displayCopilotName(row: AttendeeRow) {
  return fullName(row.copilot_first, row.copilot_last);
}

function cityState(row: AttendeeRow) {
  return [row.city, row.state].filter(Boolean).join(", ");
}

function normalizeMemberNumber(value?: string | null) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function attendeeMatchesSearch(row: AttendeeRow, term: string) {
  if (!term) return true;

  const haystack = [
    row.pilot_first,
    row.pilot_last,
    row.copilot_first,
    row.copilot_last,
    row.email,
    row.membership_number,
    row.assigned_site,
    row.city,
    row.state,
    row.entry_id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(term);
}

function formatDateRange(
  startDate?: string | null,
  endDate?: string | null,
): string {
  if (!startDate && !endDate) return "";
  if (startDate && endDate) return `${startDate} – ${endDate}`;
  return startDate || endDate || "";
}

function participantTypeLabel(value?: string | null) {
  if (!value) return "Attendee";

  const map: Record<string, string> = {
    attendee: "Attendee",
    vendor: "Vendor",
    staff: "Staff",
    speaker: "Speaker",
    volunteer: "Volunteer",
    event_host: "Event Host",
  };

  return map[value] || value.replace(/_/g, " ");
}

function participantTypeBadgeStyle(value?: string | null): CSSProperties {
  switch (value) {
    case "vendor":
      return {
        display: "inline-block",
        padding: "3px 8px",
        borderRadius: 999,
        background: "#ede9fe",
        color: "#5b21b6",
        fontSize: 12,
        fontWeight: 700,
      };
    case "staff":
      return {
        display: "inline-block",
        padding: "3px 8px",
        borderRadius: 999,
        background: "#dcfce7",
        color: "#166534",
        fontSize: 12,
        fontWeight: 700,
      };
    case "speaker":
      return {
        display: "inline-block",
        padding: "3px 8px",
        borderRadius: 999,
        background: "#dbeafe",
        color: "#1d4ed8",
        fontSize: 12,
        fontWeight: 700,
      };
    case "volunteer":
      return {
        display: "inline-block",
        padding: "3px 8px",
        borderRadius: 999,
        background: "#fef3c7",
        color: "#92400e",
        fontSize: 12,
        fontWeight: 700,
      };
    case "event_host":
      return {
        display: "inline-block",
        padding: "3px 8px",
        borderRadius: 999,
        background: "#fee2e2",
        color: "#991b1b",
        fontSize: 12,
        fontWeight: 700,
      };
    default:
      return {
        display: "inline-block",
        padding: "3px 8px",
        borderRadius: 999,
        background: "#e5e7eb",
        color: "#374151",
        fontSize: 12,
        fontWeight: 700,
      };
  }
}
function reviewFieldLabel(field: string) {
  const map: Record<string, string> = {
    membership_number: "Membership Number",
    email: "Email",
    assigned_site: "Assigned Site",
    pilot_first: "Pilot First",
    pilot_last: "Pilot Last",
    city: "City",
    state: "State",
  };

  return map[field] || field.replace(/_/g, " ");
}

function sortReviewItems(items: ReviewItem[]) {
  return [...items].sort((a, b) => {
    const aLast = String(a.attendee.pilot_last || "")
      .trim()
      .toLowerCase();
    const bLast = String(b.attendee.pilot_last || "")
      .trim()
      .toLowerCase();
    const aFirst = String(a.attendee.pilot_first || "")
      .trim()
      .toLowerCase();
    const bFirst = String(b.attendee.pilot_first || "")
      .trim()
      .toLowerCase();

    return (
      aLast.localeCompare(bLast, undefined, { sensitivity: "base" }) ||
      aFirst.localeCompare(bFirst, undefined, { sensitivity: "base" }) ||
      String(a.issues[0]?.issue || "").localeCompare(
        String(b.issues[0]?.issue || ""),
        undefined,
        { sensitivity: "base" },
      )
    );
  });
}

function AdminDataReviewPageInner() {
  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading review queue...");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState<PageSize>("25");
  const [dataStatusFilter, setDataStatusFilter] =
    useState<DataStatusFilter>("all");
  const [participantTypeFilter, setParticipantTypeFilter] =
    useState<ParticipantTypeFilter>("all");
  const [showResolvedInfo, setShowResolvedInfo] = useState(true);
  const [rules, setRules] = useState<ValidationRule[]>([]);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editorState, setEditorState] = useState<AttendeeEditorState>(
    emptyAttendeeEditorState(),
  );
  const [editorSaving, setEditorSaving] = useState(false);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setAccessDenied(false);
      setError(null);
      setStatus("Checking admin access...");

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setCurrentEvent(null);
        setAttendees([]);
        setAccessDenied(true);
        setError("No admin access.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      if (
        !hasPermission(admin, "can_edit_attendees") &&
        !hasPermission(admin, "can_manage_imports")
      ) {
        setCurrentEvent(null);
        setAttendees([]);
        setAccessDenied(true);
        setError("You do not have permission to use Data Review.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      const event = getStoredAdminEvent();

      if (!event?.id) {
        setCurrentEvent(null);
        setAttendees([]);
        setStatus("No admin event selected.");
        setLoading(false);
        return;
      }

      if (!canAccessEvent(admin, event.id)) {
        setCurrentEvent(null);
        setAttendees([]);
        setAccessDenied(true);
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      setCurrentEvent(event);
      await loadQueue(event.id);
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

  async function loadQueue(eventId: string) {
    try {
      setLoading(true);
      setError(null);
      setStatus("Loading review queue...");

      const [
        { data: attendeeData, error: attendeeError },
        { data: rulesData, error: rulesError },
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
        primary_phone,
        cell_phone,
        nickname,
        copilot_nickname,
        membership_number,
        city,
        state,
        assigned_site,
        has_arrived,
        is_first_timer,
        wants_to_volunteer,
        share_with_attendees,
        participant_type,
        notes,
        source_type,
        is_active,
        data_status,
        created_at
      `,
          )
          .eq("event_id", eventId)
          .order("pilot_last", { ascending: true })
          .order("pilot_first", { ascending: true }),

        supabase
          .from("validation_rules")
          .select("*")
          .order("priority", { ascending: true })
          .order("created_at", { ascending: true }),
      ]);

      if (attendeeError) throw attendeeError;
      if (rulesError) throw rulesError;

      const nextAttendees = (attendeeData || []) as AttendeeRow[];
      const nextRules = (rulesData || []) as ValidationRule[];

      setAttendees(nextAttendees);
      setRules(nextRules);
      setStatus(
        `Loaded ${nextAttendees.length} attendees and ${nextRules.length} validation rules.`,
      );
    } catch (err: any) {
      console.error("loadQueue error:", err);
      setError(err?.message || "Could not load data review queue.");
      setStatus("Could not load data review queue.");
      setAttendees([]);
    } finally {
      setLoading(false);
    }
  }

  function showFlash(message: string) {
    setFlashMessage(message);
    window.setTimeout(() => {
      setFlashMessage((current) => (current === message ? null : current));
    }, 1800);
  }

  function updateDraft(attendeeId: string, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [attendeeId]: value.toUpperCase(),
    }));
  }

  const reviewItems = useMemo(() => {
    const fieldsToCheck: Array<keyof AttendeeRow> = [
      "membership_number",
      "email",
      "assigned_site",
      "pilot_first",
      "pilot_last",
      "city",
      "state",
    ];

    return attendees.flatMap((attendee) => {
      const issues = fieldsToCheck.flatMap((field) => {
        const result = validateField(
          field,
          attendee[field] as string | null | undefined,
          rules,
          currentEvent?.id || null,
        );

        if (!result) return [];

        return [
          {
            field,
            issue: result.issue,
            severity: result.severity,
          } satisfies ReviewFieldIssue,
        ];
      });

      if (!issues.length) return [];

      const severity: ReviewSeverity = issues.some(
        (issue) => issue.severity === "error",
      )
        ? "error"
        : "warning";

      return [
        {
          id: attendee.id,
          attendee,
          issues,
          severity,
        } satisfies ReviewItem,
      ];
    });
  }, [attendees, rules, currentEvent?.id]);

  const filteredReviewItems = useMemo(() => {
    const term = search.trim().toLowerCase();

    return sortReviewItems(
      reviewItems.filter((item) => {
        const matchesSearch = attendeeMatchesSearch(item.attendee, term);
        const status = dataStatusLabel(item.attendee.data_status);
        const matchesStatus =
          dataStatusFilter === "all" ? true : status === dataStatusFilter;
        const participantType = (item.attendee.participant_type ||
          "attendee") as ParticipantTypeFilter;
        const matchesParticipantType =
          participantTypeFilter === "all"
            ? true
            : participantType === participantTypeFilter;

        return matchesSearch && matchesStatus && matchesParticipantType;
      }),
    );
  }, [reviewItems, search, dataStatusFilter, participantTypeFilter]);

  const visibleReviewItems = useMemo(() => {
    if (pageSize === "all") return filteredReviewItems;
    return filteredReviewItems.slice(0, Number(pageSize));
  }, [filteredReviewItems, pageSize]);

  const correctedCount = useMemo(() => {
    return attendees.filter((row) => {
      const validation = validateField(
        "membership_number",
        row.membership_number,
        rules,
        currentEvent?.id || null,
      );

      // If no validation error, it's considered valid
      return !validation;
    }).length;
  }, [attendees, rules, currentEvent?.id]);

  async function saveMembershipNumber(item: ReviewItem) {
    const draftValue = normalizeMemberNumber(
      drafts[item.attendee.id] ?? item.attendee.membership_number,
    );

    if (!draftValue) {
      setError("Membership number cannot be blank.");
      return;
    }

    if (!(draftValue.startsWith("F") || draftValue.startsWith("C"))) {
      setError("Membership number must begin with F or C.");
      return;
    }

    try {
      setSavingRowId(item.attendee.id);
      setError(null);
      setStatus(`Saving correction for ${displayPilotName(item.attendee)}...`);

      const { error: attendeeError } = await supabase
        .from("attendees")
        .update({
          membership_number: draftValue,
          data_status: "corrected",
        })
        .eq("id", item.attendee.id);

      if (attendeeError) throw attendeeError;

      if (currentEvent?.id) {
        const { data: importRows, error: importLookupError } = await supabase
          .from("event_import_rows")
          .select("id, raw_import, entry_id, email")
          .eq("event_id", currentEvent.id)
          .eq("import_type", "attendee_roster");

        if (importLookupError) throw importLookupError;

        const matchingImportRow = (importRows || []).find((row: any) => {
          const sameEntryId =
            !!item.attendee.entry_id && row.entry_id === item.attendee.entry_id;
          const sameEmail =
            !!item.attendee.email && row.email === item.attendee.email;
          return sameEntryId || sameEmail;
        });

        if (matchingImportRow) {
          const nextRawImport = {
            ...(matchingImportRow.raw_import || {}),
            "FCOC Membership Number": draftValue,
          };

          const { error: importUpdateError } = await supabase
            .from("event_import_rows")
            .update({
              membership_number: draftValue,
              raw_import: nextRawImport,
            })
            .eq("id", matchingImportRow.id);

          if (importUpdateError) throw importUpdateError;
        }
      }

      setAttendees((prev) =>
        prev.map((row) =>
          row.id === item.attendee.id
            ? {
                ...row,
                membership_number: draftValue,
                data_status: "corrected",
              }
            : row,
        ),
      );

      setDrafts((prev) => {
        const next = { ...prev };
        delete next[item.attendee.id];
        return next;
      });

      setStatus(`Saved correction for ${displayPilotName(item.attendee)}.`);
      showFlash("Membership number saved.");
    } catch (err: any) {
      console.error("saveMembershipNumber error:", err);
      setError(err?.message || "Could not save membership number.");
      setStatus("Save failed.");
    } finally {
      setSavingRowId(null);
    }
  }
  async function updateDataStatus(attendeeId: string, nextStatus: string) {
    try {
      setError(null);
      setStatus(`Updating attendee status to ${nextStatus}...`);

      const { error: attendeeError } = await supabase
        .from("attendees")
        .update({ data_status: nextStatus })
        .eq("id", attendeeId);

      if (attendeeError) throw attendeeError;

      setAttendees((prev) =>
        prev.map((row) =>
          row.id === attendeeId
            ? {
                ...row,
                data_status: nextStatus,
              }
            : row,
        ),
      );

      setStatus(`Attendee status updated to ${nextStatus}.`);
      showFlash(`Status set to ${nextStatus}.`);
    } catch (err: any) {
      console.error("updateDataStatus error:", err);
      setError(err?.message || "Could not update attendee status.");
      setStatus("Status update failed.");
    }
  }

  function dataStatusLabel(value?: string | null) {
    if (!value) return "pending";
    switch (value) {
      case "pending":
        return "pending";
      case "reviewed":
        return "reviewed";
      case "corrected":
        return "corrected";
      case "locked":
        return "locked";
      default:
        return value;
    }
  }

  function openCreateAttendeeEditor() {
    setEditorMode("create");
    setEditorState(emptyAttendeeEditorState());
    setEditorOpen(true);
  }

  function openEditAttendeeEditor(attendee: AttendeeRow) {
    setEditorMode("edit");
    setEditorState(attendeeToEditorState(attendee));
    setEditorOpen(true);
  }

  function closeAttendeeEditor() {
    setEditorOpen(false);
    setEditorMode("create");
    setEditorState(emptyAttendeeEditorState());
  }

  function updateEditorField<K extends keyof AttendeeEditorState>(
    key: K,
    value: AttendeeEditorState[K],
  ) {
    setEditorState((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  async function handleSaveAttendeeRecord() {
    if (!currentEvent?.id) {
      setError("No event selected.");
      return;
    }

    const pilotFirst = editorState.pilot_first.trim();
    const pilotLast = editorState.pilot_last.trim();
    const email = editorState.email.trim().toLowerCase();
    const membershipNumber = editorState.membership_number.trim().toUpperCase();

    if (!pilotFirst && !pilotLast) {
      setError("Pilot first or last name is required.");
      return;
    }

    try {
      setEditorSaving(true);
      setError(null);
      setStatus(
        editorMode === "create"
          ? "Creating attendee record..."
          : "Saving attendee record...",
      );

      const payload = {
        event_id: currentEvent.id,
        entry_id: editorState.entry_id.trim() || null,
        pilot_first: pilotFirst || null,
        pilot_last: pilotLast || null,
        copilot_first: editorState.copilot_first.trim() || null,
        copilot_last: editorState.copilot_last.trim() || null,
        email: email || null,
        membership_number: membershipNumber || null,
        city: editorState.city.trim() || null,
        state: editorState.state.trim() || null,
        assigned_site: editorState.assigned_site.trim() || null,
        participant_type: editorState.participant_type.trim() || "attendee",
        primary_phone: editorState.primary_phone.trim() || null,
        cell_phone: editorState.cell_phone.trim() || null,
        wants_to_volunteer: editorState.wants_to_volunteer,
        is_first_timer: editorState.is_first_timer,
        has_arrived: editorState.has_arrived,
        share_with_attendees: editorState.share_with_attendees,
        is_active: editorState.is_active,
        data_status: editorState.data_status || "pending",
        notes: editorState.notes.trim() || null,
      };

      if (editorMode === "create") {
        const { error: insertError } = await supabase
          .from("attendees")
          .insert(payload);

        if (insertError) throw insertError;

        showFlash("Attendee record created.");
      } else {
        const { error: updateError } = await supabase
          .from("attendees")
          .update(payload)
          .eq("id", editorState.id);

        if (updateError) throw updateError;

        showFlash("Attendee record updated.");
      }

      closeAttendeeEditor();
      await loadQueue(currentEvent.id);
    } catch (err: any) {
      console.error("handleSaveAttendeeRecord error:", err);
      setError(err?.message || "Could not save attendee record.");
      setStatus("Save failed.");
    } finally {
      setEditorSaving(false);
    }
  }

  if (!loading && accessDenied) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Data Review</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          You do not have access to this page.
        </div>
      </div>
    );
  }

  const eventName =
    currentEvent?.name || currentEvent?.eventName || "No event selected";
  const eventLocation = currentEvent?.location || "";
  const eventDates = formatDateRange(
    currentEvent?.start_date,
    currentEvent?.end_date,
  );

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Data Review</h1>

        <div style={{ fontSize: 14, opacity: 0.8 }}>
          {eventName}
          {eventLocation ? ` • ${eventLocation}` : ""}
          {eventDates ? ` • ${eventDates}` : ""}
        </div>

        <div style={{ marginTop: 12, fontSize: 14 }}>{status}</div>

        {flashMessage ? (
          <div style={successBoxStyle}>{flashMessage}</div>
        ) : null}
        {error ? <div style={errorBoxStyle}>{error}</div> : null}

        <div
          style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}
        >
          <button
            type="button"
            onClick={openCreateAttendeeEditor}
            style={primaryButtonStyle}
          >
            Add Attendee Record
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        }}
      >
        <div className="card" style={summaryCardStyle}>
          <strong>Flagged</strong>
          <div style={summaryValueStyle}>{reviewItems.length}</div>
        </div>

        <div className="card" style={summaryCardStyle}>
          <strong>Visible</strong>
          <div style={summaryValueStyle}>{filteredReviewItems.length}</div>
        </div>

        <div className="card" style={summaryCardStyle}>
          <strong>Total Attendees</strong>
          <div style={summaryValueStyle}>{attendees.length}</div>
        </div>

        <div className="card" style={summaryCardStyle}>
          <strong>Membership Valid</strong>{" "}
          <div style={summaryValueStyle}>{correctedCount}</div>
        </div>

        <div className="card" style={summaryCardStyle}>
          <strong>Pending</strong>
          <div style={summaryValueStyle}>
            {
              attendees.filter(
                (row) => dataStatusLabel(row.data_status) === "pending",
              ).length
            }
          </div>
        </div>

        <div className="card" style={summaryCardStyle}>
          <strong>Corrected</strong>
          <div style={summaryValueStyle}>
            {
              attendees.filter(
                (row) => dataStatusLabel(row.data_status) === "corrected",
              ).length
            }
          </div>
        </div>

        <div className="card" style={summaryCardStyle}>
          <strong>Reviewed</strong>
          <div style={summaryValueStyle}>
            {
              attendees.filter(
                (row) => dataStatusLabel(row.data_status) === "reviewed",
              ).length
            }
          </div>
        </div>

        <div className="card" style={summaryCardStyle}>
          <strong>Locked</strong>
          <div style={summaryValueStyle}>
            {
              attendees.filter(
                (row) => dataStatusLabel(row.data_status) === "locked",
              ).length
            }
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns:
              "minmax(260px, 1.5fr) minmax(220px, 220px) minmax(220px, 220px) minmax(220px, 220px) auto",
            alignItems: "end",
          }}
        >
          <div>
            <label style={labelStyle}>Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, member #, site..."
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Rows to Show</label>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(e.target.value as PageSize)}
              style={inputStyle}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="all">Entire List</option>
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
            <label style={labelStyle}>Participant Type</label>
            <select
              value={participantTypeFilter}
              onChange={(e) =>
                setParticipantTypeFilter(
                  e.target.value as ParticipantTypeFilter,
                )
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

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={showResolvedInfo}
                onChange={(e) => setShowResolvedInfo(e.target.checked)}
              />
              Show auto-resolve note
            </label>
          </div>
        </div>

        {showResolvedInfo ? (
          <div style={infoBoxStyle}>
            Once a membership number is corrected so it begins with{" "}
            <strong>F or C</strong>, it automatically drops out of this queue.
          </div>
        ) : null}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div style={{ marginBottom: 14 }}>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>Review Queue</h2>
          <div style={{ fontSize: 14, opacity: 0.8 }}>
            Showing {visibleReviewItems.length} of {filteredReviewItems.length}{" "}
            flagged attendee{filteredReviewItems.length === 1 ? "" : "s"} •
            Status filter:{" "}
            {dataStatusFilter === "all"
              ? "All Statuses"
              : dataStatusLabel(dataStatusFilter)}{" "}
            • Participant type:{" "}
            {participantTypeFilter === "all"
              ? "All Types"
              : participantTypeLabel(participantTypeFilter)}
          </div>
        </div>

        {loading ? (
          <div>Loading...</div>
        ) : filteredReviewItems.length === 0 ? (
          <div style={{ opacity: 0.8 }}>
            No flagged records for this event.{" "}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {visibleReviewItems.map((item) => {
              const attendee = item.attendee;
              const draftValue =
                drafts[attendee.id] ??
                normalizeMemberNumber(attendee.membership_number);
              const saving = savingRowId === attendee.id;

              return (
                <div
                  key={attendee.id}
                  style={{
                    border: "1px solid #fca5a5",
                    background: "#fef2f2",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                      marginBottom: 10,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 16 }}>
                        {displayPilotName(attendee)}
                        {displayCopilotName(attendee)
                          ? ` / ${displayCopilotName(attendee)}`
                          : ""}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                          alignItems: "center",
                          fontSize: 13,
                          color: "#555",
                          marginTop: 4,
                        }}
                      >
                        <span
                          style={participantTypeBadgeStyle(
                            attendee.participant_type,
                          )}
                        >
                          {participantTypeLabel(attendee.participant_type)}
                        </span>
                        {attendee.email ? <span>{attendee.email}</span> : null}
                        {attendee.assigned_site ? (
                          <span>{`Site ${attendee.assigned_site}`}</span>
                        ) : null}
                        {cityState(attendee) ? (
                          <span>{cityState(attendee)}</span>
                        ) : null}
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        padding: "4px 8px",
                        borderRadius: 999,
                        background: "#fee2e2",
                        color: "#991b1b",
                        alignSelf: "start",
                      }}
                    >
                      {item.severity.toUpperCase()}
                    </div>
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <div
                      style={{
                        marginBottom: 6,
                        fontSize: 14,
                        fontWeight: 700,
                        color:
                          item.severity === "error" ? "#991b1b" : "#92400e",
                      }}
                    >
                      {item.issues.length} issue
                      {item.issues.length === 1 ? "" : "s"} found
                    </div>

                    <div style={{ display: "grid", gap: 6 }}>
                      {item.issues.map((issue, index) => (
                        <div
                          key={`${attendee.id}-${issue.field}-${index}`}
                          style={{
                            fontSize: 14,
                            color:
                              issue.severity === "error"
                                ? "#991b1b"
                                : "#92400e",
                          }}
                        >
                          <strong>{reviewFieldLabel(issue.field)}:</strong>{" "}
                          {issue.issue}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gap: 12,
                      gridTemplateColumns: "minmax(220px, 1fr) auto",
                      alignItems: "end",
                    }}
                  >
                    <div>
                      <label style={labelStyle}>Correct Member Number</label>
                      <input
                        value={draftValue}
                        onChange={(e) =>
                          updateDraft(attendee.id, e.target.value)
                        }
                        placeholder="Must begin with F"
                        style={inputStyle}
                        disabled={saving}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => void saveMembershipNumber(item)}
                      style={primaryButtonStyle}
                      disabled={saving}
                    >
                      {saving ? "Saving..." : "Save Correction"}
                    </button>
                  </div>

                  <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
                    Current stored value:{" "}
                    <strong>{attendee.membership_number || "—"}</strong>
                    {attendee.entry_id
                      ? ` • Entry ID: ${attendee.entry_id}`
                      : ""}
                    {attendee.source_type
                      ? ` • Source: ${attendee.source_type}`
                      : ""}
                    {` • Data Status: ${dataStatusLabel(attendee.data_status)}`}
                  </div>

                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => openEditAttendeeEditor(attendee)}
                      style={secondaryButtonStyle}
                    >
                      Edit Record
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void updateDataStatus(attendee.id, "reviewed")
                      }
                      style={secondaryButtonStyle}
                    >
                      Mark Reviewed
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void updateDataStatus(attendee.id, "locked")
                      }
                      style={secondaryButtonStyle}
                    >
                      Lock Record
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void updateDataStatus(attendee.id, "pending")
                      }
                      style={secondaryButtonStyle}
                    >
                      Back To Pending
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {editorOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 2000,
          }}
        >
          <div
            className="card"
            style={{
              width: "min(980px, 100%)",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: 18,
              background: "white",
              borderRadius: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <div>
                <h2 style={{ marginTop: 0, marginBottom: 6 }}>
                  {editorMode === "create"
                    ? "Add Attendee Record"
                    : "Edit Attendee Record"}
                </h2>
                <div style={{ fontSize: 14, opacity: 0.8 }}>
                  {editorMode === "create"
                    ? "Create a new attendee manually."
                    : "Update this attendee record."}
                </div>
              </div>

              <button
                type="button"
                onClick={closeAttendeeEditor}
                style={secondaryButtonStyle}
                disabled={editorSaving}
              >
                Close
              </button>
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
                  value={editorState.pilot_first}
                  onChange={(e) =>
                    updateEditorField("pilot_first", e.target.value)
                  }
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Pilot Last</label>
                <input
                  value={editorState.pilot_last}
                  onChange={(e) =>
                    updateEditorField("pilot_last", e.target.value)
                  }
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Co-Pilot First</label>
                <input
                  value={editorState.copilot_first}
                  onChange={(e) =>
                    updateEditorField("copilot_first", e.target.value)
                  }
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Co-Pilot Last</label>
                <input
                  value={editorState.copilot_last}
                  onChange={(e) =>
                    updateEditorField("copilot_last", e.target.value)
                  }
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Email</label>
                <input
                  value={editorState.email}
                  onChange={(e) => updateEditorField("email", e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Membership Number</label>
                <input
                  value={editorState.membership_number}
                  onChange={(e) =>
                    updateEditorField(
                      "membership_number",
                      e.target.value.toUpperCase(),
                    )
                  }
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>City</label>
                <input
                  value={editorState.city}
                  onChange={(e) => updateEditorField("city", e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>State</label>
                <input
                  value={editorState.state}
                  onChange={(e) => updateEditorField("state", e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Assigned Site</label>
                <input
                  value={editorState.assigned_site}
                  onChange={(e) =>
                    updateEditorField("assigned_site", e.target.value)
                  }
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Participant Type</label>
                <select
                  value={editorState.participant_type}
                  onChange={(e) =>
                    updateEditorField("participant_type", e.target.value)
                  }
                  style={inputStyle}
                >
                  <option value="attendee">Attendee</option>
                  <option value="vendor">Vendor</option>
                  <option value="staff">Staff</option>
                  <option value="speaker">Speaker</option>
                  <option value="volunteer">Volunteer</option>
                  <option value="event_host">Event Host</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Primary Phone</label>
                <input
                  value={editorState.primary_phone}
                  onChange={(e) =>
                    updateEditorField("primary_phone", e.target.value)
                  }
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Cell Phone</label>
                <input
                  value={editorState.cell_phone}
                  onChange={(e) =>
                    updateEditorField("cell_phone", e.target.value)
                  }
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Entry ID</label>
                <input
                  value={editorState.entry_id}
                  onChange={(e) =>
                    updateEditorField("entry_id", e.target.value)
                  }
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Data Status</label>
                <select
                  value={editorState.data_status}
                  onChange={(e) =>
                    updateEditorField("data_status", e.target.value)
                  }
                  style={inputStyle}
                >
                  <option value="pending">Pending</option>
                  <option value="corrected">Corrected</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="locked">Locked</option>
                </select>
              </div>
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <label style={checkLabelStyle}>
                <input
                  type="checkbox"
                  checked={editorState.wants_to_volunteer}
                  onChange={(e) =>
                    updateEditorField("wants_to_volunteer", e.target.checked)
                  }
                />
                Volunteer
              </label>

              <label style={checkLabelStyle}>
                <input
                  type="checkbox"
                  checked={editorState.is_first_timer}
                  onChange={(e) =>
                    updateEditorField("is_first_timer", e.target.checked)
                  }
                />
                First Timer
              </label>

              <label style={checkLabelStyle}>
                <input
                  type="checkbox"
                  checked={editorState.has_arrived}
                  onChange={(e) =>
                    updateEditorField("has_arrived", e.target.checked)
                  }
                />
                Has Arrived
              </label>

              <label style={checkLabelStyle}>
                <input
                  type="checkbox"
                  checked={editorState.share_with_attendees}
                  onChange={(e) =>
                    updateEditorField("share_with_attendees", e.target.checked)
                  }
                />
                Share With Attendees
              </label>

              <label style={checkLabelStyle}>
                <input
                  type="checkbox"
                  checked={editorState.is_active}
                  onChange={(e) =>
                    updateEditorField("is_active", e.target.checked)
                  }
                />
                Active Record
              </label>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={labelStyle}>Notes</label>
              <textarea
                value={editorState.notes}
                onChange={(e) => updateEditorField("notes", e.target.value)}
                style={textareaStyle}
                rows={4}
              />
            </div>

            <div
              style={{
                marginTop: 18,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => void handleSaveAttendeeRecord()}
                style={primaryButtonStyle}
                disabled={editorSaving}
              >
                {editorSaving
                  ? "Saving..."
                  : editorMode === "create"
                    ? "Create Attendee"
                    : "Save Changes"}
              </button>

              <button
                type="button"
                onClick={closeAttendeeEditor}
                style={secondaryButtonStyle}
                disabled={editorSaving}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
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

const textareaStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "white",
  resize: "vertical",
};

const checkLabelStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
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

const successBoxStyle: CSSProperties = {
  marginTop: 12,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #bbf7d0",
  background: "#f0fdf4",
  color: "#166534",
};

const infoBoxStyle: CSSProperties = {
  marginTop: 14,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#1d4ed8",
  fontSize: 14,
};

const summaryCardStyle: CSSProperties = {
  padding: 16,
};

const summaryValueStyle: CSSProperties = {
  fontSize: 26,
  fontWeight: 800,
  marginTop: 8,
};

export default function AdminDataReviewPage() {
  return (
    <AdminRouteGuard requiredPermission="can_edit_attendees">
      <AdminDataReviewPageInner />
    </AdminRouteGuard>
  );
}
