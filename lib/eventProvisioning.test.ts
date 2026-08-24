import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createEventForTenant,
  type EventProvisioningRpcClient,
  type ProvisionedEvent,
} from "@/lib/eventProvisioning";

const CREATED: ProvisionedEvent = {
  id: "event-1",
  tenant_id: "tenant-1",
  name: "Spring Event",
  location: null,
  start_date: null,
  end_date: "2027-04-30",
  timezone: "America/Chicago",
  event_code: null,
  status: "Draft",
  is_active: false,
  visible_to_members: false,
  lat: 0,
  lng: 0,
  lifecycle_state: "operational",
  created_at: "2026-08-24T00:00:00Z",
};

test("create maps only the governed typed contract and preserves false/zero", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: EventProvisioningRpcClient = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: [CREATED], error: null });
    },
  };

  const result = await createEventForTenant(
    {
      tenantId: "tenant-1",
      name: "  Spring Event  ",
      endDate: "2027-04-30",
      timezone: "  America/Chicago  ",
      startDate: "",
      location: "  ",
      eventCode: "",
      lat: 0,
      lng: 0,
    },
    client,
  );

  assert.deepEqual(calls, [
    {
      name: "create_event_for_tenant",
      args: {
        p_tenant_id: "tenant-1",
        p_name: "Spring Event",
        p_end_date: "2027-04-30",
        p_timezone: "America/Chicago",
        p_start_date: null,
        p_location: null,
        p_event_code: null,
        p_lat: 0,
        p_lng: 0,
      },
    },
  ]);
  assert.equal(result, CREATED);
  assert.equal(result.is_active, false);
  assert.equal(result.lat, 0);
});

test("create surfaces the governed RPC error without a fallback write", async () => {
  const client: EventProvisioningRpcClient = {
    rpc() {
      return Promise.resolve({
        data: null,
        error: { message: "Owning Tenant must be active." },
      });
    },
  };

  await assert.rejects(
    createEventForTenant(
      {
        tenantId: "tenant-1",
        name: "Event",
        endDate: "2027-04-30",
        timezone: "UTC",
      },
      client,
    ),
    /Owning Tenant must be active/,
  );
});

test("create rejects an empty authoritative result", async () => {
  const client: EventProvisioningRpcClient = {
    rpc() {
      return Promise.resolve({ data: [], error: null });
    },
  };

  await assert.rejects(
    createEventForTenant(
      {
        tenantId: "tenant-1",
        name: "Event",
        endDate: "2027-04-30",
        timezone: "UTC",
      },
      client,
    ),
    /did not return the created Event/,
  );
});
