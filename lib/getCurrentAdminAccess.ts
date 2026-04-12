import { supabase } from "@/lib/supabase";

type AdminEventContext = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
};

export type AdminUserAccessRow = {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  is_super_admin?: boolean | null;
  privilege_group: string | null;
  user_id: string | null;
};

export type AdminEventAccessRow = {
  id: string;
  event_id: string;
  admin_user_id: string;
  role: string | null;
  created_at?: string | null;
};

export type AdminEventPermissionRow = {
  id: string;
  admin_event_access_id: string;
  permission_key: string;
  is_enabled: boolean;
};

export type AdminAccessResult = {
  adminUser: AdminUserAccessRow;
  currentEventId: string | null;
  currentEventAccess: AdminEventAccessRow | null;
  eventAccessRows: AdminEventAccessRow[];
  permissionKeys: string[];
  permissionMap: Record<string, boolean>;
  rolePermissions: string[];
  eventPermissionKeys: string[];
  privilegeGroup: string | null;
  isSuperAdmin: boolean;
  email: string;
  display_name: string | null;
  privilege_group: string | null;
  eventIds: string[];
  event_ids: string[];
};

const ADMIN_EVENT_STORAGE_KEY = "fcoc-admin-event-context";

const PRIVILEGE_GROUP_PRESETS: Record<string, string[]> = {
  super_admin: [
    "can_manage_admins",
    "can_manage_event_admins",
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
    "can_manage_events",
    "can_manage_master_maps",
  ],
  event_admin: [
    "can_manage_event_admins",
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
    "can_manage_events",
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

const EVENT_ROLE_PRESETS: Record<string, string[]> = {
  super_admin: PRIVILEGE_GROUP_PRESETS.super_admin,
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

function readStoredAdminEventId(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(ADMIN_EVENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminEventContext | null;
    return parsed?.id || null;
  } catch {
    return null;
  }
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => !!value)),
  );
}

function buildPermissionMap(permissionKeys: string[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const key of permissionKeys) {
    map[key] = true;
  }
  return map;
}

export async function getCurrentAdminAccess(): Promise<AdminAccessResult | null> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  const { data: adminUserData, error: adminUserError } = await supabase
    .from("admin_users")
    .select(
      "id, email, display_name, is_active, is_super_admin, privilege_group, user_id",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (adminUserError || !adminUserData) {
    return null;
  }

  const adminUser = adminUserData as AdminUserAccessRow;
  const currentEventId = readStoredAdminEventId();

  const { data: eventAccessData, error: eventAccessError } = await supabase
    .from("admin_event_access")
    .select("id, event_id, admin_user_id, role, created_at")
    .eq("admin_user_id", adminUser.id);

  if (eventAccessError) {
    return null;
  }

  const eventAccessRows = (eventAccessData || []) as AdminEventAccessRow[];

  const currentEventAccess = currentEventId
    ? eventAccessRows.find((row) => row.event_id === currentEventId) || null
    : null;

  let eventPermissionRows: AdminEventPermissionRow[] = [];

  if (currentEventAccess?.id) {
    const { data: permissionData, error: permissionError } = await supabase
      .from("admin_event_permissions")
      .select("id, admin_event_access_id, permission_key, is_enabled")
      .eq("admin_event_access_id", currentEventAccess.id)
      .eq("is_enabled", true);

    if (permissionError) {
      return null;
    }

    eventPermissionRows = (permissionData || []) as AdminEventPermissionRow[];
  }

  const privilegeGroup = adminUser.privilege_group || null;
  const isSuperAdmin =
    !!adminUser.is_super_admin || privilegeGroup === "super_admin";

  const privilegePermissions = isSuperAdmin
    ? PRIVILEGE_GROUP_PRESETS.super_admin
    : PRIVILEGE_GROUP_PRESETS[privilegeGroup || ""] || [];

  const rolePermissions = currentEventAccess
    ? EVENT_ROLE_PRESETS[currentEventAccess.role || "event_admin"] || []
    : [];

  const eventPermissionKeys = eventPermissionRows.map(
    (row) => row.permission_key,
  );

  const permissionKeys = unique([
    ...privilegePermissions,
    ...rolePermissions,
    ...eventPermissionKeys,
  ]);

  const eventIds = unique(eventAccessRows.map((row) => row.event_id));

  return {
    adminUser,
    currentEventId,
    currentEventAccess,
    eventAccessRows,
    permissionKeys,
    permissionMap: buildPermissionMap(permissionKeys),
    rolePermissions,
    eventPermissionKeys,
    privilegeGroup,
    isSuperAdmin,
    email: adminUser.email,
    display_name: adminUser.display_name,
    privilege_group: privilegeGroup,
    eventIds,
    event_ids: eventIds,
  };
}

export function hasPermission(
  admin: AdminAccessResult | null | undefined,
  permissionKey: string,
): boolean {
  if (!admin) return false;
  if (admin.isSuperAdmin) return true;
  return !!admin.permissionMap[permissionKey];
}

export function canAccessEvent(
  admin: AdminAccessResult | null | undefined,
  eventId?: string | null,
): boolean {
  if (!admin || !eventId) return false;
  if (admin.isSuperAdmin) return true;
  return admin.eventAccessRows.some((row) => row.event_id === eventId);
}
