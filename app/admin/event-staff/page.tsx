"use client";

import { useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { Alert, type AlertTone } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox, Field, Select } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageSection } from "@/components/ui/PageSection";
import { RowActions } from "@/components/ui/RowActions";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  setCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import {
  canAccessEvent,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

type EventRow = {
  id: string;
  name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  visible_to_members?: boolean | null;
};

type PrivilegeGroup = "super_admin" | "event_admin" | "checkin" | "parking" | "content_admin" | "read_only";

type AdminUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  privilege_group: PrivilegeGroup | null;
};

// Canonical Event profile vocabulary owned by admin_event_profiles. No
// coercion mapping exists anywhere in this file -- these five values are
// sent to governed RPCs unchanged.
type CanonicalProfile = "event_admin" | "content" | "checkin" | "parking" | "view_only";

type EventTaskMeta = {
  task_key: string;
  scope: string;
  task_kind: string;
  description: string;
};

type ProfileCatalogEntry = {
  profile_key: CanonicalProfile;
  display_name: string;
  description: string;
  profile_default_task_keys: string[];
  event_task_catalog: EventTaskMeta[];
};

type ExplicitGrant = {
  task_key: string;
  granted_at: string;
  grant_source: string;
  source_profile_key: string | null;
  granted_by_admin_user_id: string | null;
};

type AssignmentRow = {
  assignment_id: string;
  event_id: string;
  tenant_id: string;
  target_admin_user_id: string;
  target_display_name: string | null;
  target_email: string | null;
  canonical_profile: CanonicalProfile;
  assignment_created_at: string;
  explicit_grants: ExplicitGrant[];
  can_govern: boolean;
};

type StaffRow = {
  accessId: string;
  adminUserId: string;
  eventId: string;
  email: string;
  displayName: string;
  privilegeGroup: string | null;
  canonicalProfile: CanonicalProfile;
  canGovern: boolean;
  explicitGrantKeys: Set<string>;
  pendingProfileChoice: CanonicalProfile;
};

const EVENT_ROLE_OPTIONS: Array<{ value: CanonicalProfile; label: string }> = [
  { value: "event_admin", label: "Event Admin" },
  { value: "content", label: "Content" },
  { value: "checkin", label: "Check-In" },
  { value: "parking", label: "Parking" },
  { value: "view_only", label: "View Only" },
];

function formatDateRange(startDate: string | null | undefined, endDate: string | null | undefined) {
  if (!startDate && !endDate) { return ""; }
  if (startDate && endDate) { return `${startDate} – ${endDate}`; }
  return startDate || endDate || "";
}

function formatPrivilegeGroup(value?: string | null) {
  if (!value) { return "—"; }
  switch (value) {
    case "super_admin": return "Super Admin";
    case "event_admin": return "Event Admin";
    case "checkin": return "Check-In";
    case "parking": return "Parking";
    case "content_admin": return "Content Admin";
    case "read_only": return "Read Only";
    default: return value.replace(/_/g, " ");
  }
}

// Maps a governed-RPC failure (a raised database exception, surfaced by
// PostgREST as error.message) to an explicit, human-readable reason. Never
// falls back to a direct-table mutation on any of these -- the RPC is the
// only write path, so a failure here always means "not applied."
function describeRpcError(err: any): string {
  const msg: string = err?.message || String(err || "Unknown error");
  if (/not an active (super_admin|admin)|caller is not/i.test(msg)) return "You are not authorized to govern this Event's assignments.";
  if (/lacks Event governance authority/i.test(msg)) return "You do not have Platform or Tenant authority over this Event.";
  if (/event or tenant not found/i.test(msg)) return "This Event (or its Tenant) could not be found.";
  if (/self-elevation is forbidden/i.test(msg)) return "You cannot change your own assignment.";
  if (/unknown profile|invalid profile change/i.test(msg)) return "That is not a recognized canonical profile.";
  if (/task is not Event-grantable|invalid final task/i.test(msg)) return "That is not a recognized Event task.";
  if (/assignment not found/i.test(msg)) return "This assignment no longer exists -- it may have been removed by someone else. Refreshing.";
  if (/target is not active admin/i.test(msg)) return "That administrator is not active.";
  return `Request failed: ${msg}`;
}

