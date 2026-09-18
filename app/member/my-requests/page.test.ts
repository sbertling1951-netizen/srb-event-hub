import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildStatusChangeBody,
  parseStatusChangeResponseData,
  toRequestRow,
} from "@/app/member/my-requests/page";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

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

test("My Requests uses canonical workspace/session identity and never reads retired standalone name/email keys", () => {
  assert.match(SOURCE, /useMemberWorkspace\(\)/);
  assert.match(SOURCE, /const \{ event, isReady, session \} = useMemberWorkspace\(\);/);
  assert.match(SOURCE, /if \(!isReady \|\| !event\?\.id \|\| !session\)/);
  assert.doesNotMatch(SOURCE, /fcoc-member-(name|email)/);
  assert.doesNotMatch(SOURCE, /STORAGE_KEYS\.(memberName|memberEmail)/);
  assert.doesNotMatch(SOURCE, /localStorage\.getItem/);
});

test("My Requests scopes reads and mutations to the resolved workspace Event and governed session evidence", () => {
  assert.match(SOURCE, /const params = new URLSearchParams\(\{ eventId: event\.id \}\);/);
  assert.match(SOURCE, /const identityArgs = memberIdentityRpcArgs\(session\);/);
  assert.match(SOURCE, /identityArgs\.p_event_code/);
  assert.match(SOURCE, /identityArgs\.p_registration_identifier/);
  assert.match(SOURCE, /buildStatusChangeBody\([\s\S]{0,240}?event,[\s\S]{0,240}?identityArgs\.p_registration_identifier/);
});

test("My Requests greeting is driven by canonical participant_name, so stale standalone browser values cannot override it", () => {
  assert.match(SOURCE, /session\?\.participant_name/);
  assert.match(SOURCE, /session\.participant_name\}, here are your service requests/);
  assert.doesNotMatch(SOURCE, /memberName/);
  assert.doesNotMatch(SOURCE, /memberEmail/);
});

// ---------------------------------------------------------------------------
// Presentation Slice 1: the status card wrapper, status, error, and the
// empty-requests message now use the shared PageSection/Alert/EmptyState
// primitives, with no change to load/mutation/API/identity logic, the
// exported mapping functions, statusMessage, activeCount, request cards, or
// statusBadgeStyle beneath them.
// ---------------------------------------------------------------------------

test("the status card uses PageSection, preserving the greeting and active-count lines as plain text, in order", () => {
  assert.match(SOURCE, /import \{ PageSection \} from "@\/components\/ui\/PageSection";/);
  assert.match(
    SOURCE,
    /<PageSection variant="card">\s*\n\s*\{session\?\.participant_name \? \(\s*\n\s*<div style=\{\{ fontSize: 14, color: "#555" \}\}>\s*\n\s*\{session\.participant_name\}, here are your service requests\.\s*\n\s*<\/div>\s*\n\s*\) : null\}/,
  );
  assert.match(
    SOURCE,
    /\{activeCount > 0 \? \(\s*\n\s*<div style=\{\{ marginTop: 6, fontWeight: 800 \}\}>\s*\n\s*Active requests: \{activeCount\}\s*\n\s*<\/div>\s*\n\s*\) : null\}\s*\n\s*<\/PageSection>/,
  );
});

test("status and error use the shared Alert primitive, preserving their exact gates and message", () => {
  assert.match(SOURCE, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
  assert.match(SOURCE, /\{status && !error \? <Alert tone="info">\{status\}<\/Alert> : null\}/);
  assert.match(SOURCE, /\{!loading && error \? <Alert tone="danger">\{error\}<\/Alert> : null\}/);
});

test("the empty-requests message uses the shared EmptyState, preserving its exact gate and copy", () => {
  assert.match(SOURCE, /import \{ EmptyState \} from "@\/components\/ui\/EmptyState";/);
  assert.match(
    SOURCE,
    /\{!loading && !error && requests\.length === 0 \? \(\s*\n\s*<EmptyState message="No requests yet\." \/>\s*\n\s*\) : null\}/,
  );
});

test("Slice 1 leaves request cards, statusBadgeStyle, Cancel/Undo, and every load/mutation/API/identity contract untouched", () => {
  assert.match(SOURCE, /function statusBadgeStyle\(status: string\): React\.CSSProperties \{/);
  assert.match(SOURCE, /onClick=\{\(\) => void cancelRequest\(request\.id\)\}/);
  assert.match(SOURCE, /onClick=\{\(\) => void undoCancelRequest\(request\.id\)\}/);
  assert.match(SOURCE, /async function loadRequests\(\) => \{|const loadRequests = useCallback\(async \(\) => \{/);
  assert.match(SOURCE, /fetch\(\s*\n\s*`\/api\/member\/vendor-requests\?/);
  assert.match(SOURCE, /fetch\("\/api\/member\/vendor-requests", \{\s*\n\s*method: "PATCH",/);
  assert.match(SOURCE, /function statusMessage\(status: string\) \{/);
  assert.match(SOURCE, /const activeCount = useMemo\(\(\) => \{/);
  assert.equal((SOURCE.match(/backTarget=/g) || []).length, 0);
});
