"use client";

import { HelpButton } from "@/components/ui/HelpButton";

export const TENANT_FIELD_HELP = {
  organization_code: { title: "Organization code", text: "A short reference code for the organization, such as FCOC or EPX. Choose a unique code when creating the tenant. It is an alias, not a membership number or a permission grant. This form cannot change it after creation." },
  slug: { title: "Slug", text: "A unique, readable identifier, such as epicentrax-test. Use lowercase letters and numbers, with single hyphens between words. It does not create a website address or hostname mapping. This form cannot change it after creation." },
  organization_name: { title: "Organization name", text: "The full name of the organization, such as Fleetwood Country Owners Club. Required. Use the organization's name, rather than the name of one event." },
  display_name: { title: "Display name", text: "The shorter name people see in tenant lists and branding previews, such as FCOC or EpicentraX Test. Required. Changing it does not change the tenant's identity or access permissions." },
  app_title: { title: "App title", text: "The title for this tenant's application, such as FCOC Event Hub. Required. Tenant-aware pages can use it in application branding and the browser page title when the hostname resolves to this tenant." },
  app_tagline: { title: "App tagline", text: "An optional short phrase beneath the application title where the page supports it, such as Connect, explore, and enjoy. Leave blank if you do not want a tagline." },
  logo_url: { title: "Logo URL and upload", text: "An optional direct web address to the logo image, rather than a webpage containing the image. Example: https://example.com/images/logo.png. You can instead upload a PNG, JPEG, or WebP up to 2 MB after creating the tenant. Uploaded logos are public. Save applies your choice; leaving the field blank uses the platform default." },
  favicon_url: { title: "Favicon URL", text: "An optional direct web address to the small icon normally shown on a browser tab. This field currently stores the address only; it does not yet change the browser tab icon. Leave blank if you do not have one." },
  primary_color: { title: "Primary color", text: "Your organization's main brand color. Enter a value such as #2457D6, or use the color picker. Blank uses the platform default. Tenant-aware screens may use this branding value; not every screen applies tenant colors." },
  secondary_color: { title: "Secondary color", text: "A supporting brand color used alongside the primary color. Enter a value such as #64748B, or use the color picker. Blank uses the platform default. Actual use depends on the tenant-aware screen." },
  accent_color: { title: "Accent color", text: "A highlight color for emphasis within your brand, such as #F59E0B. Enter a color value or use the picker. Blank uses the platform default. Actual use depends on the tenant-aware screen." },
  tenant_type_id: { title: "Tenant type", text: "An optional classification for the organization. Choose the category that fits, or leave No Tenant type. Platform Administrators can use Add tenant type to create another choice for the shared list. Type does not restrict available tools, grant permissions, or activate the tenant. Suggested onboarding defaults are planned for the future; choosing a type does not apply them today." },
  post_event_edit_window_days: { title: "Post-Event edit window (days)", text: "How long ordinary administrative editing remains available after an event ends. Blank uses the platform default of 60 days. Enter 0–59 to set a shorter tenant default; 0 allows no post-event editing window. An event-level policy may shorten it further. After the window closes, historical records are retained and corrections require the governed historical correction process." },
  reason: { title: "Reason", text: "Optional context explaining this administrative action, such as Creating a test tenant for logo and event setup. The reason is retained in the audit history. Do not enter passwords or other secrets." },
} as const;

export function TenantFieldHelp({ field }: { field: keyof typeof TENANT_FIELD_HELP }) {
  const help = TENANT_FIELD_HELP[field];
  return <HelpButton title={help.title}><p>{help.text}</p></HelpButton>;
}
