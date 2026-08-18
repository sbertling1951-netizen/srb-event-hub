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
