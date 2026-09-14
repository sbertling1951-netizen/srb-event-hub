import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { presentRefundReviewRow } from "@/app/admin/passport-refunds/page";

const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

test("the Passport refund review page is guarded by platform authority and uses the canonical Admin shell", () => {
  assert.match(source, /<AdminRouteGuard requiredPlatformAuthority>/);
  assert.match(source, /<AdminShellAdapter[\s\S]*pageTitle="Passport Refunds"/);
});

test("the page uses only the governed review RPC and never reads refund tables or creates a service-role client", () => {
  assert.match(source, /supabase\.rpc\(\s*"list_self_service_event_passport_refund_review"/);
  assert.doesNotMatch(source, /\.from\(\s*["']self_service_event_passport_refund/);
  assert.doesNotMatch(source, /getSupabaseAdminClient|service_role/);
});

test("the review surface presents only opaque request/event and lifecycle fields, with no provider or financial leakage", () => {
  const view = presentRefundReviewRow({
    request_id: "request-1",
    event_id: "event-1",
    event_name: null,
    requested_at: "2026-09-13T00:00:00Z",
    completed_at: null,
    request_state: "requested",
    review_status: "pending",
  });
  assert.deepEqual(view, {
    requestId: "request-1",
    eventId: "event-1",
    eventName: "Deleted event",
    requestedAt: "2026-09-13T00:00:00Z",
    completedAt: null,
    status: "pending",
  });
  assert.doesNotMatch(source, /provider_refund|provider_event|payment_intent|receipt_audit|amount|currency/i);
});

test("all, pending, and refunded filters are explicit", () => {
  for (const filter of ["all", "pending", "refunded"]) {
    assert.match(source, new RegExp(`value: "${filter}"`));
  }
});

test("only pending rows may open the explicit Sandbox approval confirmation, which submits only opaque requestId to the existing route", () => {
  assert.match(source, /const actionable = view\.status === "pending"/);
  assert.match(source, /Approve refund/);
  assert.match(source, /Sandbox Passport refund/);
  assert.match(source, /fetch\("\/api\/admin\/passport\/refunds"/);
  assert.match(source, /JSON\.stringify\(\{ requestId: pendingApproval\.request_id \}\)/);
  assert.match(source, /result\?\.status === "refund_pending"/);
  assert.match(source, /signed webhook confirms it/);
});
