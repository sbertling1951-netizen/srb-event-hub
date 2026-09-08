import assert from "node:assert/strict";
import test from "node:test";

import {
  addMyPrivateDraftVendorPlan,
  deleteMyPrivateDraftVendorPlan,
  emptyVendorPlan,
  isVendorPlanStatus,
  listMyPrivateDraftVendorPlans,
  type OrganizerVendorPlanRpcClient,
  updateMyPrivateDraftVendorPlan,
  VENDOR_PLAN_STATUSES,
  vendorPlanError,
  type VendorPlanInput,
  vendorPlanValues,
} from "./organizerVendorPlan";

const values: VendorPlanInput = {
  vendorName: "Riverbend Catering",
  serviceCategory: "Caterers and food",
  status: "contacted",
  website: "https://riverbend.example.invalid",
  contactDetail: "ask for Dana, 555-0182",
  note: "Waiting on the written quote",
};

test("exactly the three approved statuses exist", () => {
  assert.deepEqual([...VENDOR_PLAN_STATUSES], ["considering", "contacted", "selected"]);
  for (const status of VENDOR_PLAN_STATUSES) {
    assert.equal(isVendorPlanStatus(status), true);
  }
  for (const bad of ["booked", "ruled_out", "admitted", "paid", "Considering", "", null, undefined, 3]) {
    assert.equal(isVendorPlanStatus(bad), false, `${String(bad)} must not be a status`);
  }
});

test("vendorPlanError requires a name and leaves every other field optional", () => {
  assert.equal(vendorPlanError(values), null);
  assert.equal(
    vendorPlanError({ ...values, serviceCategory: "", website: "", contactDetail: "", note: "" }),
    null,
  );
  assert.match(vendorPlanError({ ...values, vendorName: "  " }) ?? "", /Enter a name/);
  assert.match(vendorPlanError({ ...values, vendorName: "x".repeat(201) }) ?? "", /200 characters or fewer/);
  assert.match(vendorPlanError({ ...values, serviceCategory: "x".repeat(121) }) ?? "", /category must be 120/);
  assert.match(vendorPlanError({ ...values, website: "x".repeat(501) }) ?? "", /website must be 500/);
  assert.match(vendorPlanError({ ...values, contactDetail: "x".repeat(321) }) ?? "", /contact detail must be 320/);
  assert.match(vendorPlanError({ ...values, note: "x".repeat(2001) }) ?? "", /note must be 2000/);
});

test("vendorPlanError rejects a status outside the approved three", () => {
  const bad = { ...values, status: "booked" } as unknown as VendorPlanInput;
  assert.match(vendorPlanError(bad) ?? "", /considering, contacted, or selected/);
});

test("emptyVendorPlan / vendorPlanValues shape and prefill", () => {
  assert.deepEqual(emptyVendorPlan(), {
    vendorName: "",
    serviceCategory: "",
    status: "considering",
    website: "",
    contactDetail: "",
    note: "",
  });
  assert.deepEqual(
    vendorPlanValues({
      id: "v1",
      vendorName: "Aunt Ruth's barn",
      serviceCategory: null,
      planningStatus: "selected",
      website: null,
      contactDetail: null,
      organizerNote: "Free, we bring tables",
    }),
    {
      vendorName: "Aunt Ruth's barn",
      serviceCategory: "",
      status: "selected",
      website: "",
      contactDetail: "",
      note: "Free, we bring tables",
    },
  );
});

test("listMyPrivateDraftVendorPlans parses rows and surfaces a not-found error verbatim", async () => {
  const ok: OrganizerVendorPlanRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "list_my_private_draft_vendor_plans");
      assert.deepEqual(args, { p_event_id: "e1" });
      return {
        data: [
          {
            id: "v1",
            vendor_name: "Riverbend",
            service_category: null,
            planning_status: "contacted",
            website: null,
            contact_detail: null,
            organizer_note: null,
          },
        ],
        error: null,
      };
    },
  };
  assert.deepEqual(await listMyPrivateDraftVendorPlans(ok, "e1"), [
    {
      id: "v1",
      vendorName: "Riverbend",
      serviceCategory: null,
      planningStatus: "contacted",
      website: null,
      contactDetail: null,
      organizerNote: null,
    },
  ]);

  const denied: OrganizerVendorPlanRpcClient = {
    async rpc() {
      return { data: null, error: { message: "Draft not found." } };
    },
  };
  await assert.rejects(() => listMyPrivateDraftVendorPlans(denied, "e1"), /Draft not found\./);
  await assert.rejects(() => listMyPrivateDraftVendorPlans(ok, ""), /Choose a draft to plan\./);
});

