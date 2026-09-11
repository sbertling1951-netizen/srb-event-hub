import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions, consistent with this repository's
// established convention for server-only modules (server-only does not
// resolve outside the Next.js build, so this file cannot be directly
// imported and executed here -- see lib/server/adminAuthz.test.ts for the
// same pattern). "Fully mockable... makes no Stripe call during tests" is
// satisfied trivially: no test here ever executes any Stripe SDK code.
//
// Run with:
//   npx tsx --test lib/server/stripePassport.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./stripePassport.ts", import.meta.url)),
  "utf8",
);
const CODE_ONLY = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("this module is server-only and reads config only from the three documented env vars, at call time not module load", () => {
  assert.match(SOURCE, /^import "server-only";/m);
  assert.match(SOURCE, /process\.env\.STRIPE_SECRET_KEY/);
  assert.match(SOURCE, /process\.env\.STRIPE_WEBHOOK_SECRET/);
  assert.match(SOURCE, /process\.env\.STRIPE_PASSPORT_PRICE_ID/);
  assert.match(SOURCE, /export function getStripePassportConfig\(\)/);
  // read inside the function body, not as a top-level module constant
  assert.doesNotMatch(SOURCE, /^const secretKey = process\.env/m);
});

test("missing configuration is a neutral null -- never a thrown error, never distinguishing which variable is missing", () => {
  const fnStart = SOURCE.indexOf("export function getStripePassportConfig()");
  const fnEnd = SOURCE.indexOf("\n}", fnStart);
  const fn = SOURCE.slice(fnStart, fnEnd);
  assert.match(fn, /if \(!secretKey \|\| !webhookSecret \|\| !priceId\) \{\s*\n\s*return null;\s*\n\s*\}/);
  assert.doesNotMatch(fn, /throw|RAISE/i);
});

test("the fixed $24.00 USD amount is a named constant, never a magic number scattered through call sites", () => {
  assert.match(SOURCE, /export const PASSPORT_AMOUNT_MINOR_UNITS = 2400;/);
  assert.match(SOURCE, /export const PASSPORT_CURRENCY = "usd";/);
});

