import assert from "node:assert/strict";
import test from "node:test";

import {
  addMyPrivateDraftVenuePlan,
  deleteMyPrivateDraftVenuePlan,
  emptyVenuePlan,
  isVenuePlanStatus,
  listMyPrivateDraftVenuePlans,
  type OrganizerVenuePlanRpcClient,
  updateMyPrivateDraftVenuePlan,
  VENUE_PLAN_STATUSES,
  venuePlanError,
  type VenuePlanInput,
  venuePlanLocationText,
  venuePlanValues,
} from "./organizerVenuePlan";

const values: VenuePlanInput = {
  placeName: "Riverbend Legion Hall",
  locationDescription: "behind the fairgrounds, gravel lot",
  website: "https://legion.example.invalid",
  contactName: "Dana Whitfield",
  contactPhone: "+1 555 0182",
  status: "contacted",
  note: "Check the kitchen",
};

test("exactly the three approved statuses exist", () => {
  assert.deepEqual([...VENUE_PLAN_STATUSES], ["considering", "contacted", "selected"]);
  for (const status of VENUE_PLAN_STATUSES) {
    assert.equal(isVenuePlanStatus(status), true);
  }
  for (const bad of ["booked", "visited", "held", "Considering", "", null, undefined, 3]) {
    assert.equal(isVenuePlanStatus(bad), false, `${String(bad)} must not be a status`);
  }
});

test("venuePlanError requires a place name and leaves every other field optional", () => {
  assert.equal(venuePlanError(values), null);
  assert.equal(
    venuePlanError({
      ...values,
      locationDescription: "",
      website: "",
      contactName: "",
      contactPhone: "",
      note: "",
    }),
    null,
  );
  assert.equal(venuePlanError({ ...emptyVenuePlan(), placeName: "Aunt Ruth's barn" }), null);
  assert.match(venuePlanError({ ...values, placeName: "  " }) ?? "", /Enter a name for this place/);
  assert.match(venuePlanError({ ...values, placeName: "x".repeat(201) }) ?? "", /200 characters or fewer/);
  assert.match(venuePlanError({ ...values, locationDescription: "x".repeat(501) }) ?? "", /address or description must be 500/);
  assert.match(venuePlanError({ ...values, website: "x".repeat(501) }) ?? "", /website must be 500/);
  assert.match(venuePlanError({ ...values, contactName: "x".repeat(201) }) ?? "", /contact name must be 200/);
  assert.match(venuePlanError({ ...values, contactPhone: "x".repeat(51) }) ?? "", /phone number must be 50/);
  assert.match(venuePlanError({ ...values, note: "x".repeat(2001) }) ?? "", /note must be 2000/);
});

test("venuePlanError rejects a status outside the approved three", () => {
  const bad = { ...values, status: "booked" } as unknown as VenuePlanInput;
  assert.match(venuePlanError(bad) ?? "", /considering, contacted, or selected/);
});

test("emptyVenuePlan / venuePlanValues shape and prefill", () => {
  assert.deepEqual(emptyVenuePlan(), {
    placeName: "",
    locationDescription: "",
    website: "",
    contactName: "",
    contactPhone: "",
    status: "considering",
    note: "",
  });
  assert.deepEqual(
    venuePlanValues({
      id: "v1",
      placeName: "Aunt Ruth's barn",
      locationDescription: null,
      website: null,
      contactName: null,
      contactPhone: null,
      planningStatus: "selected",
      organizerNote: "Free, we bring tables",
    }),
    {
      placeName: "Aunt Ruth's barn",
      locationDescription: "",
      website: "",
      contactName: "",
      contactPhone: "",
      status: "selected",
      note: "Free, we bring tables",
    },
  );
});

