import { getCurrentTenant } from "@/lib/tenantContext";

export interface TenantBranding {
  organizationName: string;

  appTitle: string;
  appTagline: string | null;

  logoUrl: string | null;
  faviconUrl: string | null;

  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
}

export async function getCurrentTenantBranding(): Promise<TenantBranding | null> {
  const tenant = await getCurrentTenant();

  if (!tenant) {
    return null;
  }

  return {
    organizationName: tenant.organizationName,

    appTitle: tenant.appTitle,
    appTagline: tenant.appTagline,

    logoUrl: tenant.logoUrl,
    faviconUrl: tenant.faviconUrl,

    primaryColor: tenant.primaryColor,
    secondaryColor: tenant.secondaryColor,
    accentColor: tenant.accentColor,
  };
}
