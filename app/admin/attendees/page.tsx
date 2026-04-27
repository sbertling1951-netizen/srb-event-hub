"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";

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

type ReviewSeverity = "error" | "warning";

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

type AttendeeEditorState = {
  id: string | null;
  pilot_first: string;
  pilot_last: string;
  copilot_first: string;
  copilot_last: string;
  nickname: string;
  copilot_nickname: string;
  email: string;
  membership_number: string;
  city: string;
  state: string;
  assigned_site: string;
  participant_type: string;
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
type ViewMode = "all" | "review";
type AttendeeSortMode = "last_name" | "site";
type CommandCenterTab = "attendees" | "reports" | "imports" | "validation";

type SummaryCardItem = {
  label: string;
  value: number;
};

type InlineEditState = {
  id: string | null;
  pilot_first: string;
  pilot_last: string;
  email: string;
  membership_number: string;
  assigned_site: string;
  participant_type: string;
  data_status: string;
};

type AttendeeCommandCenterPrefs = {
  search?: string;
  pageSize?: PageSize;
  dataStatusFilter?: DataStatusFilter;
  participantTypeFilter?: ParticipantTypeFilter;
  viewMode?: ViewMode;
  attendeeSortMode?: AttendeeSortMode;
  showResolvedInfo?: boolean;
  commandCenterTab?: CommandCenterTab;
};

const ADMIN_EVENT_STORAGE_KEY = "fcoc-admin-event-context";
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

    if (
      rule.rule_type === "starts_with" &&
      !normalizedValue.startsWith(ruleValue)
    ) {
      return { issue: rule.message, severity: rule.severity };
    }

    if (rule.rule_type === "starts_with_any") {
      const allowed = ruleValue
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

      if (!allowed.some((prefix) => normalizedValue.startsWith(prefix))) {
        return { issue: rule.message, severity: rule.severity };
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

function emptyAttendeeEditorState(): AttendeeEditorState {
  return {
    id: null,
    pilot_first: "",
    pilot_last: "",
    copilot_first: "",
    copilot_last: "",
    nickname: "",
    copilot_nickname: "",
    email: "",
    membership_number: "",
    city: "",
    state: "",
    assigned_site: "",
    participant_type: "attendee",
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
    membership_number: attendee.membership_number || "",
    city: attendee.city || "",
    state: attendee.state || "",
    assigned_site: attendee.assigned_site || "",
    participant_type: attendee.participant_type || "attendee",
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

function attendeeToInlineEditState(attendee: AttendeeRow): InlineEditState {
  return {
    id: attendee.id,
    pilot_first: attendee.pilot_first || "",
    pilot_last: attendee.pilot_last || "",
    email: attendee.email || "",
    membership_number: attendee.membership_number || "",
    assigned_site: attendee.assigned_site || "",
    participant_type: attendee.participant_type || "attendee",
    data_status: attendee.data_status || "pending",
  };
}

function emptyInlineEditState(): InlineEditState {
  return {
    id: null,
    pilot_first: "",
    pilot_last: "",
    email: "",
    membership_number: "",
    assigned_site: "",
    participant_type: "attendee",
    data_status: "pending",
  };
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
    return JSON.parse(raw) as EventContext;
  } catch {
    return null;
  }
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

function formatDateRange(startDate?: string | null, endDate?: string | null) {
  if (!startDate && !endDate) {
    return "";
  }
  if (startDate && endDate) {
    return `${startDate} – ${endDate}`;
  }
  return startDate || endDate || "";
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
        display: "grid",
        gap: 12,
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
      }}
    >
      {items.map((item) => (
        <div key={item.label} className="card" style={summaryCardStyle}>
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
    <div className="card" style={{ padding: 18 }}>
      <div
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns:
            "minmax(260px, 1.5fr) minmax(160px, 160px) minmax(160px, 160px) minmax(220px, 220px) minmax(220px, 220px) auto",
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
            <option value="all">All Attendees</option>
            <option value="review">Review Queue</option>
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

function QuickActionBar(props: {
  onAddAttendee: () => void;
  onSetReviewMode: () => void;
  onSetAllMode: () => void;
  onRefresh: () => void;
}) {
  const { onAddAttendee, onSetReviewMode, onSetAllMode, onRefresh } = props;

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
      }}
    >
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onAddAttendee}
          style={primaryButtonStyle}
        >
          + Add Attendee
        </button>

        <button
          type="button"
          onClick={onSetReviewMode}
          style={secondaryButtonStyle}
        >
          Review Mode
        </button>

        <button
          type="button"
          onClick={onSetAllMode}
          style={secondaryButtonStyle}
        >
          Full List
        </button>

        <button type="button" onClick={onRefresh} style={secondaryButtonStyle}>
          Refresh
        </button>
      </div>
    </div>
  );
}

function ReviewQueue(props: {
  loading: boolean;
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
}) {
  const {
    loading,
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
                      placeholder="Must begin with F or C"
                      style={inputStyle}
                      disabled={saving}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void onSaveMembership(item)}
                    style={primaryButtonStyle}
                    disabled={saving}
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
                    onClick={() => onOpenEdit(attendee)}
                    style={secondaryButtonStyle}
                  >
                    Edit Record
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void onUpdateDataStatus(attendee.id, "reviewed")
                    }
                    style={secondaryButtonStyle}
                  >
                    Mark Reviewed
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void onUpdateDataStatus(attendee.id, "locked")
                    }
                    style={secondaryButtonStyle}
                  >
                    Lock Record
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void onUpdateDataStatus(attendee.id, "pending")
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
  );
}

