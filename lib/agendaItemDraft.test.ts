import assert from "node:assert/strict";
import { test } from "node:test";

import { type AgendaDraft, agendaDraftKey, clearAgendaDrafts, readAgendaDraft, writeAgendaDraft } from "@/lib/agendaItemDraft";

function fixture() {
  const values = new Map<string, string>();
  const storage = { get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage } });
  return { values, storage, close: () => {
    if (originalWindow) {Object.defineProperty(globalThis, "window", originalWindow);}
    else {Reflect.deleteProperty(globalThis, "window");}
  } };
}
const blank = { id: "", external_id: "", title: "", description: "", location: "", speaker: "", category: "", color: "", agenda_date: "", start_time: "", end_time: "", sort_order: "", is_published: false };
const draft: AgendaDraft = { form: { ...blank, title: "Unfinished session", description: "Details to collect" }, original: blank, updatedAt: 1000 };

test("incomplete fields survive storage round-trip; account and event cannot cross", () => {
  const f = fixture(); try {
    const key = agendaDraftKey("account-A", "event-A");
    assert.equal(writeAgendaDraft(key, draft), true);
    assert.deepEqual(readAgendaDraft(key, 1001), draft);
    assert.equal(readAgendaDraft(agendaDraftKey("account-B", "event-A"), 1001), null);
    assert.equal(readAgendaDraft(agendaDraftKey("account-A", "event-B"), 1001), null);
    assert.notEqual(agendaDraftKey("a::b", "c"), agendaDraftKey("a", "b::c"));
  } finally { f.close(); }
});
test("clear after successful save/discard and explicit sign-out affects only agenda drafts", () => {
  const f = fixture(); try {
    const key = agendaDraftKey("a", "one");
    writeAgendaDraft(key, draft);
    assert.equal(writeAgendaDraft(key, null), true);
    assert.equal(readAgendaDraft(key, 1001), null);
    writeAgendaDraft(key, draft); writeAgendaDraft(agendaDraftKey("b", "two"), draft);
    f.storage.setItem("unrelated", "preserve"); clearAgendaDrafts();
    assert.deepEqual([...f.values], [["unrelated", "preserve"]]);
  } finally { f.close(); }
});
test("malformed, mismatched-item, future and expired records are never restored", () => {
  const f = fixture(); try {
    const key = agendaDraftKey("a", "e");
    for (const bad of [null, {}, { ...draft, form: { ...draft.form, title: 42 } },
      { ...draft, form: { ...draft.form, unexpected: "field" } }, { ...draft, original: { ...blank, id: "other" } },
      { ...draft, updatedAt: 2000 }, { ...draft, updatedAt: 0 }]) {
      f.storage.setItem(key, JSON.stringify(bad));
      assert.equal(readAgendaDraft(key, bad && "updatedAt" in bad && bad.updatedAt === 0 ? 86400001 : 1001), null);
    }
    f.storage.setItem(key, "{"); assert.equal(readAgendaDraft(key, 1001), null);
  } finally { f.close(); }
});
test("unavailable storage does not crash editing and reports write failure", () => {
  const f = fixture(); try {
    Object.defineProperty(window, "sessionStorage", { get() { throw new Error("denied"); } });
    assert.equal(writeAgendaDraft("key", draft), false);
    assert.equal(readAgendaDraft("key"), null);
    assert.doesNotThrow(clearAgendaDrafts);
  } finally { f.close(); }
});
