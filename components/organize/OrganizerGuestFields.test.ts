import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const shared = readFileSync(
  fileURLToPath(new URL("./OrganizerGuestFields.tsx", import.meta.url)),
  "utf8",
);
const guestsPage = readFileSync(
  fileURLToPath(new URL("../../app/organize/[eventId]/guests/page.tsx", import.meta.url)),
  "utf8",
);
const workspacePage = readFileSync(
  fileURLToPath(new URL("../../app/organize/[eventId]/page.tsx", import.meta.url)),
  "utf8",
);
const adapter = readFileSync(
  fileURLToPath(new URL("../../lib/organizerGuestList.ts", import.meta.url)),
  "utf8",
);

test("the shared component owns the one planned-guest field set", () => {
  for (const label of ["Name", "Email", "Phone", "Private note"]) {
    assert.ok(shared.includes(label), `shared guest field set must render "${label}"`);
  }
  assert.match(shared, /export function OrganizerGuestFields/);
});

test("the add form and the edit form use the ONE shared component -- no duplicate field impl", () => {
  assert.match(guestsPage, /from "@\/components\/organize\/OrganizerGuestFields"/);
  assert.equal((guestsPage.match(/<OrganizerGuestFields\b/g) ?? []).length, 2, "add + edit both render it");
});

test("the workspace exposes a 'Guest list' card that only renders for a loaded owned draft", () => {
  assert.match(workspacePage, /<PageSection title="Guest list"/);
  assert.match(workspacePage, /href=\{`\/organize\/\$\{encodeURIComponent\(draft\.event_id\)\}\/guests`\}/);
  assert.match(workspacePage, /Open the guest list/);
  assert.match(workspacePage, /if \(state === "missing" \|\| !draft\) \{[\s\S]*?return[\s\S]*?\}\s*\n\s*return \(/);
});

test("the guest route states plainly that no invitation / account / access / registration occurs", () => {
  assert.match(guestsPage, /Guest list/);
  assert.match(
    guestsPage,
    /This private guest list is visible only to you\. Adding someone here does not invite them, create an account, give access, or register them\./,
  );
  assert.match(guestsPage, /Planning for [^\n]*a private draft/);
});

test("the guest route ships NO invitation / send / registration / access / publish feature", () => {
  // ignore the one mandated privacy sentence, which necessarily names those words
  const withoutPrivacyCopy = guestsPage.replace(
    /This private guest list is visible only to you\.[^"]*/,
    "",
  );
  assert.doesNotMatch(withoutPrivacyCopy, /\binvit|\bsend\b|\bsms\b|notify|\brsvp\b|passport|activation|\bpublish/i);
  assert.doesNotMatch(withoutPrivacyCopy, /has_event_task|AdminRouteGuard|attendee|household|capacity|\bcheck[-\s]?in\b/i);
  // it only ever calls the four P-3C organizer guest adapter functions
  const rpcCalls = [...guestsPage.matchAll(/\b(list|add|update|delete)MyPrivateDraftPlannedGuests?\b/g)].map((m) => m[0]);
  assert.deepEqual(new Set(rpcCalls), new Set([
    "listMyPrivateDraftPlannedGuests",
    "addMyPrivateDraftPlannedGuest",
    "updateMyPrivateDraftPlannedGuest",
    "deleteMyPrivateDraftPlannedGuest",
  ]));
});

test("the guest flow preserves the current event context (routes stay under /organize/[eventId])", () => {
  assert.match(guestsPage, /getMyPrivateEventDraft\(supabase, id\)/);
  assert.match(guestsPage, /listMyPrivateDraftPlannedGuests\(supabase, id\)/);
  assert.match(guestsPage, /href=\{`\/organize\/\$\{encodeURIComponent\(eventId\)\}`\}/);
  assert.doesNotMatch(guestsPage, /\/admin\/|useAdmin|AdminRouteGuard|selectedEvent/);
});

test("the adapter never asks the server to match a guest against an existing identity", () => {
  const code = adapter.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /match|resolve|lookup|identity|\bperson\b|\baccount\b/i);
  const rpcNames = [...adapter.matchAll(/client\.rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(rpcNames, [
    "add_my_private_draft_planned_guest",
    "delete_my_private_draft_planned_guest",
    "list_my_private_draft_planned_guests",
    "update_my_private_draft_planned_guest",
  ]);
});

test("the shared guest field set carries no invitation / access / role control", () => {
  const code = shared.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /invite|role|access|household|capacity|rsvp|register/i);
});
