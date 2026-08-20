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
  assert.match(source, /import \{ useId, useMemo, useState \} from "react";/);
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

test("the Table & Action Treatment Comparison shows all four labeled treatments, with Casey's long name present in each", () => {
  const html = renderToStaticMarkup(<AdminUiReferenceContent />);

  assert.ok(html.includes("Table &amp; Action Treatment Comparison"));
  for (const label of [
    "1. Current / Baseline",
    "2. Desktop / Pointer-Optimized Candidate",
    "3. Touch-Optimized Candidate",
    "4. Existing ResponsiveList",
  ]) {
    assert.ok(html.includes(label), `expected rendered output to include "${label}"`);
  }

  const occurrences = html.split("Casey Whitfield-Alvarenga-Thornbury").length - 1;
  assert.ok(
    occurrences >= 4,
    `expected Casey's long name to appear in every treatment (>=4 times), found ${occurrences}`,
  );
});

test("the comparison declares no winner -- both candidates are explicitly labeled prototype-only, not shared primitives", () => {
  const comparisonSource = source.slice(
    source.indexOf('id="tables-comparison"'),
    source.indexOf("7. STATUS AND SEMANTIC TREATMENTS"),
  );
  assert.match(comparisonSource, /Prototype-only/);
  assert.match(comparisonSource, /None of these four is being recommended over the others/);
  assert.match(comparisonSource, /none of the four treatments below is approved or canonical/);
});

test("the touch-optimized candidate uses a native, always-visible <details>/<summary> disclosure for secondary actions -- no hover state and no custom JS open/close logic", () => {
  const fnSource = source.slice(
    source.indexOf("function TouchOptimizedCandidate("),
    source.length,
  );
  assert.match(fnSource, /<details className="ui-ref-touch-more">/);
  assert.match(fnSource, /<summary className="table-toolbar-disclosure-summary">More actions<\/summary>/);
  assert.equal(/onMouseEnter|onMouseOver|:hover/.test(fnSource), false);
  assert.equal(/useState/.test(fnSource), false);

  const html = renderToStaticMarkup(<AdminUiReferenceContent />);
  assert.ok(html.includes("<details"));
  assert.ok(html.includes("More actions"));
});

test("the touch-optimized candidate's primary action (Contact) renders outside the disclosure -- always visible, not tucked behind More actions", () => {
  const fnSource = source.slice(
    source.indexOf("function TouchOptimizedCandidate("),
    source.length,
  );
  const contactIndex = fnSource.indexOf("Contact");
  const detailsIndex = fnSource.indexOf("<details");
  assert.ok(contactIndex > -1 && detailsIndex > -1 && contactIndex < detailsIndex);
});

test("the desktop/pointer candidate and touch candidate are built from real DataTable/ResponsiveList/RowActions/AppButton/StatusBadge, not page-local table/list markup", () => {
  const desktopFn = source.slice(
    source.indexOf("function DesktopPointerCandidate("),
    source.indexOf("function TouchOptimizedCandidate("),
  );
  const touchFn = source.slice(
    source.indexOf("function TouchOptimizedCandidate("),
    source.length,
  );

  assert.match(desktopFn, /<DataTable caption=/);
  assert.match(desktopFn, /sampleRowActions\(r, "ui-ref-actions-nowrap"\)/);
  assert.match(desktopFn, /<StatusBadge tone=\{STATUS_TONE\[r\.status\]\}>/);

  assert.match(touchFn, /<ResponsiveList>/);
  assert.match(touchFn, /<RowActions className="ui-ref-touch-more-actions">/);
  assert.match(touchFn, /<StatusBadge tone=\{STATUS_TONE\[r\.status\]\}>/);
});

test("the Mid-Size UI Scale section is now approved/canonical: a Legacy vs. Approved Canonical side-by-side, and the exact value table, are rendered", () => {
  const html = renderToStaticMarkup(<AdminUiReferenceContent />);

  assert.ok(html.includes("Mid-Size UI Scale (✅ Approved"));
  assert.ok(html.includes("Legacy Scale (historical)"));
  assert.ok(html.includes("Approved Canonical Scale (current default)"));
  assert.ok(html.includes('class="ui-ref-scale-legacy"'));
  // The canonical column renders ScaleExamplePanel with NO wrapper class --
  // it is just the ambient page state now.
  assert.equal(/class="ui-ref-scale-mid"/.test(html), false);

  for (const value of ["22px", "23px", "20px", "21px", "14px", "15px", "42px", "45px"]) {
    assert.ok(html.includes(value), `expected the value table to include ${value}`);
  }

  // Two independently-scoped copies of the same representative panel --
  // "Vendor Dispatch Lists" (the section-title sample text) should
  // appear at least twice: once at Legacy scale, once ambient/canonical.
  const occurrences = html.split("Vendor Dispatch Lists").length - 1;
  assert.ok(occurrences >= 2, `expected the section-title sample to appear at least twice, found ${occurrences}`);
});

