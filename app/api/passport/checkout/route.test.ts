import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions, consistent with this repository's
// established convention for API routes (no RTL/jest/HTTP-simulation
// harness exists here -- see app/api/legacy-transfer/redeem/route.test.ts
// and app/api/geocode/route.test.ts). This route also imports server-only
// modules transitively, which do not resolve outside the Next.js build (see
// lib/server/stripePassport.test.ts), so behavior is proven from source.
//
// Run with:
//   npx tsx --test app/api/passport/checkout/route.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);
const CODE_ONLY = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("every handler requires the Server Authentication Boundary before doing anything else", () => {
  assert.match(SOURCE, /import \{ resolveAuthenticatedRequest \} from "@\/lib\/server\/authenticationBoundary"/);
  assert.match(SOURCE, /import \{ createAuthenticatedUserClient \} from "@\/lib\/server\/authenticatedUserClient"/);
  const helperStart = SOURCE.indexOf("async function requireAuthenticatedEventRequest");
  const helperEnd = SOURCE.indexOf("\n}", helperStart);
  const helper = SOURCE.slice(helperStart, helperEnd);
  assert.match(helper, /authResolution\.state !== "authenticated"/);
  assert.match(helper, /error: "unauthenticated" \}, 401\)/);
  // used as the very first statement in every exported handler
  for (const handler of ["POST", "GET", "DELETE"]) {
    const start = SOURCE.indexOf(`export async function ${handler}(`);
    const body = SOURCE.slice(start, start + 300);
    assert.match(body, /const auth = await requireAuthenticatedEventRequest\(request\);\s*\n\s*\n\s*if \(!auth\.ok\) \{\s*\n\s*return auth\.response;/);
  }
});

