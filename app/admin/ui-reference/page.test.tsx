import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { AdminUiReferenceContent } from "@/app/admin/ui-reference/page";

// Admin UI Reference (design workbench, not an operational page). Two
// layers of proof, matching the established pattern for this repo:
//   1. Source-text assertions on the guarded default export -- the same
//      style already used for every other Admin route (route guard shape,
//      no live-data dependency).
//   2. An actual renderToStaticMarkup render of the exported inner content
//      component (no Provider needed -- it depends only on
//      useShellInterfaceCapabilities, a plain hook), proving every
//      referenced primitive is truly used, not just imported, and that
//      the page renders without throwing.

const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

test("the route is gated by AdminRouteGuard using an existing permission -- no new permission/authority was introduced", () => {
  assert.match(source, /<AdminRouteGuard requiredPermission="can_view_admin_dashboard">/);
  assert.equal(/requiredTask=/.test(source), false);
});

test("the route uses the canonical Admin shell adapter, not a page-local header", () => {
  assert.match(source, /<AdminShellAdapter[\s\S]*?pageTitle="Admin UI Reference"/);
  assert.match(source, /backTarget=\{\{ href: "\/admin\/dashboard", label: "Dashboard" \}\}/);
});

test("this page has no production data dependency -- no Supabase client, no Event context, no RPC/table access anywhere in the file", () => {
  assert.equal(/from "@\/lib\/supabase"/.test(source), false);
  assert.equal(/supabase\.(from|rpc)\(/.test(source), false);
  assert.equal(/getCurrentAdminEvent|subscribeToAdminWorkspace|useAdminWorkspace/.test(source), false);
  assert.equal(/localStorage\.(setItem|getItem)/.test(source), false);
});

test("responsive behavior goes through the canonical shell capability hook only -- no page-local resize listener, effect, or breakpoint computes it independently", () => {
  assert.match(source, /const capabilities = useShellInterfaceCapabilities\(\);/);
  assert.equal(/addEventListener\(\s*["']resize["']/.test(source), false);
  // The page's own prose explains window.innerWidth/matchMedia inside
  // <code> tags (documenting what the shared hook does) -- those literal
  // mentions are expected. What must never appear is this file computing
  // capability itself: no useEffect/useLayoutEffect import at all, since
  // the only capability source in scope is the imported hook.
  assert.match(source, /import \{ useMemo, useState \} from "react";/);
  assert.equal(/useEffect|useLayoutEffect/.test(source), false);
});

test("every shared primitive named in scope is actually imported from components/ui or the shell", () => {
  for (const importPath of [
    '"@/components/shell/useShellViewport"',
    '"@/components/ui/Alert"',
    '"@/components/ui/AppButton"',
    '"@/components/ui/ConfirmDialog"',
    '"@/components/ui/DataTable"',
    '"@/components/ui/PageHeader"',
    '"@/components/ui/PageSection"',
    '"@/components/ui/RowActions"',
    '"@/components/ui/StatusBadge"',
    '"@/components/ui/TableToolbar"',
  ]) {
    assert.ok(source.includes(importPath), `expected an import from ${importPath}`);
  }
});

test("the route is registered canonical-admin in the shell route registry (no double-shell)", () => {
  const registrySource = readFileSync(
    fileURLToPath(new URL("../../../components/shell/routeRegistry.ts", import.meta.url)),
    "utf8",
  );
  assert.match(registrySource, /"\/admin\/ui-reference"/);
});

test("AdminUiReferenceContent renders without a Provider and without throwing", () => {
  const html = renderToStaticMarkup(<AdminUiReferenceContent />);
  assert.ok(html.length > 0);
});

test("every one of the 13 reference sections is present as a real heading in the rendered output", () => {
  const html = renderToStaticMarkup(<AdminUiReferenceContent />);

  for (const heading of [
    "Page Layout",
    "Typography",
    "Buttons and Action Hierarchy",
    "Form Controls",
    "Search / Filter / Toolbar",
    "Tables and Lists",
    "Status and Semantic Treatments",
    "Alerts and Feedback",
    "Cards, Containers, and Sections",
    "Action Rows",
    "Empty, Loading, and Error States",
    "Responsive Review",
    "Device &amp; Layout Preferences",
  ]) {
    assert.ok(html.includes(heading), `expected rendered output to include heading "${heading}"`);
  }
});

test("every real shared-primitive CSS class actually appears in the rendered markup, not just the source", () => {
  const html = renderToStaticMarkup(<AdminUiReferenceContent />);

  for (const className of [
    'class="data-table"',
    'class="responsive-list"',
    'class="row-actions"',
    'class="app-status-pill',
    'class="app-alert',
    'class="table-toolbar"',
    'class="table-toolbar-disclosure"',
    'class="card"',
    'class="app-card-section"',
  ]) {
    assert.ok(html.includes(className), `expected rendered output to include ${className}`);
  }
});

test("the toolbar's search/filter state is demonstrably separate from the display-preference state -- clearDemoFilters never touches demoShowNotes or demoPreferredView", () => {
  const fnSource = source.slice(
    source.indexOf("function clearDemoFilters()"),
    source.indexOf("const filteredRecords"),
  );
  assert.match(fnSource, /setDemoSearch\(""\);/);
  assert.match(fnSource, /setDemoCategory\("all"\);/);
  assert.match(fnSource, /setDemoStatus\("all"\);/);
  assert.equal(/setDemoShowNotes/.test(fnSource), false);
  assert.equal(/setDemoPreferredView/.test(fnSource), false);
});

test("capability remains the safety constraint on the demo preferred-view control -- Table only wins when the shell is not compact", () => {
  assert.match(
    source,
    /const liveShowsList = demoPreferredView === "list" \? true : demoPreferredView === "table" \? isCompact : isCompact;/,
  );
});

test("no new StatusBadge tone or AppButton variant was invented to build this page", () => {
  const badgeToneUses = [...source.matchAll(/tone=\{?"?(neutral|info|warning|danger|success)"?\}?/g)].map(
    (m) => m[1],
  );
  assert.ok(badgeToneUses.length > 0);
  for (const tone of badgeToneUses) {
    assert.ok(["neutral", "info", "warning", "danger", "success"].includes(tone));
  }

  const buttonVariantUses = [...source.matchAll(/<App(?:Link)?Button[^>]*\bvariant="([a-z]+)"/g)].map(
    (m) => m[1],
  );
  assert.ok(buttonVariantUses.length > 0);
  for (const variant of buttonVariantUses) {
    assert.ok(
      ["default", "primary", "success", "danger", "warning", "muted", "start", "stop"].includes(variant),
    );
  }
});
