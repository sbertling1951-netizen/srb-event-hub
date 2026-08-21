"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { Alert, type AlertTone } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Dialog } from "@/components/ui/Dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAdmin } from "@/lib/adminContext";
import { isArchivedEventStatus } from "@/lib/eventStatus";
import {
  canAccessEvent,
} from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

type AdminUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  privilege_group: PrivilegeGroup;
  user_id: string | null;
};

type AdminUserWithPermissions = AdminUserRow & {
  permissions: AdminPermissions;
};

type EventRow = {
  id: string;
  name: string | null;
  start_date?: string | null;
  location?: string | null;
  status?: string | null;
};

type PrivilegeGroup =
  | "super_admin"
  | "event_admin"
  | "checkin"
  | "parking"
  | "content_admin"
  | "read_only";

type AdminPermissions = {
  can_manage_admins: boolean;
  can_manage_event_admins: boolean;
  can_view_admin_dashboard: boolean;
  can_manage_events: boolean;
  can_manage_checkin: boolean;
  can_manage_parking: boolean;
  can_manage_agenda: boolean;
  can_manage_announcements: boolean;
  can_manage_nearby: boolean;
  can_manage_locations: boolean;
  can_manage_reports: boolean;
  can_manage_imports: boolean;
  can_manage_event_staff: boolean;
  can_manage_master_maps: boolean;
};

const PERMISSION_LABELS: Record<keyof AdminPermissions, string> = {
  can_manage_admins: "Manage Admin Users",
  can_manage_event_admins: "Manage Event Admins",
  can_view_admin_dashboard: "View Admin Dashboard",
  can_manage_events: "Manage Events",
  can_manage_checkin: "Manage Check-In",
  can_manage_parking: "Manage Parking",
  can_manage_agenda: "Manage Agenda",
  can_manage_announcements: "Manage Announcements",
  can_manage_nearby: "Manage Nearby",
  can_manage_locations: "Manage Locations",
  can_manage_reports: "Manage Reports",
  can_manage_imports: "Manage Imports",
  can_manage_event_staff: "Manage Event Staff",
  can_manage_master_maps: "Manage Master Maps",
};

function getPresetPermissions(group: PrivilegeGroup): AdminPermissions {
  switch (group) {
    case "super_admin":
      return { can_manage_admins: true, can_manage_event_admins: true, can_view_admin_dashboard: true, can_manage_events: true, can_manage_checkin: true, can_manage_parking: true, can_manage_agenda: true, can_manage_announcements: true, can_manage_nearby: true, can_manage_locations: true, can_manage_reports: true, can_manage_imports: true, can_manage_event_staff: true, can_manage_master_maps: true };
    case "event_admin":
      return { can_manage_admins: false, can_manage_event_admins: true, can_view_admin_dashboard: true, can_manage_events: true, can_manage_checkin: true, can_manage_parking: true, can_manage_agenda: true, can_manage_announcements: true, can_manage_nearby: true, can_manage_locations: true, can_manage_reports: true, can_manage_imports: true, can_manage_event_staff: true, can_manage_master_maps: false };
    case "checkin":
      return { can_manage_admins: false, can_manage_event_admins: false, can_view_admin_dashboard: true, can_manage_events: false, can_manage_checkin: true, can_manage_parking: false, can_manage_agenda: false, can_manage_announcements: false, can_manage_nearby: false, can_manage_locations: false, can_manage_reports: false, can_manage_imports: false, can_manage_event_staff: false, can_manage_master_maps: false };
    case "parking":
      return { can_manage_admins: false, can_manage_event_admins: false, can_view_admin_dashboard: true, can_manage_events: false, can_manage_checkin: false, can_manage_parking: true, can_manage_agenda: false, can_manage_announcements: false, can_manage_nearby: false, can_manage_locations: false, can_manage_reports: false, can_manage_imports: false, can_manage_event_staff: false, can_manage_master_maps: false };
    case "content_admin":
      return { can_manage_admins: false, can_manage_event_admins: false, can_view_admin_dashboard: true, can_manage_events: false, can_manage_checkin: false, can_manage_parking: false, can_manage_agenda: true, can_manage_announcements: true, can_manage_nearby: true, can_manage_locations: true, can_manage_reports: false, can_manage_imports: false, can_manage_event_staff: false, can_manage_master_maps: false };
    case "read_only":
    default:
      return { can_manage_admins: false, can_manage_event_admins: false, can_view_admin_dashboard: true, can_manage_events: false, can_manage_checkin: false, can_manage_parking: false, can_manage_agenda: false, can_manage_announcements: false, can_manage_nearby: false, can_manage_locations: false, can_manage_reports: false, can_manage_imports: false, can_manage_event_staff: false, can_manage_master_maps: false };
  }
}

