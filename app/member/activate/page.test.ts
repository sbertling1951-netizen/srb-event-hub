import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for Stage 2's migration of member
// activation's event picker to the governed Public Event Discovery RPC.
//
// Run with:
//   npx tsx --test app/member/activate/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("activation-eligible event list uses the public discovery RPC, not a direct events table read", () => {
  assert.match(SOURCE, /supabase\s*\.rpc\(\s*\n?\s*"get_public_discoverable_events",?\s*\n?\s*\)/);
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
});

test("no client-side re-filtering of the RPC's already-enforced visibility predicate", () => {
  assert.doesNotMatch(SOURCE, /isMemberVisibleEvent/);
  assert.doesNotMatch(SOURCE, /eventStatus/);
});

test("EventRow no longer carries visibility/lifecycle fields the RPC doesn't return", () => {
  const typeBlock = SOURCE.slice(SOURCE.indexOf("type EventRow"), SOURCE.indexOf("const inputStyle"));
  assert.doesNotMatch(typeBlock, /visible_to_members/);
  assert.doesNotMatch(typeBlock, /\bstatus\b/);
  assert.doesNotMatch(typeBlock, /is_active/);
  assert.doesNotMatch(typeBlock, /event_code/);
});

test("no public event_code is requested or displayed anywhere on this page", () => {
  assert.doesNotMatch(SOURCE, /event_code/);
});

test("display-ordering behavior (most recent first) is preserved via an explicit .order() on the RPC result", () => {
  assert.match(SOURCE, /\.rpc\(\s*\n?\s*"get_public_discoverable_events",?\s*\n?\s*\)\s*\n?\s*\.order\("start_date",\s*\{\s*ascending:\s*false/);
});

test("identity-claim evaluation flow (event selection, evidence submission) is unchanged", () => {
  assert.match(SOURCE, /selectedEventIds/);
  assert.match(SOURCE, /\/api\/member\/identity-claim\/evaluate/);
});

test("event evidence is labeled as registration, not attendance -- the list is current/upcoming registrations", () => {
  assert.match(SOURCE, /Events You(&apos;|')re Registered For/);
  assert.match(SOURCE, /registered to attend/);
  // the old, false "attended" framing is gone
  assert.doesNotMatch(SOURCE, /Events Personally Attended/);
  assert.doesNotMatch(SOURCE, /you already know you\s*\n?\s*attended/);
});

test("the server result string is trusted directly -- no lock-step allowlist that drops a valid new result", () => {
  const block = SOURCE.slice(
    SOURCE.indexOf("const safeResult"),
    SOURCE.indexOf("setResult(safeResult)"),
  );
  assert.match(
    block,
    /typeof payload\.result === "string" && payload\.result\.length > 0\s*\n\s*\? \(payload\.result as IdentityClaimPublicResult\)\s*\n\s*: "UNABLE_TO_VERIFY";/,
  );
  assert.doesNotMatch(block, /payload\.result === "CONTINUE_VERIFICATION"/);
  assert.doesNotMatch(block, /payload\.result === "ALREADY_ACTIVATED"/);
});

test("an ALREADY_ACTIVATED result replaces activation with a sign-in state", () => {
  assert.match(SOURCE, /const accountAlreadyActivated = result === "ALREADY_ACTIVATED";/);
  assert.match(SOURCE, /aria-labelledby="already-activated-heading"/);
  assert.match(SOURCE, /We found your account\. Sign in to continue/);
  assert.match(SOURCE, /<fieldset\s+disabled=\{accountAlreadyActivated\}/);

  const resultActionBlock = SOURCE.slice(
    SOURCE.indexOf("{accountAlreadyActivated ? (", SOURCE.indexOf("<fieldset")),
    SOURCE.indexOf("{status && !accountAlreadyActivated ?"),
  );
  const alreadyActivatedAction = resultActionBlock.slice(
    0,
    resultActionBlock.indexOf(") : ("),
  );
  assert.match(alreadyActivatedAction, /href="\/member\/login"/);
  assert.match(alreadyActivatedAction, /Sign in to My Account/);
  assert.match(alreadyActivatedAction, /Email me a recovery link/);
  assert.doesNotMatch(alreadyActivatedAction, /type="submit"|>Continue</);
  // This state never triggers the activation/magic-link step.
  assert.doesNotMatch(alreadyActivatedAction, /sendActivationMagicLink|magicLink|Finish Activating/);
  // and the "Finish Activating" box stays gated on CONTINUE_VERIFICATION only
  assert.match(
    SOURCE,
    /\{result === "CONTINUE_VERIFICATION" && attemptToken \? \(/,
  );
});