function AttendeeList(props: {
  loading: boolean;
  filteredAttendees: AttendeeRow[];
  visibleAttendees: AttendeeRow[];
  reviewItems: ReviewItem[];
  inlineEditId: string | null;
  inlineEditState: InlineEditState;
  inlineSaving: boolean;
  recentlySavedId: string | null;
  onOpenEdit: (attendee: AttendeeRow) => void;
  onStartInlineEdit: (attendee: AttendeeRow) => void;
  onCancelInlineEdit: () => void;
  onInlineEditChange: (key: keyof InlineEditState, value: string) => void;
  onSaveInlineEdit: () => Promise<void>;
  onUpdateDataStatus: (attendeeId: string, nextStatus: string) => Promise<void>;
}) {
  const {
    loading,
    filteredAttendees,
    visibleAttendees,
    reviewItems,
    inlineEditId,
    inlineEditState,
    inlineSaving,
    recentlySavedId,
    onOpenEdit,
    onStartInlineEdit,
    onCancelInlineEdit,
    onInlineEditChange,
    onSaveInlineEdit,
    onUpdateDataStatus,
  } = props;

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
          {visibleAttendees.map((attendee) => {
            const attendeeIssues = reviewItems.find(
              (item) => item.attendee.id === attendee.id,
            );
            const isInlineEditing = inlineEditId === attendee.id;

            return (
              <div
                key={attendee.id}
                style={{
                  border:
                    attendee.id === recentlySavedId
                      ? "1px solid #86efac"
                      : "1px solid #ddd",
                  borderRadius: 12,
                  padding: 14,
                  background:
                    attendee.id === recentlySavedId ? "#f0fdf4" : "white",
                  transition: "background 0.2s ease, border-color 0.2s ease",
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
                    {isInlineEditing ? (
                      <div
                        style={{
                          display: "grid",
                          gap: 10,
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(180px, 1fr))",
                          marginBottom: 8,
                        }}
                      >
                        <div>
                          <label style={labelStyle}>Pilot First</label>
                          <input
                            value={inlineEditState.pilot_first}
                            onChange={(e) =>
                              onInlineEditChange("pilot_first", e.target.value)
                            }
                            style={inputStyle}
                            disabled={inlineSaving}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Pilot Last</label>
                          <input
                            value={inlineEditState.pilot_last}
                            onChange={(e) =>
                              onInlineEditChange("pilot_last", e.target.value)
                            }
                            style={inputStyle}
                            disabled={inlineSaving}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Email</label>
                          <input
                            value={inlineEditState.email}
                            onChange={(e) =>
                              onInlineEditChange("email", e.target.value)
                            }
                            style={inputStyle}
                            disabled={inlineSaving}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Membership Number</label>
                          <input
                            value={inlineEditState.membership_number}
                            onChange={(e) =>
                              onInlineEditChange(
                                "membership_number",
                                e.target.value.toUpperCase(),
                              )
                            }
                            style={inputStyle}
                            disabled={inlineSaving}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Assigned Site</label>
                          <input
                            value={inlineEditState.assigned_site}
                            onChange={(e) =>
                              onInlineEditChange(
                                "assigned_site",
                                e.target.value,
                              )
                            }
                            style={inputStyle}
                            disabled={inlineSaving}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Participant Type</label>
                          <select
                            value={inlineEditState.participant_type}
                            onChange={(e) =>
                              onInlineEditChange(
                                "participant_type",
                                e.target.value,
                              )
                            }
                            style={inputStyle}
                            disabled={inlineSaving}
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
                            value={inlineEditState.data_status}
                            onChange={(e) =>
                              onInlineEditChange("data_status", e.target.value)
                            }
                            style={inputStyle}
                            disabled={inlineSaving}
                          >
                            {DATA_STATUS_OPTIONS.filter(
                              (option) => option !== "all",
                            ).map((option) => (
                              <option key={option} value={option}>
                                {dataStatusOptionLabel(option)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ) : (
                      <>
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
                          {attendee.email ? (
                            <span>{attendee.email}</span>
                          ) : null}
                          {attendee.assigned_site ? (
                            <span>{`Site ${attendee.assigned_site}`}</span>
                          ) : null}
                          {cityState(attendee) ? (
                            <span>{cityState(attendee)}</span>
                          ) : null}
                        </div>
                      </>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span style={secondaryBadgeStyle}>
                      {isInlineEditing
                        ? dataStatusLabel(inlineEditState.data_status)
                        : dataStatusLabel(attendee.data_status)}
                    </span>
                    {attendeeIssues ? (
                      <span style={issueBadgeStyle}>
                        {attendeeIssues.issues.length} issue
                        {attendeeIssues.issues.length === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span
                        style={
                          attendee.id === recentlySavedId
                            ? savedBadgeStyle
                            : okBadgeStyle
                        }
                      >
                        {attendee.id === recentlySavedId ? "Saved" : "OK"}
                      </span>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 12,
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  {isInlineEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void onSaveInlineEdit()}
                        style={primaryButtonStyle}
                        disabled={inlineSaving}
                      >
                        {inlineSaving ? "Saving..." : "Save Quick Edit"}
                      </button>
                      <button
                        type="button"
                        onClick={onCancelInlineEdit}
                        style={secondaryButtonStyle}
                        disabled={inlineSaving}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenEdit(attendee)}
                        style={secondaryButtonStyle}
                        disabled={inlineSaving}
                      >
                        Full Edit
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onStartInlineEdit(attendee)}
                        style={secondaryButtonStyle}
                      >
                        Quick Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenEdit(attendee)}
                        style={secondaryButtonStyle}
                      >
                        Edit Record
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void onUpdateDataStatus(attendee.id, "reviewed")
                        }
                        style={secondaryButtonStyle}
                      >
                        Mark Reviewed
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void onUpdateDataStatus(attendee.id, "locked")
                        }
                        style={secondaryButtonStyle}
                      >
                        Lock Record
                      </button>
                    </>
                  )}
                </div>

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
            );
          })}
        </div>
      )}
    </div>
  );
}

