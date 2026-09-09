import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  addMyPrivateDraftRegistryPlan,
  attachMyPrivateDraftRegistryPlanCatalogSelection,
  type CatalogSearchResult,
  deleteMyPrivateDraftRegistryPlan,
  detachMyPrivateDraftRegistryPlanCatalogSelection,
  emptyRegistryPlan,
  isRegistryPlanStatus,
  listMyPrivateDraftRegistryPlans,
  listMyPrivateDraftRegistryPlansWithCatalog,
  type OrganizerRegistryPlanRpcClient,
  REGISTRY_PLAN_STATUSES,
  RegistryCatalogIdentityResolutionRequiredError,
  type RegistryPlanEntryWithCatalog,
  registryPlanError,
  type RegistryPlanInput,
  registryPlanValues,
  searchMyPrivateDraftRegistryProviderCatalog,
  updateMyPrivateDraftRegistryPlan,
} from "./organizerRegistryPlan";

const REAL_URL = "https://registry.example.invalid/list?id=abc-123&ref=share%20token";
const NOT_A_URL = "the shop on Main Street, ask at the counter";

const values: RegistryPlanInput = {
  providerName: "Riverbend Home Store",
  registryUrl: REAL_URL,
  status: "contacted",
  note: "Still adding items",
};

test("exactly the three approved statuses exist", () => {
  assert.deepEqual([...REGISTRY_PLAN_STATUSES], ["considering", "contacted", "selected"]);
  for (const s of REGISTRY_PLAN_STATUSES) {
    assert.equal(isRegistryPlanStatus(s), true);
  }
  for (const bad of ["created", "published", "connected", "Selected", "", null, undefined, 3]) {
    assert.equal(isRegistryPlanStatus(bad), false, `${String(bad)} must not be a status`);
  }
});

test("registryPlanError requires a name and leaves URL and note optional", () => {
  assert.equal(registryPlanError(values), null);
  assert.equal(registryPlanError({ ...values, registryUrl: "", note: "" }), null);
  assert.equal(registryPlanError({ ...emptyRegistryPlan(), providerName: "Corner shop" }), null);
  assert.match(registryPlanError({ ...values, providerName: "  " }) ?? "", /Enter a name for this registry/);
  assert.match(registryPlanError({ ...values, providerName: "x".repeat(201) }) ?? "", /200 characters or fewer/);
  assert.match(registryPlanError({ ...values, registryUrl: "x".repeat(2001) }) ?? "", /link must be 2000/);
  assert.match(registryPlanError({ ...values, note: "x".repeat(2001) }) ?? "", /note must be 2000/);
});

test("registryPlanError rejects a status outside the approved three", () => {
  const bad = { ...values, status: "published" } as unknown as RegistryPlanInput;
  assert.match(registryPlanError(bad) ?? "", /considering, contacted, or selected/);
});

test("THE URL IS NOT VALIDATED AS A URL -- a plain sentence is accepted", () => {
  // format-checking is the first step toward dereferencing, so there is none
  assert.equal(registryPlanError({ ...values, registryUrl: NOT_A_URL }), null);
  assert.equal(registryPlanError({ ...values, registryUrl: "ftp://weird" }), null);
  assert.equal(registryPlanError({ ...values, registryUrl: "javascript:alert(1)" }), null);
  assert.equal(registryPlanError({ ...values, registryUrl: "just some words" }), null);
});

test("emptyRegistryPlan / registryPlanValues shape and prefill", () => {
  assert.deepEqual(emptyRegistryPlan(), {
    providerName: "",
    registryUrl: "",
    status: "considering",
    note: "",
  });
  assert.deepEqual(
    registryPlanValues({
      id: "r1",
      providerName: "Corner shop",
      registryUrl: null,
      planningStatus: "selected",
      organizerNote: "Ask for Dana",
    }),
    { providerName: "Corner shop", registryUrl: "", status: "selected", note: "Ask for Dana" },
  );
});

