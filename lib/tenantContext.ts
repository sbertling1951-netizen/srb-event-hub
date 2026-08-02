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

export interface TenantPresentation {
  organizationName: string;
  displayName: string;
  appTitle: string;
  appTagline: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
}

export type TenantResolutionReason =
  | "missing_hostname"
  | "invalid_hostname"
  | "unknown_hostname"
  | "inactive_mapping"
  | "conflicting_mapping"
  | "inactive_tenant"
  | "internal_error";

export type TenantResolution =
  | {
      state: "resolved";
      source: "hostname_mapping";
      hostname: string;
      tenant: TenantContext;
    }
  | {
      state: "unresolved";
      hostname: string | null;
      reason: TenantResolutionReason;
    };

export function unresolvedTenant(
  reason: TenantResolutionReason,
  hostname: string | null = null,
): TenantResolution {
  return { state: "unresolved", reason, hostname };
}

export function toTenantPresentation(
  tenant: TenantContext | null,
): TenantPresentation | null {
  if (!tenant) {
    return null;
  }

  return {
    organizationName: tenant.organizationName,
    displayName: tenant.displayName,
    appTitle: tenant.appTitle,
    appTagline: tenant.appTagline,
    logoUrl: tenant.logoUrl,
    faviconUrl: tenant.faviconUrl,
    primaryColor: tenant.primaryColor,
    secondaryColor: tenant.secondaryColor,
    accentColor: tenant.accentColor,
  };
}
