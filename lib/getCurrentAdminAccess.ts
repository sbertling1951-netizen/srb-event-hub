import { STORAGE_KEYS } from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";

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

const ADMIN_ACCESS_CACHE_TTL_MS = 1000 * 60 * 30;
const ADMIN_ACCESS_TIMEOUT_MS = 15000;

let inflightAdminAccess: Promise<AdminAccessResult | null> | null = null;

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

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)));
}

function buildPermissionMap(keys: string[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const k of keys) {
    map[k] = true;
  }
  return map;
}

function getCachedAdminAccess(): AdminAccessResult | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const savedAt = Number(
      localStorage.getItem(STORAGE_KEYS.adminAccessCacheTime) || 0,
    );
    if (!savedAt || Date.now() - savedAt > ADMIN_ACCESS_CACHE_TTL_MS) {
      clearAdminAccessCache();
      return null;
    }
    const raw = localStorage.getItem(STORAGE_KEYS.adminAccessCache);
    return raw ? JSON.parse(raw) : null;
  } catch {
    clearAdminAccessCache();
    return null;
  }
}

function saveAdminAccessCache(access: AdminAccessResult) {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(STORAGE_KEYS.adminAccessCache, JSON.stringify(access));
  localStorage.setItem(STORAGE_KEYS.adminAccessCacheTime, String(Date.now()));
}

export function clearAdminAccessCache() {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.removeItem(STORAGE_KEYS.adminAccessCache);
  localStorage.removeItem(STORAGE_KEYS.adminAccessCacheTime);
}

export async function getCurrentAdminAccess(): Promise<AdminAccessResult | null> {
  if (inflightAdminAccess) {
    return inflightAdminAccess;
  }

  inflightAdminAccess = (async () => {
    try {
      const cached = getCachedAdminAccess();
      if (cached) {
        return cached;
      }

      const auth = await withTimeout(
        supabase.auth.getUser(),
        "Admin auth check",
      );
      const user = auth.data.user;
      if (!user) {
        return null;
      }

      let { data: adminUser } = await supabase
        .from("admin_users")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (!adminUser && user.email) {
        const { data: fallback } = await supabase
          .from("admin_users")
          .select("*")
          .eq("email", user.email)
          .eq("is_active", true)
          .maybeSingle();

        if (fallback) {
          adminUser = fallback;

          if (!adminUser.user_id) {
            await supabase
              .from("admin_users")
              .update({ user_id: user.id })
              .eq("id", adminUser.id);

            adminUser.user_id = user.id;
          }
        }
      }

      if (!adminUser) {
        return null;
      }

      const { data: accessRows } = await supabase
        .from("admin_event_access")
        .select("*")
        .eq("admin_user_id", adminUser.id);

      const eventIds = unique((accessRows || []).map((r: any) => r.event_id));

      let currentEventId: string | null = null;

      if (adminUser.privilege_group === "super_admin") {
        currentEventId = null;
      } else if (eventIds.length === 1) {
        currentEventId = eventIds[0];
      } else if (eventIds.length > 1) {
        currentEventId = eventIds[0];
      }

      const permissionKeys =
        adminUser.privilege_group === "super_admin" ||
        adminUser.privilege_group === "event_admin"
          ? [
              "can_view_admin_dashboard",
              "can_manage_events",
              "can_manage_checkin",
              "can_manage_parking",
              "can_manage_agenda",
              "can_manage_announcements",
              "can_manage_nearby",
              "can_manage_locations",
              "can_manage_reports",
              "can_manage_imports",
              "can_manage_event_staff",
            ]
          : [];

      const permissionMap = buildPermissionMap(permissionKeys);

      const result: AdminAccessResult = {
        adminUser,
        currentEventId,
        currentEventAccess:
          (accessRows || []).find((r: any) => r.event_id === currentEventId) ||
          null,
        eventAccessRows: accessRows || [],
        permissionKeys,
        permissionMap,
        rolePermissions: [],
        eventPermissionKeys: [],
        privilegeGroup: adminUser.privilege_group,
        isSuperAdmin: adminUser.privilege_group === "super_admin",
        email: adminUser.email,
        display_name: adminUser.display_name,
        privilege_group: adminUser.privilege_group,
        eventIds,
        event_ids: eventIds,
      };

      saveAdminAccessCache(result);
      return result;
    } catch (err) {
      console.error("[getAdminAccess] FATAL", err);
      return null;
    } finally {
      inflightAdminAccess = null;
    }
  })();

  return inflightAdminAccess;
}
