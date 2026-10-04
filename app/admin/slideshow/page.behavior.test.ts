import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

import ts from "typescript";

import { presentationFrame } from "../../../lib/presentationPlayback";
import { SLIDESHOW_AUDIENCE_MESSAGES, STORAGE_KEYS } from "../../../lib/storageKeys";

// Execute actual page functions/effects, with only the network, React state,
// clock and windows replaced. Browser coverage separately checks reconciliation
// and decoding in two real windows.
const presenter = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const viewer = readFileSync(new URL("../../slideshow/view/page.tsx", import.meta.url), "utf8");
const transpile = (code: string) => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const SID = "11111111-1111-4111-8111-111111111111";
const LINK = "22222222-2222-4222-8222-222222222222";
const PHOTO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PHOTO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const row = { id: SID, event_id: "event-A", status: "live", current_index: 0, state_version: 1, playback_state: "playing" };
const frame = (version = 1) => ({ session_active: true, playback_state: "playing", state_version: version,
  sequence_number: 0, item_count: 2, current_content_type: "photo", current_content_ref_id: PHOTO_A,
  next_content_type: "photo", next_content_ref_id: PHOTO_B });

function functions() {
  const ast = ts.createSourceFile("page.tsx", presenter, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(["clearPreview", "loadSessionItems", "loadLiveSession"]);
  const chunks: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => names.has(d.name.getText(ast)))) { chunks.push(node.getText(ast)); }
    if (ts.isFunctionDeclaration(node) && node.name && ["acceptSessionRow", "handleStart", "runControl"].includes(node.name.text)) { chunks.push(node.getText(ast)); }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return chunks.join("\n");
}

function presenterHarness() {
  const updates: unknown[] = [];
  let state: unknown;
  let itemReads = 0;
  let publicReads = 0;
  let read: () => Promise<unknown> = async () => ({ data: [frame()], error: null });
  const effects: Array<() => void> = [];
  const intervals: Array<() => void> = [];
  const context = vm.createContext({
    console, presentationFrame, SESSION_REFRESH_INTERVAL_MS: 1000,
    selectedDeckId: "deck-A", busy: false, eventId: "event-A", session: row,
    setBusy() {}, showStatus() {}, showError() {},

    stateGenerationRef: { current: 0 }, acceptedSessionRef: { current: null },
    eventIdRef: { current: "event-A" }, loadedItemsSessionRef: { current: null }, previewRef: { current: null },
    publishPreview: (_sessionId: string, value: unknown) => updates.push(value),
    setPreview: () => {}, setItems: () => {}, setSession: (value: unknown) => { state = value; },
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => () => void) => { effects.push(fn()); },
    setInterval: (fn: () => void) => intervals.push(fn), clearInterval: () => {},
    supabase: {
      rpc: async () => { publicReads++; return read(); },
      from: () => {
        const query = { select: () => query, eq: () => query,
          maybeSingle: async () => ({ data: row, error: null }),
          order: async () => { itemReads++; return { data: [], error: null }; } };
        return query;
      },
    },
  });
  vm.runInContext(transpile(functions()), context);
  const start = presenter.indexOf('  useEffect(() => {\n    if (!eventId || session?.status !== "live")');
  const end = presenter.indexOf("  // A presenter-opened audience window", start);
  return { updates, context, get state() { return state as typeof row; }, get itemReads() { return itemReads; }, get publicReads() { return publicReads; },
    readWith(fn: typeof read) { read = fn; },
    load: () => vm.runInContext('loadLiveSession("event-A")', context) as Promise<void>,
    heartbeat() {
      vm.runInContext(transpile(`(function(){const eventId="event-A"; const session=${JSON.stringify(row)};${presenter.slice(start, end)}})()`), context);
      return { tick: intervals.at(-1)!, cleanup: effects.at(-1)! };
    },
  };
}

test("one server response populates the complete pair, and immutable items are not repeatedly loaded", async () => {
  const h = presenterHarness();
  await h.load(); await h.load();
  assert.equal(h.itemReads, 1);
  assert.equal(h.publicReads, 2); // eligibility is revalidated even while paused
  assert.deepEqual(h.updates.at(-1), presentationFrame(frame()));
});

test("a failed authoritative read clears both displays and recovers at the same position", async () => {
  const h = presenterHarness();
  await h.load();
  h.readWith(async () => ({ data: null, error: new Error("offline") }));
  await h.load(); assert.equal(h.updates.at(-1), null);
  h.readWith(async () => ({ data: [frame()], error: null }));
  await h.load(); assert.equal(h.updates.length, 3);
  assert.deepEqual(h.updates.at(-1), presentationFrame(frame()));
});

