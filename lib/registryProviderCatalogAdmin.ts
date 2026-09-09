/**
 * Browser adapter for the Catalog P1 Platform-Admin Registry Provider
 * Catalog RPC surface (migration 20261008000000).
 *
 * Governed by
 * docs/architecture/EPICENTRAX_SHARED_REGISTRY_PROVIDER_CATALOG_CONTRACT.md
 * and docs/architecture/EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P1_IMPLEMENTATION_SPECIFICATION.md.
 *
 * This is P1 ONLY: a Platform-Admin curation workspace for a platform-owned
 * catalog. It is NOT organizer-facing. This module supplies no search,
 * browse, selection, snapshot, or private Registry Plan behavior of any
 * kind -- those are separate, later, separately gated slices. It never
 * imports from, calls, or references lib/organizerRegistryPlan.ts.
 *
 * PROVIDER WEBSITE IS INERT DISPLAY TEXT. This module never fetches, opens,
 * previews, unfurls, crawls, or health-checks a stored website value, and
 * renders no link, anchor, iframe, or image from it -- see the UI component,
 * which shows the URL as plain text only.
 *
 * The database RPCs remain the authoritative authorization and validation
 * boundary (Platform Administrator authority only, enforced server-side by
 * has_platform_admin_authority(auth.uid()) inside every RPC); this module
 * only keeps the admin page from constructing RPC argument objects ad hoc.
 */

import { supabase } from "@/lib/supabase";

type RpcError = { message: string };

export type RegistryProviderCatalogRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>;
};

const defaultClient = supabase as unknown as RegistryProviderCatalogRpcClient;

export type RegistryProviderCatalogAssetRow = {
  id: string;
  provider_name: string;
  short_description: string;
  public_website: string;
  is_active: boolean;
  revision: number;
  created_at: string;
  updated_at: string;
};

/** The three organizer-visible-in-future catalog fields, as an admin edits them. */
export type RegistryProviderCatalogAssetInput = {
  providerName: string;
  shortDescription: string;
  publicWebsite: string;
};

export function emptyRegistryProviderCatalogAssetInput(): RegistryProviderCatalogAssetInput {
  return { providerName: "", shortDescription: "", publicWebsite: "" };
}

export function registryProviderCatalogAssetValues(
  row: RegistryProviderCatalogAssetRow,
): RegistryProviderCatalogAssetInput {
  return {
    providerName: row.provider_name,
    shortDescription: row.short_description,
    publicWebsite: row.public_website,
  };
}

/** All three fields are required in P1 -- unlike the mostly-optional private-plan pattern. */
export function registryProviderCatalogAssetError(input: RegistryProviderCatalogAssetInput): string | null {
  if (!input.providerName.trim()) {
    return "Enter a provider name.";
  }
  if (input.providerName.trim().length > 200) {
    return "The provider name must be 200 characters or fewer.";
  }
  if (!input.shortDescription.trim()) {
    return "Enter a short public description.";
  }
  if (input.shortDescription.trim().length > 300) {
    return "The description must be 300 characters or fewer.";
  }
  if (!input.publicWebsite.trim()) {
    return "Enter the provider's public website.";
  }
  if (input.publicWebsite.trim().length > 500) {
    return "The website must be 500 characters or fewer.";
  }
  return null;
}

function firstRow<T>(data: unknown): T {
  const row = Array.isArray(data) ? data[0] : data;
  return row as T;
}

/** Maps a bare-sentinel RPC error to organizer/admin-facing copy without echoing raw content. */
function friendlyMessage(message: string): string {
  if (message === "stale_registry_provider_catalog_asset") {
    return "This entry changed since you loaded it. Reload and try again.";
  }
  if (message === "registry_provider_name_collision") {
    return "A provider with an equivalent name already exists. Resolve the collision manually before creating or renaming to this name.";
  }
  return message;
}

async function callOne<T>(
  name: string,
  args: Record<string, unknown>,
  client: RegistryProviderCatalogRpcClient,
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    throw new Error(friendlyMessage(error.message));
  }
  return firstRow<T>(data);
}

export async function listRegistryProviderCatalogAssetsForPlatformAdmin(
  client: RegistryProviderCatalogRpcClient = defaultClient,
): Promise<RegistryProviderCatalogAssetRow[]> {
  const { data, error } = await client.rpc("list_registry_provider_catalog_assets_for_platform_admin", {});
  if (error) {
    throw new Error(friendlyMessage(error.message));
  }
  // Every asset, active and inactive, in the server's alphabetical order --
  // and nothing derived: no count, no usage signal, no total.
  return Array.isArray(data) ? (data as RegistryProviderCatalogAssetRow[]) : [];
}

export async function createRegistryProviderCatalogAsset(
  input: RegistryProviderCatalogAssetInput,
  client: RegistryProviderCatalogRpcClient = defaultClient,
): Promise<RegistryProviderCatalogAssetRow> {
  const validationError = registryProviderCatalogAssetError(input);
  if (validationError) {
    throw new Error(validationError);
  }
  return callOne("create_registry_provider_catalog_asset", {
    p_provider_name: input.providerName.trim(),
    p_short_description: input.shortDescription.trim(),
    p_public_website: input.publicWebsite.trim(),
  }, client);
}

export async function updateRegistryProviderCatalogAsset(
  assetId: string,
  expectedRevision: number,
  input: RegistryProviderCatalogAssetInput,
  client: RegistryProviderCatalogRpcClient = defaultClient,
): Promise<RegistryProviderCatalogAssetRow> {
  const validationError = registryProviderCatalogAssetError(input);
  if (validationError) {
    throw new Error(validationError);
  }
  return callOne("update_registry_provider_catalog_asset", {
    p_asset_id: assetId,
    p_expected_revision: expectedRevision,
    p_provider_name: input.providerName.trim(),
    p_short_description: input.shortDescription.trim(),
    p_public_website: input.publicWebsite.trim(),
  }, client);
}

export async function setRegistryProviderCatalogAssetActiveStatus(
  assetId: string,
  expectedRevision: number,
  isActive: boolean,
  client: RegistryProviderCatalogRpcClient = defaultClient,
): Promise<RegistryProviderCatalogAssetRow> {
  return callOne("set_registry_provider_catalog_asset_active_status", {
    p_asset_id: assetId,
    p_expected_revision: expectedRevision,
    p_is_active: isActive,
  }, client);
}
