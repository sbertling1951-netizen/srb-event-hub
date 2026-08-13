import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveShellMode } from "@/components/shell/routeRegistry";

// Focused tests for the Presentation/Slideshow Stage 5 presenter-console
// cutover: the presenter now drives the durable, governed
// presentation_sessions foundation (Stages 2-4) instead of the legacy
// browser-local localStorage command channel. Run with:
//   npx tsx --test app/admin/slideshow/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

const VIEWER_SOURCE = readFileSync(
  fileURLToPath(new URL("../../slideshow/view/page.tsx", import.meta.url)),
  "utf8",
);

// Strips // line comments before checking for a code-level reference, so
// this file's own explanatory comments (which name privilege_group/
// is_super_admin/localStorage keys to explain what's deliberately NOT
// used) don't trip a check meant to catch actual legacy code.
const PAGE_SOURCE_NO_COMMENTS = PAGE_SOURCE.replace(/\/\/.*$/gm, "");

test("presenter page is gated by AdminRouteGuard", () => {
  assert.match(PAGE_SOURCE, /AdminRouteGuard/);
});

test("presenter page resolves event.slideshow.manage via the canonical Task Authority resolver", () => {
  assert.match(PAGE_SOURCE, /has_event_task_authority/);
  assert.match(PAGE_SOURCE, /event\.slideshow\.manage/);
});

test("presenter page contains no legacy role-name authority reimplementation", () => {
  const prohibited: RegExp[] = [
    /privilege_group/,
    /is_super_admin/,
    /\bcan_manage_/,
    /\bcan_[a-z_]*slideshow/i,
  ];
  for (const pattern of prohibited) {
    assert.equal(
      pattern.test(PAGE_SOURCE_NO_COMMENTS),
      false,
      `found prohibited legacy authority pattern: ${pattern}`,
    );
  }
});

test("unauthorized/unchecked access state precedes and short-circuits the active presenter controls", () => {
  const gateIdx = PAGE_SOURCE.indexOf("hasSlideshowAccess !== true");
  const controlIdx = PAGE_SOURCE.indexOf("Show Control");
  assert.notEqual(gateIdx, -1, "expected an explicit hasSlideshowAccess !== true gate");
  assert.notEqual(controlIdx, -1, "expected the Show Control panel to still exist");
  assert.ok(
    gateIdx < controlIdx,
    "the access gate must appear before the active presenter controls in source order",
  );
});

test("no Presentation localStorage command/state transport remains in the presenter", () => {
  const prohibited: RegExp[] = [
    /epix-presentation-state/,
    /epic-presentation-state/,
    /commandAt/,
    /publishPresentationState/,
    /presentationState/,
  ];
  for (const pattern of prohibited) {
    assert.equal(
      pattern.test(PAGE_SOURCE_NO_COMMENTS),
      false,
      `found retired localStorage Presentation transport pattern: ${pattern}`,
    );
  }
  // The interval that remains is a coarse durable-session refetch, not a
  // localStorage poll -- assert no localStorage.getItem/setItem call
  // survives anywhere in the presenter at all.
  assert.equal(/localStorage\.(get|set)Item/.test(PAGE_SOURCE_NO_COMMENTS), false);
});

