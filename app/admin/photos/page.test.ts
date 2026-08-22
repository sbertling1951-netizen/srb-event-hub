import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused tests for the Photo/Media Authority Foundation Stage 2 Admin
// Photos governed RPC cutover. Run with:
//   npx tsx --test app/admin/photos/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("admin photos page contains no direct event_photos mutation", () => {
  const prohibited: RegExp[] = [
    /\.from\(["']event_photos["']\)\s*\.\s*update/,
    /\.from\(["']event_photos["']\)\s*\.\s*insert/,
    /\.from\(["']event_photos["']\)\s*\.\s*delete/,
    /\.from\(["']event_photos["']\)\s*\.\s*upsert/,
  ];
  for (const pattern of prohibited) {
    assert.equal(pattern.test(PAGE_SOURCE), false, `found prohibited direct-mutation pattern: ${pattern}`);
  }
});

test("admin photos page calls the governed manage_event_photo RPC for both approve/reject and undo", () => {
  const matches = [...PAGE_SOURCE.matchAll(/manage_event_photo/g)];
  assert.ok(matches.length >= 2, "expected manage_event_photo referenced by both updatePhotoStatus and undoLastAction");
});

test("undo preserves featured_level and member_caption rather than dropping them", () => {
  assert.match(PAGE_SOURCE, /previousFeaturedLevel/);
  assert.match(PAGE_SOURCE, /previousMemberCaption/);
  assert.match(PAGE_SOURCE, /p_featured_level:\s*undoData\.previousFeaturedLevel/);
});

test("shell wrapper and AdminRouteGuard remain in place", () => {
  assert.match(PAGE_SOURCE, /AdminRouteGuard/);
  assert.match(PAGE_SOURCE, /AdminShellAdapter/);
});

// Event Context Invariant (docs/architecture/ADR-006 Event Context
// Architecture.md): this page must remain a pure consumer of the shared
// Admin working Event -- it must never gate, filter, or re-resolve
// getCurrentAdminEvent()'s result by lifecycle status, and it must never
// write to the shared context itself. Regression coverage for "Amana
// selected + inactive -> navigate to this page -> Amana remains
// current" at this page's boundary.

test("the page never gates or filters the current Event by lifecycle status", () => {
  assert.equal(/isActiveEventStatus/.test(PAGE_SOURCE), false);
  assert.equal(/\.status\s*===\s*["']active["']/i.test(PAGE_SOURCE), false);
});

test("the page never writes to the shared Admin working Event", () => {
  assert.equal(/setCurrentAdminEvent/.test(PAGE_SOURCE), false);
});

test("the page reads the current Event only through the canonical getCurrentAdminEvent()", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{[^}]*getCurrentAdminEvent[^}]*\}\s*from\s*["']@\/lib\/adminWorkspaceContext["']/,
  );
  assert.match(PAGE_SOURCE, /const currentEvent = getCurrentAdminEvent\(\);/);
});

test("photos consume the shared cache, derive counts, and sign review images on demand", () => {
  assert.match(PAGE_SOURCE, /loadAdminPhotoSnapshot/);
  assert.match(PAGE_SOURCE, /"moderation-thumbnail-160"/);
  assert.match(PAGE_SOURCE, /"review-800"/);
  assert.equal(/createSignedUrl\(/.test(PAGE_SOURCE), false);
});

test("photos use Next Link for the Photo Library navigation", () => {
  assert.match(PAGE_SOURCE, /<Link\s+href="\/admin\/photo-library"/);
  assert.equal(/<a\s+href="\/admin\/photo-library"/.test(PAGE_SOURCE), false);
});

test("photos reject stale async loads and invalidate the scoped cache after moderation", () => {
  assert.match(PAGE_SOURCE, /loadGenerationRef/);
  assert.match(PAGE_SOURCE, /onAuthStateChange/);
  assert.match(PAGE_SOURCE, /invalidateAdminPhotoCache/);
});

// Task-Authority Guard Design, Photos consumer migration. This page's
// only job is Event photo moderation (approve/reject/undo), all
// through manage_event_photo, which already requires event.photos.manage
// server-side (20260811390000_create_photo_media_governed_operations.sql)
// -- the route previously carried no permission at all (bare
// AdminRouteGuard), so this closes a route-access gap the RPC already
// enforced, rather than narrowing any admin's real capability.

test("route requires event.photos.manage -- previously ungated beyond authentication", () => {
  assert.match(PAGE_SOURCE, /<AdminRouteGuard requiredTask="event\.photos\.manage">/);
});

test("no direct has_event_task_authority RPC call is introduced -- authority is owned entirely by AdminRouteGuard", () => {
  assert.equal(/has_event_task_authority/.test(PAGE_SOURCE), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(PAGE_SOURCE), false);
});

// Admin Batch 3 Central UI Standard migration. The moderation modal was
// one of the ten hand-rolled role="dialog" implementations the blueprint's
// Part 1 audit flagged as lacking Escape/focus-trap/return-focus -- this
// closes that real accessibility gap by adopting the canonical Dialog.
// Run with:
//   npx tsx --test app/admin/photos/page.test.ts

test("the hand-rolled role=\"dialog\" moderation overlay is gone -- the canonical Dialog primitive now owns focus trap, Escape, backdrop, and scroll lock", () => {
  assert.match(PAGE_SOURCE, /import \{ Dialog \} from "@\/components\/ui\/Dialog";/);
  assert.match(PAGE_SOURCE, /<Dialog\s*\n\s*open=\{selectedPhoto !== null\}/);
  assert.equal(/role="dialog"/.test(PAGE_SOURCE), false);
  assert.equal(/aria-modal="true"/.test(PAGE_SOURCE), false);
});

test("Approve, Reject, and Cancel remain three direct in-dialog actions, not a ConfirmDialog confirm step -- Approve is primary, Reject is danger (not the reserved \"stop\" fill), matching the page's un-gated moderation flow", () => {
  const footerIdx = PAGE_SOURCE.indexOf("footer={");
  const footerEnd = PAGE_SOURCE.indexOf("}\n      >", footerIdx);
  const footerBlock = PAGE_SOURCE.slice(footerIdx, footerEnd);
  assert.match(footerBlock, /<AppButton onClick=\{\(\) => setSelectedPhoto\(null\)\}>Cancel<\/AppButton>/);
  assert.match(footerBlock, /variant="danger"[^]*?void rejectPhoto\(selectedPhoto\.id\)/);
  assert.match(footerBlock, /variant="primary"[^]*?void approvePhoto\(selectedPhoto\.id\)/);
  assert.equal(/variant="stop"/.test(footerBlock), false);
});

test("the Admin Caption textarea, Show Caption checkbox, and Featured Level select route through the canonical Field/Checkbox/Select primitives", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*Checkbox,\s*Field,\s*Select,\s*Textarea\s*\}\s*from\s*["']@\/components\/ui\/Field["']/,
  );
  assert.match(PAGE_SOURCE, /<Field\s*\n\s*label="Admin Caption"/);
  assert.match(PAGE_SOURCE, /<Checkbox\s*\n\s*label="Show Caption In Slideshow"/);
  assert.match(PAGE_SOURCE, /<Field\s*\n\s*label="Featured Level"/);
  assert.equal(/<textarea\b/.test(PAGE_SOURCE), false, "no raw <textarea> should remain in the moderation dialog");
  assert.equal(/<select\b/.test(PAGE_SOURCE), false, "no raw <select> should remain in the moderation dialog");
  assert.equal(/type="checkbox"/.test(PAGE_SOURCE), false, "no raw checkbox <input> should remain in the moderation dialog");
});

test("the photo queue cards are real keyboard-operable buttons, not click-only divs -- a genuine accessibility gap fixed by this migration", () => {
  assert.equal(/<div\s*\n\s*key=\{photo\.id\}\s*\n\s*onClick=\{\(\) => openModeration\(photo\)\}/.test(PAGE_SOURCE), false);
  assert.match(
    PAGE_SOURCE,
    /<button\s*\n\s*key=\{photo\.id\}\s*\n\s*type="button"\s*\n\s*onClick=\{\(\) => openModeration\(photo\)\}/,
  );
  assert.match(PAGE_SOURCE, /aria-label=\{`Review photo uploaded by \$\{photo\.member_name \|\| "Unknown"\}`\}/);
});

test("an explicit EmptyState covers an empty review queue, distinct from the toast/undo notification channel", () => {
  assert.match(PAGE_SOURCE, /import \{ EmptyState \} from "@\/components\/ui\/EmptyState";/);
  assert.match(PAGE_SOURCE, /<EmptyState message="No photos are waiting for review right now\." \/>/);
});

test("both same-app nav links (Slideshow, Photo Library) use Next Link with the canonical .app-button class, not a raw hardcoded-hex <a>", () => {
  assert.match(PAGE_SOURCE, /<Link href="\/admin\/slideshow" className="app-button">/);
  assert.match(PAGE_SOURCE, /<Link href="\/admin\/photo-library" className="app-button">/);
  assert.equal(/backgroundColor:\s*#/.test(PAGE_SOURCE), false, "no inline hex background should remain");
});

test("the toast + undo interaction (5s auto-clear timer, undoData snapshot) is untouched -- only its presentation moved onto AppButton and design tokens", () => {
  assert.match(PAGE_SOURCE, /toastTimerRef\.current = setTimeout\(\(\) => \{/);
  assert.match(PAGE_SOURCE, /\}, 5000\);/);
  assert.match(PAGE_SOURCE, /<AppButton\s*\n\s*onClick=\{\(\) => void undoLastAction\(\)\}/);
});
