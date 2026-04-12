"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import {
  getCurrentAdminAccess,
  canAccessEvent,
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

type AdminUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  privilege_group: string | null;
};

type AdminEventAccessRow = {
  id: string;
  event_id: string;
  admin_user_id: string;
  role: string | null;
  created_at?: string | null;
};

type AdminEventPermissionRow = {
  id: string;
  admin_event_access_id: string;
  permission_key: string;
  is_enabled: boolean;
};

type StaffDisplayRow = AdminEventAccessRow & {
  display_name: string;
  email: string;
  privilege_group: string;
  permissions: string[];
};

const PERMISSION_OPTIONS = [
  { key: "can_manage_checkin", label: "Check-In" },
  { key: "can_manage_parking", label: "Parking" },
  { key: "can_manage_agenda", label: "Agenda" },
  { key: "can_manage_announcements", label: "Announcements" },
  { key: "can_manage_nearby", label: "Nearby" },
  { key: "can_manage_locations", label: "Locations" },
  { key: "can_manage_reports", label: "Reports" },
  { key: "can_manage_imports", label: "Imports" },
  { key: "can_manage_event_staff", label: "Event Staff" },
  { key: "can_view_admin_dashboard", label: "Admin Dashboard" },
] as const;

type PermissionKey = (typeof PERMISSION_OPTIONS)[number]["key"];

const ROLE_PRESETS: Record<string, PermissionKey[]> = {
  event_admin: [
    "can_view_admin_dashboard",
    "can_manage_checkin",
    "can_manage_parking",
    "can_manage_agenda",
    "can_manage_announcements",
    "can_manage_nearby",
    "can_manage_locations",
    "can_manage_reports",
    "can_manage_imports",
    "can_manage_event_staff",
  ],
  checkin: ["can_view_admin_dashboard", "can_manage_checkin"],
  parking: ["can_view_admin_dashboard", "can_manage_parking"],
  content_admin: [
    "can_view_admin_dashboard",
    "can_manage_agenda",
    "can_manage_announcements",
    "can_manage_nearby",
    "can_manage_locations",
  ],
  read_only: ["can_view_admin_dashboard"],
};

type StaffForm = {
  id: string;
  admin_user_id: string;
  role: string;
};

const EMPTY_FORM: StaffForm = {
  id: "",
  admin_user_id: "",
  role: "event_admin",
};

const EMPTY_PERMISSION_STATE: Record<string, boolean> = Object.fromEntries(
  PERMISSION_OPTIONS.map((item) => [item.key, false]),
);

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

