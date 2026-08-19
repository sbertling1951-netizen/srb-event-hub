"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ATTENDEE_EDIT_SECTIONS,
  attendeeChangedRemotelyWhileDirty,
  attendeeConcurrencyFingerprint,
  type AttendeeEditorState,
  type AttendeeRow,
  type AttendeeSortMode,
  attendeeToEditorState,
  buildHouseholdRemovalConfirmMessage,
  computeHouseholdRemovalWarnings,
  computeReviewItems,
  DATA_STATUS_OPTIONS,
  type DataStatusFilter,
  dataStatusLabel,
  dataStatusOptionLabel,
  dirtySectionIds,
  displayCopilotName,
  displayPilotName,
  editorStateIsDirty,
  emptyAttendeeEditorState,
  filterAttendees,
  formatCancellationDetail,
  fullName,
  normalizeMemberNumber,
  type PageSize,
  PARTICIPANT_TYPE_OPTIONS,
  type ParticipantTypeFilter,
  participantTypeLabel,
  type ReviewFieldIssue,
  reviewFieldLabel,
  type ReviewItem,
  sortAttendees,
  sortReviewItems,
  validateField,
  type ValidationRule,
  type ViewMode,
} from "@/app/admin/attendees/attendeesWorkflow";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { ObjectPanel } from "@/components/ObjectPanel";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { AppButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { buildAdminAttendeeTargetHref } from "@/lib/adminAttendeeTarget";
import { useAdmin } from "@/lib/adminContext";
import { checkAdminEventTaskAuthority } from "@/lib/adminTaskAuthority";
import {
  getCurrentAdminEvent,
  resolveAdminWorkingEvent,
  setCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { type CanonicalAttendeePlacementResult,fetchCanonicalAttendeePlacement } from "@/lib/canonicalAttendeePlacement";
import {
  type CanonicalEventOperationalSummary,
  fetchEventOperationalSummary,
} from "@/lib/eventOperationalSummary";
import { isActiveEventStatus } from "@/lib/eventStatus";
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

type SummaryCardItem = {
  label: string;
  value: number | string;
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
          <div
            style={
              typeof item.value === "number"
                ? summaryValueStyle
                : summaryValueErrorStyle
            }
          >
            {item.value}
          </div>
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
      {/* Search and View are the two primary, always-visible browse
          decisions (Refactor Audit Section F). Every other filter here is
          secondary/low-frequency and lives behind the "More filters"
          disclosure below so it never competes with them for attention. */}
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
      </div>

      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
          More filters
        </summary>
        <div
          style={{
            marginTop: 14,
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            alignItems: "end",
          }}
        >
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
                setParticipantTypeFilter(
                  e.target.value as ParticipantTypeFilter,
                )
              }
              style={inputStyle}
            >
              <option value="all">All Types</option>
              {PARTICIPANT_TYPE_OPTIONS.filter(
                (option) => option !== "all",
              ).map((option) => (
                <option key={option} value={option}>
                  {participantTypeLabel(option)}
                </option>
              ))}
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
            automatically. Records stay in the queue until all remaining
            flagged issues are resolved.
          </div>
        ) : null}
      </details>
    </div>
  );
}

