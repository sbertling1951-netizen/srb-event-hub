import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createRegistryProviderCatalogAsset,
  emptyRegistryProviderCatalogAssetInput,
  listRegistryProviderCatalogAssetsForPlatformAdmin,
  registryProviderCatalogAssetError,
  type RegistryProviderCatalogAssetInput,
  registryProviderCatalogAssetValues,
  type RegistryProviderCatalogRpcClient,
  setRegistryProviderCatalogAssetActiveStatus,
  updateRegistryProviderCatalogAsset,
} from "./registryProviderCatalogAdmin";

const adapterSource = readFileSync(
  fileURLToPath(new URL("./registryProviderCatalogAdmin.ts", import.meta.url)),
  "utf8",
);
/** Comments removed: the prose may name what is deliberately absent. */
const CODE = adapterSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const values: RegistryProviderCatalogAssetInput = {
  providerName: "Acme Gift Registry",
  shortDescription: "A general-purpose gift registry provider.",
  publicWebsite: "https://acme-registry.example.com",
};

function capturingClient(row: Record<string, unknown> = {}) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const client: RegistryProviderCatalogRpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: [{
          id: "a1", provider_name: "Acme Gift Registry",
          short_description: "A general-purpose gift registry provider.",
          public_website: "https://acme-registry.example.com",
          is_active: false, revision: 0,
          created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
          ...row,
        }],
        error: null,
      };
    },
  };
  return { client, calls };
}

test("P1 SCOPE: the module exports no organizer-facing search/select/snapshot behavior and never touches the private Registry Plan adapter", () => {
  assert.doesNotMatch(CODE, /organizerRegistryPlan|snapshot|selection|catalogAssetId|attachSelection/i);
  assert.doesNotMatch(CODE, /search|browse|typeahead|autocomplete/i);
});

test("ALL THREE FIELDS REQUIRED: an empty form is invalid on every field, and a fully blank form has no default content", () => {
  assert.deepEqual(emptyRegistryProviderCatalogAssetInput(), {
    providerName: "", shortDescription: "", publicWebsite: "",
  });
  assert.match(String(registryProviderCatalogAssetError(emptyRegistryProviderCatalogAssetInput())), /provider name/i);
  assert.match(
    String(registryProviderCatalogAssetError({ ...values, shortDescription: "" })),
    /description/i,
  );
  assert.match(
    String(registryProviderCatalogAssetError({ ...values, publicWebsite: "" })),
    /website/i,
  );
  assert.equal(registryProviderCatalogAssetError(values), null);
});

test("length bounds match the server's own bounds: 200 / 300 / 500", () => {
  assert.notEqual(registryProviderCatalogAssetError({ ...values, providerName: "x".repeat(201) }), null);
  assert.equal(registryProviderCatalogAssetError({ ...values, providerName: "x".repeat(200) }), null);
  assert.notEqual(registryProviderCatalogAssetError({ ...values, shortDescription: "x".repeat(301) }), null);
  assert.equal(registryProviderCatalogAssetError({ ...values, shortDescription: "x".repeat(300) }), null);
  assert.notEqual(registryProviderCatalogAssetError({ ...values, publicWebsite: "x".repeat(501) }), null);
  assert.equal(registryProviderCatalogAssetError({ ...values, publicWebsite: "x".repeat(500) }), null);
});

