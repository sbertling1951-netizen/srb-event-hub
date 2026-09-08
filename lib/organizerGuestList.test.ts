import assert from "node:assert/strict";
import test from "node:test";

import {
  addMyPrivateDraftPlannedGuest,
  deleteMyPrivateDraftPlannedGuest,
  emptyPlannedGuest,
  listMyPrivateDraftPlannedGuests,
  type OrganizerGuestListRpcClient,
  plannedGuestError,
  type PlannedGuestInput,
  plannedGuestValues,
  updateMyPrivateDraftPlannedGuest,
} from "./organizerGuestList";

const values: PlannedGuestInput = {
  displayName: "Jordan Rivera",
  email: "jordan@example.invalid",
  phone: "+1 555 0100",
  note: "College roommate",
};

test("plannedGuestError requires a name and leaves email / phone / note optional", () => {
  assert.equal(plannedGuestError(values), null);
  assert.equal(plannedGuestError({ ...values, email: "", phone: "", note: "" }), null);
  assert.match(plannedGuestError({ ...values, displayName: "  " }) ?? "", /Enter a name/);
  assert.match(plannedGuestError({ ...values, displayName: "x".repeat(201) }) ?? "", /200 characters or fewer/);
  assert.match(plannedGuestError({ ...values, email: "x".repeat(321) }) ?? "", /email must be 320/);
  assert.match(plannedGuestError({ ...values, phone: "x".repeat(51) }) ?? "", /phone number must be 50/);
  assert.match(plannedGuestError({ ...values, note: "x".repeat(2001) }) ?? "", /note must be 2000/);
});

test("emptyPlannedGuest / plannedGuestValues shape and prefill", () => {
  assert.deepEqual(emptyPlannedGuest(), { displayName: "", email: "", phone: "", note: "" });
  assert.deepEqual(
    plannedGuestValues({
      id: "g1",
      displayName: "Sam",
      email: null,
      phone: null,
      organizerNote: "note",
    }),
    { displayName: "Sam", email: "", phone: "", note: "note" },
  );
});

test("listMyPrivateDraftPlannedGuests parses the rows and surfaces a not-found error verbatim", async () => {
  const ok: OrganizerGuestListRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "list_my_private_draft_planned_guests");
      assert.deepEqual(args, { p_event_id: "e1" });
      return {
        data: [
          { id: "g1", display_name: "Jordan", email: "j@x.invalid", phone: null, organizer_note: null },
        ],
        error: null,
      };
    },
  };
  assert.deepEqual(await listMyPrivateDraftPlannedGuests(ok, "e1"), [
    { id: "g1", displayName: "Jordan", email: "j@x.invalid", phone: null, organizerNote: null },
  ]);

  const denied: OrganizerGuestListRpcClient = {
    async rpc() {
      return { data: null, error: { message: "Draft not found." } };
    },
  };
  await assert.rejects(() => listMyPrivateDraftPlannedGuests(denied, "someone-elses"), /Draft not found\./);
});

test("addMyPrivateDraftPlannedGuest maps trimmed values + optional nulls and validates first", async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const client: OrganizerGuestListRpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: [{ id: "g1", display_name: "Jordan Rivera", email: null, phone: null, organizer_note: null }],
        error: null,
      };
    },
  };
  const guest = await addMyPrivateDraftPlannedGuest(client, {
    eventId: "e1",
    values: { displayName: "  Jordan Rivera  ", email: "   ", phone: "", note: "  " },
  });
  assert.equal(guest.id, "g1");
  assert.deepEqual(calls[0], {
    name: "add_my_private_draft_planned_guest",
    args: {
      p_event_id: "e1",
      p_display_name: "Jordan Rivera",
      p_email: null,
      p_phone: null,
      p_organizer_note: null,
    },
  });

  await assert.rejects(
    () =>
      addMyPrivateDraftPlannedGuest(
        { async rpc() { throw new Error("rpc must not be called"); } },
        { eventId: "e1", values: { ...values, displayName: "" } },
      ),
    /Enter a name/,
  );
});

test("updateMyPrivateDraftPlannedGuest passes the guest id and mapped fields", async () => {
  const calls: Array<Record<string, unknown> | undefined> = [];
  const client: OrganizerGuestListRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "update_my_private_draft_planned_guest");
      calls.push(args);
      return {
        data: [{ id: "g1", display_name: "Jordan Rivera", email: "j@x.invalid", phone: null, organizer_note: "hi" }],
        error: null,
      };
    },
  };
  const guest = await updateMyPrivateDraftPlannedGuest(client, {
    eventId: "e1",
    guestId: "g1",
    values: { displayName: "Jordan Rivera", email: "j@x.invalid", phone: "", note: "hi" },
  });
  assert.equal(guest.organizerNote, "hi");
  assert.deepEqual(calls[0], {
    p_event_id: "e1",
    p_guest_id: "g1",
    p_display_name: "Jordan Rivera",
    p_email: "j@x.invalid",
    p_phone: null,
    p_organizer_note: "hi",
  });
});

test("deleteMyPrivateDraftPlannedGuest passes both ids and returns the removed id", async () => {
  const calls: Array<Record<string, unknown> | undefined> = [];
  const client: OrganizerGuestListRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "delete_my_private_draft_planned_guest");
      calls.push(args);
      return { data: [{ deleted_id: "g2" }], error: null };
    },
  };
  assert.deepEqual(await deleteMyPrivateDraftPlannedGuest(client, { eventId: "e1", guestId: "g2" }), {
    deletedId: "g2",
  });
  assert.deepEqual(calls[0], { p_event_id: "e1", p_guest_id: "g2" });

  const denied: OrganizerGuestListRpcClient = {
    async rpc() {
      return { data: null, error: { message: "Planned guest not found." } };
    },
  };
  await assert.rejects(
    () => deleteMyPrivateDraftPlannedGuest(denied, { eventId: "e1", guestId: "gone" }),
    /Planned guest not found\./,
  );
});
