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

test("My Events is offered only to an established account session, not Temporary Event Access or unresolved Auth", () => {
  assert.match(
    SOURCE,
    /\{workspace\.isAccountSession === true \? \(\s*<button[\s\S]*?goTo\("\/member\/account"\)[\s\S]*?My Events\s*<\/button>\s*\) : null\}/,
  );
});

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

// ---------------------------------------------------------------------------
// Presentation Slice 1: root loading state, the vendor error, and the two
// card containers now use the shared LoadingState/Alert/PageSection
// primitives, and the vendor action links use AppLinkButton (external) /
// AppButton-classed next/link (internal, preserving client-side navigation),
// with no change to verifyAccess, loadVendors, RPC/query calls, or the nav
// tile grid/capacity badge/carousel dots beneath them.
// ---------------------------------------------------------------------------

test("the root loading state uses the shared LoadingState, preserving the exact !ready gate and shell wrapper", () => {
  assert.match(SOURCE, /import \{ LoadingState \} from "@\/components\/ui\/LoadingState";/);
  assert.match(
    SOURCE,
    /if \(!ready\) \{\s*\n\s*return \(\s*\n\s*<MemberShellAdapter pageTitle=\{dashboardTitle\}>\s*\n\s*<LoadingState message="Loading\.\.\." \/>\s*\n\s*<\/MemberShellAdapter>/,
  );
});

test("the vendor error uses the shared Alert, preserving its exact condition and message", () => {
  assert.match(SOURCE, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
  assert.match(
    SOURCE,
    /\{vendorsLoading \? null : vendorError \? \(\s*\n\s*<Alert tone="danger">\{vendorError\}<\/Alert>/,
  );
});

test("the Participants and vendor carousel containers use PageSection, preserving all free content inside", () => {
  assert.match(SOURCE, /import \{ PageSection \} from "@\/components\/ui\/PageSection";/);
  assert.match(SOURCE, /<PageSection variant="card" style=\{\{ minWidth: 0, padding: 18 \}\}>/);
  assert.match(SOURCE, /<PageSection variant="card" style=\{\{ minWidth: 0 \}\}>/);
  // the h2, badge/banner, rows, and Add Participant button are all still present
  assert.match(SOURCE, /<h2 style=\{\{ margin: 0 \}\}>Participants<\/h2>/);
  assert.match(SOURCE, /Participant roster exceeds authorized capacity\./);
  assert.match(SOURCE, /\+ Add Participant/);
  assert.match(SOURCE, /\{eventVendorsHeading\}/);
});

test("the vacant-slot dashed border is tokenized to the exact design-system value", () => {
  assert.match(SOURCE, /border: "1px dashed var\(--color-border-strong\)"/);
  assert.doesNotMatch(SOURCE, /border: "1px dashed #cbd5e1"/);
});

test("Sign Up (external) uses AppLinkButton; View Vendors and Request Service (internal) keep next/link with the AppButton classes so client-side navigation is preserved", () => {
  assert.match(SOURCE, /import \{ AppLinkButton \} from "@\/components\/ui\/AppButton";/);
  assert.match(
    SOURCE,
    /<AppLinkButton\s*\n\s*variant="primary"\s*\n\s*href=\{activeVendor\.signup_url\}\s*\n\s*target="_blank"\s*\n\s*rel="noopener noreferrer"\s*\n\s*>\s*\n\s*Sign Up\s*\n\s*<\/AppLinkButton>/,
  );
  assert.match(
    SOURCE,
    /<Link\s*\n\s*href="\/member\/vendor-signup"\s*\n\s*className="app-button app-button-primary"\s*\n\s*>\s*\n\s*View Vendors\s*\n\s*<\/Link>/,
  );
  assert.match(
    SOURCE,
    /<Link\s*\n\s*href=\{`\/member\/vendor-signup\?vendorId=\$\{activeVendor\.id\}`\}\s*\n\s*className="app-button app-button-primary"\s*\n\s*>\s*\n\s*Request Service\s*\n\s*<\/Link>/,
  );
});

test("the navigation tile grid, capacity badge/banner, Add Participant styling, and carousel dots are untouched", () => {
  assert.match(SOURCE, /const memberGridButtonStyle: React\.CSSProperties = \{/);
  assert.match(SOURCE, /background: isOverCapacity \? "#fef3c7" : "#eff6ff",/);
  assert.match(SOURCE, /color: isOverCapacity \? "#b45309" : "#1d4ed8",/);
  assert.match(SOURCE, /style=\{\{\s*\n\s*\.\.\.memberGridButtonStyle,\s*\n\s*textAlign: "center",\s*\n\s*marginTop: 12,\s*\n\s*\}\}/);
  assert.match(
    SOURCE,
    /background:\s*\n\s*index === currentVendorIndex \? "#0b5cff" : "#ccc",/,
  );
});

test("verifyAccess, loadVendors, and every RPC/query call remain unchanged", () => {
  assert.match(SOURCE, /supabase\.rpc\("get_my_attendee_record", rpcArgs\)/);
  assert.match(SOURCE, /supabase\.rpc\("get_my_household_members", rpcArgs\)/);
  assert.match(
    SOURCE,
    /supabase\.rpc\(\s*\n?\s*"resolve_attendee_visible_vendor_notices",\s*\n?\s*\{\s*p_event_id:\s*event\.id\s*\}/,
  );
  assert.match(SOURCE, /\.from\("event_vendors"\)/);
  assert.doesNotMatch(SOURCE, /backTarget=/);
});