test("a delayed old Event read cannot publish after context changes", async () => {
  const h = presenterHarness();
  let resolve!: (value: unknown) => void;
  h.readWith(() => new Promise((r) => { resolve = r; }));
  const pending = h.load(); await settle();
  h.context.stateGenerationRef.current++;
  h.context.eventIdRef.current = "event-B";
  resolve({ data: [frame()], error: null }); await pending;
  assert.equal(h.updates.length, 0);
});

test("a server response older than an accepted command cannot regress either display", async () => {
  const h = presenterHarness();
  h.context.acceptedSessionRef.current = { id: SID, version: 3 };
  const generation = h.context.stateGenerationRef.current;
  await vm.runInContext(`loadSessionItems(${JSON.stringify({ ...row, state_version: 3 })}, ${generation})`, h.context);
  assert.equal(h.updates.length, 0);
});

test("a heartbeat cannot overlap and cleanup discards its pending frame after End, restart or unmount", async () => {
  for (const reason of ["End", "restart", "unmount"]) {
    const h = presenterHarness(); let resolve!: (value: unknown) => void;
    h.readWith(() => new Promise((r) => { resolve = r; }));
    const effect = h.heartbeat(); effect.tick(); await settle(); effect.tick();
    assert.equal(h.publicReads, 1, reason);
    effect.cleanup(); resolve({ data: [frame()], error: null }); await settle();
    assert.equal(h.updates.length, 0, reason);
  }
});

test("delayed Start and control responses cannot publish into a newly selected Event", async () => {
  for (const action of ['handleStart()', 'runControl("next_presentation_slide", "", "")']) {
    const h = presenterHarness(); let resolve!: (value: unknown) => void;
    h.readWith(() => new Promise((r) => { resolve = r; }));
    const pending = vm.runInContext(action, h.context);
    h.context.eventIdRef.current = "event-B";
    resolve({ data: row, error: null }); await pending;
    assert.equal(h.updates.length, 0);
    assert.equal(h.state, undefined);
  }
});

function jumpHarness(response: { data: unknown; error: unknown }) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const h = presenterHarness();
  let reconciled = 0;
  Object.assign(h.context, {
    session: { ...row, deck_id: "deck-A", current_index: 0, state_version: 5 },
    reconcileAfterStaleVersion: async () => { reconciled++; },
    isStalePresentationVersionError: (err: { message?: string }) => err?.message === "stale_version",
    loadDecks() {}, setSelectedDeckId() {}, setRestartCandidateDeckId() {}, setStatus() {}, setError() {},
  });
  h.context.supabase = { ...h.context.supabase, rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return name === "jump_presentation_slide" ? response : { data: [frame()], error: null };
  } };
  return { calls, get state() { return h.state; }, get reconciled() { return reconciled; },
    jump: (n: number) => vm.runInContext(`runControl("jump_presentation_slide", "", "", { p_sequence_number: ${n} })`, h.context) as Promise<void> };
}

test("a dot makes one atomic jump with the known version and adopts the server row, paused or playing", async () => {
  for (const playback_state of ["playing", "paused"]) {
    const moved = { ...row, deck_id: "deck-A", current_index: 2, state_version: 6, playback_state };
    const h = jumpHarness({ data: moved, error: null });
    await h.jump(2);
    const jumps = h.calls.filter((call) => call.name === "jump_presentation_slide");
    assert.equal(jumps.length, 1);
    assert.equal(JSON.stringify(jumps[0].args), JSON.stringify({ p_session_id: SID, p_expected_version: 5, p_sequence_number: 2 }));
    assert.equal(h.calls.some((call) => /next_presentation_slide|previous_presentation_slide/.test(call.name)), false);
    assert.equal(h.state.current_index, 2);
    assert.equal(h.state.playback_state, playback_state);
  }
});

test("a stale jump reconciles with the server instead of adopting a guessed position", async () => {
  const h = jumpHarness({ data: null, error: { message: "stale_version" } });
  await h.jump(3);
  assert.equal(h.reconciled, 1);
  assert.equal(h.state, undefined);
});

