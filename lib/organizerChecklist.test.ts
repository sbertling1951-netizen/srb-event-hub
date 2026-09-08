import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  addMyPrivateDraftChecklistItem,
  checklistItemError,
  type ChecklistItemInput,
  checklistItemValues,
  deleteMyPrivateDraftChecklistItem,
  emptyChecklistItem,
  listMyPrivateDraftChecklistItems,
  type OrganizerChecklistRpcClient,
  updateMyPrivateDraftChecklistItem,
} from "./organizerChecklist";

const adapterSource = readFileSync(
  fileURLToPath(new URL("./organizerChecklist.ts", import.meta.url)),
  "utf8",
);

const values: ChecklistItemInput = {
  title: "Call the hall back",
  note: "ask about the kitchen",
  targetDate: "2026-10-20",
  isCompleted: false,
};

test("BLANK: an empty response is an empty list -- nothing is invented", async () => {
  for (const data of [[], null, undefined]) {
    const client: OrganizerChecklistRpcClient = {
      async rpc() {
        return { data, error: null };
      },
    };
    assert.deepEqual(await listMyPrivateDraftChecklistItems(client, "e1"), []);
  }
});

test("BLANK: the module exports no starter list, template, or suggestion", () => {
  const code = adapterSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /starter|template|suggest|recommend|preset|sample|DEFAULT_ITEMS|seed/i);
  // emptyChecklistItem is an EMPTY form, not a prefilled one
  assert.deepEqual(emptyChecklistItem(), { title: "", note: "", targetDate: "", isCompleted: false });
});

test("INERT: the module exports no progress, total, percentage, or score helper", () => {
  const code = adapterSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /progress|percent|ratio|\btotal\b|remaining|completedCount|score|badge/i);
  // and nothing filters or counts by completion
  assert.doesNotMatch(code, /\.filter\([^)]*isCompleted|\.reduce\(|isCompleted\s*\)\s*\.length/);
});

test("INERT: the module never mentions readiness, launch, publish, or reminders", () => {
  const code = adapterSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /readiness|launch|publish|remind|notify|calendar|ical|overdue|\bdue\b|\blate\b/i);
});

test("checklistItemError requires a title and leaves note/date/completion optional", () => {
  assert.equal(checklistItemError(values), null);
  assert.equal(checklistItemError({ ...values, note: "", targetDate: "" }), null);
  assert.equal(checklistItemError({ ...emptyChecklistItem(), title: "Count chairs" }), null);
  assert.match(checklistItemError({ ...values, title: "  " }) ?? "", /Enter something for this item/);
  assert.match(checklistItemError({ ...values, title: "x".repeat(301) }) ?? "", /300 characters or fewer/);
  assert.match(checklistItemError({ ...values, note: "x".repeat(2001) }) ?? "", /note must be 2000/);
});

test("a PAST target date is perfectly valid -- there is no overdue concept", () => {
  assert.equal(checklistItemError({ ...values, targetDate: "1999-01-01" }), null);
  assert.equal(checklistItemError({ ...values, targetDate: "2200-12-31" }), null);
});

test("emptyChecklistItem / checklistItemValues shape and prefill", () => {
  assert.deepEqual(
    checklistItemValues({
      id: "c1",
      title: "Count the chairs",
      organizerNote: null,
      targetDate: null,
      isCompleted: true,
    }),
    { title: "Count the chairs", note: "", targetDate: "", isCompleted: true },
  );
});

test("list parses rows, preserves server order, and surfaces a not-found error verbatim", async () => {
  const ok: OrganizerChecklistRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "list_my_private_draft_checklist_items");
      assert.deepEqual(args, { p_event_id: "e1" });
      return {
        data: [
          { id: "c1", item_title: "First", organizer_note: null, target_date: null, is_completed: false },
          { id: "c2", item_title: "Second", organizer_note: "n", target_date: "2026-10-20", is_completed: true },
        ],
        error: null,
      };
    },
  };
  const items = await listMyPrivateDraftChecklistItems(ok, "e1");
  assert.deepEqual(items.map((i) => i.id), ["c1", "c2"], "server (creation) order preserved, not re-sorted");
  assert.equal(items[1].isCompleted, true);
  assert.equal(items[1].targetDate, "2026-10-20");

  const denied: OrganizerChecklistRpcClient = {
    async rpc() {
      return { data: null, error: { message: "Draft not found." } };
    },
  };
  await assert.rejects(() => listMyPrivateDraftChecklistItems(denied, "e1"), /Draft not found\./);
  await assert.rejects(() => listMyPrivateDraftChecklistItems(ok, ""), /Choose a draft to plan\./);
});

