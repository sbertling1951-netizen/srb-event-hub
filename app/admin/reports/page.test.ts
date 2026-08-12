import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

test("Reports has one guarded canonical render path", () => {
  assert.ok(source.includes('AdminRouteGuard requiredPermission="can_manage_reports"'));
  assert.ok(source.includes('<AdminShellAdapter pageTitle="Reports">'));
  assert.ok(!source.includes("useSearchParams"));
  assert.ok(!source.includes("isEmbedded"));
  assert.ok(!source.includes("AdminReportsPageContent"));
});

test("Reports no longer has an embedded shell bypass", () => {
  assert.ok(!source.includes("admin-embedded-shell"));
  assert.ok(!source.includes("ReportsPrintStyles"));
  assert.ok(!source.includes("<PageNavigation"));
  assert.ok(!source.includes("<PageHeader"));
});

test("Reports preserves its data and task actions", () => {
  for (const needle of [
    'from("attendees")',
    'from("attendee_activities")',
    'from("parking_sites")',
    "buildExportRows({",
    "printReportPack({",
    "loadStoredReportPresets()",
  ]) {
    assert.ok(source.includes(needle), `Reports must retain ${needle}`);
  }
});