test("listMyPrivateDraftRegistryPlans parses rows and surfaces a not-found error verbatim", async () => {
  const ok: OrganizerRegistryPlanRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "list_my_private_draft_registry_plans");
      assert.deepEqual(args, { p_event_id: "e1" });
      return {
        data: [
          {
            id: "r1",
            provider_name: "Riverbend Home Store",
            registry_url: REAL_URL,
            planning_status: "contacted",
            organizer_note: null,
          },
        ],
        error: null,
      };
    },
  };
  assert.deepEqual(await listMyPrivateDraftRegistryPlans(ok, "e1"), [
    {
      id: "r1",
      providerName: "Riverbend Home Store",
      registryUrl: REAL_URL,
      planningStatus: "contacted",
      organizerNote: null,
    },
  ]);

  const denied: OrganizerRegistryPlanRpcClient = {
    async rpc() {
      return { data: null, error: { message: "Draft not found." } };
    },
  };
  await assert.rejects(() => listMyPrivateDraftRegistryPlans(denied, "e1"), /Draft not found\./);
  await assert.rejects(() => listMyPrivateDraftRegistryPlans(ok, ""), /Choose a draft to plan\./);
});

test("an unrecognized status from the server falls back to considering", async () => {
  const odd: OrganizerRegistryPlanRpcClient = {
    async rpc() {
      return { data: [{ id: "r1", provider_name: "X", planning_status: "published" }], error: null };
    },
  };
  const [entry] = await listMyPrivateDraftRegistryPlans(odd, "e1");
  assert.equal(entry.planningStatus, "considering");
});

test("add sends exactly the five planning arguments, trimming blanks to null", async () => {
  const client: OrganizerRegistryPlanRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "add_my_private_draft_registry_plan");
      assert.deepEqual(args, {
        p_event_id: "e1",
        p_provider_name: "Corner shop",
        p_registry_url: null,
        p_planning_status: "considering",
        p_organizer_note: null,
      });
      return { data: [{ id: "r2", provider_name: "Corner shop", planning_status: "considering" }], error: null };
    },
  };
  const entry = await addMyPrivateDraftRegistryPlan(client, {
    eventId: "e1",
    values: { ...emptyRegistryPlan(), providerName: "  Corner shop  " },
  });
  assert.equal(entry.id, "r2");
});

test("THE URL IS SENT BYTE-FOR-BYTE -- trimmed only, never normalized or encoded", async () => {
  for (const raw of [REAL_URL, NOT_A_URL, "HTTP://Mixed.Case/Path?a=1&b=2#frag"]) {
    let sent: Record<string, unknown> | undefined;
    const client: OrganizerRegistryPlanRpcClient = {
      async rpc(_name, args) {
        sent = args;
        return { data: [{ id: "r1", provider_name: "X", planning_status: "considering" }], error: null };
      },
    };
    await addMyPrivateDraftRegistryPlan(client, {
      eventId: "e1",
      values: { ...emptyRegistryPlan(), providerName: "X", registryUrl: `  ${raw}  ` },
    });
    assert.equal(sent?.p_registry_url, raw, `stored exactly as typed: ${raw}`);
  }
});

test("the adapter makes NO outbound request of its own -- only the four RPCs", () => {
  // the module never reaches the network except through the supplied rpc client
  const rpcNames: string[] = [];
  const client: OrganizerRegistryPlanRpcClient = {
    async rpc(name) {
      rpcNames.push(name);
      return { data: [{ id: "r1", provider_name: "X", planning_status: "considering" }], error: null };
    },
  };
  return (async () => {
    await listMyPrivateDraftRegistryPlans(client, "e1");
    await addMyPrivateDraftRegistryPlan(client, {
      eventId: "e1",
      values: { ...emptyRegistryPlan(), providerName: "X", registryUrl: REAL_URL },
    });
    await updateMyPrivateDraftRegistryPlan(client, {
      eventId: "e1",
      registryPlanId: "r1",
      values: { ...emptyRegistryPlan(), providerName: "X", registryUrl: REAL_URL },
    });
    await deleteMyPrivateDraftRegistryPlan(client, { eventId: "e1", registryPlanId: "r1" });
    assert.deepEqual(rpcNames.sort(), [
      "add_my_private_draft_registry_plan",
      "delete_my_private_draft_registry_plan",
      "list_my_private_draft_registry_plans",
      "update_my_private_draft_registry_plan",
    ]);
  })();
});

test("add / update validate before touching the network", async () => {
  const exploding: OrganizerRegistryPlanRpcClient = {
    async rpc() {
      throw new Error("the adapter must not call the server on invalid input");
    },
  };
  await assert.rejects(
    () => addMyPrivateDraftRegistryPlan(exploding, { eventId: "e1", values: emptyRegistryPlan() }),
    /Enter a name for this registry/,
  );
  await assert.rejects(
    () =>
      updateMyPrivateDraftRegistryPlan(exploding, {
        eventId: "e1",
        registryPlanId: "r1",
        values: emptyRegistryPlan(),
      }),
    /Enter a name for this registry/,
  );
});

