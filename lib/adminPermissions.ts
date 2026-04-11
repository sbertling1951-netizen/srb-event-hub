export type PrivilegeGroup =
  | "super_admin"
  | "event_admin"
  | "checkin"
  | "parking"
  | "content_admin"
  | "read_only";

export type AdminPermissions = {
  can_manage_admins: boolean;
  can_manage_event_admins: boolean;
  can_manage_events: boolean;
  can_import_attendees: boolean;
  can_edit_attendees: boolean;
  can_mark_arrived: boolean;
  can_assign_parking: boolean;
  can_manage_agenda: boolean;
  can_manage_announcements: boolean;
  can_manage_nearby: boolean;
  can_view_reports: boolean;
  can_export_reports: boolean;
  can_manage_master_maps: boolean;
  can_manage_master_nearby: boolean;
  can_manage_settings: boolean;
};

export const EMPTY_PERMISSIONS: AdminPermissions = {
  can_manage_admins: false,
  can_manage_event_admins: false,
  can_manage_events: false,
  can_import_attendees: false,
  can_edit_attendees: false,
  can_mark_arrived: false,
  can_assign_parking: false,
  can_manage_agenda: false,
  can_manage_announcements: false,
  can_manage_nearby: false,
  can_view_reports: true,
  can_export_reports: false,
  can_manage_master_maps: false,
  can_manage_master_nearby: false,
  can_manage_settings: false,
};

export const PERMISSION_PRESETS: Record<PrivilegeGroup, AdminPermissions> = {
  super_admin: {
    can_manage_admins: true,
    can_manage_event_admins: true,
    can_manage_events: true,
    can_import_attendees: true,
    can_edit_attendees: true,
    can_mark_arrived: true,
    can_assign_parking: true,
    can_manage_agenda: true,
    can_manage_announcements: true,
    can_manage_nearby: true,
    can_view_reports: true,
    can_export_reports: true,
    can_manage_master_maps: true,
    can_manage_master_nearby: true,
    can_manage_settings: true,
  },

  event_admin: {
    can_manage_admins: false,
    can_manage_event_admins: true,
    can_manage_events: true,
    can_import_attendees: true,
    can_edit_attendees: true,
    can_mark_arrived: true,
    can_assign_parking: true,
    can_manage_agenda: true,
    can_manage_announcements: true,
    can_manage_nearby: true,
    can_view_reports: true,
    can_export_reports: true,
    can_manage_master_maps: false,
    can_manage_master_nearby: false,
    can_manage_settings: false,
  },

  checkin: {
    can_manage_admins: false,
    can_manage_event_admins: false,
    can_manage_events: false,
    can_import_attendees: false,
    can_edit_attendees: true,
    can_mark_arrived: true,
    can_assign_parking: false,
    can_manage_agenda: false,
    can_manage_announcements: false,
    can_manage_nearby: false,
    can_view_reports: true,
    can_export_reports: false,
    can_manage_master_maps: false,
    can_manage_master_nearby: false,
    can_manage_settings: false,
  },

  parking: {
    can_manage_admins: false,
    can_manage_event_admins: false,
    can_manage_events: false,
    can_import_attendees: false,
    can_edit_attendees: false,
    can_mark_arrived: false,
    can_assign_parking: true,
    can_manage_agenda: false,
    can_manage_announcements: false,
    can_manage_nearby: false,
    can_view_reports: true,
    can_export_reports: true,
    can_manage_master_maps: false,
    can_manage_master_nearby: false,
    can_manage_settings: false,
  },

  content_admin: {
    can_manage_admins: false,
    can_manage_event_admins: false,
    can_manage_events: false,
    can_import_attendees: false,
    can_edit_attendees: false,
    can_mark_arrived: false,
    can_assign_parking: false,
    can_manage_agenda: true,
    can_manage_announcements: true,
    can_manage_nearby: true,
    can_view_reports: true,
    can_export_reports: false,
    can_manage_master_maps: false,
    can_manage_master_nearby: false,
    can_manage_settings: false,
  },

  read_only: {
    can_manage_admins: false,
    can_manage_event_admins: false,
    can_manage_events: false,
    can_import_attendees: false,
    can_edit_attendees: false,
    can_mark_arrived: false,
    can_assign_parking: false,
    can_manage_agenda: false,
    can_manage_announcements: false,
    can_manage_nearby: false,
    can_view_reports: true,
    can_export_reports: false,
    can_manage_master_maps: false,
    can_manage_master_nearby: false,
    can_manage_settings: false,
  },
};

export const PERMISSION_LABELS: Record<keyof AdminPermissions, string> = {
  can_manage_admins: "Manage Admin Users",
  can_manage_event_admins: "Manage Event Staff",
  can_manage_events: "Manage Events",
  can_import_attendees: "Import Attendees",
  can_edit_attendees: "Edit Attendees",
  can_mark_arrived: "Mark Arrived",
  can_assign_parking: "Assign Parking",
  can_manage_agenda: "Manage Agenda",
  can_manage_announcements: "Manage Announcements",
  can_manage_nearby: "Manage Nearby",
  can_view_reports: "View Reports",
  can_export_reports: "Export Reports",
  can_manage_master_maps: "Manage Master Maps",
  can_manage_master_nearby: "Manage Master Nearby",
  can_manage_settings: "Manage Settings",
};

export function getPresetPermissions(group: PrivilegeGroup): AdminPermissions {
  return { ...PERMISSION_PRESETS[group] };
}

export function can(
  permissions: AdminPermissions | null | undefined,
  permission: keyof AdminPermissions,
) {
  return !!permissions?.[permission];
}
