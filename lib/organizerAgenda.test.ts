import assert from "node:assert/strict";
import test from "node:test";

import {
  createMyPrivateDraftAgendaItem,
  deleteMyPrivateDraftAgendaItem,
  getMyPrivateDraftAgenda,
  organizerAgendaItemError,
  type OrganizerAgendaItemInput,
  type OrganizerAgendaRpcClient,
  updateMyPrivateDraftAgendaItem,
} from "./organizerAgenda";

const values: OrganizerAgendaItemInput = {
  title: "Opening remarks",
  description: "Welcome",
  location: "Main hall",
  speaker: "Sofia",
  agendaDate: "2026-10-10",
  startTime: "09:00",
  endTime: "09:30",
};

test("organizerAgendaItemError enforces a title and a valid start time, everything else optional", () => {
  assert.equal(organizerAgendaItemError(values), null);
  assert.equal(organizerAgendaItemError({ ...values, description: "", location: "", speaker: "", agendaDate: "", endTime: "" }), null);
  assert.match(organizerAgendaItemError({ ...values, title: "  " }) ?? "", /Enter a title/);
  assert.match(organizerAgendaItemError({ ...values, startTime: "" }) ?? "", /Choose a start time/);
  assert.match(organizerAgendaItemError({ ...values, startTime: "9am" }) ?? "", /Choose a start time/);
  assert.match(organizerAgendaItemError({ ...values, endTime: "08:00" }) ?? "", /end time cannot be before/);
  assert.match(organizerAgendaItemError({ ...values, agendaDate: "2026-13-40" }) ?? "", /valid date/);
});

test("getMyPrivateDraftAgenda returns the shared version + parsed items", async () => {
  const client: OrganizerAgendaRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "get_my_private_draft_agenda");
      assert.deepEqual(args, { p_event_id: "e1" });
      return {
        data: [{
          agenda_version: 3,
          items: [{
            id: "i1", title: "Opening", description: null, location: "Hall",
            speaker: null, agenda_date: "2026-10-10", start_time: "09:00:00", end_time: null,
          }],
        }],
        error: null,
      };
    },
  };
  const agenda = await getMyPrivateDraftAgenda(client, "e1");
  assert.equal(agenda.version, 3);
  assert.deepEqual(agenda.items, [{
    id: "i1", title: "Opening", description: null, location: "Hall",
    speaker: null, agendaDate: "2026-10-10", startTime: "09:00:00", endTime: null,
  }]);
});

test("createMyPrivateDraftAgendaItem maps trimmed values + optional nulls to the RPC", async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const client: OrganizerAgendaRpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: [{ agenda_version: 1, item: { id: "i1", title: "Opening remarks" } }], error: null };
    },
  };
  const result = await createMyPrivateDraftAgendaItem(client, {
    eventId: "e1",
    values: { ...values, description: "  ", location: "  Main hall  ", endTime: "" },
  });
  assert.equal(result.version, 1);
  assert.equal(result.item.id, "i1");
  assert.equal(calls[0]?.name, "create_my_private_draft_agenda_item");
  assert.deepEqual(calls[0]?.args, {
    p_event_id: "e1",
    p_title: "Opening remarks",
    p_description: null,
    p_location: "Main hall",
    p_speaker: "Sofia",
    p_agenda_date: "2026-10-10",
    p_start_time: "09:00",
    p_end_time: null,
  });
});

test("create rejects invalid input before calling the RPC", async () => {
  const client: OrganizerAgendaRpcClient = {
    async rpc() {
      throw new Error("rpc must not be called on invalid input");
    },
  };
  await assert.rejects(
    () => createMyPrivateDraftAgendaItem(client, { eventId: "e1", values: { ...values, title: "" } }),
    /Enter a title/,
  );
});

test("update returns a discriminated stale result, not a thrown error", async () => {
  const stale: OrganizerAgendaRpcClient = {
    async rpc() {
      return { data: null, error: { message: "stale_agenda_version" } };
    },
  };
  const result = await updateMyPrivateDraftAgendaItem(stale, {
    eventId: "e1", itemId: "i1", expectedVersion: 2, values,
  });
  assert.deepEqual(result, { status: "stale" });

  const ok: OrganizerAgendaRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "update_my_private_draft_agenda_item");
      assert.equal(args?.p_expected_agenda_version, 2);
      assert.equal(args?.p_item_id, "i1");
      return { data: [{ agenda_version: 3, item: { id: "i1", title: "Opening remarks" } }], error: null };
    },
  };
  const saved = await updateMyPrivateDraftAgendaItem(ok, { eventId: "e1", itemId: "i1", expectedVersion: 2, values });
  assert.equal(saved.status, "saved");
  assert.equal(saved.status === "saved" ? saved.version : null, 3);
});

test("delete returns a discriminated stale result and passes the expected version", async () => {
  const calls: Array<Record<string, unknown> | undefined> = [];
  const ok: OrganizerAgendaRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "delete_my_private_draft_agenda_item");
      calls.push(args);
      return { data: [{ agenda_version: 4, deleted_id: "i2" }], error: null };
    },
  };
  const result = await deleteMyPrivateDraftAgendaItem(ok, { eventId: "e1", itemId: "i2", expectedVersion: 3 });
  assert.deepEqual(result, { status: "deleted", version: 4, deletedId: "i2" });
  assert.deepEqual(calls[0], { p_event_id: "e1", p_item_id: "i2", p_expected_agenda_version: 3 });

  const stale: OrganizerAgendaRpcClient = {
    async rpc() {
      return { data: null, error: { message: "stale_agenda_version" } };
    },
  };
  assert.deepEqual(
    await deleteMyPrivateDraftAgendaItem(stale, { eventId: "e1", itemId: "i2", expectedVersion: 1 }),
    { status: "stale" },
  );
});

test("a non-owner / not-found rejection is surfaced verbatim, never swallowed", async () => {
  const client: OrganizerAgendaRpcClient = {
    async rpc() {
      return { data: null, error: { message: "Draft not found." } };
    },
  };
  await assert.rejects(() => getMyPrivateDraftAgenda(client, "someone-elses"), /Draft not found\./);
  await assert.rejects(
    () => updateMyPrivateDraftAgendaItem(client, { eventId: "x", itemId: "i", expectedVersion: 0, values }),
    /Draft not found\./,
  );
});
