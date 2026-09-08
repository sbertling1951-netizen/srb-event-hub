import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const shared = readFileSync(
  fileURLToPath(new URL("./OrganizerVenuePlanFields.tsx", import.meta.url)),
  "utf8",
);
const venuesPage = readFileSync(
  fileURLToPath(new URL("../../app/organize/[eventId]/venues/page.tsx", import.meta.url)),
  "utf8",
);
const workspacePage = readFileSync(
  fileURLToPath(new URL("../../app/organize/[eventId]/page.tsx", import.meta.url)),
  "utf8",
);
const adapter = readFileSync(
  fileURLToPath(new URL("../../lib/organizerVenuePlan.ts", import.meta.url)),
  "utf8",
);

test("the shared component owns the one venue-plan field set", () => {
  for (const label of [
    "Place",
    "Address or description",
    "Website",
    "Contact name",
    "Phone number",
    "Status",
    "Private note",
  ]) {
    assert.ok(shared.includes(label), `shared venue field set must render "${label}"`);
  }
  assert.match(shared, /export function OrganizerVenuePlanFields/);
  // the status control offers exactly the three approved statuses, from the
  // single adapter constant -- never a hand-written second list
  assert.match(shared, /VENUE_PLAN_STATUSES\.map/);
  assert.doesNotMatch(shared, /"considering"|"contacted"|"selected"/);
});

test("the add form and the edit form use the ONE shared component -- no duplicate field impl", () => {
  assert.match(venuesPage, /from "@\/components\/organize\/OrganizerVenuePlanFields"/);
  assert.equal((venuesPage.match(/<OrganizerVenuePlanFields\b/g) ?? []).length, 2, "add + edit both render it");
});