test("update targets one entry by id and delete returns the removed id", async () => {
  const client: OrganizerRegistryPlanRpcClient = {
    async rpc(name, args) {
      if (name === "update_my_private_draft_registry_plan") {
        assert.equal((args ?? {}).p_registry_plan_id, "r1");
        assert.equal((args ?? {}).p_planning_status, "selected");
        return { data: [{ id: "r1", provider_name: "Riverbend Home Store", planning_status: "selected" }], error: null };
      }
      assert.equal(name, "delete_my_private_draft_registry_plan");
      assert.deepEqual(args, { p_event_id: "e1", p_registry_plan_id: "r1" });
      return { data: [{ deleted_id: "r1" }], error: null };
    },
  };
  const updated = await updateMyPrivateDraftRegistryPlan(client, {
    eventId: "e1",
    registryPlanId: "r1",
    values: { ...values, status: "selected" },
  });
  assert.equal(updated.planningStatus, "selected");
  assert.deepEqual(await deleteMyPrivateDraftRegistryPlan(client, { eventId: "e1", registryPlanId: "r1" }), {
    deletedId: "r1",
  });
});

test("a server error on delete is surfaced, never swallowed", async () => {
  const failing: OrganizerRegistryPlanRpcClient = {
    async rpc() {
      return { data: null, error: { message: "Registry plan entry not found." } };
    },
  };
  await assert.rejects(
    () => deleteMyPrivateDraftRegistryPlan(failing, { eventId: "e1", registryPlanId: "r9" }),
    /Registry plan entry not found\./,
  );
});

// ===========================================================================
// Catalog P2: search / attach / detach / catalog-aware list
// ===========================================================================

test("search never calls the network for a blank or single-character query, and trims first", async () => {
  const calls: string[] = [];
  const client: OrganizerRegistryPlanRpcClient = {
    async rpc(name) {
      calls.push(name);
      return { data: [], error: null };
    },
  };
  assert.deepEqual(await searchMyPrivateDraftRegistryProviderCatalog(client, { eventId: "e1", query: "" }), []);
  assert.deepEqual(await searchMyPrivateDraftRegistryProviderCatalog(client, { eventId: "e1", query: "a" }), []);
  assert.deepEqual(await searchMyPrivateDraftRegistryProviderCatalog(client, { eventId: "e1", query: " " }), []);
  assert.deepEqual(calls, [], "no RPC call for a query shorter than two characters");

  const spy: OrganizerRegistryPlanRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "search_my_private_draft_registry_provider_catalog");
      assert.deepEqual(args, { p_event_id: "e1", p_query: "ac" });
      return { data: [], error: null };
    },
  };
  await searchMyPrivateDraftRegistryProviderCatalog(spy, { eventId: "e1", query: "  ac  " });
});

test("search parses rows into exactly the four card fields", async () => {
  const client: OrganizerRegistryPlanRpcClient = {
    async rpc() {
      return {
        data: [
          { id: "a1", provider_name: "Acme Gift Registry", short_description: "A registry.", public_website: "https://acme.example.com" },
        ],
        error: null,
      };
    },
  };
  const results = await searchMyPrivateDraftRegistryProviderCatalog(client, { eventId: "e1", query: "ac" });
  assert.deepEqual(results, [
    { id: "a1", providerName: "Acme Gift Registry", shortDescription: "A registry.", publicWebsite: "https://acme.example.com" },
  ] satisfies CatalogSearchResult[]);
});

test("attach sends exactly the three ids and never a display field", async () => {
  const client: OrganizerRegistryPlanRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "attach_my_private_draft_registry_plan_catalog_selection");
      assert.deepEqual(args, { p_event_id: "e1", p_registry_plan_id: "r1", p_catalog_asset_id: "a1" });
      return {
        data: [{
          id: "r1", provider_name: "Aunt Ruth's barn", registry_url: null, planning_status: "considering", organizer_note: null,
          catalog_asset_id: "a1", catalog_provider_name_snapshot: "Acme Gift Registry",
          catalog_description_snapshot: "A registry.", catalog_website_snapshot: "https://acme.example.com",
        }],
        error: null,
      };
    },
  };
  const entry = await attachMyPrivateDraftRegistryPlanCatalogSelection(client, {
    eventId: "e1", registryPlanId: "r1", catalogAssetId: "a1",
  });
  assert.equal(entry.providerName, "Aunt Ruth's barn", "the organizer's own typed name is preserved");
  assert.deepEqual(entry.catalog, {
    catalogAssetId: "a1", providerName: "Acme Gift Registry",
    shortDescription: "A registry.", publicWebsite: "https://acme.example.com",
  });
});

