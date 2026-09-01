import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyDraft } from "@/lib/evaluations/answerModel";
import { createSaveQueue, type SaveFn } from "@/lib/evaluations/saveQueue";

const draft = (text: string) => ({ ...emptyDraft(), answerText: text });

/** A controllable fake save: resolves calls in the order you release them. */
function controllableSave() {
  const calls: { id: string; text: string; resolve: (err?: unknown) => void }[] = [];
  const save: SaveFn = (id, d) =>
    new Promise((resolve) => {
      calls.push({
        id,
        text: d.answerText,
        resolve: (err?: unknown) => resolve({ error: err ?? null }),
      });
    });
  return { save, calls };
}

test("1. an RPC save failure is detected and surfaced (not swallowed)", async () => {
  const { save, calls } = controllableSave();
  const q = createSaveQueue(save);
  q.enqueue("a", draft("v1"));
  await Promise.resolve();
  calls[0].resolve({ message: "boom" }); // RPC returned { error }
  const result = await q.flush();
  assert.equal(result.ok, false);
  assert.deepEqual(result.failed, ["a"]);
  assert.deepEqual(q.failedIds(), ["a"]);
});

test("2. rapid changes: an older completion can never overwrite a newer answer", async () => {
  const { save, calls } = controllableSave();
  const q = createSaveQueue(save);
  q.enqueue("a", draft("v1"));
  await Promise.resolve();
  // while v1 is in flight, two newer edits arrive
  q.enqueue("a", draft("v2"));
  q.enqueue("a", draft("v3"));
  calls[0].resolve(); // v1 done
  await Promise.resolve();
  await Promise.resolve();
  // the queue coalesces to the latest -> saves v3, not v2
  assert.equal(calls.length, 2);
  assert.equal(calls[1].text, "v3");
  calls[1].resolve();
  const result = await q.flush();
  assert.equal(result.ok, true);
});

test("3. flush() waits for an in-flight save to settle", async () => {
  const { save, calls } = controllableSave();
  const q = createSaveQueue(save);
  q.enqueue("a", draft("v1"));
  await Promise.resolve();
  let flushed = false;
  const flushPromise = q.flush().then((r) => {
    flushed = true;
    return r;
  });
  await Promise.resolve();
  assert.equal(flushed, false, "flush must not resolve while a save is in flight");
  calls[0].resolve();
  const result = await flushPromise;
  assert.equal(flushed, true);
  assert.equal(result.ok, true);
});

test("4. pending text is persisted by flush() before it resolves", async () => {
  const { save, calls } = controllableSave();
  const q = createSaveQueue(save);
  q.enqueue("a", draft("typed but not yet saved"));
  const flushPromise = q.flush();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "typed but not yet saved");
  calls[0].resolve();
  const result = await flushPromise;
  assert.equal(result.ok, true);
  assert.equal(q.hasPending(), false);
});

test("5. multiple questions each flush independently; one failure does not hide the others", async () => {
  const { save, calls } = controllableSave();
  const q = createSaveQueue(save);
  q.enqueue("a", draft("a1"));
  q.enqueue("b", draft("b1"));
  await Promise.resolve();
  calls[0].resolve({ message: "a failed" });
  calls[1].resolve();
  const result = await q.flush();
  assert.equal(result.ok, false);
  assert.deepEqual(result.failed, ["a"]);
});

test("6. a post-flush edit re-enters the queue and persists normally", async () => {
  const { save, calls } = controllableSave();
  const q = createSaveQueue(save);
  q.enqueue("a", draft("v1"));
  await Promise.resolve();
  calls[0].resolve();
  await q.flush();
  // later edit (e.g. after submit)
  q.enqueue("a", draft("v2-after-submit"));
  await Promise.resolve();
  assert.equal(calls[1].text, "v2-after-submit");
  calls[1].resolve();
  const result = await q.flush();
  assert.equal(result.ok, true);
});

test("a thrown save (network) is treated as a failure, not a success", async () => {
  const save: SaveFn = () => Promise.reject(new Error("network"));
  const q = createSaveQueue(save);
  q.enqueue("a", draft("v1"));
  const result = await q.flush();
  assert.equal(result.ok, false);
  assert.deepEqual(result.failed, ["a"]);
});