function AttendeeEditorModal(props: {
  open: boolean;
  mode: "create" | "edit";
  state: AttendeeEditorState;
  saving: boolean;
  onClose: () => void;
  onChange: <K extends keyof AttendeeEditorState>(
    key: K,
    value: AttendeeEditorState[K],
  ) => void;
  onSave: () => Promise<void>;
}) {
  const { open, mode, state, saving, onClose, onChange, onSave } = props;
  if (!open) {
    return null;
  }

  const textFields: Array<{ key: keyof AttendeeEditorState; label: string }> = [
    { key: "pilot_first", label: "Pilot First" },
    { key: "pilot_last", label: "Pilot Last" },
    { key: "copilot_first", label: "Co-Pilot First" },
    { key: "copilot_last", label: "Co-Pilot Last" },
    { key: "nickname", label: "Pilot Nickname" },
    { key: "copilot_nickname", label: "Co-Pilot Nickname" },
    { key: "email", label: "Email" },
    { key: "membership_number", label: "Membership Number" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "assigned_site", label: "Assigned Site" },
    { key: "primary_phone", label: "Primary Phone" },
    { key: "cell_phone", label: "Cell Phone" },
    { key: "coach_manufacturer", label: "Coach Manufacturer" },
    { key: "coach_model", label: "Coach Model" },
    { key: "entry_id", label: "Entry ID" },
  ];

  return (
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
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {textFields.map((field) => (
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
            </div>
          ))}

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
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Special Events Raw</label>
          <textarea
            value={state.special_events_raw}
            onChange={(e) => onChange("special_events_raw", e.target.value)}
            style={textareaStyle}
            rows={3}
          />
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          <label style={checkLabelStyle}>
            <input
              type="checkbox"
              checked={state.wants_to_volunteer}
              onChange={(e) => onChange("wants_to_volunteer", e.target.checked)}
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
              onChange={(e) => onChange("needs_coach_plate", e.target.checked)}
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

        <div
          style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}
        >
          <button
            type="button"
            onClick={() => void onSave()}
            style={primaryButtonStyle}
            disabled={saving}
          >
            {saving
              ? "Saving..."
              : mode === "create"
                ? "Create Attendee"
                : "Save Changes"}
          </button>

          <button
            type="button"
            onClick={onClose}
            style={secondaryButtonStyle}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportsEmbedPanel() {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: 18, borderBottom: "1px solid #eee" }}>
        <h2 style={{ marginTop: 0, marginBottom: 6 }}>Reports</h2>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          Reporting and exports for the selected event.
        </div>
      </div>

      <iframe
        title="Reports"
        src="/admin/reports?embedded=1"
        style={{
          width: "100%",
          minHeight: "1600px",
          border: "none",
          display: "block",
          background: "white",
        }}
      />
    </div>
  );
}
function ImportsEmbedPanel() {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: 18, borderBottom: "1px solid #eee" }}>
        <h2 style={{ marginTop: 0, marginBottom: 6 }}>Imports</h2>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          Import attendee and registration data for the selected event.
        </div>
      </div>

      <iframe
        title="Imports"
        src="/admin/imports?embedded=1"
        style={{
          width: "100%",
          minHeight: "1600px",
          border: "none",
          display: "block",
          background: "white",
        }}
      />
    </div>
  );
}

