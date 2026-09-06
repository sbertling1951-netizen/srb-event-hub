import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const page = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
const workspace = readFileSync(fileURLToPath(new URL("./[eventId]/page.tsx", import.meta.url)), "utf8");
const account = readFileSync(fileURLToPath(new URL("./account/page.tsx", import.meta.url)), "utf8");
const callback = readFileSync(
  fileURLToPath(new URL("../auth/callback/page.tsx", import.meta.url)),
  "utf8",
);
const adapter = readFileSync(
  fileURLToPath(new URL("../../lib/organizerDrafts.ts", import.meta.url)),
  "utf8",
);

test("organizer start is isolated from admin and member workspaces", () => {
  assert.match(adapter, /create_self_service_organizer_draft/);
  assert.match(adapter, /list_my_self_service_private_drafts/);
  assert.doesNotMatch(`${page}\n${workspace}`, /\/(admin|member)\/(dashboard|events|photos)/);
});

test("signed-out organizers have a fixed-return sign-up and sign-in path", () => {
  assert.match(page, /href="\/organize\/account"/);
  assert.match(account, /supabase\.auth\.signUp/);
  assert.match(account, /supabase\.auth\.signInWithPassword/);
  assert.doesNotMatch(account, /useSearchParams|redirectTo=/);
});

test("account verification email returns through the one fixed organizer-aware auth callback", () => {
  assert.match(account, /new URL\("\/auth\/callback\?purpose=organizer", window\.location\.origin\)/);
  assert.match(account, /emailRedirectTo: organizerVerificationCallbackUrl\(\)/);
  assert.doesNotMatch(account, /emailRedirectTo:\s*new URL\("\/organize"/);
  assert.match(callback, /organizer: "\/organize"/);
  assert.match(callback, /value === "organizer"/);
});

test("the organizer UI requires verified email before creating a private draft", () => {
  assert.match(page, /user\.email_confirmed_at/);
  assert.match(page, /private draft — not live/i);
  assert.match(page, /Create a new event space/);
});

test("a browser that cannot mint a secure idempotency key is told plainly and blocked", () => {
  assert.match(page, /secureDraftUnavailable = accessState === "ready" && !newSpaceKey/);
  assert.match(page, /up-to-date browser over a secure \(https\) connection/);
  assert.match(page, /disabled=\{secureDraftUnavailable\}/);
  assert.match(
    adapter,
    /Your browser could not start a secure draft\. Use an up-to-date browser over a secure \(https\) connection, then try again\./,
  );
});

test("the workspace uses the caller-scoped private-draft reader", () => {
  assert.match(workspace, /getMyPrivateEventDraft\(supabase, requestedEventId\)/);
  assert.doesNotMatch(workspace, /\.from\(/);
  assert.match(workspace, /Guests cannot access, discover, join, share, register/);
});

test("the organizer UI handles each identity outcome without leaking prior-record detail", () => {
  assert.match(page, /result\.status === "identity_confirmation_required"/);
  assert.match(page, /result\.status === "identity_review_required"/);
  assert.match(page, /href="\/member\/activate"/);
  assert.match(page, /confirm your existing EpicentraX identity before creating this event/i);
  assert.doesNotMatch(page, /prior (?:event|registration|tenant|record)|already registered|matched/i);
  assert.match(page, /window\.location\.assign\(\s*`\/organize\/\$\{encodeURIComponent\(result\.draft\.event_id\)\}`/);
  // both creation actions rotate to a fresh idempotency key so a deliberate
  // post-verification retry is a NEW request, never a silent re-meaning.
  assert.match(page, /setNewSpaceKey\(newIdempotencyKey\(\)\);/);
  assert.match(page, /setAddKey\(newIdempotencyKey\(\)\);/);
});

test("P-2C: the home lists the caller's event spaces and adds events to them, with no cross-context data", () => {
  // user-facing language is "event spaces", never "tenant"
  assert.match(page, /Your event spaces/);
  assert.doesNotMatch(page, /\btenant\b/i);
  // it reads only the caller's own organizer spaces + drafts -- no membership,
  // attendee, invitation, or admin-assignment reader is imported or called
  assert.match(page, /listMyPrivateOrganizations\(supabase\)/);
  assert.match(page, /listMyPrivateEventDrafts\(supabase\)/);
  assert.doesNotMatch(page, /listMy(?:Memberships|Attendee|AdminAssignments)|adminEventAccess|tenant_members/);
  // "Add an event" reuses the governed add-event command; "Create a new event
  // space" reuses the existing new-space command.
  assert.match(page, /Add an event/);
  assert.match(page, /createEventInMyOrganization\(supabase/);
  assert.match(page, /createMyPrivateEventDraft\(supabase/);
  // a created event (new space OR added) opens its private draft workspace
  assert.match(page, /`\/organize\/\$\{encodeURIComponent\(result\.draft\.event_id\)\}`/);
  // no rename / edit-event-space affordance in this slice
  assert.doesNotMatch(page, /rename|renameOrganization|editEventSpace/i);
});
