import { supabase } from "@/lib/supabase";

export type EventProvisioningInput = {
  tenantId: string;
  name: string;
  endDate: string;
  timezone: string;
  startDate?: string | null;
  location?: string | null;
  eventCode?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type ProvisionedEvent = {
  id: string;
  tenant_id: string;
  name: string;
  location: string | null;
  start_date: string | null;
  end_date: string;
  timezone: string;
  event_code: string | null;
  status: string;
  is_active: boolean;
  visible_to_members: boolean;
  lat: number | null;
  lng: number | null;
  lifecycle_state: string;
  created_at: string;
};

type RpcError = { message: string };

export type EventProvisioningRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>;
};

const defaultClient = supabase as unknown as EventProvisioningRpcClient;

function optionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

export async function createEventForTenant(
  input: EventProvisioningInput,
  client: EventProvisioningRpcClient = defaultClient,
): Promise<ProvisionedEvent> {
  const { data, error } = await client.rpc("create_event_for_tenant", {
    p_tenant_id: input.tenantId,
    p_name: input.name.trim(),
    p_end_date: input.endDate,
    p_timezone: input.timezone.trim(),
    p_start_date: optionalText(input.startDate),
    p_location: optionalText(input.location),
    p_event_code: optionalText(input.eventCode),
    p_lat: input.lat ?? null,
    p_lng: input.lng ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row || typeof row !== "object" || !("id" in row)) {
    throw new Error("Event creation did not return the created Event.");
  }

  return row as ProvisionedEvent;
}