function ValidationRulesEmbedPanel() {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: 18, borderBottom: "1px solid #eee" }}>
        <h2 style={{ marginTop: 0, marginBottom: 6 }}>Validation Rules</h2>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          Review and maintain the rules used to flag attendee data.
        </div>
      </div>

      <iframe
        title="Validation Rules"
        src="/admin/validation-rules?embedded=1"
        style={{
          width: "100%",
          minHeight: "1600px",
          border: "none",
          display: "block",
          background: "white",
        }}
      />
    </div>
  );
}

function AdminAttendeesPageInner() {
  const storedPrefs = getStoredAttendeeCommandCenterPrefs();
  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading review queue...");
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
    storedPrefs.viewMode || "all",
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
  const [commandCenterTab, setCommandCenterTab] = useState<CommandCenterTab>(
    storedPrefs.commandCenterTab || "attendees",
  );
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineEditState, setInlineEditState] = useState<InlineEditState>(
    emptyInlineEditState(),
  );
  const [inlineSaving, setInlineSaving] = useState(false);
  const [recentlySavedId, setRecentlySavedId] = useState<string | null>(null);

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
        !hasPermission(admin, "can_manage_imports") &&
        !hasPermission(admin, "can_manage_reports") &&
        !hasPermission(admin, "can_manage_validation_rules")
      ) {
        setCurrentEvent(null);
        setAttendees([]);
        setAccessDenied(true);
        setError("You do not have permission to use Attendee Management.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      const storedEvent = getStoredAdminEvent();

      // Always load events to validate active status
      const { data: eventsData, error: eventsError } = await supabase
        .from("events")
        .select(
          "id, name, eventName, location, venue_name, start_date, end_date, status",
        )
        .order("start_date", { ascending: false });

      if (eventsError) {
        console.error("Error loading events:", eventsError);
      }

      const activeEvents = (eventsData || []).filter((e: any) =>
        isActiveEventStatus(e.status),
      );

      let eventToUse: EventContext | null = null;

      if (storedEvent?.id) {
        const matched = (eventsData || []).find(
          (e: any) => e.id === storedEvent.id,
        );

        // Only use stored event if it's still active
        if (matched && isActiveEventStatus(matched.status)) {
          eventToUse = {
            ...storedEvent,
            id: matched.id,
            name:
              matched.name || storedEvent.name || storedEvent.eventName || null,
            eventName:
              matched.name || storedEvent.eventName || storedEvent.name || null,
            location: matched.location || storedEvent.location || null,
            venue_name:
              matched.venue_name ||
              storedEvent.venue_name ||
              matched.location ||
              null,
            start_date: matched.start_date || storedEvent.start_date || null,
            end_date: matched.end_date || storedEvent.end_date || null,
          };
        }
      }

      // Fallback to first active event if stored one is inactive
      if (!eventToUse && activeEvents.length > 0) {
        const fallback = activeEvents[0];
        eventToUse = {
          id: fallback.id,
          name: fallback.name || "Selected Event",
          eventName: fallback.name || "Selected Event",
          location: fallback.location || null,
          venue_name: fallback.venue_name || fallback.location || null,
          start_date: fallback.start_date || null,
          end_date: fallback.end_date || null,
        };

        // Update localStorage so app stays consistent
        localStorage.setItem(
          ADMIN_EVENT_STORAGE_KEY,
          JSON.stringify(eventToUse),
        );
        localStorage.setItem("fcoc-admin-event-changed", String(Date.now()));
        window.dispatchEvent(new CustomEvent("fcoc-admin-event-updated"));
      }

      if (!eventToUse) {
        setCurrentEvent(null);
        setAttendees([]);
        setStatus("No active event available.");
        setLoading(false);
        return;
      }

      if (!canAccessEvent(admin, eventToUse.id!)) {
        setCurrentEvent(null);
        setAttendees([]);
        setAccessDenied(true);
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      setCurrentEvent(eventToUse);
      await loadQueue(eventToUse.id!);
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

  useEffect(() => {
    saveAttendeeCommandCenterPrefs({
      search,
      pageSize,
      dataStatusFilter,
      participantTypeFilter,
      viewMode,
      attendeeSortMode,
      showResolvedInfo,
      commandCenterTab,
    });
  }, [
    search,
    pageSize,
    dataStatusFilter,
    participantTypeFilter,
    viewMode,
    attendeeSortMode,
    showResolvedInfo,
    commandCenterTab,
  ]);

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
        `Loaded ${nextAttendees.length} attendees and ${nextRules.length} validation rules.`,
      );
    } catch (err: any) {
      console.error("loadQueue error:", err);
      setError(err?.message || "Could not load data review queue.");
      setStatus("Could not load data review queue.");
      setAttendees([]);
      setRules([]);
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

        return matchesSearch && matchesStatus && matchesParticipantType;
      }),
    );
  }, [reviewItems, search, dataStatusFilter, participantTypeFilter]);

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

      return matchesSearch && matchesStatus && matchesParticipantType;
    });

    return [...rows].sort((a, b) => {
      if (attendeeSortMode === "site") {
        const siteA = String(a.assigned_site || "ZZZ").trim();
        const siteB = String(b.assigned_site || "ZZZ").trim();

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
  ]);

  const visibleAttendees = useMemo(() => {
    if (pageSize === "all") {
      return filteredAttendees;
    }
    return filteredAttendees.slice(0, Number(pageSize));
  }, [filteredAttendees, pageSize]);

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
      { label: "Total Attendees", value: attendees.length },
      {
        label: "Active",
        value: attendees.filter((row) => row.is_active).length,
      },
      {
        label: "Arrived",
        value: attendees.filter((row) => !!row.has_arrived).length,
      },
      {
        label: "Vendors",
        value: attendees.filter(
          (row) => (row.participant_type || "attendee") === "vendor",
        ).length,
      },
      {
        label: "First Timers",
        value: attendees.filter((row) => !!row.is_first_timer).length,
      },
      {
        label: "Volunteers",
        value: attendees.filter((row) => !!row.wants_to_volunteer).length,
      },
      { label: "Flagged", value: reviewItems.length },
      { label: "Membership Corrected", value: correctedCount },
      { label: "Fully Valid", value: fullyValidCount },
    ];
  }, [attendees, correctedCount, fullyValidCount, reviewItems.length]);

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
      showFlash("Membership number saved. Review item cleared.");
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

      if (attendeeError) {
        throw attendeeError;
      }

      setAttendees((prev) =>
        prev.map((row) =>
          row.id === attendeeId ? { ...row, data_status: nextStatus } : row,
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

  function openCreateAttendeeEditor() {
    setEditorMode("create");
    setEditorState(emptyAttendeeEditorState());
    setEditorOpen(true);
  }

  function openEditAttendeeEditor(attendee: AttendeeRow) {
    cancelInlineEdit();
    setEditorMode("edit");
    setEditorState(attendeeToEditorState(attendee));
    setEditorOpen(true);
  }

  function closeAttendeeEditor() {
    cancelInlineEdit();
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

  function startInlineEdit(attendee: AttendeeRow) {
    setInlineEditId(attendee.id);
    setInlineEditState(attendeeToInlineEditState(attendee));
  }

  function cancelInlineEdit() {
    setInlineEditId(null);
    setInlineEditState(emptyInlineEditState());
  }

  function updateInlineEditField(key: keyof InlineEditState, value: string) {
    setInlineEditState((prev) => ({
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
        nickname: editorState.nickname.trim() || null,
        copilot_nickname: editorState.copilot_nickname.trim() || null,
        email: email || null,
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
      };

      if (editorMode === "create") {
        const { error: insertError } = await supabase
          .from("attendees")
          .insert(payload);
        if (insertError) {
          throw insertError;
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

  async function handleSaveInlineEdit() {
    if (!currentEvent?.id || !inlineEditId) {
      setError("No attendee selected for inline edit.");
      return;
    }

    const pilotFirst = inlineEditState.pilot_first.trim();
    const pilotLast = inlineEditState.pilot_last.trim();
    const email = inlineEditState.email.trim().toLowerCase();
    const membershipNumber = inlineEditState.membership_number
      .trim()
      .toUpperCase();

    if (!pilotFirst && !pilotLast) {
      setError("Pilot first or last name is required.");
      return;
    }

    try {
      setInlineSaving(true);
      setError(null);
      setStatus("Saving quick edit...");
      const savedId = inlineEditId;

      const payload = {
        pilot_first: pilotFirst || null,
        pilot_last: pilotLast || null,
        email: email || null,
        membership_number: membershipNumber || null,
        assigned_site: inlineEditState.assigned_site.trim() || null,
        participant_type: inlineEditState.participant_type.trim() || "attendee",
        data_status: inlineEditState.data_status || "pending",
      };

      const { error: updateError } = await supabase
        .from("attendees")
        .update(payload)
        .eq("id", inlineEditId)
        .eq("event_id", currentEvent.id);

      if (updateError) {
        throw updateError;
      }

      setAttendees((prev) =>
        prev.map((row) =>
          row.id === inlineEditId
            ? {
                ...row,
                ...payload,
              }
            : row,
        ),
      );

      setStatus("Quick edit saved.");
      showFlash("Attendee quick edit saved.");
      setRecentlySavedId(savedId);
      window.setTimeout(() => {
        setRecentlySavedId((current) => (current === savedId ? null : current));
      }, 1500);
      cancelInlineEdit();
    } catch (err: any) {
      console.error("handleSaveInlineEdit error:", err);
      setError(err?.message || "Could not save quick edit.");
      setStatus("Quick edit failed.");
    } finally {
      setInlineSaving(false);
    }
  }

  if (!loading && accessDenied) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Admin Command Center</h1>
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
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Admin Command Center</h1>

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
            onClick={() => {
              window.location.href = "/admin/attendees";
            }}
            style={secondaryButtonStyle}
          >
            Open Command Center
          </button>
          <button
            type="button"
            onClick={() => setCommandCenterTab("attendees")}
            style={
              commandCenterTab === "attendees"
                ? primaryButtonStyle
                : secondaryButtonStyle
            }
          >
            Attendee Management
          </button>

          <button
            type="button"
            onClick={() => setCommandCenterTab("reports")}
            style={
              commandCenterTab === "reports"
                ? primaryButtonStyle
                : secondaryButtonStyle
            }
          >
            Reports
          </button>
          <button
            type="button"
            onClick={() => setCommandCenterTab("imports")}
            style={
              commandCenterTab === "imports"
                ? primaryButtonStyle
                : secondaryButtonStyle
            }
          >
            Imports
          </button>

          <button
            type="button"
            onClick={() => setCommandCenterTab("validation")}
            style={
              commandCenterTab === "validation"
                ? primaryButtonStyle
                : secondaryButtonStyle
            }
          >
            Validation Rules
          </button>
        </div>
      </div>

      {commandCenterTab === "attendees" ? (
        <>
          <QuickActionBar
            onAddAttendee={openCreateAttendeeEditor}
            onSetReviewMode={() => setViewMode("review")}
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

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={openCreateAttendeeEditor}
                  style={primaryButtonStyle}
                >
                  Add Attendee Record
                </button>
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
                        (row) =>
                          dataStatusLabel(row.data_status) === "corrected",
                      ).length
                    }
                  </div>
                </div>
                <div className="card" style={summaryCardStyle}>
                  <strong>Reviewed</strong>
                  <div style={summaryValueStyle}>
                    {
                      attendees.filter(
                        (row) =>
                          dataStatusLabel(row.data_status) === "reviewed",
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
          <div>
            <label style={labelStyle}>Sort</label>
            <select
              value={attendeeSortMode}
              onChange={(e) =>
                setAttendeeSortMode(e.target.value as AttendeeSortMode)
              }
              style={inputStyle}
            >
              <option value="last_asc">Last Name A–Z</option>
              <option value="last_desc">Last Name Z–A</option>
              <option value="first_asc">First Name A–Z</option>
              <option value="site_asc">Site Number</option>
            </select>
          </div>

          <FilterBar
            search={search}
            setSearch={setSearch}
            viewMode={viewMode}
            setViewMode={setViewMode}
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

          <AttendeeList
            loading={loading}
            filteredAttendees={filteredAttendees}
            visibleAttendees={visibleAttendees}
            reviewItems={reviewItems}
            inlineEditId={inlineEditId}
            inlineEditState={inlineEditState}
            inlineSaving={inlineSaving}
            recentlySavedId={recentlySavedId}
            onOpenEdit={openEditAttendeeEditor}
            onStartInlineEdit={startInlineEdit}
            onCancelInlineEdit={cancelInlineEdit}
            onInlineEditChange={updateInlineEditField}
            onSaveInlineEdit={handleSaveInlineEdit}
            onUpdateDataStatus={updateDataStatus}
          />

          <ReviewQueue
            loading={loading}
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
          />
        </>
      ) : commandCenterTab === "reports" ? (
        <ReportsEmbedPanel />
      ) : commandCenterTab === "imports" ? (
        <ImportsEmbedPanel />
      ) : (
        <ValidationRulesEmbedPanel />
      )}

      <AttendeeEditorModal
        open={editorOpen}
        mode={editorMode}
        state={editorState}
        saving={editorSaving}
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

const savedBadgeStyle: CSSProperties = {
  display: "inline-block",
  padding: "3px 8px",
  borderRadius: 999,
  background: "#dcfce7",
  color: "#166534",
  fontSize: 12,
  fontWeight: 700,
  border: "1px solid #86efac",
};

export default function AdminAttendeesPage() {
  return (
    <AdminRouteGuard>
      <AdminAttendeesPageInner />
    </AdminRouteGuard>
  );
}
