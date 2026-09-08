import assert from "node:assert/strict";
import test from "node:test";

import {
  addMyPrivateDraftRegistryPlan,
  deleteMyPrivateDraftRegistryPlan,
  emptyRegistryPlan,
  isRegistryPlanStatus,
  listMyPrivateDraftRegistryPlans,
  type OrganizerRegistryPlanRpcClient,
  REGISTRY_PLAN_STATUSES,
  registryPlanError,
  type RegistryPlanInput,
  registryPlanValues,
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