// Stage B (docs/architecture/EPICENTRAX_ATTENDEES_MODULE_REFACTOR_AUDIT.md,
// Section F): "Flagged Active" and "All Registrations" used to duplicate
// the View select below (FilterBar) as a second control for the same
// decision. Removed here -- View is now the one owner of that decision.
// No capability is lost: every value either button set is still reachable
// through View.
export function QuickActionBar(props: {
  canEdit: boolean;
  onAddAttendee: () => void;
  onRefresh: () => void;
}) {
  const { canEdit, onAddAttendee, onRefresh } = props;

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
  onSelect: (attendee: AttendeeRow) => void;
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
    onSelect,
    onUpdateDataStatus,
    onCancelRegistration,
  } = props;

  return (
    <div style={actionRowStyle}>
      {/* Selecting only opens the record for viewing (Understand) --
          entering edit mode is always a separate, explicit action inside
          the workspace itself (Stage C). */}
      <button
        type="button"
        onClick={() => onSelect(attendee)}
        style={secondaryButtonStyle}
      >
        View Record
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
  onSelect: (attendee: AttendeeRow) => void;
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
    onSelect,
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
                  onSelect={onSelect}
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

// Stage C: the browse row itself is now purely a discovery surface (per
// docs/architecture/epicentrax-user-flow-and-native-interaction.md Article
// II) -- it scans and selects, but no longer tries to also be the "Understand"
// step. Selecting (row click or "View Record") always opens the one
// AttendeeRecordWorkspace in view mode; there is no separate inline expand
// panel to keep in sync with it.
function AttendeeList(props: {
  loading: boolean;
  canEdit: boolean;
  filteredAttendees: AttendeeRow[];
  visibleAttendees: AttendeeRow[];
  reviewItems: ReviewItem[];
  attendeeSortMode: AttendeeSortMode;
  selectedAttendeeId: string | null;
  onSelect: (attendee: AttendeeRow) => void;
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
    selectedAttendeeId,
    onSelect,
    onUpdateDataStatus,
    onCancelRegistration,
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
          {visibleAttendees.map((attendee, index) => {
            const attendeeIssues = reviewItems.find(
              (item) => item.attendee.id === attendee.id,
            );
            const isSelected = selectedAttendeeId === attendee.id;
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
            const selectThisAttendee = () => onSelect(attendee);

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
                  style={{
                    border: isSelected
                      ? "1px solid #2563eb"
                      : attendee.registration_status === "cancelled"
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
                    onClick={selectThisAttendee}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectThisAttendee();
                      }
                    }}
                    title="View attendee record"
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
                      onSelect={onSelect}
                      onUpdateDataStatus={onUpdateDataStatus}
                      onCancelRegistration={onCancelRegistration}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Stage C (Attendees Admin Workflow: Selected Record Workspace). One
// coherent selected-record model, replacing the former split between
// AttendeeList's inline "expand card" and a separately-triggered
// full-screen AttendeeEditorModal. Selecting a record always opens this in
// view mode first (Understand); editing requires the operator to
// explicitly choose Edit (Act) -- viewing never implies mutability.
//
// Built on the platform's one authoritative "Understand and Act" surface
// (components/ObjectPanel.tsx, per docs/architecture/
// epicentrax-user-flow-and-native-interaction.md Article II) rather than a
// bespoke modal, so dialog semantics, focus handling, Escape/backdrop/Back
// dismissal, and responsive presentation are inherited rather than
// reimplemented.
export function AttendeeRecordWorkspace(props: {
  open: boolean;
  // Whether this session is creating a brand-new record or working with an
  // existing one -- distinct from viewState below.
  editorMode: "create" | "edit";
  // Whether the record is currently being looked at (read-only,
  // Understand) or actively being changed (mutable, Act). Create sessions
  // are always "edit" -- there is nothing yet to view.
  viewState: "view" | "edit";
  attendee: AttendeeRow | null;
  state: AttendeeEditorState;
  reviewIssues: ReviewFieldIssue[];
  saving: boolean;
  canEdit: boolean;
  // Stage D dirty-state / concurrency / feedback
  isDirty: boolean;
  dirtySections: string[];
  conflict: string | null;
  saveFeedback: string | null;
  onClose: () => void;
  onChange: <K extends keyof AttendeeEditorState>(
    key: K,
    value: AttendeeEditorState[K],
  ) => void;
  onEnterEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => Promise<void>;
  onReloadRecord: () => void;
  onRemoveHouseholdMember: (role: "copilot" | "additional") => Promise<void>;
  onUpdateDataStatus: (
    attendeeId: string,
    nextStatus: string,
  ) => Promise<void>;
  onCancelRegistration: (attendee: AttendeeRow) => Promise<void>;
  onPrevious?: () => void;
  onNext?: () => void;
  operationalStatus?: CanonicalAttendeePlacementResult | null;
}) {
  const {
    open,
    editorMode,
    viewState,
    attendee,
    state,
    reviewIssues,
    saving,
    canEdit,
    isDirty,
    dirtySections,
    conflict,
    saveFeedback,
    onClose,
    onChange,
    onEnterEdit,
    onCancelEdit,
    onSave,
    onReloadRecord,
    onRemoveHouseholdMember,
    onUpdateDataStatus,
    onCancelRegistration,
    onPrevious,
    onNext,
    operationalStatus,
  } = props;
  const mode = editorMode;
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
  // Insert membership_number after copilot_email if not already present there
  // Remove assigned_site from the main textFields array
  // Stage D requirement 2: fields are grouped into the same coherent
  // sections ATTENDEE_EDIT_SECTIONS defines (and dirtySections badges
  // against), so "which section changed" and "which fields are in this
  // section" can never silently disagree.
  const SECTION_TEXT_FIELDS: Record<
    string,
    Array<{ key: keyof AttendeeEditorState; label: string }>
  > = {
    identity: [
      { key: "pilot_first", label: "Pilot First" },
      { key: "pilot_last", label: "Pilot Last" },
      { key: "nickname", label: "Pilot Nickname" },
    ],
    household: [
      { key: "copilot_first", label: "Co-Pilot First" },
      { key: "copilot_last", label: "Co-Pilot Last" },
      { key: "copilot_nickname", label: "Co-Pilot Nickname" },
      { key: "copilot_email", label: "Co-Pilot Email" },
      { key: "copilot_cell_phone", label: "Co-Pilot Cell Phone" },
    ],
    contact: [
      { key: "email", label: "Email" },
      { key: "primary_phone", label: "Primary Phone" },
      { key: "cell_phone", label: "Cell Phone" },
    ],
    location: [
      { key: "city", label: "City" },
      { key: "state", label: "State" },
    ],
    coach: [
      { key: "coach_manufacturer", label: "Coach Manufacturer" },
      { key: "coach_model", label: "Coach Model" },
    ],
    registration: [
      { key: "membership_number", label: "Membership Number" },
      { key: "entry_id", label: "Entry ID" },
    ],
  };

  function renderTextField(field: {
    key: keyof AttendeeEditorState;
    label: string;
  }) {
    return (
      <div key={String(field.key)}>
        <label style={labelStyle}>{field.label}</label>
        <input
          value={String(state[field.key] ?? "")}
          onChange={(e) =>
            onChange(
              field.key,
              field.key === "membership_number"
                ? (e.target.value.toUpperCase() as AttendeeEditorState[typeof field.key])
                : (e.target.value as AttendeeEditorState[typeof field.key]),
            )
          }
          style={inputStyle}
        />
      </div>
    );
  }

  function sectionHeading(id: string, label: string) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <strong style={{ fontSize: 15 }}>{label}</strong>
        {dirtySections.includes(id) ? (
          <span style={badgeVariant("#dbeafe", "#1d4ed8")}>Changed</span>
        ) : null}
      </div>
    );
  }

  const sectionStyle: CSSProperties = {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 14,
    background: "#fafafa",
  };

  const operationalStatusBlock =
    mode === "edit" && state.id ? (
      <div
        style={{
          border: "1px solid #bfdbfe",
          borderRadius: 10,
          padding: 12,
          background: "#eff6ff",
        }}
      >
        <strong>Operational Status</strong>
        <div>Arrival: {state.has_arrived ? "Arrived" : "Not arrived"}</div>
        <div>
          Placement:{" "}
          {operationalStatus?.ok
            ? operationalStatus.site?.label || "Unassigned"
            : operationalStatus
              ? "Unavailable"
              : "Loading..."}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <a href={buildAdminAttendeeTargetHref("/admin/checkin", state.id)}>
            View in Check-In
          </a>
          <a href={buildAdminAttendeeTargetHref("/admin/parking", state.id)}>
            View in Parking
          </a>
        </div>
      </div>
    ) : null;

  const titleText =
    mode === "create"
      ? "Add Attendee Record"
      : displayPilotName(attendee ?? { pilot_first: state.pilot_first, pilot_last: state.pilot_last } as AttendeeRow);

  const subtitleText =
    mode === "create" ? (
      "Create a new attendee manually."
    ) : (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={participantTypeBadgeStyle(state.participant_type)}>
          {participantTypeLabel(state.participant_type)}
        </span>
        <span style={secondaryBadgeStyle}>{dataStatusLabel(state.data_status)}</span>
        {attendee?.registration_status === "cancelled" ? (
          <span style={badgeVariant("#fee2e2", "#991b1b")}>Cancelled</span>
        ) : null}
      </div>
    );

  // View mode: read-only Understand step. Selecting a record never implies
  // mutability -- Edit is a deliberate, separate action below.
  const viewBody = (
    <div style={{ display: "grid", gap: 16 }}>
      {reviewIssues.length > 0 ? (
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            fontSize: 13,
          }}
        >
          <strong>
            {reviewIssues.length} data-quality issue
            {reviewIssues.length === 1 ? "" : "s"}
          </strong>
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {reviewIssues.map((issue, index) => (
              <div key={`${issue.field}-${index}`}>
                <strong>{reviewFieldLabel(issue.field)}:</strong> {issue.issue}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <strong>Contact</strong>
        <div style={{ marginTop: 6, fontSize: 14, display: "grid", gap: 4 }}>
          <div>Email: {state.email || "Not provided"}</div>
          <div>Phone: {state.primary_phone || state.cell_phone || "Not provided"}</div>
          <div>
            Coach: {[state.coach_manufacturer, state.coach_model].filter(Boolean).join(" ") || "Not provided"}
          </div>
        </div>
      </div>

      {operationalStatusBlock}

      <div>
        <strong>Household</strong>
        <div style={{ marginTop: 6, display: "grid", gap: 10, fontSize: 14 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Pilot</div>
            <div>
              {fullName(state.pilot_first, state.pilot_last) || "Unnamed"}
              {state.nickname ? ` "${state.nickname}"` : ""}
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>Co-Pilot</div>
            <div>
              {fullName(state.copilot_first, state.copilot_last) || "None on record"}
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>Additional Participant</div>
            <div>
              {fullName(state.additional_first_name, state.additional_last_name) ||
                "None on record"}
            </div>
          </div>
        </div>
      </div>

      <details>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>More details</summary>
        <div
          style={{
            marginTop: 10,
            display: "grid",
            gap: 8,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            fontSize: 13,
          }}
        >
          <div>
            <strong>Membership #</strong>
            <div>{state.membership_number || "—"}</div>
          </div>
          <div>
            <strong>Entry ID</strong>
            <div>{state.entry_id || "—"}</div>
          </div>
          <div>
            <strong>City / State</strong>
            <div>{[state.city, state.state].filter(Boolean).join(", ") || "—"}</div>
          </div>
          <div>
            <strong>Headcount</strong>
            <div>{state.include_in_headcount ? "Included" : "Not included"}</div>
          </div>
          <div>
            <strong>Name Tag</strong>
            <div>{state.needs_name_tag ? "Needed" : "Not needed"}</div>
          </div>
          <div>
            <strong>Coach Plate</strong>
            <div>{state.needs_coach_plate ? "Needed" : "Not needed"}</div>
          </div>
          <div>
            <strong>Parking</strong>
            <div>{state.needs_parking ? "Needed" : "Not needed"}</div>
          </div>
          <div>
            <strong>First Timer</strong>
            <div>{state.is_first_timer ? "Yes" : "No"}</div>
          </div>
          <div>
            <strong>Volunteer</strong>
            <div>{state.wants_to_volunteer ? "Yes" : "No"}</div>
          </div>
          <div>
            <strong>Active Record</strong>
            <div>{state.is_active ? "Yes" : "No"}</div>
          </div>
        </div>

        {state.special_events_raw ? (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <strong>Special Events</strong>
            <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
              {state.special_events_raw}
            </div>
          </div>
        ) : null}

        {state.notes ? (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <strong>Notes</strong>
            <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{state.notes}</div>
          </div>
        ) : null}

        {attendee && formatCancellationDetail(attendee) ? (
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
            <div style={{ marginTop: 4 }}>{formatCancellationDetail(attendee)}</div>
          </div>
        ) : null}
      </details>
    </div>
  );

  const editBody = (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Feedback belongs with the record, not only a page-level banner
          (Stage D requirement 7). aria-live announces saving/saved/
          validation/conflict state to assistive technology as it changes. */}
      <div aria-live="polite" role={conflict ? "alert" : "status"}>
        {conflict ? (
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid #f59e0b",
              background: "#fffbeb",
              color: "#92400e",
              fontSize: 13,
            }}
          >
            <strong>Record changed elsewhere.</strong> {conflict}
            <div style={{ marginTop: 8 }}>
              <AppButton variant="warning" onClick={onReloadRecord}>
                Reload Current Record
              </AppButton>
            </div>
          </div>
        ) : saving ? (
          <div style={{ fontSize: 13, color: "#475569" }}>Saving...</div>
        ) : saveFeedback ? (
          <div
            style={{
              fontSize: 13,
              color: saveFeedback.startsWith("Save failed") ? "#b91c1c" : "#166534",
            }}
          >
            {saveFeedback}
          </div>
        ) : isDirty ? (
          <div style={{ fontSize: 13, color: "#92400e" }}>
            Unsaved changes{dirtySections.length > 0 ? " in: " : ""}
            {dirtySections
              .map(
                (id) =>
                  ATTENDEE_EDIT_SECTIONS.find((section) => section.id === id)
                    ?.label ?? id,
              )
              .join(", ")}
          </div>
        ) : null}
      </div>

      <div style={sectionStyle}>
        {sectionHeading("identity", "Pilot Identity")}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {SECTION_TEXT_FIELDS.identity.map(renderTextField)}
        </div>
      </div>

      <div style={sectionStyle}>
        {sectionHeading("household", "Household")}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {SECTION_TEXT_FIELDS.household.map(renderTextField)}
        </div>
        {hasCopilotNow ? (
          <div style={{ marginTop: 10 }}>
            <AppButton
              variant="danger"
              onClick={() => void onRemoveHouseholdMember("copilot")}
            >
              Remove Co-Pilot
            </AppButton>
          </div>
        ) : null}

        <div style={{ marginTop: 14 }}>
          <AppButton
            onClick={() => setShowAdditionalParticipant((current) => !current)}
            style={{ width: "100%" }}
          >
            {showAdditionalParticipant
              ? "− Hide Additional Participant"
              : "+ Add Additional Participant"}
          </AppButton>
        </div>

        {/* Responsive auto-fit grid, not a fixed 5-column layout, so it
            never forces horizontal overflow on phone/tablet widths
            (Refactor Audit E.1 / Test Expectation M). */}
        {showAdditionalParticipant ? (
          <div
            style={{
              marginTop: 14,
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
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
        ) : null}
        {hasAdditionalNow ? (
          <div style={{ marginTop: 10 }}>
            <AppButton
              variant="danger"
              onClick={() => void onRemoveHouseholdMember("additional")}
            >
              Remove Additional Participant
            </AppButton>
          </div>
        ) : null}
      </div>

      <div style={sectionStyle}>
        {sectionHeading("contact", "Contact")}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {SECTION_TEXT_FIELDS.contact.map(renderTextField)}
        </div>
      </div>

      <div style={sectionStyle}>
        {sectionHeading("location", "Location")}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {SECTION_TEXT_FIELDS.location.map(renderTextField)}
        </div>
      </div>

      <div style={sectionStyle}>
        {sectionHeading("coach", "Coach & Logistics")}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {SECTION_TEXT_FIELDS.coach.map(renderTextField)}
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
        </div>
      </div>

      <div style={sectionStyle}>
        {sectionHeading("registration", "Registration")}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {SECTION_TEXT_FIELDS.registration.map(renderTextField)}
        </div>
        <div
          style={{
            marginTop: 14,
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            alignItems: "end",
          }}
        >
          <div>
            <label style={labelStyle}>Registration Capacity</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
          <div>
            <label style={checkLabelStyle}>
              <input
                type="checkbox"
                checked={state.is_active}
                onChange={(e) => onChange("is_active", e.target.checked)}
              />
              Active Record
            </label>
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

      <div style={sectionStyle}>
        {sectionHeading("notes", "Notes")}
        <textarea
          value={state.notes}
          onChange={(e) => onChange("notes", e.target.value)}
          style={textareaStyle}
          rows={4}
        />
      </div>
    </div>
  );

  const primaryActions =
    viewState === "view" ? (
      <>
        <button
          type="button"
          onClick={onEnterEdit}
          style={primaryButtonStyle}
          disabled={!canEdit}
        >
          Edit
        </button>
        <button
          type="button"
          disabled={!canEdit || !attendee}
          onClick={() => attendee && void onUpdateDataStatus(attendee.id, "reviewed")}
          style={secondaryButtonStyle}
        >
          Mark Reviewed
        </button>
        <button
          type="button"
          disabled={!canEdit || !attendee}
          onClick={() => attendee && void onCancelRegistration(attendee)}
          style={secondaryButtonStyle}
        >
          Cancel Registration
        </button>
      </>
    ) : (
      <>
        <button
          type="button"
          onClick={() => void onSave()}
          style={primaryButtonStyle}
          disabled={saving || !canEdit || !!conflict}
        >
          {saving
            ? "Saving..."
            : mode === "create"
              ? "Create Attendee"
              : "Save Changes"}
        </button>
        {mode === "edit" ? (
          <button
            type="button"
            onClick={onCancelEdit}
            style={secondaryButtonStyle}
            disabled={saving}
          >
            Cancel Edit
          </button>
        ) : null}
      </>
    );

  const secondaryActions =
    viewState === "view" && mode === "edit" && attendee ? (
      <>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => void onUpdateDataStatus(attendee.id, "locked")}
          style={secondaryButtonStyle}
        >
          Lock Record
        </button>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => void onUpdateDataStatus(attendee.id, "pending")}
          style={secondaryButtonStyle}
        >
          Back To Pending
        </button>
      </>
    ) : null;

  return (
    <ObjectPanel
      open={open}
      onClose={onClose}
      title={titleText}
      subtitle={subtitleText}
      primaryActions={primaryActions}
      secondaryActions={secondaryActions}
      onPrevious={viewState === "view" ? onPrevious : undefined}
      onNext={viewState === "view" ? onNext : undefined}
    >
      {viewState === "view" ? viewBody : editBody}
    </ObjectPanel>
  );
}

function AdminAttendeesPageInner() {
  console.count("ATTENDEES RENDER");
  const storedPrefs = useMemo(() => getStoredAttendeeCommandCenterPrefs(), []);
  const { admin } = useAdmin();
  const adminRef = useRef(admin);

  // UI defense-in-depth only -- this does not replace backend
  // authorization (RLS, cut over to
  // has_event_task_authority('event.attendees.manage', event_id), remains
  // the actual enforcement boundary). Event-scoped, matching the shared
  // checkAdminEventTaskAuthority helper AdminRouteGuard/Reports/Print
  // already use, rather than the page-wide, Event-agnostic
  // hasPermission(admin, "can_edit_attendees") this replaces for mutation
  // capability specifically -- can_edit_attendees remains, unchanged, the
  // page-wide read/navigation gate below. Starts false and stays false
  // until an exact "allowed" result resolves, so every mutation control
  // wired to canEditAttendees fails closed while the check is in flight,
  // on an Event switch, or on any error -- never optimistically enabled.
  const [canEditAttendees, setCanEditAttendees] = useState(false);
  const attendeeManageCheckGeneration = useRef(0);

  const runAttendeeManageAuthorityCheck = useCallback(() => {
    const generation = ++attendeeManageCheckGeneration.current;
    const eventId = getCurrentAdminEvent()?.id ?? null;

    // Reset before the async check resolves: a prior Event's "allowed"
    // must never remain rendered while the new Event's authority is
    // still unresolved.
    setCanEditAttendees(false);

    if (!eventId) {
      return;
    }

    void checkAdminEventTaskAuthority("event.attendees.manage", eventId).then(
      (result) => {
        if (attendeeManageCheckGeneration.current === generation) {
          setCanEditAttendees(result.status === "allowed");
        }
      },
    );
  }, []);

  useEffect(() => {
    runAttendeeManageAuthorityCheck();

    return subscribeToAdminWorkspace(runAttendeeManageAuthorityCheck);
  }, [runAttendeeManageAuthorityCheck]);

  useEffect(() => {
    adminRef.current = admin;
  }, [admin]);

  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  // Canonical Event Operational Summary Read Contract --
  // docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md. Roster
  // Summary's Total Registrations/Active/Arrived cards are copied verbatim
  // from this; never independently recomputed from `attendees`.
  const [operationalSummary, setOperationalSummary] =
    useState<CanonicalEventOperationalSummary | null>(null);
  const [operationalSummaryError, setOperationalSummaryError] = useState<
    string | null
  >(null);
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
  // Stage C: exactly one focused record workspace owns the selected
  // attendee. editorOpen/editorMode track whether the workspace is open and
  // whether it is creating a brand-new record vs working with an existing
  // one; viewState tracks the separate Understand/Act distinction --
  // selecting a record always starts at "view", never "edit".
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [viewState, setViewState] = useState<"view" | "edit">("view");
  const [editorState, setEditorState] = useState<AttendeeEditorState>(
    emptyAttendeeEditorState(),
  );
  const [editorSaving, setEditorSaving] = useState(false);
  const [operationalStatus, setOperationalStatus] = useState<CanonicalAttendeePlacementResult | null>(null);
  // Which flagged/browse list the workspace was opened from, so Next/
  // Previous inside it continue through the same order the operator was
  // already browsing rather than a second, re-derived order.
  const [workspaceListContext, setWorkspaceListContext] = useState<
    "review" | "browse"
  >("browse");

  const [showReviewQueue, setShowReviewQueue] = useState(false);

  // Stage D: dirty-state and same-record concurrency tracking. editorBaseline
  // is the editor state exactly as loaded (selectAttendee/openCreate); the
  // operator's live edits are editorState. Refs mirror the state React needs
  // for rendering so loadQueue's realtime-triggered reconciliation (a stable
  // useCallback) always reads the current value rather than a stale closure.
  const [editorBaseline, setEditorBaseline] = useState<AttendeeEditorState>(
    emptyAttendeeEditorState(),
  );
  const [selectedConflict, setSelectedConflict] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const editorStateRef = useRef(editorState);
  const editorOpenRef = useRef(editorOpen);
  const editorModeRef = useRef(editorMode);
  const isDirtyRef = useRef(false);
  const selectedBaselineFingerprintRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);

  const isDirty = useMemo(
    () => editorMode === "edit" && editorStateIsDirty(editorBaseline, editorState),
    [editorMode, editorBaseline, editorState],
  );
  const dirtySections = useMemo(
    () => dirtySectionIds(editorBaseline, editorState),
    [editorBaseline, editorState],
  );

  useEffect(() => {
    editorStateRef.current = editorState;
  }, [editorState]);
  useEffect(() => {
    editorOpenRef.current = editorOpen;
  }, [editorOpen]);
  useEffect(() => {
    editorModeRef.current = editorMode;
  }, [editorMode]);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // Canonical accessible confirmation pattern (components/ui/ConfirmDialog),
  // used for every consequential Attendees action instead of window.confirm
  // (Stage D requirement 4). One shared dialog instance; confirmViaDialog
  // resolves a Promise<boolean> so existing linear async save/action flows
  // can `await` it exactly where window.confirm used to sit.
  const [confirmDialogState, setConfirmDialogState] = useState<{
    title: string;
    message: string;
    danger?: boolean;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);

  function confirmViaDialog(
    title: string,
    message: string,
    danger = false,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmDialogState({ title, message, danger });
    });
  }

  function resolveConfirmDialog(result: boolean) {
    setConfirmBusy(false);
    setConfirmDialogState(null);
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    resolve?.(result);
  }

  const loadQueue = useCallback(async (
    eventId: string,
    options: { silent?: boolean } = {},
  ) => {
    const generation = ++loadGenerationRef.current;
    try {
      if (!options.silent) {
        setLoading(true);
        setError(null);
        setStatus("Loading attendee records...");
      }

      const [
        { data: attendeeData, error: attendeeError },
        { data: rulesData, error: rulesError },
        summaryResult,
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
        fetchEventOperationalSummary(eventId),
      ]);

      if (attendeeError) {
        throw attendeeError;
      }
      if (rulesError) {
        throw rulesError;
      }

      if (generation !== loadGenerationRef.current) {
        // A newer load has already started (event switch, refresh); this
        // response is stale and must never overwrite newer state.
        return undefined;
      }

      const nextAttendees = (attendeeData || []) as AttendeeRow[];
      const nextRules = (rulesData || []) as ValidationRule[];

      setAttendees(nextAttendees);
      setRules(nextRules);

      if (summaryResult.ok) {
        setOperationalSummary(summaryResult.summary);
        setOperationalSummaryError(null);
      } else {
        // Fail visibly: never substitute a locally recomputed Event
        // aggregate when the canonical summary call fails or is denied.
        setOperationalSummary(null);
        setOperationalSummaryError(
          summaryResult.reason === "authorization_denied"
            ? "You do not have access to the operational summary for this event."
            : summaryResult.message,
        );
      }

      // Stage D requirements 5/6: reconcile the open workspace, if any,
      // against this freshly-loaded roster. A different attendee changing
      // never touches editorState here (it is separate local state), so
      // requirement G already holds structurally; this only ever concerns
      // the one attendee currently selected.
      if (editorOpenRef.current && editorModeRef.current === "edit") {
        const openId = editorStateRef.current.id;
        const serverRow = openId
          ? nextAttendees.find((row) => row.id === openId)
          : null;

        if (openId && !serverRow) {
          // The selected record is no longer in this event's roster --
          // deleted, or (ADR-006 §2) the admin working Event changed
          // underneath the open workspace. Never silently retarget or keep
          // displaying it as though it were still current: fail visibly.
          setSelectedConflict(null);
          closeAttendeeEditorForUnavailableRecord();
        } else if (serverRow) {
          const serverFingerprint = attendeeConcurrencyFingerprint(serverRow);
          if (
            attendeeChangedRemotelyWhileDirty(
              selectedBaselineFingerprintRef.current,
              serverFingerprint,
              isDirtyRef.current,
            )
          ) {
            setSelectedConflict(
              "This attendee's record changed elsewhere. Review the current server record before saving your changes.",
            );
          }
        }
      }

      if (!options.silent) {
        setStatus(
          `Ready. ${nextAttendees.length} attendee${
            nextAttendees.length === 1 ? "" : "s"
          } loaded. ${nextRules.length} validation rule${
            nextRules.length === 1 ? "" : "s"
          } active.`,
        );
      }

      return nextAttendees;
    } catch (err: any) {
      console.error("loadQueue error:", err);
      if (generation === loadGenerationRef.current) {
        setError(err?.message || "Could not load attendee records.");
        setStatus("Load failed.");
        if (!options.silent) {
          setAttendees([]);
          setRules([]);
          setOperationalSummary(null);
          setOperationalSummaryError(null);
        }
      }
      return undefined;
    } finally {
      if (generation === loadGenerationRef.current && !options.silent) {
        setLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setOperationalSummary(null);
      setOperationalSummaryError(null);
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
      setOperationalSummary(null);
      setOperationalSummaryError(null);
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
      setOperationalSummary(null);
      setOperationalSummaryError(null);
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
      setOperationalSummary(null);
      setOperationalSummaryError(null);
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

  // Stage D requirement 5: same-record concurrency protection. Reuses the
  // architectural lesson already proven by Check-In/Parking (a realtime
  // subscription silently reloading in the background, reconciled against
  // whatever is currently selected) -- scoped here to the `attendees` table
  // only, since Attendees owns none of Check-In's or Parking's own tables.
  useEffect(() => {
    if (!currentEvent?.id) {
      return;
    }

    const channel = supabase
      .channel(`admin-attendees-${currentEvent.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attendees",
          filter: `event_id=eq.${currentEvent.id}`,
        },
        () => {
          void loadQueue(currentEvent.id!, { silent: true });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // loadQueue is intentionally omitted to avoid resubscribing on every reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEvent?.id]);

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

  // Single owner of "what is flagged" (Refactor Audit Q13/C):
  // computeReviewItems is the one governed computation both the Review
  // Queue and fullyValidCount below derive from -- neither recomputes it
  // independently.
  const reviewItems = useMemo(
    () => computeReviewItems(attendees, rules, currentEvent?.id || null),
    [attendees, rules, currentEvent?.id],
  );

  const filteredReviewItems = useMemo(() => {
    const flaggedFiltered = filterAttendees(
      reviewItems.map((item) => item.attendee),
      reviewItems,
      { search, dataStatusFilter, participantTypeFilter, viewMode },
    );
    const flaggedIds = new Set(flaggedFiltered.map((row) => row.id));
    return sortReviewItems(
      reviewItems.filter((item) => flaggedIds.has(item.attendee.id)),
    );
  }, [reviewItems, search, dataStatusFilter, participantTypeFilter, viewMode]);

  const visibleReviewItems = useMemo(() => {
    if (pageSize === "all") {
      return filteredReviewItems;
    }
    return filteredReviewItems.slice(0, Number(pageSize));
  }, [filteredReviewItems, pageSize]);

  const filteredAttendees = useMemo(() => {
    const rows = filterAttendees(attendees, reviewItems, {
      search,
      dataStatusFilter,
      participantTypeFilter,
      viewMode,
    });

    return sortAttendees(rows, attendeeSortMode);
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
    void selectAttendeeForEdit(attendee);
    // selectAttendeeForEdit is intentionally omitted because it is declared later in this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendees, editorOpen]);
  const correctedCount = useMemo(() => {
    return attendees.filter(
      (row) => dataStatusLabel(row.data_status) === "corrected",
    ).length;
  }, [attendees]);

  // Derived from the same reviewItems computeReviewItems already produced
  // above -- not a second, independently re-run validation pass (Refactor
  // Audit Section C: this previously duplicated the Review Queue's own
  // flagging logic).
  const fullyValidCount = useMemo(
    () => attendees.length - reviewItems.length,
    [attendees.length, reviewItems.length],
  );

  // Stage B (Refactor Audit Section F): one consolidated Roster Summary
  // replaces the former "Attendee Management" tiles, "Data Review" tiles,
  // and Review Queue status, which previously showed overlapping counts
  // in three places. Primary tiles stay always visible; the rest live
  // behind progressive disclosure so the browse surface stays operational,
  // not a dashboard.
  //
  // Total Registrations/Active/Arrived are Event-wide canonical facts, per
  // docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md's Canonical
  // Event Operational Summary Read Contract: copied verbatim from
  // operationalSummary, never recomputed from the local `attendees` roster.
  // A failed/denied canonical read shows visibly (operationalSummaryError)
  // instead of silently falling back to a local count. Flagged remains
  // Attendees-owned, sourced from computeReviewItems above.
  const primarySummaryItems = useMemo<SummaryCardItem[]>(
    () => [
      {
        label: "Total Registrations",
        value: operationalSummary
          ? operationalSummary.totalRegistrations
          : operationalSummaryError || "Unavailable",
      },
      {
        label: "Active",
        value: operationalSummary
          ? operationalSummary.activeRegistrations
          : operationalSummaryError || "Unavailable",
      },
      { label: "Flagged", value: reviewItems.length },
      {
        label: "Arrived",
        value: operationalSummary
          ? operationalSummary.activeArrived
          : operationalSummaryError || "Unavailable",
      },
    ],
    [operationalSummary, operationalSummaryError, reviewItems.length],
  );

  const secondarySummaryItems = useMemo<SummaryCardItem[]>(
    () => [
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
      { label: "Membership Corrected", value: correctedCount },
      { label: "Fully Valid", value: fullyValidCount },
    ],
    [attendees, correctedCount, fullyValidCount],
  );

  async function saveMembershipNumber(item: ReviewItem) {
    const draftValue = normalizeMemberNumber(
      drafts[item.attendee.id] ?? item.attendee.membership_number,
    );

    if (!draftValue) {
      setError("Membership number cannot be blank.");
      setStatus("Correction not saved.");
      return;
    }

    const membershipIssue = validateField(
      "membership_number",
      draftValue,
      rules,
      currentEvent?.id,
    );
    if (membershipIssue) {
      setError(membershipIssue.issue);
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

      showFlash(`${displayPilotName(item.attendee)} corrected successfully.`);
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

      // Keep the open workspace's own display in sync with this quick
      // action rather than letting it silently drift from what was just
      // persisted -- this is the operator's own change, not a remote one,
      // so it updates both state and baseline (never appears "dirty").
      if (editorState.id === attendeeId) {
        setEditorState((prev) => ({ ...prev, data_status: nextStatus }));
        setEditorBaseline((prev) => ({ ...prev, data_status: nextStatus }));
      }

      setStatus("Status update complete.");
      showFlash(`Status set to ${nextStatus}.`);
    } catch (err: any) {
      console.error("updateDataStatus error:", err);
      setError(err?.message || "Could not update attendee status.");
      setStatus("Status update failed.");
    }
  }
  async function onCancelRegistration(attendee: AttendeeRow) {
    const confirmed = await confirmViaDialog(
      "Cancel registration?",
      `Cancel the registration for ${displayPilotName(attendee)}? This marks the registration as cancelled but does not delete any history.`,
      true,
    );

    if (!confirmed) {
      return;
    }

    try {
      setError(null);
      setStatus("Cancelling registration...");

      const { error } = await supabase
        .from("attendees")
        .update({
          registration_status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancelled_by: admin?.adminUser?.id ?? null,
          cancellation_reason: "Cancelled by Admin",
        })
        .eq("id", attendee.id);

      if (error) {
        throw error;
      }

      showFlash("Registration cancelled.");

      if (currentEvent?.id) {
        await loadQueue(currentEvent.id);
      }
    } catch (err: any) {
      console.error("onCancelRegistration error:", err);
      setError(err?.message ?? "Could not cancel registration.");
      setStatus("Cancellation failed.");
    }
  }

  // Helper to sync pilot/copilot/additional household members for an attendee.
  // Every write goes through the governed manage_attendee_household_member
  // RPC (event derivation, authorization, mutation, and audit all happen
  // server-side and atomically) rather than a direct table upsert/delete --
  // see 20260818160000_govern_admin_household_member_mutations.sql.
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
      // 1. Query attendee_household_members for this attendee -- read-only,
      //    used only to decide whether a cleared copilot/additional role
      //    should upsert or delete; the RPC itself resolves created-vs-
      //    updated server-side.
      const { data: memberRows, error: memberError } = await supabase
        .from("attendee_household_members")
        .select("id, person_role")
        .eq("attendee_id", attendeeId);
      if (memberError) {
        throw memberError;
      }
      const copilotRow = memberRows?.find(
        (row: any) => row.person_role === "copilot",
      );
      const additionalRow = memberRows?.find(
        (row: any) => row.person_role === "additional",
      );

      // 2. Upsert the pilot row. Never deleted.
      await supabase.rpc("manage_attendee_household_member", {
        p_attendee_id: attendeeId,
        p_person_role: "pilot",
        p_delete: false,
        p_first_name: payload.pilot_first || null,
        p_last_name: payload.pilot_last || null,
        p_nickname: payload.nickname || null,
        p_email: payload.email || null,
      });

      // 3. Handle copilot logic. Skipped only when the capacity-increase RPC
      //    owns the Co-Pilot row for this save.
      const hasCopilot =
        !!payload.copilot_first ||
        !!payload.copilot_last ||
        !!payload.copilot_email;
      if (rpcOwnedParticipantRole !== "copilot") {
        if (hasCopilot) {
          await supabase.rpc("manage_attendee_household_member", {
            p_attendee_id: attendeeId,
            p_person_role: "copilot",
            p_delete: false,
            p_first_name: payload.copilot_first || null,
            p_last_name: payload.copilot_last || null,
            p_nickname: payload.copilot_nickname || null,
            p_email: payload.copilot_email || null,
          });
        } else if (copilotRow) {
          // 4. If no copilot info but copilot row exists, delete only the copilot row
          await supabase.rpc("manage_attendee_household_member", {
            p_attendee_id: attendeeId,
            p_person_role: "copilot",
            p_delete: true,
          });
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
          await supabase.rpc("manage_attendee_household_member", {
            p_attendee_id: attendeeId,
            p_person_role: "additional",
            p_delete: false,
            p_first_name: editorState.additional_first_name || null,
            p_last_name: editorState.additional_last_name || null,
            p_nickname: editorState.additional_nickname || null,
            p_email: editorState.additional_email || null,
            p_cell_phone: editorState.additional_cell_phone || null,
          });
        } else if (additionalRow) {
          await supabase.rpc("manage_attendee_household_member", {
            p_attendee_id: attendeeId,
            p_person_role: "additional",
            p_delete: true,
          });
        }
      }
      // 5. Do not touch any other person_role rows
    } catch (err) {
      console.error("syncHouseholdMembers error", err);
    }
  }

  function openCreateAttendeeEditor() {
    const blank = emptyAttendeeEditorState();
    setEditorMode("create");
    setEditorState(blank);
    setEditorBaseline(blank);
    setSelectedConflict(null);
    setSaveFeedback(null);
    selectedBaselineFingerprintRef.current = null;
    // Create has nothing yet to view -- it legitimately starts in edit
    // mode. Stage C's "selecting never implies edit mode" rule governs
    // *existing* records; there is no existing record here to browse first.
    setViewState("edit");
    setEditorOpen(true);
  }

  // Stage C: the single entry point for selecting an existing attendee.
  // Always opens the one focused record workspace in VIEW mode -- entering
  // edit mode is always a separate, deliberate follow-up action
  // (enterEditMode below), never automatic.
  const selectAttendee = useCallback(
    async (
      attendee: AttendeeRow,
      options: { listContext?: "review" | "browse" } = {},
    ) => {
      setEditorMode("edit");
      setViewState("view");
      setWorkspaceListContext(options.listContext ?? "browse");

      const nextState = attendeeToEditorState(attendee);
      setOperationalStatus(null);
      if (currentEvent?.id) {
        void fetchCanonicalAttendeePlacement(currentEvent.id, attendee.id).then(
          setOperationalStatus,
        );
      }

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
      setEditorBaseline(nextState);
      setSelectedConflict(null);
      setSaveFeedback(null);
      selectedBaselineFingerprintRef.current = attendeeConcurrencyFingerprint(attendee);
      setEditorOpen(true);
    },
    [currentEvent?.id],
  );

  // Deep-link handoff from other modules (Imports) that intentionally
  // requests edit mode directly, distinct from ordinary browse selection.
  const selectAttendeeForEdit = useCallback(
    async (attendee: AttendeeRow) => {
      await selectAttendee(attendee);
      setViewState("edit");
    },
    [selectAttendee],
  );

  function enterEditMode() {
    setViewState("edit");
  }

  // Discards any in-progress edits and returns to the read-only view of the
  // same record. Dirty edits require deliberate confirmation before being
  // discarded (Stage D: editing/viewing are reversible, but never silently).
  async function cancelEditToView() {
    if (isDirty) {
      const confirmed = await confirmViaDialog(
        "Discard unsaved changes?",
        "You have unsaved changes on this record. Discard them and return to the saved version?",
        true,
      );
      if (!confirmed) {
        return;
      }
    }

    if (editorMode === "create") {
      closeAttendeeEditor();
      return;
    }
    const attendee = attendees.find((row) => row.id === editorState.id);
    if (attendee) {
      void selectAttendee(attendee, { listContext: workspaceListContext });
    } else {
      closeAttendeeEditor();
    }
  }

  function closeAttendeeEditor() {
    setEditorOpen(false);
    setEditorMode("create");
    setViewState("view");
    setEditorState(emptyAttendeeEditorState());
    setEditorBaseline(emptyAttendeeEditorState());
    setSelectedConflict(null);
    setSaveFeedback(null);
    selectedBaselineFingerprintRef.current = null;
  }

  // Requested close via the workspace's own close control/Escape/backdrop
  // (ObjectPanel's onClose) -- distinct from closeAttendeeEditor itself so a
  // dirty edit is never silently discarded by an incidental dismissal.
  async function requestCloseAttendeeEditor() {
    if (isDirty) {
      const confirmed = await confirmViaDialog(
        "Discard unsaved changes?",
        "You have unsaved changes on this record. Close and discard them?",
        true,
      );
      if (!confirmed) {
        return;
      }
    }
    closeAttendeeEditor();
  }

  // Stage D requirement 6 (ADR-006 §2): the selected record became
  // unavailable in this event's roster -- deleted, or the admin working
  // Event changed underneath the open workspace. Never silently retarget or
  // continue showing it as current; close and say so explicitly.
  function closeAttendeeEditorForUnavailableRecord() {
    closeAttendeeEditor();
    setError(
      "The record you had open is no longer available in the current event. It may have been removed, or your admin working event changed.",
    );
    setStatus("Record unavailable.");
  }

  function updateEditorField<K extends keyof AttendeeEditorState>(
    key: K,
    value: AttendeeEditorState[K],
  ) {
    // Deactivation is a meaningful state change and gets the canonical
    // confirmation pattern (Stage D requirement 4); the checkbox does not
    // visually move until the operator confirms. Reactivating is reversible
    // and safe, so it is not gated the same way.
    if (key === "is_active" && editorState.is_active === true && value === false) {
      void confirmViaDialog(
        "Deactivate this record?",
        `Mark ${displayPilotName({ pilot_first: editorState.pilot_first, pilot_last: editorState.pilot_last } as AttendeeRow) || "this attendee"} as an inactive record? It can be reactivated later.`,
        true,
      ).then((confirmed) => {
        if (confirmed) {
          setEditorState((prev) => ({ ...prev, is_active: false }));
        }
      });
      return;
    }

    setEditorState((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  // Explicit household-member removal (Stage D requirement 3): a discoverable,
  // deliberate action rather than an incidental consequence discovered only
  // at Save time. Clearing the fields still goes through the exact same
  // Save-time confirmation (buildHouseholdRemovalConfirmMessage) as a safety
  // net for any other path that clears them.
  async function removeHouseholdMember(role: "copilot" | "additional") {
    const name =
      role === "copilot"
        ? editorState.copilot_name_at_load ||
          fullName(editorState.copilot_first, editorState.copilot_last) ||
          "the Co-Pilot"
        : editorState.additional_name_at_load ||
          fullName(
            editorState.additional_first_name,
            editorState.additional_last_name,
          ) ||
          "the Additional Participant";

    const confirmed = await confirmViaDialog(
      "Remove household member?",
      `Remove ${name} (${role === "copilot" ? "Co-Pilot" : "Additional Participant"}) from this attendee record? This clears their fields; Save will then permanently remove them as a household member. This cannot be undone from here.`,
      true,
    );

    if (!confirmed) {
      return;
    }

    setEditorState((prev) =>
      role === "copilot"
        ? {
            ...prev,
            copilot_first: "",
            copilot_last: "",
            copilot_nickname: "",
            copilot_email: "",
            copilot_cell_phone: "",
          }
        : {
            ...prev,
            additional_first_name: "",
            additional_last_name: "",
            additional_nickname: "",
            additional_email: "",
            additional_cell_phone: "",
          },
    );
  }

  // Continuous operation (Stage C requirement 8): Next/Previous inside the
  // workspace move through whichever list the operator was already
  // browsing -- the filtered Review Queue when reviewing, the filtered/
  // sorted Attendee List otherwise -- rather than resetting their place.
  const workspaceOrder = useMemo(
    () =>
      workspaceListContext === "review"
        ? filteredReviewItems.map((item) => item.attendee)
        : filteredAttendees,
    [workspaceListContext, filteredReviewItems, filteredAttendees],
  );

  function goToWorkspaceOffset(delta: number) {
    const currentId = editorState.id;
    const index = workspaceOrder.findIndex((row) => row.id === currentId);
    if (index === -1) {
      return;
    }
    const next = workspaceOrder[index + delta];
    if (next) {
      void selectAttendee(next, { listContext: workspaceListContext });
    }
  }

  const workspaceOrderIndex = workspaceOrder.findIndex(
    (row) => row.id === editorState.id,
  );
  const canGoPrevious = workspaceOrderIndex > 0;
  const canGoNext =
    workspaceOrderIndex > -1 && workspaceOrderIndex < workspaceOrder.length - 1;

  async function handleSaveAttendeeRecord() {
    if (!currentEvent?.id) {
      setError("No event selected.");
      setStatus("Save blocked.");
      return;
    }

    // Stage D requirement 5: a same-record remote change while dirty must
    // never become last-write-wins. Re-checked here (not only via the
    // disabled Save button) so a save already in flight when a conflict
    // appears cannot slip through.
    if (selectedConflict) {
      setStatus("Save blocked: reload the current record first.");
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
      const confirmedRemoval = await confirmViaDialog(
        "Remove household member?",
        buildHouseholdRemovalConfirmMessage(pendingRemovals),
        true,
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
      setSaveFeedback(
        editorMode === "create"
          ? "Creating attendee record..."
          : "Saving attendee record...",
      );
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
        participant_type: editorState.participant_type.trim() || "attendee",
        primary_phone: editorState.primary_phone.trim() || null,
        cell_phone: editorState.cell_phone.trim() || null,
        coach_manufacturer: editorState.coach_manufacturer.trim() || null,
        coach_model: editorState.coach_model.trim() || null,
        special_events_raw: editorState.special_events_raw.trim() || null,
        wants_to_volunteer: editorState.wants_to_volunteer,
        is_first_timer: editorState.is_first_timer,
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
                participant_type: payload.participant_type,
                primary_phone: payload.primary_phone,
                cell_phone: payload.cell_phone,
                coach_manufacturer: payload.coach_manufacturer,
                coach_model: payload.coach_model,
                special_events_raw: payload.special_events_raw,
                wants_to_volunteer: payload.wants_to_volunteer,
                is_first_timer: payload.is_first_timer,
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
          computeReviewItems(updatedAttendees, rules, currentEvent.id),
        ).filter((item) => item.attendee.id !== savedAttendeeId);

        const nextReviewItem = remainingReviewItems[0];

        if (nextReviewItem) {
          // Continuous review operation (Stage C requirement 8): advance to
          // the next flagged record automatically, but -- per Stage C's own
          // "selecting never implies edit mode" rule -- in VIEW mode, not
          // edit. (This corrects a pre-existing defect where the previous
          // implementation opened the next item and then unconditionally
          // closed the editor again immediately afterward, silently
          // discarding the auto-advance the code around it described.)
          await selectAttendee(nextReviewItem.attendee, {
            listContext: "review",
          });
          showFlash("Saved. Next review record loaded.");
        } else {
          closeAttendeeEditor();
          showFlash("Saved. Review queue is clear.");
        }
      } else if (editorMode === "edit") {
        // Non-review edit saves: return to the read-only view of the same
        // record so the persisted truth is visible and browse context is
        // retained, rather than forcing a full close/reopen (Stage D
        // continuous-operation requirement).
        setViewState("view");
      } else {
        // Create: nothing existed to "view" before this save: close back
        // to browse, as before.
        closeAttendeeEditor();
      }

      // Refresh data in the background so the workspace and list reflect
      // the persisted record.
      const freshAttendees = await loadQueue(currentEvent.id);

      if (editorMode === "edit" && viewMode !== "review" && editorState.id) {
        // The operator's own just-saved values are the new resting point
        // (Stage D requirement 1: dirty-state resets on a clean save); the
        // fingerprint used to detect a *different* station's later change
        // comes from the server row this same save just produced.
        setEditorBaseline(editorState);
        const savedRow = freshAttendees?.find(
          (row) => row.id === editorState.id,
        );
        if (savedRow) {
          selectedBaselineFingerprintRef.current =
            attendeeConcurrencyFingerprint(savedRow);
        }
      }

      setSaveFeedback("Saved.");
    } catch (err: any) {
      console.error("handleSaveAttendeeRecord error:", err);
      setSaveFeedback(`Save failed: ${err?.message || "unknown error"}`);
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
          onRefresh={() => {
            if (currentEvent?.id) {
              void loadQueue(currentEvent.id);
            }
          }}
        />

        <div
          className="card"
          style={{ padding: 18, display: "grid", gap: 14 }}
        >
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Roster Summary</h2>
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              Operational counts for the selected event.
            </div>
          </div>

          <SummaryCards items={primarySummaryItems} />

          <details>
            <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
              More stats
            </summary>
            <div style={{ marginTop: 14 }}>
              <SummaryCards items={secondarySummaryItems} />
            </div>
          </details>
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
                void selectAttendee(firstReviewItem.attendee, {
                  listContext: "review",
                });
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

          {/* Stage B: the former standalone "Data Review" card's status
              breakdown now lives here, inside the one Review Queue toggle
              it always described, rather than as a second always-visible
              surface showing the same counts. */}
          {showReviewQueue ? (
            <div
              style={{
                marginTop: 14,
                display: "grid",
                gap: 10,
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              }}
            >
              {DATA_STATUS_OPTIONS.filter((option) => option !== "all").map(
                (option) => (
                  <div key={option} className="card" style={summaryCardStyle}>
                    <strong>{dataStatusOptionLabel(option)}</strong>
                    <div style={summaryValueStyle}>
                      {
                        attendees.filter(
                          (row) => dataStatusLabel(row.data_status) === option,
                        ).length
                      }
                    </div>
                  </div>
                ),
              )}
              <div className="card" style={summaryCardStyle}>
                <strong>Fully Valid</strong>
                <div style={summaryValueStyle}>{fullyValidCount}</div>
              </div>
            </div>
          ) : null}
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
            onSelect={(attendee) =>
              void selectAttendee(attendee, { listContext: "review" })
            }
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
          selectedAttendeeId={editorOpen ? editorState.id : null}
          onSelect={(attendee) =>
            void selectAttendee(attendee, { listContext: "browse" })
          }
          onUpdateDataStatus={updateDataStatus}
          onCancelRegistration={onCancelRegistration}
        />
      </>

      <AttendeeRecordWorkspace
        open={editorOpen}
        editorMode={editorMode}
        viewState={viewState}
        attendee={
          editorMode === "edit"
            ? attendees.find((row) => row.id === editorState.id) ?? null
            : null
        }
        state={editorState}
        reviewIssues={
          reviewItems.find((item) => item.attendee.id === editorState.id)
            ?.issues ?? []
        }
        saving={editorSaving}
        canEdit={canEditAttendees}
        isDirty={isDirty}
        dirtySections={dirtySections}
        conflict={selectedConflict}
        saveFeedback={saveFeedback}
        onClose={requestCloseAttendeeEditor}
        onChange={updateEditorField}
        onEnterEdit={enterEditMode}
        onCancelEdit={cancelEditToView}
        onSave={handleSaveAttendeeRecord}
        onReloadRecord={() => {
          const freshRow = attendees.find((row) => row.id === editorState.id);
          if (freshRow) {
            void selectAttendee(freshRow, { listContext: workspaceListContext });
          }
        }}
        onRemoveHouseholdMember={removeHouseholdMember}
        onUpdateDataStatus={updateDataStatus}
        onCancelRegistration={onCancelRegistration}
        onPrevious={canGoPrevious ? () => goToWorkspaceOffset(-1) : undefined}
        onNext={canGoNext ? () => goToWorkspaceOffset(1) : undefined}
        operationalStatus={operationalStatus}
      />

      <ConfirmDialog
        open={!!confirmDialogState}
        title={confirmDialogState?.title || ""}
        message={confirmDialogState?.message || ""}
        danger={confirmDialogState?.danger}
        busy={confirmBusy}
        onConfirm={() => {
          setConfirmBusy(true);
          resolveConfirmDialog(true);
        }}
        onCancel={() => resolveConfirmDialog(false)}
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

const summaryValueErrorStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  marginTop: 8,
  color: "#b91c1c",
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