test("NO WEBSITE DEREFERENCE: the module never fetches, opens, or otherwise reaches the stored website", () => {
  assert.doesNotMatch(CODE, /fetch\(|window\.open|XMLHttpRequest|axios|new Image\(|<iframe/i);
});

test("create sends exactly the three trimmed fields; no is_active argument exists to smuggle an active row into existence", async () => {
  const { client, calls } = capturingClient();
  await createRegistryProviderCatalogAsset({
    providerName: "  Acme Gift Registry  ",
    shortDescription: "  A general-purpose gift registry provider.  ",
    publicWebsite: "  https://acme-registry.example.com  ",
  }, client);
  assert.equal(calls[0]?.name, "create_registry_provider_catalog_asset");
  assert.deepEqual(calls[0]?.args, {
    p_provider_name: "Acme Gift Registry",
    p_short_description: "A general-purpose gift registry provider.",
    p_public_website: "https://acme-registry.example.com",
  });
  assert.doesNotMatch(JSON.stringify(calls[0]?.args), /is_active|p_is_active/);
});

test("update sends the asset id and expected revision alongside the three fields", async () => {
  const { client, calls } = capturingClient({ revision: 1 });
  await updateRegistryProviderCatalogAsset("a1", 0, values, client);
  assert.equal(calls[0]?.name, "update_registry_provider_catalog_asset");
  assert.deepEqual(calls[0]?.args, {
    p_asset_id: "a1",
    p_expected_revision: 0,
    p_provider_name: "Acme Gift Registry",
    p_short_description: "A general-purpose gift registry provider.",
    p_public_website: "https://acme-registry.example.com",
  });
});

test("activate/deactivate sends only the id, expected revision, and target status -- no display-field argument", async () => {
  const { client, calls } = capturingClient({ is_active: true, revision: 1 });
  const saved = await setRegistryProviderCatalogAssetActiveStatus("a1", 0, true, client);
  assert.equal(calls[0]?.name, "set_registry_provider_catalog_asset_active_status");
  assert.deepEqual(calls[0]?.args, { p_asset_id: "a1", p_expected_revision: 0, p_is_active: true });
  assert.equal(saved.is_active, true);
});

test("a stale-revision RPC error and a name-collision RPC error surface as plain sentences, not the raw bare sentinel", async () => {
  const staleClient: RegistryProviderCatalogRpcClient = {
    async rpc() {
      return { data: null, error: { message: "stale_registry_provider_catalog_asset" } };
    },
  };
  await assert.rejects(
    () => updateRegistryProviderCatalogAsset("a1", 0, values, staleClient),
    /changed since you loaded it/i,
  );

  const collisionClient: RegistryProviderCatalogRpcClient = {
    async rpc() {
      return { data: null, error: { message: "registry_provider_name_collision" } };
    },
  };
  await assert.rejects(
    () => createRegistryProviderCatalogAsset(values, collisionClient),
    /equivalent name already exists/i,
  );
});

test("an invalid form never reaches the network", async () => {
  const { client, calls } = capturingClient();
  await assert.rejects(
    () => createRegistryProviderCatalogAsset({ ...values, providerName: "" }, client),
    /provider name/i,
  );
  await assert.rejects(
    () => updateRegistryProviderCatalogAsset("a1", 0, { ...values, publicWebsite: "" }, client),
    /website/i,
  );
  assert.equal(calls.length, 0, "no RPC call was attempted for an invalid form");
});

test("list returns rows only -- an empty response is an empty list, nothing invented", async () => {
  for (const data of [[], null, undefined]) {
    const client: RegistryProviderCatalogRpcClient = {
      async rpc() {
        return { data, error: null };
      },
    };
    assert.deepEqual(await listRegistryProviderCatalogAssetsForPlatformAdmin(client), []);
  }
});

test("NO AGGREGATION: the module exports no total, count, or usage helper", () => {
  assert.doesNotMatch(CODE, /\btotal\b|\bcount\b|\bsum\b|remaining|usage|whereUsed|referenceCount/i);
  assert.doesNotMatch(CODE, /\.reduce\(|\+=/);
});

test("registryProviderCatalogAssetValues round-trips a row into editable form values", () => {
  assert.deepEqual(
    registryProviderCatalogAssetValues({
      id: "a1", provider_name: "Acme Gift Registry",
      short_description: "A general-purpose gift registry provider.",
      public_website: "https://acme-registry.example.com",
      is_active: false, revision: 0,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    }),
    values,
  );
});
