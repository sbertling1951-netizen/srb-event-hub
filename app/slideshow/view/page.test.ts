import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused tests for the Presentation/Slideshow Stage 6 audience-viewer
// cutover: the viewer now renders the durable, governed
// presentation_sessions foundation (Stages 2-5) via
// read_public_presentation_session, instead of deciding slide order,
// randomness, or timing itself. Run with:
//   npx tsx --test app/slideshow/view/page.test.ts

const VIEWER_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

const PRESENTER_SOURCE = readFileSync(
  fileURLToPath(new URL("../../admin/slideshow/page.tsx", import.meta.url)),
  "utf8",
);

// Strips // line comments before checking for a code-level reference, so
// this file's own explanatory comments (which name retired
// keys/patterns to explain why they're gone) don't trip a check meant
// to catch actual legacy code.
const VIEWER_SOURCE_NO_COMMENTS = VIEWER_SOURCE.replace(/\/\/.*$/gm, "");

test("viewer consumes the session id from the ?session= query parameter", () => {
  assert.match(VIEWER_SOURCE, /useSearchParams/);
  assert.match(VIEWER_SOURCE, /searchParams\.get\(\s*["']session["']\s*\)/);
});

test("viewer no longer reads Admin Event context from localStorage", () => {
  assert.equal(/fcoc-admin-event-context/.test(VIEWER_SOURCE_NO_COMMENTS), false);
});

test("no legacy Presentation localStorage transport remains in the viewer", () => {
  const prohibited: RegExp[] = [
    /epix-presentation-state/,
    /epic-presentation-state/,
    /commandAt/,
    /publishViewerState/,
    /localStorage\.(get|set)Item/,
  ];
  for (const pattern of prohibited) {
    assert.equal(
      pattern.test(VIEWER_SOURCE_NO_COMMENTS),
      false,
      `found retired localStorage Presentation transport pattern: ${pattern}`,
    );
  }
});

test("viewer reads authoritative state via read_public_presentation_session", () => {
  assert.match(VIEWER_SOURCE, /rpc\(\s*\n?\s*["']read_public_presentation_session["']/);
  assert.match(VIEWER_SOURCE, /p_session_id/);
});

test("viewer never calls a session mutation RPC", () => {
  const prohibited: RegExp[] = [
    /"start_presentation_session"/,
    /"pause_presentation_session"/,
    /"resume_presentation_session"/,
    /"next_presentation_slide"/,
    /"previous_presentation_slide"/,
    /"end_presentation_session"/,
  ];
  for (const pattern of prohibited) {
    assert.equal(pattern.test(VIEWER_SOURCE), false, `found prohibited mutation-RPC call: ${pattern}`);
  }
});

test("viewer performs no direct write to any presentation table", () => {
  const prohibited: RegExp[] = [
    /\.from\(\s*["']presentation_sessions["']\s*\)\s*\.\s*(update|insert|delete|upsert)/,
    /\.from\(\s*["']presentation_session_items["']\s*\)\s*\.\s*(update|insert|delete|upsert)/,
    /\.from\(\s*["']presentation_decks["']\s*\)/,
    /\.from\(\s*["']presentation_deck_items["']\s*\)/,
  ];
  for (const pattern of prohibited) {
    assert.equal(pattern.test(VIEWER_SOURCE), false, `found prohibited pattern: ${pattern}`);
  }
});

test("viewer never calls manage_event_photo and performs no event_photos mutation", () => {
  assert.equal(/manage_event_photo/.test(VIEWER_SOURCE), false);
  assert.equal(
    /\.from\(["']event_photos["']\)\s*\.\s*(update|insert|delete|upsert)/.test(VIEWER_SOURCE),
    false,
  );
});

test("record_photo_display is retired from the viewer", () => {
  // Only a comment names it, to explain the deliberate retirement --
  // no actual call site should survive.
  assert.equal(/record_photo_display\s*\(/.test(VIEWER_SOURCE), false);
  assert.equal(/\.rpc\(\s*["']record_photo_display["']/.test(VIEWER_SOURCE), false);
});

test("no weighted-random/local playback selection logic remains", () => {
  const prohibited: RegExp[] = [
    /recentSlidesRef/,
    /featuredCooldownRef/,
    /featuredShownCountRef/,
    /weightedPool/,
    /Math\.random/,
    /slideHistoryRef/,
    /historyPositionRef/,
    /pickNextSlide/,
  ];
  for (const pattern of prohibited) {
    assert.equal(pattern.test(VIEWER_SOURCE_NO_COMMENTS), false, `found prohibited local-selection pattern: ${pattern}`);
  }
});

test("no local currentIndex/auto-advance timer drives slide position", () => {
  // A local advance timer would look like setInterval(..., 8000) (the
  // old auto-advance) or any setState of a locally-owned index. The
  // only interval permitted is the ~1s authoritative-state poll.
  assert.equal(/setInterval\([^)]*,\s*8000\)/.test(VIEWER_SOURCE), false);
  assert.equal(/setCurrentIndex/.test(VIEWER_SOURCE), false);
  assert.match(VIEWER_SOURCE, /POLL_INTERVAL_MS\s*=\s*1000/);
});

test("current slide content is derived from the public session response only", () => {
  assert.match(VIEWER_SOURCE, /publicState\??\.\s*current_content_type/);
  assert.match(VIEWER_SOURCE, /publicState\??\.\s*current_storage_path/);
  assert.match(VIEWER_SOURCE, /publicState\??\.\s*current_content_ref_id/);
});

test("ineligible current item is not rendered from a stale cached URL", () => {
  // The signed-URL effect must be keyed on the resolved storage_path
  // itself, so it re-runs (and clears to null) the instant a
  // previously-eligible photo's storage_path goes null.
  assert.match(
    VIEWER_SOURCE,
    /\[publicState\?\.\s*current_content_type,\s*publicState\?\.\s*current_storage_path\]/,
  );
});

test("next item is preloaded but the full Event gallery is not", () => {
  assert.match(VIEWER_SOURCE, /next_storage_path/);
  assert.equal(/\.range\(0,\s*999\)/.test(VIEWER_SOURCE), false, "must not bulk-load the whole approved-photo gallery");
});

test("fullscreen support is preserved", () => {
  assert.match(VIEWER_SOURCE, /requestFullscreen/);
  assert.match(VIEWER_SOURCE, /webkitRequestFullscreen/);
  assert.match(VIEWER_SOURCE, /toggleFullscreen/);
});

test("wake lock support is preserved and gated on live session, not a prerequisite for load", () => {
  assert.match(VIEWER_SOURCE, /wakeLock/);
  assert.match(VIEWER_SOURCE, /NotAllowedError/);
});

test("cursor-hide/reveal audience behavior is preserved", () => {
  assert.match(VIEWER_SOURCE, /showCursor/);
  assert.match(VIEWER_SOURCE, /mousemove/);
});

test("viewer exposes no anonymous session-control affordance (no Next/Previous/Pause/Resume/End UI)", () => {
  const prohibited: RegExp[] = [
    /onClick=\{[^}]*next_presentation_slide/,
    /onClick=\{[^}]*previous_presentation_slide/,
    /onClick=\{[^}]*pause_presentation_session/,
    /onClick=\{[^}]*resume_presentation_session/,
    /onClick=\{[^}]*end_presentation_session/,
    /addEventListener\(\s*["']keydown["']/,
  ];
  for (const pattern of prohibited) {
    assert.equal(pattern.test(VIEWER_SOURCE), false, `found prohibited audience control affordance: ${pattern}`);
  }
});

test("viewer status messages never expose internal identifiers or raw errors", () => {
  assert.equal(/Event ID:/.test(VIEWER_SOURCE), false);
  assert.equal(/admin_event_access|admin_task_registry|resolve_task_authority/.test(VIEWER_SOURCE), false);
});

test("route remains shell-free (slideshow-view-mode class, no AdminRouteGuard/AppShell)", () => {
  assert.match(VIEWER_SOURCE, /slideshow-view-mode/);
  assert.equal(/AdminRouteGuard/.test(VIEWER_SOURCE), false);
  assert.equal(/AppShell/.test(VIEWER_SOURCE), false);
});

test("presenter console does not call the anon-facing public read RPC", () => {
  // Stage 6A legitimately references read_public_presentation_session
  // BY NAME in an explanatory comment (relating it to the presenter's
  // own advance_presentation_session_if_due heartbeat) -- strip
  // comments so only a real call site would trip this.
  const presenterNoComments = PRESENTER_SOURCE.replace(/\/\/.*$/gm, "");
  assert.equal(/read_public_presentation_session/.test(presenterNoComments), false);
});
