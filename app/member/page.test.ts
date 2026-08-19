import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Member dashboard's vendor carousel
// Temporary Event Access Vendor "Notice" read (loadVendors). Live
// grant/RPC-body evidence is reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test app/member/page.test.ts

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

test("the attendee-visible event_vendors -> vendors listing (already anon-safe) is unchanged", () => {
  assert.match(SOURCE, /\.from\("event_vendors"\)/);
  assert.match(SOURCE, /vendors!inner/);
  assert.match(SOURCE, /\.eq\("is_visible_to_members", true\)/);
  assert.match(SOURCE, /\.eq\("vendors\.is_active", true\)/);
});