// The presenter's status-answer effect, run against an opened audience window.
function pairingHarness(liveSessionId: string | null) {
  const win: Record<string, unknown> = {};
  const audience = { opener: win, sent: [] as unknown[], postMessage(message: unknown) { this.sent.push(message); } };
  let handler!: (event: unknown) => void;
  const lookups: Array<() => void> = [];
  Object.assign(win, { location: { origin: "https://fixture.invalid" },
    addEventListener: (_: string, fn: typeof handler) => { handler = fn; }, removeEventListener() {} });
  const context = vm.createContext({
    eventId: "event-A", liveSessionId, window: win, audienceWindows: new Map(), audienceLinkFor: () => LINK,
    SLIDESHOW_AUDIENCE_MESSAGES, previewRef: { current: null }, Date,
    loadLiveSession: () => new Promise<void>((resolve) => lookups.push(resolve)),
    useEffect: (fn: () => void) => { fn(); },
  });
  const start = presenter.indexOf("  useEffect(() => {\n    if (!eventId) {\n      return;\n    }\n    const link = audienceLinkFor(eventId);");
  const end = presenter.indexOf("  // Reuse this Event's audience window", start);
  vm.runInContext(transpile(presenter.slice(start, end)), context);
  const report = (sessionId: string, source: object = audience) => handler({ origin: "https://fixture.invalid", source,
    data: { type: SLIDESHOW_AUDIENCE_MESSAGES.status, link: LINK, sessionId } });
  return { audience, lookups, report };
}

test("an audience left on an ended show resumes when the show is restarted from another presenter tab", async () => {
  const RESTARTED = "33333333-3333-4333-8333-333333333333";
  // This tab ended the show; its audience still reports the ended session.
  const ended = pairingHarness(null);
  ended.report(SID); ended.report(SID);
  assert.equal(ended.lookups.length, 1); // one governed lookup at a time
  ended.lookups[0](); await settle();
  ended.report(SID);
  assert.equal(ended.lookups.length, 2);
  // A window this tab did not open cannot drive lookups.
  ended.report(SID, { opener: {}, postMessage() {} });
  assert.equal(ended.lookups.length, 2);
  // The lookup found the restarted session: the same window is handed it.
  const restarted = pairingHarness(RESTARTED);
  restarted.report(SID);
  assert.equal(restarted.lookups.length, 0);
  assert.equal(JSON.stringify(restarted.audience.sent),
    JSON.stringify([{ type: SLIDESHOW_AUDIENCE_MESSAGES.session, link: LINK, sessionId: RESTARTED }]));
});

function audienceHarness() {
  let now = 0;
  let reads = 0;
  let state: unknown;
  let error: unknown;
  let respond: () => Promise<unknown> = async () => ({ data: [frame()], error: null });
  let handler!: (event: unknown) => void;
  let tick!: () => Promise<void>;
  let cleanup!: () => void;
  const opener = { postMessage() {} };
  const start = viewer.indexOf('  useEffect(() => {\n    if (!sessionId)');
  const end = viewer.indexOf('  // Caption/photographer supplement.', start);
  const context = vm.createContext({
    console, sessionId: SID, link: LINK, UUID_PATTERN: /^[0-9a-f-]{36}$/i,
    presentationFrame, SLIDESHOW_AUDIENCE_MESSAGES, POLL_INTERVAL_MS: 1000,
    Date: { now: () => now }, setPublicState: (v: unknown) => { state = v; }, setPollError: (v: unknown) => { error = v; },
    useEffect: (fn: () => () => void) => { cleanup = fn(); },
    window: { opener, location: { origin: "https://fixture.invalid" },
      addEventListener: (_: string, fn: typeof handler) => { handler = fn; }, removeEventListener() {},
      setInterval: (fn: typeof tick) => { tick = fn; }, clearInterval() {}, },
    supabase: { rpc: async () => { reads++; return respond(); } },
  });
  vm.runInContext(transpile(viewer.slice(start, end)), context);
  const send = (value: unknown, override = {}) => handler({ origin: "https://fixture.invalid", source: opener,
    data: { type: SLIDESHOW_AUDIENCE_MESSAGES.frame, link: LINK, sessionId: SID, frame: value }, ...override });
  return { send, tick: () => tick(), cleanup: () => cleanup(), setTime: (value: number) => { now = value; },
    readWith: (fn: typeof respond) => { respond = fn; },
    get reads() { return reads; }, get state() { return state as ReturnType<typeof frame>; }, get error() { return error; } };
}

test("paired audience consumes the exact pair and makes no independent playback read", async () => {
  const h = audienceHarness(); h.send(frame()); await h.tick();
  assert.equal(h.reads, 0);
  assert.deepEqual(h.state, presentationFrame(frame()));
  assert.equal(h.error, null);
});

