import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
