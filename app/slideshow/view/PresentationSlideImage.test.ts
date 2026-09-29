import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

import ts from "typescript";

// Execute the component's actual effects with controlled network/decode timing.
// The browser fixture separately exercises React reconciliation and real decode.
const code = ts.transpileModule(
  readFileSync(new URL("./PresentationSlideImage.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } },
).outputText;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const imageResponse = (id = "photo-b") => new Response("rendition", {
  headers: { "X-Presentation-Content-Ref": id, "Content-Type": "image/jpeg" },
});

function fixture(options: { response?: () => Promise<Response>; decode?: () => Promise<void> } = {}) {
  type Hook = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
  const hooks: Hook[] = [];
  let cursor = 0;
  let pending: (() => void)[] = [];
  let nextUrl = 0;
  const blobs = new Set<string>();
  const retries = new Set<() => void>();
  const requests: { url: string; cache: string; signal: AbortSignal }[] = [];
  const props = { sessionId: "session-a", contentRefId: "photo-b", slot: "next", caption: null, photographerName: null };
  const exports: Record<string, any> = {};
  const hook = () => hooks[cursor++] ?? (hooks[cursor - 1] = {});
  const react = {
    useState(initial: unknown) {
      const h = hook();
      if (!("value" in h)) { h.value = initial; }
      return [h.value, (value: unknown) => { h.value = value; }];
    },
    useRef(initial: unknown) {
      const h = hook();
      h.value ??= { current: initial };
      return h.value;
    },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const h = hook();
      if (!h.deps || deps.some((dep, i) => !Object.is(dep, h.deps![i]))) {
        h.deps = deps;
        pending.push(() => { h.cleanup?.(); h.cleanup = effect(); });
      }
    },
  };
  vm.runInNewContext(code, {
    exports,
    require(name: string) {
      if (name === "react") { return react; }
      if (name === "react/jsx-runtime") {
        const jsx = (type: string, properties: unknown) => ({ type, properties });
        return { jsx, jsxs: jsx, Fragment: "fragment" };
      }
      throw new Error(`Unexpected dependency: ${name}`);
    },
    AbortController,
    fetch: async (url: string, init: { cache: string; signal: AbortSignal }) => {
      requests.push({ url, ...init });
      return options.response ? options.response() : imageResponse();
    },
    URL: {
      createObjectURL() { const url = `blob:${++nextUrl}`; blobs.add(url); return url; },
      revokeObjectURL(url: string) { blobs.delete(url); },
    },
    Image: class { src = ""; decode() { return options.decode ? options.decode() : Promise.resolve(); } },
    setTimeout(callback: () => void) { retries.add(callback); return callback; },
    clearTimeout(callback: () => void) { retries.delete(callback); },
  });
  function render(slot = props.slot) {
    props.slot = slot;
    cursor = 0;
    const result = exports.default(props);
    const effects = pending;
    pending = [];
    effects.forEach((effect) => effect());
    return result;
  }
  const unmount = () => hooks.forEach((h) => h.cleanup?.());
  return { render, unmount, requests, blobs, retries, get source() { return hooks[0]?.value; } };
}

test("next-to-current promotion keeps the decoded image without a second request", async () => {
  const f = fixture();
  try {
    f.render(); await settle();
    const source = f.source;
    assert.ok(source);
    f.render("current"); await settle();
    assert.equal(f.source, source);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].cache, "no-store");
  } finally { f.unmount(); }
  assert.equal(f.blobs.size, 0);
});

test("a rendition resolved for a different photo is never displayed and retries the latest slot", async () => {
  let correct = false;
  const f = fixture({ response: async () => imageResponse(correct ? "photo-b" : "other-photo") });
  try {
    f.render(); await settle();
    assert.equal(f.source, null);
    assert.equal(f.blobs.size, 0);
    assert.equal(f.retries.size, 1);
    correct = true;
    f.render("current");
    const retry = [...f.retries][0]; f.retries.clear(); retry(); await settle();
    assert.match(f.requests[1].url, /slot=current$/);
    assert.ok(f.source);
  } finally { f.unmount(); }
});

test("failed delivery stays hidden and is cancelled when the slot becomes ineligible", async () => {
  const f = fixture({ response: async () => new Response(null, { status: 404 }) });
  f.render(); await settle();
  assert.equal(f.source, null);
  assert.equal(f.retries.size, 1);
  f.unmount();
  assert.equal(f.retries.size, 0);
  assert.equal(f.requests[0].signal.aborted, true);
});

test("an image is not shown before decode completes", async () => {
  let finish!: () => void;
  const f = fixture({ decode: () => new Promise<void>((resolve) => { finish = resolve; }) });
  try {
    f.render("current"); await settle();
    assert.equal(f.source, null);
    finish(); await settle();
    assert.ok(f.source);
  } finally { f.unmount(); }
});

test("late decode cannot restore a photo after it is removed", async () => {
  let finish!: () => void;
  const f = fixture({ decode: () => new Promise<void>((resolve) => { finish = resolve; }) });
  f.render(); await settle();
  assert.equal(f.blobs.size, 1);
  f.unmount();
  finish(); await settle();
  assert.equal(f.source, null);
  assert.equal(f.blobs.size, 0);
  assert.equal(f.retries.size, 0);
});

test("late response after unmount does not create an object URL", async () => {
  let finish!: (response: Response) => void;
  const f = fixture({ response: () => new Promise<Response>((resolve) => { finish = resolve; }) });
  f.render(); f.unmount(); finish(imageResponse()); await settle();
  assert.equal(f.source, null);
  assert.equal(f.blobs.size, 0);
});
