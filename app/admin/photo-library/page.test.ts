import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused tests for the Photo/Media Authority Foundation Stage 2 Photo
// Library governance cutover. Run with:
//   npx tsx --test app/admin/photo-library/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);


test("photo library page contains no direct event_photos mutation", () => {
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

test("photo library consumes the shared scoped photo cache instead of direct table access", () => {
  assert.match(PAGE_SOURCE, /loadAdminPhotoSnapshot/);
  assert.equal(/\.from\(["']event_photos["']\)/.test(PAGE_SOURCE), false);
});

test("photo library calls the same governed manage_event_photo RPC as Admin Photos", () => {
  assert.match(PAGE_SOURCE, /["']manage_event_photo["']/);
});

test("Featured checkbox maps deterministically to featured_level (unchecked=0, checked=1), not a separate is_featured write", () => {
  assert.match(PAGE_SOURCE, /featured_level:\s*checked\s*\?\s*1\s*:\s*0/);
  assert.equal(/is_featured:\s*checked/.test(PAGE_SOURCE), false, "must not independently write is_featured from the checkbox");
});

test("page is gated by AdminRouteGuard", () => {
  assert.match(PAGE_SOURCE, /AdminRouteGuard/);
});

// Task-Authority Guard Design, Photos consumer migration. Photo Library
// is Event-scoped, not a shared/global asset library: fetchPhotos scopes
// every read to getCurrentAdminEvent(), re-fetches on Event switch via
// subscribeToAdminWorkspace, and handleSave's only mutation is the same
// governed manage_event_photo RPC Admin Photos uses -- already
// server-side gated by event.photos.manage. Same authority shape as
// Admin Photos; the route previously carried no permission at all
// (bare AdminRouteGuard).

test("route requires event.photos.manage -- previously ungated beyond authentication", () => {
  assert.match(PAGE_SOURCE, /<AdminRouteGuard requiredTask="event\.photos\.manage">/);
});

test("no direct has_event_task_authority RPC call is introduced -- authority is owned entirely by AdminRouteGuard", () => {
  assert.equal(/has_event_task_authority/.test(PAGE_SOURCE), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(PAGE_SOURCE), false);
});

test("photo library remains Event-scoped: every read and the one mutation are keyed to getCurrentAdminEvent()", () => {
  assert.match(PAGE_SOURCE, /const currentEvent = getCurrentAdminEvent\(\);/);
  // Re-fetch on working-Event change now runs through the shared scope hook,
  // which also drops Event A's library + open modal synchronously.
  assert.match(PAGE_SOURCE, /useAdminWorkingEventScope\(/);
});

test("page uses the canonical Admin shell (migrated by a later, separate shell-migration stage)", () => {
  assert.match(PAGE_SOURCE, /AdminShellAdapter/);
});

test("library thumbnails are transformed, lazy, and review URLs are requested on demand", () => {
  assert.match(PAGE_SOURCE, /"library-thumbnail-360x240"/);
  assert.match(PAGE_SOURCE, /loading="lazy"/);
  assert.match(PAGE_SOURCE, /"review-800"/);
  assert.equal(/createSignedUrl\(/.test(PAGE_SOURCE), false);
});

test("library rejects stale async loads and clears prior-user cache on auth change", () => {
  assert.match(PAGE_SOURCE, /loadGenerationRef/);
  assert.match(PAGE_SOURCE, /onAuthStateChange/);
  assert.match(PAGE_SOURCE, /clearAdminPhotoCacheForUser/);
});

test("photo cards are real <button> elements -- native Enter/Space activation, keyboard focus, and accessible name, not a hand-rolled role=\"button\" div", () => {
  assert.equal(/role="button"/.test(PAGE_SOURCE), false);
  assert.equal(/tabIndex=\{0\}/.test(PAGE_SOURCE), false);
  assert.equal(/event\.key === "Enter" \|\| event\.key === " "/.test(PAGE_SOURCE), false);
  assert.match(
    PAGE_SOURCE,
    /<button\s*\n\s*key=\{photo\.id\}\s*\n\s*type="button"\s*\n\s*onClick=\{\(\) => openModal\(photo\)\}/,
  );
  assert.match(
    PAGE_SOURCE,
    /aria-label=\{`View or edit photo: \$\{photo\.admin_caption \|\| photo\.member_caption \|\| photo\.id\}`\}/,
  );
});

test("photo save failures use the page error channel instead of a browser alert", () => {
  assert.match(PAGE_SOURCE, /setError\(`Failed to save changes:/);
  assert.equal(/\balert\(/.test(PAGE_SOURCE), false);
});

// Admin Batch 3 Central UI Standard migration. The photo detail modal was
// one of the ten hand-rolled role="dialog" implementations the blueprint's
// Part 1 audit flagged as lacking Escape/focus-trap/return-focus, and the
// search+filter row now adopts TableToolbar/SearchField -- explicitly
// named in that primitive's own doc comment as an intended future
// consumer ("Photos/Photo Library"). Run with:
//   npx tsx --test app/admin/photo-library/page.test.ts

test("the hand-rolled role=\"dialog\" photo-details overlay is gone -- the canonical Dialog primitive now owns focus trap, Escape, backdrop, and scroll lock", () => {
  assert.match(PAGE_SOURCE, /import \{ Dialog \} from "@\/components\/ui\/Dialog";/);
  assert.match(PAGE_SOURCE, /<Dialog\s*\n\s*open=\{modalPhoto !== null\}/);
  assert.equal(/role="dialog"/.test(PAGE_SOURCE), false);
  assert.equal(/aria-modal="true"/.test(PAGE_SOURCE), false);
});

test("Close/Save render as real AppButtons in the Dialog footer -- Save carries the busy/loading contract, not a hand-rolled disabled+opacity treatment", () => {
  const footerIdx = PAGE_SOURCE.indexOf("footer={");
  const footerEnd = PAGE_SOURCE.indexOf("}\n      >", footerIdx);
  const footerBlock = PAGE_SOURCE.slice(footerIdx, footerEnd);
  assert.match(footerBlock, /<AppButton onClick=\{closeModal\} disabled=\{saving\}>/);
  assert.match(footerBlock, /variant="primary" onClick=\{\(\) => void handleSave\(\)\} loading=\{saving\}/);
});

test("the Status select, Member/Admin Caption textareas, and Show Caption/Featured checkboxes route through the canonical Field/Select/Textarea/Checkbox primitives", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*Checkbox,\s*Field,\s*Select,\s*Textarea\s*\}\s*from\s*["']@\/components\/ui\/Field["']/,
  );
  assert.match(PAGE_SOURCE, /<Field label="Status">/);
  assert.match(PAGE_SOURCE, /<Field label="Member Caption">/);
  assert.match(PAGE_SOURCE, /<Field label="Admin Caption">/);
  assert.match(PAGE_SOURCE, /<Checkbox\s*\n\s*label="Show Caption"/);
  assert.match(PAGE_SOURCE, /<Checkbox\s*\n\s*label="Featured"/);
  assert.equal(/<select\b/.test(PAGE_SOURCE), false, "no raw <select> should remain in the photo details dialog");
  assert.equal(/<textarea\b/.test(PAGE_SOURCE), false, "no raw <textarea> should remain in the photo details dialog");
  assert.equal(/type="checkbox"/.test(PAGE_SOURCE), false, "no raw checkbox <input> should remain in the photo details dialog");
});

test("the Featured-checkbox status/level compatibility mapping comment and logic are untouched -- only the control's markup moved onto Checkbox", () => {
  assert.match(PAGE_SOURCE, /\/\/ Compatibility mapping for this single checkbox:/);
  assert.match(PAGE_SOURCE, /featured_level: checked \? 1 : 0,/);
  assert.match(PAGE_SOURCE, /photo_status: checked\s*\n\s*\? "approved"/);
});

test("search and status/featured filtering adopt the canonical TableToolbar/SearchField -- the same primitive its own doc comment names Photo Library as an intended consumer of", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*SearchField,\s*TableToolbar,\s*TableToolbarPrimaryRow\s*\}\s*from\s*["']@\/components\/ui\/TableToolbar["']/,
  );
  assert.match(PAGE_SOURCE, /<TableToolbar>/);
  assert.match(PAGE_SOURCE, /<SearchField\s*\n\s*label="Search by caption"/);
  assert.equal(/<input\s*\n\s*type="text"/.test(PAGE_SOURCE), false);
});

test("the five filter chips (All/Pending/Approved/Rejected/Featured) render as real AppButtons with aria-pressed, matching the canonical toggle-filter pattern (Reports' own reportType chips)", () => {
  assert.match(PAGE_SOURCE, /variant=\{activeFilter === filter\.key \? "primary" : "tertiary"\}/);
  assert.match(PAGE_SOURCE, /aria-pressed=\{activeFilter === filter\.key\}/);
});

test("loading/error/empty states use the canonical LoadingState/Alert/EmptyState primitives instead of page-local hardcoded-color divs", () => {
  assert.match(PAGE_SOURCE, /<LoadingState message="Loading photos\.\.\." \/>/);
  assert.match(PAGE_SOURCE, /<Alert tone="danger">\{error\}<\/Alert>/);
  assert.match(PAGE_SOURCE, /<EmptyState message="No photos found\." \/>/);
});
