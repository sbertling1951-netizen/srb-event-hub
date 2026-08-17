import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

test("participation gating is derived from the governed Locator result itself, never a separately-read legacy flag", () => {
  assert.equal(/get_my_attendee_record/.test(source), false);
  assert.equal(/share_with_attendees/.test(source), false);
  assert.match(source, /rows\.some\(\(row\) => row\.id === attendeeId\)/);
});

test("household members are not fetched or rendered on this surface", () => {
  assert.equal(/get_event_locator_household_members/.test(source), false);
  assert.equal(/HouseholdMember/.test(source), false);
  assert.equal(/Co-Pilot/.test(source), false);
});

test("no operational/admin flag (first-timer, volunteer, handicap, arrival status) is displayed here", () => {
  for (const forbidden of ["first_time", "volunteer", "handicap_parking", "has_arrived", "arrival_status"]) {
    assert.equal(source.includes(forbidden), false, `must not reference '${forbidden}'`);
  }
});

test("the Attendee type carries only the five governed sharing fields plus id", () => {
  const typeBlock = source.match(/type Attendee = \{[\s\S]*?\};/)?.[0];
  assert.ok(typeBlock, "expected the Attendee type declaration");
  for (const field of [
    "id",
    "pilot_first",
    "pilot_last",
    "email",
    "phone",
    "campsite_location",
    "coach_make",
    "coach_model",
  ]) {
    assert.match(typeBlock!, new RegExp(`\\b${field}\\b`));
  }
  const fieldCount = (typeBlock!.match(/:\s*(string|boolean)/g) || []).length;
  assert.equal(fieldCount, 8, "expected exactly the eight documented fields, no more");
});
