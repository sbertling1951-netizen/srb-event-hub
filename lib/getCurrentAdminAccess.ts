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
const ADMIN_ACCESS_CACHE_KEY = "fcoc-admin-access-cache";
const ADMIN_ACCESS_CACHE_TIME_KEY = "fcoc-admin-access-cache-time";
const ADMIN_ACCESS_CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

const ADMIN_ACCESS_TIMEOUT_MS = 8000;

async function withTimeout<T>(
  promise: PromiseLike<T>,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, ADMIN_ACCESS_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

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
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(ADMIN_EVENT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
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
function getCachedAdminAccess(): AdminAccessResult | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const savedAtRaw = window.localStorage.getItem(ADMIN_ACCESS_CACHE_TIME_KEY);
    const savedAt = savedAtRaw ? Number(savedAtRaw) : 0;

    if (!savedAt || Date.now() - savedAt > ADMIN_ACCESS_CACHE_TTL_MS) {
      clearAdminAccessCache();
      return null;
    }

    const raw = window.localStorage.getItem(ADMIN_ACCESS_CACHE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as AdminAccessResult;
  } catch {
    clearAdminAccessCache();
    return null;
  }
}

function saveAdminAccessCache(access: AdminAccessResult) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ADMIN_ACCESS_CACHE_KEY, JSON.stringify(access));
  window.localStorage.setItem(ADMIN_ACCESS_CACHE_TIME_KEY, String(Date.now()));
}

export function clearAdminAccessCache() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(ADMIN_ACCESS_CACHE_KEY);
  window.localStorage.removeItem(ADMIN_ACCESS_CACHE_TIME_KEY);
}

export async function getCurrentAdminAccess(options?: {
  forceRefresh?: boolean;
}): Promise<AdminAccessResult | null> {
  if (!options?.forceRefresh) {
    const cached = getCachedAdminAccess();
    if (cached) {
      return cached;
    }
  }
  let authResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;

  try {
    authResult = await withTimeout(supabase.auth.getUser(), "Admin auth check");
  } catch (error) {
    console.error("Admin auth check failed:", error);
    clearAdminAccessCache();
    return null;
  }

  const {
    data: { user },
    error: authError,
  } = authResult;

  if (authError || !user) {
    clearAdminAccessCache();
    return null;
  }

  let adminUserResult: {
    data: AdminUserAccessRow | null;
    error: unknown;
  };

  try {
    adminUserResult = await withTimeout(
      supabase
        .from("admin_users")
        .select(
          "id, email, display_name, is_active, is_super_admin, privilege_group, user_id",
        )
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle(),
      "Admin user lookup",
    );
  } catch (error) {
    console.error("Admin user lookup failed:", error);
    clearAdminAccessCache();
    return null;
  }

  const { data: adminUserData, error: adminUserError } = adminUserResult;

  if (adminUserError || !adminUserData) {
    clearAdminAccessCache();
    return null;
  }

  const adminUser = adminUserData as AdminUserAccessRow;
  const currentEventId = readStoredAdminEventId();

  let eventAccessResult: {
    data: unknown[] | null;
    error: unknown;
  };

  try {
    eventAccessResult = await withTimeout(
      supabase
        .from("admin_event_access")
        .select("id, event_id, admin_user_id, role, created_at")
        .eq("admin_user_id", adminUser.id),
      "Admin event access lookup",
    );
  } catch (error) {
    console.error("Admin event access lookup failed:", error);
    clearAdminAccessCache();
    return null;
  }

  const { data: eventAccessData, error: eventAccessError } = eventAccessResult;

  if (eventAccessError) {
    clearAdminAccessCache();
    return null;
  }

  const eventAccessRows = (eventAccessData || []) as AdminEventAccessRow[];

  const currentEventAccess = currentEventId
    ? eventAccessRows.find((row) => row.event_id === currentEventId) || null
    : null;

  let eventPermissionRows: AdminEventPermissionRow[] = [];

  if (currentEventAccess?.id) {
    let permissionResult: {
      data: unknown[] | null;
      error: unknown;
    };

    try {
      permissionResult = await withTimeout(
        supabase
          .from("admin_event_permissions")
          .select("id, admin_event_access_id, permission_key, is_enabled")
          .eq("admin_event_access_id", currentEventAccess.id)
          .eq("is_enabled", true),
        "Admin event permissions lookup",
      );
    } catch (error) {
      console.error("Admin event permissions lookup failed:", error);
      clearAdminAccessCache();
      return null;
    }

    const { data: permissionData, error: permissionError } = permissionResult;

    if (permissionError) {
      clearAdminAccessCache();
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

  const result: AdminAccessResult = {
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

  saveAdminAccessCache(result);
  return result;
}

export function hasPermission(
  admin: AdminAccessResult | null | undefined,
  permissionKey: string,
): boolean {
  if (!admin) {
    return false;
  }
  if (admin.isSuperAdmin) {
    return true;
  }
  return !!admin.permissionMap[permissionKey];
}

export function canAccessEvent(
  admin: AdminAccessResult | null | undefined,
  eventId?: string | null,
): boolean {
  if (!admin || !eventId) {
    return false;
  }
  if (admin.isSuperAdmin) {
    return true;
  }
  return admin.eventAccessRows.some((row) => row.event_id === eventId);
}
