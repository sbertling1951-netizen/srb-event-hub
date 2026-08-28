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

test('density="compact" only adds a modifier class -- no behavior/semantics change', () => {
  assert.match(
    PANEL,
    /className=\{\s*\n\s*density === "compact"\s*\n\s*\? "object-panel object-panel--compact"\s*\n\s*: "object-panel"\s*\n\s*\}/,
  );
  // dialog semantics unchanged
  assert.match(PANEL, /role="dialog"/);
  assert.match(PANEL, /aria-modal="true"/);
  assert.match(PANEL, /aria-labelledby=\{titleId\}/);
  // focus trap / escape / history behavior untouched (still present)
  assert.match(PANEL, /handleTrapKeyDown/);
  assert.match(PANEL, /e\.key === "Escape"/);
  assert.match(PANEL, /HISTORY_MARKER/);
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
  assert.match(block, /\.object-panel--compact \.object-panel-primary-actions \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: 1fr 1fr;/);
  assert.match(block, /\.object-panel--compact \.object-panel-primary-actions > :first-child,\s*\n\s*\.object-panel--compact \.object-panel-primary-actions > :nth-child\(2\):last-child \{\s*\n\s*grid-column: 1 \/ -1;/);
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