function formatPrivilegeGroup(value?: string | null) {
  if (!value) return "";
  switch (value) {
    case "super_admin":
      return "Super Admin";
    case "event_admin":
      return "Event Admin";
    case "checkin":
      return "Check-In";
    case "parking":
      return "Parking";
    case "content_admin":
      return "Content Admin";
    case "read_only":
      return "Read Only";
    default:
      return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function formatRole(value?: string | null) {
  if (!value) return "Event Admin";
  switch (value) {
    case "super_admin":
      return "Super Admin";
    case "event_admin":
      return "Event Admin";
    case "checkin":
      return "Check-In";
    case "parking":
      return "Parking";
    case "content_admin":
      return "Content Admin";
    case "read_only":
      return "Read Only";
    default:
      return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export default function EventStaffPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_event_staff">
      <EventStaffPageInner />
    </AdminRouteGuard>
  );
}

function EventStaffPageInner() {
  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([]);
  const [staffRows, setStaffRows] = useState<AdminEventAccessRow[]>([]);
  const [permissionRows, setPermissionRows] = useState<
    AdminEventPermissionRow[]
  >([]);
  const [form, setForm] = useState<StaffForm>(EMPTY_FORM);
  const [permissionState, setPermissionState] = useState<
    Record<string, boolean>
  >(EMPTY_PERMISSION_STATE);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [status, setStatus] = useState("Loading event staff...");
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      setAccessDenied(false);
      setStatus("Checking admin access...");

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setCurrentEvent(null);
        setAdminUsers([]);
        setStaffRows([]);
        setPermissionRows([]);
        setError("No admin access.");
        setStatus("Access denied.");
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      const event = getStoredAdminEvent();

      if (!event?.id) {
        setCurrentEvent(null);
        setAdminUsers([]);
        setStaffRows([]);
        setPermissionRows([]);
        setStatus("No admin working event selected.");
        setLoading(false);
        return;
      }

      if (!canAccessEvent(admin, event.id)) {
        setCurrentEvent(null);
        setAdminUsers([]);
        setStaffRows([]);
        setPermissionRows([]);
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      setCurrentEvent(event);
      await loadPageData(event.id, { preserveStatus: false });
      setLoading(false);
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

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  async function loadPageData(
    eventId: string,
    options?: { preserveStatus?: boolean },
  ) {
    const preserveStatus = options?.preserveStatus ?? true;

    setRefreshing(true);
    setError(null);
    if (!preserveStatus) {
      setStatus("Loading event staff...");
    }

    const [
      { data: adminUserData, error: adminUserError },
      { data: accessData, error: accessError },
    ] = await Promise.all([
      supabase
        .from("admin_users")
        .select("id, email, display_name, is_active, privilege_group")
        .eq("is_active", true)
        .order("display_name", { ascending: true, nullsFirst: false })
        .order("email", { ascending: true }),

      supabase
        .from("admin_event_access")
        .select("id, event_id, admin_user_id, role, created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true }),
    ]);

    if (adminUserError) {
      setError(adminUserError.message);
      setStatus("Could not load admin users.");
      setRefreshing(false);
      return;
    }

    if (accessError) {
      setError(accessError.message);
      setStatus("Could not load event staff.");
      setRefreshing(false);
      return;
    }

    const accessRows = (accessData || []) as AdminEventAccessRow[];
    setAdminUsers((adminUserData || []) as AdminUserRow[]);
    setStaffRows(accessRows);

    if (accessRows.length > 0) {
      const accessIds = accessRows.map((row) => row.id);

      const { data: permissionData, error: permissionError } = await supabase
        .from("admin_event_permissions")
        .select("id, admin_event_access_id, permission_key, is_enabled")
        .in("admin_event_access_id", accessIds);

      if (permissionError) {
        setError(permissionError.message);
        setStatus("Could not load event staff permissions.");
        setRefreshing(false);
        return;
      }

      setPermissionRows((permissionData || []) as AdminEventPermissionRow[]);
    } else {
      setPermissionRows([]);
    }

    if (!preserveStatus) {
      setStatus("");
    }

    setRefreshing(false);
  }

  const adminUserById = useMemo(() => {
    const map = new Map<string, AdminUserRow>();
    for (const row of adminUsers) {
      map.set(row.id, row);
    }
    return map;
  }, [adminUsers]);

  const selectableAdminUsers = useMemo(() => {
    const assignedIds = new Set(
      staffRows
        .filter((row) => row.id !== form.id)
        .map((row) => row.admin_user_id),
    );

    const currentEditingUser =
      form.id && form.admin_user_id
        ? adminUsers.find((u) => u.id === form.admin_user_id)
        : null;

    const available = adminUsers.filter((user) => !assignedIds.has(user.id));
    const merged = currentEditingUser
      ? [...available, currentEditingUser]
      : available;

    return merged.filter(
      (user, index, arr) => arr.findIndex((u) => u.id === user.id) === index,
    );
  }, [adminUsers, staffRows, form.id, form.admin_user_id]);

  const permissionsByAccessId = useMemo(() => {
    const map = new Map<string, string[]>();

    for (const row of permissionRows) {
      if (!row.is_enabled) continue;
      const existing = map.get(row.admin_event_access_id) || [];
      existing.push(row.permission_key);
      map.set(row.admin_event_access_id, existing);
    }

    return map;
  }, [permissionRows]);

  const staffDisplayRows = useMemo<StaffDisplayRow[]>(() => {
    return staffRows.map((row) => {
      const user = adminUserById.get(row.admin_user_id) || null;

      return {
        ...row,
        display_name: user?.display_name || "",
        email: user?.email || "",
        privilege_group: user?.privilege_group || "",
        permissions: permissionsByAccessId.get(row.id) || [],
      };
    });
  }, [staffRows, adminUserById, permissionsByAccessId]);

  const noEventSelected = !currentEvent?.id;

  function resetForm() {
    setForm(EMPTY_FORM);
    setPermissionState(EMPTY_PERMISSION_STATE);
    setError(null);
  }

  function applyRolePreset(role: string) {
    const preset = ROLE_PRESETS[role] || [];
    const nextState: Record<string, boolean> = { ...EMPTY_PERMISSION_STATE };

    for (const key of preset) {
      nextState[key] = true;
    }

    setPermissionState(nextState);
  }

  function togglePermission(permissionKey: string) {
    setPermissionState((prev) => ({
      ...prev,
      [permissionKey]: !prev[permissionKey],
    }));
  }

  function startEdit(row: AdminEventAccessRow) {
    const permissionKeys = permissionsByAccessId.get(row.id) || [];
    const nextState: Record<string, boolean> = { ...EMPTY_PERMISSION_STATE };

    for (const key of permissionKeys) {
      nextState[key] = true;
    }

    setForm({
      id: row.id,
      admin_user_id: row.admin_user_id,
      role: row.role || "event_admin",
    });
    setPermissionState(nextState);
    setError(null);
    setStatus(
      `Editing ${adminUserById.get(row.admin_user_id)?.display_name || adminUserById.get(row.admin_user_id)?.email || "staff assignment"}...`,
    );
  }

  async function savePermissionsForAccess(accessId: string) {
    const enabledKeys = Object.entries(permissionState)
      .filter(([, value]) => value)
      .map(([key]) => key);

    const { error: deleteError } = await supabase
      .from("admin_event_permissions")
      .delete()
      .eq("admin_event_access_id", accessId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    if (enabledKeys.length === 0) {
      return;
    }

    const rowsToInsert = enabledKeys.map((key) => ({
      admin_event_access_id: accessId,
      permission_key: key,
      is_enabled: true,
    }));

    const { error: insertError } = await supabase
      .from("admin_event_permissions")
      .insert(rowsToInsert);

    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  async function handleSave() {
    if (!currentEvent?.id) {
      setError("No event selected.");
      return;
    }

    if (!form.admin_user_id) {
      setError("Select an admin user.");
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(form.id ? "Updating event staff..." : "Adding event staff...");

    const payload = {
      event_id: currentEvent.id,
      admin_user_id: form.admin_user_id,
      role: form.role.trim() || "event_admin",
    };

    try {
      let accessId = form.id;

      if (form.id) {
        const { error } = await supabase
          .from("admin_event_access")
          .update(payload)
          .eq("id", form.id);

        if (error) {
          if (error.code === "23505") {
            setError("That admin user is already assigned to this event.");
          } else {
            setError(error.message);
          }
          setStatus("Update failed.");
          setSaving(false);
          return;
        }
      } else {
        const { data, error } = await supabase
          .from("admin_event_access")
          .insert(payload)
          .select("id")
          .single();

        if (error) {
          if (error.code === "23505") {
            setError("That admin user is already assigned to this event.");
          } else {
            setError(error.message);
          }
          setStatus("Create failed.");
          setSaving(false);
          return;
        }

        accessId = data.id;
      }

      await savePermissionsForAccess(accessId);
      await loadPageData(currentEvent.id, { preserveStatus: true });
      resetForm();
      setStatus(form.id ? "Event staff updated." : "Event staff added.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save permissions.",
      );
      setStatus("Save failed.");
    }

    setSaving(false);
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm("Remove this staff assignment?");
    if (!confirmed) return;

    if (!currentEvent?.id) return;

    setError(null);
    setStatus("Removing event staff...");

    const { error } = await supabase
      .from("admin_event_access")
      .delete()
      .eq("id", id);

    if (error) {
      setError(error.message);
      setStatus("Delete failed.");
      return;
    }

    if (form.id === id) resetForm();
    await loadPageData(currentEvent.id, { preserveStatus: true });
    setStatus("Event staff removed.");
  }

  if (!loading && accessDenied) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Event Staff</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          You do not have access to this page.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Event Staff</h1>

        <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 12 }}>
          {currentEvent?.name || currentEvent?.eventName || "No event selected"}
          {currentEvent?.location ? ` • ${currentEvent.location}` : ""}
        </div>

        {status ? (
          <div style={{ marginBottom: 12, fontSize: 14 }}>{status}</div>
        ) : null}
        {error ? <div style={errorBoxStyle}>{error}</div> : null}

        {noEventSelected ? (
          <div style={infoBoxStyle}>
            Select a working event in Event Admin before assigning event staff.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label style={labelStyle}>Admin User</label>
              <select
                value={form.admin_user_id}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    admin_user_id: e.target.value,
                  }))
                }
                style={inputStyle}
                disabled={saving}
              >
                <option value="">Select admin user</option>
                {selectableAdminUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.display_name || user.email}
                    {user.display_name ? ` • ${user.email}` : ""}
                    {user.privilege_group
                      ? ` • ${formatPrivilegeGroup(user.privilege_group)}`
                      : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Primary Role</label>
              <select
                value={form.role}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, role: e.target.value }))
                }
                style={inputStyle}
                disabled={saving}
              >
                <option value="event_admin">Event Admin</option>
                <option value="checkin">Check-In</option>
                <option value="parking">Parking</option>
                <option value="content_admin">Content Admin</option>
                <option value="read_only">Read Only</option>
              </select>
              <div style={helperTextStyle}>
                Primary role sets the usual permission preset. You can still
                adjust individual permissions below.
              </div>
            </div>

            <div style={permissionsBoxStyle}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <div style={{ fontWeight: 700 }}>Permissions</div>
                <button
                  type="button"
                  onClick={() => applyRolePreset(form.role)}
                  disabled={saving}
                  style={secondaryButtonStyle}
                >
                  Apply Role Preset
                </button>
              </div>

              <div style={helperTextStyle}>
                Check the additional functions this person can perform for this
                event.
              </div>

              <div style={permissionGridStyle}>
                {PERMISSION_OPTIONS.map((item) => (
                  <label key={item.key} style={checkboxLabelStyle}>
                    <input
                      type="checkbox"
                      checked={!!permissionState[item.key]}
                      onChange={() => togglePermission(item.key)}
                      disabled={saving}
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={primaryButtonStyle}
              >
                {saving
                  ? "Saving..."
                  : form.id
                    ? "Update Event Staff"
                    : "Add Event Staff"}
              </button>

              <button
                type="button"
                onClick={resetForm}
                disabled={saving}
                style={secondaryButtonStyle}
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0 }}>Assigned Staff</h2>
          {refreshing && !loading ? (
            <div style={{ fontSize: 13, opacity: 0.7 }}>Refreshing...</div>
          ) : null}
        </div>

        {loading ? (
          <div>Loading...</div>
        ) : staffDisplayRows.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No event staff assigned yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {staffDisplayRows.map((row) => (
              <div
                key={row.id}
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
                    gap: 12,
                    flexWrap: "wrap",
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>
                      {row.display_name || row.email || "Unknown User"}
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
                      {row.email}
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>
                      Primary Role: {formatRole(row.role)}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {row.privilege_group ? (
                      <span style={pillStyle}>
                        {formatPrivilegeGroup(row.privilege_group)}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div
                    style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}
                  >
                    Enabled Permissions
                  </div>
                  {row.permissions.length === 0 ? (
                    <div style={{ fontSize: 13, opacity: 0.7 }}>
                      No additional permissions assigned.
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {row.permissions.map((key) => {
                        const option = PERMISSION_OPTIONS.find(
                          (item) => item.key === key,
                        );
                        return (
                          <span key={key} style={pillStyle}>
                            {option?.label || key}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

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
                    onClick={() => startEdit(row)}
                    style={secondaryButtonStyle}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(row.id)}
                    style={dangerButtonStyle}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: "block",
  fontWeight: 600,
  marginBottom: 6,
};

const helperTextStyle: CSSProperties = {
  fontSize: 12,
  opacity: 0.72,
  marginTop: 6,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "white",
};

const permissionsBoxStyle: CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 12,
  background: "#fafafa",
  padding: 14,
};

const permissionGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 10,
  marginTop: 12,
};

const checkboxLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 14,
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

const dangerButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d7b1b1",
  background: "#fff5f5",
  fontWeight: 700,
  cursor: "pointer",
};

const errorBoxStyle: CSSProperties = {
  marginBottom: 12,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e2b4b4",
  background: "#fff3f3",
  color: "#8a1f1f",
};

const infoBoxStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cfd8e3",
  background: "#f7fafc",
  color: "#334155",
};

const pillStyle: CSSProperties = {
  fontSize: 12,
  padding: "4px 8px",
  borderRadius: 999,
  border: "1px solid #ccc",
  background: "#fff",
};
