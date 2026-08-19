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
