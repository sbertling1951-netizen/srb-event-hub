import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Vendor Requests Backend Authority Reconciliation, client consumer
// migration -- /admin/vendor-requests moves from the semantically wrong
// legacy can_manage_events permission to the canonical event.vendors.manage
// Event task, now that the backing vendor_service_requests RLS
// (20260818130000_cutover_vendor_service_requests_task_authority.sql)
// enforces the identical authority server-side. No HTTP/Supabase mocking
// infrastructure exists in this repository, so these are structural,
// source-level assertions -- the same style already established for
// app/admin/checkin/page.test.ts and app/admin/parking/page.test.ts.

const source = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("route uses the canonical event.vendors.manage Event task, not the legacy can_manage_events permission", () => {
  assert.match(source, /<AdminRouteGuard requiredTask="event\.vendors\.manage">/);
  assert.equal(/can_manage_events/.test(source), false);
  assert.equal(/requiredPermission/.test(source), false);
});

test("no direct has_event_task_authority RPC call is introduced -- authority is resolved only by AdminRouteGuard itself", () => {
  assert.equal(/\.rpc\(\s*"has_event_task_authority"/.test(source), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(source), false);
});

test("Event-context wiring is unchanged -- the page still lists only the current admin working Event's requests", () => {
  assert.match(
    source,
    /import \{\s*\n\s*getCurrentAdminEvent,\s*\n\s*subscribeToAdminWorkspace,\s*\n\s*\} from "@\/lib\/adminWorkspaceContext";/,
  );
  assert.match(source, /const event = getCurrentAdminEvent\(\);/);
  assert.match(source, /\.eq\("event_id", event\.id\)/);
  assert.match(source, /No admin event selected\./);
});

test("Vendor Request behavior is unchanged: list/status-change data access is untouched", () => {
  assert.match(source, /\.from\("vendor_service_requests"\)/);
  assert.match(source, /\.update\(\{ request_status: nextStatus \}\)/);
  assert.match(source, /\.eq\("id", id\)/);
  assert.match(source, /\.in\("id", ids\)/);
});

// UI Phase 5 (Vendor Requests migration onto the centralized Admin UI
// system). Same source-text assertion style as the tests above -- no
// HTTP/Supabase mocking infrastructure exists in this repository.

test("responsive switching goes through the Shell's canonical compact-state signal, not a page-local resize listener", () => {
  assert.match(source, /useShellInterfaceCapabilities/);
  assert.match(source, /const \{ isCompact \} = useShellInterfaceCapabilities\(\);/);
  assert.equal(/addEventListener\(\s*["']resize["']/.test(source), false);
  assert.equal(/window\.innerWidth/.test(source), false);
});

test("desktop renders DataTable and compact renders ResponsiveList, switched on isCompact -- neither is hidden via CSS", () => {
  assert.match(source, /isCompact \? \(\s*<ResponsiveList>/);
  assert.match(source, /<DataTable caption="Vendor service requests for the current Event">/);
  assert.equal(/display:\s*["']none["']/.test(source), false);
});

test("search and status filter are the always-visible TableToolbarPrimaryRow, not a disclosed/secondary control", () => {
  const toolbarStart = source.indexOf("<TableToolbar>");
  const toolbarEnd = source.indexOf("</TableToolbar>");
  const toolbarSource = source.slice(toolbarStart, toolbarEnd);

  assert.match(toolbarSource, /<TableToolbarPrimaryRow>/);
  assert.match(toolbarSource, /<SearchField/);
  assert.match(toolbarSource, /htmlFor="vendor-request-status"/);
  assert.equal(/TableToolbarDisclosure/.test(toolbarSource), false);
});

test("clearFilters resets only search and status filter -- there is no other display-preference state on this page to preserve", () => {
  const fnSource = source.slice(
    source.indexOf("function clearFilters()"),
    source.indexOf("const isLoading"),
  );
  assert.match(fnSource, /setSearch\(""\);/);
  assert.match(fnSource, /setFilter\("all"\);/);
});

test("active filter state is never hidden: the Clear Search & Filters control only appears when a filter or search term is actually active", () => {
  assert.match(
    source,
    /const activeFilterCount = filter !== "all" \? 1 : 0;/,
  );
  assert.match(
    source,
    /const hasClearableState = activeFilterCount > 0 \|\| search\.trim\(\) !== "";/,
  );
  assert.match(source, /\{hasClearableState \? \(/);
});

test("contact/handoff actions and status-lifecycle actions render as two separate RowActions groups, not one merged action list", () => {
  assert.match(source, /function renderContactActions\(/);
  assert.match(source, /function renderStatusActions\(/);
  const contactFn = source.slice(
    source.indexOf("function renderContactActions("),
    source.indexOf("function renderStatusActions("),
  );
  const statusFn = source.slice(
    source.indexOf("function renderStatusActions("),
    source.indexOf("const activeFilterCount"),
  );
  assert.match(contactFn, /Call Member/);
  assert.match(contactFn, /Email Member/);
  assert.match(contactFn, /Show Current Site on Map/);
  assert.equal(/updateStatus\(/.test(contactFn), false);
  assert.match(statusFn, /void updateStatus\(request\.id, s\)/);
  assert.equal(/sendVendorEmail/.test(statusFn), false);
});

test("request status is rendered through the shared StatusBadge with a tone/label map, not raw request_status text or ad hoc color", () => {
  assert.match(source, /STATUS_TONE: Record<string, StatusBadgeTone>/);
  assert.match(source, /STATUS_LABELS: Record<string, string>/);
  assert.match(source, /<StatusBadge tone=\{STATUS_TONE\[s\]\}>\{STATUS_LABELS\[s\]\}<\/StatusBadge>/);
});

test("no raw Supabase/API error message is ever passed to setStatus -- every failure path shows a safe, generic message", () => {
  assert.equal(/setStatus\(error\.message\)/.test(source), false);
  assert.equal(/setStatus\(`Email failed: \$\{error\.message\}`\)/.test(source), false);
  assert.match(source, /We couldn't load vendor requests\. Please try again\./);
  assert.match(source, /We couldn't update this request's status\. Please try again\./);
});

test("dead ad hoc button/table markup is removed -- rows use the shared AppButton/AppLinkButton/RowActions primitives, not literal app-button class strings", () => {
  assert.equal(/className="app-button"/.test(source), false);
  assert.equal(/className="app-button app-button-primary"/.test(source), false);
  assert.equal(/className="app-button app-button-muted"/.test(source), false);
  assert.match(source, /import \{ AppButton, AppLinkButton \} from "@\/components\/ui\/AppButton";/);
});
