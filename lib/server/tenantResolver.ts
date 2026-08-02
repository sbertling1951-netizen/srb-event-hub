import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";
import {
  type TenantContext,
  type TenantResolution,
  unresolvedTenant,
} from "@/lib/tenantContext";

type TenantRow = {
  id: string;
  organization_code: string;
  slug: string;
  organization_name: string;
  display_name: string;
  app_title: string;
  app_tagline: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  is_active: boolean;
};

type HostnameMappingRow = {
  hostname: string;
  tenant_id: string;
  is_active: boolean;
  tenants: TenantRow | TenantRow[] | null;
};

const DNS_HOSTNAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * Normalizes the Host header to the same lowercase DNS-hostname form governed
 * by public.tenant_hostname_mappings. Schemes, paths, whitespace, trailing
 * dots, IPv6 literals, and malformed ports are intentionally not accepted.
 */
export function normalizeRequestHostname(value: string | null): string | null {
  if (!value || value !== value.trim() || /\s/.test(value)) {
    return null;
  }

  const lowerValue = value.toLowerCase();

  if (
    lowerValue.includes("://") ||
    /[/?#\\]/.test(lowerValue) ||
    lowerValue.startsWith("[")
  ) {
    return null;
  }

  const colonIndex = lowerValue.lastIndexOf(":");
  let hostname = lowerValue;

  if (colonIndex !== -1) {
    if (lowerValue.indexOf(":") !== colonIndex) {
      return null;
    }

    const port = lowerValue.slice(colonIndex + 1);
    const portNumber = Number(port);

    if (
      !/^\d{1,5}$/.test(port) ||
      !Number.isInteger(portNumber) ||
      portNumber < 1 ||
      portNumber > 65535
    ) {
      return null;
    }

    hostname = lowerValue.slice(0, colonIndex);
  }

  if (
    hostname.length < 1 ||
    hostname.length > 253 ||
    hostname.endsWith(".") ||
    !DNS_HOSTNAME_PATTERN.test(hostname)
  ) {
    return null;
  }

  return hostname;
}

function toTenantContext(row: TenantRow): TenantContext {
  return {
    id: row.id,
    organizationCode: row.organization_code,
    slug: row.slug,
    organizationName: row.organization_name,
    displayName: row.display_name,
    appTitle: row.app_title,
    appTagline: row.app_tagline,
    logoUrl: row.logo_url,
    faviconUrl: row.favicon_url,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    accentColor: row.accent_color,
    isActive: row.is_active,
  };
}

/**
 * Resolves a Tenant only from the Host header received by Next.js. Until the
 * Nginx proxy contract is verified, X-Forwarded-Host is intentionally ignored:
 * a client-controlled forwarded header must never select Tenant context.
 * No development alias is configured, so local hosts remain unresolved unless
 * they are explicitly added to the governed hostname mapping source.
 */
export async function resolveTenantFromHeaders(
  requestHeaders: Headers,
): Promise<TenantResolution> {
  const hostname = normalizeRequestHostname(requestHeaders.get("host"));

  if (!requestHeaders.get("host")) {
    return unresolvedTenant("missing_hostname");
  }

  if (!hostname) {
    return unresolvedTenant("invalid_hostname");
  }

  try {
    const supabase = getSupabaseAdminClient();

    if (!supabase) {
      return unresolvedTenant("internal_error", hostname);
    }

    const { data, error } = await supabase
      .from("tenant_hostname_mappings")
      .select(
        "hostname, tenant_id, is_active, tenants!inner(id, organization_code, slug, organization_name, display_name, app_title, app_tagline, logo_url, favicon_url, primary_color, secondary_color, accent_color, is_active)",
      )
      .eq("hostname", hostname);

    if (error) {
      console.error("Unable to resolve Tenant hostname.", error);
      return unresolvedTenant("internal_error", hostname);
    }

    const mappings = (data || []) as HostnameMappingRow[];

    if (mappings.length === 0) {
      return unresolvedTenant("unknown_hostname", hostname);
    }

    if (mappings.length !== 1) {
      return unresolvedTenant("conflicting_mapping", hostname);
    }

    const mapping = mappings[0];

    if (!mapping.is_active) {
      return unresolvedTenant("inactive_mapping", hostname);
    }

    const tenant = Array.isArray(mapping.tenants)
      ? mapping.tenants[0] || null
      : mapping.tenants;

    if (!tenant) {
      return unresolvedTenant("internal_error", hostname);
    }

    if (!tenant.is_active) {
      return unresolvedTenant("inactive_tenant", hostname);
    }

    return {
      state: "resolved",
      source: "hostname_mapping",
      hostname,
      tenant: toTenantContext(tenant),
    };
  } catch (error) {
    console.error("Unexpected Tenant resolution failure.", error);
    return unresolvedTenant("internal_error", hostname);
  }
}

/**
 * React invalidates this cache for each server render. It is request-scoped
 * reuse only, never a mutable process-wide Tenant cache.
 */
export const resolveCurrentRequestTenant = cache(async () => {
  return resolveTenantFromHeaders(await headers());
});