test("an unrecognized status from the server falls back to considering, never crashes", async () => {
  const odd: OrganizerVendorPlanRpcClient = {
    async rpc() {
      return {
        data: [{ id: "v1", vendor_name: "X", planning_status: "booked" }],
        error: null,
      };
    },
  };
  const [entry] = await listMyPrivateDraftVendorPlans(odd, "e1");
  assert.equal(entry.planningStatus, "considering");
});

test("add sends exactly the seven planning arguments, trimming blanks to null", async () => {
  const client: OrganizerVendorPlanRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "add_my_private_draft_vendor_plan");
      assert.deepEqual(args, {
        p_event_id: "e1",
        p_vendor_name: "Aunt Ruth's barn",
        p_service_category: null,
        p_planning_status: "considering",
        p_website: null,
        p_contact_detail: null,
        p_organizer_note: null,
      });
      return {
        data: [{ id: "v2", vendor_name: "Aunt Ruth's barn", planning_status: "considering" }],
        error: null,
      };
    },
  };
  const entry = await addMyPrivateDraftVendorPlan(client, {
    eventId: "e1",
    values: { ...emptyVendorPlan(), vendorName: "  Aunt Ruth's barn  " },
  });
  assert.equal(entry.id, "v2");
});

test("add / update validate before touching the network", async () => {
  const exploding: OrganizerVendorPlanRpcClient = {
    async rpc() {
      throw new Error("the adapter must not call the server on invalid input");
    },
  };
  await assert.rejects(
    () => addMyPrivateDraftVendorPlan(exploding, { eventId: "e1", values: emptyVendorPlan() }),
    /Enter a name/,
  );
  await assert.rejects(
    () =>
      updateMyPrivateDraftVendorPlan(exploding, {
        eventId: "e1",
        vendorPlanId: "v1",
        values: emptyVendorPlan(),
      }),
    /Enter a name/,
  );
});

test("update targets one entry by id and delete returns the removed id", async () => {
  const client: OrganizerVendorPlanRpcClient = {
    async rpc(name, args) {
      if (name === "update_my_private_draft_vendor_plan") {
        assert.equal((args ?? {}).p_vendor_plan_id, "v1");
        assert.equal((args ?? {}).p_planning_status, "contacted");
        return { data: [{ id: "v1", vendor_name: "Riverbend Catering", planning_status: "contacted" }], error: null };
      }
      assert.equal(name, "delete_my_private_draft_vendor_plan");
      assert.deepEqual(args, { p_event_id: "e1", p_vendor_plan_id: "v1" });
      return { data: [{ deleted_id: "v1" }], error: null };
    },
  };
  const updated = await updateMyPrivateDraftVendorPlan(client, {
    eventId: "e1",
    vendorPlanId: "v1",
    values,
  });
  assert.equal(updated.planningStatus, "contacted");
  assert.deepEqual(await deleteMyPrivateDraftVendorPlan(client, { eventId: "e1", vendorPlanId: "v1" }), {
    deletedId: "v1",
  });
});

test("a server error on delete is surfaced, never swallowed", async () => {
  const failing: OrganizerVendorPlanRpcClient = {
    async rpc() {
      return { data: null, error: { message: "Vendor plan entry not found." } };
    },
  };
  await assert.rejects(
    () => deleteMyPrivateDraftVendorPlan(failing, { eventId: "e1", vendorPlanId: "v9" }),
    /Vendor plan entry not found\./,
  );
});
