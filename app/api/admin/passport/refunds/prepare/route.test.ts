import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");
const codeOnly = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("refund-request preparation requires the server authentication boundary and defers all authority to the governed RPC", () => {
  assert.match(source, /resolveAuthenticatedRequest\(request\.headers\)/);
  assert.match(source, /createAuthenticatedUserClient\(resolved\.credential\)/);
  assert.match(source, /user\.rpc\(\s*\n?\s*"prepare_self_service_event_passport_refund_request"/);
});

test("the idempotency key is always server-generated, never client-supplied", () => {
  assert.match(source, /p_idempotency_key:\s*crypto\.randomUUID\(\)/);
});

test("only an eventId UUID is read from the request body -- no amount, currency, receipt, Stripe id, or role", () => {
  const start = source.indexOf("export async function POST(");
  const rpcIdx = source.indexOf("prepare_self_service_event_passport_refund_request", start);
  const body = source.slice(start, rpcIdx);
  assert.match(body, /eventId\?:\s*unknown/);
  assert.doesNotMatch(body, /amount|currency|paymentIntent|receipt|role|state:/i);
});

test("an RPC error fails closed to the same neutral not_found response, never distinguishing authority from eligibility", () => {
  assert.match(source, /if \(error\) return reply\(\{ error: "not_found" \}, 404\);/);
});

test("this route never queries a Passport, receipt, refund-request, or refund-audit table directly, and never talks to Stripe", () => {
  assert.doesNotMatch(source, /\.from\("self_service_event_passport/);
  assert.doesNotMatch(codeOnly, /stripe|Stripe/);
});

test("an unauthenticated caller is rejected before the RPC is ever called", () => {
  const start = source.indexOf("export async function POST(");
  const authIdx = source.indexOf('reply({ error: "unauthenticated" }, 401)', start);
  const rpcIdx = source.indexOf("prepare_self_service_event_passport_refund_request", start);
  assert.ok(authIdx !== -1 && authIdx < rpcIdx);
});
