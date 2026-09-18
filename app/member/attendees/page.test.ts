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

test("the page is guarded by MemberRouteGuard and uses the canonical Member shell with no back target", () => {
  assert.match(source, /<MemberRouteGuard>/);
  assert.match(source, /<MemberShellAdapter pageTitle="Attendee Locator">/);
  assert.equal((source.match(/backTarget=/g) || []).length, 0);
});

test("shared Alert/EmptyState/PageSection/Field/Input primitives are used, and the failure surface is singular (no duplicate status+error)", () => {
  assert.match(source, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
  assert.match(source, /import \{ EmptyState \} from "@\/components\/ui\/EmptyState";/);
  assert.match(source, /import \{ Field, Input \} from "@\/components\/ui\/Field";/);
  assert.match(source, /import \{ PageSection \} from "@\/components\/ui\/PageSection";/);
  assert.match(source, /\{status && !error \? <Alert tone="info">Status: \{status\}<\/Alert> : null\}/);
  assert.match(source, /\{error \? <Alert tone="danger">\{error\}<\/Alert> : null\}/);
  assert.match(source, /<Alert tone="warning">/);
  assert.match(source, /<EmptyState message="No attendees found\." \/>/);
  assert.doesNotMatch(source, /<input\b/);
});

test("the query, its exact ordering, and the RPC-derived participation/lock gate are unchanged", () => {
  assert.match(
    source,
    /supabase\s*\n\s*\.rpc\("get_event_attendee_locator", rpcArgs\)\s*\n\s*\.order\("pilot_last", \{ ascending: true, nullsFirst: false \}\)\s*\n\s*\.order\("pilot_first", \{ ascending: true, nullsFirst: false \}\);/,
  );
  assert.match(source, /const viewerParticipates = attendeeId\s*\n\s*\? rows\.some\(\(row\) => row\.id === attendeeId\)\s*\n\s*: rows\.length > 0;/);
  assert.match(source, /if \(!viewerParticipates\) \{\s*\n\s*setCanViewLocator\(false\);/);
});

test("the search-matching logic across pilot/coach/site/email/phone is unchanged", () => {
  assert.match(
    source,
    /pilot\.includes\(q\) \|\|\s*\n\s*coach\.includes\(q\) \|\|\s*\n\s*site\.includes\(q\) \|\|\s*\n\s*email\.includes\(q\) \|\|\s*\n\s*phone\.includes\(q\)/,
  );
  assert.match(source, /value=\{search\}/);
  assert.match(source, /onChange=\{\(e\) => setSearch\(e\.target\.value\)\}/);
  assert.match(source, /placeholder="Name, email, phone, coach, or campsite"/);
});

test("engagement logging on view is unchanged", () => {
  assert.match(source, /activityType: "view_attendee_locator"/);
});