test("POST accepts only an eventId UUID -- malformed input is rejected before any RPC call", () => {
  const start = SOURCE.indexOf("export async function POST(");
  const prepareIdx = SOURCE.indexOf("prepare_self_service_event_passport_checkout_attempt", start);
  const body = SOURCE.slice(start, prepareIdx);
  assert.match(body, /if \(!isUuid\(eventId\)\) \{\s*\n\s*return jsonNoStore\(\{ error: "invalid_request" \}, 400\);/);
});

test("POST never queries a Passport/attempt/receipt table directly -- only the governed RPCs", () => {
  const start = SOURCE.indexOf("export async function POST(");
  const end = SOURCE.indexOf("\nexport async function GET(");
  const body = SOURCE.slice(start, end);
  assert.doesNotMatch(body, /\.from\("self_service_event_passport/);
  assert.match(body, /auth\.supabase\.rpc\(\s*\n\s*"prepare_self_service_event_passport_checkout_attempt"/);
});

test("POST calls prepare with a server-generated idempotency UUID, never a client-supplied one", () => {
  assert.match(SOURCE, /p_idempotency_key:\s*crypto\.randomUUID\(\)/);
  assert.doesNotMatch(CODE_ONLY, /p_idempotency_key:\s*body\./);
});

test("POST creates a session only when the attempt state is 'preparing', and resumes (never re-creates) when it is already 'open'", () => {
  const start = SOURCE.indexOf("export async function POST(");
  const end = SOURCE.indexOf("\nexport async function GET(");
  const body = SOURCE.slice(start, end);
  const openIdx = body.indexOf('if (state === "open")');
  const createIdx = body.indexOf("createPassportCheckoutSession(stripe");
  assert.notEqual(openIdx, -1);
  assert.notEqual(createIdx, -1);
  assert.ok(openIdx < createIdx, "the open-resume branch must be checked before the create-new-session path");
  const resumeBlock = body.slice(openIdx, createIdx);
  assert.doesNotMatch(resumeBlock, /createPassportCheckoutSession/);
});

test("POST verifies the exact three-part Session binding (attemptId AND eventId) before ever using its URL, in both the resume and create paths", () => {
  const matches = [
    ...SOURCE.matchAll(/isPassportSessionBoundToAttempt\(session, \{ attemptId, eventId \}\)/g),
  ];
  assert.ok(matches.length >= 2, "expected the exact binding check in both the resume and create paths");
  assert.doesNotMatch(CODE_ONLY, /passportSessionAttemptId/, "the old single/either-field extractor must not be used anywhere in this route");
});

test("a Stripe creation/bind failure triggers best-effort governed cleanup through the terminal-state RPC, and never silently creates a second attempt", () => {
  assert.match(
    SOURCE,
    /async function bestEffortExpireAttempt\(attemptId: string, sessionId: string \| null\)/,
  );
  assert.match(
    SOURCE,
    /admin\.rpc\("record_self_service_event_passport_checkout_terminal_state", \{\s*\n\s*p_attempt_id: attemptId,\s*\n\s*p_provider_session_id: sessionId,\s*\n\s*p_terminal_state: "expired",/,
  );
  const createCatchIdx = SOURCE.indexOf("} catch (stripeError) {\n    console.error(\"Passport Checkout Session creation failed.");
  assert.notEqual(createCatchIdx, -1);
  assert.match(SOURCE.slice(createCatchIdx, createCatchIdx + 200), /bestEffortExpireAttempt\(attemptId, null\)/);
  // binding mismatch after creation is also treated as a failure requiring cleanup
  assert.match(
    SOURCE,
    /if \(!isPassportSessionBoundToAttempt\(session, \{ attemptId, eventId \}\) \|\| !session\.url\) \{\s*\n\s*await bestEffortExpireAttempt\(attemptId, session\.id\);/,
  );
  assert.doesNotMatch(CODE_ONLY, /prepare_self_service_event_passport_checkout_attempt[\s\S]{0,2000}prepare_self_service_event_passport_checkout_attempt/);
});

test("missing Stripe configuration OR missing/invalid trusted origin both return the SAME neutral unavailable response, never identifying which is missing", () => {
  assert.match(
    SOURCE,
    /const config = getStripePassportConfig\(\);\s*\n\s*const origin = trustedAppOrigin\(\);\s*\n[\s\S]{0,150}if \(!config \|\| !origin\) \{\s*\n\s*return jsonNoStore\(\{ error: "checkout_unavailable" \}, 503\);/,
  );
});

test("the trusted Checkout return origin comes ONLY from EPICENTRAX_APP_ORIGIN -- never the request's Host header, X-Forwarded-Host, or any caller value", () => {
  // trustedAppOrigin() takes no arguments at all -- it cannot read the
  // request, only the fixed server-only environment variable.
  assert.match(SOURCE, /function trustedAppOrigin\(\): string \| null \{/);
  const fnStart = SOURCE.indexOf("function trustedAppOrigin(): string | null {");
  const fnEnd = SOURCE.indexOf("\n}", fnStart);
  const fn = SOURCE.slice(fnStart, fnEnd);
  assert.match(fn, /process\.env\.EPICENTRAX_APP_ORIGIN/);
  assert.doesNotMatch(fn, /request/i);
  assert.doesNotMatch(CODE_ONLY, /request\.headers\.get\("host"\)/);
  assert.doesNotMatch(CODE_ONLY, /x-forwarded-host/i);
  assert.doesNotMatch(CODE_ONLY, /normalizeRequestHostname/);
  assert.doesNotMatch(CODE_ONLY, /body\.(returnUrl|successUrl|cancelUrl|redirect)/i);
});

test("trustedAppOrigin rejects credentials, query, fragment, and any path other than none/'/' -- a syntactically valid but out-of-policy URL still fails closed", () => {
  const fnStart = SOURCE.indexOf("function trustedAppOrigin(): string | null {");
  const fnEnd = SOURCE.indexOf("\n}", fnStart);
  const fn = SOURCE.slice(fnStart, fnEnd);
  assert.match(fn, /if \(url\.username \|\| url\.password \|\| url\.search \|\| url\.hash\) \{\s*\n\s*return null;/);
  assert.match(fn, /if \(url\.pathname !== "" && url\.pathname !== "\/"\) \{\s*\n\s*return null;/);
});

test("trustedAppOrigin requires HTTPS except for localhost/127.0.0.1, where HTTP is accepted for local development only", () => {
  const fnStart = SOURCE.indexOf("function trustedAppOrigin(): string | null {");
  const fnEnd = SOURCE.indexOf("\n}", fnStart);
  const fn = SOURCE.slice(fnStart, fnEnd);
  assert.match(
    fn,
    /const isLocalHost = url\.hostname === "localhost" \|\| url\.hostname === "127\.0\.0\.1";\s*\n\s*\n\s*if \(url\.protocol !== "https:" && !\(isLocalHost && url\.protocol === "http:"\)\) \{\s*\n\s*return null;/,
  );
});

test("trustedAppOrigin is read at call time (not cached at module load) and a malformed value fails closed via the URL constructor", () => {
  assert.doesNotMatch(SOURCE, /^const .*EPICENTRAX_APP_ORIGIN/m);
  const fnStart = SOURCE.indexOf("function trustedAppOrigin(): string | null {");
  const fnEnd = SOURCE.indexOf("\n}", fnStart);
  const fn = SOURCE.slice(fnStart, fnEnd);
  assert.match(fn, /try \{\s*\n\s*url = new URL\(raw\);\s*\n\s*\} catch \{\s*\n\s*return null;/);
});

test("GET returns only a safe status and, for an open session, its hosted URL -- never a provider id, receipt, or secret", () => {
  const start = SOURCE.indexOf("export async function GET(");
  const end = SOURCE.indexOf("\nexport async function DELETE(");
  const body = SOURCE.slice(start, end);
  // provider_session_id is legitimately READ internally (to call Stripe);
  // the check that matters is that it never appears inside a response body.
  const getResponses = [...body.matchAll(/jsonNoStore\(\{([^}]*)\}/g)].map((m) => m[1]);
  for (const responseBody of getResponses) {
    assert.doesNotMatch(responseBody, /provider_session_id|priceId|secretKey|webhookSecret/);
  }
  assert.match(body, /jsonNoStore\(\{ status: "no_open_attempt" \}\)/);
  assert.match(body, /jsonNoStore\(\{ status: "open_attempt", state: "open", url: session\.url \}\)/);
});

test("GET foreign/ineligible Event denial maps 'Event not found.' to a 404 without echoing the raw message", () => {
  const start = SOURCE.indexOf("export async function GET(");
  const end = SOURCE.indexOf("\nexport async function DELETE(");
  const body = SOURCE.slice(start, end);
  assert.match(body, /if \(error\.message === "Event not found\."\) \{\s*\n\s*return jsonNoStore\(\{ error: "event_not_found" \}, 404\);/);
});

test("DELETE proves owner access through the authenticated reader BEFORE any service-only or provider action", () => {
  const start = SOURCE.indexOf("export async function DELETE(");
  const readerIdx = SOURCE.indexOf("get_my_self_service_event_passport_checkout_attempt", start);
  const adminIdx = SOURCE.indexOf("getSupabaseAdminClient()", start);
  assert.notEqual(readerIdx, -1);
  assert.notEqual(adminIdx, -1);
  assert.ok(readerIdx < adminIdx, "the owner reader must run before the service-only admin client is used");
});

test("DELETE never touches delete_self_service_organizer_event, a Passport row, or a receipt row", () => {
  const start = SOURCE.indexOf("export async function DELETE(");
  const body = SOURCE.slice(start);
  assert.doesNotMatch(body, /delete_self_service_organizer_event/);
  assert.doesNotMatch(body, /self_service_event_passports\b/);
  assert.doesNotMatch(body, /receipt_audit/);
});

test("DELETE verifies the exact three-part Session binding BEFORE the completion race check or Stripe's expire call -- it never expires or records terminal state for an unbound session", () => {
  const start = SOURCE.indexOf("export async function DELETE(");
  const body = SOURCE.slice(start);
  const bindingIdx = body.indexOf("isPassportSessionBoundToAttempt(session, { attemptId, eventId })");
  const raceIdx = body.indexOf('status === "complete"');
  const expireIdx = body.indexOf("await expirePassportCheckoutSession(stripe");
  assert.notEqual(bindingIdx, -1, "DELETE must verify the exact binding, not just the completion race");
  assert.ok(bindingIdx < raceIdx, "the binding check must run before the completion/expiry race check");
  assert.ok(raceIdx < expireIdx, "the completion check must still run before Stripe's own expire call");
});

test("DELETE fails safe on a completion/expiry race -- payment is never treated as cancelled merely because the browser requested it", () => {
  assert.match(
    SOURCE,
    /if \(session\.status === "complete" \|\| session\.payment_status === "paid"\) \{\s*\n\s*return jsonNoStore\(\{ status: "payment_completing" \}\);/,
  );
  const raceIdx = SOURCE.indexOf('status === "complete"');
  const expireIdx = SOURCE.indexOf("expirePassportCheckoutSession(stripe", raceIdx);
  assert.ok(raceIdx < expireIdx, "the completion check must run before Stripe's own expire call");
});

test("DELETE only calls Stripe's expire API and the terminal-state RPC -- it takes no other governed action", () => {
  const start = SOURCE.indexOf("export async function DELETE(");
  const body = SOURCE.slice(start);
  assert.match(body, /expirePassportCheckoutSession\(stripe, serverAttempt\.provider_session_id\)/);
  assert.match(body, /record_self_service_event_passport_checkout_terminal_state/);
  assert.doesNotMatch(body, /confirm_self_service_event_passport_payment/);
  assert.doesNotMatch(body, /bind_self_service_event_passport_checkout_session/);
});

test("no secret, Price id, or provider session id is ever included in a JSON response body", () => {
  const responseBodies = [...CODE_ONLY.matchAll(/jsonNoStore\(\{([^}]*)\}/g)].map((m) => m[1]);
  for (const responseBody of responseBodies) {
    assert.doesNotMatch(responseBody, /secretKey|webhookSecret|priceId|provider_session_id|sessionId/);
  }
});

test("no secret or Price id is ever logged", () => {
  const logCalls = CODE_ONLY.match(/console\.(log|error|warn|info)\([^)]*\)/g) || [];
  for (const call of logCalls) {
    assert.doesNotMatch(call, /secretKey|webhookSecret|priceId/i);
  }
});
