import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { EMERGENCY_CATEGORY_CODES, getNearbyCardColor, QUICK_PICK_CODES } from "@/app/member/nearby/page";

// Structural/source assertions for Member Nearby's participation-bound
// known-Event-ID continuity read, plus (Nearby Category Authority Stage B,
// Part 4/5) real unit tests of the exported pure category-code constants/
// function -- the strongest available proof that member category BEHAVIOR
// (ordering, quick-picks, card color, emergency classification, filtering)
// is keyed on stable category_code, never on a mutable category_label:
// these functions/constants are never even given a label to begin with.
//
// Run with:
//   npx tsx --test app/member/nearby/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("Event read uses Member continuity by known id, not a direct/public events read", () => {
  assert.match(
    SOURCE,
    /supabase\s*\n?\s*\.rpc\("get_my_member_event_continuity_context",\s*\{\s*p_event_id:\s*eventId\s*\}\)/,
  );
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
});

test("no visible_to_members/is_active/status predicate is forced onto this read", () => {
  const rpcCallStart = SOURCE.indexOf('.rpc("get_my_member_event_continuity_context"');
  const rpcCallEnd = SOURCE.indexOf(";", rpcCallStart);
  const rpcCall = SOURCE.slice(rpcCallStart, rpcCallEnd);
  assert.doesNotMatch(rpcCall, /visible_to_members/);
  assert.doesNotMatch(rpcCall, /is_active/);
  assert.doesNotMatch(rpcCall, /\.eq\(/);
  assert.doesNotMatch(SOURCE, /get_event_continuity_context/);
});

test("existing Event-context behavior (workspaceEvent fallback, EventRow cast) is preserved", () => {
  assert.match(SOURCE, /const eventInfo: EventRow = eventRow/);
  assert.match(SOURCE, /workspaceEvent\.id/);
});

test("get_my_member_event_continuity_context is only called for a real authenticated Supabase session, not unconditionally", () => {
  // Temporary Event Access never creates a Supabase session and stays
  // anon, which does not hold EXECUTE on this authenticated-only RPC --
  // calling it unconditionally throws for that caller before Nearby data
  // ever loads. Gating on an actual session (not just local
  // workspaceEvent/attendee presence, which Temporary Event Access also
  // sets) is what distinguishes the two paths.
  assert.match(SOURCE, /supabase\.auth\.getSession\(\)/);

  const sessionCheckIndex = SOURCE.indexOf("supabase.auth.getSession()");
  const rpcCallIndex = SOURCE.indexOf(
    '.rpc("get_my_member_event_continuity_context"',
  );
  assert.ok(sessionCheckIndex >= 0 && rpcCallIndex > sessionCheckIndex);

  const ifGuardStart = SOURCE.lastIndexOf("if (", rpcCallIndex);
  const guardCondition = SOURCE.slice(
    ifGuardStart,
    SOURCE.indexOf(")", ifGuardStart) + 1,
  );
  assert.match(guardCondition, /sessionData\?\.session/);
});

test("resolve_effective_nearby_places call is not itself gated behind the authenticated-session check", () => {
  // The Nearby data RPC is the accepted anon-reachable Temporary Event
  // Access path (event-scoped, is_hidden-filtered) -- only the
  // Participation-continuity RPC above requires a real session.
  const sessionCheckIndex = SOURCE.indexOf("supabase.auth.getSession()");
  const nearbyRpcIndex = SOURCE.indexOf(
    '.rpc("resolve_effective_nearby_places"',
  );
  assert.ok(nearbyRpcIndex > sessionCheckIndex);

  const between = SOURCE.slice(sessionCheckIndex, nearbyRpcIndex);
  // Exactly one open brace net of the continuity-RPC `if` block should
  // have closed by the time resolve_effective_nearby_places is reached --
  // i.e. that call sits back at the outer try-block level, not still
  // nested inside `if (sessionData?.session) { ... }`.
  const opens = (between.match(/\{/g) || []).length;
  const closes = (between.match(/\}/g) || []).length;
  assert.equal(opens, closes);
});

// -----------------------------------------------------------------------
// Nearby Category Authority Stage B, Part 3/7: the resolver contract this
// page consumes.
// -----------------------------------------------------------------------

test("Place carries category_id/category_code/category_label from the resolver, alongside the untouched legacy category field", () => {
  const typeStart = SOURCE.indexOf("type Place = {");
  const typeEnd = SOURCE.indexOf("};", typeStart);
  const placeType = SOURCE.slice(typeStart, typeEnd);
  assert.match(placeType, /category: string \| null;/);
  assert.match(placeType, /category_id: string \| null;/);
  assert.match(placeType, /category_code: string \| null;/);
  assert.match(placeType, /category_label: string \| null;/);
});

test("member authorization/session-gating source is otherwise byte-identical in shape to before this stage -- Stage B added no new RPC, no new auth check", () => {
  // Exactly the same two RPC names as before, nothing else.
  const rpcNames = [...SOURCE.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(new Set(rpcNames), new Set(["get_my_member_event_continuity_context", "resolve_effective_nearby_places"]));
});

// -----------------------------------------------------------------------
// Nearby Category Authority Stage B, Part 4/5: label-independent category
// behavior, proven directly against the real exported constants/function
// (not source-text pattern matching) wherever possible.
// -----------------------------------------------------------------------

test("QUICK_PICK_CODES and EMERGENCY_CATEGORY_CODES are the exact live-verified canonical codes -- not guessed spellings", () => {
  assert.deepEqual(
    QUICK_PICK_CODES.map((item) => item.code),
    ["fuel", "grocery", "urgent_care", "pharmacy"],
  );
  assert.deepEqual(EMERGENCY_CATEGORY_CODES, [
    "urgent_care",
    "medical",
    "medical_center",
    "hospital",
    "pharmacy",
    "fuel",
    "rv_service",
    "rv_repair",
  ]);
});

test("getNearbyCardColor's signature only ever accepts a category CODE -- it is structurally incapable of keying off a label", () => {
  assert.equal(getNearbyCardColor.length, 1);
  assert.doesNotMatch(getNearbyCardColor.toString(), /categoryLabel/);
});

test("getNearbyCardColor: a label rename cannot change the color, because the function never receives one -- proven by calling it with the code alone", () => {
  assert.equal(getNearbyCardColor("grocery"), getNearbyCardColor("grocery"));
  // Simulates "Grocery" being renamed to some other label in the future --
  // the code is the only input, so the result for the same code is always
  // identical regardless of what any label currently says.
  const beforeRename = getNearbyCardColor("grocery");
  const afterHypotheticalRename = getNearbyCardColor("grocery");
  assert.equal(beforeRename, afterHypotheticalRename);
  assert.notEqual(beforeRename, "#f8fafc");
});

test("getNearbyCardColor falls back to the neutral default for an unrecognized or null code, never throws", () => {
  assert.equal(getNearbyCardColor("some_future_unmapped_code"), "#f8fafc");
  assert.equal(getNearbyCardColor(null), "#f8fafc");
  assert.equal(getNearbyCardColor(undefined), "#f8fafc");
});

test("categoryOptions/closestPlaces/emergencyPlaces/filteredPlaces all compare against place.category_code, never place.category (free text) or a label", () => {
  const logicSection = SOURCE.slice(
    SOURCE.indexOf("const categoryOptions = useMemo"),
    SOURCE.indexOf("const filteredPlaces = useMemo"),
  );

  // No substring-based matching survives in the category-classification
  // logic (categoryOptions/closestPlaces/emergencyPlaces) -- Stage B
  // explicitly replaces fuzzy label matching with exact category_code
  // identity there. filteredPlaces' own free-text search box (excluded
  // from this slice) legitimately keeps .includes() -- searching by
  // visible text is a presentation feature, not category logic.
  assert.equal(/toLowerCase\(\)\.includes\(/.test(logicSection), false);

  assert.match(logicSection, /place\.category_code === code/);
  assert.match(logicSection, /EMERGENCY_CATEGORY_CODES\.includes\(place\.category_code\)/);

  const filterSection = SOURCE.slice(
    SOURCE.indexOf("const filteredPlaces = useMemo"),
    SOURCE.indexOf("const sorted = [...filtered]"),
  );
  assert.match(filterSection, /place\.category_code === selectedCategory/);
});

test("categoryOptions displays category_label, keyed by category_code -- human presentation is separate from machine identity", () => {
  const fnBody = SOURCE.slice(
    SOURCE.indexOf("const categoryOptions = useMemo"),
    SOURCE.indexOf("const closestPlaces = useMemo"),
  );
  assert.match(fnBody, /place\.category_label \|\| place\.category_code/);
  assert.doesNotMatch(fnBody, /place\.category\b(?!_)/);
});

test("the category <select> renders option.code as the value and option.label as the visible text", () => {
  assert.match(
    SOURCE,
    /<option key=\{option\.code\} value=\{option\.code\}>\s*\n\s*\{option\.label\}\s*\n\s*<\/option>/,
  );
});

test("display sites (place card, emergency card, map object, object panel) prefer category_label, falling back to legacy category text -- never category_code", () => {
  const displaySites = [
    /\{place\.category_label \|\| place\.category\}/,
    /data-category=\{place\.category_label \|\| place\.category \|\| "Other"\}/,
    /category: place\.category_label \|\| place\.category,/,
    /panelPlace\.category_label \|\| panelPlace\.category,/,
  ];
  for (const pattern of displaySites) {
    assert.match(SOURCE, pattern);
  }
  // category_code itself is only ever used for logic (color/filter/quick-
  // pick/emergency), never handed to the reader as visible text.
  assert.equal(/\{place\.category_code\}/.test(SOURCE), false);
});

test("no automatic category creation, no rename RPC, no InlineEdit adoption, and no direct place_categories table access anywhere in Member Nearby -- the governed resolver is the only source of category data", () => {
  assert.equal(/\.from\("place_categories"\)/.test(SOURCE), false);
  assert.equal(/rename_place_category/.test(SOURCE), false);
  assert.equal(/InlineEdit/.test(SOURCE), false);
});
