import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

import ts from "typescript";

// Execute the actual page handlers with synthetic selections and a controlled
// RPC boundary. This checks interactions without writing production placement.
const source = ts.createSourceFile("page.tsx", readFileSync(new URL("./page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["selectAttendeeAndFocusSite", "handleSiteClick", "handlePlacementKeyDown", "beginPlacement", "assignSelectedToSite", "savePlacement", "assignAttendeeToSite"]);
const bodies: string[] = [];
let placementActionBody = "";
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) {bodies.push(node.getText(source));}
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "placementAction" && node.initializer && ts.isCallExpression(node.initializer)) {
    placementActionBody = node.initializer.arguments[0].getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(bodies.length, names.size);
const handlers = ts.transpileModule(bodies.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
assert.ok(placementActionBody);

function fixture() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const surface = {};
  const state = {
    Error,
    selectedAttendee: { id: "member-a", pilot_first: "Test", pilot_last: "Member" },
    selectedSite: { id: "site-12", master_site_id: "master-12", site_number: "12", assigned_attendee_id: null as string | null },
    sites: [
      { id: "site-10", master_site_id: "master-10", site_number: "10", assigned_attendee_id: null as string | null },
      { id: "site-12", master_site_id: "master-12", site_number: "12", assigned_attendee_id: null as string | null },
    ],
    latestMemberReportByAttendee: {} as Record<string, { matched_master_site_id: string | null; raw_reported_value: string }>,
    selectedAttendeeId: "",
    selectedAttendeeSite: undefined as string | undefined,
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
    actionRevealed: false,
    errors: [] as string[],
    placementKeyboardRef: { current: { focus: (options: unknown) => { state.focusOptions = options; } } },
    setSelectedSiteId: (id: string) => { state.selectedId = id; },
    setSelectedAttendeeId: (id: string) => { state.selectedAttendeeId = id; },
    placementActionRef: { current: { scrollIntoView: () => { state.actionRevealed = true; } } },
    runAfterLayout: (callback: () => void) => callback(),
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

function selectReportedAttendee(f: ReturnType<typeof fixture>) {
  f.context.selectAttendeeAndFocusSite("member-a");
  // Resolve the next render's selected site and action from the real callback.
  Object.assign(f.state, {
    selectedSite: f.state.sites.find((site) => site.id === f.state.selectedId || site.master_site_id === f.state.selectedId) || null,
    selectedAttendeeSite: f.state.siteLabelByAttendeeId.get("member-a"),
  });
  f.state.placementAction = vm.runInContext(`(${placementActionBody})()`, f.context);
  return f.state.placementAction as { enabled: boolean; label: string };
}

test("selecting a reported attendee prepares Assign and reveals it, with no write until staff activates it", async () => {
  const f = fixture();
  f.state.latestMemberReportByAttendee["member-a"] = { matched_master_site_id: "master-10", raw_reported_value: "10" };
  const action = selectReportedAttendee(f);
  assert.equal(f.state.selectedAttendeeId, "member-a");
  assert.equal(f.state.selectedId, "site-10");
  assert.equal(action.label, "Assign to selected site");
  assert.equal(action.enabled, true);
  assert.equal(f.state.actionRevealed, true);
  assert.equal(f.calls.length, 0);
  f.context.beginPlacement();
  await settle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, "record_site_placement");
  assert.equal(f.calls[0].args.p_site_id, "site-10");
  assert.equal(f.calls[0].args.p_action, "assign");
});

test("an occupied reported destination still requires conflict review", async () => {
  const f = fixture();
  f.state.latestMemberReportByAttendee["member-a"] = { matched_master_site_id: "master-10", raw_reported_value: "10" };
  f.state.sites[0].assigned_attendee_id = "member-b";
  assert.equal(selectReportedAttendee(f).label, "Review conflict");
  f.context.beginPlacement();
  await settle();
  assert.ok(f.state.placementConfirmation);
  assert.equal(f.calls.length, 0);
});

test("a canonical placement takes precedence over a different reported destination", () => {
  const f = fixture();
  f.state.siteLabelByAttendeeId.set("member-a", "12");
  f.state.latestMemberReportByAttendee["member-a"] = { matched_master_site_id: "master-10", raw_reported_value: "10" };
  assert.equal(selectReportedAttendee(f).label, "Confirm placement");
  assert.equal(f.state.selectedId, "site-12");
  assert.equal(f.calls.length, 0);
});

test("unmatched and historical-map reports do not guess by label or retain a previous destination", () => {
  for (const matchedId of [null, "other-map-site-10"]) {
    const f = fixture();
    f.state.latestMemberReportByAttendee["member-a"] = { matched_master_site_id: matchedId, raw_reported_value: "10" };
    f.state.selectedId = "site-12";
    const action = selectReportedAttendee(f);
    assert.equal(f.state.selectedId, "");
    assert.equal(action.enabled, false);
    assert.equal(action.label, "Select destination site");
    assert.equal(f.calls.length, 0);
  }
});

test("a member without a report retains the existing site-first selection workflow", () => {
  const f = fixture();
  f.state.selectedId = "site-12";
  assert.equal(selectReportedAttendee(f).label, "Assign to selected site");
  assert.equal(f.state.selectedId, "site-12");
  assert.equal(f.calls.length, 0);
});

test("selection of a matched template site never materializes inventory", () => {
  const f = fixture();
  f.state.sites[0].id = "";
  f.state.latestMemberReportByAttendee["member-a"] = { matched_master_site_id: "master-10", raw_reported_value: "10" };
  assert.equal(selectReportedAttendee(f).enabled, true);
  assert.equal(f.state.selectedId, "master-10");
  assert.equal(f.calls.length, 0);
});

test("combined confirmation uses one RPC for arrival and placement, including template sites", async () => {
  for (const siteId of ["site-12", null]) {
    const f = fixture();
    Object.assign(f.state.selectedSite, { id: siteId });
    f.context.beginPlacement(true);
    await settle();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].name, "confirm_attendee_arrived_and_parked");
    assert.equal(f.calls[0].args.p_expected_event_id, "event-a");
    assert.equal(f.calls[0].args.p_master_site_id, "master-12");
    assert.equal(f.calls[0].args.p_site_id, siteId);
    assert.equal(f.calls[0].args.p_override_occupied_site, false);
    assert.equal("p_share_with_attendees" in f.calls[0].args, false);
  }
});

test("combined occupied-site confirmation retains arrival intent through review", async () => {
  const f = fixture();
  f.state.selectedSite.assigned_attendee_id = "member-b";
  f.context.beginPlacement(true);
  assert.equal(f.calls.length, 0);
  const confirmation = f.state.placementConfirmation as { confirmArrival: boolean; attendee: unknown; site: unknown };
  assert.equal(confirmation.confirmArrival, true);
  await f.context.savePlacement({ ...confirmation, allowOverride: true });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, "confirm_attendee_arrived_and_parked");
  assert.equal(f.calls[0].args.p_override_occupied_site, true);
});

test("combined rejection makes no separate arrival request and releases the retry guard", async () => {
  const f = fixture();
  f.state.supabase.rpc = async (name, args) => {
    f.calls.push({ name, args });
    return { data: [{ outcome: "rejected", rejection_code: "registration_not_current" }], error: null };
  };
  f.context.beginPlacement(true);
  await settle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.state.errors[0], "registration_not_current");
  assert.equal(f.state.placementInFlightRef.current, false);
});

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
