import assert from "node:assert/strict";
import { test } from "node:test";

import {
  listTenantAdminAccess,
  setTenantAdminAccess,
  type TenantAdminRpcClient,
} from "@/lib/tenantAdminAccess";

function fakeClient(
  response: { data: unknown; error: { message: string } | null },
  calls: Array<{ name: string; args: Record<string, unknown> }>,
): TenantAdminRpcClient {
  return {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve(response);
    },
  };
}

test("lists Tenant Admin assignments through the governed RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rows = [{
    id: "access-1",
    admin_user_id: "admin-1",
    tenant_id: "tenant-1",
    is_active: true,
    created_at: "2026-08-16T00:00:00Z",
    created_by: "actor-1",
  }];

  assert.deepEqual(
    await listTenantAdminAccess(
      "tenant-1",
      fakeClient({ data: rows, error: null }, calls),
    ),
    rows,
  );
  assert.deepEqual(calls, [{
    name: "list_tenant_admin_access",
    args: { p_tenant_id: "tenant-1" },
  }]);
});

test("an empty governed list remains a true empty state", async () => {
  const rows = await listTenantAdminAccess(
    "tenant-1",
    fakeClient({ data: [], error: null }, []),
  );
  assert.deepEqual(rows, []);
});

test("assignment and removal use the same governed setter with explicit state", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = fakeClient({ data: null, error: null }, calls);

  await setTenantAdminAccess("admin-1", "tenant-1", true, client);
  await setTenantAdminAccess("admin-1", "tenant-1", false, client);

  assert.deepEqual(calls, [
    {
      name: "set_tenant_admin_access",
      args: {
        p_admin_user_id: "admin-1",
        p_tenant_id: "tenant-1",
        p_is_active: true,
        p_granted_by: null,
      },
    },
    {
      name: "set_tenant_admin_access",
      args: {
        p_admin_user_id: "admin-1",
        p_tenant_id: "tenant-1",
        p_is_active: false,
        p_granted_by: null,
      },
    },
  ]);
});

test("governed RPC failures remain failures for explicit UI presentation", async () => {
  const client = fakeClient({
    data: null,
    error: { message: "caller is not an active super_admin" },
  }, []);

  await assert.rejects(
    () => listTenantAdminAccess("tenant-1", client),
    /caller is not an active super_admin/,
  );
  await assert.rejects(
    () => setTenantAdminAccess("admin-1", "tenant-1", true, client),
    /caller is not an active super_admin/,
  );
});