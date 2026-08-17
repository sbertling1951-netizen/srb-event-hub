import { supabase } from "@/lib/supabase";

export type TenantAdminAccessRow = {
  id: string;
  admin_user_id: string;
  tenant_id: string;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
};

type RpcError = { message: string };

export type TenantAdminRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>;
};

const defaultClient = supabase as unknown as TenantAdminRpcClient;

export async function listTenantAdminAccess(
  tenantId: string,
  client: TenantAdminRpcClient = defaultClient,
): Promise<TenantAdminAccessRow[]> {
  const { data, error } = await client.rpc("list_tenant_admin_access", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as TenantAdminAccessRow[];
}

export async function setTenantAdminAccess(
  adminUserId: string,
  tenantId: string,
  isActive: boolean,
  client: TenantAdminRpcClient = defaultClient,
): Promise<void> {
  const { error } = await client.rpc("set_tenant_admin_access", {
    p_admin_user_id: adminUserId,
    p_tenant_id: tenantId,
    p_is_active: isActive,
    p_granted_by: null,
  });

  if (error) {
    throw new Error(error.message);
  }
}