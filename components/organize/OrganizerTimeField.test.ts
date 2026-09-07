import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { organizerAgendaItemError } from "@/lib/organizerAgenda";

import {
  finalizeTimeInput,
  isCanonicalTime,
  normalizeTimeInput,
  stepTime,
} from "./OrganizerTimeField";

const rawSource = readFileSync(
  fileURLToPath(new URL("./OrganizerTimeField.tsx", import.meta.url)),
  "utf8",
);
// assertions about what the component *does* must not trip on doc prose
const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const fields = readFileSync(
  fileURLToPath(new URL("./OrganizerAgendaItemFields.tsx", import.meta.url)),
  "utf8",
);

const validItem = {
  title: "Session", description: "", location: "", speaker: "",
  agendaDate: "", startTime: "17:00", endTime: "",
};

test("an existing 24-hour value renders unchanged -- never 12-hour", () => {
  assert.equal(normalizeTimeInput("17:00"), "17:00");
  assert.equal(finalizeTimeInput("17:00"), "17:00");
  assert.equal(finalizeTimeInput("05:00"), "05:00");
  // no 12-hour / AM-PM formatting anywhere in the component
  assert.doesNotMatch(source, /\b(AM|PM)\b|["'](AM|PM)["']|hour12|hourCycle|toLocaleTimeString|DateTimeFormat/);
  assert.doesNotMatch(source, /type="time"/);
});

test("a compact digit run normalizes to canonical HH:MM", () => {
  assert.equal(normalizeTimeInput("1700"), "17:00");
  assert.equal(finalizeTimeInput("1700"), "17:00");
  assert.equal(finalizeTimeInput("930"), "09:30");
  assert.equal(finalizeTimeInput("9"), "09:00");
  assert.equal(finalizeTimeInput("17"), "17:00");
  assert.equal(finalizeTimeInput("9:5"), "09:05");
});

test("typing forward auto-inserts the colon after the hour and caps length", () => {
  assert.equal(normalizeTimeInput("1"), "1");
  assert.equal(normalizeTimeInput("17"), "17");
  assert.equal(normalizeTimeInput("170"), "17:0");
  assert.equal(normalizeTimeInput("1700"), "17:00");
  assert.equal(normalizeTimeInput("17005"), "17:00");
  assert.equal(normalizeTimeInput("17:00:00"), "17:00");
  assert.equal(normalizeTimeInput("5:00 PM"), "5:00"); // stray letters/space dropped
});

test("valid 24-hour boundaries are accepted end to end", () => {
  for (const value of ["00:00", "23:59", "09:05", "17:00"]) {
    assert.equal(finalizeTimeInput(value), value);
    assert.ok(isCanonicalTime(value));
    assert.equal(organizerAgendaItemError({ ...validItem, startTime: value }), null);
  }
});

test("invalid hour/minute values stay visibly invalid and never pass form validation", () => {
  for (const bad of ["24:00", "25:15", "17:60", "17:99", "9:70", "99:99"]) {
    assert.equal(isCanonicalTime(bad), false);
    // finalize does not coerce an out-of-range time into a different valid one
    const finalized = finalizeTimeInput(bad);
    assert.equal(isCanonicalTime(finalized), false, `finalize("${bad}") = "${finalized}" must stay invalid`);
    // the shared adapter validator rejects it before any RPC call
    assert.match(organizerAgendaItemError({ ...validItem, startTime: bad }) ?? "", /start time/i);
  }
});

test("the optional end time can remain blank; the start time cannot", () => {
  assert.equal(normalizeTimeInput(""), "");
  assert.equal(finalizeTimeInput(""), "");
  assert.equal(organizerAgendaItemError({ ...validItem, endTime: "" }), null);
  assert.match(organizerAgendaItemError({ ...validItem, startTime: "" }) ?? "", /start time/i);
  // the component itself marks only the start field required
  assert.match(fields, /value=\{values\.startTime\}[\s\S]*?required\s*\n\s*\/>/);
  assert.doesNotMatch(fields, /value=\{values\.endTime\}[\s\S]*?required/);
});

test("arrow-key stepping moves by one minute and wraps, but only from a valid time", () => {
  assert.equal(stepTime("17:00", 1), "17:01");
  assert.equal(stepTime("17:00", -1), "16:59");
  assert.equal(stepTime("23:59", 1), "00:00");
  assert.equal(stepTime("00:00", -1), "23:59");
  // a mid-edit partial or an out-of-range value is left untouched by arrows
  assert.equal(stepTime("17:", 1), "17:");
  assert.equal(stepTime("9", 1), "9");
  assert.equal(stepTime("25:00", 1), "25:00");
});

test("the component is a keyboard-first text input, not the native time picker", () => {
  assert.match(source, /type="text"/);
  assert.match(source, /inputMode="numeric"/);
  assert.match(source, /placeholder="HH:MM"/);
  assert.match(source, /onKeyDown=/);
  assert.match(source, /ArrowUp|ArrowDown/);
  // it preserves normal editing: no global preventDefault, only on the arrow keys
  assert.doesNotMatch(source, /event\.preventDefault\(\);\s*\n\s*\}\s*\n\s*\}\}\s*\n\s*onChange/);
});

test("the Agenda form uses the shared 24-hour field for both start and end -- no native time input", () => {
  assert.match(fields, /import \{ OrganizerTimeField \} from "\.\/OrganizerTimeField"/);
  assert.equal((fields.match(/<OrganizerTimeField\b/g) ?? []).length, 2);
  assert.doesNotMatch(fields, /type="time"/);
  assert.match(fields, /24-hour/);
});
