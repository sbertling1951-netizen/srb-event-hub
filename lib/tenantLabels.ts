import { getCurrentTenant } from "@/lib/tenantContext";

export type TenantLabelKey =
  | "app_title"
  | "app_description"
  | "app_tagline"
  | "welcome_message"
  | "member_login_label"
  | "admin_login_label"
  | "dashboard_title"
  | "agenda_nav_label"
  | "announcements_nav_label"
  | "attendees_nav_label"
  | "nearby_nav_label"
  | "my_requests_nav_label"
  | "event_vendors_heading"
  | "vendor_label"
  | "vendor_requests_title"
  | "member_label"
  | "party_size_label"
  | "site_label"
  | "participant_type_label"
  | "member_number_label"
  | "display_name_label"
  | "vehicle_make_label"
  | "vehicle_model_label"
  | "vehicle_length_label"
  | "needs_vehicle_placard_label"
  | "needs_assignment_label"
  | "special_activities_label"
  | "map_nav_label";

export const DEFAULT_TENANT_LABELS: Record<TenantLabelKey, string> = {
  app_title: "Event Hub",
  app_description: "Event operations platform.",
  app_tagline: "Your guide to schedules, announcements, and event information.",
  welcome_message: "Welcome to the event app.",
  member_login_label: "Member",
  admin_login_label: "Admin",
  dashboard_title: "Member Dashboard",
  agenda_nav_label: "Agenda",
  announcements_nav_label: "Announcements",
  attendees_nav_label: "Attendees",
  nearby_nav_label: "Nearby",
  my_requests_nav_label: "My Requests",
  event_vendors_heading: "Event Vendors",
  vendor_label: "vendor",
  vendor_requests_title: "My Service Requests",
  member_label: "member",
  party_size_label: "Party",
  site_label: "Site",
  participant_type_label: "Participant Type",
  member_number_label: "Member Number",
  display_name_label: "Display Name",
  vehicle_make_label: "Vehicle Manufacturer",
  vehicle_model_label: "Vehicle Model",
  vehicle_length_label: "Vehicle Length",
  needs_vehicle_placard_label: "Needs vehicle placard",
  needs_assignment_label: "Needs assignment",
  special_activities_label: "Special Activities",
  map_nav_label: "Map",
};

let activeLabels: Record<TenantLabelKey, string> = {
  ...DEFAULT_TENANT_LABELS,
};

let labelsLoaded = false;

export async function loadTenantLabels() {
  if (labelsLoaded) {
    return;
  }

  const tenant = await getCurrentTenant();

  if (tenant) {
    activeLabels.app_title = tenant.appTitle || DEFAULT_TENANT_LABELS.app_title;

    activeLabels.app_tagline =
      tenant.appTagline || DEFAULT_TENANT_LABELS.app_tagline;

    // Additional tenant-specific labels will be mapped here as we
    // expand the white-label platform.
  }

  labelsLoaded = true;
}

export function getTenantLabel(key: TenantLabelKey) {
  return activeLabels[key];
}
  