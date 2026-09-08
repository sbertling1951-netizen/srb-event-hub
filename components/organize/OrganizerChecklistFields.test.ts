import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const shared = readFileSync(
  fileURLToPath(new URL("./OrganizerChecklistFields.tsx", import.meta.url)),
  "utf8",
);
const checklistPage = readFileSync(
  fileURLToPath(new URL("../../app/organize/[eventId]/checklist/page.tsx", import.meta.url)),
  "utf8",
);
const workspacePage = readFileSync(
  fileURLToPath(new URL("../../app/organize/[eventId]/page.tsx", import.meta.url)),
  "utf8",
);
const adapter = readFileSync(
  fileURLToPath(new URL("../../lib/organizerChecklist.ts", import.meta.url)),
  "utf8",
);

/** Comments stripped, so prose neither satisfies nor trips a check. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
/** Comments AND the mandated copy constants stripped. */
const body = (s: string) =>
  code(s)
    .replace(/const PRIVACY_COPY =[\s\S]*?;/, "")
    .replace(/const EMPTY_COPY =[\s\S]*?;/, "")
    // the field-set's own reassurance necessarily names the behavior it denies
    .replace(/Just for your own reference\.[^<]*/, "");

test("the shared component owns the one checklist field set", () => {
  for (const label of ["Item", "Target date", "Private note"]) {
    assert.ok(shared.includes(label), `shared field set must render "${label}"`);
  }
  assert.match(shared, /export function OrganizerChecklistFields/);
});

test("the add form and the edit form use the ONE shared component", () => {
  assert.match(checklistPage, /from "@\/components\/organize\/OrganizerChecklistFields"/);
  assert.equal((checklistPage.match(/<OrganizerChecklistFields\b/g) ?? []).length, 2);
});

test("BLANK: the UI offers no starter items, suggestions, templates, or placeholders", () => {
  for (const source of [shared, checklistPage]) {
    const c = code(source);
    assert.doesNotMatch(c, /starter|template|suggest|recommend|preset|sample|example|placeholder=/i);
  }
  // the add form opens from an empty item, never a prefilled one
  assert.match(checklistPage, /useState<ChecklistItemInput>\(emptyChecklistItem\(\)\)/);
  assert.match(checklistPage, /setAddForm\(emptyChecklistItem\(\)\)/);
});

test("BLANK: the empty state is welcoming and neutral -- no warning or readiness language", () => {
  assert.match(checklistPage, /Nothing here yet — this is a blank page for whatever you want to remember\./);
  // the empty state uses the NEUTRAL alert tone, never warning or danger
  assert.match(checklistPage, /items\.length === 0 \? \(\s*\n\s*<Alert tone="neutral">\{EMPTY_COPY\}<\/Alert>/);
  // asserted against the empty-state COPY itself -- "missing" elsewhere is the
  // LoadState member for a draft that could not be found, not empty-state text
  const emptyCopy = /const EMPTY_COPY =([\s\S]*?);/.exec(checklistPage)?.[1] ?? "";
  assert.ok(emptyCopy.length > 0, "the empty-state copy constant exists");
  assert.doesNotMatch(
    emptyCopy,
    /incomplete|not ready|missing|you should|you need to|get started by|before you can|required|remember to/i,
  );
});

test("INERT: no progress, percentage, count, badge, or score anywhere in the UI", () => {
  for (const source of [shared, checklistPage]) {
    const c = body(source);
    assert.doesNotMatch(c, /progress|percent|\bratio\b|\btotal\b|remaining|\bscore\b|badge|\bof\s*\{/i);
    // nothing filters or counts by completion
    assert.doesNotMatch(c, /\.filter\([^)]*isCompleted|\.reduce\(|isCompleted\)\.length/);
  }
});

test("INERT: no readiness / launch / reminder / overdue treatment", () => {
  for (const source of [shared, checklistPage, adapter]) {
    const c = body(source);
    assert.doesNotMatch(c, /readiness|launch|publish|remind|notify|calendar|ical|overdue|\bdue\b|\blate\b|deadline/i);
  }
  // the date is shown as plain organizer-entered information
  assert.match(checklistPage, /Target date: \{item\.targetDate\}/);
  // and never styled conditionally on its value
  assert.doesNotMatch(code(checklistPage), /targetDate[^\n]*[<>]=?[^\n]*(Date|now|today)/i);
});

test("the date input is date-only and carries the no-tracking note", () => {
  assert.match(shared, /type="date"/);
  assert.doesNotMatch(shared, /type="datetime-local"|type="time"/);
  assert.match(shared, /EpicentraX does not remind you or track this date\./);
});

test("the workspace exposes a 'Planning checklist' card alongside the other tools", () => {
  assert.match(workspacePage, /<PageSection title="Planning checklist"/);
  assert.match(workspacePage, /href=\{`\/organize\/\$\{encodeURIComponent\(draft\.event_id\)\}\/checklist`\}/);
  assert.match(workspacePage, /Open the checklist/);
  assert.match(workspacePage, /ticking things off does not control whether this Event is ready/);
  for (const title of ["Agenda", "Guest list", "Vendor plan", "Place plan", "Registry plan", "Launch readiness"]) {
    assert.match(workspacePage, new RegExp(`<PageSection title="${title}"`));
  }
});

test("the route states plainly that it is private and does not control readiness or launch", () => {
  assert.match(
    checklistPage,
    /This checklist is yours alone\. Nobody else can see it, and ticking things off does not control whether this Event is ready or when it can launch\./,
  );
});

test("the route supports add, edit, toggle, remove, and cancel", () => {
  assert.match(checklistPage, /toggleItem\(item\)/);
  assert.match(checklistPage, /type="checkbox"/);
  assert.match(checklistPage, /startEdit\(item\)/);
  assert.match(checklistPage, /removeItem\(item\)/);
  assert.match(checklistPage, /onClick=\{cancelEdit\}/);
  assert.equal((checklistPage.match(/>\s*Cancel\s*<\/AppButton>/g) ?? []).length, 2, "edit and add both cancel");
});

test("no ordering or reordering control exists in this phase", () => {
  for (const source of [shared, checklistPage]) {
    const c = code(source);
    assert.doesNotMatch(c, /sortOrder|reorder|moveUp|moveDown|drag|\.sort\(/i);
  }
});

test("the flow preserves event context and leaks no content into URLs or logs", () => {
  assert.match(checklistPage, /getMyPrivateEventDraft\(supabase, id\)/);
  assert.match(checklistPage, /listMyPrivateDraftChecklistItems\(supabase, id\)/);
  assert.match(checklistPage, /href=\{`\/organize\/\$\{encodeURIComponent\(eventId\)\}`\}/);
  assert.doesNotMatch(checklistPage, /\/admin\/|useAdmin|AdminRouteGuard|selectedEvent/);
  for (const href of [...checklistPage.matchAll(/href=\{`[^`]*`\}/g)].map((m) => m[0])) {
    assert.doesNotMatch(href, /item\.|title|organizerNote|targetDate/);
  }
  assert.doesNotMatch(checklistPage, /console\./);
  assert.doesNotMatch(adapter, /console\./);
});

test("the route only ever calls the four checklist adapter functions", () => {
  const calls = [...checklistPage.matchAll(/\b(list|add|update|delete)MyPrivateDraftChecklistItems?\b/g)].map((m) => m[0]);
  assert.deepEqual(new Set(calls), new Set([
    "listMyPrivateDraftChecklistItems",
    "addMyPrivateDraftChecklistItem",
    "updateMyPrivateDraftChecklistItem",
    "deleteMyPrivateDraftChecklistItem",
  ]));
});
