import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";
import { resolveAndLinkAdminIdentity } from "@/lib/server/adminIdentityLinkage";

type AdminUserRow = {
  id: string;
  email: string;
  privilege_group: string | null;
};

type PrivilegePermissionRow = {
  permission_key: string;
  is_enabled: boolean;
};

const BASE_PERMISSIONS: Record<string, string[]> = {
  super_admin: [
    "can_manage_admins",
    "can_manage_event_admins",
    "can_view_admin_dashboard",
    "can_manage_events",
    "can_manage_attendees",
    "can_manage_checkin",
    "can_mark_arrived",
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
  ],
  event_admin: [
    "can_view_admin_dashboard",
    "can_manage_events",
    "can_manage_attendees",
    "can_manage_checkin",
    "can_mark_arrived",
    "can_manage_parking",
    "can_manage_agenda",
    "can_manage_announcements",
    "can_manage_nearby",
    "can_manage_locations",
    "can_manage_reports",
    "can_manage_imports",
    "can_manage_event_staff",
    "can_manage_vendors",
  ],
  checkin: [
    "can_view_admin_dashboard",
    "can_manage_checkin",
    "can_mark_arrived",
    "can_manage_attendees",
  ],
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

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function normalizePermissionSet(
  privilegeGroup: string,
  overrides: PrivilegePermissionRow[],
) {
  const base = [...(BASE_PERMISSIONS[privilegeGroup] || BASE_PERMISSIONS.read_only)];

  for (const row of overrides) {
    const key = row.permission_key;

    if (row.is_enabled && !base.includes(key)) {
      base.push(key);
    }

    if (!row.is_enabled) {
      const index = base.indexOf(key);
      if (index >= 0) {
        base.splice(index, 1);
      }
    }
  }

  return unique(base);
}

export type AdminActor = {
  authUserId: string;
  adminUserId: string;
  email: string;
  privilegeGroup: string;
  isSuperAdmin: boolean;
  permissions: string[];
};

export async function resolveAdminActorFromBearer(
  authorizationHeader: string | null,
): Promise<{ admin: AdminActor | null; error?: string; status?: number }> {
  const bearerToken = authorizationHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  const supabaseAdmin = getSupabaseAdminClient();

  if (!bearerToken || !supabaseAdmin) {
    return { admin: null, error: "Authentication is required.", status: 401 };
  }

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(bearerToken);

  if (authError || !user?.id) {
    return { admin: null, error: "Authentication is required.", status: 401 };
  }

  // Single identity-matching algorithm, shared with the dedicated
  // /api/admins/link-identity route -- resolves an already-linked row, or
  // backfills admin_users.user_id via the same governed email-match
  // (now additionally corroborated against the Person identity graph
  // when that graph has data for this auth user).
  const linkage = await resolveAndLinkAdminIdentity(supabaseAdmin, {
    id: user.id,
    email: user.email,
  });

  let adminUser: AdminUserRow | null = null;

  if (linkage.status === "linked" || linkage.status === "already_linked") {
    const { data, error } = await supabaseAdmin
      .from("admin_users")
      .select("id,email,privilege_group")
      .eq("id", linkage.adminUserId)
      .eq("is_active", true)
      .maybeSingle<AdminUserRow>();

    if (error) {
      return { admin: null, error: error.message, status: 500 };
    }

    adminUser = data;
  }

  if (!adminUser) {
    return { admin: null, error: "Admin access is required.", status: 403 };
  }

  const privilegeGroup = adminUser.privilege_group || "read_only";

  const { data: permissionOverrides, error: overrideError } = await supabaseAdmin
    .from("admin_privilege_group_permissions")
    .select("permission_key,is_enabled")
    .eq("privilege_group", privilegeGroup);

  if (overrideError) {
    return { admin: null, error: overrideError.message, status: 500 };
  }

  const permissions = normalizePermissionSet(
    privilegeGroup,
    (permissionOverrides || []) as PrivilegePermissionRow[],
  );

  const admin: AdminActor = {
    authUserId: user.id,
    adminUserId: adminUser.id,
    email: adminUser.email,
    privilegeGroup,
    isSuperAdmin: privilegeGroup === "super_admin",
    permissions,
  };

  return { admin };
}

export function adminHasPermission(
  admin: AdminActor,
  permission: string,
) {
  if (admin.isSuperAdmin) {
    return true;
  }

  return admin.permissions.includes(permission);
}

export async function adminCanManageEvent(
  admin: AdminActor,
  eventId: string,
): Promise<boolean> {
  if (admin.isSuperAdmin) {
    return true;
  }

  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return false;
  }

  const { data, error } = await supabaseAdmin
    .from("admin_event_access")
    .select("id")
    .eq("admin_user_id", admin.adminUserId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (error) {
    return false;
  }

  return !!data?.id;
}
