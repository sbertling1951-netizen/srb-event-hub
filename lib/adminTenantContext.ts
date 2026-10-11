import { STORAGE_KEYS } from "@/lib/storageKeys";

export type AdminTenantChoice = { id: string; name: string; isActive: boolean };
type StoredTenant = { userId: string; tenantId: string };
const EMPTY_TENANT_ID = "00000000-0000-0000-0000-000000000000";

// Workspace selection is a UI scope, never an authority grant. Server RPCs
// and RLS continue to authorize the authenticated caller independently.
export function readAdminTenantSelection(): StoredTenant | null {
  if (typeof window === "undefined") { return null; }
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.adminTenantContext);
    const value = raw ? JSON.parse(raw) : null;
    return typeof value?.userId === "string" && typeof value?.tenantId === "string"
      ? value : null;
  } catch { return null; }
}

export function resolveAdminTenantSelection(
  choices: AdminTenantChoice[], userId: string,
  stored: StoredTenant | null, establishedEventTenantId: string | null,
): AdminTenantChoice | null {
  // A revoked/stale explicit choice requires a new deliberate selection.
  // Existing browsers may adopt the owner of their SAME established Event.
  const id = stored ? (stored.userId === userId ? stored.tenantId : null) : establishedEventTenantId;
  return choices.find((choice) => choice.id === id) ?? null;
}

export function writeAdminTenantSelection(userId: string, tenantId: string): void {
  localStorage.setItem(STORAGE_KEYS.adminTenantContext, JSON.stringify({ userId, tenantId }));
}

// No selection yields an empty query, never an all-Tenant fallback.
export function getAdminTenantFilterId(): string {
  return readAdminTenantSelection()?.tenantId ?? EMPTY_TENANT_ID;
}

export function canEnterAdminTenantWorkspace({
  platformPage, tenant, eventChoicePage, eventValid,
}: {
  platformPage: boolean;
  tenant: AdminTenantChoice | null;
  eventChoicePage: boolean;
  eventValid: boolean;
}): boolean {
  return platformPage || (!!tenant?.isActive && (eventChoicePage || eventValid));
}