test("listMyPrivateDraftVenuePlans parses rows and surfaces a not-found error verbatim", async () => {
  const ok: OrganizerVenuePlanRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "list_my_private_draft_venue_plans");
      assert.deepEqual(args, { p_event_id: "e1" });
      return {
        data: [
          {
            id: "v1",
            place_name: "Riverbend Legion Hall",
            location_description: "behind the fairgrounds",
            website: null,
            contact_name: "Dana",
            contact_phone: "555-0182",
            planning_status: "contacted",
            organizer_note: null,
          },
        ],
        error: null,
      };
    },
  };
  assert.deepEqual(await listMyPrivateDraftVenuePlans(ok, "e1"), [
    {
      id: "v1",
      placeName: "Riverbend Legion Hall",
      locationDescription: "behind the fairgrounds",
      website: null,
      contactName: "Dana",
      contactPhone: "555-0182",
      planningStatus: "contacted",
      organizerNote: null,
    },
  ]);

  const denied: OrganizerVenuePlanRpcClient = {
    async rpc() {
      return { data: null, error: { message: "Draft not found." } };
    },
  };
  await assert.rejects(() => listMyPrivateDraftVenuePlans(denied, "e1"), /Draft not found\./);
  await assert.rejects(() => listMyPrivateDraftVenuePlans(ok, ""), /Choose a draft to plan\./);
});

test("an unrecognized status from the server falls back to considering, never crashes", async () => {
  const odd: OrganizerVenuePlanRpcClient = {
    async rpc() {
      return { data: [{ id: "v1", place_name: "X", planning_status: "booked" }], error: null };
    },
  };
  const [entry] = await listMyPrivateDraftVenuePlans(odd, "e1");
  assert.equal(entry.planningStatus, "considering");
});

test("add sends exactly the eight planning arguments, trimming blanks to null", async () => {
  const client: OrganizerVenuePlanRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "add_my_private_draft_venue_plan");
      assert.deepEqual(args, {
        p_event_id: "e1",
        p_place_name: "Aunt Ruth's barn",
        p_location_description: null,
        p_website: null,
        p_contact_name: null,
        p_contact_phone: null,
        p_planning_status: "considering",
        p_organizer_note: null,
      });
      return { data: [{ id: "v2", place_name: "Aunt Ruth's barn", planning_status: "considering" }], error: null };
    },
  };
  const entry = await addMyPrivateDraftVenuePlan(client, {
    eventId: "e1",
    values: { ...emptyVenuePlan(), placeName: "  Aunt Ruth's barn  " },
  });
  assert.equal(entry.id, "v2");
});

test("the adapter sends NO official Event location argument, ever", async () => {
  const seen: Record<string, unknown>[] = [];
  const client: OrganizerVenuePlanRpcClient = {
    async rpc(_name, args) {
      seen.push(args ?? {});
      return { data: [{ id: "v1", place_name: "X", planning_status: "selected" }], error: null };
    },
  };
  await addMyPrivateDraftVenuePlan(client, { eventId: "e1", values: { ...values, status: "selected" } });
  await updateMyPrivateDraftVenuePlan(client, {
    eventId: "e1",
    venuePlanId: "v1",
    values: { ...values, status: "selected" },
  });
  const forbidden = [
    "p_location",
    "p_location_mode",
    "p_venue_name",
    "p_street_address",
    "p_lat",
    "p_lng",
    "p_expected_location",
  ];
  for (const args of seen) {
    for (const key of forbidden) {
      assert.ok(!(key in args), `no venue-plan call may send ${key}`);
    }
  }
  // even marking "selected", the only place-ish argument is the private note field
  assert.ok(seen.every((a) => "p_place_name" in a));
});

test("add / update validate before touching the network", async () => {
  const exploding: OrganizerVenuePlanRpcClient = {
    async rpc() {
      throw new Error("the adapter must not call the server on invalid input");
    },
  };
  await assert.rejects(
    () => addMyPrivateDraftVenuePlan(exploding, { eventId: "e1", values: emptyVenuePlan() }),
    /Enter a name for this place/,
  );
  await assert.rejects(
    () =>
      updateMyPrivateDraftVenuePlan(exploding, {
        eventId: "e1",
        venuePlanId: "v1",
        values: emptyVenuePlan(),
      }),
    /Enter a name for this place/,
  );
});

test("update targets one entry by id and delete returns the removed id", async () => {
  const client: OrganizerVenuePlanRpcClient = {
    async rpc(name, args) {
      if (name === "update_my_private_draft_venue_plan") {
        assert.equal((args ?? {}).p_venue_plan_id, "v1");
        assert.equal((args ?? {}).p_planning_status, "contacted");
        return { data: [{ id: "v1", place_name: "Riverbend Legion Hall", planning_status: "contacted" }], error: null };
      }
      assert.equal(name, "delete_my_private_draft_venue_plan");
      assert.deepEqual(args, { p_event_id: "e1", p_venue_plan_id: "v1" });
      return { data: [{ deleted_id: "v1" }], error: null };
    },
  };
  const updated = await updateMyPrivateDraftVenuePlan(client, {
    eventId: "e1",
    venuePlanId: "v1",
    values,
  });
  assert.equal(updated.planningStatus, "contacted");
  assert.deepEqual(await deleteMyPrivateDraftVenuePlan(client, { eventId: "e1", venuePlanId: "v1" }), {
    deletedId: "v1",
  });
});

