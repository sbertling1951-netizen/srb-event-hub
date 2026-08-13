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
