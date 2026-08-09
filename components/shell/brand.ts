import type { ShellBrand } from "@/components/shell/types";
import type { TenantPresentation } from "@/lib/tenantContext";
import { DEFAULT_TENANT_LABELS } from "@/lib/tenantLabels";

/**
 * Maps already-resolved Tenant presentation (ADR-009) into the shell's
 * brand slot. Shared by every role adapter so brand-fallback logic exists
 * in exactly one place, matching root layout's own existing fallback
 * pattern (`tenant?.appTitle || DEFAULT_TENANT_LABELS.app_title`). This
 * does not resolve Tenant itself -- it only reshapes an already-resolved
 * `TenantPresentation` (from `useTenant()`) into `ShellBrand`.
 */
export function buildShellBrand(tenant: TenantPresentation | null): ShellBrand {
  return {
    title: tenant?.appTitle || DEFAULT_TENANT_LABELS.app_title,
    tagline: tenant?.appTagline || DEFAULT_TENANT_LABELS.app_tagline,
    logoUrl: tenant?.logoUrl || null,
    logoAlt: tenant?.displayName || "Event logo",
  };
}
