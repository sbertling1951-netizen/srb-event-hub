import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const importsSource = source("./imports/page.tsx");
const validationRulesSource = source("./validation-rules/page.tsx");
const layoutSource = source("../layout.tsx");
const globalsSource = source("../globals.css");
const routeRegistrySource = source("../../components/shell/routeRegistry.ts");

test("the root no longer has a query-driven embedded shell mode", () => {
  assert.ok(!layoutSource.includes("admin-embedded-mode"));
  assert.ok(!layoutSource.includes("embedded=1"));
  assert.ok(!globalsSource.includes("admin-embedded-mode"));
});

test("Imports always retains its normal guarded presentation", () => {
  assert.ok(importsSource.includes('AdminRouteGuard requiredTask="event.imports.manage"'));
  // PageNavigation was retired in favor of the canonical AdminShellAdapter
  // backTarget (Imports: Canonical Attendees Return and Duplicate-Title
  // Removal) -- unrelated to embedded-mode retirement, which this test
  // otherwise covers. useSearchParams now drives the Stage 5A Imports
  // Service Center doors (?type=) deep-link routing, added after this
  // test was written -- also unrelated to embedded mode.
  assert.ok(!importsSource.includes("<PageNavigation"));
  assert.ok(!importsSource.includes("isEmbedded"));
});

test("Validation Rules has one guarded route path", () => {
  assert.ok(validationRulesSource.includes('AdminRouteGuard requiredTask="event.validation_rules.manage"'));
  // PageNavigation was retired in favor of the canonical AdminShellAdapter
  // backTarget (Central UI: Modernize Validation Rules and Confirm Rule
  // Deletion) -- unrelated to embedded-mode retirement, which this test
  // otherwise covers.
  assert.ok(!validationRulesSource.includes("<PageNavigation"));
  assert.ok(!validationRulesSource.includes("useSearchParams"));
  assert.ok(!validationRulesSource.includes("isEmbedded"));
  assert.ok(!validationRulesSource.includes("admin-embedded-shell"));
  assert.ok(!validationRulesSource.includes("ValidationRulesEmbeddedStyles"));
});

test("embedded retirement does not change Admin route classifications", () => {
  assert.ok(routeRegistrySource.includes('"/admin/reports"'));
  // /admin/imports and /admin/validation-rules were deliberately moved to
  // the canonical Admin shell by a separate, later, already-authorized
  // migration (commit 0feeaa3, "Migrate admin data pages to canonical
  // shell") -- not a side effect of embedded-mode retirement. Their
  // canonical classification is the authoritative, currently-tested
  // behavior (components/shell/routeRegistry.test.ts).
  assert.ok(routeRegistrySource.includes('"/admin/imports"'));
  assert.ok(routeRegistrySource.includes('"/admin/validation-rules"'));
});