function getEventAccessRole(privilegeGroup: PrivilegeGroup) {
  switch (privilegeGroup) {
    case "super_admin": return "event_admin";
    case "event_admin": return "event_admin";
    case "content_admin": return "content";
    case "checkin": return "checkin";
    case "parking": return "parking";
    case "read_only": return "view_only";
    default: return "event_admin";
  }
}

function formatPrivilegeGroup(value?: string | null) {
  if (!value) { return ""; }
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

const defaultGroup: PrivilegeGroup = "event_admin";

// Pure, presentation-only classification of this page's own existing
// status/error/save/reset confirmation text into an Alert tone -- never a
// second source of any message itself (every setStatus/setSaveStatus/
// setResetStatus call site is unchanged). Mirrors the same heuristic
// already established for Vendor Requests (vendorRequestStatusTone) and
// Announcements (announcementStatusTone). Failure-shaped substrings are
// checked before success-shaped ones so a partial-failure message that
// still starts with "Saved" (e.g. "Saved admin user, but event access
// failed: ...") classifies as danger, not success.
export function adminUserStatusTone(message: string): AlertTone {
  const lower = message.toLowerCase();

  if (
    lower.includes("failed") ||
    lower.startsWith("could not") ||
    lower.includes("is required") ||
    lower.includes("not set")
  ) {
    return "danger";
  }

  if (lower.endsWith("...")) {
    return "info";
  }

  if (lower.startsWith("saved") || lower.includes("sent") || lower.includes("password set")) {
    return "success";
  }

  return "neutral";
}

// Current/historical grouping for the Event Access selector uses only
// isArchivedEventStatus (lib/eventStatus.ts) -- the narrow, correct
// predicate for "is this Event Past" -- never isActiveEventStatus, whose
// "not active" negative space also contains Draft (a future, not-yet-
// started Event) and Inactive, both of which are not Past. Archived
// Events sort after everything else, stable within each group
// (Array.prototype.sort is spec-guaranteed stable), so the existing
// start_date-descending fetch order is preserved within both groups --
// this only reorders across the two groups, it does not invent a second
// ordering rule, and it never infers lifecycle from dates.
export function orderEventsForAccessSelector<T extends { status?: string | null }>(
  events: T[],
): T[] {
  return [...events].sort((a, b) => {
    const aRank = isArchivedEventStatus(a.status) ? 1 : 0;
    const bRank = isArchivedEventStatus(b.status) ? 1 : 0;
    return aRank - bRank;
  });
}

// public.events.status (Supabase) is the single source of truth for the
// lifecycle label -- displayed verbatim, exactly as the sibling Events
// admin page already does (app/admin/events/page.tsx: `Status: ${status}`
// off `evt.status || "Draft"`), never collapsed through
// isActiveEventStatus's boolean. Native <select> options can only carry
// plain text (no colored LED is representable inside <option> across
// browsers) -- this produces e.g. "Saint George — Access granted ·
// Active" / "Amana27 — Access granted · Draft" / "Camp Margaritaville —
// No access · Archived". The colored StatusBadge access indicator renders
// separately, in the focused editor below the selector, where real
// DOM/CSS is available; it never carries the lifecycle status itself.
export function formatEventOptionLabel(
  event: { id: string; name: string | null; status?: string | null },
  assignedEventIds: string[],
): string {
  const name = event.name || "Untitled Event";
  const accessLabel = assignedEventIds.includes(event.id) ? "Access granted" : "No access";
  const statusLabel = event.status || "Draft";
  return `${name} — ${accessLabel} · ${statusLabel}`;
}

// Deterministic initial Event Access focus (Part 6). One priority chain
// serves both a brand-new admin (assignedEventIds is always []) and an
// existing admin (assignedEventIds reflects their real assignments):
//   1. a current/upcoming (not-Archived) event this admin already has access to
//   2. otherwise another event this admin already has access to
//   3. otherwise the first current/upcoming (not-Archived) available event
//   4. otherwise the first available event
// "Current/upcoming" here means !isArchivedEventStatus, the same narrow,
// correct predicate the ordering above uses -- not isActiveEventStatus,
// which would incorrectly treat a Draft (future) Event as not-current.
// For a new admin, steps 1-2 can never match (empty assignment set), so
// the chain naturally reduces to "first current/upcoming, else first
// available" -- exactly the separate new-admin rule the task also asks
// for, without a second implementation.
export function pickInitialEventId(
  orderedEvents: Array<{ id: string; status?: string | null }>,
  assignedEventIds: string[],
): string {
  if (orderedEvents.length === 0) {
    return "";
  }

  const assigned = new Set(assignedEventIds);

  const currentAssigned = orderedEvents.find(
    (event) => !isArchivedEventStatus(event.status) && assigned.has(event.id),
  );
  if (currentAssigned) {
    return currentAssigned.id;
  }

  const anyAssigned = orderedEvents.find((event) => assigned.has(event.id));
  if (anyAssigned) {
    return anyAssigned.id;
  }

  const currentAvailable = orderedEvents.find((event) => !isArchivedEventStatus(event.status));
  if (currentAvailable) {
    return currentAvailable.id;
  }

  return orderedEvents[0].id;
}

export default function AdminUsersPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_admins">
      <AdminShellAdapter pageTitle="Admin Users">
        <AdminUsersPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function AdminUsersPageInner() {
  const { admin } = useAdmin();
  const [rows, setRows] = useState<AdminUserWithPermissions[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading admin users...");
  const [error, setError] = useState<string | null>(null);

  const [selectedAdminId, setSelectedAdminId] = useState<string>("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [privilegeGroup, setPrivilegeGroup] = useState<PrivilegeGroup>(defaultGroup);
  const [permissions, setPermissions] = useState<AdminPermissions>(getPresetPermissions(defaultGroup));
  const [assignedEventIds, setAssignedEventIds] = useState<string[]>([]);
  const [currentAssignments, setCurrentAssignments] = useState<Array<{ id: string; event_id: string; role: string | null }>>([]);
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState("");
  const [resetStatus, setResetStatus] = useState("");
  const [sendingReset, setSendingReset] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");

  useEffect(() => {
    if (!admin) return;
    void loadPageData();
  }, [admin]);

  async function loadPageData() {
    setLoading(true);
    setError(null);
    setStatus("Loading admin users...");

    const [
      { data: adminUsers, error: adminError },
      { data: eventRows, error: eventError },
    ] = await Promise.all([
      supabase.from("admin_users").select("id, email, display_name, is_active, privilege_group, user_id").order("email", { ascending: true }),
      supabase.from("events").select("id, name, start_date, location, status").order("start_date", { ascending: false }),
    ]);

    if (adminError) { setError(adminError.message); setStatus("Could not load admin users."); setLoading(false); return; }
    if (eventError) { setError(eventError.message); setStatus("Could not load events."); setLoading(false); return; }

    const merged = ((adminUsers || []) as AdminUserRow[]).map((a) => ({
      ...a,
      permissions: getPresetPermissions(a.privilege_group || defaultGroup),
    }));

    const accessibleEvents = admin
      ? ((eventRows || []) as EventRow[]).filter((event) => !!event.id && canAccessEvent(admin, event.id))
      : [];

    setRows(merged);
    setEvents(accessibleEvents);
    setStatus("");
    setLoading(false);
  }

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedAdminId) || null,
    [rows, selectedAdminId],
  );

  // Current/upcoming events first, historical later (Part 4) -- see
  // orderEventsForAccessSelector's own comment for why this uses only
  // isArchivedEventStatus, not isActiveEventStatus.
  const orderedEvents = useMemo(() => orderEventsForAccessSelector(events), [events]);

  // Mirrors orderedEvents for use inside the async loadAssignedEvents
  // continuation below, without adding orderedEvents to that effect's own
  // dependency array (which only needs to react to selectedAdminId).
  const orderedEventsRef = useRef(orderedEvents);
  useEffect(() => {
    orderedEventsRef.current = orderedEvents;
  }, [orderedEvents]);

  const focusedEvent = useMemo(
    () => orderedEvents.find((event) => event.id === selectedEventId) || null,
    [orderedEvents, selectedEventId],
  );
  const isFocusedEventAssigned = !!focusedEvent && assignedEventIds.includes(focusedEvent.id);

  useEffect(() => {
    if (!selectedRow) { return; }
    setEmail(selectedRow.email || "");
    setDisplayName(selectedRow.display_name || "");
    setIsActive(selectedRow.is_active);
    setPrivilegeGroup(selectedRow.privilege_group || defaultGroup);
    setPermissions(selectedRow.permissions);
    setPassword("");
    setSaveStatus("");
    setResetStatus("");
  }, [selectedRow]);

  // Event Access loading/initial-focus, deliberately keyed on
  // selectedAdminId (a stable primitive) rather than selectedRow (a
  // derived object recreated -- with a new reference -- every time `rows`
  // refetches, including the refetch handleSave triggers after every
  // save). Keying on selectedRow here would silently re-run this after
  // every successful Save and discard the admin's current Event Access
  // focus; keying on selectedAdminId means it only runs when the admin
  // selection itself actually changes, so a completed Save (which never
  // changes selectedAdminId for an existing admin) leaves the focused
  // Event and the rest of assignedEventIds exactly as the admin left them.
  useEffect(() => {
    if (!selectedAdminId) {
      // startNewAdmin() already reset these synchronously; this only
      // guards a future call site that transitions selectedAdminId to ""
      // some other way. selectedEventId itself is set synchronously by
      // openNewAdminDialog and is intentionally left alone here.
      setAssignedEventIds([]);
      setCurrentAssignments([]);
      return;
    }

    setSelectedEventId("");
    void loadAssignedEvents(selectedAdminId).then((assignedIds) => {
      setSelectedEventId(pickInitialEventId(orderedEventsRef.current, assignedIds));
    });
  }, [selectedAdminId]);

  // Direct SELECT remains appropriate here (Stage 11): this is a per-admin,
  // across-Events read under the existing admin_event_access RLS policies,
  // not a per-Event governor-management projection -- that shape is what
  // list_event_authority_assignments exists for, on the Event Staff page.
  // No write happens in this function. Returns the freshly fetched event
  // ids (in addition to its existing setState side effects, unchanged)
  // so a caller that needs the just-loaded value synchronously -- the
  // effect above -- doesn't have to read back a not-yet-committed React
  // state value.
  async function loadAssignedEvents(adminUserId: string): Promise<string[]> {
    const { data, error } = await supabase.from("admin_event_access").select("id,event_id,role").eq("admin_user_id", adminUserId);
    if (error) { setAssignedEventIds([]); setCurrentAssignments([]); return []; }
    const assignments = (data || []) as Array<{ id: string; event_id: string; role: string | null }>;
    setCurrentAssignments(assignments);
    const assignedIds = assignments.map((row) => row.event_id);
    setAssignedEventIds(assignedIds);
    return assignedIds;
  }

  function startNewAdmin() {
    setSelectedAdminId("");
    setEmail("");
    setDisplayName("");
    setIsActive(true);
    setPrivilegeGroup(defaultGroup);
    setPermissions(getPresetPermissions(defaultGroup));
    setAssignedEventIds([]);
    setCurrentAssignments([]);
    setPassword("");
    setSaveStatus("");
    setResetStatus("");
  }

  // Selecting a row (or New) now opens the canonical Dialog as the edit
  // surface instead of populating an always-visible detail panel -- the
  // underlying selection/reset logic (startNewAdmin, the selectedRow
  // effect) is unchanged; only when the form becomes visible changes.
  function openEditAdminDialog(adminId: string) {
    setSelectedAdminId(adminId);
    setDialogOpen(true);
  }

  function openNewAdminDialog() {
    startNewAdmin();
    // Synchronous (no assigned-events fetch is needed for a brand-new
    // admin -- assignedEventIds is always [] here), so this is the final
    // word on initial focus; the selectedAdminId effect's own reset
    // branch (selectedAdminId is already "" or is about to become "")
    // deliberately does not touch selectedEventId, so it can't race this.
    setSelectedEventId(pickInitialEventId(orderedEvents, []));
    setDialogOpen(true);
  }

  function closeAdminDialog() {
    setDialogOpen(false);
  }

  function handlePrivilegeGroupChange(nextGroup: PrivilegeGroup) {
    setPrivilegeGroup(nextGroup);
    setPermissions(getPresetPermissions(nextGroup));
    if (nextGroup === "super_admin") { setAssignedEventIds([]); }
  }

  function toggleAssignedEvent(eventId: string) {
    setAssignedEventIds((prev) =>
      prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId],
    );
  }

  async function upsertAdminUser() {
    if (!email.trim()) {
      return {
        adminUserId: null,
        authUserId: null,
        invitationSent: false,
        errorMessage: "Email is required.",
      };
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) { return { adminUserId: null, authUserId: null, invitationSent: false, errorMessage: "Administrative authentication is required." }; }

    const response = await fetch("/api/admins/manage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        adminUserId: selectedAdminId || undefined,
        email: email.trim(),
        displayName: displayName.trim() || null,
        isActive,
        privilegeGroup,
      }),
    });
    const result = await response.json().catch(() => null);

    if (!response.ok || !result?.adminUserId) {
      return {
        adminUserId: null,
        authUserId: null,
        invitationSent: false,
        errorMessage: result?.error || "Could not save administrative user.",
      };
    }

    setSelectedAdminId(result.adminUserId);
    return {
      adminUserId: result.adminUserId as string,
      authUserId: (result.authUserId as string | null | undefined) || null,
      invitationSent: result.invitationSent === true,
      errorMessage: null,
    };
  }

  // Governed cutover: no direct admin_event_access mutation. Diffs the
  // admin's current assignments (loaded via loadAssignedEvents) against the
  // checkbox selection and issues only the governed RPC calls actually
  // needed -- removals, additions, and profile corrections for retained
  // assignments whose profile no longer matches the (possibly just
  // changed) privilege group. Nothing is touched that doesn't need to be.
  async function syncEventAccess(adminUserId: string, group: PrivilegeGroup, eventIds: string[]) {
    const targetProfile = getEventAccessRole(group);
    const wantEventIds = group === "super_admin" ? new Set<string>() : new Set(eventIds);
    const errors: string[] = [];

    const toRemove = currentAssignments.filter((a) => !wantEventIds.has(a.event_id));
    const toAdd = Array.from(wantEventIds).filter((eventId) => !currentAssignments.some((a) => a.event_id === eventId));
    const toReprofile = currentAssignments.filter((a) => wantEventIds.has(a.event_id) && a.role !== targetProfile);

    for (const assignment of toRemove) {
      const { error } = await supabase.rpc("remove_event_authority_assignment", { p_assignment_id: assignment.id });
      if (error) { errors.push(`remove: ${error.message}`); }
    }

    for (const eventId of toAdd) {
      const { error } = await supabase.rpc("create_event_authority_assignment", {
        p_target_admin_user_id: adminUserId,
        p_event_id: eventId,
        p_profile_key: targetProfile,
      });
      if (error) { errors.push(`add: ${error.message}`); }
    }

    for (const assignment of toReprofile) {
      // Faithful to the prior behavior (which unconditionally reset
      // permissions to the role's defaults on every save): apply the new
      // profile's DB-owned defaults rather than silently carrying forward
      // whatever explicit grants existed under the old profile. The
      // fine-grained Event Staff page is where an operator chooses
      // preserve_exceptions deliberately.
      const { error } = await supabase.rpc("change_event_authority_profile", {
        p_assignment_id: assignment.id,
        p_profile_key: targetProfile,
        p_disposition: "reset_to_defaults",
        p_final_task_keys: null,
      });
      if (error) { errors.push(`profile update: ${error.message}`); }
    }

    if (errors.length > 0) { return `Saved admin user, but event access failed: ${errors.join("; ")}`; }
    return null;
  }

  async function setPasswordIfProvided(userId: string | null, nextPassword: string): Promise<{ error: string | null; passwordWasSet: boolean }> {
    const trimmedPassword = nextPassword.trim();
    if (!trimmedPassword) { return { error: null, passwordWasSet: false }; }
    if (!userId) { return { error: "No linked auth user. Save again to sync user.", passwordWasSet: false }; }
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) { return { error: "Administrative authentication is required.", passwordWasSet: false }; }

    const passwordResponse = await fetch("/api/admins/set-password", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ userId, password: trimmedPassword }) });
    if (!passwordResponse.ok) { const result = await passwordResponse.json().catch(() => null); return { error: `Admin saved, but password was not set: ${result?.error || "Unknown password error"}`, passwordWasSet: false }; }
    setPassword("");
    return { error: null, passwordWasSet: true };
  }

  async function handleSave() {
    setSaving(true);
    try {
      setSaveStatus("Saving...");
      const { adminUserId, authUserId, invitationSent, errorMessage } = await upsertAdminUser();
      if (errorMessage || !adminUserId) { setSaveStatus(errorMessage || "Could not save admin user."); return; }
      const eventAccessError = await syncEventAccess(adminUserId, privilegeGroup, assignedEventIds);
      if (eventAccessError) { setSaveStatus(eventAccessError); return; }
      if (invitationSent) { setPassword(""); }
      const { error: passwordError, passwordWasSet } = await setPasswordIfProvided(
        authUserId,
        invitationSent ? "" : password,
      );
      if (passwordError) { setSaveStatus(passwordError); return; }
      setSaveStatus(
        invitationSent
          ? "Saved and invitation sent."
          : (passwordWasSet ? "Saved and password set." : "Saved."),
      );
      await loadPageData();
      await loadAssignedEvents(adminUserId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save admin user.";
      setSaveStatus(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleSendPasswordReset() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) { setResetStatus("Email is required before sending a reset email."); return; }
    setSendingReset(true);
    try {
      setResetStatus("Sending reset email...");
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, { redirectTo: typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined });
      if (resetError) { setResetStatus(`Could not send reset email: ${resetError.message}`); return; }
      setResetStatus("Password reset email sent.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not send reset email.";
      setResetStatus(msg);
    } finally {
      setSendingReset(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-8)", minWidth: 0 }}>
      <PageSection variant="card">
        <div className="app-row-between-wrap">
          <p className="app-subtle-text" style={{ margin: 0 }}>
            Default privilege groups with independent permission switches and event access.
          </p>
          {admin?.isSuperAdmin ? (
            // A same-app route: kept as Next's <Link> (client-side transition)
            // with the canonical .app-button class applied directly, rather
            // than swapped to AppLinkButton -- AppLinkButton renders a bare
            // <a>, which would silently drop client-side navigation here.
            <Link href="/admin/tenant-admins" className="app-button">
              Tenant Admin Access
            </Link>
          ) : null}
        </div>
      </PageSection>

      {status ? <Alert tone={adminUserStatusTone(status)}>{status}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <PageSection variant="card">
        <PageHeader
          title="Existing Admins"
          headingLevel="h2"
          titleClassName="app-section-title"
          description="Select an admin user to edit them."
          descriptionClassName="app-subtle-text"
          actions={
            <AppButton onClick={openNewAdminDialog} aria-haspopup="dialog">
              New
            </AppButton>
          }
        />

        {loading ? (
          <Alert tone="neutral">Loading admin users...</Alert>
        ) : rows.length === 0 ? (
          <Alert tone="neutral">No admin users found.</Alert>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {rows.map((row) => {
              const isSelected = selectedAdminId === row.id;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => openEditAdminDialog(row.id)}
                  aria-haspopup="dialog"
                  style={{
                    textAlign: "left",
                    width: "100%",
                    minWidth: 0,
                    padding: "var(--space-4) var(--space-5)",
                    borderRadius: "var(--radius-medium)",
                    border: `var(--border-width-default) solid ${isSelected ? "var(--color-text-primary)" : "var(--color-border-default)"}`,
                    background: isSelected ? "var(--color-bg-muted)" : "var(--color-bg-panel)",
                    cursor: "pointer",
                  }}
                >
                  <div className="data-table-cell-primary">{row.display_name || row.email}</div>
                  <div className="data-table-cell-meta">{row.email}</div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      marginTop: "var(--space-2)",
                    }}
                  >
                    <span className="data-table-cell-meta">{formatPrivilegeGroup(row.privilege_group)}</span>
                    <StatusBadge tone={row.is_active ? "success" : "neutral"}>
                      {row.is_active ? "Active" : "Inactive"}
                    </StatusBadge>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PageSection>

      {/* Edit/Create surface (real-device follow-up): the master list and a
          full form sharing one page forced excessive scrolling on every
          device. The form now lives in the canonical Dialog -- same fields,
          same business logic, same selectedAdminId semantics -- opened by
          selecting a row or New, closed by Cancel/Escape/backdrop click.
          app-dialog-form (app/globals.css) is a narrowly scoped width/height
          modifier consumed through Dialog's own documented className escape
          hatch; it does not touch the shared .app-dialog base rule any other
          Dialog/ConfirmDialog consumer uses. */}
      <Dialog
        open={dialogOpen}
        onClose={closeAdminDialog}
        title={selectedAdminId ? "Edit Admin User" : "New Admin User"}
        description={
          selectedAdminId
            ? "Update this admin user, privilege group, and event access."
            : "Create a new admin user and assign event access."
        }
        className="app-dialog-form"
        footer={
          <>
            <AppButton onClick={closeAdminDialog}>Cancel</AppButton>
            <AppButton variant="primary" onClick={() => void handleSave()} loading={saving}>
              {selectedAdminId ? "Save Changes" : "Create Admin User"}
            </AppButton>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-5)", minWidth: 0 }}>
          <div className="app-dialog-form-pair">
            <Field label="Email">
              {(controlProps) => (
                <Input {...controlProps} value={email} onChange={(e) => setEmail(e.target.value)} />
              )}
            </Field>
            <Field label="Display Name">
              {(controlProps) => (
                <Input {...controlProps} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              )}
            </Field>
          </div>

          <div className="app-dialog-form-pair-auto">
            <Field
              label={selectedAdminId ? "Set New Password" : "Initial Password"}
              help={
                selectedAdminId
                  ? "Only enter a password if you want to change it."
                  : "Temporary password for first login."
              }
            >
              {(controlProps) => (
                <Input
                  {...controlProps}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={selectedAdminId ? "Leave blank to keep existing password" : "Enter temporary password"}
                />
              )}
            </Field>
            {selectedAdminId ? (
              <AppButton
                variant="secondary"
                onClick={() => void handleSendPasswordReset()}
                loading={sendingReset}
              >
                Send Reset Email
              </AppButton>
            ) : null}
          </div>

          {resetStatus ? <Alert tone={adminUserStatusTone(resetStatus)}>{resetStatus}</Alert> : null}

          <div className="app-dialog-form-pair">
            <Field label="Privilege Group">
              {(controlProps) => (
                <Select
                  {...controlProps}
                  value={privilegeGroup}
                  onChange={(e) => handlePrivilegeGroupChange(e.target.value as PrivilegeGroup)}
                >
                  <option value="super_admin">Super Admin</option>
                  <option value="event_admin">Event Admin</option>
                  <option value="checkin">Check-In</option>
                  <option value="parking">Parking</option>
                  <option value="content_admin">Content Admin</option>
                  <option value="read_only">Read Only</option>
                </Select>
              )}
            </Field>
            <div>
              <span className="app-field-label" style={{ display: "block", marginBottom: "var(--space-2)" }}>
                Status
              </span>
              <Checkbox
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                label="Active admin user"
              />
            </div>
          </div>

          <div>
            <strong>Permissions</strong>
            <p className="app-subtle-text" style={{ marginTop: "var(--space-1)", marginBottom: "var(--space-5)" }}>
              Permissions are derived from the selected privilege group. Use Event Staff for event-specific permission assignments.
            </p>
            <div className="app-permission-grid">
              {(Object.keys(PERMISSION_LABELS) as Array<keyof AdminPermissions>).map((key) => (
                <Checkbox
                  key={key}
                  checked={!!permissions[key]}
                  readOnly
                  aria-readonly="true"
                  title="Permission is controlled by the selected privilege group"
                  style={{ cursor: "not-allowed", opacity: 0.6 }}
                  label={PERMISSION_LABELS[key]}
                />
              ))}
            </div>
          </div>

          <div>
            <strong>Event Access</strong>
            <p className="app-subtle-text" style={{ marginTop: "var(--space-1)", marginBottom: "var(--space-5)" }}>
              Super Admin automatically has access to all events. For other admins, choose an Event below to view or change its access.
            </p>
            {privilegeGroup === "super_admin" ? (
              <Alert tone="neutral">Super Admin automatically has access to all events.</Alert>
            ) : orderedEvents.length === 0 ? (
              <Alert tone="neutral">No events found.</Alert>
            ) : (
              <div style={{ display: "grid", gap: "var(--space-4)" }}>
                <Field label="Event">
                  {(controlProps) => (
                    <Select
                      {...controlProps}
                      value={selectedEventId}
                      onChange={(e) => setSelectedEventId(e.target.value)}
                    >
                      {orderedEvents.map((event) => (
                        <option key={event.id} value={event.id}>
                          {formatEventOptionLabel(event, assignedEventIds)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                {focusedEvent ? (
                  <div
                    style={{
                      display: "grid",
                      gap: "var(--space-3)",
                      padding: "var(--space-4)",
                      border: "var(--border-width-default) solid var(--color-border-default)",
                      borderRadius: "var(--radius-medium)",
                      background: "var(--color-bg-panel)",
                    }}
                  >
                    <div className="app-row-between-wrap">
                      <div style={{ minWidth: 0 }}>
                        <div className="data-table-cell-primary" style={{ overflowWrap: "anywhere" }}>
                          {focusedEvent.name || "Untitled Event"}
                          {focusedEvent.location ? ` • ${focusedEvent.location}` : ""}
                        </div>
                        {/* Event lifecycle is a separate concept from admin
                            access (Part 3) -- plain text, never the same
                            green/yellow indicator used for access below.
                            public.events.status is the single source of
                            truth, shown verbatim (never collapsed through
                            isActiveEventStatus's boolean), matching the
                            exact "Status: X" pattern already established
                            on the sibling Events admin page. */}
                        <div className="data-table-cell-meta">Status: {focusedEvent.status || "Draft"}</div>
                      </div>
                      <StatusBadge tone={isFocusedEventAssigned ? "success" : "warning"}>
                        {isFocusedEventAssigned ? "Access granted" : "No access"}
                      </StatusBadge>
                    </div>

                    <Checkbox
                      checked={isFocusedEventAssigned}
                      onChange={() => toggleAssignedEvent(focusedEvent.id)}
                      label="Grant access to this Event"
                    />

                    <p className="app-subtle-text" style={{ margin: 0 }}>
                      Access role for this Event: {formatPrivilegeGroup(privilegeGroup)} (derived from the Privilege Group selected above).
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {saveStatus ? <Alert tone={adminUserStatusTone(saveStatus)}>{saveStatus}</Alert> : null}
        </div>
      </Dialog>
    </div>
  );
}
