"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  additionalDraftHasData,
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
  decideCapacityReconciliation,
  deriveHouseholdPeople,
  dirtySectionIds,
  displayCopilotName,
  displayPilotName,
  editorStateIsDirty,
  emptyAttendeeEditorState,
  filterAttendees,
  formatCancellationDetail,
  fullName,
  householdParticipantDisplayName,
  type HouseholdParticipantDraft,
  type HouseholdPerson,
  makeAdditionalDraft,
  normalizeDataStatusFilter,
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
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
import { Alert } from "@/components/ui/Alert";
import { AppButton, AppLinkButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable, ResponsiveList } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { RowActions } from "@/components/ui/RowActions";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/StatusBadge";
import {
  SearchField,
  TableToolbar,
  TableToolbarDisclosure,
  TableToolbarPrimaryRow,
} from "@/components/ui/TableToolbar";
import { buildAdminAttendeeTargetHref } from "@/lib/adminAttendeeTarget";
import { useAdmin } from "@/lib/adminContext";
import { checkAdminEventTaskAuthority } from "@/lib/adminTaskAuthority";
import {
  getCurrentAdminEvent,
  resolveAdminWorkingEvent,
  setCurrentAdminEvent,
  subscribeToAdminWorkspace,
  useAdminWorkingEventScope,
} from "@/lib/adminWorkspaceContext";
import { withAdminReturnTarget } from "@/lib/adminWorkspaceReturn";
import {
  type CanonicalAttendeePlacementMap,
  type CanonicalAttendeePlacementResult,
  type CanonicalAttendeePlacementSite,
  fetchCanonicalAttendeePlacement,
  fetchCanonicalAttendeePlacementsForEvent,
} from "@/lib/canonicalAttendeePlacement";
import {
  type CanonicalEventOperationalSummary,
  fetchEventOperationalSummary,
} from "@/lib/eventOperationalSummary";
import { isActiveEventStatus } from "@/lib/eventStatus";
import { canAccessEvent, hasPermission } from "@/lib/getCurrentAdminAccess";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";

// Fixed audit note for the post-save capacity reconciliation
// (reconcileCapacityToMaterializedRoster). Written to
// participant_capacity_adjustments via record_participant_capacity_increase.
const CAPACITY_ROSTER_RECONCILE_NOTE =
  "Automatic reconciliation: participant_capacity raised to match the " +
  "participant roster already materialized in attendee_household_members " +
  "after an authorized attendee save.";

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

const ATTENDEE_COMMAND_CENTER_PREFS_KEY = STORAGE_KEYS.attendeeCommandCenterPrefs;

