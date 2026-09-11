import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions -- see
// app/api/passport/checkout/route.test.ts and
// lib/server/stripePassport.test.ts for why this repository proves webhook
// behavior from source rather than an executed HTTP/mock harness.
//
// Run with:
//   npx tsx --test app/api/passport/webhook/route.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);
const CODE_ONLY = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("the raw body is read and the signature verified BEFORE anything is parsed or acted on", () => {
  const rawBodyIdx = SOURCE.indexOf("const rawBody = await request.text();");
  const signatureVerifyIdx = SOURCE.indexOf("verifyPassportWebhookSignature(");
  const firstRpcIdx = SOURCE.indexOf(".rpc(");
  const jsonParseIdx = SOURCE.indexOf("JSON.parse");
  assert.notEqual(rawBodyIdx, -1);
  assert.notEqual(signatureVerifyIdx, -1);
  assert.equal(jsonParseIdx, -1, "the webhook must never JSON.parse the body itself -- constructEvent already parses it after verifying");
  assert.ok(rawBodyIdx < signatureVerifyIdx, "the raw body must be read before signature verification");
  assert.ok(signatureVerifyIdx < firstRpcIdx, "signature verification must happen before any database call");
});

test("request.text() is used, never request.json() -- Stripe signs the exact raw bytes", () => {
  assert.match(SOURCE, /await request\.text\(\)/);
  assert.doesNotMatch(CODE_ONLY, /request\.json\(\)/);
});

test("missing configuration and a missing/invalid signature both reject before any database call, and never expose why", () => {
  const configIdx = SOURCE.indexOf("if (!config) {");
  const sigMissingIdx = SOURCE.indexOf('if (!signature) {');
  const sigInvalidIdx = SOURCE.indexOf("catch (signatureError) {");
  const firstRpcIdx = SOURCE.indexOf(".rpc(");
  assert.ok(configIdx < firstRpcIdx);
  assert.ok(sigMissingIdx < firstRpcIdx);
  assert.ok(sigInvalidIdx < firstRpcIdx);
  assert.match(SOURCE.slice(sigMissingIdx, sigMissingIdx + 120), /error: "invalid_signature" \}, 400\)/);
  assert.match(SOURCE.slice(sigInvalidIdx, sigInvalidIdx + 200), /error: "invalid_signature" \}, 400\)/);
});