test("Start routes through start_presentation_session", () => {
  assert.match(PAGE_SOURCE, /rpc\(\s*"start_presentation_session"/);
  assert.match(PAGE_SOURCE, /p_deck_id/);
});

test("Pause routes through pause_presentation_session", () => {
  assert.match(PAGE_SOURCE, /"pause_presentation_session"/);
});

test("Resume routes through resume_presentation_session", () => {
  assert.match(PAGE_SOURCE, /"resume_presentation_session"/);
});

test("Next routes through next_presentation_slide", () => {
  assert.match(PAGE_SOURCE, /"next_presentation_slide"/);
});

test("Previous routes through previous_presentation_slide", () => {
  assert.match(PAGE_SOURCE, /"previous_presentation_slide"/);
});

test("End routes through end_presentation_session", () => {
  assert.match(PAGE_SOURCE, /"end_presentation_session"/);
});

test("presenter's periodic refresh also triggers the governed timed-advance heartbeat (Stage 6A, supplementary, not required)", () => {
  assert.match(PAGE_SOURCE, /"advance_presentation_session_if_due"/);
  assert.match(PAGE_SOURCE, /p_session_id:\s*sessionId/);
});

test("every control RPC call supplies the current state_version as p_expected_version", () => {
  assert.match(PAGE_SOURCE, /p_expected_version:\s*session\.state_version/);
  // runControl is the single shared call site for all five post-start
  // RPCs; assert it is actually used by each of them rather than each
  // duplicating its own (possibly version-less) call.
  const controlNames = [
    "pause_presentation_session",
    "resume_presentation_session",
    "next_presentation_slide",
    "previous_presentation_slide",
    "end_presentation_session",
  ];
  for (const name of controlNames) {
    assert.match(
      PAGE_SOURCE,
      new RegExp(`runControl\\(\\s*"${name}"`),
      `expected ${name} to be invoked through the shared runControl path`,
    );
  }
});

test("stale-version reconciliation path exists and does not blindly retry", () => {
  assert.match(PAGE_SOURCE, /isStalePresentationVersionError/);
  assert.match(PAGE_SOURCE, /stale_version/);
  assert.match(PAGE_SOURCE, /reconcileAfterStaleVersion/);
});

test("presenter performs no direct write to presentation_sessions or presentation_session_items", () => {
  const prohibited: RegExp[] = [
    /\.from\(\s*["']presentation_sessions["']\s*\)\s*\.\s*(update|insert|delete|upsert)/,
    /\.from\(\s*["']presentation_session_items["']\s*\)\s*\.\s*(update|insert|delete|upsert)/,
    /\.from\(\s*["']presentation_decks["']\s*\)\s*\.\s*(update|insert|delete|upsert)/,
    /\.from\(\s*["']presentation_deck_items["']\s*\)\s*\.\s*(update|insert|delete|upsert)/,
  ];
  for (const pattern of prohibited) {
    assert.equal(pattern.test(PAGE_SOURCE), false, `found prohibited direct-write pattern: ${pattern}`);
  }
});

test("presenter reads sessions/decks/items only via select (governed RLS read boundary)", () => {
  assert.match(PAGE_SOURCE, /\.from\(\s*["']presentation_sessions["']\s*\)\s*\n?\s*\.select/);
  assert.match(PAGE_SOURCE, /\.from\(\s*["']presentation_session_items["']\s*\)\s*\n?\s*\.select/);
  assert.match(PAGE_SOURCE, /\.from\(\s*["']presentation_decks["']\s*\)\s*\n?\s*\.select/);
});

test("presenter introduces no direct database Photo mutation and does not call record_photo_display", () => {
  const prohibited: RegExp[] = [
    /\.from\(["']event_photos["']\)\s*\.\s*(update|insert|delete|upsert)/,
    /\.rpc\(["']record_photo_display["']\)/,
    /manage_event_photo/,
  ];
  for (const pattern of prohibited) {
    assert.equal(pattern.test(PAGE_SOURCE), false, `found prohibited pattern: ${pattern}`);
  }
});

test("Open Audience Screen launches with the live session id and is disabled without one", () => {
  assert.match(PAGE_SOURCE, /\/slideshow\/view\?session=\$\{session\.id\}/);
  assert.match(PAGE_SOURCE, /disabled=\{!audienceUrl\}/);
});

// Stage 6 cut the audience viewer over to the durable session model
// (app/slideshow/view/page.test.ts owns the focused assertions for
// that). This test only re-confirms, from the presenter's own test
// file, that the viewer still carries no Admin authority of any kind
// -- the one invariant that predates and survives Stage 6.
test("audience viewer page remains ungated and carries no Admin authority", () => {
  assert.equal(/AdminRouteGuard/.test(VIEWER_SOURCE), false, "viewer must not require Admin auth");
  assert.equal(/has_event_task_authority/.test(VIEWER_SOURCE), false, "viewer must not gain Task Authority checks");
  assert.equal(/privilege_group|is_super_admin/.test(VIEWER_SOURCE), false, "viewer must not gain role-based authority checks");
});

test("photo governance surfaces are untouched by this stage", () => {
  assert.equal(/manage_event_photo/.test(PAGE_SOURCE), false);
  assert.equal(/event\.photos\.(manage|delete)/.test(PAGE_SOURCE), false);
});

// Stage 6B: deck authoring, additive to the existing presenter console.
// Every assertion below targets the same governed RPC surface Stage 3
// already exposed -- no new Presentation table write, no new authority
// model.

test("deck creation routes through create_presentation_deck with the current working Event", () => {
  assert.match(PAGE_SOURCE, /rpc\(\s*\n?\s*"create_presentation_deck"/);
  assert.match(PAGE_SOURCE, /p_event_id:\s*eventId/);
});

test("deck edit routes through update_presentation_deck", () => {
  assert.match(PAGE_SOURCE, /"update_presentation_deck"/);
});

test("deck archive routes through archive_presentation_deck", () => {
  assert.match(PAGE_SOURCE, /"archive_presentation_deck"/);
});

test("creating an all_approved deck never creates deck items or calls add_presentation_deck_photo", () => {
  assert.equal(/add_presentation_deck_photo/.test(PAGE_SOURCE), false);
  assert.equal(
    /\.from\(\s*["']presentation_deck_items["']\s*\)\s*\.\s*insert/.test(PAGE_SOURCE),
    false,
  );
});

test("presenter still performs no direct write to any presentation_decks/presentation_deck_items row", () => {
  const prohibited: RegExp[] = [
    /\.from\(\s*["']presentation_decks["']\s*\)\s*\.\s*(update|insert|delete|upsert)/,
    /\.from\(\s*["']presentation_deck_items["']\s*\)\s*\.\s*(update|insert|delete|upsert)/,
  ];
  for (const pattern of prohibited) {
    assert.equal(pattern.test(PAGE_SOURCE), false, `found prohibited direct-write pattern: ${pattern}`);
  }
});

test("successful deck creation refreshes the deck list and selects the new deck", () => {
  const createIdx = PAGE_SOURCE.indexOf('"create_presentation_deck"');
  const loadDecksCallIdx = PAGE_SOURCE.indexOf("await loadDecks(eventId)", createIdx);
  const selectIdx = PAGE_SOURCE.indexOf("setSelectedDeckId(created.id)", createIdx);
  assert.notEqual(createIdx, -1);
  assert.notEqual(loadDecksCallIdx, -1, "expected the deck list to be refreshed after creation");
  assert.notEqual(selectIdx, -1, "expected the newly created deck to be selected");
  assert.ok(loadDecksCallIdx > createIdx && selectIdx > loadDecksCallIdx);
});

test("no client-side duplicate-deck-name check was invented (duplicate names are allowed by Stage 3 design)", () => {
  assert.equal(/duplicate.*name/i.test(PAGE_SOURCE_NO_COMMENTS), false);
});

test("shell classification is unchanged by deck authoring: /admin/slideshow canonical-admin, /slideshow/view exception", () => {
  assert.equal(resolveShellMode("/admin/slideshow"), "canonical-admin");
  assert.equal(resolveShellMode("/slideshow/view"), "exception");
});

test("all six presenter session-control RPC routes and the deck RPC routes coexist unchanged", () => {
  for (const rpc of [
    "start_presentation_session",
    "pause_presentation_session",
    "resume_presentation_session",
    "next_presentation_slide",
    "previous_presentation_slide",
    "end_presentation_session",
    "create_presentation_deck",
    "update_presentation_deck",
    "archive_presentation_deck",
  ]) {
    assert.match(PAGE_SOURCE, new RegExp(`"${rpc}"`), `expected a call to ${rpc}`);
  }
});

// Presentation next-photo synchronization diagnostic, revised after a
// semantic-ordering review. Two distinct mechanisms, tested separately:
//
// 1. stateGenerationRef -- a request-liveness stamp. Guards against a
//    superseded request's derived work (loadSessionItems' photo/caption
//    resolution) landing after a newer request already started.
//
// 2. acceptSessionRow / acceptedSessionRef -- the actual correctness
//    gate for `session` itself. Request order is not server-state
//    order (runControl claims its generation AFTER its mutation RPC
//    already resolved, so a request that started earlier and claimed
//    an earlier generation can still, correctly by generation rules,
//    describe OLDER server state than one that resolves later). Only a
//    direct comparison against the durable, authoritative
//    `state_version` can guarantee an older version never supersedes a
//    newer one, regardless of which request started or finished more
//    recently -- so every row, from every source, must pass through
//    this one gate before it can update `session`.
//
// This repo's test convention has no component-rendering/async-
// simulation capability (every *.page.test.ts file is static
// source-text assertion only, with no React-testing-library/jsdom
// anywhere in the project) -- these tests verify both mechanisms are
// structurally present and wired into every call site, which is the
// strongest regression coverage this architecture supports, rather
// than a dynamic race simulation.

test("a generation ref (request liveness) and an accepted-session ref (version high-water mark) both exist", () => {
  assert.match(PAGE_SOURCE, /stateGenerationRef\s*=\s*useRef\(0\)/);
  assert.match(
    PAGE_SOURCE,
    /acceptedSessionRef\s*=\s*useRef<\{\s*id:\s*string;\s*version:\s*number\s*\}\s*\|\s*null>\(\s*\n?\s*null,?\s*\n?\s*\)/,
  );
});

test("acceptSessionRow rejects a row only when it is a strictly older version of the SAME session id", () => {
  const fnIdx = PAGE_SOURCE.indexOf("function acceptSessionRow(");
  assert.notEqual(fnIdx, -1, "expected an acceptSessionRow gate function");
  const fnBody = PAGE_SOURCE.slice(fnIdx, fnIdx + 900);

  // Same-session, strictly-older-version rejection.
  assert.match(fnBody, /accepted\.id === row\.id/);
  assert.match(fnBody, /row\.state_version < accepted\.version/);
  assert.match(fnBody, /return false/);

  // A null (session ended/not found) is always accepted -- it carries
  // no version of its own to compare, and callers only reach this gate
  // with a null once the generation check has already confirmed it is
  // still the most recent request.
  assert.match(fnBody, /if \(row === null\)/);

  // Equal versions must NOT be rejected (a same-position refresh is
  // legitimate, never treated as regression) -- the reject condition
  // must be strict "<", not "<=".
  assert.equal(/row\.state_version <= accepted\.version/.test(fnBody), false);
});

test("session is only ever set from inside acceptSessionRow, never directly by a call site", () => {
  const fnIdx = PAGE_SOURCE.indexOf("function acceptSessionRow(");
  const fnEndIdx = PAGE_SOURCE.indexOf("\n  }\n", fnIdx);
  assert.notEqual(fnIdx, -1);
  assert.notEqual(fnEndIdx, -1);

  const beforeFn = PAGE_SOURCE.slice(0, fnIdx);
  const fnBody = PAGE_SOURCE.slice(fnIdx, fnEndIdx);
  const afterFn = PAGE_SOURCE.slice(fnEndIdx);

  // setSession itself must appear exactly inside acceptSessionRow's own
  // body (twice: the null branch and the accepted branch) and nowhere
  // else in the component -- every other call site must go through the
  // gate instead of setting session directly.
  assert.equal(/setSession\(/.test(beforeFn), false, "no setSession call before acceptSessionRow's definition");
  assert.equal(/setSession\(/.test(afterFn), false, "no setSession call after acceptSessionRow's definition");
  assert.ok((fnBody.match(/setSession\(/g) || []).length >= 2);
});

test("loadLiveSession, handleStart, and runControl all route their session row through acceptSessionRow", () => {
  const loadLiveSessionIdx = PAGE_SOURCE.indexOf("const loadLiveSession = useCallback");
  const handleStartIdx = PAGE_SOURCE.indexOf("async function handleStart()");
  const runControlIdx = PAGE_SOURCE.indexOf("async function runControl(");
  assert.notEqual(loadLiveSessionIdx, -1);
  assert.notEqual(handleStartIdx, -1);
  assert.notEqual(runControlIdx, -1);

  const loadLiveSessionBody = PAGE_SOURCE.slice(loadLiveSessionIdx, handleStartIdx);
  assert.match(loadLiveSessionBody, /const generation = \+\+stateGenerationRef\.current/);
  assert.match(loadLiveSessionBody, /generation !== stateGenerationRef\.current/);
  assert.match(loadLiveSessionBody, /acceptSessionRow\(row\)/);

  const handleStartBody = PAGE_SOURCE.slice(handleStartIdx, runControlIdx);
  assert.match(handleStartBody, /const generation = \+\+stateGenerationRef\.current/);
  assert.match(handleStartBody, /acceptSessionRow\(row\)/);
  assert.match(handleStartBody, /loadSessionItems\(row\.id, row\.current_index, generation\)/);

  const runControlBody = PAGE_SOURCE.slice(runControlIdx, runControlIdx + 2400);
  const bumpCount = (runControlBody.match(/\+\+stateGenerationRef\.current/g) || []).length;
  assert.ok(bumpCount >= 2, `expected runControl to bump the generation in both its branches, found ${bumpCount}`);
  assert.match(runControlBody, /acceptSessionRow\(null\)/, "the end-session branch must sync acceptedSessionRef too");
  assert.match(runControlBody, /acceptSessionRow\(row\)/);
  assert.match(runControlBody, /loadSessionItems\(row\.id, row\.current_index, generation\)/);
});

test("loadSessionItems is only called once its row has been accepted (guarded by acceptSessionRow's return value)", () => {
  // handleStart and runControl's non-end branch must both gate the
  // loadSessionItems call behind acceptSessionRow's boolean result --
  // an unconditional call right after acceptSessionRow would mean a
  // rejected (stale) row's index could still be used to fetch/display
  // photos.
  const guardedCallPattern = /if \(acceptSessionRow\(row\)\) \{\s*\n\s*await loadSessionItems\(row\.id, row\.current_index, generation\);/g;
  const guardedCallCount = (PAGE_SOURCE.match(guardedCallPattern) || []).length;
  assert.ok(
    guardedCallCount >= 2,
    `expected at least 2 call sites to gate loadSessionItems behind acceptSessionRow(row), found ${guardedCallCount}`,
  );
});

test("loadSessionItems retains its own generation checkpoints for photo/caption resolution cancellation", () => {
  assert.match(
    PAGE_SOURCE,
    /const loadSessionItems = useCallback\(\s*\n?\s*async \(sessionId: string, currentIndex: number, generation: number\)/,
  );
  const guardPattern = /generation !== stateGenerationRef\.current/g;
  const guardCount = (PAGE_SOURCE.match(guardPattern) || []).length;
  // loadSessionItems needs three checkpoints of its own (after the
  // items select, after resolving the current photo, after resolving
  // the next photo); loadLiveSession needs one more (after its own
  // session select) -- four total is the minimum for both mechanisms
  // to be intact.
  assert.ok(
    guardCount >= 4,
    `expected at least 4 generation-guard checks across the file, found ${guardCount}`,
  );
});

test("no call site invokes loadSessionItems without a generation argument", () => {
  const calls = [...PAGE_SOURCE.matchAll(/loadSessionItems\(([^)]*)\)/g)];
  assert.ok(calls.length >= 3, `expected at least 3 loadSessionItems call sites, found ${calls.length}`);
  for (const call of calls) {
    const args = call[1].split(",").map((a) => a.trim()).filter(Boolean);
    assert.equal(args.length, 3, `expected loadSessionItems(sessionId, currentIndex, generation), got: loadSessionItems(${call[1]})`);
  }
});