// Pure, presentation-only classification of this page's own existing
// `status` confirmation/guidance text into an Alert tone -- never a second
// source of any message itself (every setStatus call site is unchanged).
// Mirrors the same heuristic already established for Announcements/Admin
// Users/Locations/Master Maps/Events.
export function eventStaffStatusTone(message: string): AlertTone {
  const lower = message.toLowerCase();

  if (
    lower.startsWith("could not") ||
    lower.startsWith("failed to") ||
    lower.startsWith("request failed") ||
    lower.startsWith("access denied") ||
    lower.startsWith("you do not have") ||
    lower.startsWith("you are not authorized") ||
    lower.startsWith("you cannot") ||
    lower.startsWith("that is not") ||
    lower.startsWith("that administrator is not") ||
    lower.startsWith("this event") ||
    lower.startsWith("this assignment no longer exists") ||
    lower.startsWith("choose an admin user") ||
    lower.startsWith("no admin working event") ||
    lower.startsWith("no working event")
  ) {
    return "danger";
  }

  if (lower.endsWith("...")) {
    return "info";
  }

  if (
    lower.startsWith("loaded") ||
    lower.startsWith("event staff added") ||
    lower.startsWith("profile updated") ||
    lower.endsWith("removed from event staff.")
  ) {
    return "success";
  }

  return "neutral";
}

