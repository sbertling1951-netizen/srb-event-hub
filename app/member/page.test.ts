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

// ---------------------------------------------------------------------------
// Member Workspace Continuity -- the dashboard consumes the shared workspace
// identity state, not its own legacy-key admission check.
// ---------------------------------------------------------------------------

test("the dashboard admits/blocks on the SAME shared workspace identity state as MemberRouteGuard", () => {
  assert.match(SOURCE, /const workspace = useMemberWorkspace\(\);/);
  assert.doesNotMatch(SOURCE, /hasLegacyIdentity/);
  assert.doesNotMatch(SOURCE, /getStoredMemberEntryId|getStoredMemberEmail/);
});

test("while the shared layer is bootstrapping / re-deriving identity the dashboard stays in its loading state", () => {
  assert.match(
    SOURCE,
    /if \(!workspace\.isReady \|\| workspace\.identityStatus === "resolving"\) \{[\s\S]{0,180}?setReady\(false\);[\s\S]{0,30}?return;/,
  );
});

test("recovery_required / no usable identity routes to explicit recovery, never a rendered 'valid' Event Hub", () => {
  assert.match(
    SOURCE,
    /workspace\.identityStatus === "recovery_required" \|\|\s*\n\s*!workspace\.event\?\.id \|\|\s*\n\s*!workspace\.attendeeId/,
  );
  assert.match(SOURCE, /"\/member\/account\?contextInvalid=1"/);
  assert.match(SOURCE, /"\/member\/login\?sessionExpired=1"/);
});

test("the participant summary loader no longer has an independent attendeeId gate", () => {
  const loader = SOURCE.slice(
    SOURCE.indexOf("// Load participant capacity and household members"),
    SOURCE.indexOf("})();"),
  );
  assert.doesNotMatch(loader, /if \(!attendeeId\) \{\s*\n\s*return;/);
});
