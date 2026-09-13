import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");

test("refund execution requires the server authentication boundary and database authority assertion", () => {
  assert.match(source, /resolveAuthenticatedRequest\(request\.headers\)/);
  assert.match(source, /assert_self_service_event_passport_refund_request_authority/);
  assert.match(source, /get_self_service_event_passport_refund_context_for_server/);
});

test("refund execution is sandbox-only, request-id scoped, and uses the governed Stripe idempotency adapter", () => {
  assert.match(source, /isStripeTestMode\(config\)/);
  assert.match(source, /verifyPassportCheckoutSessionFacts/);
  assert.match(source, /createPassportRefund\(stripe, \{ paymentIntentId: paymentIntent, requestId \}\)/);
  assert.doesNotMatch(source, /amount:\s*2400|amount_minor_units|refunds\.create\(/);
});