test("the Mid-Size Scale toggle re-renders the real, existing SampleRoster (Section 6) -- Approved Canonical needs no wrapper, only Legacy uses the reference-only class", () => {
  const scaleSectionSource = source.slice(source.indexOf('id="scale"'), source.length);
  assert.match(scaleSectionSource, /<SampleRoster records=\{SAMPLE_RECORDS\} showNotes asList=\{false\} \/>/);
  assert.match(
    scaleSectionSource,
    /className=\{scaleToggle === "legacy" \? "ui-ref-scale-legacy" : undefined\}/,
  );
});

test("the Mid-Size UI Scale IS now the real :root token set -- app/globals.css's :root carries the approved values, and only the Legacy comparison still uses a reference-only override", () => {
  const cssSource = readFileSync(fileURLToPath(new URL("../../globals.css", import.meta.url)), "utf8");
  const rootStart = cssSource.indexOf(":root {");
  const rootEnd = cssSource.indexOf("\n}\n", rootStart);
  const rootBlock = cssSource.slice(rootStart, rootEnd);

  assert.match(rootBlock, /--font-size-page-title: 23px;/);
  assert.match(rootBlock, /--font-size-body: 15px;/);
  assert.match(rootBlock, /--touch-target-min: 45px;/);
  // The reference-only override now reproduces the OLD values, not the
  // approved ones -- it exists purely for historical comparison.
  assert.equal(/ui-ref-scale/.test(rootBlock), false);
  assert.match(cssSource, /\.ui-ref-scale-legacy \{/);
  assert.match(cssSource, /--font-size-page-title: 22px;/);
  assert.equal(/\.ui-ref-scale-mid \{/.test(cssSource), false);
});

test("the shared .app-button/.app-button-danger/a.app-button rules in app/globals.css carry the approved System 3 semantics -- ghost ordinary, outlined destructive, link-style navigation, all at the approved 16px", () => {
  const cssSource = readFileSync(fileURLToPath(new URL("../../globals.css", import.meta.url)), "utf8");
  const baseButtonBlock = cssSource.slice(
    cssSource.indexOf(".app-button,\nbutton.app-button {"),
    cssSource.indexOf("a.app-button {"),
  );
  assert.match(baseButtonBlock, /background: transparent;/);
  assert.match(baseButtonBlock, /font-size: 16px;/);

  const navLinkBlock = cssSource.slice(cssSource.indexOf("a.app-button {"), cssSource.indexOf(".app-button:focus-visible"));
  assert.match(navLinkBlock, /text-decoration: underline;/);

  const dangerBlock = cssSource.slice(cssSource.indexOf(".app-button-danger,"), cssSource.indexOf(".app-button-muted,"));
  assert.match(dangerBlock, /background: transparent;/);

  const stopComment = cssSource.slice(cssSource.indexOf("Destructive confirmation"), cssSource.indexOf(".app-button-stop,"));
  assert.match(stopComment, /ConfirmDialog/);
});

test("the Button Hierarchy section is now approved/canonical (Part A) while Table Row Actions layout remains undecided (Part B)", () => {
  const html = renderToStaticMarkup(<AdminUiReferenceContent />);

  assert.ok(html.includes("Button Hierarchy (✅ Approved) &amp; Table Row Actions (still undecided)"));
  assert.ok(html.includes("Part A: Button Hierarchy -- ✅ Approved (System 3)"));
  assert.ok(html.includes("Part B: Table Row Actions -- layout still undecided"));
  assert.ok(html.includes("Legacy (pre-2026-08-19) -- historical"));
  assert.ok(html.includes("Considered alternative (not adopted) -- Minimal Adjustment"));
  assert.ok(html.includes("✅ Approved / Canonical -- System 3 (Restructured Hierarchy)"));
});

test("the approved System 3 example uses the real AppButton/AppLinkButton with no prototype className override -- Legacy and the considered alternative still use the reference-only legacy classes", () => {
  const sectionSource = source.slice(
    source.indexOf('id="action-hierarchy"'),
    source.indexOf("</RefSection>\n    </div>\n  );\n}"),
  );
  const legacy = sectionSource.slice(
    sectionSource.indexOf("Legacy (pre-2026-08-19)"),
    sectionSource.indexOf("Considered alternative"),
  );
  const considered = sectionSource.slice(
    sectionSource.indexOf("Considered alternative"),
    sectionSource.indexOf("Approved / Canonical"),
  );
  const approved = sectionSource.slice(
    sectionSource.indexOf("Approved / Canonical"),
    sectionSource.indexOf("Should green mean status only?"),
  );

  assert.match(legacy, /className="ui-ref-legacy-ordinary"/);
  assert.match(legacy, /className="ui-ref-legacy-danger"/);
  assert.match(considered, /className="ui-ref-legacy-ordinary"/);
  assert.match(considered, /className="ui-ref-legacy-danger"/);

  assert.equal(/ui-ref-legacy|ui-ref-btn/.test(approved), false);
  assert.match(approved, /<AppButton>Edit<\/AppButton>/);
  assert.match(approved, /<AppButton variant="danger" onClick=\{\(\) => setSystem3ConfirmOpen\(true\)\}>/);
  assert.match(approved, /<AppLinkButton href="#tables">View in Parking →<\/AppLinkButton>/);
  assert.match(approved, /<ConfirmDialog\s/);
  assert.match(approved, /danger$/m);
});

test("the green-for-status exhibit compares a success-variant action button against a primary-variant one, both next to the identical success StatusBadge", () => {
  const sectionSource = source.slice(
    source.indexOf("Should green mean status only?"),
    source.indexOf("Part B: Table Row Actions"),
  );
  assert.match(sectionSource, /<AppButton variant="success">Complete<\/AppButton>/);
  assert.match(sectionSource, /<AppButton variant="primary">Complete<\/AppButton>/);
  const badgeCount = (sectionSource.match(/<StatusBadge tone="success">Complete<\/StatusBadge>/g) || []).length;
  assert.equal(badgeCount, 2);
});

test("Table Row Actions Treatment 2 reuses the real Section 6 DesktopPointerCandidate component directly, not a copy", () => {
  const partB = source.slice(
    source.indexOf("Part B: Table Row Actions"),
    source.indexOf("Still undecided:"),
  );
  assert.match(partB, /<DesktopPointerCandidate records=\{SAMPLE_RECORDS\} \/>/);
});

test("Treatments 1 and 3 and the operational handoff example use the real, unmodified AppButton/AppLinkButton (no ui-ref-btn-* prototype class remains anywhere in the file)", () => {
  assert.equal(/ui-ref-btn-ghost|ui-ref-btn-outline-danger|ui-ref-btn-navlink/.test(source), false);

  const treatment1Fn = source.slice(
    source.indexOf("function RowActionsTreatmentProminent("),
    source.indexOf("function RowActionsTreatmentDisclosure("),
  );
  const treatment3Fn = source.slice(
    source.indexOf("function RowActionsTreatmentDisclosure("),
    source.indexOf("function OperationalHandoffExample("),
  );
  const handoffFn = source.slice(source.indexOf("function OperationalHandoffExample("), source.length);

  assert.match(treatment1Fn, /<AppButton aria-label=\{`Edit \$\{r\.name\}`\}>Edit<\/AppButton>/);
  assert.match(treatment1Fn, /<AppButton variant="danger" aria-label=\{`Cancel \$\{r\.name\}'s request`\}>/);
  assert.match(handoffFn, /<AppButton aria-label=\{`Edit \$\{record\.name\}`\}>Edit<\/AppButton>/);

  for (const fn of [treatment1Fn, treatment3Fn, handoffFn]) {
    assert.match(fn, /aria-label=\{`(Contact|Edit|Cancel|View)/);
  }
});

test("Table Row Actions Treatment 3 uses the same native <details>/<summary> disclosure pattern as Section 6 -- no hover-only or gesture-only control anywhere in the new section", () => {
  const treatment3Fn = source.slice(
    source.indexOf("function RowActionsTreatmentDisclosure("),
    source.indexOf("function OperationalHandoffExample("),
  );
  assert.match(treatment3Fn, /<details className="ui-ref-touch-more">/);
  assert.match(treatment3Fn, /<summary className="table-toolbar-disclosure-summary">More actions<\/summary>/);

  const sectionSource = source.slice(
    source.indexOf('id="action-hierarchy"'),
    source.indexOf("</RefSection>\n    </div>\n  );\n}"),
  );
  assert.equal(/onTouchStart|onTouchEnd|onSwipe|:hover(?!\s*\{)/.test(sectionSource), false);
});

test("Table Row Actions layout (Treatments 1/2/3) is explicitly flagged as still undecided", () => {
  const sectionSource = source.slice(
    source.indexOf('id="action-hierarchy"'),
    source.indexOf("</RefSection>\n    </div>\n  );\n}"),
  );
  assert.match(sectionSource, /Still undecided:/);
  assert.match(sectionSource, /which of Treatments 1-3 becomes the canonical table-row action layout/);
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
