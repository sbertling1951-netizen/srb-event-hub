"use client";

import { useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { bumpAdminPermissionsVersion } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

type PermissionRow = {
  id: string;
  privilege_group: string;
  permission_key: string;
  is_enabled: boolean;
};

type AuditRow = {
  id: string;
  privilege_group: string;
  permission_key: string;
  old_value: boolean;
  new_value: boolean;
  action_id: string | null;
  changed_at: string;
};

const GROUPS = [
  "super_admin",
  "event_admin",
  "checkin",
  "parking",
  "content_admin",
  "read_only",
];

const ALL_PERMISSIONS = [
  "can_manage_admins",
  "can_manage_event_admins",
  "can_view_admin_dashboard",
  "can_manage_events",
  "can_manage_attendees",
  "can_manage_checkin",
  "can_manage_parking",
  "can_manage_agenda",
  "can_manage_announcements",
  "can_manage_nearby",
  "can_manage_locations",
  "can_manage_reports",
  "can_manage_imports",
  "can_manage_event_staff",
  "can_manage_master_maps",
  "can_manage_vendors",
];

const PERMISSION_LABELS: Record<string, string> = {
  can_manage_admins: "Manage Admin Users",
  can_manage_event_admins: "Manage Event Admins",
  can_view_admin_dashboard: "View Dashboard",
  can_manage_events: "Manage Events",
  can_manage_attendees: "Manage Attendees",
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
  can_manage_vendors: "Manage Vendors",
};

const PERMISSION_GROUPS: Record<string, string[]> = {
  "Core Access": ["can_view_admin_dashboard", "can_manage_events"],
  "Attendee Ops": [
    "can_manage_attendees",
    "can_manage_checkin",
    "can_manage_parking",
  ],
  Content: [
    "can_manage_agenda",
    "can_manage_announcements",
    "can_manage_nearby",
    "can_manage_locations",
  ],
  Operations: [
    "can_manage_reports",
    "can_manage_imports",
    "can_manage_master_maps",
    "can_manage_vendors",
  ],
  "Admin Control": [
    "can_manage_admins",
    "can_manage_event_admins",
    "can_manage_event_staff",
  ],
};

export default function PermissionsPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_admins">
      <AdminShellAdapter pageTitle="Permissions">
        <PermissionsInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function PermissionsInner() {
  const [rows, setRows] = useState<PermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoing, setUndoing] = useState(false);
  const [presets, setPresets] = useState<Record<string, any>>({});

  useEffect(() => {
    load();
    loadPresets();
  }, []);

  async function load() {
    const { data, error } = await supabase
      .from("admin_privilege_group_permissions")
      .select("*");

    if (error) {
      console.error("Load error:", error);
    }

    setRows((data || []) as PermissionRow[]);
    setLoading(false);
  }

  async function loadPresets() {
    const { data } = await supabase
      .from("admin_permission_presets")
      .select("*");
    const map: Record<string, any> = {};
    (data || []).forEach((row: any) => {
      map[row.name] = row.config;
    });
    setPresets(map);
  }

  function isEnabled(group: string, key: string) {
    return rows.some(
      (r) =>
        r.privilege_group === group && r.permission_key === key && r.is_enabled,
    );
  }

  function getEnabledPermissionsForGroup(group: string) {
    return ALL_PERMISSIONS.filter((perm) => isEnabled(group, perm));
  }

  function isRequiredByAnother(group: string, key: string) {
    const REQUIRED_RELATIONS: Record<string, string[]> = {
      can_manage_checkin: ["can_manage_attendees"],
      can_manage_parking: ["can_manage_attendees"],
    };

    // Only block if a *child* is enabled that depends on this
    return Object.entries(REQUIRED_RELATIONS).some(([child, deps]) => {
      return deps.includes(key) && isEnabled(group, child);
    });
  }

  async function toggle(group: string, key: string) {
    try {
      const actionId = crypto.randomUUID();
      const existing = rows.find(
        (r) => r.privilege_group === group && r.permission_key === key,
      );
      const oldValue = existing ? existing.is_enabled : false;

      let nextEnabled = true;

      if (existing) {
        nextEnabled = !existing.is_enabled;

        const { error } = await supabase
          .from("admin_privilege_group_permissions")
          .update({ is_enabled: nextEnabled })
          .eq("id", existing.id);

        if (error) {
          throw error;
        }
      } else {
        const { error } = await supabase
          .from("admin_privilege_group_permissions")
          .insert({
            privilege_group: group,
            permission_key: key,
            is_enabled: true,
          });

        if (error) {
          throw error;
        }
      }

      // 🔥 audit log
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        await supabase.from("admin_permission_audit").insert({
          admin_user_id: user?.id || null,
          admin_email: user?.email || "unknown",
          privilege_group: group,
          permission_key: key,
          old_value: oldValue,
          new_value: nextEnabled,
          action_id: actionId,
        });
      } catch (auditErr) {
        console.error("Audit log failed:", auditErr);
      }

      // 🔥 enforce simple dependency rules
      const REQUIRED_RELATIONS: Record<string, string[]> = {
        can_manage_checkin: ["can_manage_attendees"],
        can_manage_parking: ["can_manage_attendees"],
      };

      if (nextEnabled && REQUIRED_RELATIONS[key]) {
        for (const dep of REQUIRED_RELATIONS[key]) {
          const wasEnabled = isEnabled(group, dep);

          await supabase.from("admin_privilege_group_permissions").upsert(
            {
              privilege_group: group,
              permission_key: dep,
              is_enabled: true,
            },
            { onConflict: "privilege_group,permission_key" },
          );

          // 🔥 audit dependency auto-enable
          if (!wasEnabled) {
            try {
              const {
                data: { user },
              } = await supabase.auth.getUser();

              await supabase.from("admin_permission_audit").insert({
                admin_user_id: user?.id || null,
                admin_email: user?.email || "unknown",
                privilege_group: group,
                permission_key: dep,
                old_value: false,
                new_value: true,
                action_id: actionId,
              });
            } catch (err) {
              console.error("Toggle error:", err);
            }
          }
        }
      }

      // 🔥 reverse dependency cleanup (turn OFF children if parent disabled)
      if (!nextEnabled) {
        const REVERSE_RELATIONS: Record<string, string[]> = {
          can_manage_attendees: ["can_manage_checkin", "can_manage_parking"],
        };

        const children = REVERSE_RELATIONS[key] || [];

        for (const child of children) {
          const wasEnabled = isEnabled(group, child);

          await supabase.from("admin_privilege_group_permissions").upsert(
            {
              privilege_group: group,
              permission_key: child,
              is_enabled: false,
            },
            { onConflict: "privilege_group,permission_key" },
          );

          // 🔥 audit reverse cleanup
          if (wasEnabled) {
            try {
              const {
                data: { user },
              } = await supabase.auth.getUser();

              await supabase.from("admin_permission_audit").insert({
                admin_user_id: user?.id || null,
                admin_email: user?.email || "unknown",
                privilege_group: group,
                permission_key: child,
                old_value: true,
                new_value: false,
                action_id: actionId,
              });
            } catch (err) {
              console.error("Audit reverse cleanup failed:", err);
            }
          }
        }
      }

      // 🔥 bust cache so sidebar updates instantly
      bumpAdminPermissionsVersion();

      // 🔥 reload UI
      await load();
    } catch (err: any) {
      console.error("Toggle error:", err);

      alert(
        `Toggle failed:\n\n${
          err?.message || err?.error_description || JSON.stringify(err, null, 2)
        }`,
      );
    }
  }

  async function undoLastChange() {
    try {
      setUndoing(true);

      const { data } = await supabase
        .from("admin_permission_audit")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(50);

      if (!data || data.length === 0) {
        alert("No changes to undo");
        return;
      }

      const latestActionId = data.find((r: any) => r.action_id)?.action_id;

      let actionGroup = [];

      if (latestActionId) {
        actionGroup = data.filter((r: any) => r.action_id === latestActionId);
      } else {
        // fallback for older records without action_id
        const latestTime = new Date(data[0].changed_at).getTime();
        const ACTION_WINDOW_MS = 2000;

        actionGroup = data.filter((row: any) => {
          const rowTime = new Date(row.changed_at).getTime();
          return latestTime - rowTime <= ACTION_WINDOW_MS;
        });
      }

      for (const row of actionGroup) {
        await supabase.from("admin_privilege_group_permissions").upsert(
          {
            privilege_group: row.privilege_group,
            permission_key: row.permission_key,
            is_enabled: row.old_value,
          },
          { onConflict: "privilege_group,permission_key" },
        );
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const undoActionId = crypto.randomUUID();

      for (const row of actionGroup) {
        await supabase.from("admin_permission_audit").insert({
          admin_user_id: user?.id || null,
          admin_email: user?.email || "unknown",
          privilege_group: row.privilege_group,
          permission_key: row.permission_key,
          old_value: !row.old_value,
          new_value: row.old_value,
          action_id: undoActionId,
        });
      }

      bumpAdminPermissionsVersion();
      await load();
    } catch (err) {
      console.error("Undo failed:", err);
    } finally {
      setUndoing(false);
    }
  }

  async function savePreset(name: string) {
    const config: Record<string, string[]> = {};

    GROUPS.forEach((group) => {
      config[group] = ALL_PERMISSIONS.filter((p) => isEnabled(group, p));
    });

    await supabase.from("admin_permission_presets").upsert({
      name,
      config,
    });

    await loadPresets();
  }

  async function applyPreset(name: string) {
    const config = presets[name];
    if (!config) {
      return;
    }

    const actionId = crypto.randomUUID();

    for (const group of GROUPS) {
      const enabledSet = new Set(config[group] || []);

      for (const perm of ALL_PERMISSIONS) {
        const shouldEnable = enabledSet.has(perm);

        await supabase.from("admin_privilege_group_permissions").upsert(
          {
            privilege_group: group,
            permission_key: perm,
            is_enabled: shouldEnable,
          },
          { onConflict: "privilege_group,permission_key" },
        );

        const {
          data: { user },
        } = await supabase.auth.getUser();

        await supabase.from("admin_permission_audit").insert({
          admin_user_id: user?.id || null,
          admin_email: user?.email || "unknown",
          privilege_group: group,
          permission_key: perm,
          old_value: !shouldEnable,
          new_value: shouldEnable,
          action_id: actionId,
        });
      }
    }

    bumpAdminPermissionsVersion();
    await load();
  }

  if (loading) {
    return <div style={{ padding: 20 }}>Loading permissions...</div>;
  }

  return (
    <div style={{ padding: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h1 style={{ marginBottom: 20 }}>Permissions</h1>
        <button
          type="button"
          onClick={undoLastChange}
          disabled={undoing}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #d1d5db",
            background: undoing ? "#e5e7eb" : "#fff",
            cursor: undoing ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {undoing ? "Undoing..." : "Undo Last Change"}
        </button>
      </div>
      <div style={{ marginBottom: 16 }}>
        <input
          placeholder="Preset name"
          id="presetName"
          style={{ marginRight: 8, padding: 6 }}
        />
        <button
          onClick={() => {
            const input = document.getElementById(
              "presetName",
            ) as HTMLInputElement;
            if (input?.value) {
              savePreset(input.value);
            }
          }}
        >
          Save Preset
        </button>

        {Object.keys(presets).map((name) => (
          <button
            key={name}
            style={{ marginLeft: 8 }}
            onClick={() => applyPreset(name)}
          >
            Load {name}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 13, marginBottom: 16, color: "#555" }}>
        Changes apply immediately. Some permissions auto-enable required
        dependencies.
      </div>

      {GROUPS.map((group) => (
        <div key={group} style={{ marginBottom: 30 }}>
          <h2 style={{ textTransform: "capitalize" }}>
            {group.replace("_", " ")}
          </h2>

          {Object.entries(PERMISSION_GROUPS).map(([section, perms]) => {
            const sectionEnabledCount = perms.filter((p) =>
              isEnabled(group, p),
            ).length;

            const allEnabled = sectionEnabledCount === perms.length;
            const noneEnabled = sectionEnabledCount === 0;

            async function toggleSection() {
              const enableAll = !allEnabled;

              // 🔥 Use existing toggle logic so dependencies + reverse cleanup are enforced
              for (const perm of perms) {
                const currentlyEnabled = isEnabled(group, perm);

                // Only toggle if state needs to change
                if (enableAll && !currentlyEnabled) {
                  await toggle(group, perm);
                }

                if (!enableAll && currentlyEnabled) {
                  // Skip if locked (required by another permission)
                  if (isRequiredByAnother(group, perm)) {
                    continue;
                  }
                  await toggle(group, perm);
                }
              }

              // Cache + UI refresh already handled inside toggle()
            }

            return (
              <div
                key={section}
                style={{
                  marginBottom: 12,
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  background: allEnabled
                    ? "#dcfce7" // green tint (all enabled)
                    : noneEnabled
                      ? "#fef2f2" // red tint (all disabled)
                      : "#f9fafb", // mixed state
                  transition: "background 0.2s ease",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      color: allEnabled
                        ? "#166534"
                        : noneEnabled
                          ? "#991b1b"
                          : "#374151",
                    }}
                  >
                    {section}
                  </div>

                  <button
                    type="button"
                    onClick={toggleSection}
                    style={{
                      fontSize: 11,
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid #d1d5db",
                      background: "#f9fafb",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {allEnabled
                      ? "Disable All"
                      : noneEnabled
                        ? "Enable All"
                        : "Toggle All"}
                  </button>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 10,
                  }}
                >
                  {perms.map((perm) => {
                    const enabled = isEnabled(group, perm);
                    const locked = isRequiredByAnother(group, perm);

                    return (
                      <div
                        key={perm}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid #e5e7eb",
                          background: enabled ? "#eef4ff" : "#fff",
                          cursor: locked ? "not-allowed" : "pointer",
                          opacity: locked ? 0.6 : 1,
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        <span>
                          {PERMISSION_LABELS[perm] || perm}
                          {perm === "can_manage_attendees" && (
                            <span
                              style={{
                                fontSize: 11,
                                marginLeft: 6,
                                color: "#6b7280",
                              }}
                            >
                              (core)
                            </span>
                          )}
                          {locked && (
                            <span
                              style={{
                                fontSize: 11,
                                marginLeft: 6,
                                color: "#ef4444",
                              }}
                            >
                              (required)
                            </span>
                          )}
                        </span>

                        <button
                          type="button"
                          aria-pressed={enabled}
                          disabled={locked || undoing}
                          onClick={(e) => {
                            e.stopPropagation();

                            if (locked || undoing) {
                              return;
                            }

                            void toggle(group, perm);
                          }}
                          style={{
                            width: 42,
                            height: 24,
                            minWidth: 42,
                            padding: 0,
                            border: "none",
                            outline: "none",
                            borderRadius: 999,
                            background: enabled ? "#0b5cff" : "#e5e7eb",
                            position: "relative",
                            transition: "all 0.2s ease",
                            cursor: locked ? "not-allowed" : "pointer",
                            pointerEvents: "auto",
                            appearance: "none",
                            WebkitAppearance: "none",
                          }}
                        >
                          <div
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 999,
                              background: "#fff",
                              position: "absolute",
                              top: 3,
                              left: enabled ? 20 : 3,
                              transition: "all 0.2s ease",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                              pointerEvents: "none",
                            }}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
