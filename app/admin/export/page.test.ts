import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Task-Authority Guard Design, Export consumer migration -- Export moves
// from the legacy can_export_reports permission to the canonical,
// already-registered event.reports.export task
// (20260811170000_create_scoped_task_authority_foundation.sql), the same
// task key app/admin/reports/page.tsx already checks downstream for its
// export buttons. No HTTP/Supabase mocking infrastructure exists in this
// repository, so these are structural, source-level assertions, matching
// the style already established by app/admin/reports/page.test.ts.

const source = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("route uses the canonical event.reports.export task, not the legacy permission", () => {
  assert.match(source, /<AdminRouteGuard requiredTask="event\.reports\.export">/);
  assert.equal(/can_export_reports/.test(source), false);
  assert.equal(/requiredPermission/.test(source), false);
});

test("no direct has_event_task_authority RPC call is introduced -- authority is resolved only by AdminRouteGuard itself", () => {
  assert.equal(/\.rpc\(\s*"has_event_task_authority"/.test(source), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(source), false);
});

test("Event-context wiring is unchanged", () => {
  assert.match(
    source,
    /import \{ getCurrentAdminEvent \} from "@\/lib\/adminWorkspaceContext";/,
  );
  assert.match(source, /const adminEvent = getCurrentAdminEvent\(\);/);
  assert.match(source, /No admin event selected\./);
});

test("export behavior is unchanged: attendees CSV export scoped to the current admin event", () => {
  assert.match(source, /\.from\("attendees"\)/);
  assert.match(source, /\.eq\("event_id", adminEvent\.id\)/);
  assert.match(source, /text\/csv;charset=utf-8;/);
  assert.match(source, /-attendees-\$\{date\}\.csv`;/);
});
