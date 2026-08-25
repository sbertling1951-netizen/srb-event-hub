import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addTenantHostnameMapping,
  buildTenantMetadataPatch,
  createTenantForAdministration,
  type CreateTenantInput,
  getTenantForAdministration,
  listEligiblePersonTenantAdministratorCandidatesForAdministration,
  listTenantAdministrationAudit,
  listTenantAdministratorAppointmentAuditForAdministration,
  listTenantAdministratorAppointmentsForAdministration,
  listTenantHostnameMappingsForAdministration,
  listTenantOwnedEventsForAdministration,
  listTenantsForAdministration,
  setPersonTenantAdministratorAppointment,
  setTenantActiveStatus,
  setTenantHostnameMappingActiveStatus,
  type TenantAdministrationRpcClient,
  updateTenantMetadataForAdministration,
} from "@/lib/tenantAdministration";

function fakeClient(data: unknown = []): {
  client: TenantAdministrationRpcClient;
  calls: Array<{ name: string; args: Record<string, unknown> | undefined }>;
} {
  const calls: Array<{ name: string; args: Record<string, unknown> | undefined }> = [];
  return {
    calls,
    client: {
      rpc(name, args) {
        calls.push({ name, args });
        return Promise.resolve({ data, error: null });
      },
    },
  };
}

const CREATE_INPUT: CreateTenantInput = {
  organization_code: " NEW ",
  slug: " New-Tenant ",
  organization_name: " New Organization ",
  display_name: " New Tenant ",
  app_title: " New App ",
  app_tagline: " ",
  logo_url: " https://example.test/logo.png ",
  favicon_url: "",
  primary_color: " #111111 ",
  secondary_color: "",
  accent_color: " #ffffff ",
  tenant_type_id: "",
  post_event_edit_window_days: "0",
  reason: " Initial setup ",
};

test("all administrative reads use the exact governed T3 RPCs", async () => {
  const { client, calls } = fakeClient([]);
  await listTenantsForAdministration(client);
  await getTenantForAdministration("tenant-1", client);
  await listTenantHostnameMappingsForAdministration("tenant-1", client);
  await listEligiblePersonTenantAdministratorCandidatesForAdministration(client);
  await listTenantAdministratorAppointmentsForAdministration("tenant-1", client);
  await listTenantAdministratorAppointmentAuditForAdministration("tenant-1", 75, client);
  await listTenantOwnedEventsForAdministration("tenant-1", client);
  await listTenantAdministrationAudit("tenant-1", 75, client);

  assert.deepEqual(
    calls.map((call) => call.name),
    [
      "list_tenants_for_administration",
      "get_tenant_for_administration",
      "list_tenant_hostname_mappings_for_administration",
      "list_eligible_person_tenant_administrator_candidates_for_admini",
      "list_tenant_administrator_appointments_for_administration",
      "list_person_tenant_administrator_appointment_audit_for_administration",
      "list_tenant_owned_events_for_administration",
      "list_tenant_administration_audit",
    ],
  );
  assert.deepEqual(calls[3]?.args, {});
  assert.deepEqual(calls[4]?.args, { p_tenant_id: "tenant-1" });
  assert.deepEqual(calls[5]?.args, { p_tenant_id: "tenant-1", p_limit: 75 });
  assert.deepEqual(calls.at(-1)?.args, { p_tenant_id: "tenant-1", p_limit: 75 });
});

test("Person-backed appointment lifecycle uses only the governed T8 command", async () => {
  const { client, calls } = fakeClient(null);
  await setPersonTenantAdministratorAppointment(
    "person-1",
    "tenant-1",
    true,
    " appointment ",
    client,
  );

  assert.deepEqual(calls, [{
    name: "set_person_tenant_administrator_appointment",
    args: {
      p_person_id: "person-1",
      p_tenant_id: "tenant-1",
      p_is_active: true,
      p_reason: "appointment",
    },
  }]);
});

test("create maps only the governed contract, normalizes nullable values, and cannot request Active", async () => {
  const { client, calls } = fakeClient({ id: "tenant-new" });
  await createTenantForAdministration(CREATE_INPUT, client);

  assert.equal(calls[0].name, "create_tenant_for_administration");
  assert.deepEqual(calls[0].args, {
    p_organization_code: "NEW",
    p_slug: "new-tenant",
    p_organization_name: "New Organization",
    p_display_name: "New Tenant",
    p_app_title: "New App",
    p_app_tagline: null,
    p_logo_url: "https://example.test/logo.png",
    p_favicon_url: null,
    p_primary_color: "#111111",
    p_secondary_color: null,
    p_accent_color: "#ffffff",
    p_tenant_type_id: null,
    p_post_event_edit_window_days: 0,
    p_reason: "Initial setup",
  });
  assert.equal("p_is_active" in (calls[0].args || {}), false);
});

test("metadata update emits the exact allowlist and preserves explicit zero/null semantics", async () => {
  const { client, calls } = fakeClient({ id: "tenant-1" });
  const metadata = {
    organization_name: "Organization",
    display_name: "Tenant",
    app_title: "App",
    app_tagline: "",
    logo_url: "",
    favicon_url: "",
    primary_color: "",
    secondary_color: "",
    accent_color: "",
    tenant_type_id: "",
    post_event_edit_window_days: "0",
  };

  assert.deepEqual(buildTenantMetadataPatch(metadata), {
    organization_name: "Organization",
    display_name: "Tenant",
    app_title: "App",
    app_tagline: null,
    logo_url: null,
    favicon_url: null,
    primary_color: null,
    secondary_color: null,
    accent_color: null,
    tenant_type_id: null,
    post_event_edit_window_days: 0,
  });
  await updateTenantMetadataForAdministration("tenant-1", metadata, " correction ", client);
  assert.equal(calls[0].name, "update_tenant_metadata_for_administration");
  assert.deepEqual(calls[0].args, {
    p_tenant_id: "tenant-1",
    p_patch: buildTenantMetadataPatch(metadata),
    p_reason: "correction",
  });
});

test("lifecycle and hostname commands remain separate governed T3 operations", async () => {
  const { client, calls } = fakeClient({ id: "result" });
  await setTenantActiveStatus("tenant-1", false, " pause ", client);
  await addTenantHostnameMapping("tenant-1", " Example.COM ", true, " alias ", client);
  await setTenantHostnameMappingActiveStatus("mapping-1", false, "", client);

  assert.deepEqual(calls, [
    {
      name: "set_tenant_active_status",
      args: { p_tenant_id: "tenant-1", p_is_active: false, p_reason: "pause" },
    },
    {
      name: "add_tenant_hostname_mapping",
      args: {
        p_tenant_id: "tenant-1",
        p_hostname: "example.com",
        p_is_active: true,
        p_reason: "alias",
      },
    },
    {
      name: "set_tenant_hostname_mapping_active_status",
      args: { p_mapping_id: "mapping-1", p_is_active: false, p_reason: null },
    },
  ]);
});

test("RPC failures surface without fallback writes", async () => {
  const client: TenantAdministrationRpcClient = {
    rpc() {
      return Promise.resolve({ data: null, error: { message: "governed denial" } });
    },
  };
  await assert.rejects(listTenantsForAdministration(client), /governed denial/);
});