test("foreign origin, non-opener, wrong link and wrong session cannot take over or suppress polling", async () => {
  for (const override of [
    { origin: "https://other.invalid" }, { source: {} },
    { data: { type: SLIDESHOW_AUDIENCE_MESSAGES.frame, link: "wrong", sessionId: SID, frame: frame() } },
    { data: { type: SLIDESHOW_AUDIENCE_MESSAGES.frame, link: LINK, sessionId: LINK, frame: frame() } },
  ]) {
    const h = audienceHarness(); h.send(frame(9), override); await h.tick();
    assert.equal(h.reads, 1); assert.equal(h.state.state_version, 1);
  }
});

test("an independent poll already in flight cannot overwrite a newly paired frame", async () => {
  const h = audienceHarness(); let resolve!: (value: unknown) => void;
  h.readWith(() => new Promise((r) => { resolve = r; }));
  const pending = h.tick(); h.send(frame(3));
  resolve({ data: [frame()], error: null }); await pending;
  assert.equal(h.state.state_version, 3);
});

test("older frames cannot regress Current and an ended session cannot be resurrected", () => {
  const h = audienceHarness(); h.send(frame(3)); h.send(frame(2));
  assert.equal(h.state.state_version, 3);
  h.send({ session_active: false }); h.send(frame(4));
  assert.equal(h.state.session_active, false);
});

test("lost presenter resumes server reads; denied/ended state clears the photos", async () => {
  const h = audienceHarness(); h.send(frame());
  h.setTime(3001); h.readWith(async () => ({ data: [{ session_active: false }], error: null }));
  await h.tick(); assert.equal(h.reads, 1); assert.equal(h.state.session_active, false);
  assert.equal(h.state.current_content_ref_id, null);
});

test("relayed frames cannot contain image URLs, storage paths or credential fields", () => {
  const input = { ...frame(), storage_path: "secret", current_storage_path: "secret", url: "https://arbitrary.invalid", token: "secret" };
  const value = presentationFrame(input);
  assert.equal(JSON.stringify(value).includes("secret"), false);
  assert.equal(JSON.stringify(value).includes("arbitrary"), false);
  assert.equal(presentationFrame({ ...frame(), current_content_ref_id: "not-an-id" }), null);
});


test("audience opening requests the selected window mode, preserves its opener, and reuses an open screen", () => {
  const start = presenter.indexOf("  function openAudienceScreen()");
  const end = presenter.indexOf("  // Reconcile after a stale state_version conflict", start);
  for (const mode of ["tab", "window"]) {
    const calls: unknown[][] = [];
    const messages: unknown[] = [];
    const audience = { closed: false, document: {}, focus() {}, postMessage(message: unknown) { messages.push(message); } };
    const context = vm.createContext({ eventId: "event-A", liveSessionId: SID, audienceDisplayMode: mode,
      audienceLinkFor: () => LINK, audienceWindows: new Map(), SLIDESHOW_AUDIENCE_MESSAGES,
      window: { location: { origin: "https://fixture.invalid" }, open: (...args: unknown[]) => { calls.push(args); return audience; } },
      showError: (message: string) => { throw new Error(message); } });
    vm.runInContext(transpile(presenter.slice(start, end)), context);
    vm.runInContext("openAudienceScreen(); openAudienceScreen();", context);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], `/slideshow/view?session=${SID}&link=${LINK}`);
    assert.equal(calls[0][1], LINK);
    assert.equal(calls[0][2], mode === "window" ? "popup=yes,width=1280,height=800" : undefined);
    assert.equal(messages.length, 1);
    audience.closed = true;
    vm.runInContext("openAudienceScreen();", context);
    assert.equal(calls.length, 2);
  }
});

test("the audience display preference survives a presenter remount and unavailable storage still permits selection", () => {
  const start = presenter.indexOf('  const [audienceDisplayMode, setAudienceDisplayMode]');
  const end = presenter.indexOf('  const [decks, setDecks]', start);
  const stored = new Map<string, string>();
  for (const unavailable of [false, true]) {
    const values: unknown[] = [];
    const context = vm.createContext({ STORAGE_KEYS,
      window: { localStorage: {
        getItem: (key: string) => { if (unavailable) { throw new Error("blocked"); } return stored.get(key); },
        setItem: (key: string, value: string) => { if (unavailable) { throw new Error("blocked"); } stored.set(key, value); },
      } },
      useState: (initial: unknown) => [initial, (value: unknown) => values.push(value)],
      useEffect: (effect: () => void) => effect(),
    });
    vm.runInContext(transpile(presenter.slice(start, end)), context);
    vm.runInContext('changeAudienceDisplayMode("window")', context);
    assert.equal(values.at(-1), "window");
    if (!unavailable) {
      values.length = 0;
      vm.runInContext(transpile(`(function(){${presenter.slice(start, end)}})()`), context);
      assert.equal(values.at(-1), "window");
    }
  }
});
