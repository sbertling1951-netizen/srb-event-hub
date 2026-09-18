import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Member Vendor Signup page's
// Temporary Event Access Vendor "Notice" read. Live grant/RPC-body
// evidence (vendor_event_status anon SELECT correctly denied; the new
// RPC's Event-visibility re-validation and attendee-safe column scope)
// is reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test app/member/vendor-signup/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("vendor Notice content is read through the governed resolve_attendee_visible_vendor_notices RPC, not a raw vendor_event_status table read", () => {
  assert.match(
    SOURCE,
    /supabase\.rpc\(\s*\n?\s*"resolve_attendee_visible_vendor_notices",\s*\n?\s*\{\s*p_event_id:\s*event\.id\s*\}/,
  );
  assert.doesNotMatch(SOURCE, /\.from\("vendor_event_status"\)/);
});

test("the attendee-visible vendor listing (vendors + event_vendors, already anon-safe) is unchanged", () => {
  assert.match(SOURCE, /\.from\("vendors"\)/);
  assert.match(SOURCE, /event_vendors!inner/);
  assert.match(SOURCE, /\.eq\("is_active", true\)/);
  assert.match(SOURCE, /\.neq\("event_vendors\.is_visible_to_members", false\)/);
});

test("identity-sensitive vendor request read/submit/cancel remain routed through the governed member vendor-requests API, never a raw table write", () => {
  assert.match(SOURCE, /\/api\/member\/vendor-requests/);
  assert.doesNotMatch(SOURCE, /\.from\("vendor_service_requests"\)/);
  assert.doesNotMatch(SOURCE, /\.insert\(/);
  assert.doesNotMatch(SOURCE, /\.update\(/);
});

test("attendee identity for request submission comes from event_code/registration_identifier evidence, never a client-trusted attendee id", () => {
  assert.match(SOURCE, /eventCode: session\?\.event_code \|\| null/);
  assert.match(
    SOURCE,
    /registrationIdentifier:\s*\n?\s*session\?\.attendee_email \|\| session\?\.attendee_phone \|\| null/,
  );
});

// ---------------------------------------------------------------------------
// Presentation Slice 1: the status card and the empty request-list message
// now use the shared PageSection/Alert/EmptyState primitives, with no
// change to loadPage, request submit/cancel/confirm, vendor queries/RPCs/
// API calls, or identity-evidence fields beneath them.
// ---------------------------------------------------------------------------

test("the status card uses PageSection, preserving the three status/error/submitted regions inside", () => {
  assert.match(SOURCE, /import \{ PageSection \} from "@\/components\/ui\/PageSection";/);
  assert.match(
    SOURCE,
    /<PageSection variant="card">\s*\n\s*\{status && !error \? <Alert tone="info">\{status\}<\/Alert> : null\}\s*\n\s*\{error \? <Alert tone="danger">\{error\}<\/Alert> : null\}\s*\n\s*\{submitted \? \(/,
  );
});

test("status/error/submitted use the shared Alert primitive with the singular-failure-surface gate and exact copy", () => {
  assert.match(SOURCE, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
  assert.match(SOURCE, /\{status && !error \? <Alert tone="info">\{status\}<\/Alert> : null\}/);
  assert.match(SOURCE, /\{error \? <Alert tone="danger">\{error\}<\/Alert> : null\}/);
  assert.match(
    SOURCE,
    /<Alert tone="success">\s*\n\s*Request submitted\. The vendor or event team will follow up with you\.\s*\n\s*<\/Alert>/,
  );
});

test("the empty My Vendor Requests message uses the shared EmptyState, preserving its exact gate and copy", () => {
  assert.match(SOURCE, /import \{ EmptyState \} from "@\/components\/ui\/EmptyState";/);
  assert.match(
    SOURCE,
    /\{memberRequests\.length === 0 \? \(\s*\n\s*<EmptyState message="You do not have any vendor requests for this event yet\." \/>/,
  );
});

test("Slice 1 leaves selects, inputs, action links/buttons, status badges, the request-card list, and ConfirmDialog untouched", () => {
  assert.match(SOURCE, /<select\s*\n\s*value=\{selectedVendorId\}/);
  assert.match(SOURCE, /<select\s*\n\s*value=\{preferredResponseMethod\}/);
  assert.match(SOURCE, /className="app-button app-button-primary"/);
  assert.match(SOURCE, /function statusBadge\(status: string\) \{/);
  assert.match(SOURCE, /<ConfirmDialog\s*\n\s*open=\{!!requestPendingCancel\}/);
});

test("Slice 1 leaves loadPage, request submit/cancel/confirm, and every vendor query/RPC/API call unchanged", () => {
  assert.match(SOURCE, /\.from\("vendors"\)/);
  assert.match(SOURCE, /event_vendors!inner/);
  assert.match(
    SOURCE,
    /supabase\.rpc\(\s*\n?\s*"resolve_attendee_visible_vendor_notices",\s*\n?\s*\{\s*p_event_id:\s*event\.id\s*\}/,
  );
  assert.match(SOURCE, /fetch\(\s*\n\s*`\/api\/member\/vendor-requests\?/);
  assert.match(SOURCE, /fetch\("\/api\/member\/vendor-requests", \{\s*\n\s*method: "POST",/);
  assert.match(SOURCE, /fetch\("\/api\/member\/vendor-requests", \{\s*\n\s*method: "PATCH",/);
  assert.equal((SOURCE.match(/backTarget=/g) || []).length, 0);
});
