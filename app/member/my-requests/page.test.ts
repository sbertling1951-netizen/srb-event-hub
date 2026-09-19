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

test("each request card uses PageSection, keeping its key, grid layout, and its own 12px radius (.card resolves to 10px, and 18px under the 899px breakpoint)", () => {
  assert.match(
    SOURCE,
    /<PageSection\s*\n\s*key=\{request\.id\}\s*\n\s*variant="card"\s*\n(?:\s*\/\/[^\n]*\n)*\s*style=\{\{ borderRadius: 12, display: "grid", gap: 8 \}\}\s*\n\s*>/,
  );
});

test("Slice 1/2 leaves statusBadgeStyle, the Cancel/Undo handlers, and every load/mutation/API/identity contract untouched", () => {
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

// ---------------------------------------------------------------------------
// Presentation Slice 3: the Cancel Request and Undo Cancel controls now use
// the shared AppButton (outlined danger / neutral secondary), with no change
// to the render ternary, the handlers, the immediate mutation behavior, the
// API/payload/identity paths, statusBadgeStyle, or the card contents.
//
// Accepted appearance changes: Cancel goes from a filled #fee2e2 pill to
// `.app-button-danger`, which is transparent at rest and tints to #fee2e2
// only on hover; Undo loses its #dbeafe/#1e3a8a blue restore affinity for
// the neutral `.app-button-secondary` treatment; both adopt the shared 45px
// minimum touch target (previously ~34px) and 16px label.
//
// These are structural source assertions: they pin the props and JSX shape,
// not rendered geometry. Neither the 45px height nor the outlined resting
// fill is measured here -- that needs a browser.
// ---------------------------------------------------------------------------

test("Cancel Request uses the outlined danger AppButton, preserving its exact handler, label, and 8px top spacing", () => {
  assert.match(SOURCE, /import \{ AppButton \} from "@\/components\/ui\/AppButton";/);
  assert.match(
    SOURCE,
    /<AppButton\s*\n\s*variant="danger"\s*\n\s*onClick=\{\(\) => void cancelRequest\(request\.id\)\}\s*\n\s*style=\{\{ marginTop: 8 \}\}\s*\n\s*>\s*\n\s*Cancel Request\s*\n\s*<\/AppButton>/,
  );
});

test("Undo Cancel uses the neutral secondary AppButton, preserving its exact handler, label, and 8px top spacing", () => {
  assert.match(
    SOURCE,
    /<AppButton\s*\n\s*variant="secondary"\s*\n\s*onClick=\{\(\) => void undoCancelRequest\(request\.id\)\}\s*\n\s*style=\{\{ marginTop: 8 \}\}\s*\n\s*>\s*\n\s*Undo Cancel\s*\n\s*<\/AppButton>/,
  );
});

test("the status-driven render ternary is unchanged and both controls stay immediate -- no disabled, loading, busy state, or confirmation was added", () => {
  assert.match(
    SOURCE,
    /\{requestStatus !== "completed" && requestStatus !== "cancelled" \? \(/,
  );
  assert.match(SOURCE, /\) : requestStatus === "cancelled" \? \(/);
  // Scoped to the two converted controls: no raw <button> remains on this
  // page at all (both were the conversion targets).
  assert.doesNotMatch(SOURCE, /<button\b/);
  assert.doesNotMatch(SOURCE, /<AppButton[\s\S]{0,200}?(disabled|loading)=/);
  assert.doesNotMatch(SOURCE, /ConfirmDialog|window\.confirm/);
  // The immediate mutation path is untouched: no per-request pending state.
  assert.doesNotMatch(SOURCE, /cancellingRequestId|pendingCancel/);
});

test("Slice 3 leaves statusBadgeStyle, the card contents, and the governed PATCH path untouched", () => {
  assert.match(SOURCE, /function statusBadgeStyle\(status: string\): React\.CSSProperties \{/);
  assert.match(SOURCE, /async function cancelRequest\(id: string\) \{/);
  assert.match(SOURCE, /async function undoCancelRequest\(id: string\) \{/);
  assert.match(SOURCE, /patchRequestStatus\(id, "cancelled"\)/);
  assert.match(SOURCE, /patchRequestStatus\(id, "new"\)/);
  assert.match(SOURCE, /fetch\("\/api\/member\/vendor-requests", \{\s*\n\s*method: "PATCH",/);
  assert.match(SOURCE, /<strong>Site:<\/strong>/);
  assert.match(SOURCE, /Submitted: \{formatDate\(request\.created_at\)\}/);
  assert.equal((SOURCE.match(/backTarget=/g) || []).length, 0);
});