test("add sends exactly the five arguments and defaults completion to false", async () => {
  const client: OrganizerChecklistRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "add_my_private_draft_checklist_item");
      assert.deepEqual(args, {
        p_event_id: "e1",
        p_item_title: "Count the chairs",
        p_organizer_note: null,
        p_target_date: null,
        p_is_completed: false,
      });
      return { data: [{ id: "c2", item_title: "Count the chairs", is_completed: false }], error: null };
    },
  };
  const item = await addMyPrivateDraftChecklistItem(client, {
    eventId: "e1",
    values: { ...emptyChecklistItem(), title: "  Count the chairs  " },
  });
  assert.equal(item.isCompleted, false);
});

test("ticking sends only the completion change -- no other argument appears", async () => {
  let sent: Record<string, unknown> | undefined;
  const client: OrganizerChecklistRpcClient = {
    async rpc(_name, args) {
      sent = args;
      return { data: [{ id: "c1", item_title: "Call the hall back", is_completed: true }], error: null };
    },
  };
  await updateMyPrivateDraftChecklistItem(client, {
    eventId: "e1",
    checklistItemId: "c1",
    values: { ...values, isCompleted: true },
  });
  assert.deepEqual(Object.keys(sent ?? {}).sort(), [
    "p_checklist_item_id",
    "p_event_id",
    "p_is_completed",
    "p_item_title",
    "p_organizer_note",
    "p_target_date",
  ]);
  assert.equal(sent?.p_is_completed, true);
  // nothing about the event, its status, or its readiness is ever sent
  for (const forbidden of ["p_status", "p_is_active", "p_visible_to_members", "p_location", "p_readiness"]) {
    assert.ok(!(forbidden in (sent ?? {})), `no checklist call may send ${forbidden}`);
  }
});

test("add / update validate before touching the network", async () => {
  const exploding: OrganizerChecklistRpcClient = {
    async rpc() {
      throw new Error("the adapter must not call the server on invalid input");
    },
  };
  await assert.rejects(
    () => addMyPrivateDraftChecklistItem(exploding, { eventId: "e1", values: emptyChecklistItem() }),
    /Enter something for this item/,
  );
  await assert.rejects(
    () =>
      updateMyPrivateDraftChecklistItem(exploding, {
        eventId: "e1",
        checklistItemId: "c1",
        values: emptyChecklistItem(),
      }),
    /Enter something for this item/,
  );
});

test("delete targets one item and returns the removed id; errors surface", async () => {
  const client: OrganizerChecklistRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "delete_my_private_draft_checklist_item");
      assert.deepEqual(args, { p_event_id: "e1", p_checklist_item_id: "c1" });
      return { data: [{ deleted_id: "c1" }], error: null };
    },
  };
  assert.deepEqual(await deleteMyPrivateDraftChecklistItem(client, { eventId: "e1", checklistItemId: "c1" }), {
    deletedId: "c1",
  });

  const failing: OrganizerChecklistRpcClient = {
    async rpc() {
      return { data: null, error: { message: "Checklist item not found." } };
    },
  };
  await assert.rejects(
    () => deleteMyPrivateDraftChecklistItem(failing, { eventId: "e1", checklistItemId: "c9" }),
    /Checklist item not found\./,
  );
});

test("only the four checklist RPCs are ever called", () => {
  assert.deepEqual(
    [...adapterSource.matchAll(/client\.rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort(),
    [
      "add_my_private_draft_checklist_item",
      "delete_my_private_draft_checklist_item",
      "list_my_private_draft_checklist_items",
      "update_my_private_draft_checklist_item",
    ],
  );
});
