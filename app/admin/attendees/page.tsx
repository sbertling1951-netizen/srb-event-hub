"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  resolveAdminWorkingEvent,
  setCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
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

type ReviewSeverity = "error" | "warning";

export type AttendeeRow = {
  id: string;
  event_id: string;
  entry_id: string | null;
  email: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  copilot_email?: string | null;
  copilot_cell_phone?: string | null;
  primary_phone?: string | null;
  cell_phone?: string | null;
  nickname: string | null;
  copilot_nickname: string | null;
  membership_number: string | null;
  city: string | null;
  state: string | null;
  assigned_site: string | null;
  participant_capacity?: number | null;
  has_arrived: boolean | null;
  is_first_timer: boolean | null;
  wants_to_volunteer: boolean | null;
  share_with_attendees?: boolean | null;
  participant_type?: string | null;
  coach_manufacturer?: string | null;
  coach_model?: string | null;
  special_events_raw?: string | null;
  include_in_headcount?: boolean | null;
  needs_name_tag?: boolean | null;
  needs_coach_plate?: boolean | null;
  needs_parking?: boolean | null;
  notes?: string | null;
  source_type?: string | null;
  is_active: boolean;
  data_status?: string | null;
  created_at?: string | null;
  registration_status?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancellation_reason?: string | null;
};

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

export type AttendeeEditorState = {
  id: string | null;
  pilot_first: string;
  pilot_last: string;
  copilot_first: string;
  copilot_last: string;
  nickname: string;
  copilot_nickname: string;
  email: string;
  copilot_email: string;
  copilot_cell_phone: string;
  additional_first_name: string;
  additional_last_name: string;
  additional_nickname: string;
  additional_email: string;
  additional_cell_phone: string;
  membership_number: string;
  city: string;
  state: string;
  assigned_site: string;
  participant_type: string;
  registration_capacity: number; // Add registration_capacity after participant_type
  // True when the underlying stored participant_capacity was null when this
  // editor session loaded (or this is a brand-new record) and the
  // administrator has not yet deliberately changed the capacity control.
  // While true, save must leave capacity unknown rather than persisting the
  // stepper's display default.
  registration_capacity_was_unset: boolean;
  // The stored participant_capacity value as loaded (null if unset, or null
  // for a brand-new record). Used only to detect whether the admin is
  // raising capacity above what is currently stored -- never written back
  // directly.
  registration_capacity_original: number | null;
  // Whether a Co-Pilot / Additional Participant household row already
  // existed when this editor session loaded. Used only to distinguish the
  // administrator newly adding that participant this save (which
  // automatically authorizes the resulting capacity, per governed product
  // rule) from an unrelated edit to an already-existing row (which must
  // never silently "fix" a pre-existing roster/capacity mismatch). Not
  // applicable to create mode (always false there).
  had_copilot_at_load: boolean;
  had_additional_at_load: boolean;
  // The Co-Pilot's / Additional Participant's display name as loaded, used
  // only to name them in the removal-confirmation prompt if their fields
  // are cleared before Save -- never written back, never used to infer
  // identity. Empty when no such household member existed at load.
  copilot_name_at_load: string;
  additional_name_at_load: string;
  // Optional operational note attached to a capacity adjustment, if any
  // occurs this save. EpicentraX does not ask how a slot was authorized or
  // record payment information -- this is purely an optional free-text
  // note. Cleared whenever a record is loaded.
  capacity_increase_note: string;
  primary_phone: string;
  cell_phone: string;
  wants_to_volunteer: boolean;
  coach_manufacturer: string;
  coach_model: string;
  special_events_raw: string;
  include_in_headcount: boolean;
  needs_name_tag: boolean;
  needs_coach_plate: boolean;
  needs_parking: boolean;
  is_first_timer: boolean;
  has_arrived: boolean;
  share_with_attendees: boolean;
  is_active: boolean;
  data_status: string;
  entry_id: string;
  source_type?: string | null;
  notes: string;
};

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
type ViewMode = "active" | "review" | "cancelled" | "all";
type AttendeeSortMode = "last_name" | "site";

type SummaryCardItem = {
  label: string;
  value: number;
};

type AttendeeCommandCenterPrefs = {
  search?: string;
  pageSize?: PageSize;
  dataStatusFilter?: DataStatusFilter;
  participantTypeFilter?: ParticipantTypeFilter;
  viewMode?: ViewMode;
  attendeeSortMode?: AttendeeSortMode;
  showResolvedInfo?: boolean;
};

const ATTENDEE_COMMAND_CENTER_PREFS_KEY = "fcoc-attendee-command-center-prefs";

const REVIEW_FIELDS: Array<keyof AttendeeRow> = [
  "membership_number",
  "email",
  "assigned_site",
  "pilot_first",
  "pilot_last",
  "city",
  "state",
];

const DATA_STATUS_OPTIONS: DataStatusFilter[] = [
  "all",
  "pending",
  "corrected",
  "reviewed",
  "locked",
];

const PARTICIPANT_TYPE_OPTIONS: ParticipantTypeFilter[] = [
  "all",
  "attendee",
  "vendor",
  "staff",
  "speaker",
  "volunteer",
  "event_host",
];

const STATUS_LABELS: Record<Exclude<DataStatusFilter, "all">, string> = {
  pending: "Pending",
  corrected: "Corrected",
  reviewed: "Reviewed",
  locked: "Locked",
};

function dataStatusOptionLabel(value: Exclude<DataStatusFilter, "all">) {
  return STATUS_LABELS[value];
}

function ruleAppliesToEvent(rule: ValidationRule, eventId?: string | null) {
  if (!rule.is_active) {
    return false;
  }
  if (!rule.applies_to_event_id) {
    return true;
  }
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

    if (rule.rule_type === "required" && !normalizedValue) {
      return { issue: rule.message, severity: rule.severity };
    }

    if (rule.rule_type === "starts_with") {
      if (
        fieldName === "membership_number" &&
        ruleValue.toUpperCase() === "F"
      ) {
        const upperValue = normalizedValue.toUpperCase();
        if (!upperValue.startsWith("F") && !upperValue.startsWith("C")) {
          return {
            issue: rule.message.replace("F", "F or C"),
            severity: rule.severity,
          };
        }
      } else if (!normalizedValue.startsWith(ruleValue)) {
        return { issue: rule.message, severity: rule.severity };
      }
    }

    if (rule.rule_type === "starts_with_any") {
      const allowed = ruleValue
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

      const allowedForField =
        fieldName === "membership_number" && allowed.includes("F")
          ? Array.from(new Set([...allowed, "C"]))
          : allowed;

      const upperValue = normalizedValue.toUpperCase();
      if (
        !allowedForField.some((prefix) =>
          upperValue.startsWith(prefix.toUpperCase()),
        )
      ) {
        return {
          issue:
            fieldName === "membership_number"
              ? rule.message.replace("F", "F or C")
              : rule.message,
          severity: rule.severity,
        };
      }
    }

    if (rule.rule_type === "contains" && !normalizedValue.includes(ruleValue)) {
      return { issue: rule.message, severity: rule.severity };
    }

    if (rule.rule_type === "min_length") {
      const minLength = Number(ruleValue);
      if (Number.isFinite(minLength) && normalizedValue.length < minLength) {
        return { issue: rule.message, severity: rule.severity };
      }
    }
  }

  return null;
}

export function emptyAttendeeEditorState(): AttendeeEditorState {
  return {
    id: null,
    pilot_first: "",
    pilot_last: "",
    copilot_first: "",
    copilot_last: "",
    nickname: "",
    copilot_nickname: "",
    email: "",
    copilot_email: "",
    copilot_cell_phone: "",
    additional_first_name: "",
    additional_last_name: "",
    additional_nickname: "",
    additional_email: "",
    additional_cell_phone: "",
    membership_number: "",
    city: "",
    state: "",
    assigned_site: "",
    participant_type: "attendee",
    registration_capacity: 1, // initialize to 1
    registration_capacity_was_unset: false,
    registration_capacity_original: null,
    had_copilot_at_load: false,
    had_additional_at_load: false,
    copilot_name_at_load: "",
    additional_name_at_load: "",
    capacity_increase_note: "",
    primary_phone: "",
    cell_phone: "",
    coach_manufacturer: "",
    coach_model: "",
    special_events_raw: "",
    wants_to_volunteer: false,
    is_first_timer: false,
    has_arrived: false,
    share_with_attendees: false,
    is_active: true,
    include_in_headcount: true,
    needs_name_tag: false,
    needs_coach_plate: false,
    needs_parking: false,
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
    nickname: attendee.nickname || "",
    copilot_nickname: attendee.copilot_nickname || "",
    email: attendee.email || "",
    copilot_email: attendee.copilot_email || "",
    copilot_cell_phone: attendee.copilot_cell_phone || "",
    additional_first_name: "",
    additional_last_name: "",
    additional_nickname: "",
    additional_email: "",
    additional_cell_phone: "",
    membership_number: attendee.membership_number || "",
    city: attendee.city || "",
    state: attendee.state || "",
    assigned_site: attendee.assigned_site || "",
    participant_type: attendee.participant_type || "attendee",
    registration_capacity: attendee.participant_capacity ?? 1,
    registration_capacity_was_unset:
      attendee.participant_capacity === null ||
      attendee.participant_capacity === undefined,
    registration_capacity_original: attendee.participant_capacity ?? null,
    // Overwritten immediately after this call in openEditAttendeeEditor,
    // once the actual attendee_household_members rows are known.
    had_copilot_at_load: false,
    had_additional_at_load: false,
    // Overwritten immediately after this call in openEditAttendeeEditor,
    // alongside had_copilot_at_load/had_additional_at_load above.
    copilot_name_at_load: "",
    additional_name_at_load: "",
    capacity_increase_note: "",
    primary_phone: attendee.primary_phone || "",
    cell_phone: attendee.cell_phone || "",
    coach_manufacturer: attendee.coach_manufacturer || "",
    coach_model: attendee.coach_model || "",
    special_events_raw: attendee.special_events_raw || "",
    wants_to_volunteer: !!attendee.wants_to_volunteer,
    is_first_timer: !!attendee.is_first_timer,
    has_arrived: !!attendee.has_arrived,
    share_with_attendees: !!attendee.share_with_attendees,
    is_active: attendee.is_active,
    include_in_headcount: attendee.include_in_headcount ?? true,
    needs_name_tag: !!attendee.needs_name_tag,
    needs_coach_plate: !!attendee.needs_coach_plate,
    needs_parking: !!attendee.needs_parking,
    data_status: attendee.data_status || "pending",
    entry_id: attendee.entry_id || "",
    notes: attendee.notes || "",
  };
}

export type HouseholdRemovalWarning = {
  role: "copilot" | "additional";
  name: string;
};

// Pure decision gate: given the editor's loaded-vs-current household
// state, determines which household-member rows this save would silently
// hard-delete (per syncHouseholdMembers's own clear-the-row-when-empty
// behavior), so the save flow can require explicit confirmation before any
// write occurs rather than deleting a person record because a field was
// cleared. Exported so this decision logic is directly unit-testable
// without needing to drive the full save flow.
export function computeHouseholdRemovalWarnings(
  editorMode: "create" | "edit",
  state: AttendeeEditorState,
): HouseholdRemovalWarning[] {
  if (editorMode !== "edit") {
    return [];
  }

  const hasCopilot =
    state.copilot_first.trim() !== "" ||
    state.copilot_last.trim() !== "" ||
    state.copilot_email.trim() !== "";
  const hasAdditional =
    (state.additional_first_name ?? "").trim() !== "" ||
    (state.additional_last_name ?? "").trim() !== "" ||
    (state.additional_email ?? "").trim() !== "" ||
    (state.additional_nickname ?? "").trim() !== "" ||
    (state.additional_cell_phone ?? "").trim() !== "";

  const warnings: HouseholdRemovalWarning[] = [];

  if (state.had_copilot_at_load && !hasCopilot) {
    warnings.push({
      role: "copilot",
      name: state.copilot_name_at_load || "the Co-Pilot",
    });
  }

  if (state.had_additional_at_load && !hasAdditional) {
    warnings.push({
      role: "additional",
      name: state.additional_name_at_load || "the Additional Participant",
    });
  }

  return warnings;
}

