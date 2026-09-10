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
  assert.match(VIEWER_SOURCE, /publicState\??\.\s*current_content_ref_id/);
});

// P0 Event-Photo Read-Surface Repair (20261010000000): the viewer must
// never again read a raw storage path out of the public session response
// and use it to construct a Supabase storage URL directly -- that surface
// is exactly the confirmed defect. The type still names the RPC's two
// (now always-null) path columns for shape-fidelity, but no code in this
// file may access them as a property, and no Supabase storage call may
// appear anywhere in this file.
test("the viewer never reads a raw storage path from the session response, and never talks to Supabase storage directly", () => {
  assert.equal(
    /publicState\??\.\s*current_storage_path/.test(VIEWER_SOURCE_NO_COMMENTS),
    false,
    "current_storage_path must never be read as a property access -- it is the removed disclosure this repair closes",
  );
  assert.equal(
    /publicState\??\.\s*next_storage_path/.test(VIEWER_SOURCE_NO_COMMENTS),
    false,
    "next_storage_path must never be read as a property access",
  );
  assert.equal(/supabase\.storage/.test(VIEWER_SOURCE_NO_COMMENTS), false);
  assert.equal(/createSignedUrl/.test(VIEWER_SOURCE_NO_COMMENTS), false);
});

test("image and caption are delivered exclusively through the governed presentation routes, keyed by session id and slot", () => {
  assert.match(VIEWER_SOURCE, /\/api\/slideshow\/presentation-image\?session=/);
  assert.match(VIEWER_SOURCE, /\/api\/slideshow\/presentation-caption\?session=/);
  assert.match(VIEWER_SOURCE, /slot=current/);
  assert.match(VIEWER_SOURCE, /slot=next/);
  // No direct anon table read of event_photos survives anywhere.
  assert.equal(/\.from\(\s*["']event_photos["']\s*\)/.test(VIEWER_SOURCE), false);
});

test("ineligible or not-yet-loaded current item is not rendered from a stale image", () => {
  // currentImageLoaded resets to false the instant the resolved image src
  // itself changes, and the visible photo (and its caption) are gated on
  // that flag -- never on the mere presence of a content_ref_id, which
  // says nothing about whether the underlying photo is still approved.
  assert.match(VIEWER_SOURCE, /setCurrentImageLoaded\(false\)/);
  assert.match(VIEWER_SOURCE, /\},\s*\[currentImageSrc\]\)/);
  assert.match(VIEWER_SOURCE, /currentImageLoaded/);
});

test("next item is preloaded but the full Event gallery is not", () => {
  assert.match(VIEWER_SOURCE, /nextImageSrc/);
  assert.equal(/\.range\(0,\s*999\)/.test(VIEWER_SOURCE), false, "must not bulk-load the whole approved-photo gallery");
});

test("a browser cannot submit an arbitrary storage path, photo id, or Event id to the image/caption routes -- only the session id and a fixed slot label", () => {
  // The only dynamic segments placed into either route's query string are
  // sessionId, the current/next slot literal, and cache-busting values
  // (content_ref_id, sequence_number) that the route itself is free to
  // ignore -- never a raw photo storage path, and never an eventId.
  assert.equal(/presentation-image\?[^"'`]*eventId/.test(VIEWER_SOURCE), false);
  assert.equal(/presentation-image\?[^"'`]*storage_path/i.test(VIEWER_SOURCE), false);
  assert.equal(/presentation-caption\?[^"'`]*eventId/.test(VIEWER_SOURCE), false);
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