test("address and phone are sent exactly as typed apart from trimming", async () => {
  const messyAddress = "behind the fairgrounds — gravel lot, no street number";
  const messyPhone = "+1 (555) 018-2 ext. 4";
  let sent: Record<string, unknown> | undefined;
  const client: OrganizerVenuePlanRpcClient = {
    async rpc(_name, args) {
      sent = args;
      return { data: [{ id: "v3", place_name: "X", planning_status: "considering" }], error: null };
    },
  };
  await addMyPrivateDraftVenuePlan(client, {
    eventId: "e1",
    values: {
      ...emptyVenuePlan(),
      placeName: "X",
      locationDescription: `  ${messyAddress}  `,
      contactPhone: `  ${messyPhone}  `,
    },
  });
  assert.equal(sent?.p_location_description, messyAddress, "descriptive, not parsed or normalized");
  assert.equal(sent?.p_contact_phone, messyPhone, "opaque text: exactly what the organizer typed");
});

test("a server error on delete is surfaced, never swallowed", async () => {
  const failing: OrganizerVenuePlanRpcClient = {
    async rpc() {
      return { data: null, error: { message: "Venue plan entry not found." } };
    },
  };
  await assert.rejects(
    () => deleteMyPrivateDraftVenuePlan(failing, { eventId: "e1", venuePlanId: "v9" }),
    /Venue plan entry not found\./,
  );
});

// ---------------------------------------------------------------------------
// §B.1 adoption pre-fill text. A pure string builder: no write, no RPC, no id.
// ---------------------------------------------------------------------------

function entry(over: Partial<Parameters<typeof venuePlanLocationText>[0]> = {}) {
  return {
    id: "v1",
    placeName: "Riverbend Legion Hall",
    locationDescription: null,
    website: null,
    contactName: null,
    contactPhone: null,
    planningStatus: "considering" as const,
    organizerNote: null,
    ...over,
  };
}

test("venuePlanLocationText: 'Place name — location description' when a description exists", () => {
  assert.equal(
    venuePlanLocationText(entry({ locationDescription: "behind the fairgrounds, gravel lot" })),
    "Riverbend Legion Hall — behind the fairgrounds, gravel lot",
  );
});

test("venuePlanLocationText: 'Place name' alone when there is no description", () => {
  assert.equal(venuePlanLocationText(entry()), "Riverbend Legion Hall");
  assert.equal(venuePlanLocationText(entry({ locationDescription: "" })), "Riverbend Legion Hall");
  assert.equal(venuePlanLocationText(entry({ locationDescription: "   " })), "Riverbend Legion Hall");
});

test("venuePlanLocationText trims but never reformats, parses, or geocodes", () => {
  const messy = "  behind the fairgrounds — gravel lot, no street number  ";
  assert.equal(
    venuePlanLocationText(entry({ placeName: "  Aunt Ruth's barn  ", locationDescription: messy })),
    "Aunt Ruth's barn — behind the fairgrounds — gravel lot, no street number",
  );
});

test("venuePlanLocationText returns TEXT ONLY -- the entry id never appears", () => {
  const text = venuePlanLocationText(entry({ id: "abc-123-uuid", locationDescription: "221 Mill Road" }));
  assert.equal(text, "Riverbend Legion Hall — 221 Mill Road");
  assert.ok(!text.includes("abc-123-uuid"), "copy-not-link: no id leaks into the pre-filled text");
});

test("venuePlanLocationText ignores planning status entirely -- 'selected' is inert", () => {
  const considering = venuePlanLocationText(entry({ planningStatus: "considering" }));
  const contacted = venuePlanLocationText(entry({ planningStatus: "contacted" }));
  const selected = venuePlanLocationText(entry({ planningStatus: "selected" }));
  assert.equal(considering, contacted);
  assert.equal(contacted, selected, "a selected entry pre-fills exactly like any other");
});
