import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ActivationCredentialFields, EmailCodeStep } from "./page";

// Member activation page: password-first evidence form followed by the
// same-page email-code step.
//
// Rendered-markup assertions use the page's exported presentational pieces
// (the repository's established react-dom/server technique); the sequence
// itself is proven behaviorally in activationFlow.test.ts. Source assertions
// cover wiring that a static render cannot reach (request bodies, guards).
//
// Run with:
//   npx tsx --test app/member/activate/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);
const CODE_ONLY = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

function fn(name: string, until: string): string {
  const start = CODE_ONLY.indexOf(name);
  const end = CODE_ONLY.indexOf(until, start);
  assert.ok(start > 0 && end > start, `${name} .. ${until} must exist in order`);
  return CODE_ONLY.slice(start, end);
}

// ---------------------------------------------------------------------------
// Retained event/identity guards

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
});

test("an ALREADY_ACTIVATED result routes directly to the one-time Member Login notice", () => {
  assert.match(SOURCE, /if \(safeResult === "ALREADY_ACTIVATED"\) \{/);
  assert.match(SOURCE, /router\.replace\("\/member\/login\?accountActivated=1"\);/);
  assert.doesNotMatch(SOURCE, /accountAlreadyActivated|already-activated-heading/);
  // The code step still renders only for a verified candidate with a token.
  assert.match(SOURCE, /\{result === "CONTINUE_VERIFICATION" && attemptToken && binding \? \(/);
});

test("temporary activation diagnostics are absent from the browser flow", () => {
  assert.doesNotMatch(SOURCE, /_diag|activate-diag|diagnostic \(temporary\)|setDiag/);
});

test("Continue disappears only after the server permits verification with an attempt token", () => {
  assert.match(SOURCE, /const verificationReady = result === "CONTINUE_VERIFICATION" && !!attemptToken;/);
  assert.match(SOURCE, /\{!verificationReady \? \(\s*<button\s*type="submit"/);
  assert.match(SOURCE, /Your account is not activated yet\./);
});

test("accepted information focuses the code step; editing EVIDENCE discards the attempt, code and verified phase, editing the password does not", () => {
  assert.match(SOURCE, /if \(verificationReady\) \{\s*verificationHeadingRef\.current\?\.focus\(\{ preventScroll: true \}\);\s*verificationHeadingRef\.current\?\.scrollIntoView\(\{ block: "start" \}\);/);
  const invalidate = fn("function invalidateEvidence()", "function evidenceChange");
  for (const call of ["setResult(null)", "setAttemptToken(null)", "setBinding(null)", 'setCode("")', "setVerified(null)", "setStop(null)"]) {
    assert.ok(invalidate.includes(call), `invalidateEvidence must ${call}`);
  }
  // Evidence inputs route through evidenceChange; the password inputs do not.
  for (const setter of ["setFirstName", "setLastName", "setHomeState", "setEmail", "setMobilePhone", "setMembershipNumber"]) {
    assert.match(SOURCE, new RegExp(`evidenceChange\\(${setter}\\)`), `${setter} must invalidate the attempt`);
  }
  assert.match(SOURCE, /onPasswordChange=\{credentialChange\(setPassword\)\}/);
  assert.match(SOURCE, /onConfirmPasswordChange=\{credentialChange\(setConfirmPassword\)\}/);
  assert.doesNotMatch(SOURCE, /evidenceChange\(setPassword\)|evidenceChange\(setConfirmPassword\)/);
  // After finalization, evidence is frozen and cannot be invalidated.
  assert.match(invalidate, /if \(evidenceFrozen\) \{\s*return;/);
});

// ---------------------------------------------------------------------------
// Password handling

test("the password is never part of the evaluate or email-request bodies, and never enters a URL or browser storage", () => {
  const evaluateBody = CODE_ONLY.slice(
    CODE_ONLY.indexOf('fetch("/api/member/identity-claim/evaluate"'),
    CODE_ONLY.indexOf("const payload:"),
  );
  assert.doesNotMatch(evaluateBody, /password/i);
  const initiateBody = CODE_ONLY.slice(
    CODE_ONLY.indexOf('fetch("/api/member/identity-claim/verification/initiate-magic-link"'),
    CODE_ONLY.indexOf("return response.ok;", CODE_ONLY.indexOf('fetch("/api/member/identity-claim/verification/initiate-magic-link"')),
  );
  assert.match(initiateBody, /attemptToken: target\.attemptToken,\s*\n\s*email: target\.normalizedEmail,/);
  assert.doesNotMatch(initiateBody, /password/i);
  assert.doesNotMatch(CODE_ONLY, /localStorage|sessionStorage/);
  // No URL ever carries the password: no query/fragment construction with it.
  assert.doesNotMatch(CODE_ONLY, /[?&#]password=|searchParams\.(set|append)\(\s*"password"|new URL\([^)]*password/);
  assert.doesNotMatch(CODE_ONLY, /console\./, "the page logs nothing: no password, token or response body can reach the console");
  // The page delegates every auth call to the flow module: it never calls
  // signUp, admin APIs or a password reset itself.
  assert.doesNotMatch(CODE_ONLY, /auth\.signUp|auth\.admin|resetPasswordForEmail|signInWithOtp|verifyOtp|updateUser/);
});

test("password rules come from the shared flow module and gate BOTH Continue and the code step", () => {
  const submit = fn("async function handleSubmit", "function applyOutcome");
  const evaluateIdx = submit.indexOf('fetch("/api/member/identity-claim/evaluate"');
  const passwordCheckIdx = submit.indexOf("validatePasswordPair(password, confirmPassword)");
  const emailCheckIdx = submit.indexOf("normalizeActivationEmail(email)");
  assert.ok(passwordCheckIdx > 0 && emailCheckIdx > 0 && evaluateIdx > 0);
  assert.ok(passwordCheckIdx < evaluateIdx, "weak/mismatched password stops before the evaluate request");
  assert.ok(emailCheckIdx < evaluateIdx, "a usable email is required before the evaluate request");
  const verify = fn("async function verifyAndFinish", "async function retryCredentials");
  assert.match(verify, /validatePasswordPair\(password, confirmPassword\)/);
});

test("the email is requested ONLY for CONTINUE_VERIFICATION with a token, immediately inside Continue, using the existing endpoint", () => {
  const submit = fn("async function handleSubmit", "function applyOutcome");
  assert.match(submit, /if \(safeResult === "CONTINUE_VERIFICATION" && token\) \{[\s\S]*?await requestEmailCode\(target\)/);
  const requestFn = fn("async function requestEmailCode", "async function handleSubmit");
  assert.match(requestFn, /\/api\/member\/identity-claim\/verification\/initiate-magic-link/);
  // Never portrayed as delivery proof.
  assert.match(SOURCE, /If your information is eligible, a verification code will arrive by email\. Enter it here to finish\./);
  assert.doesNotMatch(SOURCE, /Check your email to finish creating/);
});

// ---------------------------------------------------------------------------
// Fix 1: truthful email-request wording

test("Fix 1: a non-OK email request is a FAILURE (response.ok), a rejected fetch is a failure, and 200 is never described as delivery", () => {
  const requestFn = fn("async function requestEmailCode", "async function handleSubmit");
  assert.match(requestFn, /return response\.ok;/);
  assert.doesNotMatch(requestFn, /return true;/, "a resolved fetch must not be reported as success regardless of status");
  assert.match(requestFn, /catch \{\s*return false;/);
  assert.doesNotMatch(requestFn, /response\.(json|text)\(\)/, "the initiate response body is never read or logged");
  // The wording after acceptance names the request, not delivery; the address is a neutral label.
  // (Checked on comment-stripped code: this is about text a member can see.)
  assert.doesNotMatch(CODE_ONLY, /We sent it to|sent it to|has been sent|was sent|email sent/i);
  assert.match(SOURCE, /Email address: <strong>\{email\}<\/strong>/);
  assert.match(SOURCE, /Verification code requested\./);
  // Failure is shown as an error with resend still actionable.
  const show = fn("function showEmailRequestResult", "async function requestEmailCode");
  assert.match(show, /if \(accepted\) \{[\s\S]*?setCodeNotice\(CODE_REQUEST_ACCEPTED_NOTICE\)/);
  assert.match(show, /setCodeError\(CODE_REQUEST_FAILED_MESSAGE\)/);
  assert.match(SOURCE, /select "Send it again"/);
});

// ---------------------------------------------------------------------------
// Fix 3: one serialized lifecycle

test("Fix 3: ONE synchronous in-flight guard covers evaluate/send, resend, verify and credential retry, taken before the first await", () => {
  const begin = fn("function beginRun(", "function endRun(");
  assert.match(begin, /if \(runRef\.current\) \{\s*return null;/);
  assert.match(begin, /const run: Run = \{ op \};\s*runRef\.current = run;/);
  assert.match(begin, /const isCurrent = \(\) => runRef\.current === run && mountedRef\.current;/);
  const end = fn("function endRun(", "function scopedClient()");
  assert.match(end, /if \(runRef\.current !== run\) \{\s*return;/, "a stale run cannot unlock a newer one");
  assert.match(end, /runRef\.current = null;/);

  const submit = fn("async function handleSubmit", "function applyOutcome");
  const guardIdx = submit.indexOf('beginRun("evaluate")');
  const fetchIdx = submit.indexOf("await fetch(");
  assert.ok(guardIdx > 0 && guardIdx < fetchIdx, "the evaluate guard is taken before the first await");
  assert.match(submit, /if \(runRef\.current \|\| verificationReady\) \{\s*return;/);
  assert.match(submit, /finally \{\s*endRun\(run\);/);

  const verify = fn("async function verifyAndFinish", "async function retryCredentials");
  assert.match(verify, /beginRun\("verify"\)/);
  assert.match(verify, /finally \{\s*endRun\(run\);/);
  assert.match(verify, /catch \{[\s\S]*?setCodeError\(/, "an unexpected throw still settles the page with an error");

  const retry = fn("async function retryCredentials", "async function resendCode");
  assert.match(retry, /beginRun\("credentials"\)/);
  assert.match(retry, /finally \{\s*endRun\(run\);/);

  const resend = fn("async function resendCode", "function checkDetailsAgain");
  assert.match(resend, /if \(!binding \|\| runRef\.current \|\| stage !== "code"\) \{\s*return;/);
  assert.match(resend, /beginRun\("resend"\)/);
  assert.match(resend, /setCode\(""\)/);
  assert.match(resend, /finally \{\s*endRun\(run\);/);

  // Every control is disabled from the same guard's rendering mirror.
  assert.match(SOURCE, /const busy = activeOp !== null;/);
  assert.match(SOURCE, /busy=\{busy\}/);
  assert.match(SOURCE, /offerResend=\{!busy\}/);
  assert.match(SOURCE, /const fieldsDisabled = busy \|\| evidenceFrozen;/);
  assert.match(SOURCE, /<ActivationCredentialFields[\s\S]*?disabled=\{busy\}/);
  // No React-state busy flag is used as a guard anywhere.
  assert.doesNotMatch(CODE_ONLY, /codeBusy|setBusy\(/);
});

test("Fix 3: evidence, password and code edits are refused synchronously while any operation is in flight; evidence is frozen after finalization", () => {
  const evidence = fn("function evidenceChange", "function credentialChange");
  assert.match(evidence, /if \(runRef\.current \|\| evidenceFrozen\) \{\s*return;\s*\}\s*setter\(value\);/);
  const credential = fn("function credentialChange", "function codeChange");
  assert.match(credential, /if \(runRef\.current\) \{\s*return;\s*\}\s*setter\(value\);/);
  const codeFn = fn("function codeChange", "function showEmailRequestResult");
  assert.match(codeFn, /if \(runRef\.current\) \{\s*return;\s*\}\s*setCode\(value\);/);
  assert.match(SOURCE, /onCodeChange=\{codeChange\}/);
  const again = fn("function checkDetailsAgain", "function toggleEvent");
  assert.match(again, /if \(evidenceFrozen \|\| runRef\.current\) \{\s*return;/);
});

test("Fix 3: the evaluate continuation checks currentness after the response and again immediately before the send; unmount clears the run", () => {
  const submit = fn("async function handleSubmit", "function applyOutcome");
  assert.match(submit, /await response\.json\(\);\s*if \(!isCurrent\(\)\) \{\s*return;/);
  assert.match(submit, /if \(!isCurrent\(\)\) \{\s*return;\s*\}\s*const accepted = await requestEmailCode\(target\);\s*if \(!isCurrent\(\)\) \{\s*return;/);
  assert.match(submit, /catch \{\s*if \(!isCurrent\(\)\) \{\s*return;/);
  // Unmount stops any in-flight continuation.
  assert.match(SOURCE, /mountedRef\.current = false;\s*[\s\S]*?runRef\.current = null;/);
});

test("the sequence runs on a scoped non-persisting client and the shared client only receives the finished session", () => {
  assert.match(SOURCE, /createScopedActivationClient\(url, anon\)/);
  const verify = fn("async function verifyAndFinish", "async function retryCredentials");
  assert.match(verify, /runActivationSequence\(\s*\{\s*scoped,\s*shared: supabase,/);
  assert.doesNotMatch(verify, /supabase\.auth\./, "the page never reads the shared session to pick the password target");
});

test("stale continuations cannot overwrite a newer run", () => {
  const apply = fn("function applyOutcome", "function beginRun(");
  assert.match(apply, /if \(runRef\.current !== run \|\| !mountedRef\.current\) \{\s*return;/);
  for (const name of ["async function verifyAndFinish", "async function retryCredentials"]) {
    const body = CODE_ONLY.slice(CODE_ONLY.indexOf(name), CODE_ONLY.indexOf("finally", CODE_ONLY.indexOf(name)));
    assert.match(body, /onPhase: \(next\) => \{\s*if \(isCurrent\(\)\) \{\s*setPhase\(next\);/, `${name} phase updates are guarded`);
  }
});

// ---------------------------------------------------------------------------
// Fix 2: stage-truthful outcomes

test("Fix 2: outcomes keep a finalized identity only for credential retries, completion clears sensitive state, and the stage text is truthful", () => {
  const apply = fn("function applyOutcome", "function beginRun(");
  const completed = apply.slice(apply.indexOf('outcome.status === "completed"'), apply.indexOf("setCodeError(outcome.message)"));
  for (const call of ['setPassword("")', 'setConfirmPassword("")', 'setCode("")', 'router.replace("/member/account")']) {
    assert.ok(completed.includes(call), `completion must ${call}`);
  }
  assert.match(apply, /if \(outcome\.phase === "save"\) \{\s*setCredentialRetry\("password"\)/);
  assert.match(apply, /setCredentialRetry\("signin"\)/);
  // An explicit rejection may say the password was refused; an uncertain save may not.
  assert.match(apply, /outcome\.kind === "password_rejected"\s*\? "Your password was not accepted\./);
  assert.match(apply, /: "Whether your password was saved could not be confirmed\./);
  assert.doesNotMatch(SOURCE, /password was not saved/i);
  // After the save succeeded, the member is never told to save a password.
  assert.match(apply, /setCredentialRetry\("signin"\);\s*setCodeNotice\("Your password is saved\./);
  // An expired verified session exits truthfully instead of looping on retry.
  assert.match(apply, /outcome\.kind === "session_expired" \|\| outcome\.kind === "session_mismatch"[\s\S]*?setCredentialRetry\("none"\)/);
  // Uncertain finalizer stops every restart; explicit rejection allows a re-check.
  assert.match(apply, /case "finalize_error":[\s\S]*?setStop\("uncertain"\)/);
  assert.match(apply, /case "finalize_rejected":[\s\S]*?setStop\("rejected"\)/);
  // A thrown exchange keeps the typed code; an explicit rejection clears it.
  assert.match(apply, /case "verify_error":[\s\S]*?setCodeNotice\(null\);\s*break;/);
  assert.doesNotMatch(apply.slice(apply.indexOf('case "verify_error"'), apply.indexOf('case "invalid_code"')), /setCode\(""\)/);
  assert.match(apply, /case "invalid_code":\s*setCode\(""\)/);
  const retry = fn("async function retryCredentials", "async function resendCode");
  assert.match(retry, /if \(!verified\?\.finalized\) \{\s*return;/);
  assert.match(retry, /completeCredentials\(/);
  assert.doesNotMatch(retry, /runActivationSequence/, "a credential retry never re-verifies or re-finalizes");
  // Verify and resend are only possible in the code stage.
  const verify = fn("async function verifyAndFinish", "async function retryCredentials");
  assert.match(verify, /if \(runRef\.current \|\| stage !== "code"\) \{\s*return;/);
  assert.match(SOURCE, /const stage: CodeStepStage = evidenceFrozen \? "finalized" : \(stop \?\? "code"\);/);
});

// ---------------------------------------------------------------------------
// Existing-session gate

test("an existing session is NOT assumed to be an account: the Person link is resolved and only 'resolved' routes to the account", () => {
  const gate = fn("async function checkExistingSession", "void checkExistingSession()");
  assert.match(gate, /supabase\.rpc\(\s*"resolve_current_auth_person_link",?\s*\)/);
  assert.match(gate, /row\.status === "resolved" && typeof row\.person_id === "string" && row\.person_id[\s\S]*?router\.replace\("\/member\/account"\)/);
  assert.match(gate, /row\.status === "no_link"[\s\S]*?setSessionGate\(\{ kind: "form" \}\)/);
  // error, unexpected/multiple rows, invalid_or_ambiguous -> blocked, never no_link
  assert.match(gate, /const row = list\.length === 1 \? \(list\[0\]/);
  assert.match(gate, /if \(linkError \|\| !row\) \{\s*setSessionGate\(\{\s*kind: "blocked"/);
  assert.match(gate, /catch \{[\s\S]*?kind: "blocked"/, "an exception fails closed and finishes loading");
  assert.doesNotMatch(CODE_ONLY, /if \(data\?\.session\) \{\s*router\.replace\("\/member\/account"\)/);
});

// ---------------------------------------------------------------------------
// Rendered markup

function attrs(html: string, tag: string): string[] {
  return html.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? [];
}

test("rendered credential fields: two password inputs, new-password autocomplete, help text, disabled propagation", () => {
  const html = renderToStaticMarkup(
    createElement(ActivationCredentialFields, {
      password: "",
      confirmPassword: "",
      onPasswordChange: () => {},
      onConfirmPasswordChange: () => {},
      disabled: false,
    }),
  );
  const inputs = attrs(html, "input");
  assert.equal(inputs.length, 2);
  for (const input of inputs) {
    assert.match(input, /type="password"/);
    assert.match(input, /autocomplete="new-password"/i);
    assert.match(input, /autocapitalize="off"/i);
    assert.doesNotMatch(input, /disabled/);
  }
  assert.match(html, /Choose a Password/);
  assert.match(html, /Confirm Password/);
  assert.match(html, /At least 8 characters/);
  assert.match(inputs[0]!, /aria-describedby="activation-password-help"/);
  assert.doesNotMatch(html, /value="[^"]+"/, "no password value is ever rendered into markup");

  const busy = renderToStaticMarkup(
    createElement(ActivationCredentialFields, {
      password: "secret-not-rendered",
      confirmPassword: "secret-not-rendered",
      onPasswordChange: () => {},
      onConfirmPasswordChange: () => {},
      disabled: true,
    }),
  );
  for (const input of attrs(busy, "input")) {
    assert.match(input, /disabled=""/);
  }
  // React renders controlled password values; static markup for type=password
  // still carries value -- assert the type so browsers mask it.
  assert.equal(attrs(busy, "input").filter((i) => /type="password"/.test(i)).length, 2);
});

const codeStepProps = {
  email: "member@example.invalid",
  code: "",
  onCodeChange: () => {},
  onVerify: () => {},
  onResend: () => {},
  onEditDetails: () => {},
  onRetryPassword: () => {},
  onRetrySignIn: () => {},
  busy: false,
  phaseLabel: null,
  notice: "Verification code requested. Allow a minute for it to arrive, and check your spam folder.",
  error: null,
  stage: "code" as const,
  offerPasswordRetry: false,
  offerSignInRetry: false,
  offerResend: true,
};

test("rendered code step: one pasteable numeric one-time-code input, the finish button, non-enumerating wording, resend and re-check actions", () => {
  const html = renderToStaticMarkup(createElement(EmailCodeStep, codeStepProps));
  const inputs = attrs(html, "input");
  assert.equal(inputs.length, 1, "a single code input, never six boxes");
  const input = inputs[0]!;
  assert.match(input, /type="text"/);
  assert.match(input, /inputmode="numeric"/i);
  assert.match(input, /autocomplete="one-time-code"/i);
  assert.match(input, /pattern="\[0-9\]\*"/);
  assert.doesNotMatch(input, /maxlength/i, "a provider code is never truncated");
  assert.match(html, /Verify Email and Finish/);
  assert.match(html, /If your information is eligible, a verification code will arrive by email\. Enter it here to finish\./);
  assert.match(html, /Your account is not\s*activated yet\./);
  assert.match(html, /Send it again/);
  assert.match(html, /Check my details again/);
  assert.match(html, /href="\/member\/login"/);
  assert.match(html, /aria-busy="false"/);
  assert.doesNotMatch(html, /Check your email to finish creating/);
});

test("Fix 1 rendered: the address is a neutral label and nothing claims an email was sent, in the code stage and after a failed request", () => {
  const html = renderToStaticMarkup(createElement(EmailCodeStep, codeStepProps));
  assert.match(html, /Email address: <strong>member@example\.invalid<\/strong>/);
  assert.doesNotMatch(html, /We sent|sent it to|has been sent|was sent|email sent/i);

  const failed = renderToStaticMarkup(
    createElement(EmailCodeStep, {
      ...codeStepProps,
      notice: null,
      error: 'Your verification code could not be requested. Check your connection, then select "Send it again".',
    }),
  );
  assert.doesNotMatch(failed, /We sent|sent it to|has been sent|was sent|code requested/i);
  assert.match(failed, /role="alert"[^>]*>Your verification code could not be requested\./);
  const resend = attrs(failed, "button").find((b) => /type="button"/.test(b) && !/disabled/.test(b));
  assert.ok(resend, "resend stays actionable after a failed request");
  assert.match(failed, /Send it again/);
});

test("rendered code step while busy: aria-busy, disabled controls and readable phase progress", () => {
  const html = renderToStaticMarkup(
    createElement(EmailCodeStep, { ...codeStepProps, busy: true, phaseLabel: "Connecting your account...", offerResend: false }),
  );
  assert.match(html, /aria-busy="true"/);
  for (const control of [...attrs(html, "input"), ...attrs(html, "button")]) {
    assert.match(control, /disabled=""/);
  }
  assert.match(html, /Connecting your account\.\.\./);
  assert.doesNotMatch(html, /Send it again/, "resend is not offered while a sequence is in flight");
});

test("rendered code step after finalization: identity frozen, no code input, password-only retry offered", () => {
  const html = renderToStaticMarkup(
    createElement(EmailCodeStep, {
      ...codeStepProps,
      stage: "finalized",
      offerPasswordRetry: true,
      error: "Password should be at least 12 characters.",
      notice: "Your password was not accepted. Correct it above and try again; your email verification and account connection still stand.",
    }),
  );
  assert.equal(attrs(html, "input").length, 0, "no code re-entry after the account is connected");
  assert.match(html, /your account is connected/);
  assert.match(html, /Finish by saving your password/);
  assert.match(html, /Save Password and Finish/);
  assert.doesNotMatch(html, /Verify Email and Finish/);
  assert.doesNotMatch(html, /Send it again|Check my details again/);
  assert.match(html, /Sign in with your password instead/);
  assert.match(html, /role="alert"[^>]*>Password should be at least 12 characters\./);
});

test("Fix 2 rendered: after a saved password, the adopt-only retry never asks to save a password and says the password IS saved", () => {
  const html = renderToStaticMarkup(
    createElement(EmailCodeStep, {
      ...codeStepProps,
      stage: "finalized",
      offerSignInRetry: true,
      notice: "Your password is saved. Finish signing in below, or sign in with your new password.",
      error: "Your password is saved, but sign-in on this device could not finish. Try again or sign in with your new password.",
    }),
  );
  assert.match(html, /Finish Signing In/);
  assert.doesNotMatch(html, /Save Password and Finish/);
  assert.doesNotMatch(html, /Finish by saving your password|save a password|not saved/i);
  assert.match(html, /Your password is saved/);
  assert.doesNotMatch(html, /request another email|new link/i);
  assert.equal(attrs(html, "input").length, 0);
});

test("Fix 2 rendered: an UNCERTAIN finalizer offers no Verify, Resend or re-check -- only sign-in and support exits", () => {
  const html = renderToStaticMarkup(
    createElement(EmailCodeStep, {
      ...codeStepProps,
      stage: "uncertain",
      notice: null,
      error: "We could not confirm whether your account was connected. Do not enter or request another code -- try signing in, or contact identity support.",
    }),
  );
  assert.equal(attrs(html, "input").length, 0, "no blind code re-entry");
  assert.equal(attrs(html, "button").length, 0, "no Verify, Resend or Check-details buttons");
  assert.doesNotMatch(html, /Verify Email and Finish|Send it again|Check my details again|Save Password|Finish Signing In/);
  assert.match(html, /could not confirm whether your account was connected/);
  assert.match(html, /identity support/);
  assert.match(html, /href="\/member\/login"[^>]*>Try signing in instead/);
  assert.doesNotMatch(html, /your account is connected\./, "an uncertain outcome is never presented as connected");
});

test("Fix 2 rendered: an explicitly REJECTED finalizer offers a re-check but no Verify or Resend", () => {
  const html = renderToStaticMarkup(
    createElement(EmailCodeStep, {
      ...codeStepProps,
      stage: "rejected",
      notice: "Your details may need to be checked again before this activation can complete.",
      error: "Your email was verified, but this activation could not be completed. Check your details or contact identity support.",
    }),
  );
  assert.equal(attrs(html, "input").length, 0);
  assert.doesNotMatch(html, /Verify Email and Finish|Send it again/);
  assert.match(html, /Check my details again/);
  assert.match(html, /Your account is not activated yet\./);
  assert.match(html, /Email address: <strong>member@example\.invalid<\/strong>/);
});