test("detach sends only the two ids and clears the catalog field on the returned entry", async () => {
  const client: OrganizerRegistryPlanRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "detach_my_private_draft_registry_plan_catalog_selection");
      assert.deepEqual(args, { p_event_id: "e1", p_registry_plan_id: "r1" });
      return {
        data: [{
          id: "r1", provider_name: "Aunt Ruth's barn", registry_url: null, planning_status: "considering", organizer_note: null,
          catalog_asset_id: null, catalog_provider_name_snapshot: null,
          catalog_description_snapshot: null, catalog_website_snapshot: null,
        }],
        error: null,
      };
    },
  };
  const entry = await detachMyPrivateDraftRegistryPlanCatalogSelection(client, { eventId: "e1", registryPlanId: "r1" });
  assert.equal(entry.catalog, null);
  assert.equal(entry.providerName, "Aunt Ruth's barn");
});

test("listMyPrivateDraftRegistryPlansWithCatalog exposes catalog: null when unattached, and the snapshot when attached", async () => {
  const client: OrganizerRegistryPlanRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "list_my_private_draft_registry_plans_with_catalog");
      assert.deepEqual(args, { p_event_id: "e1" });
      return {
        data: [
          {
            id: "r1", provider_name: "No selection", registry_url: null, planning_status: "considering", organizer_note: null,
            catalog_asset_id: null, catalog_provider_name_snapshot: null, catalog_description_snapshot: null, catalog_website_snapshot: null,
          },
          {
            id: "r2", provider_name: "Has selection", registry_url: null, planning_status: "selected", organizer_note: null,
            catalog_asset_id: "a1", catalog_provider_name_snapshot: "Acme", catalog_description_snapshot: "d", catalog_website_snapshot: "https://a.example.com",
          },
        ],
        error: null,
      };
    },
  };
  const rows = await listMyPrivateDraftRegistryPlansWithCatalog(client, "e1");
  assert.equal(rows[0]?.catalog, null);
  assert.deepEqual(rows[1]?.catalog, {
    catalogAssetId: "a1", providerName: "Acme", shortDescription: "d", publicWebsite: "https://a.example.com",
  } satisfies RegistryPlanEntryWithCatalog["catalog"]);
});

test("identity_resolution_required surfaces as a typed, catchable error on all four Catalog P2 calls", async () => {
  const client: OrganizerRegistryPlanRpcClient = {
    async rpc() {
      return { data: null, error: { message: "identity_resolution_required" } };
    },
  };
  for (const attempt of [
    () => searchMyPrivateDraftRegistryProviderCatalog(client, { eventId: "e1", query: "ac" }),
    () => listMyPrivateDraftRegistryPlansWithCatalog(client, "e1"),
    () => attachMyPrivateDraftRegistryPlanCatalogSelection(client, { eventId: "e1", registryPlanId: "r1", catalogAssetId: "a1" }),
    () => detachMyPrivateDraftRegistryPlanCatalogSelection(client, { eventId: "e1", registryPlanId: "r1" }),
  ]) {
    await assert.rejects(attempt, (error: unknown) => error instanceof RegistryCatalogIdentityResolutionRequiredError);
  }
});

test("registry_provider_catalog_asset_inactive surfaces as a plain readable message on attach", async () => {
  const client: OrganizerRegistryPlanRpcClient = {
    async rpc() {
      return { data: null, error: { message: "registry_provider_catalog_asset_inactive" } };
    },
  };
  await assert.rejects(
    () => attachMyPrivateDraftRegistryPlanCatalogSelection(client, { eventId: "e1", registryPlanId: "r1", catalogAssetId: "a1" }),
    /no longer available/i,
  );
});

test("Catalog P2 never dereferences a public website: no fetch/open/preview construct in this module", () => {
  const src = readFileSync(fileURLToPath(new URL("./organizerRegistryPlan.ts", import.meta.url)), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /fetch\(|window\.open|XMLHttpRequest|axios|<iframe/i);
});
