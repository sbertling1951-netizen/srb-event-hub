import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PANEL = readFileSync(
  fileURLToPath(new URL("./ObjectPanel.tsx", import.meta.url)),
  "utf8",
);
const CSS = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8",
);
const NEARBY = readFileSync(
  fileURLToPath(new URL("../app/member/nearby/page.tsx", import.meta.url)),
  "utf8",
);
const AGENDA = readFileSync(
  fileURLToPath(new URL("../app/member/agenda/page.tsx", import.meta.url)),
  "utf8",
);
const ATTENDEES = readFileSync(
  fileURLToPath(new URL("../app/admin/attendees/page.tsx", import.meta.url)),
  "utf8",
);

test("density is an opt-in prop that defaults to comfortable", () => {
  assert.match(PANEL, /density\?: "comfortable" \| "compact";/);
  assert.match(PANEL, /density = "comfortable",/);
});

test('density="compact" and presentation="centered" only add modifier classes -- no behavior/semantics change', () => {
  // Panel class list is built additively: the base class plus an opt-in
  // modifier per prop, defaults ("comfortable" / "side") contributing none.
  assert.match(PANEL, /"object-panel",\s*\n\s*density === "compact" \? "object-panel--compact" : null,\s*\n\s*presentation === "centered" \? "object-panel--centered" : null,/);
  // dialog semantics unchanged
  assert.match(PANEL, /role="dialog"/);
  assert.match(PANEL, /aria-modal="true"/);
  assert.match(PANEL, /aria-labelledby=\{titleId\}/);
  // focus trap / escape / history behavior untouched (still present)
  assert.match(PANEL, /handleTrapKeyDown/);
  assert.match(PANEL, /e\.key === "Escape"/);
  assert.match(PANEL, /HISTORY_MARKER/);
});

test('presentation is an opt-in prop that defaults to "side" (every existing consumer unchanged)', () => {
  assert.match(PANEL, /presentation\?: "side" \| "centered";/);
  assert.match(PANEL, /presentation = "side",/);
  // The backdrop only gains its centered modifier when explicitly asked.
  assert.match(
    PANEL,
    /presentation === "centered"\s*\n\s*\? "object-panel-backdrop object-panel-backdrop--centered"\s*\n\s*: "object-panel-backdrop"/,
  );
});

test('centered CSS is a bounded, desktop-only opt-in that keeps the mobile bottom sheet intact', () => {
  // Scoped to .object-panel--centered only, inside a min-width media query.
  assert.match(CSS, /@media \(min-width: 900px\) \{\s*\n\s*\.object-panel--centered\.object-panel \{/);
  assert.match(CSS, /\.object-panel-backdrop--centered \{[\s\S]*?align-items: center;[\s\S]*?justify-content: center;/);
  assert.match(CSS, /@keyframes object-panel-enter-centered/);
  // No unscoped .object-panel rule was altered for this.
  assert.doesNotMatch(CSS, /\n\.object-panel \{[^}]*translateY\(12px\)/);
});

test("only Attendees Management adopts the centered presentation", () => {
  assert.match(ATTENDEES, /<ObjectPanel[\s\S]*?presentation="centered"/);
  assert.doesNotMatch(NEARBY, /presentation=/);
  assert.doesNotMatch(AGENDA, /presentation=/);
});

test("prev/next still hidden when both callbacks are omitted (unchanged)", () => {
  assert.match(PANEL, /\{\(onPrevious \|\| onNext\) && \(/);
});

test("compact CSS tightens chrome padding and grids the action rows, keeping touch targets sane", () => {
  const block = CSS.slice(
    CSS.indexOf(".object-panel--compact .object-panel-header"),
    CSS.indexOf("@keyframes object-panel-enter-sheet"),
  );
  assert.match(block, /\.object-panel--compact \.object-panel-header \{\s*\n\s*padding: var\(--space-4\) var\(--space-5\) var\(--space-3\);/);
  // primary actions: one equal-width row, count-driven redistribution
  assert.match(
    block,
    /\.object-panel--compact \.object-panel-primary-actions \{[\s\S]*?display: grid;[\s\S]*?grid-auto-flow: column;[\s\S]*?grid-auto-columns: 1fr;/,
  );
  // narrow-screen fallback: Directions full-width, remaining actions two-up
  assert.match(
    block,
    /@media \(max-width: 380px\) \{[\s\S]*?\.object-panel--compact \.object-panel-primary-actions \{[\s\S]*?grid-auto-flow: row;[\s\S]*?grid-template-columns: 1fr 1fr;[\s\S]*?> :first-child,[\s\S]*?:nth-child\(2\):last-child \{[\s\S]*?grid-column: 1 \/ -1;/,
  );
  assert.match(block, /\.object-panel--compact \.object-panel-body \{\s*\n\s*padding: var\(--space-4\) var\(--space-5\);/);
  // secondary row is the only place controls shrink -- and only to 38px
  assert.match(block, /\.object-panel--compact \.object-panel-secondary-actions \.app-button \{[\s\S]*?min-height: 38px;/);
  // primary action buttons are NOT shrunk
  assert.doesNotMatch(
    block.slice(0, block.indexOf("secondary-actions")),
    /min-height/,
  );
});

test("only Member Nearby adopts compact -- Agenda and Attendees panels are unchanged", () => {
  assert.match(NEARBY, /<ObjectPanel[\s\S]*?density="compact"/);
  assert.doesNotMatch(AGENDA, /density=/);
  assert.doesNotMatch(ATTENDEES, /density=/);
  // Agenda/Attendees still render an ObjectPanel (guard against accidental removal)
  assert.match(AGENDA, /<ObjectPanel/);
  assert.match(ATTENDEES, /<ObjectPanel/);
});

test("Attendees keeps its own view-mode-gated prev/next -- untouched", () => {
  assert.match(ATTENDEES, /onPrevious=\{viewState === "view" \? onPrevious : undefined\}/);
  assert.match(ATTENDEES, /onNext=\{viewState === "view" \? onNext : undefined\}/);
});
