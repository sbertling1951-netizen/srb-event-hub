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
  // emailRedirectTo is a hard-coded internal callback URL with a fixed
  // purpose -- never /organize directly (the shared client has
  // detectSessionInUrl:false), and never a caller-supplied redirect.
  assert.match(account, /new URL\("\/auth\/callback\?purpose=organizer", window\.location\.origin\)/);
  assert.match(account, /emailRedirectTo: organizerVerificationCallbackUrl\(\)/);
  assert.doesNotMatch(account, /emailRedirectTo:\s*new URL\("\/organize"/);
  // The callback recognizes "organizer" as a closed purpose that lands at /organize.
  assert.match(callback, /organizer: "\/organize"/);
  assert.match(callback, /value === "organizer"/);
});

test("the organizer UI requires verified email before creating a private draft", () => {
  assert.match(page, /user\.email_confirmed_at/);
  assert.match(page, /private draft — not live/i);
  assert.match(page, /Create private draft/);
});

test("a browser that cannot mint a secure idempotency key is told plainly and blocked", () => {
  assert.match(page, /secureDraftUnavailable = accessState === "ready" && !idempotencyKey/);
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
  // both non-created outcomes are handled, and only via the adapter's
  // discriminated result -- the page never inspects a raw error string here.
  assert.match(page, /result\.status === "identity_confirmation_required"/);
  assert.match(page, /result\.status === "identity_review_required"/);
  // confirmation routes to the existing identity-claim flow; canonical
  // /organize return is preserved (the organizer just comes back and retries).
  assert.match(page, /href="\/member\/activate"/);
  assert.match(page, /confirm your existing EpicentraX identity before creating this event/i);
  // neutral copy: no prior event / tenant / record / identifier is named
  assert.doesNotMatch(page, /prior (?:event|registration|tenant|record)|already registered|matched/i);
  // the draft redirect still only ever targets /organize/<eventId>
  assert.match(page, /window\.location\.assign\(\s*`\/organize\/\$\{encodeURIComponent\(result\.draft\.event_id\)\}`/);
  // after an uncertain outcome the server freezes it to the current key, so a
  // deliberate post-verification retry must use a fresh key
  assert.match(
    page,
    /identity_review_required"\s*\n\s*\)\s*\{[\s\S]*?setIdempotencyKey\(newIdempotencyKey\(\)\);\s*\n\s*return;/,
  );
});
