import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

import ts from "typescript";

// Execute the actual page handlers with synthetic selections and a controlled
// RPC boundary. This checks interactions without writing production placement.
const source = ts.createSourceFile("page.tsx", readFileSync(new URL("./page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["handleSiteClick", "handlePlacementKeyDown", "beginPlacement", "assignSelectedToSite", "savePlacement", "assignAttendeeToSite"]);
const bodies: string[] = [];
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) {bodies.push(node.getText(source));}
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(bodies.length, names.size);
const handlers = ts.transpileModule(bodies.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const surface = {};
  const state = {
    selectedAttendee: { id: "member-a", pilot_first: "Test", pilot_last: "Member" },
    selectedSite: { id: "site-12", site_number: "12", assigned_attendee_id: null as string | null },
    attendees: [{ id: "member-b", pilot_first: "Other", pilot_last: "Member" }],
    event: { id: "event-a" },
    getCurrentAdminEvent: () => ({ id: "event-a" }),
    siteMatchKey: (value?: string) => value || "",
    siteLabelByAttendeeId: new Map<string, string>(),
    selectionStale: null as string | null,
    placementConfirmation: null as unknown,
    clearConfirmation: null as unknown,
    placementAction: { enabled: true },
    placementInFlightRef: { current: false },
    selectionFingerprintRef: { current: null },
    loading: false,
    saving: false,
    focusOptions: null as unknown,
    selectedId: "",
    errors: [] as string[],
    placementKeyboardRef: { current: { focus: (options: unknown) => { state.focusOptions = options; } } },
    setSelectedSiteId: (id: string) => { state.selectedId = id; },
    setSelectionStale: (value: null) => { state.selectionStale = value; },
    setPlacementSaving: (value: boolean) => { state.saving = value; },
    setPlacementConfirmation: (value: unknown) => { state.placementConfirmation = value; },
    showError: (message: string) => { state.errors.push(message); },
    showStatus: () => {},
    setLastAction: () => {},
    focusSite: () => {},
    loadPage: async () => {},
    newSitePlacementIdempotencyKey: () => "test-key",
    mapSitePlacementError: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
    supabase: { rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: [{ outcome: "applied" }], error: null };
    } },
  };
  const context = vm.createContext(state);
  vm.runInContext(handlers, context);
  function enter(overrides: Record<string, unknown> = {}) {
    const e = { target: surface, currentTarget: surface, key: "Enter", nativeEvent: { isComposing: false }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...overrides };
    context.handlePlacementKeyDown(e);
    return e;
  }
  return { state, context, calls, enter };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("site selection focuses without scrolling; Enter uses the governed assignment", async () => {
  const f = fixture();
  f.context.handleSiteClick(f.state.selectedSite);
  assert.equal(f.state.selectedId, "site-12");
  assert.equal(JSON.stringify(f.state.focusOptions), '{"preventScroll":true}');
  assert.equal(f.enter().defaultPrevented, true);
  await settle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, "record_site_placement");
  assert.equal(f.calls[0].args.p_action, "assign");
  assert.equal(f.calls[0].args.p_site_id, "site-12");
  assert.equal(f.state.saving, false);
});

test("Enter confirms an existing placement and moves a different placement", async () => {
  for (const [current, action] of [["12", "confirm"], ["11", "reassign"]]) {
    const f = fixture();
    f.state.siteLabelByAttendeeId.set("member-a", current);
    f.enter(); await settle();
    assert.equal(f.calls[0].args.p_action, action);
  }
});

test("an occupied site opens review and Enter cannot bypass the dialog", async () => {
  const f = fixture();
  f.state.selectedSite.assigned_attendee_id = "member-b";
  f.enter(); f.enter(); await settle();
  assert.ok(f.state.placementConfirmation);
  assert.equal(f.enter({ target: {}, repeat: true }).defaultPrevented, true);
  assert.equal(f.enter({ target: {}, repeat: false }).defaultPrevented, false);
  assert.equal(f.calls.length, 0);
});

test("typing, native controls, held keys, composition and modified Enter do not save", () => {
  for (const override of [{ target: {} }, { key: " " }, { repeat: true }, { defaultPrevented: true }, { nativeEvent: { isComposing: true } }, ...["altKey", "ctrlKey", "metaKey", "shiftKey"].map((key) => ({ [key]: true }))]) {
    const f = fixture(); f.enter(override);
    assert.equal(f.calls.length, 0);
  }
});

test("loading, missing selection, stale state, dialogs and changed Event cannot save", () => {
  for (const update of [{ loading: true }, { placementAction: { enabled: false } }, { selectedAttendee: null }, { selectedSite: null }, { selectionStale: "Changed" }, { clearConfirmation: {} }, { placementConfirmation: {} }, { getCurrentAdminEvent: () => ({ id: "event-b" }) }]) {
    const f = fixture(); Object.assign(f.state, update); f.enter();
    assert.equal(f.calls.length, 0);
  }
});

test("rapid Enter/button activation makes only one in-flight request", async () => {
  const f = fixture();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const rpc = f.state.supabase.rpc;
  f.state.supabase.rpc = async (name, args) => { const result = await rpc(name, args); await pending; return result; };
  f.enter(); f.enter(); f.context.beginPlacement();
  assert.equal(f.calls.length, 1);
  assert.equal(f.state.saving, true);
  finish(); await settle();
  assert.equal(f.state.saving, false);
  assert.equal(f.state.placementInFlightRef.current, false);
});

test("a failed request releases the save guard so the user can retry", async () => {
  const f = fixture();
  const rpc = f.state.supabase.rpc;
  f.state.supabase.rpc = async () => { throw new Error("Connection failed"); };
  f.enter(); await settle();
  assert.equal(f.state.errors[0], "Connection failed");
  assert.equal(f.state.placementInFlightRef.current, false);
  f.state.supabase.rpc = rpc;
  f.enter(); await settle();
  assert.equal(f.calls.length, 1);
});