test("session creation uses mode payment, quantity 1, the configured Price, and carries the attempt id in BOTH client_reference_id and metadata -- never an amount/currency argument", () => {
  const fnStart = SOURCE.indexOf("export async function createPassportCheckoutSession");
  const fnEnd = SOURCE.indexOf("\n}", fnStart);
  const fn = SOURCE.slice(fnStart, fnEnd);
  assert.match(fn, /mode:\s*"payment"/);
  assert.match(fn, /line_items:\s*\[\{\s*price:\s*params\.priceId,\s*quantity:\s*1\s*\}\]/);
  assert.match(fn, /client_reference_id:\s*params\.attemptId/);
  assert.match(fn, /metadata:\s*\{\s*\n\s*attempt_id:\s*params\.attemptId,\s*\n\s*event_id:\s*params\.eventId,/);
  assert.doesNotMatch(fn, /amount|currency/i);
});

test("session retrieval always expands line_items -- required to verify Price and quantity", () => {
  const fnStart = SOURCE.indexOf("export async function retrievePassportCheckoutSession");
  const fnEnd = SOURCE.indexOf("\n}", fnStart);
  const fn = SOURCE.slice(fnStart, fnEnd);
  assert.match(fn, /expand:\s*\["line_items"\]/);
});

test("webhook signature verification takes the raw body and header, delegates to Stripe's own constructEvent, and never parses first", () => {
  const fnStart = SOURCE.indexOf("export function verifyPassportWebhookSignature");
  const fnEnd = SOURCE.indexOf("\n}", fnStart);
  const fn = SOURCE.slice(fnStart, fnEnd);
  assert.match(fn, /client\.webhooks\.constructEvent\(rawBody, signatureHeader, webhookSecret\)/);
  assert.doesNotMatch(fn, /JSON\.parse/);
});

test("the exact three-part Session binding requires client_reference_id, metadata.attempt_id, AND metadata.event_id all to match -- neither attempt reference substitutes for the other", () => {
  const fnStart = SOURCE.indexOf("export function isPassportSessionBoundToAttempt");
  const fnEnd = SOURCE.indexOf("\n}", fnStart);
  const fn = SOURCE.slice(fnStart, fnEnd);
  assert.match(
    fn,
    /return \(\s*\n\s*session\.client_reference_id === params\.attemptId &&\s*\n\s*session\.metadata\?\.attempt_id === params\.attemptId &&\s*\n\s*session\.metadata\?\.event_id === params\.eventId\s*\n\s*\);/,
  );
  assert.doesNotMatch(fn, /\|\|/, "no OR fallback between the two attempt-reference fields");
});

test("session-fact verification checks mode, the exact three-part binding, payment_status paid, USD currency, the exact $24.00 total, single line item, quantity 1, and the exact configured Price -- in that order, failing closed on the first mismatch", () => {
  const fnStart = SOURCE.indexOf("export function verifyPassportCheckoutSessionFacts");
  const fnEnd = SOURCE.indexOf("\nexport function passportSessionLookupAttemptId", fnStart);
  const fn = SOURCE.slice(fnStart, fnEnd);

  const checks = [
    /if \(session\.mode !== "payment"\) \{\s*\n\s*return \{ ok: false, reason: "mode" \};/,
    /if \(!isPassportSessionBoundToAttempt\(session, params\)\) \{\s*\n\s*return \{ ok: false, reason: "attempt_reference" \};/,
    /if \(session\.payment_status !== "paid"\) \{\s*\n\s*return \{ ok: false, reason: "payment_status" \};/,
    /if \(\(session\.currency \?\? ""\)\.toLowerCase\(\) !== PASSPORT_CURRENCY\) \{\s*\n\s*return \{ ok: false, reason: "currency" \};/,
    /if \(session\.amount_total !== PASSPORT_AMOUNT_MINOR_UNITS\) \{\s*\n\s*return \{ ok: false, reason: "amount" \};/,
    /if \(lineItems\.length !== 1\) \{\s*\n\s*return \{ ok: false, reason: "line_item_count" \};/,
    /if \(lineItem\.quantity !== 1\) \{\s*\n\s*return \{ ok: false, reason: "quantity" \};/,
    /if \(linePriceId !== params\.priceId\) \{\s*\n\s*return \{ ok: false, reason: "price" \};/,
  ];
  for (const pattern of checks) {
    assert.match(fn, pattern);
  }
  const orderedIndexes = checks.map((p) => fn.search(p));
  for (const idx of orderedIndexes) {
    assert.notEqual(idx, -1);
  }
  for (let i = 1; i < orderedIndexes.length; i += 1) {
    assert.ok(orderedIndexes[i - 1] < orderedIndexes[i], "expected the documented check order");
  }
  assert.match(fn, /return \{ ok: true \};/);
});

test("session-fact verification requires eventId alongside attemptId, and never accepts an amount or currency argument -- both are constants, never parameters", () => {
  assert.match(
    SOURCE,
    /export function verifyPassportCheckoutSessionFacts\(\s*\n\s*session: Stripe\.Checkout\.Session,\s*\n\s*params: \{ priceId: string; attemptId: string; eventId: string \},\s*\n\)/,
  );
});

test("the preliminary lookup-key extractor requires client_reference_id AND metadata.attempt_id to both be present and agree -- it is never the authorization decision itself", () => {
  const fnStart = SOURCE.indexOf("export function passportSessionLookupAttemptId");
  const fn = SOURCE.slice(fnStart);
  assert.match(fn, /if \(!clientReferenceId \|\| !metadataAttemptId\) \{\s*\n\s*return null;/);
  assert.match(fn, /if \(clientReferenceId !== metadataAttemptId\) \{\s*\n\s*return null;/);
  assert.doesNotMatch(fn, /session\.client_reference_id \|\| session\.metadata/);
});

test("no secret or Price id is ever logged, and the exported PassportStripeClient type has no room for exposing them", () => {
  const logCalls = CODE_ONLY.match(/console\.(log|error|warn|info)\([^)]*\)/g) || [];
  for (const call of logCalls) {
    assert.doesNotMatch(call, /secretKey|webhookSecret|priceId|STRIPE_/i);
  }
  assert.doesNotMatch(CODE_ONLY, /console\.(log|error|warn|info)\([^)]*config/i);
});

test("createStripePassportClient constructs the real Stripe client only from the resolved secret key", () => {
  assert.match(SOURCE, /export function createStripePassportClient\(\s*\n\s*config: StripePassportConfig,\s*\n\): PassportStripeClient \{\s*\n\s*return new Stripe\(config\.secretKey\);/);
});
