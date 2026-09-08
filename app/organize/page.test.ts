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

test("the organizer UI requires a verified email before creating a private draft", () => {
  assert.match(page, /user\.email_confirmed_at/);
  assert.match(page, /private draft — not live/i);
});

test("a browser that cannot mint a secure idempotency key is told plainly and blocked", () => {
  assert.match(page, /secureRequestUnavailable = accessState === "ready" && !createKey/);
  assert.match(page, /up-to-date browser over a secure \(https\) connection/);
  assert.match(page, /disabled=\{secureRequestUnavailable\}/);
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
  // a deliberate post-verification retry is a NEW request, never a silent re-meaning
  assert.match(page, /setCreateKey\(newIdempotencyKey\(\)\);/);
});

// ---- P-2D: one clean "Your events" view, no "space" language, capacity gating ----

test("P-2D: the organizer never sees 'event space' / tenant / workspace-container language", () => {
  const visible = page.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(visible, /\bevent space\b/i);
  assert.doesNotMatch(visible, /\btenant\b/i);
  assert.doesNotMatch(visible, /Create a new event space/);
  assert.doesNotMatch(visible, /Add an event/);
});

test("P-2D: a single, non-duplicated event list, each with Continue planning", () => {
  assert.match(page, /title="Your events"/);
  // exactly one list of drafts is rendered
  assert.equal((page.match(/drafts\.map\(/g) ?? []).length, 1);
  assert.match(page, />Continue planning</);
  // the old parallel "spaces" + "private drafts" sections and their readers are gone
  assert.doesNotMatch(page, /listMyPrivateOrganizations|OrganizerPrivateOrganization|createEventInMyOrganization/);
});

test("P-2D: creation maps the single Event name onto the internal organization-name input", () => {
  assert.match(page, /organizationName: form\.eventName/);
  assert.match(page, /createMyPrivateEventDraft\(supabase/);
  // there is no separate organization / space name field
  assert.doesNotMatch(page, /Event space name|Organization name|organizationName: newSpaceForm/);
});

test("P-2D: capacity gating drives an explicit, irreversible Start-over confirmation", () => {
  assert.match(page, /getMyOrganizerCapacity\(supabase\)/);
  assert.match(page, /can_start_another_event/);
  assert.match(page, /Start over with a new event/);
  // the confirm step spells out that it is permanent and cannot be resumed
  assert.match(page, /permanently deletes your current unfinished event/i);
  assert.match(page, /cannot be undone and it cannot be\s+resumed/i);
  assert.match(page, /deleteMyUnfinishedEvent\(supabase/);
  // after a confirmed delete, the clean new-event form is shown
  assert.match(page, /setStartedOver\(true\)/);
  assert.match(page, /startedOver \? "Start your new event"/);
});

test("P-2D: a quiet subscription note appears, with no upgrade / billing / entitlement UI", () => {
  assert.match(page, /A future subscription will let you plan more than one at once\./);
  // no upgrade / billing / entitlement call to action
  assert.doesNotMatch(page, /\bupgrade\b|\bbilling\b|\bentitlement\b|\bsubscribe\b|\$\d/i);
});

test("P-2D: grandfathered multiple drafts are listed once, never auto-deleted, with no extra creation controls", () => {
  assert.match(page, /grandfatheredExtra = drafts\.length > 1/);
  // when there are extra drafts, the create form and the start-over control are both withheld
  assert.match(page, /showCreateForm = startedOver \|\| \(!loading && drafts\.length === 0\)/);
  assert.match(page, /grandfatheredExtra \? \(/);
  assert.doesNotMatch(page, /drafts\.forEach[\s\S]*delete|auto.?delete/i);
});

test("P-2D: the draft workspace has an explicit Delete unfinished event action that returns to /organize", () => {
  assert.match(workspace, /Delete unfinished event/);
  assert.match(workspace, /deleteMyUnfinishedEvent\(supabase/);
  assert.match(workspace, /permanently deletes this unfinished event/i);
  assert.match(workspace, /cannot be undone and it cannot be\s+resumed/i);
  assert.match(workspace, /window\.location\.assign\("\/organize"\)/);
});

// ---- P-3A: edit event details in place ----

test("P-3A: the Event details section has an Edit event details action with Save changes / Cancel", () => {
  assert.match(workspace, /Edit event details/);
  assert.match(workspace, /Save changes/);
  assert.match(workspace, />Cancel</);
  // edit is in place inside the same section, not a new route
  assert.match(workspace, /<PageSection title="Event details"[\s\S]*?editing && form \?/);
  assert.doesNotMatch(workspace, /router\.push|<Link href=\{`\/organize\/[^`]*\/edit/);
});

test("P-3A: edit prefills current values via the shared component and saves through the organizer RPC", () => {
  assert.match(workspace, /organizerEventValuesFromDraft\(draft\)/);
  // whitespace-tolerant: the element gained an optional plannedPlaceOptions
  // prop (§B.1 pre-fill) and is now wrapped across lines, but form/setForm are
  // still exactly how the edit surface is wired to the shared component
  assert.match(workspace, /<OrganizerEventFields\b[\s\S]{0,160}?values=\{form\}[\s\S]{0,80}?onChange=\{setForm\}/);
  assert.match(workspace, /saveMyPrivateDraftDetails\(supabase, \{\s*\n\s*eventId: draft\.event_id,\s*\n\s*values: form,\s*\n\s*expected: baseline,/);
  // on success the displayed draft is updated from the RPC result
  assert.match(workspace, /setDraft\(result\.draft\)/);
});

test("P-3A: a stale-save shows a refresh-required message and does not overwrite", () => {
  assert.match(workspace, /result\.status === "stale"/);
  assert.match(workspace, /setSaveStale\(true\)/);
  assert.match(workspace, /This event changed somewhere else[\s\S]*?were not saved/i);
  assert.match(workspace, /Refresh this page to load the latest details/i);
  // stale path returns before touching the displayed draft
  assert.match(workspace, /if \(result\.status === "stale"\) \{\s*\n\s*setSaveStale\(true\);\s*\n\s*return;/);
});

test("P-3A: the organizer edit surface shows no FCOC / admin / event-space terminology and no launch/publish control", () => {
  const visible = workspace.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(visible, /\bFCOC\b|\badmin\b|event space|\btenant\b/i);
  assert.doesNotMatch(visible, /\bEvent Admin\b|admin_save_event_details|has_event_admin_authority/);
  // the no-launch boundary messaging is retained
  assert.match(workspace, /Private draft — not live/);
  assert.match(workspace, /None of those actions are available from this draft yet/);
});

test("P-3A: delete behavior on the workspace is unchanged (still present alongside the new edit action)", () => {
  assert.match(workspace, /Delete unfinished event/);
  assert.match(workspace, /deleteMyUnfinishedEvent\(supabase/);
});
