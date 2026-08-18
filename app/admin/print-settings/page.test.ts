import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

// Task-Authority Guard Design, Print Settings authority remediation.
// Print Settings has no view-only mode -- its only job is uploading and
// removing name-tag/coach-plate backgrounds (both real mutations) -- so
// the whole route requires event.print.manage, matching the RLS policy
// event_print_settings' own INSERT/UPDATE/DELETE already enforce
// (20260811240000_cutover_event_print_settings_task_authority.sql).
// Run with:
//   npx tsx --test app/admin/print-settings/page.test.ts

test("route requires event.print.manage, not the legacy can_manage_print_settings permission", () => {
  assert.match(source, /<AdminRouteGuard requiredTask="event\.print\.manage">/);
  assert.equal(/requiredPermission/.test(source), false);
  assert.equal(/can_manage_print_settings/.test(source), false);
  assert.equal(/hasPermission/.test(source), false);
});

test("no direct has_event_task_authority RPC call is introduced -- authority is owned entirely by AdminRouteGuard", () => {
  assert.equal(/has_event_task_authority/.test(source), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(source), false);
});

test("the duplicate page-level access re-check is gone; only Event-membership (canAccessEvent) remains as a page-local check", () => {
  assert.equal(
    (source.match(/You do not have permission to manage print settings\./g) || []).length,
    0,
  );
  assert.match(source, /canAccessEvent\(admin!, adminEvent\.id\)/);
});

test("upload/remove behavior for both backgrounds is unchanged", () => {
  for (const needle of [
    "handleUploadNameTagBackground",
    "handleUploadCoachPlateBackground",
    "clearNameTagBackground",
    "clearCoachPlateBackground",
    'from("event_print_settings")',
    '.storage\n      .from("event-assets")',
    "ensurePrintSettingsRow",
  ]) {
    assert.ok(
      source.includes(needle) || new RegExp(needle).test(source),
      `Print Settings must retain ${needle}`,
    );
  }
});

test("Event context handling is unchanged: reads getCurrentAdminEvent and re-syncs on Admin workspace change", () => {
  assert.match(source, /const adminEvent = getCurrentAdminEvent\(\);/);
  assert.match(source, /subscribeToAdminWorkspace\(\(\) => \{/);
  assert.equal(/setCurrentAdminEvent/.test(source), false);
});