test("the workspace exposes a 'Place plan' card alongside Agenda, Guests, and Vendor plan", () => {
  assert.match(workspacePage, /<PageSection title="Place plan"/);
  assert.match(workspacePage, /href=\{`\/organize\/\$\{encodeURIComponent\(draft\.event_id\)\}\/venues`\}/);
  assert.match(workspacePage, /Open the place plan/);
  assert.match(workspacePage, /if \(state === "missing" \|\| !draft\) \{[\s\S]*?return[\s\S]*?\}\s*\n\s*return \(/);
  // the pre-existing sibling cards are untouched
  for (const title of ["Agenda", "Guest list", "Vendor plan", "Event details"]) {
    assert.match(workspacePage, new RegExp(`<PageSection title="${title}"`));
  }
});

test("the card and the route both say this does not set the Event location", () => {
  assert.match(workspacePage, /does not set this Event’s location/);
  assert.match(
    venuesPage,
    /Marking a place “Selected” is just a note to yourself\. It does not set this Event’s location/,
  );
  assert.match(
    venuesPage,
    /This place plan is visible only to you\. Nothing here contacts a place, holds a date, or books anything\./,
  );
  assert.match(venuesPage, /Planning for [^\n]*a private draft/);
});

test("the venue route never sends or names an official Event location field", () => {
  // Matched as WHOLE identifiers: the venue plan's own p_location_description
  // is legitimate and must not be mistaken for the Event's p_location.
  for (const forbidden of [
    "p_location",
    "p_location_mode",
    "p_venue_name",
    "p_street_address",
    "p_lat",
    "p_lng",
    "saveMyPrivateDraftDetails",
    "location_mode",
  ]) {
    const whole = new RegExp(`\\b${forbidden}\\b(?!_)`);
    assert.doesNotMatch(venuesPage, whole, `the venue route must not reference ${forbidden}`);
    assert.doesNotMatch(adapter, whole, `the adapter must not reference ${forbidden}`);
  }
  // and the one location-ish argument it DOES send is the private description
  assert.match(adapter, /p_location_description: input\.locationDescription/);
  // it only ever calls the four P-3E organizer venue-plan adapter functions
  const rpcCalls = [...venuesPage.matchAll(/\b(list|add|update|delete)MyPrivateDraftVenuePlans?\b/g)].map((m) => m[0]);
  assert.deepEqual(new Set(rpcCalls), new Set([
    "listMyPrivateDraftVenuePlans",
    "addMyPrivateDraftVenuePlan",
    "updateMyPrivateDraftVenuePlan",
    "deleteMyPrivateDraftVenuePlan",
  ]));
});

test("the venue route ships NO booking / map / vendor / admission / payment feature", () => {
  // ignore the two mandated copy blocks, which necessarily name some of these,
  // and normalize Array.prototype.map so it is not read as a geographic map
  const withoutCopy = venuesPage
    .replace(/This place plan is visible only to you\.[^"]*/, "")
    .replace(/Marking a place “Selected” is just a note to yourself\.[^"]*/, "")
    .replace(/\.map\(/g, ".__arrayMap(");
  // "unavailable" in the draft-not-found copy is not an availability feature
  const withoutUnavailable = withoutCopy.replace(/unavailable/gi, "");
  assert.doesNotMatch(withoutUnavailable, /\bbook\w*|\bhold\b|deposit|contract|availab|\bcapacity\b/i);
  assert.doesNotMatch(withoutCopy, /\bmap\b|\bpin\b|geocod|latitude|longitude|\bcoords?\b|directions|nearby/i);
  assert.doesNotMatch(withoutCopy, /\bvendor\b|\badmit|candidac|disposition|invit|notify|passport|\bpublish/i);
  assert.doesNotMatch(withoutCopy, /\bcost\b|\bquote\b|\bcurrency\b|\bprice\b|\busd\b|[€£¥]/i);
  assert.doesNotMatch(withoutCopy, /has_event_task|AdminRouteGuard|attendee|household|\bcheck[-\s]?in\b/i);
});

test("no accidental 'vendor' wording leaks into the venue surface", () => {
  // the venue component and page are about places, not vendors
  assert.doesNotMatch(shared, /vendor/i);
  const venueUi = venuesPage.replace(/OrganizerVenuePlanFields|organizerVenuePlan/g, "");
  assert.doesNotMatch(venueUi, /vendor/i);
});

test("the venue flow preserves the current event context (routes stay under /organize/[eventId])", () => {
  assert.match(venuesPage, /getMyPrivateEventDraft\(supabase, id\)/);
  assert.match(venuesPage, /listMyPrivateDraftVenuePlans\(supabase, id\)/);
  assert.match(venuesPage, /href=\{`\/organize\/\$\{encodeURIComponent\(eventId\)\}`\}/);
  assert.doesNotMatch(venuesPage, /\/admin\/|useAdmin|AdminRouteGuard|selectedEvent/);
});

test("no planner-entered content is put in a URL or a log", () => {
  const hrefs = [...venuesPage.matchAll(/href=\{`[^`]*`\}/g)].map((m) => m[0]);
  assert.ok(hrefs.length > 0);
  for (const href of hrefs) {
    assert.doesNotMatch(href, /placeName|locationDescription|contactName|contactPhone|organizerNote|website|entry\./);
  }
  assert.doesNotMatch(venuesPage, /console\.(log|warn|error|info|debug)/);
  assert.doesNotMatch(adapter, /console\./);
});

test("the adapter never asks the server to match a place against a catalog, map, or identity", () => {
  const code = adapter
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    // Array.prototype.map is not a geographic map
    .replace(/\.map\(/g, ".__arrayMap(");
  assert.doesNotMatch(code, /match|resolve|lookup|identity|\bperson\b|\baccount\b|catalog|geocode|nearby|\bmap\b/i);
  const rpcNames = [...adapter.matchAll(/client\.rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(rpcNames, [
    "add_my_private_draft_venue_plan",
    "delete_my_private_draft_venue_plan",
    "list_my_private_draft_venue_plans",
    "update_my_private_draft_venue_plan",
  ]);
});

test("the route supports cancel and removal", () => {
  assert.match(venuesPage, /onClick=\{cancelEdit\}/);
  assert.match(venuesPage, />\s*Cancel\s*<\/AppButton>/);
  assert.match(venuesPage, /removeEntry\(entry\)/);
  assert.match(venuesPage, />\s*Remove\s*<\/AppButton>/);
});
