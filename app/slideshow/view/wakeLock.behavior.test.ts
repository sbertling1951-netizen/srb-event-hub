import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

import ts from "typescript";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const start = source.indexOf("  useEffect(() => {\n    let cancelled = false;", source.indexOf("  const isLive ="));
const end = source.indexOf("  // Audience-safe status text.", start);
const effect = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function sentinel() {
  let releaseListener = () => {};
  return { released: false, releases: 0,
    addEventListener(_event: string, listener: () => void) { releaseListener = listener; },
    async release() { this.releases++; this.released = true; releaseListener(); },
    drop() { this.released = true; releaseListener(); },
  };
}

function harness(live = true, supported = true) {
  const warnings: boolean[] = [];
  const locks: ReturnType<typeof sentinel>[] = [];
  let calls = 0;
  let request: () => Promise<ReturnType<typeof sentinel>> = async () => {
    const lock = sentinel(); locks.push(lock); return lock;
  };
  let cleanup: (() => void) | undefined;
  let tick: (() => void) | undefined;
  let visibility: (() => void) | undefined;
  let timerCleared = false;
  const document = { visibilityState: "visible",
    addEventListener(_event: string, fn: () => void) { visibility = fn; },
    removeEventListener() { visibility = undefined; },
  };
  const navigator = supported ? { wakeLock: { request: () => { calls++; return request(); } } } : {};
  const context = vm.createContext({ document, navigator, isLive: live,
    setWakeLockUnavailable: (value: boolean) => warnings.push(value),
    useEffect: (fn: () => (() => void) | undefined) => { cleanup = fn(); },
    window: { setInterval(fn: () => void, delay: number) { assert.equal(delay, 5000); tick = fn; return 1; },
      clearInterval() { timerCleared = true; tick = undefined; } },
  });
  return { warnings, locks, get calls() { return calls; }, get timerCleared() { return timerCleared; },
    start: () => vm.runInContext(effect, context), tick: () => tick?.(), cleanup: () => cleanup?.(),
    visibility(value: string) { document.visibilityState = value; visibility?.(); },
    requestWith(fn: typeof request) { request = fn; },
  };
}

test("a live viewer holds one lock and reacquires a released lock on the bounded retry", async () => {
  const h = harness(); h.start(); await settle();
  h.tick(); h.visibility("visible"); await settle(); assert.equal(h.calls, 1);
  h.locks[0].drop(); assert.equal(h.warnings.at(-1), true);
  h.tick(); await settle(); assert.equal(h.calls, 2); assert.equal(h.warnings.at(-1), false);
  h.cleanup(); assert.equal(h.locks[1].releases, 1); assert.equal(h.timerCleared, true);
});

test("denied protection is reported and can recover without interrupting playback", async () => {
  const h = harness(); h.requestWith(async () => { throw new Error("NotAllowedError"); });
  h.start(); await settle(); assert.equal(h.warnings.at(-1), true);
  const lock = sentinel(); h.requestWith(async () => lock); h.tick(); await settle();
  assert.equal(h.warnings.at(-1), false); h.cleanup(); assert.equal(lock.releases, 1);
});

test("hidden viewers do not request protection and visible viewers reacquire it", async () => {
  const h = harness(); h.visibility("hidden"); h.start(); h.tick(); await settle();
  assert.equal(h.calls, 0); h.visibility("visible"); await settle(); assert.equal(h.calls, 1);
  h.visibility("hidden"); h.locks[0].drop(); h.tick(); await settle(); assert.equal(h.calls, 1);
  h.visibility("visible"); await settle(); assert.equal(h.calls, 2); h.cleanup();
});

test("End or unmount releases a late acquisition without changing abandoned UI", async () => {
  const h = harness(); const lock = sentinel(); let resolve!: (lock: ReturnType<typeof sentinel>) => void;
  h.requestWith(() => new Promise((done) => { resolve = done; }));
  h.start(); h.tick(); h.visibility("visible"); assert.equal(h.calls, 1);
  h.cleanup(); const count = h.warnings.length; resolve(lock); await settle();
  assert.equal(lock.releases, 1); assert.equal(h.warnings.length, count); assert.equal(h.timerCleared, true);
});

test("hiding during acquisition releases the late lock and permits recovery", async () => {
  const h = harness(); const lock = sentinel(); let resolve!: (lock: ReturnType<typeof sentinel>) => void;
  h.requestWith(() => new Promise((done) => { resolve = done; })); h.start(); h.visibility("hidden");
  resolve(lock); await settle(); assert.equal(lock.releases, 1);
  h.requestWith(async () => sentinel()); h.visibility("visible"); await settle(); assert.equal(h.calls, 2); h.cleanup();
});

test("unsupported browsers report unavailable protection; ended shows never request a lock", () => {
  const unsupported = harness(true, false); unsupported.start(); assert.equal(unsupported.warnings.at(-1), true);
  assert.equal(unsupported.calls, 0);
  const ended = harness(false); ended.start(); ended.tick(); assert.equal(ended.calls, 0);
  assert.equal(ended.warnings.at(-1), false);
});
