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
  wedding: "Wedding",
};

test("every supported stored key maps to the agreed organizer-facing label", () => {
  for (const [key, label] of Object.entries(AGREED_LABELS)) {
    assert.equal(starterTemplateLabel(key), label, `key "${key}" must display as "${label}"`);
  }
  // the catalog covers exactly the agreed keys, in a stable order
  assert.deepEqual(STARTER_TEMPLATES.map((t) => t.key), Object.keys(AGREED_LABELS));
});

test("an unexpected / null stored key resolves to a neutral friendly fallback, never the raw value", () => {
  // NB: "wedding" used to sit in this list. It is now a real supported key
  // (see the wedding test below), so an unrecognized sample replaces it.
  for (const bad of ["", "legacy_potluck", "housewarming", null, undefined]) {
    const shown = starterTemplateLabel(bad as string);
    assert.equal(shown, UNKNOWN_STARTER_TEMPLATE_LABEL);
    if (typeof bad === "string" && bad) {
      assert.doesNotMatch(shown, new RegExp(bad));
    }
  }
  assert.doesNotMatch(UNKNOWN_STARTER_TEMPLATE_LABEL, /_|^[a-z]+$/);
});

test("WEDDING: the approved key, label, and detail are in the one canonical catalog", () => {
  const wedding = STARTER_TEMPLATES.find((t) => t.key === "wedding");
  assert.ok(wedding, "wedding is a supported starter template");
  assert.equal(wedding.key, "wedding", "the stored key is exactly 'wedding'");
  assert.equal(wedding.label, "Wedding", "the approved organizer label");
  assert.equal(wedding.detail, "A starting point for a wedding celebration.", "the approved detail");
  // it resolves through the one helper, so create, edit, and the saved card
  // all render it identically
  assert.equal(starterTemplateLabel("wedding"), "Wedding");
  assert.notEqual(starterTemplateLabel("wedding"), UNKNOWN_STARTER_TEMPLATE_LABEL);
});

test("WEDDING: adding it changed no existing key, label, detail, or order", () => {
  const before = [
    ["casual", "Casual gathering", "A simple starting point for a get-together."],
    ["birthday_family", "Birthday or family", "A welcoming plan for family and friends."],
    ["club_rv", "Club or RV group", "A familiar starting point for a club gathering."],
    ["conference_corporate", "Conference or organization", "A starting point for a larger organized event."],
    ["dinner", "Dinner", "A focused starting point for a meal together."],
    ["sports_activity", "Sports or activity", "A starting point for an activity-centered event."],
  ];
  // the six originals are still first, in their original order, untouched
  assert.deepEqual(
    STARTER_TEMPLATES.slice(0, 6).map((t) => [t.key, t.label, t.detail]),
    before,
  );
  // and wedding is appended, not inserted
  assert.equal(STARTER_TEMPLATES.length, 7);
  assert.equal(STARTER_TEMPLATES[6].key, "wedding");
});

