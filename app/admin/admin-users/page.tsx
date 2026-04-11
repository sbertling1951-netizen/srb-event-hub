"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import {
  getCurrentAdminAccess,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";
import {
  type AdminPermissions,
  type PrivilegeGroup,
  PERMISSION_LABELS,
  getPresetPermissions,
} from "@/lib/adminPermissions";

type AdminUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  privilege_group: PrivilegeGroup;
  user_id: string | null;
};

type AdminPermissionRow = AdminPermissions & {
  admin_user_id: string;
};

type AdminUserWithPermissions = AdminUserRow & {
  permissions: AdminPermissions;
};

type EventRow = {
  id: string;
  name: string | null;
  start_date?: string | null;
  location?: string | null;
};
function getEventAccessRole(privilegeGroup: PrivilegeGroup) {
  switch (privilegeGroup) {
    case "super_admin":
      return "event_admin";
    case "event_admin":
      return "event_admin";
    case "content_admin":
      return "content_admin";
    case "checkin":
      return "event_admin";
    case "parking":
      return "event_admin";
    case "read_only":
      return "content_admin";
    default:
      return "event_admin";
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
      return value.replace(/_/g, " ");
  }
}
const defaultGroup: PrivilegeGroup = "event_admin";

export default function AdminUsersPage() {
  const [rows, setRows] = useState<AdminUserWithPermissions[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading admin users...");
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const [selectedAdminId, setSelectedAdminId] = useState<string>("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [privilegeGroup, setPrivilegeGroup] =
    useState<PrivilegeGroup>(defaultGroup);
  const [permissions, setPermissions] = useState<AdminPermissions>(
    getPresetPermissions(defaultGroup),
  );
  const [assignedEventIds, setAssignedEventIds] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState("");

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      setStatus("Checking admin access...");
      setAccessDenied(false);

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setError("No admin access.");
        setStatus("Access denied.");
        setLoading(false);
        setAccessDenied(true);
        return;
      }

      if (!hasPermission(admin, "can_manage_admins")) {
        setError("You do not have permission to manage admin users.");
        setStatus("Access denied.");
        setLoading(false);
        setAccessDenied(true);
        return;
      }

      await loadPageData();
    }

    void init();
  }, []);

  async function loadPageData() {
    setLoading(true);
    setError(null);
    setStatus("Loading admin users...");

    const [
      { data: adminUsers, error: adminError },
      { data: permissionRows, error: permissionError },
      { data: eventRows, error: eventError },
    ] = await Promise.all([
      supabase
        .from("admin_users")
        .select("id, email, display_name, is_active, privilege_group, user_id")
        .order("email", { ascending: true }),

      supabase.from("admin_permissions").select("*"),

      supabase
        .from("events")
        .select("id, name, start_date, location")
        .order("start_date", { ascending: false }),
    ]);

    if (adminError) {
      setError(adminError.message);
      setStatus("Could not load admin users.");
      setLoading(false);
      return;
    }

    if (permissionError) {
      setError(permissionError.message);
      setStatus("Could not load admin permissions.");
      setLoading(false);
      return;
    }

    if (eventError) {
      setError(eventError.message);
      setStatus("Could not load events.");
      setLoading(false);
      return;
    }

    const permissionMap = new Map<string, AdminPermissionRow>();
    for (const row of (permissionRows || []) as AdminPermissionRow[]) {
      permissionMap.set(row.admin_user_id, row);
    }

    const merged = ((adminUsers || []) as AdminUserRow[]).map((admin) => {
      const permissionRow = permissionMap.get(admin.id);

      return {
        ...admin,
        permissions: permissionRow
          ? {
              can_manage_admins: !!permissionRow.can_manage_admins,
              can_manage_event_admins: !!permissionRow.can_manage_event_admins,
              can_manage_events: !!permissionRow.can_manage_events,
              can_import_attendees: !!permissionRow.can_import_attendees,
              can_edit_attendees: !!permissionRow.can_edit_attendees,
              can_mark_arrived: !!permissionRow.can_mark_arrived,
              can_assign_parking: !!permissionRow.can_assign_parking,
              can_manage_agenda: !!permissionRow.can_manage_agenda,
              can_manage_announcements:
                !!permissionRow.can_manage_announcements,
              can_manage_nearby: !!permissionRow.can_manage_nearby,
              can_view_reports: !!permissionRow.can_view_reports,
              can_export_reports: !!permissionRow.can_export_reports,
              can_manage_master_maps: !!permissionRow.can_manage_master_maps,
              can_manage_master_nearby:
                !!permissionRow.can_manage_master_nearby,
              can_manage_settings: !!permissionRow.can_manage_settings,
            }
          : getPresetPermissions(admin.privilege_group || defaultGroup),
      };
    });

    setRows(merged);
    setEvents((eventRows || []) as EventRow[]);
    setStatus("");
    setLoading(false);
  }

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedAdminId) || null,
    [rows, selectedAdminId],
  );

  useEffect(() => {
    if (!selectedRow) return;

    setEmail(selectedRow.email || "");
    setDisplayName(selectedRow.display_name || "");
    setIsActive(selectedRow.is_active);
    setPrivilegeGroup(selectedRow.privilege_group || defaultGroup);
    setPermissions(selectedRow.permissions);
    setSaveStatus("");

    void loadAssignedEvents(selectedRow.id);
  }, [selectedRow]);

  async function loadAssignedEvents(adminUserId: string) {
    const { data, error } = await supabase
      .from("admin_event_access")
      .select("event_id")
      .eq("admin_user_id", adminUserId);

    if (error) {
      setAssignedEventIds([]);
      return;
    }

    setAssignedEventIds((data || []).map((row) => row.event_id));
  }

  function startNewAdmin() {
    setSelectedAdminId("");
    setEmail("");
    setDisplayName("");
    setIsActive(true);
    setPrivilegeGroup(defaultGroup);
    setPermissions(getPresetPermissions(defaultGroup));
    setAssignedEventIds([]);
    setSaveStatus("");
  }

  function handlePrivilegeGroupChange(nextGroup: PrivilegeGroup) {
    setPrivilegeGroup(nextGroup);
    setPermissions(getPresetPermissions(nextGroup));

    if (nextGroup === "super_admin") {
      setAssignedEventIds([]);
    }
  }

  function handlePermissionToggle(permission: keyof AdminPermissions) {
    setPermissions((prev) => ({
      ...prev,
      [permission]: !prev[permission],
    }));
  }

  function toggleAssignedEvent(eventId: string) {
    setAssignedEventIds((prev) =>
      prev.includes(eventId)
        ? prev.filter((id) => id !== eventId)
        : [...prev, eventId],
    );
  }

  async function handleSave() {
    setSaveStatus("Saving...");

    if (!email.trim()) {
      setSaveStatus("Email is required.");
      return;
    }

    let adminUserId = selectedAdminId;

    if (selectedAdminId) {
      const { error: updateError } = await supabase
        .from("admin_users")
        .update({
          email: email.trim(),
          display_name: displayName.trim() || null,
          is_active: isActive,
          privilege_group: privilegeGroup,
        })
        .eq("id", selectedAdminId);

      if (updateError) {
        setSaveStatus(`Could not update admin user: ${updateError.message}`);
        return;
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("admin_users")
        .insert({
          email: email.trim(),
          display_name: displayName.trim() || null,
          is_active: isActive,
          privilege_group: privilegeGroup,
          is_super_admin: false,
        })
        .select("id")
        .single();

      if (insertError || !inserted?.id) {
        setSaveStatus(
          `Could not create admin user: ${insertError?.message || "Unknown error"}`,
        );
        return;
      }

      adminUserId = inserted.id;
      setSelectedAdminId(inserted.id);
    }

    const { error: permissionError } = await supabase
      .from("admin_permissions")
      .upsert({
        admin_user_id: adminUserId,
        ...permissions,
      });

    if (permissionError) {
      setSaveStatus(
        `Saved admin user, but permissions failed: ${permissionError.message}`,
      );
      return;
    }

    if (privilegeGroup === "super_admin") {
      const { error: clearError } = await supabase
        .from("admin_event_access")
        .delete()
        .eq("admin_user_id", adminUserId);

      if (clearError) {
        setSaveStatus(
          `Saved admin user, but could not clear event access: ${clearError.message}`,
        );
        return;
      }
    } else {
      const { error: deleteAccessError } = await supabase
        .from("admin_event_access")
        .delete()
        .eq("admin_user_id", adminUserId);

      if (deleteAccessError) {
        setSaveStatus(
          `Saved admin user, but could not reset event access: ${deleteAccessError.message}`,
        );
        return;
      }

      if (assignedEventIds.length > 0) {
        const { error: insertAccessError } = await supabase
          .from("admin_event_access")
          .insert(
            assignedEventIds.map((eventId) => ({
              admin_user_id: adminUserId,
              event_id: eventId,
              role: getEventAccessRole(privilegeGroup),
            })),
          );

        if (insertAccessError) {
          setSaveStatus(
            `Saved admin user, but event access failed: ${insertAccessError.message}`,
          );
          return;
        }
      }
    }

    setSaveStatus("Saved.");
    await loadPageData();
    if (adminUserId) {
      await loadAssignedEvents(adminUserId);
    }
  }

  if (!loading && accessDenied) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Admin Users</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          You do not have access to this page.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Admin Users</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          Default privilege groups with independent permission switches and
          event access.
        </div>
      </div>

      {status ? (
        <div className="card" style={{ padding: 18 }}>
          {status}
        </div>
      ) : null}

      {error && !accessDenied ? <div style={errorBoxStyle}>{error}</div> : null}

      <div
        style={{
          display: "grid",
          gap: 18,
          gridTemplateColumns: "minmax(280px, 340px) 1fr",
        }}
      >
        <div className="card" style={{ padding: 18 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <strong>Existing Admins</strong>
            <button
              type="button"
              onClick={startNewAdmin}
              style={secondaryButtonStyle}
            >
              New
            </button>
          </div>

          {loading ? (
            <div>Loading...</div>
          ) : rows.length === 0 ? (
            <div style={{ opacity: 0.8 }}>No admin users found.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedAdminId(row.id)}
                  style={{
                    ...listButtonStyle,
                    borderColor:
                      selectedAdminId === row.id ? "#111827" : "#ddd",
                    background:
                      selectedAdminId === row.id ? "#f8fafc" : "white",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {row.display_name || row.email}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>{row.email}</div>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    {formatPrivilegeGroup(row.privilege_group)} •{" "}
                    {row.is_active ? "active" : "inactive"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "grid", gap: 14 }}>
            <div
              style={{
                display: "grid",
                gap: 14,
                gridTemplateColumns: "1fr 1fr",
              }}
            >
              <div>
                <label style={labelStyle}>Email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Display Name</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gap: 14,
                gridTemplateColumns: "1fr 1fr",
              }}
            >
              <div>
                <label style={labelStyle}>Privilege Group</label>
                <select
                  value={privilegeGroup}
                  onChange={(e) =>
                    handlePrivilegeGroupChange(e.target.value as PrivilegeGroup)
                  }
                  style={inputStyle}
                >
                  <option value="super_admin">Super Admin</option>
                  <option value="event_admin">Event Admin</option>
                  <option value="checkin">Check-In</option>
                  <option value="parking">Parking</option>
                  <option value="content_admin">Content Admin</option>
                  <option value="read_only">Read Only</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Status</label>
                <label style={checkLabelStyle}>
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  <span>Active admin user</span>
                </label>
              </div>
            </div>

            <div>
              <strong>Permissions</strong>
              <div
                style={{
                  fontSize: 13,
                  opacity: 0.75,
                  marginTop: 4,
                  marginBottom: 12,
                }}
              >
                Changing the privilege group resets the permissions to that
                preset.
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 10,
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                }}
              >
                {(
                  Object.keys(PERMISSION_LABELS) as Array<
                    keyof AdminPermissions
                  >
                ).map((key) => (
                  <label key={key} style={permissionLabelStyle}>
                    <input
                      type="checkbox"
                      checked={!!permissions[key]}
                      onChange={() => handlePermissionToggle(key)}
                    />
                    <span>{PERMISSION_LABELS[key]}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <strong>Event Access</strong>
              <div
                style={{
                  fontSize: 13,
                  opacity: 0.75,
                  marginTop: 4,
                  marginBottom: 12,
                }}
              >
                Super Admin automatically has access to all events. For other
                admins, select allowed events.
              </div>

              {privilegeGroup === "super_admin" ? (
                <div style={{ opacity: 0.8 }}>
                  Super Admin automatically has access to all events.
                </div>
              ) : events.length === 0 ? (
                <div style={{ opacity: 0.8 }}>No events found.</div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  }}
                >
                  {events.map((event) => (
                    <label key={event.id} style={permissionLabelStyle}>
                      <input
                        type="checkbox"
                        checked={assignedEventIds.includes(event.id)}
                        onChange={() => toggleAssignedEvent(event.id)}
                      />
                      <span>
                        {event.name || "Untitled Event"}
                        {event.location ? ` • ${event.location}` : ""}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={handleSave}
                style={primaryButtonStyle}
              >
                Save Admin User
              </button>
              {saveStatus ? (
                <span style={{ fontSize: 14 }}>{saveStatus}</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
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
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e2b4b4",
  background: "#fff3f3",
  color: "#8a1f1f",
};

const listButtonStyle: CSSProperties = {
  textAlign: "left",
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "white",
  cursor: "pointer",
};

const checkLabelStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  minHeight: 42,
};

const permissionLabelStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  padding: "8px 10px",
  border: "1px solid #eee",
  borderRadius: 10,
};