function getStoredAttendeeCommandCenterPrefs(): AttendeeCommandCenterPrefs {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = localStorage.getItem(ATTENDEE_COMMAND_CENTER_PREFS_KEY);
    if (!raw) {
      return {};
    }
    const prefs = JSON.parse(raw) as AttendeeCommandCenterPrefs;
    return {
      ...prefs,
      dataStatusFilter:
        prefs.dataStatusFilter === undefined
          ? undefined
          : normalizeDataStatusFilter(prefs.dataStatusFilter),
    };
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

  const activeFilterCount =
    (dataStatusFilter !== "all" ? 1 : 0) + (participantTypeFilter !== "all" ? 1 : 0);
  const hasClearableState = activeFilterCount > 0 || search.trim() !== "";

  function clearFilters() {
    setSearch("");
    setDataStatusFilter("all");
    setParticipantTypeFilter("all");
  }

  return (
    <TableToolbar>
      {/* Search and View are the two primary, always-visible browse
          decisions (Refactor Audit Section F). Every other filter here is
          secondary/low-frequency and lives behind the "More filters"
          disclosure below so it never competes with them for attention. */}
      <TableToolbarPrimaryRow>
        <SearchField
          label="Search"
          value={search}
          onChange={setSearch}
          id="attendee-search"
          placeholder="Search name, email, member #, site..."
        />

        <div>
          <label className="table-toolbar-label" htmlFor="attendee-view-mode">
            View
          </label>
          <select
            id="attendee-view-mode"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as ViewMode)}
          >
            <option value="active">Active Registrations</option>
            <option value="review">Flagged Active</option>
            <option value="cancelled">Cancelled Registrations</option>
            <option value="all">All Registrations</option>
          </select>
        </div>

        {hasClearableState ? (
          <div style={{ alignSelf: "end" }}>
            <AppButton onClick={clearFilters}>Clear Search &amp; Filters</AppButton>
          </div>
        ) : null}
      </TableToolbarPrimaryRow>

      <TableToolbarDisclosure label="More filters" activeCount={activeFilterCount}>
        <div>
          <label className="table-toolbar-label" htmlFor="attendee-page-size">
            Rows to Show
          </label>
          <select
            id="attendee-page-size"
            value={pageSize}
            onChange={(e) => setPageSize(e.target.value as PageSize)}
          >
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="all">Entire List</option>
          </select>
        </div>
        <div>
          <label className="table-toolbar-label" htmlFor="attendee-sort">
            Sort
          </label>
          <select
            id="attendee-sort"
            value={attendeeSortMode}
            onChange={(e) => setAttendeeSortMode(e.target.value as AttendeeSortMode)}
          >
            <option value="last_name">A–Z by Last Name</option>
            <option value="site">Group by Site</option>
          </select>
        </div>

        <div>
          <label className="table-toolbar-label" htmlFor="attendee-data-status">
            Data Status
          </label>
          <select
            id="attendee-data-status"
            value={dataStatusFilter}
            onChange={(e) => setDataStatusFilter(e.target.value as DataStatusFilter)}
          >
            <option value="all">All Statuses</option>
            {DATA_STATUS_OPTIONS.filter((option) => option !== "all").map((option) => (
              <option key={option} value={option}>
                {dataStatusOptionLabel(option)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="table-toolbar-label" htmlFor="attendee-participant-type">
            Participant Type
          </label>
          <select
            id="attendee-participant-type"
            value={participantTypeFilter}
            onChange={(e) => setParticipantTypeFilter(e.target.value as ParticipantTypeFilter)}
          >
            <option value="all">All Types</option>
            {PARTICIPANT_TYPE_OPTIONS.filter((option) => option !== "all").map((option) => (
              <option key={option} value={option}>
                {participantTypeLabel(option)}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={showResolvedInfo}
              onChange={(e) => setShowResolvedInfo(e.target.checked)}
            />
            Show auto-resolve note
          </label>
        </div>
      </TableToolbarDisclosure>

      {showResolvedInfo ? (
        <Alert tone="info">
          Once a membership number is corrected so it begins with <strong>F or C</strong>, the
          membership-number issue clears automatically. Records stay in the queue until all
          remaining flagged issues are resolved.
        </Alert>
      ) : null}
    </TableToolbar>
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

  // UI Phase 4: no longer sticky -- the TableToolbar below is the one
  // sticky-while-scrolling region on this page now (search/filter access
  // while scanning a long roster is the primary "stays reachable" need);
  // two independently sticky bars at the same viewport offset was the
  // kind of scattered, uncoordinated chrome this pass exists to remove.
  return (
    <FormActions>
      <AppButton variant="primary" onClick={onAddAttendee} disabled={!canEdit}>
        + Add Attendee
      </AppButton>

      <AppButton onClick={onRefresh}>Refresh</AppButton>
    </FormActions>
  );
}

// Shared action-button row for one attendee, used identically by both
// ReviewQueue and AttendeeList (previously two independently-drifted
// implementations -- one horizontal-scroll-only, one wrapping). Both
// consumers now share one layout, one responsive behavior, and one
// permission-gating rule. `showBackToPending` is the only legitimate
// difference between the two contexts. Review completion belongs in the
// Review Record workspace, where its review context is explicit.
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
  const name = displayPilotName(attendee);

  return (
    <RowActions>
      {/* Selecting only opens the record for viewing (Understand) --
          entering edit mode is always a separate, explicit action inside
          the workspace itself (Stage C). */}
      <AppButton onClick={() => onSelect(attendee)} aria-label={`View "${name}"'s record`}>
        View Record
      </AppButton>

      {/* Ends this registration's participation -- the one action in this
          row with real, consequential effect, so it alone gets the danger
          treatment (UI Phase 4, Part 8): routine status transitions never
          visually compete with it. */}
      <AppButton
        variant="danger"
        disabled={!canEdit}
        onClick={() => void onCancelRegistration(attendee)}
        aria-label={`Cancel "${name}"'s registration`}
      >
        Cancel Registration
      </AppButton>

      {showBackToPending ? (
        <AppButton
          disabled={!canEdit}
          onClick={() => void onUpdateDataStatus(attendee.id, "pending")}
          aria-label={`Move "${name}" back to pending`}
        >
          Back To Pending
        </AppButton>
      ) : null}
    </RowActions>
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
    <section style={{ display: "grid", gap: "var(--space-4)" }}>
      <PageHeader
        title="Review Queue"
        titleId="attendees-review-queue-heading"
        headingLevel="h2"
        titleClassName="app-section-title"
        description={`Showing ${visibleReviewItems.length} of ${filteredReviewItems.length} flagged attendee${filteredReviewItems.length === 1 ? "" : "s"} · Status filter: ${dataStatusFilter === "all" ? "All Statuses" : dataStatusOptionLabel(dataStatusFilter)} · Participant type: ${participantTypeFilter === "all" ? "All Types" : participantTypeLabel(participantTypeFilter)}`}
        descriptionClassName="app-subtle-text"
      />

      {loading ? (
        <LoadingState message="Loading review queue..." />
      ) : filteredReviewItems.length === 0 ? (
        // Success tone deliberately preserved (not EmptyState, which is
        // fixed at tone="neutral") -- an empty review queue is good news
        // worth a green signal, not a routine "nothing here" state.
        <Alert tone="success">No flagged records for this Event.</Alert>
      ) : (
        <ResponsiveList aria-labelledby="attendees-review-queue-heading">
          {visibleReviewItems.map((item) => {
            const attendee = item.attendee;
            const draftValue =
              drafts[attendee.id] ?? normalizeMemberNumber(attendee.membership_number);
            const saving = savingRowId === attendee.id;

            return (
              <li
                key={attendee.id}
                className={
                  "responsive-list-item" +
                  (item.severity === "error" ? " responsive-list-item-pinned" : "")
                }
              >
                <div className="responsive-list-item-header">
                  <div className="responsive-list-item-title">
                    {displayPilotName(attendee)}
                    {displayCopilotName(attendee) ? ` / ${displayCopilotName(attendee)}` : ""}
                  </div>
                  <div className="responsive-list-item-badges">
                    {attendee.registration_status === "cancelled" ? (
                      <StatusBadge tone="neutral">Cancelled</StatusBadge>
                    ) : null}
                    <StatusBadge tone={item.severity === "error" ? "danger" : "warning"}>
                      {item.severity.toUpperCase()}
                    </StatusBadge>
                  </div>
                </div>

                <div className="responsive-list-item-meta">
                  <span style={participantTypeBadgeStyle(attendee.participant_type)}>
                    {participantTypeLabel(attendee.participant_type)}
                  </span>
                  {attendee.email ? <span>{attendee.email}</span> : null}
                </div>

                <Alert tone={item.severity === "error" ? "danger" : "warning"}>
                  <div style={{ display: "grid", gap: "var(--space-2)" }}>
                    <strong>
                      {item.issues.length} issue{item.issues.length === 1 ? "" : "s"} found
                    </strong>
                    {item.issues.map((issue, index) => (
                      <div key={`${attendee.id}-${issue.field}-${index}`}>
                        <strong>{reviewFieldLabel(issue.field)}:</strong> {issue.issue}
                      </div>
                    ))}
                  </div>
                </Alert>

                <div className="app-form-grid-2">
                  <Field label="Correct Member Number">
                    {(controlProps) => (
                      <Input
                        {...controlProps}
                        value={draftValue}
                        onChange={(e) => onDraftChange(attendee.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !saving) {
                            e.preventDefault();
                            void onSaveMembership(item);
                          }
                        }}
                        placeholder="Must begin with F or C"
                        disabled={saving || !canEdit}
                      />
                    )}
                  </Field>

                  <div style={{ alignSelf: "end" }}>
                    <AppButton
                      variant="primary"
                      onClick={() => void onSaveMembership(item)}
                      disabled={saving || !canEdit}
                    >
                      {saving ? "Saving..." : "Save Correction"}
                    </AppButton>
                  </div>
                </div>

                <div className="responsive-list-item-meta">
                  <span>
                    Current stored value: <strong>{attendee.membership_number || "—"}</strong>
                  </span>
                  {attendee.entry_id ? <span>Entry ID: {attendee.entry_id}</span> : null}
                  {attendee.source_type ? <span>Source: {attendee.source_type}</span> : null}
                  <span>Data Status: {dataStatusLabel(attendee.data_status)}</span>
                </div>

                <AttendeeActionRow
                  attendee={attendee}
                  canEdit={canEdit}
                  showBackToPending
                  onSelect={onSelect}
                  onUpdateDataStatus={onUpdateDataStatus}
                  onCancelRegistration={onCancelRegistration}
                />
              </li>
            );
          })}
        </ResponsiveList>
      )}
    </section>
  );
}

// Stage C: the browse row itself is now purely a discovery surface (per
// docs/architecture/epicentrax-user-flow-and-native-interaction.md Article
// II) -- it scans and selects, but no longer tries to also be the "Understand"
// step. Selecting (row click or "View Record") always opens the one
// AttendeeRecordWorkspace in view mode; there is no separate inline expand
// panel to keep in sync with it.
// UI Phase 4: read-only Arrival straight from the already-loaded roster
// row (no query -- has_arrived is part of the generic attendee select
// already). Never writable from this page (Part 7/Non-negotiable
// architecture): Check-In alone owns Arrival mutation.
function attendeeArrivalPresentation(
  attendee: AttendeeRow,
): { label: string; tone: StatusBadgeTone } {
  return attendee.has_arrived
    ? { label: "Arrived", tone: "success" }
    : { label: "Not Arrived", tone: "neutral" };
}

// Owner-workspace handoff hrefs for one attendee. Attendees Management
// displays each status; the status control routes to the workspace that
// OWNS that truth (Check-In owns Arrival, Parking owns placement),
// targeted to this attendee and carrying a validated return target so the
// destination can offer "← Previous" back to Attendees. No Event switch
// travels with either link (ADR-006 §2).
function attendeeOwnerHrefs(attendeeId: string): {
  checkin: string;
  parking: string;
} {
  return {
    checkin: withAdminReturnTarget(
      buildAdminAttendeeTargetHref("/admin/checkin", attendeeId),
      "attendees",
    ),
    parking: withAdminReturnTarget(
      buildAdminAttendeeTargetHref("/admin/parking", attendeeId),
      "attendees",
    ),
  };
}

type LoadedHousehold = {
  pilotEmail: string | null;
  copilotEmail: string | null;
  hadCopilot: boolean;
  additionalParticipants: HouseholdParticipantDraft[];
};

// Reads the canonical attendee_household_members rows for one attendee and
// projects the 'additional' rows into ordered editor drafts (each carrying
// its real `id` and `sort_order`). Used both when a record is opened
// (selectAttendee) and immediately after a save, so a just-inserted
// participant gets its server id before any second save.
async function loadHouseholdParticipantsForEditor(
  attendeeId: string,
): Promise<LoadedHousehold> {
  const { data: rows } = await supabase
    .from("attendee_household_members")
    .select(
      "id,person_role,email,first_name,last_name,nickname,cell_phone,sort_order",
    )
    .eq("attendee_id", attendeeId);

  const pilot = rows?.find((row) => row.person_role === "pilot");
  const copilot = rows?.find((row) => row.person_role === "copilot");

  const additionalParticipants: HouseholdParticipantDraft[] = (rows ?? [])
    .filter((row) => row.person_role === "additional")
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((row) =>
      makeAdditionalDraft({
        id: row.id,
        firstName: row.first_name || "",
        lastName: row.last_name || "",
        nickname: row.nickname || "",
        email: row.email || "",
        cellPhone: row.cell_phone || "",
        sortOrder: row.sort_order ?? 0,
      }),
    );

  return {
    pilotEmail: pilot?.email ?? null,
    copilotEmail: copilot?.email ?? null,
    hadCopilot: !!copilot,
    additionalParticipants,
  };
}

// A distinct snapshot copy (same field values, fresh objects) for the
// "as loaded" baseline the save diff compares against.
function snapshotAdditionalParticipants(
  drafts: HouseholdParticipantDraft[],
): HouseholdParticipantDraft[] {
  return drafts.map((draft) => ({ ...draft }));
}

// A status shown by Attendees that links to its owner workspace. Renders
// as the standard status pill; clicking navigates and never bubbles to the
// row-open action underneath it.
function AttendeeStatusLink(props: {
  href: string;
  tone: StatusBadgeTone;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const { href, tone, ariaLabel, children } = props;
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={["app-status-pill", "app-status-pill-link", `app-status-pill-${tone}`]
        .filter((c) => c && c !== "app-status-pill-neutral")
        .join(" ")}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
      <span aria-hidden="true"> →</span>
    </Link>
  );
}

// Read-only Placement, sourced only from the canonical
// fetchCanonicalAttendeePlacementsForEvent map (never attendees.
// assigned_site) -- Parking alone owns placement mutation; this page only
// ever reads and hands off (View in Parking, in AttendeeActionRow/
// AttendeeRecordWorkspace).
export function AttendeeParkingNeedControl(props: {
  attendee: AttendeeRow;
  placement: CanonicalAttendeePlacementSite | undefined;
  placementKnown: boolean;
  canEdit: boolean;
  saving: boolean;
  parkingHref: string;
  onSetParkingNeed: (attendee: AttendeeRow, needsParking: boolean) => Promise<void>;
}) {
  const {
    attendee,
    placement,
    placementKnown,
    canEdit,
    saving,
    parkingHref,
    onSetParkingNeed,
  } = props;
  const needsParking = attendee.needs_parking !== false;
  const attendeeName = displayPilotName(attendee);

  // Do not present an attendee as safely unplaced while the canonical
  // placement lookup is still pending or unavailable. Parking owns that
  // relationship, and a false parking-need transition is deliberately
  // blocked whenever the current placement cannot be established here.
  if (!placementKnown) {
    return <StatusBadge tone="neutral">Checking parking...</StatusBadge>;
  }

  // Preserve the useful Site label, while making the intent and its
  // Parking-first safety rule visible. The placement status routes to
  // Parking Admin (the owner) for this attendee; there is intentionally
  // no need-toggle here -- changing a placed attendee to "Doesn't Need
  // Parking" must first happen through Parking's governed placement-clear
  // workflow.
  if (placement) {
    return (
      <div style={{ display: "grid", gap: "var(--space-1)" }}>
        <AttendeeStatusLink
          href={parkingHref}
          tone="success"
          ariaLabel={`View "${attendeeName}"'s placement (${placement.label}) in Parking Admin`}
        >
          {placement.label}
        </AttendeeStatusLink>
        <span style={{ fontSize: "var(--font-size-small)", color: "var(--color-text-secondary)" }}>
          {needsParking ? "Needs Parking" : "Doesn't Need Parking"} · Remove the
          assignment in Parking before changing this.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-1)", justifyItems: "start" }}>
    <AppButton
      variant={needsParking ? "secondary" : "tertiary"}
      loading={saving}
      disabled={!canEdit}
      aria-pressed={needsParking}
      aria-label={`Toggle ${attendeeName}'s parking need. Currently ${
        needsParking ? "Needs Parking" : "Doesn't Need Parking"
      }.`}
      title={
        needsParking
          ? "Mark as Doesn't Need Parking"
          : "Mark as Needs Parking"
      }
      onClick={(event) => {
        event.stopPropagation();
        void onSetParkingNeed(attendee, !needsParking);
      }}
      // The compact roster row is itself keyboard-selectable. Stop this
      // control's native Enter/Space interaction from also selecting the row.
      onKeyDown={(event) => event.stopPropagation()}
    >
      {needsParking ? "Needs Parking" : "Doesn't Need Parking"}
      <span aria-hidden="true"> ↔</span>
    </AppButton>
    <AttendeeStatusLink
      href={parkingHref}
      tone="neutral"
      ariaLabel={`View "${attendeeName}"'s placement (Unassigned) in Parking Admin`}
    >
      Unassigned
    </AttendeeStatusLink>
    </div>
  );
}

export function AttendeeOperationalNeedControl(props: {
  attendeeName: string;
  label: "Name Tag" | "Coach Plate";
  needs: boolean;
  canEdit: boolean;
  saving: boolean;
  onSetNeed: (needs: boolean) => Promise<void>;
}) {
  const { attendeeName, label, needs, canEdit, saving, onSetNeed } = props;
  const currentState = needs ? "Needed" : "Not needed";

  if (!canEdit) {
    return (
      <div>
        <strong>{label}</strong>
        <div>{currentState}</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-2)", alignContent: "start" }}>
      <strong>{label}</strong>
      <AppButton
        variant={needs ? "secondary" : "tertiary"}
        loading={saving}
        aria-pressed={needs}
        aria-label={`Toggle ${attendeeName}'s ${label.toLowerCase()} requirement. Currently ${currentState}.`}
        title={needs ? `Mark ${label} Not Needed` : `Mark ${label} Needed`}
        onClick={() => void onSetNeed(!needs)}
      >
        {label} {currentState}
        <span aria-hidden="true"> ↔</span>
      </AppButton>
    </div>
  );
}

function attendeeGroupSiteLabel(
  attendee: AttendeeRow,
  placements: CanonicalAttendeePlacementMap,
): string {
  return placements.get(attendee.id)?.label || "Unassigned";
}

function AttendeeList(props: {
  loading: boolean;
  canEdit: boolean;
  totalAttendeesCount: number;
  filteredAttendees: AttendeeRow[];
  visibleAttendees: AttendeeRow[];
  reviewItems: ReviewItem[];
  attendeeSortMode: AttendeeSortMode;
  selectedAttendeeId: string | null;
  placementsByAttendeeId: CanonicalAttendeePlacementMap;
  placementsLoading: boolean;
  placementsError: string | null;
  parkingNeedSavingIds: ReadonlySet<string>;
  isCompact: boolean;
  onSelect: (attendee: AttendeeRow) => void;
  onSetParkingNeed: (attendee: AttendeeRow, needsParking: boolean) => Promise<void>;
}) {
  const {
    loading,
    canEdit,
    totalAttendeesCount,
    filteredAttendees,
    visibleAttendees,
    reviewItems,
    attendeeSortMode,
    selectedAttendeeId,
    placementsByAttendeeId,
    placementsLoading,
    placementsError,
    parkingNeedSavingIds,
    isCompact,
    onSelect,
    onSetParkingNeed,
  } = props;

  function dataStatusBadges(attendee: AttendeeRow) {
    const attendeeIssues = reviewItems.find((item) => item.attendee.id === attendee.id);
    return (
      <div className="responsive-list-item-badges">
        {attendee.registration_status === "cancelled" ? (
          <StatusBadge tone="danger">Cancelled</StatusBadge>
        ) : null}
        <StatusBadge tone="neutral">{dataStatusLabel(attendee.data_status)}</StatusBadge>
        {attendeeIssues ? (
          <StatusBadge tone="warning">
            {attendeeIssues.issues.length} issue{attendeeIssues.issues.length === 1 ? "" : "s"}
          </StatusBadge>
        ) : (
          <StatusBadge tone="success">OK</StatusBadge>
        )}
      </div>
    );
  }

  function groupHeader(label: string, key: string) {
    return (
      <div
        key={key}
        style={{
          padding: "var(--space-2) var(--space-3)",
          fontWeight: 700,
          fontSize: "var(--font-size-small)",
          color: "var(--color-text-secondary)",
        }}
      >
        Site {label}
      </div>
    );
  }

  const body = loading ? (
    <LoadingState message="Loading attendee records..." />
  ) : visibleAttendees.length === 0 ? (
    <EmptyState
      message={
        totalAttendeesCount === 0
          ? "No attendees are registered for this Event yet."
          : "No attendee records match your search or filters. Try clearing them."
      }
    />
  ) : isCompact ? (
    <ResponsiveList aria-labelledby="attendees-list-heading">
      {visibleAttendees.map((attendee, index) => {
        const previousAttendee = index > 0 ? visibleAttendees[index - 1] : null;
        const currentSiteLabel = attendeeGroupSiteLabel(attendee, placementsByAttendeeId);
        const previousSiteLabel = previousAttendee
          ? attendeeGroupSiteLabel(previousAttendee, placementsByAttendeeId)
          : null;
        const showSiteHeader = attendeeSortMode === "site" && currentSiteLabel !== previousSiteLabel;
        const isSelected = selectedAttendeeId === attendee.id;
        const arrival = attendeeArrivalPresentation(attendee);
        const placement = placementsByAttendeeId.get(attendee.id);

        return (
          <li key={attendee.id} style={{ display: "contents" }}>
            {showSiteHeader ? groupHeader(currentSiteLabel, `${attendee.id}-group`) : null}
            <div
              className={
                "responsive-list-item" + (isSelected ? " responsive-list-item-selected" : "")
              }
              role="button"
              tabIndex={0}
              onClick={() => onSelect(attendee)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(attendee);
                }
              }}
            >
              <div className="responsive-list-item-header">
                <div className="responsive-list-item-title">
                  {displayPilotName(attendee)}
                  {displayCopilotName(attendee) ? ` / ${displayCopilotName(attendee)}` : ""}
                </div>
                <span style={participantTypeBadgeStyle(attendee.participant_type)}>
                  {participantTypeLabel(attendee.participant_type)}
                </span>
              </div>

              <div className="responsive-list-item-meta">
                {attendee.email ? <span>{attendee.email}</span> : null}
              </div>

              <div className="responsive-list-item-badges">
                <AttendeeStatusLink
                  href={attendeeOwnerHrefs(attendee.id).checkin}
                  tone={arrival.tone}
                  ariaLabel={`View "${displayPilotName(attendee)}"'s arrival in Check-In`}
                >
                  {arrival.label}
                </AttendeeStatusLink>
                <AttendeeParkingNeedControl
                  attendee={attendee}
                  placement={placement}
                  placementKnown={!placementsLoading && !placementsError}
                  canEdit={canEdit}
                  saving={parkingNeedSavingIds.has(attendee.id)}
                  parkingHref={attendeeOwnerHrefs(attendee.id).parking}
                  onSetParkingNeed={onSetParkingNeed}
                />
              </div>

              {dataStatusBadges(attendee)}
            </div>
          </li>
        );
      })}
    </ResponsiveList>
  ) : (
    <DataTable caption="Attendee roster for the current Event">
      <thead>
        <tr>
          <th scope="col">Attendee</th>
          <th scope="col">Data Status</th>
          <th scope="col">Arrival</th>
          <th scope="col">Placement</th>
        </tr>
      </thead>
      <tbody>
        {visibleAttendees.map((attendee, index) => {
          const previousAttendee = index > 0 ? visibleAttendees[index - 1] : null;
          const currentSiteLabel = attendeeGroupSiteLabel(attendee, placementsByAttendeeId);
          const previousSiteLabel = previousAttendee
            ? attendeeGroupSiteLabel(previousAttendee, placementsByAttendeeId)
            : null;
          const showSiteHeader = attendeeSortMode === "site" && currentSiteLabel !== previousSiteLabel;
          const isSelected = selectedAttendeeId === attendee.id;
          const arrival = attendeeArrivalPresentation(attendee);
          const placement = placementsByAttendeeId.get(attendee.id);

          return (
            <React.Fragment key={attendee.id}>
              {showSiteHeader ? (
                <tr>
                  <td colSpan={4} style={{ background: "var(--color-bg-muted)" }}>
                    {groupHeader(currentSiteLabel, `${attendee.id}-group`)}
                  </td>
                </tr>
              ) : null}
              {/* The row is not a button: it carries a pointer-only
                  onClick so a mouse click anywhere on a non-interactive
                  area opens the record, while the name cell holds the
                  real keyboard-focusable control (a proper <button>).
                  Nested controls (status links, parking-need) own their
                  own clicks and stop propagation. */}
              <tr
                className={isSelected ? "data-table-row-selected" : undefined}
                style={{ cursor: "pointer" }}
                onClick={() => onSelect(attendee)}
              >
                <td>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(attendee);
                    }}
                    aria-label={`Open "${displayPilotName(attendee)}"'s record`}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      display: "block",
                      width: "100%",
                    }}
                  >
                    <div className="data-table-cell-primary">
                      {displayPilotName(attendee)}
                      {displayCopilotName(attendee) ? ` / ${displayCopilotName(attendee)}` : ""}
                    </div>
                    <div className="data-table-cell-meta">
                      <span style={participantTypeBadgeStyle(attendee.participant_type)}>
                        {participantTypeLabel(attendee.participant_type)}
                      </span>
                      {attendee.email ? ` · ${attendee.email}` : ""}
                    </div>
                  </button>
                </td>
                <td>{dataStatusBadges(attendee)}</td>
                <td>
                  <AttendeeStatusLink
                    href={attendeeOwnerHrefs(attendee.id).checkin}
                    tone={arrival.tone}
                    ariaLabel={`View "${displayPilotName(attendee)}"'s arrival in Check-In`}
                  >
                    {arrival.label}
                  </AttendeeStatusLink>
                </td>
                <td>
                  <AttendeeParkingNeedControl
                    attendee={attendee}
                    placement={placement}
                    placementKnown={!placementsLoading && !placementsError}
                    canEdit={canEdit}
                    saving={parkingNeedSavingIds.has(attendee.id)}
                    parkingHref={attendeeOwnerHrefs(attendee.id).parking}
                    onSetParkingNeed={onSetParkingNeed}
                  />
                </td>
              </tr>
            </React.Fragment>
          );
        })}
      </tbody>
    </DataTable>
  );

  return (
    <section style={{ display: "grid", gap: "var(--space-4)" }}>
      <PageHeader
        title="Attendee List"
        titleId="attendees-list-heading"
        headingLevel="h2"
        titleClassName="app-section-title"
        description={`Showing ${visibleAttendees.length} of ${filteredAttendees.length} attendee${filteredAttendees.length === 1 ? "" : "s"}.`}
        descriptionClassName="app-subtle-text"
      />
      {placementsError ? <Alert tone="warning">{placementsError}</Alert> : null}
      {body}
    </section>
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
  // Review completion is only meaningful when this workspace was opened
  // from the Review Queue, not during ordinary attendee browsing.
  isReviewContext: boolean;
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
  parkingNeedSaving: boolean;
  nameTagNeedSaving: boolean;
  coachPlateNeedSaving: boolean;
  onChange: <K extends keyof AttendeeEditorState>(
    key: K,
    value: AttendeeEditorState[K],
  ) => void;
  onEnterEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => Promise<void>;
  onSetParkingNeed: (needsParking: boolean) => Promise<void>;
  onSetNameTagNeed: (needsNameTag: boolean) => Promise<void>;
  onSetCoachPlateNeed: (needsCoachPlate: boolean) => Promise<void>;
  onReloadRecord: () => void;
  onRemoveHouseholdMember: (role: "copilot" | "additional") => Promise<void>;
  onRemoveAdditionalParticipant: (uiKey: string) => Promise<void>;
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
    isReviewContext,
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
    parkingNeedSaving,
    nameTagNeedSaving,
    coachPlateNeedSaving,
    onChange,
    onEnterEdit,
    onCancelEdit,
    onSave,
    onSetParkingNeed,
    onSetNameTagNeed,
    onSetCoachPlateNeed,
    onReloadRecord,
    onRemoveHouseholdMember,
    onRemoveAdditionalParticipant,
    onUpdateDataStatus,
    onCancelRegistration,
    onPrevious,
    onNext,
    operationalStatus,
  } = props;
  const mode = editorMode;
  const [showCopilotFields, setShowCopilotFields] = useState(false);
  // Whether the "Add Person" role picker (Co-Pilot / Additional Participant)
  // is open -- only shown when the Co-Pilot slot is also still free.
  const [householdMemberChooserOpen, setHouseholdMemberChooserOpen] =
    useState(false);
  // The uiKeys of the Additional Participant drafts whose inline field
  // editor is currently expanded. A newly added draft starts expanded; an
  // existing person expands only when the operator clicks its "Edit".
  const [expandedAdditionalKeys, setExpandedAdditionalKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());

  const expandAdditionalEditor = (uiKey: string) =>
    setExpandedAdditionalKeys((prev) => {
      const next = new Set(prev);
      next.add(uiKey);
      return next;
    });
  const collapseAdditionalEditor = (uiKey: string) =>
    setExpandedAdditionalKeys((prev) => {
      const next = new Set(prev);
      next.delete(uiKey);
      return next;
    });

  // Governed product rule: an administrator's own authorized action of
  // adding a participant, or explicitly adding an open slot, itself
  // authorizes the resulting participant_capacity -- no separate
  // confirmation, accounting status, or payment attestation is asked for.
  // These values are informational only; they never block Save.
  const hasCopilotNow =
    state.copilot_first.trim() !== "" ||
    state.copilot_last.trim() !== "" ||
    state.copilot_email.trim() !== "";
  const namedAdditionalCount =
    state.additionalParticipants.filter(additionalDraftHasData).length;
  // "New" means a participant that did not exist when the editor loaded --
  // distinguishes the admin adding someone (which authorizes a fresh
  // capacity increase, shown by the banner below) from an unrelated edit.
  const isNewCopilot = mode === "edit" && hasCopilotNow && !state.had_copilot_at_load;
  const newAdditionalDrafts = state.additionalParticipants.filter(
    (draft) => draft.id === null && additionalDraftHasData(draft),
  );
  const isNewAdditional = mode === "edit" && newAdditionalDrafts.length > 0;
  const isAddingNewParticipant = isNewCopilot || isNewAdditional;
  const resultingRosterCount =
    1 + (hasCopilotNow ? 1 : 0) + namedAdditionalCount;
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
  // A Co-Pilot already on record keeps its fields visible for editing.
  useEffect(() => {
    if (
      state.copilot_first ||
      state.copilot_last ||
      state.copilot_nickname ||
      state.copilot_email ||
      state.copilot_cell_phone
    ) {
      setShowCopilotFields(true);
    }
  }, [
    state.copilot_first,
    state.copilot_last,
    state.copilot_nickname,
    state.copilot_email,
    state.copilot_cell_phone,
  ]);
  // When the workspace switches to a different record, collapse every
  // person-field editor back to that record's own data (the Co-Pilot
  // auto-show effect above re-opens the Co-Pilot if it is populated).
  useEffect(() => {
    setShowCopilotFields(false);
    setHouseholdMemberChooserOpen(false);
    setExpandedAdditionalKeys(new Set());
  }, [state.id]);
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
      <Field key={String(field.key)} label={field.label}>
        {(controlProps) => (
          <Input
            {...controlProps}
            value={String(state[field.key] ?? "")}
            onChange={(e) =>
              onChange(
                field.key,
                field.key === "membership_number"
                  ? (e.target.value.toUpperCase() as AttendeeEditorState[typeof field.key])
                  : (e.target.value as AttendeeEditorState[typeof field.key]),
              )
            }
          />
        )}
      </Field>
    );
  }

  function sectionHeading(id: string, label: string) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
        <strong style={{ fontSize: "var(--font-size-card-title)" }}>{label}</strong>
        {dirtySections.includes(id) ? <StatusBadge tone="info">Changed</StatusBadge> : null}
      </div>
    );
  }

  const sectionStyle: CSSProperties = {
    border: "var(--border-width-default) solid var(--color-border-default)",
    borderRadius: "var(--radius-medium)",
    padding: "var(--space-6)",
    background: "var(--color-bg-muted)",
  };

  // -------------------------------------------------------------------------
  // "People on this Registration" (Phase 1). One card per actual person,
  // rendered identically in view and edit mode. Edit mode adds Add / Edit /
  // Remove affordances that bind to the SAME AttendeeEditorState fields --
  // no new modal, no new write path. Save Changes remains the one canonical
  // save: it still routes through handleSaveAttendeeRecord ->
  // syncHouseholdMembers -> manage_attendee_household_member (and
  // record_participant_capacity_increase where a new participant/raise is
  // involved). "Edit"/"Add" here only toggle which role's fields are shown;
  // "Remove" is the existing clear-then-Save flow (onRemoveHouseholdMember),
  // still ConfirmDialog-gated.
  const householdPeople = deriveHouseholdPeople(state);
  const namedPersonCount = householdPeople.length;
  const hasCopilotPerson = householdPeople.some((p) => p.role === "copilot");
  const hasAdditionalPerson = householdPeople.some((p) => p.role === "additional");
  const canAddCopilot = !hasCopilotNow && !showCopilotFields;

  // Preserve null ("never established") capacity semantics: an untouched,
  // unset capacity reads as "—", never as a number.
  const authorizedPartySizeDisplay = state.registration_capacity_was_unset
    ? "—"
    : String(state.registration_capacity);
  const namedExceedsAuthorized =
    !state.registration_capacity_was_unset &&
    namedPersonCount > state.registration_capacity;
  // Vacant authorized positions: authorized party size beyond the people
  // named so far. Raising the Authorized Party Size reveals more of these;
  // it never creates a person. Each is identified by adding a name (which
  // creates a new Additional Participant draft).
  const vacantPositionCount = state.registration_capacity_was_unset
    ? 0
    : Math.max(0, state.registration_capacity - namedPersonCount);

  function updateAdditionalParticipant(
    uiKey: string,
    field: keyof Pick<
      HouseholdParticipantDraft,
      "firstName" | "lastName" | "nickname" | "email" | "cellPhone"
    >,
    value: string,
  ) {
    onChange(
      "additionalParticipants",
      state.additionalParticipants.map((draft) =>
        draft.uiKey === uiKey ? { ...draft, [field]: value } : draft,
      ),
    );
  }

  function discardAdditionalDraft(uiKey: string) {
    onChange(
      "additionalParticipants",
      state.additionalParticipants.filter((draft) => draft.uiKey !== uiKey),
    );
    collapseAdditionalEditor(uiKey);
  }

  function addAdditionalParticipant() {
    const nextSort =
      state.additionalParticipants.reduce(
        (max, draft) => Math.max(max, draft.sortOrder),
        -1,
      ) + 1;
    const draft = makeAdditionalDraft({ sortOrder: nextSort });
    onChange("additionalParticipants", [
      ...state.additionalParticipants,
      draft,
    ]);
    expandAdditionalEditor(draft.uiKey);
    setHouseholdMemberChooserOpen(false);
  }

  function renderHouseholdPersonCard(person: HouseholdPerson, editable: boolean) {
    const isPilot = person.role === "pilot";
    const isCopilot = person.role === "copilot";
    const additionalUiKey = person.sourceUiKey ?? null;
    const removable = editable && !isPilot;
    const editorOpen = isCopilot
      ? showCopilotFields
      : additionalUiKey !== null && expandedAdditionalKeys.has(additionalUiKey);
    return (
      <div
        key={
          isPilot
            ? "pilot"
            : isCopilot
              ? "copilot"
              : `additional-${additionalUiKey}`
        }
        style={{
          border: "var(--border-width-default) solid var(--color-border-default)",
          borderRadius: "var(--radius-medium)",
          padding: "var(--space-4)",
          background: "var(--color-bg-default)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "var(--space-3)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "grid", gap: 2, fontSize: 14 }}>
            <div style={{ fontWeight: 700 }}>{person.roleLabel}</div>
            <div>{householdParticipantDisplayName(person)}</div>
            <div className="app-subtle-text" style={{ fontSize: 13 }}>
              Email: {person.email || "—"}
            </div>
            <div className="app-subtle-text" style={{ fontSize: 13 }}>
              Phone: {person.cellPhone || "—"}
            </div>
          </div>
          {removable ? (
            <div
              style={{
                display: "flex",
                gap: "var(--space-2)",
                alignItems: "flex-start",
                flexWrap: "wrap",
              }}
            >
              {!editorOpen ? (
                <AppButton
                  onClick={() => {
                    if (isCopilot) {
                      setShowCopilotFields(true);
                    } else if (additionalUiKey) {
                      expandAdditionalEditor(additionalUiKey);
                    }
                  }}
                  aria-label={`Edit ${person.roleLabel}`}
                >
                  Edit
                </AppButton>
              ) : null}
              <AppButton
                variant="danger"
                onClick={() => {
                  if (isCopilot) {
                    void onRemoveHouseholdMember("copilot");
                  } else if (additionalUiKey) {
                    void onRemoveAdditionalParticipant(additionalUiKey);
                  }
                }}
                aria-label={`Remove ${person.roleLabel}`}
              >
                Remove
              </AppButton>
            </div>
          ) : null}
        </div>
        {editable && isPilot ? (
          <p
            className="app-subtle-text"
            style={{ margin: "var(--space-2) 0 0", fontSize: 13 }}
          >
            Edit the Pilot in the Pilot Identity and Contact sections. The
            Pilot cannot be removed from the registration.
          </p>
        ) : null}
      </div>
    );
  }

  const roleFieldEditorStyle: CSSProperties = {
    marginTop: "var(--space-3)",
    padding: "var(--space-4)",
    border: "var(--border-width-default) dashed var(--color-border-default)",
    borderRadius: "var(--radius-medium)",
    background: "var(--color-bg-default)",
  };

  function renderCopilotFieldEditor() {
    return (
      <div style={roleFieldEditorStyle}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Co-Pilot details</div>
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {SECTION_TEXT_FIELDS.household.map(renderTextField)}
        </div>
        <div style={{ marginTop: 10 }}>
          <AppButton
            variant="tertiary"
            onClick={() => setShowCopilotFields(false)}
          >
            {hasCopilotNow ? "Done" : "Don't add a Co-Pilot"}
          </AppButton>
        </div>
      </div>
    );
  }

  function renderAdditionalParticipantEditor(draft: HouseholdParticipantDraft) {
    const hasData = additionalDraftHasData(draft);
    const label = hasData
      ? householdParticipantDisplayName(draft)
      : "New participant";
    return (
      <div key={`ahp-editor-${draft.uiKey}`} style={roleFieldEditorStyle}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>
          Additional Participant — {label}
        </div>
        {/* Responsive auto-fit grid, not a fixed 5-column layout, so it
            never forces horizontal overflow on phone/tablet widths
            (Refactor Audit E.1 / Test Expectation M). */}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            alignItems: "end",
          }}
        >
          <Field label="Participant First Name">
            {(controlProps) => (
              <Input
                {...controlProps}
                placeholder="First name"
                value={draft.firstName}
                onChange={(e) =>
                  updateAdditionalParticipant(
                    draft.uiKey,
                    "firstName",
                    e.target.value,
                  )
                }
              />
            )}
          </Field>

          <Field label="Participant Last Name">
            {(controlProps) => (
              <Input
                {...controlProps}
                placeholder="Last name"
                value={draft.lastName}
                onChange={(e) =>
                  updateAdditionalParticipant(
                    draft.uiKey,
                    "lastName",
                    e.target.value,
                  )
                }
              />
            )}
          </Field>

          <Field label="Participant Nickname">
            {(controlProps) => (
              <Input
                {...controlProps}
                placeholder="Nickname"
                value={draft.nickname}
                onChange={(e) =>
                  updateAdditionalParticipant(
                    draft.uiKey,
                    "nickname",
                    e.target.value,
                  )
                }
              />
            )}
          </Field>

          <Field label="Participant Email">
            {(controlProps) => (
              <Input
                {...controlProps}
                placeholder="Email address"
                value={draft.email}
                onChange={(e) =>
                  updateAdditionalParticipant(
                    draft.uiKey,
                    "email",
                    e.target.value,
                  )
                }
              />
            )}
          </Field>

          <Field label="Participant Cell Phone">
            {(controlProps) => (
              <Input
                {...controlProps}
                placeholder="Cell phone (optional)"
                value={draft.cellPhone}
                onChange={(e) =>
                  updateAdditionalParticipant(
                    draft.uiKey,
                    "cellPhone",
                    e.target.value,
                  )
                }
              />
            )}
          </Field>
        </div>
        <div
          style={{
            marginTop: 10,
            display: "flex",
            gap: "var(--space-2)",
            flexWrap: "wrap",
          }}
        >
          {hasData ? (
            <>
              <AppButton
                variant="tertiary"
                onClick={() => collapseAdditionalEditor(draft.uiKey)}
              >
                Done
              </AppButton>
              <AppButton
                variant="danger"
                onClick={() => void onRemoveAdditionalParticipant(draft.uiKey)}
                aria-label={`Remove ${label}`}
              >
                Remove
              </AppButton>
            </>
          ) : (
            <AppButton
              variant="tertiary"
              onClick={() => discardAdditionalDraft(draft.uiKey)}
            >
              Cancel
            </AppButton>
          )}
        </div>
      </div>
    );
  }

  function renderHouseholdPeopleSection(editable: boolean) {
    return (
      <div style={sectionStyle}>
        {sectionHeading("household", "People on this Registration")}
        <p
          className="app-subtle-text"
          style={{ margin: "0 0 var(--space-3)" }}
        >
          Everyone on this registration for this Event. The Pilot is always on
          the registration; a Co-Pilot and any number of Additional
          Participants may also be added.
        </p>

        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          {householdPeople.map((person) =>
            renderHouseholdPersonCard(person, editable),
          )}
          {!editable && !hasCopilotPerson ? (
            <div className="app-subtle-text" style={{ fontSize: 13 }}>
              Co-Pilot: none on record
            </div>
          ) : null}
          {!editable && !hasAdditionalPerson ? (
            <div className="app-subtle-text" style={{ fontSize: 13 }}>
              Additional Participants: none on record
            </div>
          ) : null}
          {/* Vacant authorized positions -- one row per unidentified paid
              slot. "Add name" identifies it as a new Additional Participant. */}
          {editable
            ? Array.from({ length: vacantPositionCount }).map((_, index) => (
                <div
                  key={`vacant-${index}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "var(--space-3)",
                    flexWrap: "wrap",
                    border:
                      "var(--border-width-default) dashed var(--color-border-default)",
                    borderRadius: "var(--radius-medium)",
                    padding: "var(--space-3) var(--space-4)",
                    background: "var(--color-bg-muted)",
                  }}
                >
                  <span className="app-subtle-text">
                    Unidentified participant
                  </span>
                  <AppButton
                    onClick={addAdditionalParticipant}
                    aria-label="Add a name for an unidentified participant"
                  >
                    Add name
                  </AppButton>
                </div>
              ))
            : null}
        </div>

        {/* Stable editors block -- position keyed by uiKey, so typing into a
            just-added draft never reflows it out from under the cursor. */}
        {editable && showCopilotFields ? renderCopilotFieldEditor() : null}
        {editable
          ? state.additionalParticipants
              .filter((draft) => expandedAdditionalKeys.has(draft.uiKey))
              .map((draft) => renderAdditionalParticipantEditor(draft))
          : null}

        {editable ? (
          <div style={{ marginTop: "var(--space-4)" }}>
            {!householdMemberChooserOpen ? (
              <AppButton
                onClick={() => {
                  if (canAddCopilot) {
                    setHouseholdMemberChooserOpen(true);
                  } else {
                    addAdditionalParticipant();
                  }
                }}
                style={{ width: "100%" }}
              >
                + Add Person
              </AppButton>
            ) : (
              <div
                role="group"
                aria-label="Add a person to this registration"
                style={{ display: "grid", gap: "var(--space-2)" }}
              >
                <div className="app-subtle-text">
                  Add a person to this registration:
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "var(--space-2)",
                    flexWrap: "wrap",
                  }}
                >
                  <AppButton
                    onClick={() => {
                      setShowCopilotFields(true);
                      setHouseholdMemberChooserOpen(false);
                    }}
                  >
                    Add Co-Pilot
                  </AppButton>
                  <AppButton onClick={addAdditionalParticipant}>
                    Add Additional Participant
                  </AppButton>
                  <AppButton
                    onClick={() => setHouseholdMemberChooserOpen(false)}
                  >
                    Cancel
                  </AppButton>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <div
          className="app-subtle-text"
          style={{ fontSize: 13, marginTop: "var(--space-3)" }}
        >
          {namedPersonCount} named{" "}
          {namedPersonCount === 1 ? "person" : "people"}
          {/* View mode has no separate Authorized Party Size block, so the
              authorized number is surfaced here; edit mode has its own. */}
          {editable
            ? ""
            : ` · Authorized party size: ${authorizedPartySizeDisplay}`}
        </div>
      </div>
    );
  }

  // Read-only Arrival/Placement (Part 7/Non-negotiable architecture) --
  // Check-In and Parking alone own mutation; this panel only ever reads
  // (state.has_arrived from the already-loaded record; operationalStatus
  // from the canonical fetchCanonicalAttendeePlacement, never
  // attendees.assigned_site) and hands off via real navigation links, not
  // local buttons that could be mistaken for in-place actions.
  const operationalStatusBlock =
    mode === "edit" && state.id ? (
      <div style={{ ...sectionStyle, display: "grid", gap: "var(--space-3)" }}>
        <strong style={{ fontSize: "var(--font-size-card-title)" }}>Operational Status</strong>
        <div className="responsive-list-item-badges">
          <StatusBadge tone={state.has_arrived ? "success" : "neutral"}>
            {state.has_arrived ? "Arrived" : "Not Arrived"}
          </StatusBadge>
          <StatusBadge
            tone={
              operationalStatus?.ok && operationalStatus.site
                ? "success"
                : operationalStatus?.ok
                  ? "warning"
                  : "neutral"
            }
          >
            {operationalStatus?.ok
              ? operationalStatus.site?.label || "Unassigned"
              : operationalStatus
                ? "Placement Unavailable"
                : "Checking Placement..."}
          </StatusBadge>
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <AppLinkButton href={attendeeOwnerHrefs(state.id).checkin}>
            View in Check-In
          </AppLinkButton>
          <AppLinkButton href={attendeeOwnerHrefs(state.id).parking}>
            View in Parking
          </AppLinkButton>
        </div>
      </div>
    ) : null;

  const parkingNeedPlacementKnown = operationalStatus?.ok === true;
  const parkingNeedBlockedByPlacement =
    parkingNeedPlacementKnown && !!operationalStatus.site && state.needs_parking;

  const titleText =
    mode === "create"
      ? "Add Attendee Record"
      : displayPilotName(attendee ?? { pilot_first: state.pilot_first, pilot_last: state.pilot_last } as AttendeeRow);

  const subtitleText =
    mode === "create" ? (
      "Create a new attendee manually."
    ) : (
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
        <span style={participantTypeBadgeStyle(state.participant_type)}>
          {participantTypeLabel(state.participant_type)}
        </span>
        <StatusBadge tone="neutral">{dataStatusLabel(state.data_status)}</StatusBadge>
        {attendee?.registration_status === "cancelled" ? (
          <StatusBadge tone="danger">Cancelled</StatusBadge>
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

      {renderHouseholdPeopleSection(false)}

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
          <AttendeeOperationalNeedControl
            attendeeName={titleText}
            label="Name Tag"
            needs={state.needs_name_tag}
            canEdit={canEdit}
            saving={nameTagNeedSaving}
            onSetNeed={onSetNameTagNeed}
          />
          <AttendeeOperationalNeedControl
            attendeeName={titleText}
            label="Coach Plate"
            needs={state.needs_coach_plate}
            canEdit={canEdit}
            saving={coachPlateNeedSaving}
            onSetNeed={onSetCoachPlateNeed}
          />
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

      {renderHouseholdPeopleSection(true)}

      <div style={sectionStyle}>
        {sectionHeading("party_size", "Authorized Party Size")}
        <p className="app-subtle-text" style={{ margin: "0 0 var(--space-3)" }}>
          Named people are managed above. Authorized party size is the
          paid/approved number of participants and may be larger than the
          number of named people.
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
            flexWrap: "wrap",
          }}
        >
          <Field label="Authorized Party Size">
            {(controlProps) => (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                }}
              >
                <AppButton
                  aria-label="Decrease authorized party size"
                  onClick={() => {
                    onChange(
                      "registration_capacity",
                      Math.max(1, state.registration_capacity - 1) as any,
                    );
                    onChange("registration_capacity_was_unset", false);
                  }}
                >
                  −
                </AppButton>
                <Input
                  {...controlProps}
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
                  style={{ width: 70, textAlign: "center" }}
                />
                <AppButton
                  aria-label="Increase authorized party size"
                  onClick={() => {
                    onChange(
                      "registration_capacity",
                      (state.registration_capacity + 1) as any,
                    );
                    onChange("registration_capacity_was_unset", false);
                  }}
                >
                  +
                </AppButton>
              </div>
            )}
          </Field>
          <div className="app-subtle-text" style={{ fontSize: 13 }}>
            {namedPersonCount} named / {authorizedPartySizeDisplay} authorized
            {state.registration_capacity_was_unset
              ? " (not yet established)"
              : ""}
          </div>
        </div>

        {namedExceedsAuthorized ? (
          <p
            className="app-subtle-text"
            style={{
              marginTop: "var(--space-2)",
              marginBottom: 0,
              color: "var(--color-status-warning)",
            }}
          >
            The named people exceed the authorized party size. Adding a person
            or raising the party size resolves this.
          </p>
        ) : null}

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
              <Field label="Note (optional)">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={state.capacity_increase_note}
                    onChange={(e) =>
                      onChange("capacity_increase_note", e.target.value)
                    }
                  />
                )}
              </Field>
            </div>
          </div>
        )}
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
          <Field label="Special Events Raw">
            {(controlProps) => (
              <Textarea
                {...controlProps}
                value={state.special_events_raw}
                onChange={(e) => onChange("special_events_raw", e.target.value)}
                rows={3}
              />
            )}
          </Field>
        </div>
        <div
          style={{
            marginTop: 14,
            display: "grid",
            gap: "var(--space-2)",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          <Checkbox
            checked={state.wants_to_volunteer}
            onChange={(e) => onChange("wants_to_volunteer", e.target.checked)}
            label="Volunteer"
          />

          <Checkbox
            checked={state.is_first_timer}
            onChange={(e) => onChange("is_first_timer", e.target.checked)}
            label="First Timer"
          />

          <Checkbox
            checked={state.share_with_attendees}
            onChange={(e) => onChange("share_with_attendees", e.target.checked)}
            label="Share With Attendees"
          />
          <Checkbox
            checked={state.include_in_headcount}
            onChange={(e) => onChange("include_in_headcount", e.target.checked)}
            label="Include In Headcount"
          />

          {mode === "create" ? (
            <Checkbox
              checked={state.needs_name_tag}
              onChange={(e) => onChange("needs_name_tag", e.target.checked)}
              label="Needs Name Tag"
              help="New attendee records start as needing a name tag."
            />
          ) : (
            <Checkbox
              checked={state.needs_name_tag}
              disabled={!canEdit || nameTagNeedSaving}
              onChange={(e) => void onSetNameTagNeed(e.target.checked)}
              label="Needs Name Tag"
              help="Changes are saved through the governed Name Tag need command."
            />
          )}

          {mode === "create" ? (
            <Checkbox
              checked={state.needs_coach_plate}
              onChange={(e) => onChange("needs_coach_plate", e.target.checked)}
              label="Needs Coach Plate"
              help="New attendee records start as needing a coach plate."
            />
          ) : (
            <Checkbox
              checked={state.needs_coach_plate}
              disabled={!canEdit || coachPlateNeedSaving}
              onChange={(e) => void onSetCoachPlateNeed(e.target.checked)}
              label="Needs Coach Plate"
              help="Changes are saved through the governed Coach Plate need command."
            />
          )}

          {mode === "create" ? (
            <Checkbox
              checked={state.needs_parking}
              onChange={(e) => onChange("needs_parking", e.target.checked)}
              label="Needs Parking"
              help="New attendee records start as needing parking."
            />
          ) : (
            <Checkbox
              checked={state.needs_parking}
              disabled={!canEdit || parkingNeedSaving || !parkingNeedPlacementKnown || parkingNeedBlockedByPlacement}
              onChange={(e) => void onSetParkingNeed(e.target.checked)}
              label="Needs Parking"
              help={
                parkingNeedBlockedByPlacement
                  ? "Remove this attendee's parking assignment in Parking before marking them as not needing parking."
                  : !parkingNeedPlacementKnown
                    ? "Parking status is loading before this intent can be changed."
                    : "Changes are saved through the governed parking-need command."
              }
            />
          )}
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
          <Field label="Participant Type">
            {(controlProps) => (
              <Select
                {...controlProps}
                value={state.participant_type}
                onChange={(e) => onChange("participant_type", e.target.value)}
              >
                {PARTICIPANT_TYPE_OPTIONS.filter(
                  (option) => option !== "all",
                ).map((option) => (
                  <option key={option} value={option}>
                    {participantTypeLabel(option)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Data Status">
            {(controlProps) => (
              <Select
                {...controlProps}
                value={state.data_status}
                onChange={(e) => onChange("data_status", e.target.value)}
              >
                {DATA_STATUS_OPTIONS.filter((option) => option !== "all").map(
                  (option) => (
                    <option key={option} value={option}>
                      {dataStatusOptionLabel(option)}
                    </option>
                  ),
                )}
              </Select>
            )}
          </Field>
          <div>
            <Checkbox
              checked={state.is_active}
              onChange={(e) => onChange("is_active", e.target.checked)}
              label="Active Record"
            />
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        {sectionHeading("notes", "Notes")}
        <Textarea
          aria-label="Notes"
          value={state.notes}
          onChange={(e) => onChange("notes", e.target.value)}
          rows={4}
        />
      </div>
    </div>
  );

  const primaryActions =
    viewState === "view" ? (
      <>
        <AppButton variant="primary" onClick={onEnterEdit} disabled={!canEdit}>
          Edit
        </AppButton>
        {isReviewContext ? (
          <AppButton
            disabled={!canEdit || !attendee}
            onClick={() => attendee && void onUpdateDataStatus(attendee.id, "reviewed")}
          >
            Mark Reviewed
          </AppButton>
        ) : null}
        {/* Ends this registration's participation -- the one consequential
            action here, so it alone gets the danger treatment (Part 6/8),
            matching its presentation elsewhere on this page. */}
        <AppButton
          variant="danger"
          disabled={!canEdit || !attendee}
          onClick={() => attendee && void onCancelRegistration(attendee)}
        >
          Cancel Registration
        </AppButton>
      </>
    ) : (
      <>
        <AppButton
          variant="primary"
          onClick={() => void onSave()}
          disabled={saving || !canEdit || !!conflict}
        >
          {saving ? "Saving..." : mode === "create" ? "Create Attendee" : "Save Changes"}
        </AppButton>
        {mode === "edit" ? (
          <AppButton onClick={onCancelEdit} disabled={saving}>
            Cancel Edit
          </AppButton>
        ) : null}
      </>
    );

  const secondaryActions =
    viewState === "view" && mode === "edit" && attendee ? (
      <>
        <AppButton disabled={!canEdit} onClick={() => void onUpdateDataStatus(attendee.id, "pending")}>
          Back To Pending
        </AppButton>
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
      presentation="centered"
    >
      {viewState === "view" ? viewBody : editBody}
    </ObjectPanel>
  );
}

function AdminAttendeesPageInner() {
  const storedPrefs = useMemo(() => getStoredAttendeeCommandCenterPrefs(), []);
  // Deep-link contract: /admin/data-review -> /admin/attendees?view=review
  // opens the Review Queue on load. A missing or unrecognized value falls
  // back to the ordinary default (closed) -- never a workaround via
  // localStorage, and this carries no authority of its own.
  const searchParams = useSearchParams();
  const openReviewQueueFromDeepLink = searchParams.get("view") === "review";
  const { admin } = useAdmin();
  const adminRef = useRef(admin);
  // Shell's own canonical compact-state signal (UI Phase 2-4) -- decides
  // desktop table vs. narrow-viewport list, replacing what would
  // otherwise be a page-local resize listener.
  const { isCompact } = useShellInterfaceCapabilities();

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
  const [parkingNeedSavingIds, setParkingNeedSavingIds] = useState<Set<string>>(
    new Set(),
  );
  const parkingNeedSavingRef = useRef<Set<string>>(new Set());
  const [operationalNeedSavingKeys, setOperationalNeedSavingKeys] = useState<Set<string>>(
    new Set(),
  );
  const operationalNeedSavingRef = useRef<Set<string>>(new Set());
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

  const [showReviewQueue, setShowReviewQueue] = useState(openReviewQueueFromDeepLink);

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
  const loadEventAndDataRef = useRef<() => void>(() => {});

  // Working-Event change (this tab or another): synchronously drop Event A's
  // roster/rules and bump the load generation so an in-flight Event-A load
  // cannot repopulate the queue, then reload for Event B. (`canEditAttendees`
  // is separately reset to false by runAttendeeManageAuthorityCheck, so
  // mutation controls fail closed until Event B's authority resolves.)
  useAdminWorkingEventScope(() => {
    loadGenerationRef.current += 1;
    setAttendees([]);
    setRules([]);
    setOperationalSummary(null);
    setOperationalSummaryError(null);
    setLoading(true);
    loadEventAndDataRef.current();
  });

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
        setError("We couldn't load attendee records. Please try again.");
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
    const requestedEventId = storedEvent?.id ?? null;

    const { data: eventsData, error: eventsError } = await supabase
      .from("events")
      .select("id, name, location, start_date, end_date, status")
      .order("start_date", { ascending: false });

    // The working Event changed (this tab or another) while the events list
    // was loading. A newer loadEventAndData() is already running for Event B;
    // abandon this one BEFORE it can resolve Event A and -- fatally -- write
    // Event A's id back into the shared working-Event store (reverting the
    // switch for every tab). loadQueue's own generation guard covers the
    // roster; this guard covers the resolution + write-back that precede it.
    if ((getCurrentAdminEvent()?.id ?? null) !== requestedEventId) {
      return;
    }

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

    loadEventAndDataRef.current = () => void loadEventAndData();
    void loadEventAndData();
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

  // UI Phase 4: canonical, read-only Placement for the roster list itself
  // (Part 5/7) -- one batched query per visible-set change via
  // fetchCanonicalAttendeePlacementsForEvent, never
  // fetchCanonicalAttendeePlacement called once per row (that would be an
  // N+1 query pattern against the canonical parking occupancy table for
  // every render of a genuinely large roster). Sourced only from that
  // same canonical occupancy read, exactly like AttendeeRecordWorkspace's own
  // operationalStatus below -- never from attendees.assigned_site.
  const [placementsByAttendeeId, setPlacementsByAttendeeId] =
    useState<CanonicalAttendeePlacementMap>(new Map());
  const [placementsLoading, setPlacementsLoading] = useState(false);
  const [placementsError, setPlacementsError] = useState<string | null>(null);
  const placementsGenerationRef = useRef(0);

  useEffect(() => {
    const eventId = currentEvent?.id;
    const ids = visibleAttendees.map((a) => a.id);
    const generation = ++placementsGenerationRef.current;

    if (!eventId || ids.length === 0) {
      setPlacementsByAttendeeId(new Map());
      setPlacementsError(null);
      setPlacementsLoading(false);
      return;
    }

    setPlacementsLoading(true);
    void fetchCanonicalAttendeePlacementsForEvent(eventId, ids).then((result) => {
      if (generation !== placementsGenerationRef.current) {
        return;
      }
      setPlacementsLoading(false);
      if (!result.ok) {
        console.error("fetchCanonicalAttendeePlacementsForEvent failed:", result.message);
        setPlacementsError("Placement status is temporarily unavailable.");
        setPlacementsByAttendeeId(new Map());
        return;
      }
      setPlacementsError(null);
      setPlacementsByAttendeeId(result.placements);
    });
  }, [currentEvent?.id, visibleAttendees]);

  useEffect(() => {
    if (!attendees.length || editorOpen) {
      return;
    }

    const pendingEditId = localStorage.getItem(STORAGE_KEYS.attendeeOpenEditId);
    if (!pendingEditId) {
      return;
    }

    const attendee = attendees.find((row) => row.id === pendingEditId);
    if (!attendee) {
      return;
    }

    localStorage.removeItem(STORAGE_KEYS.attendeeOpenEditId);
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
      setError("We couldn't save the membership number. Please try again.");
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
      setError("We couldn't update the attendee status. Please try again.");
      setStatus("Status update failed.");
    }
  }

  function parkingNeedErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? "");

    if (message.includes("parking_assignment_must_be_removed_first")) {
      return "Remove this attendee's parking assignment in Parking before marking them as not needing parking.";
    }
    if (message.includes("authorization_denied") || message.includes("unauthorized")) {
      return "You do not have permission to change this attendee's parking need.";
    }
    if (message.includes("attendee_not_found")) {
      return "This attendee is no longer available in the current event.";
    }
    return "We couldn't update this attendee's parking need. Please try again.";
  }

  async function setAttendeeParkingNeed(
    attendee: AttendeeRow,
    needsParking: boolean,
  ) {
    if (parkingNeedSavingRef.current.has(attendee.id)) {
      return;
    }

    parkingNeedSavingRef.current.add(attendee.id);
    setParkingNeedSavingIds((previous) => new Set(previous).add(attendee.id));

    try {
      setError(null);
      setStatus("Saving parking need...");

      const { data, error: parkingNeedError } = await supabase.rpc(
        "set_attendee_parking_need",
        {
          p_attendee_id: attendee.id,
          p_needs_parking: needsParking,
        },
      );

      if (parkingNeedError) {
        throw parkingNeedError;
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (!result || typeof result.needs_parking !== "boolean") {
        throw new Error("parking_need_result_invalid");
      }

      const persistedNeedsParking = result.needs_parking;
      setAttendees((previous) =>
        previous.map((row) =>
          row.id === attendee.id
            ? { ...row, needs_parking: persistedNeedsParking }
            : row,
        ),
      );
      setEditorState((previous) =>
        previous.id === attendee.id
          ? { ...previous, needs_parking: persistedNeedsParking }
          : previous,
      );
      setEditorBaseline((previous) =>
        previous.id === attendee.id
          ? { ...previous, needs_parking: persistedNeedsParking }
          : previous,
      );

      setStatus("Parking need updated.");
      showFlash(
        persistedNeedsParking
          ? "Attendee marked as needing parking."
          : "Attendee marked as not needing parking.",
      );
    } catch (error) {
      console.error("setAttendeeParkingNeed error:", error);
      setError(parkingNeedErrorMessage(error));
      setStatus("Parking need was not changed.");
    } finally {
      parkingNeedSavingRef.current.delete(attendee.id);
      setParkingNeedSavingIds((previous) => {
        const next = new Set(previous);
        next.delete(attendee.id);
        return next;
      });
    }
  }

  type AttendeeOperationalNeed = "name_tag" | "coach_plate";

  function attendeeOperationalNeedSavingKey(
    attendeeId: string,
    need: AttendeeOperationalNeed,
  ) {
    return `${attendeeId}:${need}`;
  }

  function attendeeOperationalNeedErrorMessage(
    need: AttendeeOperationalNeed,
    error: unknown,
  ): string {
    const message = error instanceof Error ? error.message : String(error ?? "");
    const label = need === "name_tag" ? "Name Tag" : "Coach Plate";

    if (message.includes("authorization_denied") || message.includes("unauthorized")) {
      return `You do not have permission to change this attendee's ${label} need.`;
    }
    if (message.includes("attendee_not_found")) {
      return "This attendee is no longer available in the current event.";
    }
    return `We couldn't update this attendee's ${label} need. Please try again.`;
  }

  async function setAttendeeOperationalNeed(
    attendee: AttendeeRow,
    need: AttendeeOperationalNeed,
    requestedNeed: boolean,
  ) {
    const savingKey = attendeeOperationalNeedSavingKey(attendee.id, need);
    if (operationalNeedSavingRef.current.has(savingKey)) {
      return;
    }

    operationalNeedSavingRef.current.add(savingKey);
    setOperationalNeedSavingKeys((previous) => new Set(previous).add(savingKey));

    const isNameTag = need === "name_tag";
    const label = isNameTag ? "Name Tag" : "Coach Plate";
    const field = isNameTag ? "needs_name_tag" : "needs_coach_plate";

    try {
      setError(null);
      setStatus(`Saving ${label} need...`);

      const { data, error: operationalNeedError } = await supabase.rpc(
        isNameTag
          ? "set_attendee_name_tag_need"
          : "set_attendee_coach_plate_need",
        isNameTag
          ? {
              p_attendee_id: attendee.id,
              p_needs_name_tag: requestedNeed,
            }
          : {
              p_attendee_id: attendee.id,
              p_needs_coach_plate: requestedNeed,
            },
      );

      if (operationalNeedError) {
        throw operationalNeedError;
      }

      const result = Array.isArray(data) ? data[0] : data;
      const persistedNeed = result?.[field];
      if (typeof persistedNeed !== "boolean") {
        throw new Error("attendee_operational_need_result_invalid");
      }

      setAttendees((previous) =>
        previous.map((row) =>
          row.id === attendee.id ? { ...row, [field]: persistedNeed } : row,
        ),
      );
      setEditorState((previous) =>
        previous.id === attendee.id ? { ...previous, [field]: persistedNeed } : previous,
      );
      setEditorBaseline((previous) =>
        previous.id === attendee.id ? { ...previous, [field]: persistedNeed } : previous,
      );

      setStatus(`${label} need updated.`);
      showFlash(
        persistedNeed
          ? `Attendee marked as needing a ${label.toLowerCase()}.`
          : `Attendee marked as not needing a ${label.toLowerCase()}.`,
      );
    } catch (error) {
      console.error("setAttendeeOperationalNeed error:", error);
      setError(attendeeOperationalNeedErrorMessage(need, error));
      setStatus(`${label} need was not changed.`);
    } finally {
      operationalNeedSavingRef.current.delete(savingKey);
      setOperationalNeedSavingKeys((previous) => {
        const next = new Set(previous);
        next.delete(savingKey);
        return next;
      });
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

  // After household synchronization on an authorized save, a KNOWN
  // participant_capacity must not remain below the participant roster that is
  // actually materialized in attendee_household_members. This:
  //   - counts the materialized rows with a COUNT query (never fetches rows
  //     just to length them);
  //   - re-reads the freshly stored participant_capacity;
  //   - leaves a NULL ("unknown / never established") capacity untouched --
  //     it is never auto-established here;
  //   - does nothing when the stored capacity already covers the roster;
  //   - otherwise raises capacity through the governed
  //     record_participant_capacity_increase RPC in slot-only mode
  //     (p_participant_role = null), which creates no household row, never
  //     lowers, and re-derives event.attendees.manage server-side. The new
  //     value is max(administrator-selected capacity, materialized roster) --
  //     an explicitly higher administrator choice is preserved.
  // Any count/read/RPC error is rethrown so the save fails visibly rather
  // than silently leaving the mismatch.
  async function reconcileCapacityToMaterializedRoster(
    attendeeId: string,
    adminSelectedCapacity: number | null,
  ) {
    const { count, error: countError } = await supabase
      .from("attendee_household_members")
      .select("id", { count: "exact", head: true })
      .eq("attendee_id", attendeeId);
    if (countError) {
      throw countError;
    }

    const { data: freshAttendee, error: freshError } = await supabase
      .from("attendees")
      .select("participant_capacity")
      .eq("id", attendeeId)
      .single();
    if (freshError) {
      throw freshError;
    }

    const decision = decideCapacityReconciliation({
      storedCapacity: freshAttendee?.participant_capacity ?? null,
      materializedRosterCount: count ?? 0,
      adminSelectedCapacity,
    });

    if (decision.action !== "raise") {
      return;
    }

    const { error: reconcileError } = await supabase.rpc(
      "record_participant_capacity_increase",
      {
        p_attendee_id: attendeeId,
        p_new_capacity: decision.newCapacity,
        p_note: CAPACITY_ROSTER_RECONCILE_NOTE,
        p_participant_role: null,
      },
    );
    if (reconcileError) {
      throw reconcileError;
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
    // "copilot" -> record_participant_capacity_increase owns the Co-Pilot
    // row atomically for this save; skip it here. Additional Participants
    // that the RPC owns are identified individually by
    // rpcOwnedAdditionalUiKey below.
    rpcOwnedParticipantRole: "copilot" | "additional" | null = null,
    rpcOwnedAdditionalUiKey: string | null = null,
  ) {
    try {
      // 1. Read the current copilot row (used only to decide upsert vs
      //    delete for a cleared Co-Pilot). Additional rows are reconciled
      //    by id against editorState.additionalParticipantsAtLoad instead.
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

      // 2. Upsert the pilot row. Never deleted.
      const pilotResult = await supabase.rpc("manage_attendee_household_member", {
        p_attendee_id: attendeeId,
        p_person_role: "pilot",
        p_delete: false,
        p_first_name: payload.pilot_first || null,
        p_last_name: payload.pilot_last || null,
        p_nickname: payload.nickname || null,
        p_email: payload.email || null,
      });
      if (pilotResult.error) {
        throw pilotResult.error;
      }

      // 3. Co-Pilot: role-based singleton upsert / delete, skipped only when
      //    the capacity-increase RPC owns it.
      const hasCopilot =
        !!payload.copilot_first ||
        !!payload.copilot_last ||
        !!payload.copilot_email;
      if (rpcOwnedParticipantRole !== "copilot") {
        if (hasCopilot) {
          const r = await supabase.rpc("manage_attendee_household_member", {
            p_attendee_id: attendeeId,
            p_person_role: "copilot",
            p_delete: false,
            p_first_name: payload.copilot_first || null,
            p_last_name: payload.copilot_last || null,
            p_nickname: payload.copilot_nickname || null,
            p_email: payload.copilot_email || null,
          });
          if (r.error) {
            throw r.error;
          }
        } else if (copilotRow) {
          const r = await supabase.rpc("manage_attendee_household_member", {
            p_attendee_id: attendeeId,
            p_person_role: "copilot",
            p_delete: true,
          });
          if (r.error) {
            throw r.error;
          }
        }
      }

      // 4. Additional Participants: reconcile the working set against the
      //    load snapshot. Every mutation names its exact row by
      //    household_member_id; a new draft is a plain insert; a loaded row
      //    that is gone from the working set is deleted by id. Never a bulk
      //    "delete every 'additional' row".
      const keptIds = new Set(
        editorState.additionalParticipants
          .map((d) => d.id)
          .filter((id): id is string => id !== null),
      );

      for (const loaded of editorState.additionalParticipantsAtLoad) {
        if (loaded.id && !keptIds.has(loaded.id)) {
          const r = await supabase.rpc("manage_attendee_household_member", {
            p_attendee_id: attendeeId,
            p_person_role: "additional",
            p_delete: true,
            p_household_member_id: loaded.id,
          });
          if (r.error) {
            throw r.error;
          }
        }
      }

      for (const draft of editorState.additionalParticipants) {
        if (
          rpcOwnedAdditionalUiKey &&
          draft.uiKey === rpcOwnedAdditionalUiKey
        ) {
          continue;
        }
        const hasData = additionalDraftHasData(draft);
        if (draft.id) {
          const r = await supabase.rpc("manage_attendee_household_member", {
            p_attendee_id: attendeeId,
            p_person_role: "additional",
            p_delete: !hasData,
            p_household_member_id: draft.id,
            ...(hasData
              ? {
                  p_first_name: draft.firstName.trim() || null,
                  p_last_name: draft.lastName.trim() || null,
                  p_nickname: draft.nickname.trim() || null,
                  p_email: draft.email.trim() || null,
                  p_cell_phone: draft.cellPhone.trim() || null,
                }
              : {}),
          });
          if (r.error) {
            throw r.error;
          }
        } else if (hasData) {
          const r = await supabase.rpc("manage_attendee_household_member", {
            p_attendee_id: attendeeId,
            p_person_role: "additional",
            p_delete: false,
            p_first_name: draft.firstName.trim() || null,
            p_last_name: draft.lastName.trim() || null,
            p_nickname: draft.nickname.trim() || null,
            p_email: draft.email.trim() || null,
            p_cell_phone: draft.cellPhone.trim() || null,
          });
          if (r.error) {
            throw r.error;
          }
        }
        // an empty new draft -> nothing to write
      }
      // 5. Do not touch any other person_role rows
    } catch (err) {
      // A household write failure must fail the whole save, not be silently
      // swallowed -- the operator would otherwise believe an add / edit /
      // remove succeeded (and, on a delete-by-id, that the right row went).
      console.error("syncHouseholdMembers error", err);
      throw err;
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

      const household = await loadHouseholdParticipantsForEditor(attendee.id);

      if (household.pilotEmail) {
        nextState.email = household.pilotEmail;
      }
      if (household.copilotEmail) {
        nextState.copilot_email = household.copilotEmail;
      }

      nextState.additionalParticipants = household.additionalParticipants;
      nextState.additionalParticipantsAtLoad = snapshotAdditionalParticipants(
        household.additionalParticipants,
      );

      nextState.had_copilot_at_load = household.hadCopilot;
      nextState.copilot_name_at_load =
        fullName(attendee.copilot_first, attendee.copilot_last) ||
        household.copilotEmail ||
        "";

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
  // Co-Pilot removal: clears the fields; the next Save's syncHouseholdMembers
  // then hard-deletes the row. computeHouseholdRemovalWarnings re-confirms at
  // save time as a safety net.
  async function removeHouseholdMember(role: "copilot" | "additional") {
    if (role !== "copilot") {
      return;
    }
    const name =
      editorState.copilot_name_at_load ||
      fullName(editorState.copilot_first, editorState.copilot_last) ||
      "the Co-Pilot";

    const confirmed = await confirmViaDialog(
      "Remove household member?",
      `Remove ${name} (Co-Pilot) from this attendee record? This clears their fields; Save will then permanently remove them as a household member. This cannot be undone from here.`,
      true,
    );

    if (!confirmed) {
      return;
    }

    setEditorState((prev) => ({
      ...prev,
      copilot_first: "",
      copilot_last: "",
      copilot_nickname: "",
      copilot_email: "",
      copilot_cell_phone: "",
    }));
  }

  // Additional Participant removal identifies the exact row. Confirmed here
  // (naming the person); the draft is dropped from the working set, and the
  // next Save's syncHouseholdMembers issues a governed delete-by-id for the
  // now-missing loaded row. Never a bulk "delete every 'additional' row".
  async function removeAdditionalParticipant(uiKey: string) {
    const draft = editorState.additionalParticipants.find(
      (d) => d.uiKey === uiKey,
    );
    if (!draft) {
      return;
    }
    const name =
      fullName(draft.firstName, draft.lastName) ||
      draft.nickname ||
      draft.email ||
      "this participant";

    const confirmed = await confirmViaDialog(
      "Remove participant?",
      draft.id
        ? `Remove ${name} (Additional Participant) from this registration? They will be permanently removed as a household member when you Save. This cannot be undone from here.`
        : `Discard ${name} (Additional Participant)? This person has not been saved yet.`,
      true,
    );

    if (!confirmed) {
      return;
    }

    setEditorState((prev) => ({
      ...prev,
      additionalParticipants: prev.additionalParticipants.filter(
        (d) => d.uiKey !== uiKey,
      ),
    }));
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
    // hasCopilot uses the same three-field definition (first / last / email)
    // the governed RPC and syncHouseholdMembers use for the Co-Pilot role.
    // namedAdditionalCount / newAdditionalDrafts read the working Additional
    // Participant set (0..N) so the capacity math sees exactly the roster
    // Save is about to materialize.
    const hasCopilot =
      !!editorState.copilot_first.trim() ||
      !!editorState.copilot_last.trim() ||
      !!editorState.copilot_email.trim();
    const namedAdditionalDrafts =
      editorState.additionalParticipants.filter(additionalDraftHasData);
    const newAdditionalDrafts = namedAdditionalDrafts.filter(
      (draft) => draft.id === null,
    );

    // Governed product rule: an administrator's own authorized action of
    // adding a participant, or explicitly raising the Authorized Party Size,
    // itself authorizes the resulting participant_capacity -- no separate
    // confirmation, accounting status, or payment attestation is required.
    // "New" means a participant that did not exist when the editor loaded.
    // An unrelated save does not paper over a mismatch: after household
    // sync, reconcileCapacityToMaterializedRoster raises a KNOWN
    // participant_capacity up to the materialized roster -- never beyond an
    // explicitly higher administrator-selected value, never downward, and
    // never for a null (never-established) capacity.
    const isNewCopilot =
      editorMode === "edit" && hasCopilot && !editorState.had_copilot_at_load;
    const isNewAdditional =
      editorMode === "edit" && newAdditionalDrafts.length > 0;
    const isAddingNewParticipant = isNewCopilot || isNewAdditional;
    const resultingRosterCount =
      1 + (hasCopilot ? 1 : 0) + namedAdditionalDrafts.length;
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

    // Which household participant (if any) the governed RPC atomically
    // writes alongside the capacity increase. Prefers a new Co-Pilot;
    // otherwise the first new Additional Participant. Any other new people,
    // and every edit / delete, still sync via manage_attendee_household_member
    // below, and the RPC's own roster-count validation covers the combined
    // resulting total.
    const rpcParticipantRole: "copilot" | "additional" | null =
      !isCapacityIncrease
        ? null
        : isNewCopilot
          ? "copilot"
          : isNewAdditional
            ? "additional"
            : null;
    const rpcOwnedAdditionalDraft =
      rpcParticipantRole === "additional" ? newAdditionalDrafts[0] : null;

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
      // Existing Name Tag and Coach Plate changes are intentionally absent
      // from this broad edit payload: their two explicit governed commands
      // own those durable operational requirements. New manual attendees
      // receive the same canonical true defaults as governed imports unless
      // an operator opts out explicitly. Parking remains separately governed.
      const createPayload = {
        ...payload,
        ...(editorState.needs_name_tag === false
          ? { needs_name_tag: false }
          : {}),
        ...(editorState.needs_coach_plate === false
          ? { needs_coach_plate: false }
          : {}),
        ...(editorState.needs_parking === false
          ? { needs_parking: false }
          : {}),
      };

      if (editorMode === "create") {
        const { data: newAttendee, error: insertError } = await supabase
          .from("attendees")
          .insert(createPayload)
          .select("id")
          .single();

        if (insertError) {
          throw insertError;
        }

        // Sync pilot, copilot, and every Additional Participant. Create has
        // no atomicity concern (one INSERT then one sync), so no capacity
        // RPC ownership -- every new participant goes through the sync.
        if (newAttendee) {
          await syncHouseholdMembers(
            newAttendee.id,
            payload,
            currentEvent.id,
            editorState,
          );
          await reconcileCapacityToMaterializedRoster(
            newAttendee.id,
            requiredCapacity,
          );
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

        // Only the one participant the capacity RPC owns (a new Co-Pilot, or
        // the first new Additional Participant identified by uiKey) is
        // withheld from this sync -- so it is never written both here and by
        // the atomic RPC. Every other add / edit / delete-by-id happens here.
        await syncHouseholdMembers(
          editorState.id,
          payload,
          currentEvent.id,
          editorState,
          rpcParticipantRole,
          rpcOwnedAdditionalDraft?.uiKey ?? null,
        );

        if (isCapacityIncrease) {
          // Atomic: capacity increase, the operational audit record, and --
          // only when a participant is newly being added -- the one named
          // household row that justifies it, all commit or roll back
          // together inside this one RPC call. Calling this RPC requires
          // only valid Event-scoped admin authority: the administrator's
          // own authorized action of adding a participant, or explicitly
          // raising the Authorized Party Size, itself authorizes the
          // resulting capacity -- no separate confirmation, accounting status, or
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
                rpcOwnedAdditionalDraft?.firstName.trim() || null,
              p_additional_last_name:
                rpcOwnedAdditionalDraft?.lastName.trim() || null,
              p_additional_nickname:
                rpcOwnedAdditionalDraft?.nickname.trim() || null,
              p_additional_email:
                rpcOwnedAdditionalDraft?.email.trim() || null,
              p_additional_cell_phone:
                rpcOwnedAdditionalDraft?.cellPhone.trim() || null,
            },
          );

          if (capacityError) {
            throw capacityError;
          }
        }

        // Close any remaining gap between a KNOWN stored capacity and the
        // roster this save just materialized (covers a legitimate Co-Pilot /
        // Additional that was already present and uncounted, and any residual
        // undercount). No-op when capacity already covers the roster or is
        // unknown (null).
        await reconcileCapacityToMaterializedRoster(
          editorState.id,
          requiredCapacity,
        );
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
        // (Stage D requirement 1: dirty-state resets on a clean save). The
        // Additional Participant set is re-read from the server so every
        // just-inserted row now carries its real id -- a second save must
        // not re-insert it -- and the load snapshot the diff compares
        // against is refreshed to match.
        const household = await loadHouseholdParticipantsForEditor(
          editorState.id,
        );
        const rebased: AttendeeEditorState = {
          ...editorState,
          email: household.pilotEmail || editorState.email,
          copilot_email: household.copilotEmail || editorState.copilot_email,
          had_copilot_at_load: household.hadCopilot,
          copilot_name_at_load:
            fullName(editorState.copilot_first, editorState.copilot_last) ||
            household.copilotEmail ||
            "",
          additionalParticipants: household.additionalParticipants,
          additionalParticipantsAtLoad: snapshotAdditionalParticipants(
            household.additionalParticipants,
          ),
        };
        setEditorState(rebased);
        setEditorBaseline(rebased);
        // The reloaded drafts carry fresh uiKeys, so any expanded editor in
        // the workspace naturally collapses -- the just-saved people show as
        // cards.

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
      setSaveFeedback("Save failed. Please try again.");
      setError("We couldn't save this attendee record. Please try again.");
      setStatus("Save failed.");
    } finally {
      setEditorSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-10)" }}>
      {/* Error, then the transient success flash, then the ambient status
          line -- shown one at a time (never stacked) so a genuine problem
          is never buried beneath a routine "Loading..." line, matching
          the same priority pattern already established in Dashboard/
          Announcements/Vendors. Every setError/showFlash/setStatus call
          site that feeds these is unchanged. */}
      {!loading && error ? (
        <Alert tone="danger">{error}</Alert>
      ) : flashMessage ? (
        <Alert tone="success">{flashMessage}</Alert>
      ) : !loading && status ? (
        <Alert tone="neutral">{status}</Alert>
      ) : null}

      <>
        {/* The Canonical Shell header already carries the page title
            ("Attendees") -- no second heading duplicates it here (Part
            11). QuickActionBar is the page's own primary/secondary
            action pair, placed first in reading order. */}
        <QuickActionBar
          canEdit={canEditAttendees}
          onAddAttendee={openCreateAttendeeEditor}
          onRefresh={() => {
            if (currentEvent?.id) {
              void loadQueue(currentEvent.id);
            }
          }}
        />

        <PageSection variant="section">
          <PageHeader
            title="Roster Summary"
            headingLevel="h3"
            description="Operational counts for the selected Event."
            descriptionClassName="app-subtle-text"
          />

          <SummaryCards items={primarySummaryItems} />

          <details style={{ marginTop: "var(--space-4)" }}>
            <summary
              style={{
                cursor: "pointer",
                fontWeight: 700,
                fontSize: "var(--font-size-body)",
                minHeight: "var(--touch-target-min)",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              More stats
            </summary>
            <div style={{ marginTop: "var(--space-4)" }}>
              <SummaryCards items={secondarySummaryItems} />
            </div>
          </details>
        </PageSection>

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

        <PageSection variant="card">
          <div className="app-row-between-wrap">
            <div>
              <h2 className="app-section-title" style={{ marginTop: 0, marginBottom: "var(--space-2)" }}>Review Queue</h2>

              <div className="app-subtle-text">
                {filteredReviewItems.length} flagged attendee
                {filteredReviewItems.length === 1 ? "" : "s"}
                {showReviewQueue
                  ? " shown below."
                  : " hidden while you work the attendee list."}
              </div>
            </div>

            <AppButton onClick={() => setShowReviewQueue((prev) => !prev)}>
              {showReviewQueue ? "Hide Review Queue" : "Show Review Queue"}
            </AppButton>
          </div>

          {/* Stage B: the former standalone "Data Review" card's status
              breakdown now lives here, inside the one Review Queue toggle
              it always described, rather than as a second always-visible
              surface showing the same counts. */}
          {showReviewQueue ? (
            <div
              style={{
                marginTop: "var(--space-4)",
                display: "grid",
                gap: "var(--space-3)",
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
        </PageSection>

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
          totalAttendeesCount={attendees.length}
          filteredAttendees={filteredAttendees}
          visibleAttendees={visibleAttendees}
          reviewItems={reviewItems}
          attendeeSortMode={attendeeSortMode}
          selectedAttendeeId={editorOpen ? editorState.id : null}
          placementsByAttendeeId={placementsByAttendeeId}
          placementsLoading={placementsLoading}
          placementsError={placementsError}
          parkingNeedSavingIds={parkingNeedSavingIds}
          isCompact={isCompact}
          onSelect={(attendee) =>
            void selectAttendee(attendee, { listContext: "browse" })
          }
          onSetParkingNeed={setAttendeeParkingNeed}
        />
      </>

      <AttendeeRecordWorkspace
        open={editorOpen}
        editorMode={editorMode}
        viewState={viewState}
        isReviewContext={workspaceListContext === "review"}
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
        parkingNeedSaving={
          !!editorState.id && parkingNeedSavingIds.has(editorState.id)
        }
        nameTagNeedSaving={
          !!editorState.id &&
          operationalNeedSavingKeys.has(
            attendeeOperationalNeedSavingKey(editorState.id, "name_tag"),
          )
        }
        coachPlateNeedSaving={
          !!editorState.id &&
          operationalNeedSavingKeys.has(
            attendeeOperationalNeedSavingKey(editorState.id, "coach_plate"),
          )
        }
        onChange={updateEditorField}
        onEnterEdit={enterEditMode}
        onCancelEdit={cancelEditToView}
        onSave={handleSaveAttendeeRecord}
        onSetParkingNeed={(needsParking) => {
          const attendee = attendees.find((row) => row.id === editorState.id);
          return attendee
            ? setAttendeeParkingNeed(attendee, needsParking)
            : Promise.resolve();
        }}
        onSetNameTagNeed={(needsNameTag) => {
          const attendee = attendees.find((row) => row.id === editorState.id);
          return attendee
            ? setAttendeeOperationalNeed(attendee, "name_tag", needsNameTag)
            : Promise.resolve();
        }}
        onSetCoachPlateNeed={(needsCoachPlate) => {
          const attendee = attendees.find((row) => row.id === editorState.id);
          return attendee
            ? setAttendeeOperationalNeed(attendee, "coach_plate", needsCoachPlate)
            : Promise.resolve();
        }}
        onReloadRecord={() => {
          const freshRow = attendees.find((row) => row.id === editorState.id);
          if (freshRow) {
            void selectAttendee(freshRow, { listContext: workspaceListContext });
          }
        }}
        onRemoveHouseholdMember={removeHouseholdMember}
        onRemoveAdditionalParticipant={removeAdditionalParticipant}
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


const summaryCardStyle: CSSProperties = {
  padding: "var(--space-6)",
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-start",
  alignSelf: "start",
  height: "auto",
  boxShadow: "var(--shadow-small)",
};

const summaryValueStyle: CSSProperties = {
  fontSize: 26,
  fontWeight: 800,
  marginTop: "var(--space-2)",
  color: "var(--color-text-primary)",
};

const summaryValueErrorStyle: CSSProperties = {
  fontSize: "var(--font-size-body)",
  fontWeight: 600,
  marginTop: "var(--space-2)",
  color: "var(--color-status-error)",
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