function EventStaffPageInner() {
  const { admin } = useAdmin();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [availableAdmins, setAvailableAdmins] = useState<AdminUserRow[]>([]);
  const [profileCatalog, setProfileCatalog] = useState<ProfileCatalogEntry[]>([]);
  const [taskCatalog, setTaskCatalog] = useState<EventTaskMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading event staff...");
  const [busyAccessId, setBusyAccessId] = useState<string | null>(null);
  const [busyTaskKey, setBusyTaskKey] = useState<string | null>(null);

  const [newAdminUserId, setNewAdminUserId] = useState("");
  const [newProfile, setNewProfile] = useState<CanonicalProfile>("view_only");
  const [adding, setAdding] = useState(false);
  const [pendingRemoveRow, setPendingRemoveRow] = useState<StaffRow | null>(null);

  useEffect(() => {
    if (!admin) return;
    const safeAdmin = admin;

    if (
      !hasPermission(safeAdmin, "can_manage_event_staff") &&
      !hasPermission(safeAdmin, "can_manage_event_admins") &&
      !hasPermission(safeAdmin, "can_manage_admins")
    ) {
      setError("You do not have permission to manage event staff.");
      setStatus("Access denied.");
      setLoading(false);
      return;
    }

    async function loadForCurrentEvent() {
      const adminEvent = getCurrentAdminEvent();

      if (!adminEvent?.id) {
        setEvent(null); setEvents([]); setSelectedEventId(""); setRows([]); setAvailableAdmins([]);
        setStatus("No admin working event selected.");
        setLoading(false);
        return;
      }

      if (!canAccessEvent(safeAdmin, adminEvent.id)) {
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      await loadPage(adminEvent.id);
    }

    void loadForCurrentEvent();
    const unsubscribe = subscribeToAdminWorkspace(() => {
      void loadForCurrentEvent();
    });

    return unsubscribe;
  }, [admin]);

  // Pure read: lists Events/admin users (unrelated to Event authority
  // state, legitimate under existing RLS) plus the two governed
  // authority-management reads. No write of any kind happens here --
  // opening this page never creates an assignment, a grant, or an audit
  // row.
  async function loadPage(eventId: string) {
    try {
      setLoading(true);
      setError(null);
      setStatus("Loading event staff...");

      const [
        { data: eventData, error: eventError },
        { data: eventsData, error: eventsError },
        { data: adminUsersData, error: adminUsersError },
        { data: assignmentsData, error: assignmentsError },
        { data: catalogData, error: catalogError },
      ] = await Promise.all([
        supabase.from("events").select("id,name,location,start_date,end_date").eq("id", eventId).single(),
        supabase.from("events").select("id,name,location,start_date,end_date,visible_to_members").order("start_date", { ascending: false }).order("name", { ascending: true }),
        supabase.from("admin_users").select("id,email,display_name,is_active,privilege_group").eq("is_active", true).order("email", { ascending: true }),
        supabase.rpc("list_event_authority_assignments", { p_event_id: eventId }),
        supabase.rpc("list_event_authority_profile_catalog", { p_event_id: eventId }),
      ]);

      if (eventError) { throw eventError; }
      if (eventsError) { throw eventsError; }
      if (adminUsersError) { throw adminUsersError; }
      if (assignmentsError) { throw new Error(describeRpcError(assignmentsError)); }
      if (catalogError) { throw new Error(describeRpcError(catalogError)); }

      const eventRow = eventData as EventRow;
      const allEvents = (eventsData || []) as EventRow[];
      const adminUsers = (adminUsersData || []) as AdminUserRow[];
      const assignmentRows = (assignmentsData || []) as AssignmentRow[];
      const catalogRows = (catalogData || []) as ProfileCatalogEntry[];

      const adminById = new Map(adminUsers.map((row) => [row.id, row]));

      const mergedRows: StaffRow[] = assignmentRows.map((a) => {
        const adminUser = adminById.get(a.target_admin_user_id);
        return {
          accessId: a.assignment_id,
          adminUserId: a.target_admin_user_id,
          eventId: a.event_id,
          email: a.target_email || adminUser?.email || "Unknown admin",
          displayName: a.target_display_name || adminUser?.display_name || "",
          privilegeGroup: adminUser?.privilege_group || null,
          canonicalProfile: a.canonical_profile,
          canGovern: a.can_govern,
          // Explicit grants are the authoritative current state -- never
          // synthesized from the profile's defaults. Zero grants means the
          // set below is empty, and it is displayed as exactly that.
          explicitGrantKeys: new Set(a.explicit_grants.map((g) => g.task_key)),
          pendingProfileChoice: a.canonical_profile,
        };
      });

      const assignedAdminIds = new Set(mergedRows.map((row) => row.adminUserId));
      const available = adminUsers.filter((a) => a.is_active && a.privilege_group !== "super_admin" && !assignedAdminIds.has(a.id));

      setEvent(eventRow);
      setEvents(allEvents);
      setSelectedEventId(eventRow.id);
      setRows(mergedRows);
      setAvailableAdmins(available);
      setProfileCatalog(catalogRows);
      setTaskCatalog(catalogRows[0]?.event_task_catalog || []);
      setStatus(`Loaded ${mergedRows.length} staff assignments.`);
    } catch (err: any) {
      console.error("loadPage error:", err);
      const message = err?.message || "Failed to load event staff.";
      setError(message);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleEventChange(nextEventId: string) {
    setSelectedEventId(nextEventId);
    if (!nextEventId) { setEvent(null); setRows([]); setAvailableAdmins([]); setStatus("No event selected."); return; }
    const selected = events.find((item) => item.id === nextEventId);
    setCurrentAdminEvent({
      id: nextEventId,
      name: selected?.name || "Selected Event",
      eventName: selected?.name || "Selected Event",
      location: selected?.location || null,
      start_date: selected?.start_date || null,
      end_date: selected?.end_date || null,
    });
    await loadPage(nextEventId);
  }

  async function handleAddStaff() {
    if (!event?.id) { setStatus("No working event selected."); return; }
    if (!newAdminUserId) { setStatus("Choose an admin user to add."); return; }
    try {
      setAdding(true);
      setError(null);
      setStatus("Adding event staff...");
      const { error: rpcError } = await supabase.rpc("create_event_authority_assignment", {
        p_target_admin_user_id: newAdminUserId,
        p_event_id: event.id,
        p_profile_key: newProfile,
      });
      if (rpcError) { throw new Error(describeRpcError(rpcError)); }
      setNewAdminUserId(""); setNewProfile("view_only");
      await loadPage(event.id);
      setStatus("Event staff added.");
    } catch (err: any) {
      console.error("handleAddStaff error:", err);
      const message = err?.message || "Could not add event staff.";
      setError(message);
      setStatus(message);
    } finally {
      setAdding(false);
    }
  }

  function updatePendingProfileChoice(accessId: string, profile: CanonicalProfile) {
    setRows((prev) => prev.map((row) => row.accessId === accessId ? { ...row, pendingProfileChoice: profile } : row));
  }

  // Profile changes always require an explicit disposition -- there is no
  // silent default. reset_to_defaults replaces explicit grants with the
  // new profile's DB-owned bundle; preserve_exceptions keeps the current
  // explicit grant set exactly, only relabeling the profile.
  async function handleChangeProfile(row: StaffRow, disposition: "reset_to_defaults" | "preserve_exceptions") {
    if (!event?.id || !row.canGovern) { return; }
    try {
      setBusyAccessId(row.accessId);
      setError(null);
      setStatus(`Changing profile for ${row.displayName || row.email}...`);
      const { error: rpcError } = await supabase.rpc("change_event_authority_profile", {
        p_assignment_id: row.accessId,
        p_profile_key: row.pendingProfileChoice,
        p_disposition: disposition,
        p_final_task_keys: disposition === "preserve_exceptions" ? Array.from(row.explicitGrantKeys) : null,
      });
      if (rpcError) { throw new Error(describeRpcError(rpcError)); }
      await loadPage(event.id);
      setStatus(`Profile updated for ${row.displayName || row.email}.`);
    } catch (err: any) {
      console.error("handleChangeProfile error:", err);
      const message = err?.message || "Could not change profile.";
      setError(message);
      setStatus(message);
      if (event?.id) { await loadPage(event.id); }
    } finally {
      setBusyAccessId(null);
    }
  }

  // Each checkbox toggle is its own atomic governed call -- grant or
  // revoke exactly one canonical task, immediately. No bulk "Save" button
  // and no implicit diff-and-replace, so there is never a moment where the
  // UI's local state and the database's explicit-grant state can silently
  // diverge.
  async function handleToggleTask(row: StaffRow, taskKey: string, nextEnabled: boolean) {
    if (!event?.id || !row.canGovern) { return; }
    try {
      setBusyAccessId(row.accessId);
      setBusyTaskKey(taskKey);
      setError(null);
      const { error: rpcError } = nextEnabled
        ? await supabase.rpc("grant_event_authority_task", { p_assignment_id: row.accessId, p_task_key: taskKey })
        : await supabase.rpc("revoke_event_authority_task", { p_assignment_id: row.accessId, p_task_key: taskKey });
      if (rpcError) { throw new Error(describeRpcError(rpcError)); }
      await loadPage(event.id);
    } catch (err: any) {
      console.error("handleToggleTask error:", err);
      const message = err?.message || "Could not update task grant.";
      setError(message);
      setStatus(message);
      if (event?.id) { await loadPage(event.id); }
    } finally {
      setBusyAccessId(null);
      setBusyTaskKey(null);
    }
  }

  function requestRemoveRow(row: StaffRow) {
    if (!event?.id || !row.canGovern) { return; }
    setPendingRemoveRow(row);
  }

  async function handleRemoveRow(row: StaffRow) {
    setPendingRemoveRow(null);
    if (!event?.id || !row.canGovern) { return; }
    try {
      setBusyAccessId(row.accessId);
      setError(null);
      setStatus(`Removing ${row.displayName || row.email}...`);
      const { error: rpcError } = await supabase.rpc("remove_event_authority_assignment", { p_assignment_id: row.accessId });
      if (rpcError) { throw new Error(describeRpcError(rpcError)); }
      await loadPage(event.id);
      setStatus(`${row.displayName || row.email} removed from event staff.`);
    } catch (err: any) {
      console.error("handleRemoveRow error:", err);
      const message = err?.message || "Could not remove event staff.";
      setError(message);
      setStatus(message);
      if (event?.id) { await loadPage(event.id); }
    } finally {
      setBusyAccessId(null);
    }
  }

  const dateRange = formatDateRange(event?.start_date, event?.end_date);

  return (
    <div style={{ padding: "var(--space-6)", display: "grid", gap: "var(--space-4)" }}>
      <ConfirmDialog
        open={!!pendingRemoveRow}
        title="Remove Event Staff"
        message={`Remove ${pendingRemoveRow?.displayName || pendingRemoveRow?.email || "this admin"} from this event staff list?`}
        confirmLabel="Remove"
        danger
        busy={!!pendingRemoveRow && busyAccessId === pendingRemoveRow.accessId}
        onCancel={() => setPendingRemoveRow(null)}
        onConfirm={() => void handleRemoveRow(pendingRemoveRow!)}
      />

      <PageSection variant="card">
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <p className="app-subtle-text" style={{ margin: 0, fontWeight: "var(--font-weight-semibold)" as unknown as number }}>
            Working event: {event?.name || "No working event selected"}
          </p>

          <Field label="Select Event">
            {(controlProps) => (
              <Select
                {...controlProps}
                value={selectedEventId}
                onChange={(e) => void handleEventChange(e.target.value)}
                disabled={loading || events.length === 0}
              >
                <option value="">Select event</option>
                {events.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name || "Untitled Event"}{item.start_date ? ` • ${item.start_date}` : ""}{item.location ? ` • ${item.location}` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {event?.location ? <p className="app-subtle-text" style={{ margin: 0 }}>{event.location}</p> : null}
          {dateRange ? <p className="app-subtle-text" style={{ margin: 0 }}>{dateRange}</p> : null}
          {status ? <Alert tone={eventStaffStatusTone(status)}>{status}</Alert> : null}
        </div>
      </PageSection>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <PageSection variant="card" title="Add Existing Admin">
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <div className="app-form-grid-2">
            <Field
              label="Admin User"
              help={availableAdmins.length === 0 ? "No available existing admin users to add for this event." : undefined}
            >
              {(controlProps) => (
                <Select
                  {...controlProps}
                  value={newAdminUserId}
                  onChange={(e) => setNewAdminUserId(e.target.value)}
                  disabled={adding}
                >
                  <option value="">Select admin user</option>
                  {availableAdmins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.display_name || a.email}{a.display_name ? ` • ${a.email}` : ""}{a.privilege_group ? ` • ${formatPrivilegeGroup(a.privilege_group)}` : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Canonical Profile">
              {(controlProps) => (
                <Select
                  {...controlProps}
                  value={newProfile}
                  onChange={(e) => setNewProfile(e.target.value as CanonicalProfile)}
                  disabled={adding}
                >
                  {EVENT_ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                </Select>
              )}
            </Field>
          </div>

          <FormActions>
            <AppButton
              variant="primary"
              onClick={() => void handleAddStaff()}
              disabled={adding || !newAdminUserId || !event?.id}
            >
              {adding ? "Adding..." : "Add Staff"}
            </AppButton>
          </FormActions>
        </div>
      </PageSection>

      <PageSection
        variant="card"
        title="Assigned Event Staff"
        titleStyle={{ marginBottom: "var(--space-1)" }}
      >
        <p className="app-subtle-text" style={{ marginTop: 0, marginBottom: "var(--space-4)" }}>
          {rows.length} assignment{rows.length === 1 ? "" : "s"} for this event. Super Admins are not listed here because they automatically have access to all events.
        </p>

        {loading ? (
          <LoadingState message="Loading event staff..." />
        ) : !event ? (
          <EmptyState message="Select an event to view staff." />
        ) : rows.length === 0 ? (
          <EmptyState message="No event staff assigned yet." />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {rows.map((row) => {
              const profileEntry = profileCatalog.find((p) => p.profile_key === row.pendingProfileChoice);
              const profileDefaultKeys = new Set(profileEntry?.profile_default_task_keys || []);
              const rowBusy = busyAccessId === row.accessId;
              return (
                <div
                  key={row.accessId}
                  style={{
                    border: "var(--border-width-default) solid var(--color-border-default)",
                    borderRadius: "var(--radius-medium)",
                    background: "var(--color-bg-muted)",
                    padding: "var(--space-4)",
                  }}
                >
                  <div className="app-permission-grid" style={{ alignItems: "end", width: "100%" }}>
                    <div>
                      <div className="data-table-cell-primary">{row.displayName || row.email}</div>
                      <div className="data-table-cell-meta" style={{ marginTop: "var(--space-1)" }}>{row.email}</div>
                      <div className="data-table-cell-meta" style={{ marginTop: "var(--space-1)" }}>Base group: {formatPrivilegeGroup(row.privilegeGroup)}</div>
                      {!row.canGovern ? (
                        <p style={{ fontSize: "var(--font-size-caption)", color: "var(--color-status-error)", marginTop: "var(--space-1)" }}>
                          This is your own assignment -- self-elevation is not permitted.
                        </p>
                      ) : null}
                    </div>
                    <Field
                      label="Canonical Profile"
                      help={
                        <>
                          Current:{" "}
                          <strong>{EVENT_ROLE_OPTIONS.find((o) => o.value === row.canonicalProfile)?.label || row.canonicalProfile}</strong>
                        </>
                      }
                    >
                      {(controlProps) => (
                        <Select
                          {...controlProps}
                          value={row.pendingProfileChoice}
                          onChange={(e) => updatePendingProfileChoice(row.accessId, e.target.value as CanonicalProfile)}
                          disabled={rowBusy || !row.canGovern}
                        >
                          {EVENT_ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                        </Select>
                      )}
                    </Field>
                    <RowActions>
                      <AppButton
                        onClick={() => void requestRemoveRow(row)}
                        disabled={rowBusy || !row.canGovern}
                      >
                        {rowBusy && busyTaskKey === null ? "Removing..." : "Remove"}
                      </AppButton>
                    </RowActions>
                  </div>

                  {row.pendingProfileChoice !== row.canonicalProfile ? (
                    <div className="app-flex-wrap-12" style={{ marginTop: "var(--space-3)" }}>
                      <AppButton
                        variant="primary"
                        onClick={() => void handleChangeProfile(row, "reset_to_defaults")}
                        disabled={rowBusy || !row.canGovern}
                      >
                        {rowBusy ? "Working..." : "Apply: Reset to Defaults"}
                      </AppButton>
                      <AppButton
                        onClick={() => void handleChangeProfile(row, "preserve_exceptions")}
                        disabled={rowBusy || !row.canGovern}
                      >
                        {rowBusy ? "Working..." : "Apply: Preserve Current Grants"}
                      </AppButton>
                    </div>
                  ) : null}

                  <div style={{ marginTop: "var(--space-4)" }}>
                    <strong>Current Explicit Grants</strong>
                    <p className="app-subtle-text" style={{ marginTop: "var(--space-1)", marginBottom: "var(--space-3)" }}>
                      These are the tasks this assignment actually has authority for right now. An unchecked task is not granted, even if the profile below would normally include it as a default.
                    </p>
                    <div className="app-permission-grid">
                      {taskCatalog.map((task) => {
                        const checked = row.explicitGrantKeys.has(task.task_key);
                        const isDefaultForPendingProfile = profileDefaultKeys.has(task.task_key);
                        return (
                          <Checkbox
                            key={task.task_key}
                            checked={checked}
                            disabled={rowBusy || !row.canGovern}
                            onChange={(e) => void handleToggleTask(row, task.task_key, e.target.checked)}
                            label={
                              <>
                                {task.description}
                                {isDefaultForPendingProfile ? (
                                  <span className="app-subtle-text"> (profile default)</span>
                                ) : null}
                              </>
                            }
                          />
                        );
                      })}
                    </div>
                  </div>

                  {profileEntry ? (
                    <p className="app-subtle-text" style={{ marginTop: "var(--space-3)", marginBottom: 0 }}>
                      <strong>{profileEntry.display_name}</strong> profile defaults (reference only, not current authority): {profileEntry.profile_default_task_keys.length === 0 ? "none" : profileEntry.profile_default_task_keys.join(", ")}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </PageSection>
    </div>
  );
}

export default function EventStaffPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_event_staff">
      <AdminShellAdapter pageTitle="Event Staff">
        <EventStaffPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
