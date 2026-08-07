import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildStatusChangeBody,
  parseStatusChangeResponseData,
  toRequestRow,
} from "@/app/member/my-requests/page";

// Focused test for the governed-boundary audit/refactor of
// app/member/my-requests/page.tsx: the page previously read
// public.vendor_service_requests directly, filtered by a client-supplied
// requester_email, bypassing GET /api/member/vendor-requests entirely.
// This exercises the pure mapping this refactor introduced --
// normalizing the governed API's flat row shape into this page's existing
// render-facing RequestRow shape -- so the JSX (which reads
// request.vendors?.business_name) required no change. Run with:
//   npx tsx --test app/member/my-requests/page.test.ts

test("toRequestRow maps the governed API's flat vendor_business_name into the render-facing nested vendors shape", () => {
  const row = toRequestRow({
    id: "11111111-1111-1111-1111-111111111111",
    vendor_business_name: "Acme Vendor",
    requested_service: "Site cleanup",
    guest_count: 2,
    request_notes: "Please arrive early",
    request_status: "new",
    created_at: "2026-08-07T12:00:00.000Z",
    site_number: "A12",
  });

  assert.equal(row.id, "11111111-1111-1111-1111-111111111111");
  assert.deepEqual(row.vendors, { business_name: "Acme Vendor" });
  assert.equal(row.requested_service, "Site cleanup");
  assert.equal(row.guest_count, 2);
  assert.equal(row.request_notes, "Please arrive early");
  assert.equal(row.request_status, "new");
  assert.equal(row.created_at, "2026-08-07T12:00:00.000Z");
  assert.equal(row.site_number, "A12");
});

test("toRequestRow preserves a null vendor_business_name rather than fabricating a fallback", () => {
  const row = toRequestRow({
    id: "22222222-2222-2222-2222-222222222222",
    vendor_business_name: null,
    requested_service: null,
    guest_count: null,
    request_notes: null,
    request_status: null,
    created_at: null,
    site_number: null,
  });

  assert.deepEqual(row.vendors, { business_name: null });
});

// Focused tests for the cancellation-write-path repair: the page never
// sent `eventId` in its PATCH body, which app/api/member/vendor-requests
// /route.ts requires (StatusChangeBody) because
// public.set_my_vendor_service_request_status
// (20260807130000_extend_governed_member_vendor_request_write_boundary.sql)
// needs it to call the same shared resolver
// (resolve_temporary_or_authenticated_attendee) the governed read already
// uses -- so every cancel attempt failed at the route's own
// `!isUuid(body.eventId)` validation, before the RPC was ever reached.

test("buildStatusChangeBody sends the exact governed payload the route requires, including eventId", () => {
  const body = buildStatusChangeBody(
    "11111111-1111-1111-1111-111111111111",
    "cancelled",
    { id: "22222222-2222-2222-2222-222222222222", event_code: "FALL26" },
    "member@example.com",
  );

  assert.deepEqual(body, {
    requestId: "11111111-1111-1111-1111-111111111111",
    nextStatus: "cancelled",
    eventId: "22222222-2222-2222-2222-222222222222",
    eventCode: "FALL26",
    registrationIdentifier: "member@example.com",
  });
});

test("buildStatusChangeBody normalizes a missing event code / registration identifier to null, never omitted", () => {
  const body = buildStatusChangeBody(
    "11111111-1111-1111-1111-111111111111",
    "new",
    { id: "22222222-2222-2222-2222-222222222222", event_code: null },
    null,
  );

  assert.equal(body.eventCode, null);
  assert.equal(body.registrationIdentifier, null);
  // eventId is always present -- this is the exact field whose prior
  // absence caused every cancellation to fail closed as invalid_request.
  assert.equal(body.eventId, "22222222-2222-2222-2222-222222222222");
});

test("parseStatusChangeResponseData reads the RPC's authoritative updated status, never the requested one", () => {
  const status = parseStatusChangeResponseData({
    data: [{ id: "11111111-1111-1111-1111-111111111111", request_status: "cancelled" }],
  });

  assert.equal(status, "cancelled");
});

test("parseStatusChangeResponseData fails closed (null) on an empty data array", () => {
  assert.equal(parseStatusChangeResponseData({ data: [] }), null);
});

test("parseStatusChangeResponseData fails closed (null) on a malformed or missing payload", () => {
  assert.equal(parseStatusChangeResponseData(null), null);
  assert.equal(parseStatusChangeResponseData(undefined), null);
  assert.equal(parseStatusChangeResponseData({}), null);
  assert.equal(parseStatusChangeResponseData({ error: "vendor_request_status_change_failed" }), null);
  assert.equal(parseStatusChangeResponseData({ data: [{ id: "x" }] }), null);
  assert.equal(parseStatusChangeResponseData({ data: [{ request_status: 123 }] }), null);
});
