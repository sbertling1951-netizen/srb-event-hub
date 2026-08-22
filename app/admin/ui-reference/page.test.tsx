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
    '"@/components/ui/InlineEdit"',
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

  // 19px/25px (approved) and 18px/24px (legacy) replace the old flat
  // 22px/23px pair (Central UI Standard, Stage 2): --font-size-page-title
  // and .shell-page-title's own clamp were merged into one token, so the
  // page-title row now shows only the clamp's bounds, not a separate
  // static value.
  for (const value of ["18px", "24px", "19px", "25px", "20px", "21px", "14px", "15px", "42px", "45px"]) {
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

  // Central UI Standard, Stage 2: --font-size-page-title is now the
  // clamp() .shell-page-title itself consumes, not a static 23px value
  // nothing referenced.
  assert.match(rootBlock, /--font-size-page-title: clamp\(19px, 2\.3vw, 25px\);/);
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

test("the Button Depth / Tactile Treatment section exists with a Canonical Flat vs. Modern 3D Candidate side-by-side, and is explicitly not approved", () => {
  const html = renderToStaticMarkup(<AdminUiReferenceContent />);

  assert.ok(html.includes("Button Depth / Tactile Treatment (prototype)"));
  assert.ok(html.includes("Canonical Flat (System 3)"));
  assert.ok(html.includes("Modern 3D Candidate"));

  const sectionSource = source.slice(source.indexOf('id="depth"'), source.indexOf("function depthClassName("));
  assert.match(sectionSource, /Not approved -- this is\s*\n?\s*exploration, not a decision\./);
});

test("only the 3D column applies the reference-only depth classes -- the flat column renders the real variant classes with no ui-ref-3d modifier", () => {
  const html = renderToStaticMarkup(<AdminUiReferenceContent />);
  const depthSection = html.slice(html.indexOf('id="depth"'), html.length);
  const flatStart = depthSection.indexOf("Canonical Flat (System 3)");
  const threeDStart = depthSection.indexOf("Modern 3D Candidate");
  const flatHtml = depthSection.slice(flatStart, threeDStart);
  const threeDHtml = depthSection.slice(threeDStart, depthSection.indexOf("Try it: flip one repeated action group"));

  assert.equal(/ui-ref-3d/.test(flatHtml), false);
  assert.match(flatHtml, /class="app-button app-button-primary"/);

  assert.match(threeDHtml, /class="app-button app-button-primary ui-ref-3d ui-ref-3d-primary"/);
  assert.match(threeDHtml, /class="app-button ui-ref-3d ui-ref-3d-ordinary"/);
  assert.match(threeDHtml, /class="app-button app-button-danger ui-ref-3d ui-ref-3d-danger"/);
});

test("navigation/handoff (View in Parking) never receives a depth class, in either treatment -- it stays a link, not a tactile button", () => {
  const html = renderToStaticMarkup(<AdminUiReferenceContent />);
  const depthSection = html.slice(
    html.indexOf('id="depth"'),
    html.indexOf("Try it: flip one repeated action group"),
  );

  const navLinkMatches = [...depthSection.matchAll(/<a class="([^"]*)" href="#tables">View in Parking/g)];
  assert.ok(navLinkMatches.length >= 2, "expected View in Parking to appear in both the flat and 3D columns");
  for (const match of navLinkMatches) {
    assert.equal(match[1], "app-button");
  }
});

test("the destructive-confirmation exhibit uses variant=\"stop\" (the solid fill) in both columns, and the flat column wires the real, unmodified ConfirmDialog -- the 3D column only shows a static equivalent", () => {
  const sectionSource = source.slice(source.indexOf('id="depth"'), source.indexOf("function depthClassName("));

  assert.match(sectionSource, /<DepthStopExample depth="flat" \/>/);
  assert.match(sectionSource, /<DepthStopExample depth="3d" \/>/);
  assert.match(sectionSource, /ConfirmDialog itself is untouched; this is what its/);

  const confirmDialogUses = (sectionSource.match(/<ConfirmDialog\s/g) || []).length;
  assert.equal(confirmDialogUses, 1, "expected exactly one real ConfirmDialog instance in Section 16 (the flat column's)");

  const stopFn = source.slice(source.indexOf("function DepthStopExample("), source.indexOf("function DepthTableRowActions("));
  assert.match(stopFn, /variant="stop"/);
});

test("the depth prototype CSS gates hover elevation to real pointer devices, uses :active for press feedback on both mouse and touch, respects prefers-reduced-motion, and flattens fully when disabled", () => {
  const cssSource = readFileSync(fileURLToPath(new URL("../../globals.css", import.meta.url)), "utf8");
  const depthBlock = cssSource.slice(
    cssSource.indexOf("Button Depth / Tactile Treatment prototype"),
    cssSource.length,
  );

  assert.match(depthBlock, /@media \(hover: hover\) and \(pointer: fine\) \{/);
  assert.match(depthBlock, /:active:not\(:disabled\)/);
  assert.match(depthBlock, /@media \(prefers-reduced-motion: reduce\) \{/);
  assert.match(depthBlock, /\.app-button-primary\.ui-ref-3d-primary:disabled,/);
  assert.match(depthBlock, /box-shadow: none;\s*\n\s*transform: none;/);
  // Colored tints reuse the exact rgba() values already used elsewhere in
  // this file (.app-button-primary/.app-button-stop), not new colors.
  assert.match(depthBlock, /rgba\(59, 130, 246,/);
  assert.match(depthBlock, /rgba\(220, 38, 38,/);
});

test("components/ui/AppButton.tsx and components/ui/ConfirmDialog.tsx contain no reference-only classes -- the canonical shared primitives are untouched by this prototype", () => {
  const appButtonSource = readFileSync(
    fileURLToPath(new URL("../../../components/ui/AppButton.tsx", import.meta.url)),
    "utf8",
  );
  const confirmDialogSource = readFileSync(
    fileURLToPath(new URL("../../../components/ui/ConfirmDialog.tsx", import.meta.url)),
    "utf8",
  );
  assert.equal(/ui-ref-3d|ui-ref-legacy|ui-ref-scale/.test(appButtonSource), false);
  assert.equal(/ui-ref-3d|ui-ref-legacy|ui-ref-scale/.test(confirmDialogSource), false);
});

test("the local Canonical/3D toggle re-renders the real, full sample roster (including Casey) at whichever depth is selected, and is never persisted", () => {
  const sectionSource = source.slice(source.indexOf('id="depth"'), source.indexOf("function depthClassName("));
  assert.match(sectionSource, /<DepthTableRowActions depth=\{depthToggle\} records=\{SAMPLE_RECORDS\} \/>/);
  assert.equal(/localStorage/.test(sectionSource), false);

  const html = renderToStaticMarkup(<AdminUiReferenceContent />);
  assert.ok(html.includes("Casey Whitfield-Alvarenga-Thornbury"));
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
    // "secondary"/"tertiary" are the Central UI Standard, Stage 2 canonical
    // hierarchy additions -- real AppButton.tsx variants, not page-local
    // inventions.
    assert.ok(
      [
        "default",
        "primary",
        "secondary",
        "tertiary",
        "success",
        "danger",
        "warning",
        "muted",
        "start",
        "stop",
      ].includes(variant),
    );
  }
});

// Section 18: Map Marker Standard -- uses the REAL shared marker
// primitives/sizing functions, not a second reference-only marker
// implementation. See components/map/canvas/markerSizing.ts and
// markerVisuals.tsx.

function sectionSource(id: string): string {
  const start = source.indexOf(`id="${id}"`);
  assert.ok(start >= 0, `expected to find a RefSection with id="${id}"`);
  const nextSection = source.indexOf('RefSection', source.indexOf('</RefSection>', start));
  return source.slice(start, nextSection > 0 ? nextSection : source.length);
}

test("the Map Marker Standard section renders as a real heading", () => {
  const html = renderToStaticMarkup(<AdminUiReferenceContent />);
  assert.ok(html.includes("Map Marker Standard"));
});

test("the Map Marker Standard section imports the real shared marker primitives/sizing functions, not a page-local reimplementation", () => {
  for (const name of [
    "computeNearestNeighborSpacingPx",
    "MARKER_MIN_HIT_AREA_PX",
    "MarkerDot",
    "MarkerLabelChip",
    "resolveDensityAwareMarkerSize",
  ]) {
    assert.ok(source.includes(name), `expected an import/use of ${name}`);
  }
  assert.match(source, /from "@\/components\/map\/canvas"/);
});

test("the Map Marker Standard section contains no hand-rolled marker dot/label styling -- it only composes the real MarkerDot/MarkerLabelChip components", () => {
  const section = sectionSource("map-markers");
  assert.match(section, /<MarkerDot/);
  assert.match(section, /<MarkerLabelChip/);
  // A hand-rolled marker dot would need its own 50% border-radius circle;
  // none should exist in this section's own JSX (MarkerDot owns that).
  assert.equal(/borderRadius:\s*"50%"/.test(section), false);
});

test("all five canonical StatusBadgeTone values plus the color escape hatch are demonstrated as real MarkerDot tones", () => {
  const section = sectionSource("map-markers");
  for (const tone of ["neutral", "info", "warning", "danger", "success"]) {
    assert.ok(section.includes(tone), `expected tone ${tone} to be demonstrated`);
  }
  assert.match(section, /color="gold"/);
  assert.match(section, /escape hatch/i);
});

test("the three density demos resolve three genuinely different sizes via the real function, not hardcoded values -- dense clamps to the floor and sparse clamps to the ceiling", () => {
  const html = renderToStaticMarkup(<AdminUiReferenceContent />);
  const resolvedSizes = [...html.matchAll(/Resolved size: <strong>([\d.]+)px<\/strong>/g)].map((m) =>
    Number(m[1]),
  );
  assert.equal(resolvedSizes.length, 3, "expected exactly 3 density demo cards");
  const [dense, medium, sparse] = resolvedSizes;
  assert.ok(dense < medium, "dense must resolve smaller than medium");
  assert.ok(medium < sparse, "medium must resolve smaller than sparse");
  assert.equal(dense, 8, "dense synthetic spacing must clamp to the real legibility floor");
  assert.equal(sparse, 22, "sparse synthetic spacing must clamp to the real readability ceiling");
});

test("the section documents visual geometry and interaction geometry as two separate contracts", () => {
  const section = sectionSource("map-markers");
  assert.match(section, /Visual geometry/);
  assert.match(section, /Interaction geometry/);
  assert.match(section, /MARKER_MIN_HIT_AREA_PX/);
});

test("canonical adoption names Parking and both Locations pages as migrated, and explicitly excludes Coach Map and Master Maps", () => {
  const section = sectionSource("map-markers");
  assert.match(section, /Parking/);
  assert.match(section, /Admin Locations/);
  assert.match(section, /public Locations/);
  assert.match(section, /Coach Map/);
  assert.match(section, /Master Maps/);
  assert.match(section, /not migrated yet|deliberately not migrated/);
});

// Section 19: Inline Edit -- uses the REAL shared InlineEdit primitive
// (components/ui/InlineEdit.tsx), not a page-local reimplementation.

test("the Inline Edit section renders as a real heading, explicitly labeled a pending-review prototype", () => {
  const html = renderToStaticMarkup(<AdminUiReferenceContent />);
  assert.ok(html.includes("Inline Edit (prototype -- pending review)"));
});

test("the Inline Edit section states the use/don't-use guidance and documents every interaction path", () => {
  const html = renderToStaticMarkup(<AdminUiReferenceContent />);
  assert.ok(html.includes("Use InlineEdit for:"));
  assert.ok(html.includes("Use a Dialog/form for:"));
  assert.ok(html.includes("Tap/click the value"));
  assert.ok(html.includes("Enter, or the visible Save button"));
  assert.ok(html.includes("Escape, or the visible Cancel button"));
  assert.ok(html.includes("no implicit save, ever"));
});

test("the section demonstrates all five required cases -- basic edit, async save, validation, async failure, and disabled -- via the real InlineEdit component", () => {
  const section = sectionSource("inline-edit");
  const inlineEditUses = (section.match(/<InlineEdit\b/g) || []).length;
  assert.equal(inlineEditUses, 5, `expected exactly 5 InlineEdit instances, found ${inlineEditUses}`);

  assert.match(section, /label="Category name"/);
  assert.match(section, /label="Department label"/);
  assert.match(section, /label="Meal category"/);
  assert.match(section, /label="Storage room label"/);
  assert.match(section, /label="Locked category name"/);

  const html = renderToStaticMarkup(<AdminUiReferenceContent />);
  for (const value of ["Groceries", "Vendor Services", "Breakfast", "Storage Room", "Archived Events"]) {
    assert.ok(html.includes(value), `expected the rendered output to include "${value}"`);
  }
});

test("the validation example wires a real, non-empty-only validate function -- not a hard-coded category-specific rule inside InlineEdit itself", () => {
  const section = sectionSource("inline-edit");
  assert.match(
    section,
    /validate=\{\(draft\) => \(draft\.trim\(\) \? undefined : "This field can't be empty\."\)\}/,
  );
  assert.equal(/"Groceries"|"Breakfast"/.test(readFileSync(
    fileURLToPath(new URL("../../../components/ui/InlineEdit.tsx", import.meta.url)),
    "utf8",
  )), false);
});

test("the async examples call real async onSave functions -- one resolves after a delay, the other always rejects to demonstrate the failure/retry path", () => {
  assert.match(source, /async function saveDepartmentLabelAsync\(next: string\) \{/);
  assert.match(source, /async function saveStorageLabelAlwaysFails\(\): Promise<void> \{/);
  assert.match(source, /throw new Error\("Network error -- please try again\."\);/);
});

test("the disabled example passes disabled to the real InlineEdit component", () => {
  const section = sectionSource("inline-edit");
  assert.match(section, /<InlineEdit label="Locked category name" value="Archived Events" onSave=\{\(\) => \{\}\} disabled \/>/);
});

test("Nearby has not been adopted onto InlineEdit by this workstream -- the primitive stays reference-only until a separately authorized migration", () => {
  const nearbySource = readFileSync(
    fileURLToPath(new URL("../nearby/page.tsx", import.meta.url)),
    "utf8",
  );
  assert.equal(/InlineEdit/.test(nearbySource), false);
  assert.match(nearbySource, /Grocer(y|ies)/);
});
