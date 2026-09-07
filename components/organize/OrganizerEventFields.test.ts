import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  STARTER_TEMPLATES,
  starterTemplateLabel,
  UNKNOWN_STARTER_TEMPLATE_LABEL,
} from "./OrganizerEventFields";

const shared = readFileSync(fileURLToPath(new URL("./OrganizerEventFields.tsx", import.meta.url)), "utf8");
const createPage = readFileSync(
  fileURLToPath(new URL("../../app/organize/page.tsx", import.meta.url)),
  "utf8",
);
const workspacePage = readFileSync(
  fileURLToPath(new URL("../../app/organize/[eventId]/page.tsx", import.meta.url)),
  "utf8",
);

const FIELD_LABELS = ["Event name", "Start date", "End date", "Time zone", "Event place", "Starter template"];

test("the shared component owns the one organizer event-detail field set", () => {
  for (const label of FIELD_LABELS) {
    assert.ok(shared.includes(label), `shared field set must render "${label}"`);
  }
  assert.match(shared, /export function OrganizerEventFields/);
  assert.match(shared, /export type OrganizerEventFormValues/);
  assert.match(shared, /export const STARTER_TEMPLATES/);
});

test("both the create surface and the edit surface use the shared component -- no duplicate field impl", () => {
  for (const [name, src] of [["create page", createPage], ["workspace page", workspacePage]] as const) {
    assert.match(src, /from "@\/components\/organize\/OrganizerEventFields"/, `${name} imports the shared module`);
    assert.match(src, /<OrganizerEventFields\b/, `${name} renders the shared component`);
    // no page-local re-implementation of the fields
    assert.doesNotMatch(src, /function EventFields\(/, `${name} must not define its own EventFields`);
    assert.doesNotMatch(src, /"Time zone"[\s\S]{0,400}"Starter template"/, `${name} must not inline the field list`);
  }
});

test("the shared field set is organizer-neutral -- no tenant / organization / 'event space' input", () => {
  const code = shared.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /event space/i);
  assert.doesNotMatch(code, /organization name|Organization name|\btenant\b/i);
  assert.doesNotMatch(code, /visible_to_members|is_active|\blaunch\b|\bpublish\b/i);
});

test("organizerEventValuesFromDraft prefills every editable field from persisted draft values", () => {
  assert.match(shared, /export function organizerEventValuesFromDraft/);
  for (const field of ["event_name", "start_date", "end_date", "timezone", "location_mode", "location", "starter_template"]) {
    assert.ok(shared.includes(`draft.${field}`), `prefill must read draft.${field}`);
  }
});

// ---- canonical starter-template labels ----

const AGREED_LABELS: Record<string, string> = {
  casual: "Casual gathering",
  birthday_family: "Birthday or family",
  club_rv: "Club or RV group",
  conference_corporate: "Conference or organization",
  dinner: "Dinner",
  sports_activity: "Sports or activity",
};

test("every supported stored key maps to the agreed organizer-facing label", () => {
  for (const [key, label] of Object.entries(AGREED_LABELS)) {
    assert.equal(starterTemplateLabel(key), label, `key "${key}" must display as "${label}"`);
  }
  // the catalog covers exactly the agreed keys, in a stable order
  assert.deepEqual(STARTER_TEMPLATES.map((t) => t.key), Object.keys(AGREED_LABELS));
});

test("an unexpected / null stored key resolves to a neutral friendly fallback, never the raw value", () => {
  for (const bad of ["", "legacy_potluck", "wedding", null, undefined]) {
    const shown = starterTemplateLabel(bad as string);
    assert.equal(shown, UNKNOWN_STARTER_TEMPLATE_LABEL);
    if (typeof bad === "string" && bad) {
      assert.doesNotMatch(shown, new RegExp(bad));
    }
  }
  assert.doesNotMatch(UNKNOWN_STARTER_TEMPLATE_LABEL, /_|^[a-z]+$/);
});

test("the create/edit selector options are built from the same canonical catalog", () => {
  // the selector maps STARTER_TEMPLATES -> <option value=key>{label}</option>
  assert.match(shared, /STARTER_TEMPLATES\.map\(\(template\) => <option key=\{template\.key\} value=\{template\.key\}>\{template\.label\}<\/option>\)/);
  // no hand-written option label list anywhere in the shared component
  assert.doesNotMatch(shared.replace(/label: "[^"]+"/g, ""), /<option[^>]*>(Casual|Birthday|Dinner|Sports)/);
});

test("the saved Event details card renders the friendly label via the shared helper, never the raw key", () => {
  assert.match(workspacePage, /starterTemplateLabel\(draft\.starter_template\)/);
  assert.doesNotMatch(workspacePage, /\{draft\.starter_template\}/);
  // and it imports the helper from the one canonical module
  assert.match(workspacePage, /starterTemplateLabel,?\s*\n?\s*\} from "@\/components\/organize\/OrganizerEventFields"/s);
});

test("no organizer surface renders a raw stored template key as user-facing text", () => {
  for (const src of [shared, createPage, workspacePage]) {
    // a bare stored key used as JSX text content
    assert.doesNotMatch(src, />\s*\{?\s*["']?(casual|birthday_family|club_rv|conference_corporate|sports_activity)["']?\s*\}?\s*</);
  }
});