test("only checkout.session.completed and checkout.session.expired are handled -- every other valid event type acknowledges without any database call", () => {
  const guardIdx = SOURCE.indexOf(
    'if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.expired")',
  );
  assert.notEqual(guardIdx, -1);
  const guardBlock = SOURCE.slice(guardIdx, guardIdx + 200);
  assert.match(guardBlock, /return noStore\(\{ received: true \}\);/);
  assert.doesNotMatch(guardBlock, /\.rpc\(/);
});

test("the session is independently re-retrieved (with line items expanded) rather than trusting the webhook payload's embedded object", () => {
  assert.match(SOURCE, /session = await retrievePassportCheckoutSession\(stripe, eventSessionId\);/);
  assert.match(SOURCE, /const eventSessionId = event\.data\.object\.id;/);
});

test("the attempt is obtained from the service-only reader BEFORE the exact binding is checked, and the reader's own event_id -- never anything from the session/webhook payload -- is what the binding is checked against", () => {
  const readerIdx = SOURCE.indexOf('admin.rpc(\n    "get_self_service_event_passport_checkout_attempt_for_server"');
  const bindingIdx = SOURCE.indexOf("isPassportSessionBoundToAttempt(session, { attemptId, eventId: attempt.event_id })");
  assert.notEqual(readerIdx, -1);
  assert.notEqual(bindingIdx, -1);
  assert.ok(readerIdx < bindingIdx, "the service-only reader must run before the binding check");
});

test("the preliminary lookup key requires client_reference_id and metadata.attempt_id to already agree -- the old single/either-field extractor is not used anywhere in this route", () => {
  assert.match(SOURCE, /const lookupAttemptId = passportSessionLookupAttemptId\(session\);/);
  assert.doesNotMatch(CODE_ONLY, /\bpassportSessionAttemptId\(/);
});

test("the exact three-part binding check is shared by BOTH the expiry and completion paths, and runs before either one can mutate anything", () => {
  const bindingIdx = SOURCE.indexOf("isPassportSessionBoundToAttempt(session, { attemptId, eventId: attempt.event_id })");
  const expiredBranchIdx = SOURCE.indexOf('if (event.type === "checkout.session.expired") {');
  const terminalRpcIdx = SOURCE.indexOf('admin.rpc(\n      "record_self_service_event_passport_checkout_terminal_state"');
  const factCheckIdx = SOURCE.indexOf("const factCheck = verifyPassportCheckoutSessionFacts(");
  assert.notEqual(bindingIdx, -1);
  assert.ok(bindingIdx < expiredBranchIdx, "the shared binding check must run before the expired/completed branch split");
  assert.ok(bindingIdx < terminalRpcIdx);
  assert.ok(bindingIdx < factCheckIdx);
  assert.match(
    SOURCE,
    /if \(!isPassportSessionBoundToAttempt\(session, \{ attemptId, eventId: attempt\.event_id \}\)\) \{\s*\n\s*return noStore\(\{ received: true \}\);/,
  );
});

test("session-fact verification is called with the server-resolved attempt's own event_id, never a value read from the session/webhook payload", () => {
  assert.match(
    SOURCE,
    /const factCheck = verifyPassportCheckoutSessionFacts\(session, \{\s*\n\s*priceId: config\.priceId,\s*\n\s*attemptId,\s*\n\s*eventId: attempt\.event_id,\s*\n\s*\}\);/,
  );
});

test("completion is confirmed only after verifyPassportCheckoutSessionFacts passes -- an invalid fact never reaches confirm_self_service_event_passport_payment", () => {
  const factCheckIdx = SOURCE.indexOf("const factCheck = verifyPassportCheckoutSessionFacts(");
  const confirmIdx = SOURCE.indexOf('admin.rpc("confirm_self_service_event_passport_payment"');
  assert.notEqual(factCheckIdx, -1);
  assert.notEqual(confirmIdx, -1);
  assert.ok(factCheckIdx < confirmIdx);
  assert.match(
    SOURCE,
    /if \(!factCheck\.ok\) \{\s*\n\s*console\.error\([^)]*\);\s*\n\s*return noStore\(\{ received: true \}\);/,
  );
});

test("confirmation uses the Stripe event id (not the session id) as the durable provider-event idempotency input", () => {
  assert.match(
    SOURCE,
    /p_provider_event_id:\s*event\.id,/,
  );
  const confirmCallIdx = SOURCE.indexOf('admin.rpc("confirm_self_service_event_passport_payment"');
  const block = SOURCE.slice(confirmCallIdx, confirmCallIdx + 300);
  assert.doesNotMatch(block, /p_provider_event_id:\s*session\.id/);
});

test("duplicate webhook delivery relies entirely on the RPC's own durable idempotency -- the route adds no route-memory deduplication of its own", () => {
  assert.doesNotMatch(CODE_ONLY, /new Set\(|new Map\(|processedEvents|seenEvents/i);
});

test("expiry only records 'expired' when the attempt is still open AND its session id still matches -- a concurrent completion or DELETE is left alone", () => {
  assert.match(
    SOURCE,
    /if \(attempt\.state !== "open" \|\| attempt\.provider_session_id !== session\.id\) \{\s*\n[\s\S]*?\s*return noStore\(\{ received: true \}\);/,
  );
  assert.match(SOURCE, /p_terminal_state:\s*"expired",/);
});

test("expiry never calls confirm, and completion never calls the terminal-state RPC -- the two paths are disjoint", () => {
  const expiredBranchStart = SOURCE.indexOf('if (event.type === "checkout.session.expired") {');
  const expiredBranchEnd = SOURCE.indexOf("\n  // checkout.session.completed");
  const expiredBranch = SOURCE.slice(expiredBranchStart, expiredBranchEnd);
  assert.doesNotMatch(expiredBranch, /confirm_self_service_event_passport_payment/);

  const completedBranch = SOURCE.slice(expiredBranchEnd);
  assert.doesNotMatch(completedBranch, /record_self_service_event_passport_checkout_terminal_state/);
});

test("no secret, Price id, or full session object is ever included in a response body", () => {
  const responseBodies = [...CODE_ONLY.matchAll(/noStore\(\{([^}]*)\}/g)].map((m) => m[1]);
  for (const responseBody of responseBodies) {
    assert.doesNotMatch(responseBody, /secretKey|webhookSecret|priceId|session:/);
  }
});

test("no secret or Price id is ever logged", () => {
  const logCalls = CODE_ONLY.match(/console\.(log|error|warn|info)\([^)]*\)/g) || [];
  for (const call of logCalls) {
    assert.doesNotMatch(call, /secretKey|webhookSecret|priceId/i);
  }
});

test("the webhook grants no browser authority -- it never calls resolveAuthenticatedRequest or reads an Authorization bearer", () => {
  assert.doesNotMatch(CODE_ONLY, /resolveAuthenticatedRequest|Authorization|Bearer/);
});
