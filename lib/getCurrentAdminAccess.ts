import { supabase } from "@/lib/supabase";
import {
  getPresetPermissions,
  type AdminPermissions,
  type PrivilegeGroup,
} from "@/lib/adminPermissions";

export type CurrentAdminAccess = {
  id: string;
  email: string;
  display_name?: string | null;
  is_active: boolean;
  privilege_group: PrivilegeGroup;
  permissions: AdminPermissions;
  event_ids: string[];
};

export async function getCurrentAdminAccess(): Promise<CurrentAdminAccess | null> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  let authUserId = session?.user?.id ?? null;

  if (!authUserId) {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user?.id) return null;
    authUserId = user.id;
  }

  if (sessionError && !authUserId) return null;

  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("id, email, display_name, is_active, privilege_group, user_id")
    .eq("user_id", authUserId)
    .maybeSingle();

  if (adminError || !adminRow || !adminRow.is_active) return null;

  const { data: permissionRow, error: permissionError } = await supabase
    .from("admin_permissions")
    .select("*")
    .eq("admin_user_id", adminRow.id)
    .maybeSingle();

  const { data: eventAccessRows } = await supabase
    .from("admin_event_access")
    .select("event_id")
    .eq("admin_user_id", adminRow.id);

  const resolvedPermissions: AdminPermissions = permissionRow
    ? {
        can_manage_admins: !!permissionRow.can_manage_admins,
        can_manage_event_admins: !!permissionRow.can_manage_event_admins,
        can_manage_events: !!permissionRow.can_manage_events,
        can_import_attendees: !!permissionRow.can_import_attendees,
        can_edit_attendees: !!permissionRow.can_edit_attendees,
        can_mark_arrived: !!permissionRow.can_mark_arrived,
        can_assign_parking: !!permissionRow.can_assign_parking,
        can_manage_agenda: !!permissionRow.can_manage_agenda,
        can_manage_announcements: !!permissionRow.can_manage_announcements,
        can_manage_nearby: !!permissionRow.can_manage_nearby,
        can_view_reports: !!permissionRow.can_view_reports,
        can_export_reports: !!permissionRow.can_export_reports,
        can_manage_master_maps: !!permissionRow.can_manage_master_maps,
        can_manage_master_nearby: !!permissionRow.can_manage_master_nearby,
        can_manage_settings: !!permissionRow.can_manage_settings,
      }
    : getPresetPermissions(adminRow.privilege_group);

  if (permissionError) {
    console.error("Could not load admin permissions:", permissionError);
  }

  return {
    ...adminRow,
    permissions: resolvedPermissions,
    event_ids: (eventAccessRows || []).map((row) => row.event_id),
  };
}

export function hasPermission(
  admin: CurrentAdminAccess | null,
  permission: keyof AdminPermissions,
) {
  if (!admin || !admin.is_active) return false;
  if (admin.privilege_group === "super_admin") return true;
  return !!admin.permissions[permission];
}

export function canAccessEvent(
  admin: CurrentAdminAccess | null,
  eventId?: string | null,
) {
  if (!admin || !admin.is_active) return false;
  if (admin.privilege_group === "super_admin") return true;
  if (!eventId) return false;
  return admin.event_ids.includes(eventId);
}