const HOUSEHOLD_ROLE_LABEL: Record<HouseholdRemovalWarning["role"], string> = {
  copilot: "Co-Pilot",
  additional: "Additional Participant",
};

// Builds the exact, specific confirmation prompt for a pending
// household-member removal -- deliberately names who is being removed and
// what will happen, per this task's explicit prohibition on vague
// "Are you sure?" wording.
export function buildHouseholdRemovalConfirmMessage(
  warnings: HouseholdRemovalWarning[],
): string {
  const names = warnings
    .map((w) => `${w.name} (${HOUSEHOLD_ROLE_LABEL[w.role]})`)
    .join(" and ");

  const pronoun = warnings.length === 1 ? "them" : "both";

  return (
    `This save will permanently remove ${names} as a household member on ` +
    `this attendee record, because their information was cleared from the ` +
    `form. This cannot be undone from here.\n\n` +
    `Continue and remove ${pronoun}?`
  );
}

// Normalized event-status helpers
function normalizeEventStatus(status?: string | null) {
  return String(status || "")
    .trim()
    .toLowerCase();
}

function isActiveEventStatus(status?: string | null) {
  const normalized = normalizeEventStatus(status);

  if (!normalized) {
    return false;
  }

  if (
    normalized === "inactive" ||
    normalized === "complete" ||
    normalized === "completed" ||
    normalized === "closed" ||
    normalized === "archived" ||
    normalized === "draft"
  ) {
    return false;
  }

  return (
    normalized === "active" ||
    normalized === "live" ||
    normalized === "open" ||
    normalized === "current" ||
    normalized.includes("active")
  );
}

function getStoredAttendeeCommandCenterPrefs(): AttendeeCommandCenterPrefs {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = localStorage.getItem(ATTENDEE_COMMAND_CENTER_PREFS_KEY);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) as AttendeeCommandCenterPrefs;
  } catch {
    return {};
  }
}

function saveAttendeeCommandCenterPrefs(prefs: AttendeeCommandCenterPrefs) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(
      ATTENDEE_COMMAND_CENTER_PREFS_KEY,
      JSON.stringify(prefs),
    );
  } catch {
    // Ignore localStorage failures so the page continues to work.
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
  if (!term) {
    return true;
  }

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

// Surfaces cancellation metadata the record already stores but the UI
// previously fetched and never displayed. Returns null for a non-cancelled
// record so this never appears outside the one context where it is
// relevant (Know More / Show Less).
export function formatCancellationDetail(
  attendee: Pick<
    AttendeeRow,
    "registration_status" | "cancelled_at" | "cancellation_reason"
  >,
): string | null {
  if (attendee.registration_status !== "cancelled") {
    return null;
  }

  const when = attendee.cancelled_at
    ? new Date(attendee.cancelled_at).toLocaleString()
    : null;

  const parts = [when ? `Cancelled ${when}` : "Cancelled"];

  if (attendee.cancellation_reason) {
    parts.push(attendee.cancellation_reason);
  }

  return parts.join(" — ");
}

function participantTypeLabel(value?: string | null) {
  if (!value) {
    return "Attendee";
  }

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
      return badgeVariant("#ede9fe", "#5b21b6");
    case "staff":
      return badgeVariant("#dcfce7", "#166534");
    case "speaker":
      return badgeVariant("#dbeafe", "#1d4ed8");
    case "volunteer":
      return badgeVariant("#fef3c7", "#92400e");
    case "event_host":
      return badgeVariant("#fee2e2", "#991b1b");
    default:
      return badgeVariant("#e5e7eb", "#374151");
  }
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

function badgeVariant(background: string, color: string): CSSProperties {
  return {
    display: "inline-block",
    padding: "3px 8px",
    borderRadius: 999,
    background,
    color,
    fontSize: 12,
    fontWeight: 700,
  };
}

function SummaryCards({ items }: { items: SummaryCardItem[] }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="card"
          style={{
            ...summaryCardStyle,
            minWidth: 180,
            flex: "0 0 220px",
          }}
        >
          <strong>{item.label}</strong>
          <div style={summaryValueStyle}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function FilterBar(props: {
  search: string;
  setSearch: (value: string) => void;
  viewMode: ViewMode;
  setViewMode: (value: ViewMode) => void;
  pageSize: PageSize;
  setPageSize: (value: PageSize) => void;
  dataStatusFilter: DataStatusFilter;
  setDataStatusFilter: (value: DataStatusFilter) => void;
  participantTypeFilter: ParticipantTypeFilter;
  setParticipantTypeFilter: (value: ParticipantTypeFilter) => void;
  attendeeSortMode: AttendeeSortMode;
  setAttendeeSortMode: (value: AttendeeSortMode) => void;
  showResolvedInfo: boolean;
  setShowResolvedInfo: (value: boolean) => void;
}) {
  const {
    search,
    setSearch,
    viewMode,
    setViewMode,
    pageSize,
    setPageSize,
    dataStatusFilter,
    setDataStatusFilter,
    participantTypeFilter,
    setParticipantTypeFilter,
    attendeeSortMode,
    setAttendeeSortMode,
    showResolvedInfo,
    setShowResolvedInfo,
  } = props;

  return (
    <div
      className="card"
      style={{
        position: "sticky",
        top: 78,
        zIndex: 900,
        padding: 18,
        background: "white",
        border: "1px solid #eee",
        boxShadow: "0 2px 10px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
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
          <label style={labelStyle}>View</label>
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as ViewMode)}
            style={inputStyle}
          >
            <option value="active">Active Registrations</option>
            <option value="review">Flagged Active</option>
            <option value="cancelled">Cancelled Registrations</option>
            <option value="all">All Registrations</option>
          </select>
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
          <label style={labelStyle}>Sort</label>
          <select
            value={attendeeSortMode}
            onChange={(e) =>
              setAttendeeSortMode(e.target.value as AttendeeSortMode)
            }
            style={inputStyle}
          >
            <option value="last_name">A–Z by Last Name</option>
            <option value="site">Group by Site</option>
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
            {DATA_STATUS_OPTIONS.filter((option) => option !== "all").map(
              (option) => (
                <option key={option} value={option}>
                  {dataStatusOptionLabel(option)}
                </option>
              ),
            )}
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
            {PARTICIPANT_TYPE_OPTIONS.filter((option) => option !== "all").map(
              (option) => (
                <option key={option} value={option}>
                  {participantTypeLabel(option)}
                </option>
              ),
            )}
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
          <strong>F or C</strong>, the membership-number issue clears
          automatically. Records stay in the queue until all remaining flagged
          issues are resolved.
        </div>
      ) : null}
    </div>
  );
}

export function QuickActionBar(props: {
  canEdit: boolean;
  onAddAttendee: () => void;
  onSetReviewMode: () => void;
  onSetAllMode: () => void;
  onRefresh: () => void;
}) {
  const { canEdit, onAddAttendee, onSetReviewMode, onSetAllMode, onRefresh } =
    props;

  return (
    <div
      className="card"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1000,
        background: "white",
        padding: 18,
        border: "1px solid #eee",
        boxShadow: "0 2px 10px rgba(15, 23, 42, 0.08)",
      }}
    >
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onAddAttendee}
          style={primaryButtonStyle}
          disabled={!canEdit}
        >
          + Add Attendee
        </button>

        <button
          type="button"
          onClick={onSetReviewMode}
          style={secondaryButtonStyle}
        >
          Flagged Active
        </button>

        <button
          type="button"
          onClick={onSetAllMode}
          style={secondaryButtonStyle}
        >
          All Registrations
        </button>

        <button type="button" onClick={onRefresh} style={secondaryButtonStyle}>
          Refresh
        </button>
      </div>
    </div>
  );
}

// Shared action-button row for one attendee, used identically by both
// ReviewQueue and AttendeeList (previously two independently-drifted
// implementations -- one horizontal-scroll-only, one wrapping). Both
// consumers now share one layout, one responsive behavior, and one
// permission-gating rule. `showBackToPending` and `viewToggle` are the
// only two points of legitimate difference between the two contexts;
// no action was added or removed from either context's existing set.
export function AttendeeActionRow(props: {
  attendee: AttendeeRow;
  canEdit: boolean;
  showBackToPending: boolean;
  viewToggle?: { isExpanded: boolean; onToggle: () => void };
  onOpenEdit: (attendee: AttendeeRow) => void;
  onUpdateDataStatus: (
    attendeeId: string,
    nextStatus: string,
  ) => Promise<void>;
  onCancelRegistration: (attendee: AttendeeRow) => Promise<void>;
}) {
  const {
    attendee,
    canEdit,
    showBackToPending,
    viewToggle,
    onOpenEdit,
    onUpdateDataStatus,
    onCancelRegistration,
  } = props;

  return (
    <div style={actionRowStyle}>
      {viewToggle ? (
        <button
          type="button"
          onClick={viewToggle.onToggle}
          style={secondaryButtonStyle}
        >
          {viewToggle.isExpanded ? "Hide Details" : "View Details"}
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => onOpenEdit(attendee)}
        style={secondaryButtonStyle}
      >
        Edit Record
      </button>

      <button
        type="button"
        disabled={!canEdit}
        onClick={() => void onUpdateDataStatus(attendee.id, "reviewed")}
        style={secondaryButtonStyle}
      >
        Mark Reviewed
      </button>

      <button
        type="button"
        disabled={!canEdit}
        onClick={() => void onCancelRegistration(attendee)}
        style={secondaryButtonStyle}
      >
        Cancel Registration
      </button>

      <button
        type="button"
        disabled={!canEdit}
        onClick={() => void onUpdateDataStatus(attendee.id, "locked")}
        style={secondaryButtonStyle}
      >
        Lock Record
      </button>

      {showBackToPending ? (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => void onUpdateDataStatus(attendee.id, "pending")}
          style={secondaryButtonStyle}
        >
          Back To Pending
        </button>
      ) : null}
    </div>
  );
}

