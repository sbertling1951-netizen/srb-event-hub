import { supabase } from "@/lib/supabase";

export interface TenantContext {
  id: string;

  organizationCode: string;
  slug: string;

  organizationName: string;
  displayName: string;

  appTitle: string;
  appTagline: string | null;

  logoUrl: string | null;
  faviconUrl: string | null;

  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;

  isActive: boolean;
}

let cachedTenant: TenantContext | null = null;

export async function getCurrentTenant(): Promise<TenantContext | null> {
  if (cachedTenant) {
    return cachedTenant;
  }

  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .eq("organization_code", "FCOC")
    .single();

  if (error || !data) {
    console.error("Unable to load tenant.", error);
    return null;
  }

  cachedTenant = {
    id: data.id,

    organizationCode: data.organization_code,
    slug: data.slug,

    organizationName: data.organization_name,
    displayName: data.display_name,

    appTitle: data.app_title,
    appTagline: data.app_tagline,

    logoUrl: data.logo_url,
    faviconUrl: data.favicon_url,

    primaryColor: data.primary_color,
    secondaryColor: data.secondary_color,
    accentColor: data.accent_color,

    isActive: data.is_active,
  };

  return cachedTenant;
}

export function clearTenantCache() {
  cachedTenant = null;
}
