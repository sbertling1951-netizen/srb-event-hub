"use client";

import { type CSSProperties, useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import {
  getCurrentAdminEvent,
  setCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import {
  canAccessEvent,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";
import { useAdmin } from "@/lib/adminContext";
import { supabase } from "@/lib/supabase";

type AdminEventContext = {
  id?: string | null;
  name?: string | null;
};

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

type EventAccessRole = "event_admin" | "content_admin" | "checkin" | "parking" | "read_only";

type AdminEventAccessRow = {
  id: string;
  admin_user_id: string;
  event_id: string;
  role: EventAccessRole | null;
  created_at?: string | null;
};

type AdminEventPermissionRow = {
  id: string;
  admin_event_access_id: string;
  permission_key: string;
  is_enabled: boolean;
};

type StaffRow = {
  accessId: string;
  adminUserId: string;
  eventId: string;
  email: string;
  displayName: string;
  privilegeGroup: string | null;
  role: EventAccessRole;
  permissions: Record<string, boolean>;
};

type PermissionKey =
  | "can_view_admin_dashboard"
  | "can_manage_events"
  | "can_manage_checkin"
  | "can_manage_parking"
  | "can_manage_agenda"
  | "can_manage_announcements"
  | "can_manage_nearby"
  | "can_manage_locations"
  | "can_manage_reports"
  | "can_manage_imports"
  | "can_manage_event_staff";

const EVENT_ROLE_OPTIONS: Array<{ value: EventAccessRole; label: string }> = [
  { value: "event_admin", label: "Event Admin" },
  { value: "content_admin", label: "Content Admin" },
  { value: "checkin", label: "Check-In" },
  { value: "parking", label: "Parking" },
  { value: "read_only", label: "Read Only" },
];

const PERMISSION_LABELS: Record<PermissionKey, string> = {
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
};

const ALL_PERMISSION_KEYS = Object.keys(PERMISSION_LABELS) as PermissionKey[];

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

function buildPermissionMap(role: EventAccessRole, explicitKeys?: string[], hasExplicitPermissions = false): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  ALL_PERMISSION_KEYS.forEach((key) => { map[key] = false; });

  const roleDefaults: Record<EventAccessRole, PermissionKey[]> = {
    event_admin: ["can_view_admin_dashboard", "can_manage_events", "can_manage_checkin", "can_manage_parking", "can_manage_agenda", "can_manage_announcements", "can_manage_nearby", "can_manage_locations", "can_manage_reports", "can_manage_imports", "can_manage_event_staff"],
    content_admin: ["can_view_admin_dashboard", "can_manage_agenda", "can_manage_announcements", "can_manage_nearby", "can_manage_locations"],
    checkin: ["can_view_admin_dashboard", "can_manage_checkin"],
    parking: ["can_view_admin_dashboard", "can_manage_parking"],
    read_only: ["can_view_admin_dashboard"],
  };

  roleDefaults[role].forEach((key) => { map[key] = true; });

  if (hasExplicitPermissions) {
    ALL_PERMISSION_KEYS.forEach((key) => { map[key] = !!explicitKeys?.includes(key); });
  }

  return map;
}

function EventStaffPageInner() {
  const { admin } = useAdmin();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [availableAdmins, setAvailableAdmins] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading event staff...");
  const [savingAccessId, setSavingAccessId] = useState<string | null>(null);
  const [removingAccessId, setRemovingAccessId] = useState<string | null>(null);

  const [newAdminUserId, setNewAdminUserId] = useState("");
  const [newRole, setNewRole] = useState<EventAccessRole>("read_only");
  const [adding, setAdding] = useState(false);

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

  async function loadPage(eventId: string) {
    try {
      setLoading(true);
      setError(null);
      setStatus("Loading event staff...");

      const [
        { data: eventData, error: eventError },
        { data: eventsData, error: eventsError },
        { data: adminUsersData, error: adminUsersError },
        { data: accessData, error: accessError },
      ] = await Promise.all([
        supabase.from("events").select("id,name,location,start_date,end_date").eq("id", eventId).single(),
        supabase.from("events").select("id,name,location,start_date,end_date,visible_to_members").order("start_date", { ascending: false }).order("name", { ascending: true }),
        supabase.from("admin_users").select("id,email,display_name,is_active,privilege_group").eq("is_active", true).order("email", { ascending: true }),
        supabase.from("admin_event_access").select("id,admin_user_id,event_id,role,created_at").eq("event_id", eventId).order("created_at", { ascending: true }),
      ]);

      if (eventError) { throw eventError; }
      if (eventsError) { throw eventsError; }
      if (adminUsersError) { throw adminUsersError; }
      if (accessError) { throw accessError; }

      const eventRow = eventData as EventRow;
      const allEvents = (eventsData || []) as EventRow[];
      const adminUsers = (adminUsersData || []) as AdminUserRow[];
      const accessRows = (accessData || []) as AdminEventAccessRow[];
      const accessIds = accessRows.map((row) => row.id);

      let permissionRows: AdminEventPermissionRow[] = [];
      if (accessIds.length > 0) {
        const { data, error } = await supabase.from("admin_event_permissions").select("id,admin_event_access_id,permission_key,is_enabled").in("admin_event_access_id", accessIds);
        if (error) { throw error; }
        permissionRows = (data || []) as AdminEventPermissionRow[];
      }

      const permissionsByAccessId = new Map<string, string[]>();
      permissionRows.forEach((row) => {
        if (!row.is_enabled) { return; }
        const existing = permissionsByAccessId.get(row.admin_event_access_id) || [];
        existing.push(row.permission_key);
        permissionsByAccessId.set(row.admin_event_access_id, existing);
      });

      const explicitPermissionAccessIds = new Set(permissionRows.map((row) => row.admin_event_access_id));
      const adminById = new Map(adminUsers.map((row) => [row.id, row]));

      const mergedRows: StaffRow[] = accessRows.map((access) => {
        const adminUser = adminById.get(access.admin_user_id);
        const role = (access.role || "read_only") as EventAccessRole;
        const explicitKeys = permissionsByAccessId.get(access.id) || [];
        return {
          accessId: access.id,
          adminUserId: access.admin_user_id,
          eventId: access.event_id,
          email: adminUser?.email || "Unknown admin",
          displayName: adminUser?.display_name || "",
          privilegeGroup: adminUser?.privilege_group || null,
          role,
          permissions: buildPermissionMap(role, explicitKeys, explicitPermissionAccessIds.has(access.id)),
        };
      });

      const assignedAdminIds = new Set(mergedRows.map((row) => row.adminUserId));
      const available = adminUsers.filter((a) => a.is_active && a.privilege_group !== "super_admin" && !assignedAdminIds.has(a.id));

      setEvent(eventRow);
      setEvents(allEvents);
      setSelectedEventId(eventRow.id);
      setRows(mergedRows);
      setAvailableAdmins(available);
      setStatus(`Loaded ${mergedRows.length} staff assignments.`);
    } catch (err: any) {
      console.error("loadPage error:", err);
      setError(err?.message || "Failed to load event staff.");
      setStatus(err?.message || "Failed to load event staff.");
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

  async function createPermissionRows(adminEventAccessId: string, role: EventAccessRole) {
    const defaults = buildPermissionMap(role);
    const permissionRows = ALL_PERMISSION_KEYS.map((key) => ({ admin_event_access_id: adminEventAccessId, permission_key: key, is_enabled: !!defaults[key] }));
    const { error } = await supabase.from("admin_event_permissions").insert(permissionRows);
    if (error) { throw error; }
  }

  async function handleAddStaff() {
    if (!event?.id) { setStatus("No working event selected."); return; }
    if (!newAdminUserId) { setStatus("Choose an admin user to add."); return; }
    try {
      setAdding(true);
      setError(null);
      setStatus("Adding event staff...");
      const { data: insertedAccess, error: accessError } = await supabase.from("admin_event_access").insert({ admin_user_id: newAdminUserId, event_id: event.id, role: newRole }).select("id").single();
      if (accessError || !insertedAccess?.id) { throw accessError || new Error("Could not create event access."); }
      await createPermissionRows(insertedAccess.id, newRole);
      setNewAdminUserId(""); setNewRole("read_only");
      await loadPage(event.id);
      setStatus("Event staff added.");
    } catch (err: any) {
      console.error("handleAddStaff error:", err);
      setError(err?.message || "Could not add event staff.");
      setStatus(err?.message || "Could not add event staff.");
    } finally {
      setAdding(false);
    }
  }

  function updateLocalRole(accessId: string, role: EventAccessRole) {
    setRows((prev) => prev.map((row) => row.accessId === accessId ? { ...row, role, permissions: buildPermissionMap(role) } : row));
  }

  function updateLocalPermission(accessId: string, permissionKey: PermissionKey, isEnabled: boolean) {
    setRows((prev) => prev.map((row) => row.accessId === accessId ? { ...row, permissions: { ...row.permissions, [permissionKey]: isEnabled } } : row));
  }

  async function handleSaveRow(row: StaffRow) {
    if (!event?.id) { return; }
    try {
      setSavingAccessId(row.accessId);
      setError(null);
      setStatus(`Saving ${row.displayName || row.email}...`);
      const { error: roleError } = await supabase.from("admin_event_access").update({ role: row.role }).eq("id", row.accessId);
      if (roleError) { throw roleError; }
      const { error: deleteError } = await supabase.from("admin_event_permissions").delete().eq("admin_event_access_id", row.accessId);
      if (deleteError) { throw deleteError; }
      const permissionRows = ALL_PERMISSION_KEYS.map((key) => ({ admin_event_access_id: row.accessId, permission_key: key, is_enabled: !!row.permissions[key] }));
      const { error: insertError } = await supabase.from("admin_event_permissions").insert(permissionRows);
      if (insertError) { throw insertError; }
      await loadPage(event.id);
      setStatus(`${row.displayName || row.email} saved.`);
    } catch (err: any) {
      console.error("handleSaveRow error:", err);
      setError(err?.message || "Could not save event staff row.");
      setStatus(err?.message || "Could not save event staff row.");
    } finally {
      setSavingAccessId(null);
    }
  }

  async function handleRemoveRow(row: StaffRow) {
    if (!event?.id) { return; }
    const confirmed = window.confirm(`Remove ${row.displayName || row.email} from this event staff list?`);
    if (!confirmed) { return; }
    try {
      setRemovingAccessId(row.accessId);
      setError(null);
      setStatus(`Removing ${row.displayName || row.email}...`);
      const { error: deletePermissionsError } = await supabase.from("admin_event_permissions").delete().eq("admin_event_access_id", row.accessId);
      if (deletePermissionsError) { throw deletePermissionsError; }
      const { error: deleteAccessError } = await supabase.from("admin_event_access").delete().eq("id", row.accessId);
      if (deleteAccessError) { throw deleteAccessError; }
      await loadPage(event.id);
      setStatus(`${row.displayName || row.email} removed from event staff.`);
    } catch (err: any) {
      console.error("handleRemoveRow error:", err);
      setError(err?.message || "Could not remove event staff.");
      setStatus(err?.message || "Could not remove event staff.");
    } finally {
      setRemovingAccessId(null);
    }
  }

  const dateRange = formatDateRange(event?.start_date, event?.end_date);

  return (
    <div style={{ padding: 24, display: "grid", gap: 16 }}>
      <div style={cardStyle}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Event Staff</h1>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Working event: {event?.name || "No working event selected"}</div>
        <div style={{ maxWidth: 420 }}>
          <label style={labelStyle}>Select Event</label>
          <select value={selectedEventId} onChange={(e) => void handleEventChange(e.target.value)} style={inputStyle} disabled={loading || events.length === 0}>
            <option value="">Select event</option>
            {events.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name || "Untitled Event"}{item.start_date ? ` • ${item.start_date}` : ""}{item.location ? ` • ${item.location}` : ""}
              </option>
            ))}
          </select>
        </div>
        {event?.location ? <div style={{ color: "#555", marginTop: 4 }}>{event.location}</div> : null}
        {dateRange ? <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>{dateRange}</div> : null}
        <div style={{ marginTop: 10, fontSize: 13, color: "#666" }}>{status}</div>
      </div>

      {error ? <div style={errorBoxStyle}>{error}</div> : null}

      <div style={cardStyle}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Selected Event Staff List</h2>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>Choose an event above to view its assigned staff. Super Admins are not listed here because they automatically have access to all events.</div>
        {!event ? (
          <div style={{ opacity: 0.8 }}>Select an event to view staff.</div>
        ) : rows.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No staff assigned to {event.name || "this event"}.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {rows.map((person) => (
              <div key={person.accessId} style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, background: "#fafafa" }}>
                <div style={{ fontWeight: 700 }}>{person.displayName || person.email}</div>
                <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>{person.email}</div>
                <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>Event Role: {formatPrivilegeGroup(person.role)} • Base Group: {formatPrivilegeGroup(person.privilegeGroup)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Add Existing Admin</h2>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", alignItems: "end" }}>
          <div>
            <label style={labelStyle}>Admin User</label>
            <select value={newAdminUserId} onChange={(e) => setNewAdminUserId(e.target.value)} style={inputStyle} disabled={adding}>
              <option value="">Select admin user</option>
              {availableAdmins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.display_name || a.email}{a.display_name ? ` • ${a.email}` : ""}{a.privilege_group ? ` • ${formatPrivilegeGroup(a.privilege_group)}` : ""}
                </option>
              ))}
            </select>
            {availableAdmins.length === 0 ? <div style={{ marginTop: 8, fontSize: 13, color: "#666" }}>No available existing admin users to add for this event.</div> : null}
          </div>
          <div>
            <label style={labelStyle}>Event Role</label>
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as EventAccessRole)} style={inputStyle} disabled={adding}>
              {EVENT_ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
          </div>
          <button type="button" onClick={() => void handleAddStaff()} disabled={adding || !newAdminUserId || !event?.id} style={primaryButtonStyle}>
            {adding ? "Adding..." : "Add Staff"}
          </button>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>Assigned Event Staff</h2>
          <div style={{ fontSize: 13, color: "#666" }}>{rows.length} assignment{rows.length === 1 ? "" : "s"} for this event.</div>
        </div>
        {loading ? (
          <div>Loading...</div>
        ) : rows.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No event staff assigned yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {rows.map((row) => (
              <div key={row.accessId} style={staffCardStyle}>
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", alignItems: "end", width: "100%" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{row.displayName || row.email}</div>
                    <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>{row.email}</div>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Base group: {formatPrivilegeGroup(row.privilegeGroup)}</div>
                  </div>
                  <div>
                    <label style={labelStyle}>Event Role</label>
                    <select value={row.role} onChange={(e) => updateLocalRole(row.accessId, e.target.value as EventAccessRole)} style={inputStyle} disabled={savingAccessId === row.accessId}>
                      {EVENT_ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
                    <button type="button" onClick={() => void handleSaveRow(row)} disabled={savingAccessId === row.accessId} style={primaryButtonStyle}>
                      {savingAccessId === row.accessId ? "Saving..." : "Save"}
                    </button>
                    <button type="button" onClick={() => void handleRemoveRow(row)} disabled={removingAccessId === row.accessId} style={secondaryButtonStyle}>
                      {removingAccessId === row.accessId ? "Removing..." : "Remove"}
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Event Permissions</div>
                  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                    {ALL_PERMISSION_KEYS.map((key) => (
                      <label key={key} style={permissionLabelStyle}>
                        <input type="checkbox" checked={!!row.permissions[key]} onChange={(e) => updateLocalPermission(row.accessId, key, e.target.checked)} />
                        <span>{PERMISSION_LABELS[key]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = { border: "1px solid #ddd", borderRadius: 10, background: "white", padding: 18 };
const staffCardStyle: CSSProperties = { border: "1px solid #ddd", borderRadius: 10, background: "#fafafa", padding: 14 };
const labelStyle: CSSProperties = { display: "block", marginBottom: 6, fontWeight: 600 };
const inputStyle: CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", background: "white" };
const primaryButtonStyle: CSSProperties = { padding: "10px 14px", borderRadius: 10, border: "none", background: "#111827", color: "white", fontWeight: 700, cursor: "pointer" };
const secondaryButtonStyle: CSSProperties = { padding: "10px 14px", borderRadius: 10, border: "1px solid #ccc", background: "white", fontWeight: 700, cursor: "pointer" };
const errorBoxStyle: CSSProperties = { border: "1px solid #e2b4b4", borderRadius: 10, background: "#fff3f3", color: "#8a1f1f", padding: 12 };
const permissionLabelStyle: CSSProperties = { display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", border: "1px solid #eee", borderRadius: 10, background: "white", width: "100%", minWidth: 0, overflowWrap: "anywhere" };

export default function EventStaffPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_event_staff">
      <EventStaffPageInner />
    </AdminRouteGuard>
  );
}