test("WEDDING carries no wedding-specific behavior -- it is a neutral starting point", () => {
  // the catalog entry is data only: key, label, detail. No flags, no fields.
  for (const t of STARTER_TEMPLATES) {
    assert.deepEqual(Object.keys(t).sort(), ["detail", "key", "label"]);
  }
  // and no organizer surface branches on the wedding key
  for (const src of [shared, createPage, workspacePage]) {
    assert.doesNotMatch(src, /["']wedding["']\s*(===|!==|==)/);
    assert.doesNotMatch(src, /(===|!==|==)\s*["']wedding["']/);
  }
  // Every mention of "wedding" in the component's code sits on ONE line -- the
  // catalog entry itself (which names it three times: key, label, and inside
  // the detail sentence). There is no second line to branch on, style by, or
  // special-case. (Asserted on comment-stripped code: the file's doc comments
  // legitimately discuss unrelated features.)
  const sharedCode = shared.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const weddingLines = sharedCode.split("\n").filter((l) => /wedding/i.test(l));
  assert.equal(weddingLines.length, 1, "wedding is mentioned on exactly one line of code");
  assert.match(weddingLines[0], /\{ key: "wedding", label: "Wedding", detail: "A starting point for a wedding celebration\." \},/);
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
    assert.doesNotMatch(src, />\s*\{?\s*["']?(casual|birthday_family|club_rv|conference_corporate|sports_activity|wedding)["']?\s*\}?\s*</);
  }
});

// ---------------------------------------------------------------------------
// §B.1 adoption pre-fill: the "Use a planned place" selector.
// The contract's rule is a PRE-FILL ON AN EXISTING FORM, never a write path.
// ---------------------------------------------------------------------------

const venuePlanAdapter = readFileSync(
  fileURLToPath(new URL("../../lib/organizerVenuePlan.ts", import.meta.url)),
  "utf8",
);

test("the selector uses the exact approved wording", () => {
  assert.match(shared, /Use a planned place/);
  assert.match(shared, /<option value="">Choose a planned place<\/option>/);
  assert.match(shared, /This fills the Location field\. Save changes to use it for this Event\./);
});

test("the selector renders ONLY when options exist and the Location field is showing", () => {
  // guarded on a non-empty option list -- no confusing empty UI
  assert.match(shared, /plannedPlaceOptions && plannedPlaceOptions\.length > 0 \? \(/);
  // and it lives inside the existing locationMode === "location" branch
  const locBlock = shared.slice(
    shared.indexOf('values.locationMode === "location" ? ('),
    shared.indexOf("Starter template"),
  );
  assert.ok(locBlock.includes("Use a planned place"), "the selector sits with the Location field");
  assert.ok(locBlock.includes("Location\n"), "the Location input is still rendered in that branch");
});

test("the create surface passes no options, so it is unchanged", () => {
  assert.doesNotMatch(createPage, /plannedPlaceOptions/);
  assert.match(shared, /plannedPlaceOptions\?: string\[\]/, "the prop is optional");
});

test("COPY-NOT-LINK: the component receives only strings -- never an id or record", () => {
  assert.match(shared, /plannedPlaceOptions\?: string\[\]/);
  // no venue-plan type, id, or status is imported or referenced by the field set
  assert.doesNotMatch(shared, /VenuePlanEntry|venuePlanId|venue_plan_id|planningStatus|planning_status/);
  assert.doesNotMatch(shared, /organizerVenuePlan/);
  // the page maps entries to TEXT before handing them over
  assert.match(workspacePage, /entries\.map\(venuePlanLocationText\)/);
  // and never keeps the entries themselves in the form or the save payload
  assert.doesNotMatch(workspacePage, /venuePlanId|venue_plan_id|p_venue_plan_id/);
});

test("SELECTION WRITES ONLY values.location -- never locationMode or any other field", () => {
  const onChangeBlock = shared.slice(
    shared.indexOf("Use a planned place"),
    shared.indexOf("Choose a planned place"),
  );
  assert.match(onChangeBlock, /update\("location", text\)/);
  // exactly one update call in the selector, and it targets location
  const updates = [...onChangeBlock.matchAll(/update\("(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(updates, ["location"]);
  // the selector never calls the mode helper or touches any other stored field
  assert.doesNotMatch(onChangeBlock, /updateLocationMode|locationMode|venue_name|street_address|lat|lng/);
});

test("NO WRITE ON SELECTION: the selector performs no save, RPC, or navigation", () => {
  const selectorBlock = shared.slice(
    shared.indexOf("Use a planned place"),
    shared.indexOf("Starter template"),
  );
  assert.doesNotMatch(selectorBlock, /supabase|\.rpc\(|await |async |fetch\(|router|window\.location|assign\(/);
  // the shared field set as a whole stays presentational
  assert.doesNotMatch(shared, /supabase|\.rpc\(|fetch\(/);
});

test("the select is a one-shot action, not bound state (always returns to its placeholder)", () => {
  const selectorBlock = shared.slice(
    shared.indexOf("Use a planned place"),
    shared.indexOf("Starter template"),
  );
  assert.match(selectorBlock, /value=""/, "bound to the empty string, so it never holds a selection");
  assert.match(selectorBlock, /if \(text\) \{/, "the empty placeholder choice does nothing");
});

test("the page loads options through the EXISTING owner-only venue-plan read path", () => {
  assert.match(workspacePage, /listMyPrivateDraftVenuePlans\(supabase, eventId\)/);
  // scoped to this exact draft, and only when the organizer starts editing
  assert.match(workspacePage, /void loadPlannedPlaceOptions\(draft\.event_id\)/);
  // no independent table query and no new adoption command
  assert.doesNotMatch(workspacePage, /self_service_private_draft_venue_plans|adopt_|\.from\(/);
  // a failure degrades silently to no selector -- no content-bearing error
  assert.match(workspacePage, /catch \{\s*\n\s*setPlannedPlaceOptions\(\[\]\);/);
});

test("SAVE remains the sole writer of official Event details", () => {
  // exactly one call to the governed save, unchanged
  assert.equal((workspacePage.match(/saveMyPrivateDraftDetails\(/g) ?? []).length, 1);
  // it still sends the baseline for the optimistic-concurrency check
  assert.match(workspacePage, /expected: baseline/);
  assert.match(workspacePage, /result\.status === "stale"/);
  // the pre-fill path introduces no other writer. Asserted against CODE, not
  // comments -- the explanatory comment legitimately names the adoption path.
  const workspaceCode = workspacePage
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(workspaceCode, /adopt|p_venue_plan_id|set_event_location/i);
});

test("'selected' gets no special treatment anywhere in the pre-fill path", () => {
  for (const source of [shared, workspacePage]) {
    assert.doesNotMatch(source, /['"]selected['"]/);
    assert.doesNotMatch(source, /planningStatus/);
  }
  // the helper that builds the text ignores status entirely
  const helper = venuePlanAdapter.slice(
    venuePlanAdapter.indexOf("export function venuePlanLocationText"),
    venuePlanAdapter.indexOf("function coerceEntry"),
  );
  assert.doesNotMatch(helper, /planningStatus|selected|status/);
});

test("manual Location typing is untouched by the pre-fill", () => {
  // the Location input keeps its own onChange straight into values.location
  assert.match(
    shared,
    /value=\{values\.location\} onChange=\{\(event\) => update\("location", event\.target\.value\)\} required/,
  );
});