function ReviewQueue(props: {
  loading: boolean;
  canEdit: boolean;
  filteredReviewItems: ReviewItem[];
  visibleReviewItems: ReviewItem[];
  drafts: Record<string, string>;
  savingRowId: string | null;
  dataStatusFilter: DataStatusFilter;
  participantTypeFilter: ParticipantTypeFilter;
  onDraftChange: (attendeeId: string, value: string) => void;
  onSaveMembership: (item: ReviewItem) => Promise<void>;
  onOpenEdit: (attendee: AttendeeRow) => void;
  onUpdateDataStatus: (attendeeId: string, nextStatus: string) => Promise<void>;
  onCancelRegistration: (attendee: AttendeeRow) => Promise<void>;
}) {
  const {
    loading,
    canEdit,
    filteredReviewItems,
    visibleReviewItems,
    drafts,
    savingRowId,
    dataStatusFilter,
    participantTypeFilter,
    onDraftChange,
    onSaveMembership,
    onOpenEdit,
    onUpdateDataStatus,
    onCancelRegistration,
  } = props;

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0, marginBottom: 6 }}>Review Queue</h2>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          Showing {visibleReviewItems.length} of {filteredReviewItems.length}{" "}
          flagged attendee
          {filteredReviewItems.length === 1 ? "" : "s"} • Status filter:{" "}
          {dataStatusFilter === "all"
            ? "All Statuses"
            : dataStatusOptionLabel(dataStatusFilter)}{" "}
          • Participant type:{" "}
          {participantTypeFilter === "all"
            ? "All Types"
            : participantTypeLabel(participantTypeFilter)}
        </div>
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : filteredReviewItems.length === 0 ? (
        <div style={{ opacity: 0.8 }}>No flagged records for this event.</div>
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
                  border:
                    attendee.registration_status === "cancelled"
                      ? "1px solid #d1d5db"
                      : "1px solid #ddd",
                  borderRadius: 12,
                  padding: 14,
                  background:
                    attendee.registration_status === "cancelled"
                      ? "#f5f5f5"
                      : "white",
                  opacity:
                    attendee.registration_status === "cancelled" ? 0.65 : 1,
                  transition: "background 0.2s ease, border-color 0.2s ease",
                }}
              >
                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
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
                      background:
                        item.severity === "error" ? "#fee2e2" : "#fef3c7",
                      color: item.severity === "error" ? "#991b1b" : "#92400e",
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
                      color: item.severity === "error" ? "#991b1b" : "#92400e",
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
                            issue.severity === "error" ? "#991b1b" : "#92400e",
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
                        onDraftChange(attendee.id, e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !saving) {
                          e.preventDefault();
                          void onSaveMembership(item);
                        }
                      }}
                      placeholder="Must begin with F or C"
                      style={inputStyle}
                      disabled={saving || !canEdit}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void onSaveMembership(item)}
                    style={primaryButtonStyle}
                    disabled={saving || !canEdit}
                  >
                    {saving ? "Saving..." : "Save Correction"}
                  </button>
                </div>

                <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
                  Current stored value:{" "}
                  <strong>{attendee.membership_number || "—"}</strong>
                  {attendee.entry_id ? ` • Entry ID: ${attendee.entry_id}` : ""}
                  {attendee.source_type
                    ? ` • Source: ${attendee.source_type}`
                    : ""}
                  {` • Data Status: ${dataStatusLabel(attendee.data_status)}`}
                </div>

                <AttendeeActionRow
                  attendee={attendee}
                  canEdit={canEdit}
                  showBackToPending
                  onOpenEdit={onOpenEdit}
                  onUpdateDataStatus={onUpdateDataStatus}
                  onCancelRegistration={onCancelRegistration}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AttendeeList(props: {
  loading: boolean;
  canEdit: boolean;
  filteredAttendees: AttendeeRow[];
  visibleAttendees: AttendeeRow[];
  reviewItems: ReviewItem[];
  attendeeSortMode: AttendeeSortMode;
  expandedAttendeeId: string | null;
  onToggleExpanded: (attendeeId: string) => void;
  onOpenEdit: (attendee: AttendeeRow) => void;
  onUpdateDataStatus: (attendeeId: string, nextStatus: string) => Promise<void>;
  onCancelRegistration: (attendee: AttendeeRow) => Promise<void>;
}) {
  const {
    loading,
    canEdit,
    filteredAttendees,
    visibleAttendees,
    reviewItems,
    attendeeSortMode,
    expandedAttendeeId,
    onToggleExpanded,
    onOpenEdit,
    onUpdateDataStatus,
    onCancelRegistration,
  } = props;

  const expandedCardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!expandedAttendeeId || !expandedCardRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      expandedCardRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [expandedAttendeeId]);

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0, marginBottom: 6 }}>Attendee List</h2>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          Showing {visibleAttendees.length} of {filteredAttendees.length}{" "}
          attendee
          {filteredAttendees.length === 1 ? "" : "s"}
        </div>
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : visibleAttendees.length === 0 ? (
        <div style={{ opacity: 0.8 }}>
          No attendee records match the current filters.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {visibleAttendees.map((attendee, index) => {
            const attendeeIssues = reviewItems.find(
              (item) => item.attendee.id === attendee.id,
            );
            const isExpanded = expandedAttendeeId === attendee.id;
            const currentSite =
              String(attendee.assigned_site || "Unassigned").trim() ||
              "Unassigned";
            const previousAttendee =
              index > 0 ? visibleAttendees[index - 1] : null;
            const previousSite = previousAttendee
              ? String(previousAttendee.assigned_site || "Unassigned").trim() ||
                "Unassigned"
              : null;
            const showSiteHeader =
              attendeeSortMode === "site" && currentSite !== previousSite;
            const toggleAttendeeDetails = () => onToggleExpanded(attendee.id);

            return (
              <div key={attendee.id} style={{ display: "contents" }}>
                {showSiteHeader ? (
                  <div
                    style={{
                      position: "sticky",
                      top: 160,
                      zIndex: 20,
                      marginTop: index === 0 ? 0 : 8,
                      padding: "8px 10px",
                      borderRadius: 10,
                      background: "#eef2ff",
                      border: "1px solid #c7d2fe",
                      color: "#3730a3",
                      fontWeight: 800,
                      fontSize: 14,
                      boxShadow: "0 2px 8px rgba(15, 23, 42, 0.08)",
                    }}
                  >
                    Site {currentSite}
                  </div>
                ) : null}

                <div
                  key={attendee.id}
                  ref={isExpanded ? expandedCardRef : undefined}
                  style={{
                    border:
                      attendee.registration_status === "cancelled"
                        ? "1px solid #d1d5db"
                        : "1px solid #ddd",
                    borderRadius: 12,
                    padding: 14,
                    background:
                      attendee.registration_status === "cancelled"
                        ? "#fef2f2"
                        : "white",
                    opacity:
                      attendee.registration_status === "cancelled" ? 0.82 : 1,
                    transition: "background 0.2s ease, border-color 0.2s ease",
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={toggleAttendeeDetails}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleAttendeeDetails();
                      }
                    }}
                    title={
                      isExpanded
                        ? "Hide attendee details"
                        : "View attendee details"
                    }
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                      marginBottom: 10,
                      cursor: "pointer",
                      borderRadius: 10,
                      padding: "4px 6px",
                      marginLeft: -6,
                      marginRight: -6,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
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
                          fontSize: 12,
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

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {attendee.registration_status === "cancelled" && (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 8px",
                            borderRadius: 999,
                            background: "#fee2e2",
                            color: "#991b1b",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          Cancelled
                        </span>
                      )}
                      <span style={secondaryBadgeStyle}>
                        {dataStatusLabel(attendee.data_status)}
                      </span>
                      {attendeeIssues ? (
                        <span style={issueBadgeStyle}>
                          {attendeeIssues.issues.length} issue
                          {attendeeIssues.issues.length === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <span style={okBadgeStyle}>OK</span>
                      )}
                    </div>
                  </div>

                  <div onClick={(event) => event.stopPropagation()}>
                    <AttendeeActionRow
                      attendee={attendee}
                      canEdit={canEdit}
                      showBackToPending={false}
                      viewToggle={{
                        isExpanded,
                        onToggle: toggleAttendeeDetails,
                      }}
                      onOpenEdit={onOpenEdit}
                      onUpdateDataStatus={onUpdateDataStatus}
                      onCancelRegistration={onCancelRegistration}
                    />
                  </div>

                  {isExpanded ? (
                    <div
                      style={{
                        marginTop: 12,
                        padding: "12px 14px",
                        borderRadius: 12,
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gap: 10,
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(180px, 1fr))",
                          fontSize: 13,
                        }}
                      >
                        <div>
                          <strong>Membership #</strong>
                          <div>{attendee.membership_number || "—"}</div>
                        </div>
                        <div>
                          <strong>Entry ID</strong>
                          <div>{attendee.entry_id || "—"}</div>
                        </div>
                        <div>
                          <strong>Site</strong>
                          <div>{attendee.assigned_site || "Unassigned"}</div>
                        </div>
                        <div>
                          <strong>City / State</strong>
                          <div>{cityState(attendee) || "—"}</div>
                        </div>
                        <div>
                          <strong>Primary Phone</strong>
                          <div>{attendee.primary_phone || "—"}</div>
                        </div>
                        <div>
                          <strong>Cell Phone</strong>
                          <div>{attendee.cell_phone || "—"}</div>
                        </div>
                        <div>
                          <strong>Coach</strong>
                          <div>
                            {[attendee.coach_manufacturer, attendee.coach_model]
                              .filter(Boolean)
                              .join(" ") || "—"}
                          </div>
                        </div>
                        <div>
                          <strong>Source</strong>
                          <div>{attendee.source_type || "—"}</div>
                        </div>
                        <div>
                          <strong>Headcount</strong>
                          <div>
                            {attendee.include_in_headcount
                              ? "Included"
                              : "Not included"}
                          </div>
                        </div>
                        <div>
                          <strong>Name Tag</strong>
                          <div>
                            {attendee.needs_name_tag ? "Needed" : "Not needed"}
                          </div>
                        </div>
                        <div>
                          <strong>Coach Plate</strong>
                          <div>
                            {attendee.needs_coach_plate
                              ? "Needed"
                              : "Not needed"}
                          </div>
                        </div>
                        <div>
                          <strong>Parking</strong>
                          <div>
                            {attendee.needs_parking ? "Needed" : "Not needed"}
                          </div>
                        </div>
                        <div>
                          <strong>First Timer</strong>
                          <div>{attendee.is_first_timer ? "Yes" : "No"}</div>
                        </div>
                        <div>
                          <strong>Volunteer</strong>
                          <div>
                            {attendee.wants_to_volunteer ? "Yes" : "No"}
                          </div>
                        </div>
                        <div>
                          <strong>Arrived</strong>
                          <div>{attendee.has_arrived ? "Yes" : "No"}</div>
                        </div>
                        <div>
                          <strong>Shared With Attendees</strong>
                          <div>
                            {attendee.share_with_attendees ? "Yes" : "No"}
                          </div>
                        </div>
                      </div>

                      {attendee.special_events_raw ? (
                        <div style={{ marginTop: 12, fontSize: 13 }}>
                          <strong>Special Events</strong>
                          <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                            {attendee.special_events_raw}
                          </div>
                        </div>
                      ) : null}

                      {attendee.notes ? (
                        <div style={{ marginTop: 12, fontSize: 13 }}>
                          <strong>Notes</strong>
                          <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                            {attendee.notes}
                          </div>
                        </div>
                      ) : null}

                      {formatCancellationDetail(attendee) ? (
                        <div
                          style={{
                            marginTop: 12,
                            padding: "10px 12px",
                            borderRadius: 10,
                            background: "#fef2f2",
                            border: "1px solid #fecaca",
                            fontSize: 13,
                          }}
                        >
                          <strong>Cancellation Details</strong>
                          <div style={{ marginTop: 4 }}>
                            {formatCancellationDetail(attendee)}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {attendeeIssues ? (
                    <div
                      style={{
                        marginTop: 12,
                        padding: "10px 12px",
                        borderRadius: 10,
                        background: "#fff7ed",
                        border: "1px solid #fed7aa",
                        fontSize: 13,
                      }}
                    >
                      {attendeeIssues.issues.map((issue, index) => (
                        <div key={`${attendee.id}-${issue.field}-${index}`}>
                          <strong>{reviewFieldLabel(issue.field)}:</strong>{" "}
                          {issue.issue}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AttendeeEditorModal(props: {
  open: boolean;
  mode: "create" | "edit";
  state: AttendeeEditorState;
  saving: boolean;
  canEdit: boolean;
  onClose: () => void;
  onChange: <K extends keyof AttendeeEditorState>(
    key: K,
    value: AttendeeEditorState[K],
  ) => void;
  onSave: () => Promise<void>;
}) {
  const { open, mode, state, saving, canEdit, onClose, onChange, onSave } =
    props;
  const [showAdditionalParticipant, setShowAdditionalParticipant] =
    useState(false);

  // Governed product rule: an administrator's own authorized action of
  // adding a participant, or explicitly adding an open slot, itself
  // authorizes the resulting participant_capacity -- no separate
  // confirmation, accounting status, or payment attestation is asked for.
  // These values are informational only; they never block Save.
  const hasCopilotNow =
    state.copilot_first.trim() !== "" ||
    state.copilot_last.trim() !== "" ||
    state.copilot_email.trim() !== "";
  const hasAdditionalNow =
    (state.additional_first_name ?? "").trim() !== "" ||
    (state.additional_last_name ?? "").trim() !== "" ||
    (state.additional_email ?? "").trim() !== "" ||
    (state.additional_nickname ?? "").trim() !== "" ||
    (state.additional_cell_phone ?? "").trim() !== "";
  // "New" means this participant did not exist when the editor loaded --
  // distinguishes the admin adding someone (which authorizes capacity)
  // from an unrelated edit to an already-existing row (which must never
  // silently paper over a pre-existing roster/capacity mismatch).
  const isNewCopilot = mode === "edit" && hasCopilotNow && !state.had_copilot_at_load;
  const isNewAdditional =
    mode === "edit" && hasAdditionalNow && !state.had_additional_at_load;
  const isAddingNewParticipant = isNewCopilot || isNewAdditional;
  const resultingRosterCount =
    1 + (hasCopilotNow ? 1 : 0) + (hasAdditionalNow ? 1 : 0);
  const currentStoredCapacity = state.registration_capacity_was_unset
    ? 0
    : (state.registration_capacity_original ?? 0);
  const stepperWasManuallyRaised =
    mode === "edit" &&
    !state.registration_capacity_was_unset &&
    state.registration_capacity > (state.registration_capacity_original ?? 0);
  const targetCapacity = Math.max(
    state.registration_capacity_was_unset ? 0 : state.registration_capacity,
    resultingRosterCount,
  );
  const isCapacityIncrease =
    (isAddingNewParticipant || stepperWasManuallyRaised) &&
    targetCapacity > currentStoredCapacity;
  // Automatically show additional participant if any of its fields are populated
  useEffect(() => {
    if (
      state.additional_first_name ||
      state.additional_last_name ||
      state.additional_nickname ||
      state.additional_email ||
      state.additional_cell_phone
    ) {
      setShowAdditionalParticipant(true);
    }
  }, [
    state.additional_first_name,
    state.additional_last_name,
    state.additional_nickname,
    state.additional_email,
    state.additional_cell_phone,
  ]);
  // Prevent body scroll when modal is open
  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
  if (!open) {
    return null;
  }

  // Insert membership_number after copilot_email if not already present there
  // Remove assigned_site from the main textFields array
  const textFields: Array<{ key: keyof AttendeeEditorState; label: string }> =
    (() => {
      // Reorder and move copilot_cell_phone per requirements
      const fields: Array<{ key: keyof AttendeeEditorState; label: string }> = [
        { key: "pilot_first", label: "Pilot First" },
        { key: "pilot_last", label: "Pilot Last" },
        { key: "copilot_first", label: "Co-Pilot First" },
        { key: "copilot_last", label: "Co-Pilot Last" },
        { key: "nickname", label: "Pilot Nickname" },
        { key: "copilot_nickname", label: "Co-Pilot Nickname" },
        { key: "email", label: "Email" },
        { key: "copilot_email", label: "Co-Pilot Email" },
        { key: "membership_number", label: "Membership Number" },
        { key: "city", label: "City" },
        { key: "state", label: "State" },
        { key: "primary_phone", label: "Primary Phone" },
        { key: "cell_phone", label: "Cell Phone" },
        { key: "coach_manufacturer", label: "Coach Manufacturer" },
        { key: "coach_model", label: "Coach Model" },
        { key: "entry_id", label: "Entry ID" },
        { key: "copilot_cell_phone", label: "Co-Pilot Cell Phone" },
      ];
      return fields;
    })();

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        padding: 0,
        zIndex: 2000,
        overflow: "hidden",
        touchAction: "none",
      }}
    >
      <div
        className="card"
        style={{
          width: "min(1120px, 100%)",
          height: "100%",
          maxHeight: "100%",
          overflow: "hidden",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          padding: 0,
          background: "white",
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            padding: 18,
            borderBottom: "1px solid #eee",
          }}
        >
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>
              {mode === "create"
                ? "Add Attendee Record"
                : "Edit Attendee Record"}
            </h2>
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              {mode === "create"
                ? "Create a new attendee manually."
                : "Update this attendee record."}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={secondaryButtonStyle}
            disabled={saving}
          >
            Close
          </button>
        </div>

        <div
          style={{
            padding: 18,
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
          }}
        >
          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            {/* Render attendee text fields */}
            {(() => {
              const rows = [];
              for (let i = 0; i < textFields.length; ++i) {
                const field = textFields[i];
                rows.push(
                  <div key={String(field.key)}>
                    <label style={labelStyle}>{field.label}</label>
                    <input
                      value={String(state[field.key] ?? "")}
                      onChange={(e) =>
                        onChange(
                          field.key,
                          field.key === "membership_number"
                            ? (e.target.value.toUpperCase() as AttendeeEditorState[typeof field.key])
                            : (e.target
                                .value as AttendeeEditorState[typeof field.key]),
                        )
                      }
                      style={inputStyle}
                    />
                  </div>,
                );
              }
              return rows;
            })()}
            {/* Single full-width Add Additional Participant button row */}
            <div style={{ display: "flex", alignItems: "end" }}>
              <button
                type="button"
                style={{
                  ...secondaryButtonStyle,
                  width: "100%",
                  minWidth: "340px",
                  whiteSpace: "nowrap",
                }}
                onClick={() =>
                  setShowAdditionalParticipant((current) => !current)
                }
              >
                {showAdditionalParticipant
                  ? "− Hide Additional Participant"
                  : "+ Add Additional Participant"}
              </button>
            </div>
          </div>

          {/* Additional Participant fields UI */}
          {showAdditionalParticipant ? (
            <>
              <div
                style={{
                  marginTop: 14,
                  display: "grid",
                  gap: 14,
                  gridTemplateColumns: "repeat(5, minmax(180px, 1fr))",
                  alignItems: "end",
                }}
              >
                <div>
                  <label style={labelStyle}>Participant First Name</label>
                  <input
                    style={inputStyle}
                    placeholder="First name"
                    value={state.additional_first_name}
                    onChange={(e) =>
                      onChange("additional_first_name", e.target.value)
                    }
                  />
                </div>

                <div>
                  <label style={labelStyle}>Participant Last Name</label>
                  <input
                    style={inputStyle}
                    placeholder="Last name"
                    value={state.additional_last_name}
                    onChange={(e) =>
                      onChange("additional_last_name", e.target.value)
                    }
                  />
                </div>

                <div>
                  <label style={labelStyle}>Participant Nickname</label>
                  <input
                    style={inputStyle}
                    placeholder="Nickname"
                    value={state.additional_nickname}
                    onChange={(e) =>
                      onChange("additional_nickname", e.target.value)
                    }
                  />
                </div>

                <div>
                  <label style={labelStyle}>Participant Email</label>
                  <input
                    style={inputStyle}
                    placeholder="Email address"
                    value={state.additional_email}
                    onChange={(e) =>
                      onChange("additional_email", e.target.value)
                    }
                  />
                </div>

                <div>
                  <label style={labelStyle}>Participant Cell Phone</label>
                  <input
                    style={inputStyle}
                    placeholder="Cell phone (optional)"
                    value={state.additional_cell_phone}
                    onChange={(e) =>
                      onChange("additional_cell_phone", e.target.value)
                    }
                  />
                </div>
              </div>
            </>
          ) : null}
          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>Special Events Raw</label>
            <textarea
              value={state.special_events_raw}
              onChange={(e) => onChange("special_events_raw", e.target.value)}
              style={textareaStyle}
              rows={3}
            />
          </div>

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gap: 8,
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            }}
          >
            <label style={checkLabelStyle}>
              <input
                type="checkbox"
                checked={state.wants_to_volunteer}
                onChange={(e) =>
                  onChange("wants_to_volunteer", e.target.checked)
                }
              />
              Volunteer
            </label>

            <label style={checkLabelStyle}>
              <input
                type="checkbox"
                checked={state.is_first_timer}
                onChange={(e) => onChange("is_first_timer", e.target.checked)}
              />
              First Timer
            </label>

            <label style={checkLabelStyle}>
              <input
                type="checkbox"
                checked={state.has_arrived}
                onChange={(e) => onChange("has_arrived", e.target.checked)}
              />
              Has Arrived
            </label>

            <label style={checkLabelStyle}>
              <input
                type="checkbox"
                checked={state.share_with_attendees}
                onChange={(e) =>
                  onChange("share_with_attendees", e.target.checked)
                }
              />
              Share With Attendees
            </label>
            <label style={checkLabelStyle}>
              <input
                type="checkbox"
                checked={state.include_in_headcount}
                onChange={(e) =>
                  onChange("include_in_headcount", e.target.checked)
                }
              />
              Include In Headcount
            </label>

            <label style={checkLabelStyle}>
              <input
                type="checkbox"
                checked={state.needs_name_tag}
                onChange={(e) => onChange("needs_name_tag", e.target.checked)}
              />
              Needs Name Tag
            </label>

            <label style={checkLabelStyle}>
              <input
                type="checkbox"
                checked={state.needs_coach_plate}
                onChange={(e) =>
                  onChange("needs_coach_plate", e.target.checked)
                }
              />
              Needs Coach Plate
            </label>

            <label style={checkLabelStyle}>
              <input
                type="checkbox"
                checked={state.needs_parking}
                onChange={(e) => onChange("needs_parking", e.target.checked)}
              />
              Needs Parking
            </label>

            <label style={checkLabelStyle}>
              <input
                type="checkbox"
                checked={state.is_active}
                onChange={(e) => onChange("is_active", e.target.checked)}
              />
              Active Record
            </label>
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={state.notes}
              onChange={(e) => onChange("notes", e.target.value)}
              style={textareaStyle}
              rows={4}
            />
          </div>
          {/* Registration Capacity, Assigned Site, Participant Type, Data Status row (moved near bottom) */}
          <div
            style={{
              marginTop: 14,
              display: "grid",
              gap: 14,
              gridTemplateColumns: "1fr 2fr 1fr 1fr",
              alignItems: "end",
            }}
          >
            <div>
              <label style={labelStyle}>Registration Capacity</label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => {
                    onChange(
                      "registration_capacity",
                      Math.max(1, state.registration_capacity - 1) as any,
                    );
                    onChange("registration_capacity_was_unset", false);
                  }}
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={state.registration_capacity}
                  onChange={(e) => {
                    onChange(
                      "registration_capacity",
                      Math.max(1, Number(e.target.value) || 1) as any,
                    );
                    onChange("registration_capacity_was_unset", false);
                  }}
                  style={{
                    ...inputStyle,
                    width: 70,
                    textAlign: "center",
                  }}
                />
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => {
                    onChange(
                      "registration_capacity",
                      (state.registration_capacity + 1) as any,
                    );
                    onChange("registration_capacity_was_unset", false);
                  }}
                >
                  +
                </button>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Assigned Site</label>
              <input
                value={state.assigned_site}
                onChange={(e) => onChange("assigned_site", e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Participant Type</label>
              <select
                value={state.participant_type}
                onChange={(e) => onChange("participant_type", e.target.value)}
                style={inputStyle}
              >
                {PARTICIPANT_TYPE_OPTIONS.filter(
                  (option) => option !== "all",
                ).map((option) => (
                  <option key={option} value={option}>
                    {participantTypeLabel(option)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Data Status</label>
              <select
                value={state.data_status}
                onChange={(e) => onChange("data_status", e.target.value)}
                style={inputStyle}
              >
                {DATA_STATUS_OPTIONS.filter((option) => option !== "all").map(
                  (option) => (
                    <option key={option} value={option}>
                      {dataStatusOptionLabel(option)}
                    </option>
                  ),
                )}
              </select>
            </div>
          </div>

          {isCapacityIncrease && (
            <div
              style={{
                marginTop: 14,
                padding: 14,
                border: "1px solid #bfdbfe",
                background: "#eff6ff",
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 14, color: "#1e3a8a" }}>
                {isAddingNewParticipant
                  ? "Adding this participant will also authorize one additional participant slot."
                  : `This will authorize ${targetCapacity} total participant ${targetCapacity === 1 ? "slot" : "slots"}.`}{" "}
                Participant Capacity will be set to {targetCapacity} (from{" "}
                {state.registration_capacity_original ?? "unset"}).
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={labelStyle}>Note (optional)</label>
                <input
                  value={state.capacity_increase_note}
                  onChange={(e) =>
                    onChange("capacity_increase_note", e.target.value)
                  }
                  style={inputStyle}
                />
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            position: "sticky",
            bottom: 0,
            zIndex: 5,
            padding: 18,
            borderTop: "1px solid #eee",
            background: "white",
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={() => void onSave()}
            style={primaryButtonStyle}
            disabled={saving || !canEdit}
          >
            {saving
              ? "Saving..."
              : mode === "create"
                ? "Create Attendee"
                : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminAttendeesPageInner() {
  console.count("ATTENDEES RENDER");
  const storedPrefs = useMemo(() => getStoredAttendeeCommandCenterPrefs(), []);
  const { admin } = useAdmin();
  const adminRef = useRef(admin);
  // UI defense-in-depth only, per the same governed mechanism Sidebar.tsx
  // and AdminRouteGuard already use -- this does not replace backend
  // authorization (RLS remains the actual enforcement boundary). Fails
  // closed while admin access is still resolving (hasPermission(null, ...)
  // is false), so mutation controls never appear enabled before a real
  // permission decision exists.
  const canEditAttendees = hasPermission(admin, "can_edit_attendees");

  useEffect(() => {
    adminRef.current = admin;
  }, [admin]);

  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading attendee records...");
  const [search, setSearch] = useState(storedPrefs.search || "");
  const [pageSize, setPageSize] = useState<PageSize>(
    storedPrefs.pageSize || "25",
  );
  const [attendeeSortMode, setAttendeeSortMode] = useState<AttendeeSortMode>(
    storedPrefs.attendeeSortMode || "last_name",
  );
  const [dataStatusFilter, setDataStatusFilter] = useState<DataStatusFilter>(
    storedPrefs.dataStatusFilter || "all",
  );
  const [participantTypeFilter, setParticipantTypeFilter] =
    useState<ParticipantTypeFilter>(storedPrefs.participantTypeFilter || "all");
  const [viewMode, setViewMode] = useState<ViewMode>(
    storedPrefs.viewMode || "active",
  );

  const [showResolvedInfo, setShowResolvedInfo] = useState(
    storedPrefs.showResolvedInfo ?? true,
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editorState, setEditorState] = useState<AttendeeEditorState>(
    emptyAttendeeEditorState(),
  );
  const [editorSaving, setEditorSaving] = useState(false);

  const [expandedAttendeeId, setExpandedAttendeeId] = useState<string | null>(
    null,
  );

  function toggleExpandedAttendee(attendeeId: string) {
    setExpandedAttendeeId((current) =>
      current === attendeeId ? null : attendeeId,
    );
  }
  const [showReviewQueue, setShowReviewQueue] = useState(false);

  const loadQueue = useCallback(async (eventId: string) => {
    try {
      setLoading(true);
      setError(null);
      setStatus("Loading attendee records...");

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
  copilot_email,
copilot_cell_phone,
  primary_phone,
  cell_phone,
  nickname,
  copilot_nickname,
  membership_number,
  city,
  state,
  assigned_site,
participant_capacity,
has_arrived,
  is_first_timer,
  wants_to_volunteer,
  coach_manufacturer,
  coach_model,
  special_events_raw,
  include_in_headcount,
  needs_name_tag,
  needs_coach_plate,
  needs_parking,
  share_with_attendees,
  participant_type,
  notes,
  source_type,
is_active,
data_status,
registration_status,
cancelled_at,
cancelled_by,
cancellation_reason,
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

      if (attendeeError) {
        throw attendeeError;
      }
      if (rulesError) {
        throw rulesError;
      }

      const nextAttendees = (attendeeData || []) as AttendeeRow[];
      const nextRules = (rulesData || []) as ValidationRule[];

      setAttendees(nextAttendees);
      setRules(nextRules);
      setStatus(
        `Ready. ${nextAttendees.length} attendee${
          nextAttendees.length === 1 ? "" : "s"
        } loaded. ${nextRules.length} validation rule${
          nextRules.length === 1 ? "" : "s"
        } active.`,
      );
    } catch (err: any) {
      console.error("loadQueue error:", err);
      setError(err?.message || "Could not load attendee records.");
      setStatus("Load failed.");
      setAttendees([]);
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEventAndData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus("Loading attendee records...");

    const storedEvent = getCurrentAdminEvent();

    const { data: eventsData, error: eventsError } = await supabase
      .from("events")
      .select("id, name, location, start_date, end_date, status")
      .order("start_date", { ascending: false });

    if (eventsError) {
      setCurrentEvent(null);
      setAttendees([]);
      setRules([]);
      setError(eventsError.message || "Could not load events.");
      setStatus("Load failed.");
      setLoading(false);
      return;
    }

    const activeEvents = (eventsData || []).filter((e: any) =>
      isActiveEventStatus(e.status),
    );

    // ADR-006 §2: a stored Event ID is restored unchanged if it still
    // exists in the full event set, regardless of lifecycle status. Only
    // when no Event has ever been stored does this page fall back to a
    // default policy (prefer the first active Event).
    const { event: matched, invalidStoredContext } = resolveAdminWorkingEvent(
      (eventsData || []) as { id: string; [key: string]: unknown }[],
      storedEvent,
      activeEvents[0] || (eventsData || [])[0] || null,
    );

    let eventToUse: EventContext | null = null;

    if (matched) {
      eventToUse = {
        ...storedEvent,
        id: matched.id as string,
        name:
          (matched.name as string | null) ||
          storedEvent?.name ||
          storedEvent?.eventName ||
          null,
        eventName:
          (matched.name as string | null) ||
          storedEvent?.eventName ||
          storedEvent?.name ||
          null,
        location:
          (matched.location as string | null) ||
          storedEvent?.location ||
          null,
        venue_name:
          storedEvent?.venue_name || (matched.location as string | null) || null,
        start_date:
          (matched.start_date as string | null) ||
          storedEvent?.start_date ||
          null,
        end_date:
          (matched.end_date as string | null) || storedEvent?.end_date || null,
      };
    }

    if (!eventToUse) {
      setCurrentEvent(null);
      setAttendees([]);
      setRules([]);
      setStatus(
        invalidStoredContext
          ? "Your previously selected event is no longer available. Choose one above."
          : "No active event available.",
      );
      setLoading(false);
      return;
    }

    if (eventToUse?.id) {
      const existing = getCurrentAdminEvent();

      const changed =
        existing?.id !== eventToUse.id ||
        existing?.name !== (eventToUse.name || "Selected Event") ||
        existing?.start_date !== (eventToUse.start_date || null) ||
        existing?.end_date !== (eventToUse.end_date || null) ||
        existing?.location !== (eventToUse.location || null);

      if (changed) {
        setCurrentAdminEvent({
          id: eventToUse.id,
          name: eventToUse.name || "Selected Event",
          eventName:
            eventToUse.eventName || eventToUse.name || "Selected Event",
          venue_name: eventToUse.venue_name || null,
          location: eventToUse.location || null,
          start_date: eventToUse.start_date || null,
          end_date: eventToUse.end_date || null,
        });
      }
    }

    if (!canAccessEvent(adminRef.current!, eventToUse.id!)) {
      setCurrentEvent(null);
      setAttendees([]);
      setRules([]);
      setError("You do not have access to this event.");
      setStatus("Access denied.");
      setLoading(false);
      return;
    }

    setCurrentEvent((prev) => {
      if (
        prev?.id === eventToUse?.id &&
        prev?.name === eventToUse?.name &&
        prev?.start_date === eventToUse?.start_date &&
        prev?.end_date === eventToUse?.end_date
      ) {
        return prev;
      }

      return eventToUse;
    });
    await loadQueue(eventToUse.id!);
  }, [loadQueue]);
  useEffect(() => {
    if (!admin) {
      return;
    }

    if (
      !hasPermission(admin, "can_edit_attendees") &&
      !hasPermission(admin, "can_manage_imports") &&
      !hasPermission(admin, "can_manage_reports") &&
      !hasPermission(admin, "can_manage_validation_rules")
    ) {
      setCurrentEvent(null);
      setAttendees([]);
      setRules([]);
      setError("You do not have permission to use Attendee Management.");
      setStatus("Access denied.");
      setLoading(false);
      return;
    }

    void loadEventAndData();
    const unsubscribe = subscribeToAdminWorkspace(() => {
      void loadEventAndData();
    });

    return unsubscribe;
  }, [admin?.adminUser?.id, loadEventAndData]);
  useEffect(() => {
    saveAttendeeCommandCenterPrefs({
      search,
      pageSize,
      dataStatusFilter,
      participantTypeFilter,
      viewMode,
      attendeeSortMode,
      showResolvedInfo,
    });
  }, [
    search,
    pageSize,
    dataStatusFilter,
    participantTypeFilter,
    viewMode,
    attendeeSortMode,
    showResolvedInfo,
  ]);

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
    return attendees.flatMap((attendee) => {
      const issues = REVIEW_FIELDS.flatMap((field) => {
        const result = validateField(
          field,
          attendee[field] as string | null | undefined,
          rules,
          currentEvent?.id || null,
        );
        if (!result) {
          return [];
        }

        return [
          {
            field,
            issue: result.issue,
            severity: result.severity,
          } satisfies ReviewFieldIssue,
        ];
      });

      if (!issues.length) {
        return [];
      }

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

        const statusValue = dataStatusLabel(item.attendee.data_status);
        const matchesStatus =
          dataStatusFilter === "all" ? true : statusValue === dataStatusFilter;

        const participantType = (item.attendee.participant_type ||
          "attendee") as ParticipantTypeFilter;

        const matchesParticipantType =
          participantTypeFilter === "all"
            ? true
            : participantType === participantTypeFilter;

        // NEW
        const registrationStatus =
          item.attendee.registration_status ?? "active";

        const matchesView =
          viewMode === "all"
            ? true
            : viewMode === "active"
              ? registrationStatus !== "cancelled"
              : viewMode === "cancelled"
                ? registrationStatus === "cancelled"
                : viewMode === "review"
                  ? registrationStatus !== "cancelled"
                  : true;

        return (
          matchesSearch &&
          matchesStatus &&
          matchesParticipantType &&
          matchesView
        );
      }),
    );
  }, [reviewItems, search, dataStatusFilter, participantTypeFilter, viewMode]);

  const visibleReviewItems = useMemo(() => {
    if (pageSize === "all") {
      return filteredReviewItems;
    }
    return filteredReviewItems.slice(0, Number(pageSize));
  }, [filteredReviewItems, pageSize]);

  const filteredAttendees = useMemo(() => {
    const term = search.trim().toLowerCase();

    const rows = attendees.filter((row) => {
      const matchesSearch = attendeeMatchesSearch(row, term);

      const statusValue = dataStatusLabel(row.data_status);
      const matchesStatus =
        dataStatusFilter === "all" ? true : statusValue === dataStatusFilter;

      const participantType = (row.participant_type ||
        "attendee") as ParticipantTypeFilter;

      const matchesParticipantType =
        participantTypeFilter === "all"
          ? true
          : participantType === participantTypeFilter;

      // Registration View filter
      const registrationStatus = row.registration_status ?? "active";

      const matchesView =
        viewMode === "all"
          ? true
          : viewMode === "active"
            ? registrationStatus !== "cancelled"
            : viewMode === "cancelled"
              ? registrationStatus === "cancelled"
              : viewMode === "review"
                ? registrationStatus !== "cancelled" &&
                  reviewItems.some((item) => item.attendee.id === row.id)
                : true;

      return (
        matchesSearch && matchesStatus && matchesParticipantType && matchesView
      );
    });

    return [...rows].sort((a, b) => {
      if (attendeeSortMode === "site") {
        const siteA = a.assigned_site?.trim();
        const siteB = b.assigned_site?.trim();

        // push unassigned to bottom
        if (!siteA && !siteB) {
          return 0;
        }
        if (!siteA) {
          return 1;
        }
        if (!siteB) {
          return -1;
        }

        return (
          siteA.localeCompare(siteB, undefined, { numeric: true }) ||
          String(a.pilot_last || "").localeCompare(
            String(b.pilot_last || ""),
            undefined,
            { sensitivity: "base" },
          ) ||
          String(a.pilot_first || "").localeCompare(
            String(b.pilot_first || ""),
            undefined,
            { sensitivity: "base" },
          )
        );
      }

      return (
        String(a.pilot_last || "").localeCompare(
          String(b.pilot_last || ""),
          undefined,
          { sensitivity: "base" },
        ) ||
        String(a.pilot_first || "").localeCompare(
          String(b.pilot_first || ""),
          undefined,
          { sensitivity: "base" },
        ) ||
        String(a.assigned_site || "").localeCompare(
          String(b.assigned_site || ""),
          undefined,
          { numeric: true },
        )
      );
    });
  }, [
    attendees,
    search,
    dataStatusFilter,
    participantTypeFilter,
    attendeeSortMode,
    viewMode,
    reviewItems,
  ]);

  const visibleAttendees = useMemo(() => {
    if (pageSize === "all") {
      return filteredAttendees;
    }
    return filteredAttendees.slice(0, Number(pageSize));
  }, [filteredAttendees, pageSize]);

  useEffect(() => {
    if (!attendees.length || editorOpen) {
      return;
    }

    const pendingEditId = localStorage.getItem("fcoc-attendee-open-edit-id");
    if (!pendingEditId) {
      return;
    }

    const attendee = attendees.find((row) => row.id === pendingEditId);
    if (!attendee) {
      return;
    }

    localStorage.removeItem("fcoc-attendee-open-edit-id");
    setExpandedAttendeeId(attendee.id);
    openEditAttendeeEditor(attendee);
    // openEditAttendeeEditor is intentionally omitted because it is declared later in this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendees, editorOpen]);
  const correctedCount = useMemo(() => {
    return attendees.filter(
      (row) => dataStatusLabel(row.data_status) === "corrected",
    ).length;
  }, [attendees]);

  const fullyValidCount = useMemo(() => {
    return attendees.filter((row) =>
      REVIEW_FIELDS.every(
        (field) =>
          !validateField(
            field,
            row[field] as string | null | undefined,
            rules,
            currentEvent?.id || null,
          ),
      ),
    ).length;
  }, [attendees, rules, currentEvent?.id]);

  const summaryItems = useMemo<SummaryCardItem[]>(() => {
    return [
      {
        label: "Total Registrations",
        value: attendees.length,
      },
      {
        label: "Active",
        value: attendees.filter(
          (row) => row.registration_status !== "cancelled" && row.is_active,
        ).length,
      },
      {
        label: "Arrived",
        value: attendees.filter(
          (row) => row.registration_status !== "cancelled" && !!row.has_arrived,
        ).length,
      },
      {
        label: "Vendors",
        value: filteredAttendees.filter(
          (row) => (row.participant_type || "attendee") === "vendor",
        ).length,
      },
      {
        label: "First Timers",
        value: filteredAttendees.filter((row) => !!row.is_first_timer).length,
      },
      {
        label: "Volunteers",
        value: filteredAttendees.filter((row) => !!row.wants_to_volunteer)
          .length,
      },
      { label: "Flagged", value: filteredReviewItems.length },
      { label: "Membership Corrected", value: correctedCount },
      { label: "Fully Valid", value: fullyValidCount },
    ];
  }, [
    attendees,
    filteredAttendees,
    filteredReviewItems,
    correctedCount,
    fullyValidCount,
  ]);

  async function saveMembershipNumber(item: ReviewItem) {
    const draftValue = normalizeMemberNumber(
      drafts[item.attendee.id] ?? item.attendee.membership_number,
    );

    if (!draftValue) {
      setError("Membership number cannot be blank.");
      setStatus("Correction not saved.");
      return;
    }

    if (!(draftValue.startsWith("F") || draftValue.startsWith("C"))) {
      setError("Membership number must begin with F or C.");
      setStatus("Correction not saved.");
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

      if (attendeeError) {
        throw attendeeError;
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

      setStatus(
        `${displayPilotName(item.attendee)} corrected and removed from review queue.`,
      );

      setExpandedAttendeeId(item.attendee.id);

      showFlash(`${displayPilotName(item.attendee)} corrected successfully.`);
    } catch (err: any) {
      console.error("saveMembershipNumber error:", err);
      setError(err?.message || "Could not save membership number.");
      setStatus("Save failed.");
    } finally {
      setSavingRowId(null);
    }
    window.setTimeout(() => {
      setExpandedAttendeeId((current) =>
        current === item.attendee.id ? null : current,
      );
    }, 1800);
  }

  async function updateDataStatus(attendeeId: string, nextStatus: string) {
    try {
      setError(null);
      setStatus(`Updating attendee status to ${nextStatus}...`);

      const { error: attendeeError } = await supabase
        .from("attendees")
        .update({ data_status: nextStatus })
        .eq("id", attendeeId);

      if (attendeeError) {
        throw attendeeError;
      }

      setAttendees((prev) =>
        prev.map((row) =>
          row.id === attendeeId ? { ...row, data_status: nextStatus } : row,
        ),
      );

      setStatus("Status update complete.");
      showFlash(`Status set to ${nextStatus}.`);
    } catch (err: any) {
      console.error("updateDataStatus error:", err);
      setError(err?.message || "Could not update attendee status.");
      setStatus("Status update failed.");
    }
  }
  async function onCancelRegistration(attendee: AttendeeRow) {
    const confirmed = window.confirm(
      `Cancel the registration for ${displayPilotName(attendee)}?\n\nThis will mark the registration as cancelled but will not delete any history.`,
    );

    if (!confirmed) {
      return;
    }

    console.log("========== CANCEL REGISTRATION ==========");
    console.log("Attendee ID:", attendee.id);
    console.log("Pilot:", displayPilotName(attendee));
    console.log("Event:", currentEvent?.id);

    try {
      console.log("Admin object:", admin);
      console.log("Admin user:", admin?.adminUser);

      setError(null);
      setStatus("Cancelling registration...");

      console.log("About to update attendees table...");

      const { error } = await supabase
        .from("attendees")
        .update({
          registration_status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancelled_by: admin?.adminUser?.id ?? null,
          cancellation_reason: "Cancelled by Admin",
        })
        .eq("id", attendee.id);

      console.log("Supabase returned error:", error);

      if (error) {
        throw error;
      }

      showFlash("Registration cancelled.");

      if (currentEvent?.id) {
        await loadQueue(currentEvent.id);
      }
    } catch (err: any) {
      console.log("Cancel Error:", err);
      console.log("JSON:", JSON.stringify(err, null, 2));
      console.dir(err);
      setError(err.message ?? "Could not cancel registration.");
      setStatus("Cancellation failed.");
    }
  }

  // Helper to sync pilot/copilot/additional household members for an attendee
  async function syncHouseholdMembers(
    attendeeId: string,
    payload: any,
    eventId: string,
    editorState: AttendeeEditorState,
    // When set to "copilot" or "additional", this save is a governed
    // "slot and participant" capacity increase and
    // record_participant_capacity_increase(...) owns that one household
    // role atomically with the capacity/audit change. This call skips only
    // that one role, so it is never split across a non-atomic call and the
    // atomic RPC. The other role (if any) still syncs normally here.
    rpcOwnedParticipantRole: "copilot" | "additional" | null = null,
  ) {
    try {
      // 1. Query attendee_household_members for this attendee
      const { data: memberRows, error: memberError } = await supabase
        .from("attendee_household_members")
        .select("id, person_role")
        .eq("attendee_id", attendeeId);
      if (memberError) {
        throw memberError;
      }
      const pilotRow = memberRows?.find(
        (row: any) => row.person_role === "pilot",
      );
      const copilotRow = memberRows?.find(
        (row: any) => row.person_role === "copilot",
      );
      const additionalRow = memberRows?.find(
        (row: any) => row.person_role === "additional",
      );

      // 3. Build pilotDisplayName
      const pilotDisplayName = payload.nickname
        ? payload.nickname
        : [payload.pilot_first, payload.pilot_last].filter(Boolean).join(" ");
      // 4. Build copilotDisplayName
      const copilotDisplayName = payload.copilot_nickname
        ? payload.copilot_nickname
        : [payload.copilot_first, payload.copilot_last]
            .filter(Boolean)
            .join(" ");

      // 5. Upsert/update the pilot row
      const pilotUpsert = {
        person_role: "pilot",
        first_name: payload.pilot_first || null,
        last_name: payload.pilot_last || null,
        nickname: payload.nickname || null,
        display_name: pilotDisplayName || null,
        email: payload.email || null,
        participant_status: "identified",
        event_id: eventId,
        attendee_id: attendeeId,
      };
      await supabase
        .from("attendee_household_members")
        .upsert(pilotRow ? { ...pilotUpsert, id: pilotRow.id } : pilotUpsert, {
          onConflict: "attendee_id,person_role",
        });

      // 6. Handle copilot logic. Skipped only when the capacity-increase RPC
      //    owns the Co-Pilot row for this save.
      const hasCopilot =
        !!payload.copilot_first ||
        !!payload.copilot_last ||
        !!payload.copilot_email;
      if (rpcOwnedParticipantRole !== "copilot") {
        if (hasCopilot) {
          const copilotUpsert = {
            person_role: "copilot",
            first_name: payload.copilot_first || null,
            last_name: payload.copilot_last || null,
            nickname: payload.copilot_nickname || null,
            display_name: copilotDisplayName || null,
            email: payload.copilot_email || null,
            participant_status: "identified",
            event_id: eventId,
            attendee_id: attendeeId,
          };
          await supabase
            .from("attendee_household_members")
            .upsert(
              copilotRow
                ? { ...copilotUpsert, id: copilotRow.id }
                : copilotUpsert,
              { onConflict: "attendee_id,person_role" },
            );
        } else if (copilotRow) {
          // 7. If no copilot info but copilot row exists, delete only the copilot row
          await supabase
            .from("attendee_household_members")
            .delete()
            .eq("id", copilotRow.id);
        }
      }

      // Additional participant sync logic. Skipped only when the
      // capacity-increase RPC owns the Additional row for this save.
      const hasAdditional =
        !!editorState.additional_first_name ||
        !!editorState.additional_last_name ||
        !!editorState.additional_email ||
        !!editorState.additional_nickname ||
        !!editorState.additional_cell_phone;

      if (rpcOwnedParticipantRole !== "additional") {
        if (hasAdditional) {
          const additionalDisplayName = editorState.additional_nickname
            ? editorState.additional_nickname
            : [
                editorState.additional_first_name,
                editorState.additional_last_name,
              ]
                .filter(Boolean)
                .join(" ");

          const additionalUpsert = {
            person_role: "additional",
            first_name: editorState.additional_first_name || null,
            last_name: editorState.additional_last_name || null,
            nickname: editorState.additional_nickname || null,
            display_name: additionalDisplayName || null,
            email: editorState.additional_email || null,
            cell_phone: editorState.additional_cell_phone || null,
            participant_status: "identified",
            event_id: eventId,
            attendee_id: attendeeId,
          };

          await supabase
            .from("attendee_household_members")
            .upsert(
              additionalRow
                ? { ...additionalUpsert, id: additionalRow.id }
                : additionalUpsert,
              { onConflict: "attendee_id,person_role" },
            )
            .select();
        } else if (additionalRow) {
          await supabase
            .from("attendee_household_members")
            .delete()
            .eq("id", additionalRow.id);
        }
      }
      // 8. Do not touch any other person_role rows
    } catch (err) {
      console.error("syncHouseholdMembers error", err);
    }
  }

  function openCreateAttendeeEditor() {
    setEditorMode("create");
    setEditorState(emptyAttendeeEditorState());
    setEditorOpen(true);
  }

  const openEditAttendeeEditor = useCallback(async (attendee: AttendeeRow) => {
    setEditorMode("edit");

    const nextState = attendeeToEditorState(attendee);

    const { data: participantRows } = await supabase
      .from("attendee_household_members")
      .select("person_role,email,first_name,last_name,nickname,cell_phone")
      .eq("attendee_id", attendee.id);

    const pilot = participantRows?.find((row) => row.person_role === "pilot");

    const copilot = participantRows?.find(
      (row) => row.person_role === "copilot",
    );

    if (pilot?.email) {
      nextState.email = pilot.email;
    }

    if (copilot?.email) {
      nextState.copilot_email = copilot.email;
    }

    const additional = participantRows?.find(
      (row) => row.person_role === "additional",
    );

    if (additional) {
      nextState.additional_first_name = additional.first_name || "";
      nextState.additional_last_name = additional.last_name || "";
      nextState.additional_nickname = additional.nickname || "";
      nextState.additional_email = additional.email || "";
      nextState.additional_cell_phone = additional.cell_phone || "";
    }

    nextState.had_copilot_at_load = !!copilot;
    nextState.had_additional_at_load = !!additional;
    nextState.copilot_name_at_load =
      fullName(attendee.copilot_first, attendee.copilot_last) ||
      copilot?.email ||
      "";
    nextState.additional_name_at_load = additional
      ? fullName(additional.first_name, additional.last_name) ||
        additional.email ||
        ""
      : "";

    setEditorState(nextState);
    setEditorOpen(true);

  }, []);

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
      setStatus("Save blocked.");
      return;
    }

    const pilotFirst = editorState.pilot_first.trim();
    const pilotLast = editorState.pilot_last.trim();
    const email = editorState.email.trim().toLowerCase();
    const membershipNumber = editorState.membership_number.trim().toUpperCase();

    if (!pilotFirst && !pilotLast) {
      setError("Pilot first or last name is required.");
      setStatus("Save blocked.");
      return;
    }

    // Household-member deletion must never happen silently: if clearing
    // the Co-Pilot / Additional Participant fields would cause
    // syncHouseholdMembers to hard-delete that row below, require explicit,
    // specific confirmation first. Declining aborts the entire save before
    // any write occurs, so the existing household member (and every other
    // field on this record) is left exactly as stored.
    const pendingRemovals = computeHouseholdRemovalWarnings(
      editorMode,
      editorState,
    );

    if (pendingRemovals.length > 0) {
      const confirmedRemoval = window.confirm(
        buildHouseholdRemovalConfirmMessage(pendingRemovals),
      );

      if (!confirmedRemoval) {
        setStatus("Save cancelled. No changes were made.");
        return;
      }
    }

    // --- Compute participant capacity ---
    // hasCopilot / hasAdditional use the same three-field definition the
    // governed RPC itself uses (first name, last name, email) so "does a
    // participant exist" is judged consistently everywhere.
    const hasCopilot =
      !!editorState.copilot_first.trim() ||
      !!editorState.copilot_last.trim() ||
      !!editorState.copilot_email.trim();
    const hasAdditional =
      !!editorState.additional_first_name?.trim() ||
      !!editorState.additional_last_name?.trim() ||
      !!editorState.additional_email?.trim();

    // Governed product rule: an administrator's own authorized action of
    // adding a participant, or explicitly raising Registration Capacity,
    // itself authorizes the resulting participant_capacity -- no separate
    // confirmation, accounting status, or payment attestation is required.
    // "New" means this participant did not exist when the editor loaded --
    // an unrelated edit to an already-existing row must never silently
    // paper over a pre-existing roster/capacity mismatch (that remains a
    // visible warning instead).
    const isNewCopilot =
      editorMode === "edit" && hasCopilot && !editorState.had_copilot_at_load;
    const isNewAdditional =
      editorMode === "edit" &&
      hasAdditional &&
      !editorState.had_additional_at_load;
    const isAddingNewParticipant = isNewCopilot || isNewAdditional;
    const resultingRosterCount =
      1 + (hasCopilot ? 1 : 0) + (hasAdditional ? 1 : 0);
    const currentStoredCapacity = editorState.registration_capacity_was_unset
      ? 0
      : (editorState.registration_capacity_original ?? 0);
    const stepperWasManuallyRaised =
      editorMode === "edit" &&
      !editorState.registration_capacity_was_unset &&
      editorState.registration_capacity >
        (editorState.registration_capacity_original ?? 0);
    // Never below what the resulting roster requires, but honors a higher
    // value the administrator explicitly entered in the stepper.
    const targetCapacity = Math.max(
      editorState.registration_capacity_was_unset
        ? 0
        : editorState.registration_capacity,
      resultingRosterCount,
    );
    const isCapacityIncrease =
      (isAddingNewParticipant || stepperWasManuallyRaised) &&
      targetCapacity > currentStoredCapacity;

    // Which household role (if any) the governed RPC atomically writes
    // alongside the capacity increase. Prefers Co-Pilot when both are newly
    // added in the same save; the other role still syncs via the existing
    // generic path below, and the RPC's own roster-count validation still
    // covers the combined resulting total.
    const rpcParticipantRole: "copilot" | "additional" | null =
      !isCapacityIncrease
        ? null
        : isNewCopilot
          ? "copilot"
          : isNewAdditional
            ? "additional"
            : null;

    // Registration capacity is the authoritative participant-capacity
    // value. When capacity was unset (null) at load, the administrator has
    // not deliberately changed the control, and no increase is occurring
    // this save, capacity remains unknown rather than silently persisting
    // the stepper's display default.
    const requiredCapacity = editorState.registration_capacity_was_unset
      ? null
      : editorState.registration_capacity;

    // Create mode has no prior capacity to protect and no atomicity concern
    // (one INSERT immediately followed by one household sync), so it needs
    // no RPC -- but the same governing rule still applies: a brand-new
    // record's initial capacity must cover whatever roster is being created
    // alongside it in this same save.
    const initialCapacityForCreate = Math.max(
      requiredCapacity ?? 0,
      resultingRosterCount,
    );

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
        source_type:
          editorMode === "create"
            ? "manual"
            : (editorState.source_type ?? "manual"),
        entry_id: editorState.entry_id.trim() || null,
        pilot_first: pilotFirst || null,
        pilot_last: pilotLast || null,
        copilot_first: editorState.copilot_first.trim() || null,
        copilot_last: editorState.copilot_last.trim() || null,
        nickname: editorState.nickname.trim() || null,
        copilot_nickname: editorState.copilot_nickname.trim() || null,
        email: email || null,
        copilot_email: editorState.copilot_email.trim().toLowerCase() || null,
        copilot_cell_phone: editorState.copilot_cell_phone.trim() || null,
        membership_number: membershipNumber || null,
        city: editorState.city.trim() || null,
        state: editorState.state.trim() || null,
        assigned_site: editorState.assigned_site.trim() || null,
        participant_type: editorState.participant_type.trim() || "attendee",
        primary_phone: editorState.primary_phone.trim() || null,
        cell_phone: editorState.cell_phone.trim() || null,
        coach_manufacturer: editorState.coach_manufacturer.trim() || null,
        coach_model: editorState.coach_model.trim() || null,
        special_events_raw: editorState.special_events_raw.trim() || null,
        wants_to_volunteer: editorState.wants_to_volunteer,
        is_first_timer: editorState.is_first_timer,
        has_arrived: editorState.has_arrived,
        share_with_attendees: editorState.share_with_attendees,
        is_active: editorState.is_active,
        include_in_headcount: editorState.include_in_headcount,
        needs_name_tag: editorState.needs_name_tag,
        needs_coach_plate: editorState.needs_coach_plate,
        needs_parking: editorState.needs_parking,
        data_status: editorState.data_status || "pending",
        notes: editorState.notes.trim() || null,
        // Overwrite participant_capacity on every save, except when this
        // save is a governed increase -- that case is applied atomically
        // with its audit record via record_participant_capacity_increase
        // after this generic write succeeds, so the original stored value
        // is left untouched here rather than written twice.
        participant_capacity:
          editorMode === "create"
            ? initialCapacityForCreate
            : isCapacityIncrease
              ? editorState.registration_capacity_original
              : requiredCapacity,
      };

      if (editorMode === "create") {
        const { data: newAttendee, error: insertError } = await supabase
          .from("attendees")
          .insert(payload)
          .select("id")
          .single();

        if (insertError) {
          throw insertError;
        }

        // Sync pilot, copilot, and additional household members
        if (newAttendee) {
          await syncHouseholdMembers(
            newAttendee.id,
            payload,
            currentEvent.id,
            editorState,
          );
          const { data } = await supabase
            .from("attendee_household_members")
            .select("*")
            .eq("attendee_id", newAttendee.id);

          console.log("HOUSEHOLD AFTER SAVE", data);
        }
        showFlash("Attendee record created.");
      } else {
        const { error: updateError } = await supabase
          .from("attendees")
          .update(payload)
          .eq("id", editorState.id);
        if (updateError) {
          throw updateError;
        }
        if (!editorState.id) {
          throw new Error("Missing attendee id for edit");
        }

        // Automatic mode: only the participant role this save is newly
        // adding (if any) is withheld from the generic sync -- the RPC
        // below owns exactly that one role atomically. The other role, and
        // a pure slot-only increase, sync here exactly as before.
        await syncHouseholdMembers(
          editorState.id,
          payload,
          currentEvent.id,
          editorState,
          rpcParticipantRole,
        );

        if (isCapacityIncrease) {
          // Atomic: capacity increase, the operational audit record, and --
          // only when a participant is newly being added -- the one named
          // household row that justifies it, all commit or roll back
          // together inside this one RPC call. Calling this RPC requires
          // only valid Event-scoped admin authority: the administrator's
          // own authorized action of adding a participant, or explicitly
          // raising Registration Capacity, itself authorizes the resulting
          // capacity -- no separate confirmation, accounting status, or
          // payment attestation is requested or recorded. See
          // record_participant_capacity_increase in
          // 20260805150000_create_participant_capacity_adjustments.sql.
          //
          // No Person resolution occurs for the participant named here
          // (governed decision, not an oversight): it is preserved as
          // unresolved Participation evidence, exactly like
          // save_participant_identity, until a future, separately accepted
          // general participant-resolution architecture exists.
          const { error: capacityError } = await supabase.rpc(
            "record_participant_capacity_increase",
            {
              p_attendee_id: editorState.id,
              p_new_capacity: targetCapacity,
              p_note: editorState.capacity_increase_note.trim() || null,
              p_participant_role: rpcParticipantRole,
              p_copilot_first:
                rpcParticipantRole === "copilot"
                  ? editorState.copilot_first.trim() || null
                  : null,
              p_copilot_last:
                rpcParticipantRole === "copilot"
                  ? editorState.copilot_last.trim() || null
                  : null,
              p_copilot_nickname:
                rpcParticipantRole === "copilot"
                  ? editorState.copilot_nickname.trim() || null
                  : null,
              p_copilot_email:
                rpcParticipantRole === "copilot"
                  ? editorState.copilot_email.trim().toLowerCase() || null
                  : null,
              p_additional_first_name:
                rpcParticipantRole === "additional"
                  ? editorState.additional_first_name?.trim() || null
                  : null,
              p_additional_last_name:
                rpcParticipantRole === "additional"
                  ? editorState.additional_last_name?.trim() || null
                  : null,
              p_additional_nickname:
                rpcParticipantRole === "additional"
                  ? editorState.additional_nickname?.trim() || null
                  : null,
              p_additional_email:
                rpcParticipantRole === "additional"
                  ? editorState.additional_email?.trim() || null
                  : null,
              p_additional_cell_phone:
                rpcParticipantRole === "additional"
                  ? editorState.additional_cell_phone?.trim() || null
                  : null,
            },
          );

          if (capacityError) {
            throw capacityError;
          }
        }
      }

      if (editorMode === "edit" && viewMode === "review") {
        const savedAttendeeId = editorState.id;
        const updatedAttendees = attendees.map((row) =>
          row.id === savedAttendeeId
            ? {
                ...row,
                entry_id: payload.entry_id,
                pilot_first: payload.pilot_first,
                pilot_last: payload.pilot_last,
                copilot_first: payload.copilot_first,
                copilot_last: payload.copilot_last,
                nickname: payload.nickname,
                copilot_nickname: payload.copilot_nickname,
                email: payload.email,
                membership_number: payload.membership_number,
                city: payload.city,
                state: payload.state,
                assigned_site: payload.assigned_site,
                participant_type: payload.participant_type,
                primary_phone: payload.primary_phone,
                cell_phone: payload.cell_phone,
                coach_manufacturer: payload.coach_manufacturer,
                coach_model: payload.coach_model,
                special_events_raw: payload.special_events_raw,
                wants_to_volunteer: payload.wants_to_volunteer,
                is_first_timer: payload.is_first_timer,
                has_arrived: payload.has_arrived,
                share_with_attendees: payload.share_with_attendees,
                is_active: payload.is_active,
                include_in_headcount: payload.include_in_headcount,
                needs_name_tag: payload.needs_name_tag,
                needs_coach_plate: payload.needs_coach_plate,
                needs_parking: payload.needs_parking,
                data_status: payload.data_status,
                notes: payload.notes,
              }
            : row,
        );

        const remainingReviewItems = sortReviewItems(
          updatedAttendees.flatMap((attendee) => {
            const issues = REVIEW_FIELDS.flatMap((field) => {
              const result = validateField(
                field,
                attendee[field] as string | null | undefined,
                rules,
                currentEvent.id,
              );
              if (!result) {
                return [];
              }

              return [
                {
                  field,
                  issue: result.issue,
                  severity: result.severity,
                } satisfies ReviewFieldIssue,
              ];
            });

            if (!issues.length) {
              return [];
            }

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
          }),
        ).filter((item) => item.attendee.id !== savedAttendeeId);

        const nextReviewItem = remainingReviewItems[0];

        if (nextReviewItem) {
          await openEditAttendeeEditor(nextReviewItem.attendee);
          showFlash("Saved. Next review record loaded.");
        } else {
          closeAttendeeEditor();
          showFlash("Saved. Review queue is clear.");
        }
      }
      // Close immediately on successful save
      closeAttendeeEditor();

      // Then refresh data in background
      await loadQueue(currentEvent.id);
    } catch (err: any) {
      console.error("handleSaveAttendeeRecord error:", err);
      setError(err?.message || "Could not save attendee record.");
      setStatus("Save failed.");
    } finally {
      setEditorSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {(!loading && (status || error)) || flashMessage ? (
        <div className="card" style={{ padding: 18 }}>
          {!loading && status ? <div style={statusBoxStyle}>{status}</div> : null}

          {flashMessage ? (
            <div style={successBoxStyle}>{flashMessage}</div>
          ) : null}

          {!loading && error ? <div style={errorBoxStyle}>{error}</div> : null}
        </div>
      ) : null}

      <>
        <QuickActionBar
          canEdit={canEditAttendees}
          onAddAttendee={openCreateAttendeeEditor}
          onSetReviewMode={() => {
            setViewMode("review");
            const firstReviewItem = filteredReviewItems[0];
            if (firstReviewItem) {
              openEditAttendeeEditor(firstReviewItem.attendee);
            } else {
              showFlash("No attendee records need review.");
            }
          }}
          onSetAllMode={() => setViewMode("all")}
          onRefresh={() => {
            if (currentEvent?.id) {
              void loadQueue(currentEvent.id);
            }
          }}
        />
        <div
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            alignItems: "start",
          }}
        >
          <div
            className="card"
            style={{ padding: 18, display: "grid", gap: 14 }}
          >
            <div>
              <h2 style={{ marginTop: 0, marginBottom: 6 }}>
                Attendee Management
              </h2>
              <div style={{ fontSize: 14, opacity: 0.8 }}>
                One-stop attendee management for the selected event.
              </div>
            </div>

            <SummaryCards items={summaryItems.slice(0, 6)} />
          </div>

          <div
            className="card"
            style={{ padding: 18, display: "grid", gap: 14 }}
          >
            <div>
              <h2 style={{ marginTop: 0, marginBottom: 6 }}>Data Review</h2>
              <div style={{ fontSize: 14, opacity: 0.8 }}>
                Review queue status and quick correction workflow for attendee
                data.
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              }}
            >
              <div className="card" style={summaryCardStyle}>
                <strong>Visible Flagged</strong>
                <div style={summaryValueStyle}>
                  {filteredReviewItems.length}
                </div>
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
              <div className="card" style={summaryCardStyle}>
                <strong>Fully Valid</strong>
                <div style={summaryValueStyle}>{fullyValidCount}</div>
              </div>
            </div>

            <div style={{ fontSize: 13, color: "#555" }}>
              {viewMode === "review"
                ? "Review focus is on. The attendee list remains visible below while the review queue stays available on the same page."
                : "The attendee list stays visible below, with the review queue available on the same page."}
            </div>
          </div>
        </div>

        <FilterBar
          search={search}
          setSearch={setSearch}
          viewMode={viewMode}
          setViewMode={(nextViewMode) => {
            setViewMode(nextViewMode);
            if (nextViewMode === "review") {
              const firstReviewItem = filteredReviewItems[0];
              if (firstReviewItem) {
                openEditAttendeeEditor(firstReviewItem.attendee);
              } else {
                showFlash("No attendee records need review.");
              }
            }
          }}
          pageSize={pageSize}
          setPageSize={setPageSize}
          dataStatusFilter={dataStatusFilter}
          setDataStatusFilter={setDataStatusFilter}
          participantTypeFilter={participantTypeFilter}
          setParticipantTypeFilter={setParticipantTypeFilter}
          attendeeSortMode={attendeeSortMode}
          setAttendeeSortMode={setAttendeeSortMode}
          showResolvedInfo={showResolvedInfo}
          setShowResolvedInfo={setShowResolvedInfo}
        />

        <div className="card" style={{ padding: 18 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div>
              <h2 style={{ marginTop: 0, marginBottom: 6 }}>Review Queue</h2>

              <div style={{ fontSize: 14, opacity: 0.8 }}>
                {filteredReviewItems.length} flagged attendee
                {filteredReviewItems.length === 1 ? "" : "s"}
                {showReviewQueue
                  ? " shown below."
                  : " hidden while you work the attendee list."}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowReviewQueue((prev) => !prev)}
              style={secondaryButtonStyle}
            >
              {showReviewQueue ? "Hide Review Queue" : "Show Review Queue"}
            </button>
          </div>
        </div>

        {showReviewQueue ? (
          <ReviewQueue
            loading={loading}
            canEdit={canEditAttendees}
            filteredReviewItems={filteredReviewItems}
            visibleReviewItems={visibleReviewItems}
            drafts={drafts}
            savingRowId={savingRowId}
            dataStatusFilter={dataStatusFilter}
            participantTypeFilter={participantTypeFilter}
            onDraftChange={updateDraft}
            onSaveMembership={saveMembershipNumber}
            onOpenEdit={openEditAttendeeEditor}
            onUpdateDataStatus={updateDataStatus}
            onCancelRegistration={onCancelRegistration}
          />
        ) : null}

        <AttendeeList
          loading={loading}
          canEdit={canEditAttendees}
          filteredAttendees={filteredAttendees}
          visibleAttendees={visibleAttendees}
          reviewItems={reviewItems}
          attendeeSortMode={attendeeSortMode}
          expandedAttendeeId={expandedAttendeeId}
          onToggleExpanded={toggleExpandedAttendee}
          onOpenEdit={openEditAttendeeEditor}
          onUpdateDataStatus={updateDataStatus}
          onCancelRegistration={onCancelRegistration}
        />
      </>

      <AttendeeEditorModal
        open={editorOpen}
        mode={editorMode}
        state={editorState}
        saving={editorSaving}
        canEdit={canEditAttendees}
        onClose={closeAttendeeEditor}
        onChange={updateEditorField}
        onSave={handleSaveAttendeeRecord}
      />
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
  color: "#ffffff",
  WebkitTextFillColor: "#ffffff",
  fontWeight: 700,
  cursor: "pointer",
  lineHeight: 1.2,
};

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "#ffffff",
  color: "#111827",
  WebkitTextFillColor: "#111827",
  fontWeight: 700,
  lineHeight: 1.2,
  cursor: "pointer",
};

// Shared by AttendeeActionRow in both its ReviewQueue and AttendeeList
// usages -- always wraps, never depends on horizontal scrolling, matching
// the wrapping behavior AttendeeList's row already used (this replaces
// ReviewQueue's own prior horizontal-scroll-only row).
const actionRowStyle: CSSProperties = {
  marginTop: 12,
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
};

const statusBoxStyle: CSSProperties = {
  marginTop: 12,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  color: "#334155",
  fontSize: 14,
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
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-start",
  alignSelf: "start",
  height: "auto",
};

const summaryValueStyle: CSSProperties = {
  fontSize: 26,
  fontWeight: 800,
  marginTop: 8,
};

const secondaryBadgeStyle: CSSProperties = {
  display: "inline-block",
  padding: "3px 8px",
  borderRadius: 999,
  background: "#e5e7eb",
  color: "#374151",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "capitalize",
};

const issueBadgeStyle: CSSProperties = {
  display: "inline-block",
  padding: "3px 8px",
  borderRadius: 999,
  background: "#fff7ed",
  color: "#9a3412",
  fontSize: 12,
  fontWeight: 700,
};

const okBadgeStyle: CSSProperties = {
  display: "inline-block",
  padding: "3px 8px",
  borderRadius: 999,
  background: "#dcfce7",
  color: "#166534",
  fontSize: 12,
  fontWeight: 700,
};

export default function AdminAttendeesPage() {
  return (
    <AdminRouteGuard>
      <AdminShellAdapter pageTitle="Attendees">
        <AdminAttendeesPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
