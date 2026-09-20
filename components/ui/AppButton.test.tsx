import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { AppButton, AppLinkButton } from "@/components/ui/AppButton";
import { buildTenantBrandOverrides } from "@/lib/tenantBrandOverrides";

// Focused tests for the shared AppButton/AppLinkButton primitive and its
// canonical action semantics (System 3, approved 2026-08-19 -- see
// /admin/ui-reference Section 15). These check the className contract
// only (renderToStaticMarkup can't evaluate computed CSS); the actual
// visual treatment lives in app/globals.css's STANDARD APP BUTTON SYSTEM
// block, exercised manually via the reference page.
// Run with: npx tsx --test components/ui/AppButton.test.tsx

test("the default (unset) variant applies no app-button-* modifier class -- this IS the Tertiary/quiet ghost treatment, not a separate opt-in", () => {
  const html = renderToStaticMarkup(<AppButton>Edit</AppButton>);
  assert.match(html, /class="app-button"/);
  assert.equal(/app-button-\w+/.test(html), false);
});

test("variant=\"tertiary\" renders identically to the unset default -- both are the same ghost treatment, just one is explicit", () => {
  const html = renderToStaticMarkup(<AppButton variant="tertiary">Edit</AppButton>);
  assert.match(html, /class="app-button"/);
  assert.equal(/app-button-\w+/.test(html), false);
});

test("variant=\"secondary\" and its transitional alias variant=\"muted\" apply their own exact (and equal-weight) modifier class", () => {
  const secondary = renderToStaticMarkup(<AppButton variant="secondary">Cancel</AppButton>);
  assert.match(secondary, /class="app-button app-button-secondary"/);
  const muted = renderToStaticMarkup(<AppButton variant="muted">Cancel</AppButton>);
  assert.match(muted, /class="app-button app-button-muted"/);
});

test("every canonical/transitional variant applies its exact modifier class", () => {
  for (const variant of [
    "primary",
    "secondary",
    "danger",
    "stop",
    "success",
    "warning",
    "muted",
    "start",
  ] as const) {
    const html = renderToStaticMarkup(<AppButton variant={variant}>Go</AppButton>);
    assert.match(html, new RegExp(`class="app-button app-button-${variant}"`));
  }
});

test("loading renders a spinner, sets aria-busy, and forces disabled even when disabled was not passed", () => {
  const html = renderToStaticMarkup(<AppButton loading>Save</AppButton>);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /class="app-button-spinner"/);
});

test("loading combined with an explicit disabled=false still disables the button -- loading always wins", () => {
  const html = renderToStaticMarkup(
    <AppButton loading disabled={false}>
      Save
    </AppButton>,
  );
  assert.match(html, /disabled=""/);
});

test("a non-loading button has no aria-busy attribute at all, not aria-busy=\"false\"", () => {
  const html = renderToStaticMarkup(<AppButton>Save</AppButton>);
  assert.equal(/aria-busy/.test(html), false);
});

test("AppButton defaults to type=\"button\" -- never submits a form by accident", () => {
  const html = renderToStaticMarkup(<AppButton>Save</AppButton>);
  assert.match(html, /type="button"/);
});

test("disabled state passes straight through to the native button", () => {
  const html = renderToStaticMarkup(<AppButton disabled>Save</AppButton>);
  assert.match(html, /disabled=""/);
});

test("AppLinkButton with no variant renders a plain <a class=\"app-button\"> -- the navigation/handoff treatment is carried entirely by the a.app-button CSS rule, not a separate component prop", () => {
  const html = renderToStaticMarkup(<AppLinkButton href="/admin/parking">View in Parking</AppLinkButton>);
  assert.match(html, /<a class="app-button" href="\/admin\/parking">View in Parking<\/a>/);
});

test("AppLinkButton still accepts an explicit variant (e.g. a primary-styled link) as an escape hatch from the default nav-link treatment", () => {
  const html = renderToStaticMarkup(
    <AppLinkButton href="/admin/parking" variant="primary">
      View in Parking
    </AppLinkButton>,
  );
  assert.match(html, /class="app-button app-button-primary"/);
});

// ---------------------------------------------------------------------------
// Text-link leak repair (app/globals.css). The navigation/handoff rule pair
//
//   a.app-button                        (rest)
//   a.app-button:hover:not(:disabled)   (hover)
//
// is documented to apply only to an AppLinkButton with NO variant -- "an
// explicit variant still renders that variant's real button chrome." Both
// selectors were plain `a.app-button...`, so they matched every anchor.
// Each variant rule re-declares border-color/background/background-image/
// color and won those by source order, but NO variant rule declares
// padding-left/padding-right or text-decoration, and at (0,3,1) the hover
// rule outranked every a.app-button-*:hover (0,2,1) -- so variant-bearing
// link buttons silently rendered with 6px horizontal padding, an underline,
// and the wrong hover. Both selectors now exclude the eight
// modifier-emitting variants via :not(:where(...)).
//
// IMPORTANT -- what these assertions do and do not prove: they verify the
// CSS SOURCE (selector text) and the component's CLASS output. They do NOT
// evaluate the cascade or computed styles: node:test has no layout engine,
// and renderToStaticMarkup cannot resolve CSS at all. Rendered and
// cross-browser behavior -- including :where() support on the project's
// target engines -- remains verifiable only in a real browser.
// ---------------------------------------------------------------------------

const GLOBALS_CSS = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

/** globals.css with /* ... *\/ comments removed. Needed because the repair's
 *  own explanatory comment names the `[class*="app-button-"]` selector it
 *  deliberately avoids, which would otherwise satisfy a search for it. */
const GLOBALS_CSS_CODE = GLOBALS_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** The eight variants whose `variant` prop emits an app-button-* modifier
 *  class (ButtonVariant minus GHOST_VARIANTS). */
const MODIFIER_VARIANTS = [
  "primary",
  "secondary",
  "muted",
  "danger",
  "stop",
  "success",
  "warning",
  "start",
] as const;

/** Layout/utility classes that also begin with "app-button-" but are NOT
 *  visual variants -- the reason the exclusion list is an explicit list
 *  rather than a [class*="app-button-"] substring match. */
const NON_VARIANT_UTILITIES = [
  "app-button-row",
  "app-button-grid-2",
  "app-button-grid-3",
  "app-button-full",
  "app-button-spinner",
] as const;

/** Replace every CSS comment with the same number of spaces, so offsets stay
 *  aligned while commented-out text -- whether a whole rule or a single
 *  declaration inside a rule body -- can never be matched or returned. */
function blankCssComments(cssSource: string): string {
  return cssSource.replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length));
}

const GLOBALS_CSS_BLANKED = blankCssComments(GLOBALS_CSS);

/** Whitespace-insensitive form of a selector list. */
function normalizeSelectorList(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Source of the ONE top-level rule in globals.css whose COMPLETE selector list
 * equals `selectorList`, from its first selector through its own closing brace.
 *
 * Deliberately not a prefix/substring search: a prefix could return a rule that
 * merely starts the same way, silently pick one of two rules sharing a prefix
 * (the nav-link rest and :hover rules do), read a commented-out rule body, or
 * -- for an unterminated rule -- adopt a LATER rule's declarations and closing
 * brace. Fails explicitly when the rule is missing, ambiguous, unterminated, or
 * has another `{` opening before its own `}`. (app/admin/ui-reference/
 * page.test.tsx carries the boundary-safety regression cases for this shape.)
 */
function cssRule(selectorList: string, cssSource?: string): string {
  const scan = cssSource === undefined ? GLOBALS_CSS_BLANKED : blankCssComments(cssSource);
  const wanted = normalizeSelectorList(selectorList);
  assert.notEqual(wanted, "", "cssRule() needs a non-empty selector list");

  const found: string[] = [];
  for (let brace = scan.indexOf("{"); brace !== -1; brace = scan.indexOf("{", brace + 1)) {
    const previousBlockEnd = Math.max(scan.lastIndexOf("}", brace), scan.lastIndexOf("{", brace - 1));
    const selectorRegion = scan.slice(previousBlockEnd + 1, brace);
    if (normalizeSelectorList(selectorRegion) !== wanted) {
      continue;
    }

    const close = scan.indexOf("}", brace + 1);
    const nextOpen = scan.indexOf("{", brace + 1);
    assert.notEqual(close, -1, `globals.css: rule "${wanted}" is never closed`);
    assert.ok(
      nextOpen === -1 || nextOpen > close,
      `globals.css: rule "${wanted}" is malformed -- another "{" opens before its own "}"`,
    );
    // Blanking preserves offsets, so the leading-whitespace run measured on the
    // blanked text skips any preceding comment. The slice is taken from the
    // BLANKED text too: a comment inside the rule body would otherwise come
    // back verbatim, letting a commented-out declaration satisfy a style
    // assertion about a real one.
    const leadingBlank = selectorRegion.length - selectorRegion.replace(/^\s+/, "").length;
    found.push(scan.slice(previousBlockEnd + 1 + leadingBlank, close + 1));
  }

  assert.equal(
    found.length,
    1,
    `globals.css: expected exactly one rule with selector list "${wanted}", found ${found.length}`,
  );
  return found[0];
}

// Complete selector lists. The rest and :hover rules share a prefix, so each
// must be addressed by its full selector list, never by that shared prefix.
const NAV_LINK_REST =
  "a.app-button:not( :where( .app-button-primary, .app-button-secondary," +
  " .app-button-muted, .app-button-danger, .app-button-stop," +
  " .app-button-success, .app-button-warning, .app-button-start ) )";
const NAV_LINK_HOVER = `${NAV_LINK_REST}:hover:not(:disabled)`;
const BASE_BUTTON_SELECTOR = ".app-button, button.app-button";
/** Each modifier variant's own rest rule. secondary/muted share one rule. */
const VARIANT_RULE_SELECTOR: Record<(typeof MODIFIER_VARIANTS)[number], string> = {
  primary: ".app-button-primary, button.app-button-primary, a.app-button-primary",
  secondary:
    ".app-button-secondary, .app-button-muted, button.app-button-secondary," +
    " button.app-button-muted, a.app-button-secondary, a.app-button-muted",
  muted:
    ".app-button-secondary, .app-button-muted, button.app-button-secondary," +
    " button.app-button-muted, a.app-button-secondary, a.app-button-muted",
  danger: ".app-button-danger, button.app-button-danger, a.app-button-danger",
  stop: ".app-button-stop, button.app-button-stop, a.app-button-stop",
  success: ".app-button-success, button.app-button-success, a.app-button-success",
  warning: ".app-button-warning, button.app-button-warning, a.app-button-warning",
  start: ".app-button-start, button.app-button-start, a.app-button-start",
};

test("cssRule does not let a commented-out declaration INSIDE a rule body satisfy a style assertion", () => {
  const css = [
    ".target {",
    "  /* .historical { background: transparent; } */",
    "  background: red;",
    "}",
    "",
  ].join("\n");

  // Exercises this file's own cssRule directly. The full boundary-safety
  // suite lives in app/admin/ui-reference/page.test.tsx.
  const rule = cssRule(".target", css);

  assert.match(rule, /background: red;/);
  assert.doesNotMatch(rule, /background: transparent/);
  assert.doesNotMatch(rule, /\.historical/);
});

test("the text-link rest rule is narrowed to no-variant anchors and still carries the full link treatment", () => {
  const rule = cssRule(NAV_LINK_REST);
  // Excludes all eight modifier-emitting variants...
  for (const variant of MODIFIER_VARIANTS) {
    assert.match(
      rule,
      new RegExp(`\\.app-button-${variant}\\b`),
      `the rest rule must exclude .app-button-${variant}`,
    );
  }
  // ...via :not(:where(...)), which contributes zero specificity, so the
  // selector stays exactly (0,1,1) as before the repair.
  assert.match(rule, /a\.app-button:not\(\s*:where\(/);
  // Declaration body unchanged -- this is still the link treatment.
  assert.match(rule, /padding-left: var\(--space-2\);/);
  assert.match(rule, /padding-right: var\(--space-2\);/);
  assert.match(rule, /text-decoration: underline;/);
  assert.match(rule, /background: transparent;/);
  assert.match(rule, /color: var\(--color-action-primary-active\) !important;/);
});

test("the text-link hover rule is narrowed with the same exclusion list and keeps its :not(:disabled) specificity guard", () => {
  const rule = cssRule(NAV_LINK_HOVER);
  for (const variant of MODIFIER_VARIANTS) {
    assert.match(rule, new RegExp(`\\.app-button-${variant}\\b`));
  }
  // :not(:disabled) is what keeps this at (0,3,1) over the base ghost hover.
  assert.match(rule, /:hover:not\(:disabled\)/);
  assert.match(rule, /background: var\(--color-action-secondary-hover\);/);
  assert.match(rule, /border-color: transparent;/);
});

test("neither narrowed selector excludes a non-variant app-button-* layout utility -- an explicit list, not a substring match", () => {
  const rest = cssRule(NAV_LINK_REST);
  for (const utility of NON_VARIANT_UTILITIES) {
    assert.doesNotMatch(
      rest,
      new RegExp(`\\.${utility}\\b`),
      `${utility} is a layout utility, not a visual variant -- it must not be excluded`,
    );
  }
  // And no substring selector was introduced anywhere for this purpose.
  // Checked against the comment-stripped source: the repair's own comment
  // names this selector to explain why it is NOT used.
  assert.doesNotMatch(GLOBALS_CSS_CODE, /\[class\*="app-button-"\]/);
});

test("no unnarrowed `a.app-button` rest or hover rule remains, so the leak cannot reappear", () => {
  // The old, leaking selectors were exactly these two lines.
  assert.doesNotMatch(GLOBALS_CSS, /^a\.app-button \{$/m);
  assert.doesNotMatch(GLOBALS_CSS, /^a\.app-button:hover:not\(:disabled\) \{$/m);
  // The focus rule is deliberately NOT narrowed -- every anchor, variant or
  // not, keeps the shared focus ring.
  assert.match(GLOBALS_CSS, /a\.app-button:focus-visible/);
});

test("no variant rule needs to re-declare horizontal padding or text-decoration -- variant anchors inherit them from the base rule, so no value is duplicated", () => {
  for (const variant of MODIFIER_VARIANTS) {
    // Addressed by the variant rule's complete selector list: the bare class
    // name also occurs inside the narrowed rules' :where() exclusion list, and
    // a prefix match could resolve there instead of to the real rule.
    const rule = cssRule(VARIANT_RULE_SELECTOR[variant]);
    assert.doesNotMatch(rule, /padding-left|padding-right/);
    assert.doesNotMatch(rule, /text-decoration/);
  }
  // The base rule is the single source of the button padding the excluded
  // variants now fall through to.
  assert.match(cssRule(BASE_BUTTON_SELECTOR), /padding: var\(--space-4\) 18px;/);
});

test("the base button rule lets an over-long label word break, so a narrow or enlarged container wraps it instead of clipping it", () => {
  // `anywhere`, not `break-word`: only `anywhere` participates in min-content
  // intrinsic sizing, so a button that is a flex item can shrink to its
  // container. Verified in-browser at 320px/200% zoom, where `break-word` left
  // the Vendor Access action overflowing its card and `anywhere` did not.
  // This is a source assertion; rendered behavior is a browser gate.
  assert.match(cssRule(BASE_BUTTON_SELECTOR), /overflow-wrap: anywhere;/);
});

test("class output is unchanged by the CSS repair: each of the eight modifier variants still emits its exact class on BOTH AppButton and AppLinkButton", () => {
  for (const variant of MODIFIER_VARIANTS) {
    const button = renderToStaticMarkup(<AppButton variant={variant}>Go</AppButton>);
    assert.match(button, new RegExp(`class="app-button app-button-${variant}"`));

    const link = renderToStaticMarkup(
      <AppLinkButton href="/x" variant={variant}>
        Go
      </AppLinkButton>,
    );
    assert.match(link, new RegExp(`class="app-button app-button-${variant}"`));
  }
});

test("no-variant and ghost AppLinkButtons still emit a bare app-button class, so they remain matched by the narrowed text-link rule", () => {
  for (const props of [{}, { variant: "default" as const }, { variant: "tertiary" as const }]) {
    const html = renderToStaticMarkup(
      <AppLinkButton href="/x" {...props}>
        View in Parking
      </AppLinkButton>,
    );
    assert.match(html, /class="app-button"/);
    assert.equal(/app-button-\w/.test(html), false);
  }
});

test("a caller-supplied layout utility does not turn a no-variant link into a variant -- app-button-full keeps the link treatment", () => {
  const html = renderToStaticMarkup(
    <AppLinkButton href="/x" className="app-button-full">
      View in Parking
    </AppLinkButton>,
  );
  assert.match(html, /class="app-button app-button-full"/);
  // It carries no variant class, so the narrowed rule still matches it --
  // which is why the exclusion list must not be a substring match.
  assert.equal(/app-button-(primary|secondary|muted|danger|stop|success|warning|start)/.test(html), false);
});

// ---------------------------------------------------------------------------
// Primary-action contrast ramp (approved 2026-09-19). The enabled primary fill
// must clear WCAG 2.x SC 1.4.3's normal-text 4.5:1 against its fixed white
// label in every enabled state. `.app-button` labels are 16px at
// --font-weight-semibold (700): bold, but under 18.66px, so "normal" text, not
// "large". Focus adds only an outline and never repaints the fill, so a
// focused control shows whichever of the three fills below is current.
//
// Rest stays tenant-brandable through --tenant-brand-primary; hover and active
// stay platform-fixed literals (see the Tier 2 bridge comment in globals.css
// and contract §6). Values are read out of globals.css rather than restated
// here, so these cannot drift from the stylesheet or pass against a value the
// CSS does not actually declare. Focus-ring contrast is a separate open issue
// and is deliberately not asserted here.
// ---------------------------------------------------------------------------

const ROOT_RULE = cssRule(":root");

/**
 * The single declared value of `property` within one already-extracted rule.
 * Fails when the declaration is missing or repeated. cssRule() has already
 * blanked comments, so a commented-out declaration can never satisfy this, and
 * the trailing `[;}]` keeps the last declaration in a block readable without
 * swallowing the rest of the rule.
 */
function declaredValue(ruleSource: string, property: string): string {
  // The terminator is matched by lookahead, not consumed: consuming it would
  // eat the separator a following duplicate declaration needs to be found,
  // silently turning a repeated (ambiguous) declaration into a single hit.
  const pattern = new RegExp(`(?:^|[;{])\\s*${property}\\s*:\\s*([^;}]+)(?=[;}])`, "g");
  const values = [...ruleSource.matchAll(pattern)].map((match) => match[1].trim());
  assert.equal(
    values.length,
    1,
    `expected exactly one "${property}" declaration, found ${values.length}`,
  );
  return values[0];
}

/** WCAG 2.x relative luminance / contrast, for opaque 6-digit hex only. */
function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  assert.ok(match, `expected an opaque 6-digit hex color, got "${hex}"`);
  const packed = parseInt(match[1], 16);
  const [r, g, b] = [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test("the primary action tokens are the approved ramp, and the tenant fallback expression is preserved", () => {
  assert.equal(
    declaredValue(ROOT_RULE, "--color-action-primary"),
    "var(--tenant-brand-primary, #2563eb)",
  );
  assert.equal(declaredValue(ROOT_RULE, "--color-action-primary-hover"), "#1d4ed8");
  assert.equal(declaredValue(ROOT_RULE, "--color-action-primary-active"), "#1e40af");
  assert.equal(declaredValue(ROOT_RULE, "--color-text-on-primary"), "#ffffff");
});

test("every enabled primary fill clears 4.5:1 against the fixed white label", () => {
  const label = declaredValue(ROOT_RULE, "--color-text-on-primary");
  const primary = declaredValue(ROOT_RULE, "--color-action-primary");
  const fallback = /,\s*(#[0-9a-f]{6})\s*\)$/i.exec(primary);
  assert.ok(fallback, `the primary token must keep a literal hex fallback, got "${primary}"`);

  for (const [state, fill] of [
    ["rest (unbranded fallback)", fallback[1]],
    ["hover", declaredValue(ROOT_RULE, "--color-action-primary-hover")],
    ["active", declaredValue(ROOT_RULE, "--color-action-primary-active")],
  ] as const) {
    const ratio = contrastRatio(label, fill);
    // Compared unrounded: a 4.49 must never be reported as a pass.
    assert.ok(
      ratio >= 4.5,
      `${state}: ${fill} on ${label} is ${ratio.toFixed(4)}:1, below the 4.5:1 normal-text minimum`,
    );
  }
});

test("hover and active stay platform-fixed literals -- never wired to a tenant override", () => {
  for (const property of [
    "--color-action-primary-hover",
    "--color-action-primary-active",
  ]) {
    const value = declaredValue(ROOT_RULE, property);
    assert.match(value, /^#[0-9a-f]{6}$/i, `${property} must stay an opaque literal`);
    assert.doesNotMatch(value, /var\(/, `${property} must not source from Tier 2`);
  }
});

test("the real validator still admits a conforming tenant primary and withholds every non-conforming one", () => {
  const accepted = buildTenantBrandOverrides({
    primaryColor: "#1d4ed8",
    secondaryColor: null,
    accentColor: null,
  });
  assert.equal(accepted["--tenant-brand-primary"], "#1d4ed8");

  // Every rejected value leaves Tier 2 unset, so the ramp's own fallback is
  // what actually renders -- which is why that fallback had to become
  // conforming. Includes the 4.5:1 boundary from both sides.
  const boundaryPass = buildTenantBrandOverrides({
    primaryColor: "#767676",
    secondaryColor: null,
    accentColor: null,
  });
  assert.equal(boundaryPass["--tenant-brand-primary"], "#767676");

  for (const rejected of ["#777777", "#ffffff", "not-a-color", "rgba(0, 0, 0, 0.9)", null]) {
    const overrides = buildTenantBrandOverrides({
      primaryColor: rejected,
      secondaryColor: null,
      accentColor: null,
    });
    assert.equal(
      "--tenant-brand-primary" in overrides,
      false,
      `${rejected} must never reach Tier 2`,
    );
  }
});

test("the primary rule paints button and link from the same tokens, keeping the white label and the separate blue shadow tint", () => {
  const rule = cssRule(".app-button-primary, button.app-button-primary, a.app-button-primary");
  assert.match(rule, /border-color:\s*var\(--color-action-primary\);/);
  assert.match(rule, /background:\s*var\(--color-action-primary\);/);
  assert.match(rule, /background-image:\s*none;/);
  assert.match(rule, /color:\s*var\(--color-text-on-primary\) !important;/);
  assert.match(rule, /-webkit-text-fill-color:\s*var\(--color-text-on-primary\) !important;/);
  // The inset highlight and ambient tint are literal shadow values, not part
  // of the ramp repair -- they are deliberately unchanged.
  assert.match(rule, /rgba\(255, 255, 255, 0\.22\)/);
  assert.match(rule, /rgba\(59, 130, 246, 0\.3\)/);
  assert.doesNotMatch(rule, /opacity:/);
});

test("the primary hover and active rules read their fixed state tokens, for buttons and links alike", () => {
  const hover = cssRule(".app-button-primary:hover:not(:disabled), a.app-button-primary:hover");
  assert.match(hover, /background:\s*var\(--color-action-primary-hover\);/);
  assert.match(hover, /border-color:\s*var\(--color-action-primary-hover\);/);

  const active = cssRule(
    ".app-button-primary:active:not(:disabled), button.app-button-primary:active:not(:disabled), a.app-button-primary:active",
  );
  assert.match(active, /background:\s*var\(--color-action-primary-active\);/);
  assert.match(active, /border-color:\s*var\(--color-action-primary-active\);/);
});

test("these token assertions cannot be satisfied by a comment, a missing/duplicate/broadened rule, or a repeated declaration", () => {
  // A commented-out declaration must not count as declared.
  assert.throws(
    () => declaredValue(cssRule(":root", ":root {\n  /* --color-action-primary-hover: #1d4ed8; */\n}\n"), "--color-action-primary-hover"),
    /expected exactly one "--color-action-primary-hover" declaration, found 0/,
  );
  // A declaration repeated inside one rule is ambiguous, not a pass.
  assert.throws(
    () => declaredValue(":root { --color-action-primary-hover: #1d4ed8; --color-action-primary-hover: #3b82f6; }", "--color-action-primary-hover"),
    /found 2/,
  );
  // Missing rule.
  assert.throws(() => cssRule(":root", ".something-else { color: red; }\n"));
  // Duplicated rule.
  assert.throws(() => cssRule(":root", ":root { color: red; }\n:root { color: blue; }\n"));
  // A broadened selector group must not answer for the exact one.
  assert.throws(() =>
    cssRule(
      ".app-button-primary, button.app-button-primary, a.app-button-primary",
      ".app-button-primary, button.app-button-primary, a.app-button-primary, .app-button-stop { background: red; }\n",
    ),
  );
});

// ---------------------------------------------------------------------------
// Shared focus indicator (approved 2026-09-20). --color-focus-ring was an
// alpha colour, rgba(37, 99, 235, 0.35). At 35% alpha the best contrast any
// hue can reach over a light surface is ~2.44:1, so no hue could satisfy
// WCAG 2.2 SC 1.4.11's 3:1 for a required state indication -- the alpha, not
// the hue, was the defect. The replacement is opaque and mid-tone so that it
// clears BOTH the light/tinted surfaces and the audited dark ones (admin
// Slideshow cards and preview regions); a near-black candidate was rejected
// because it measured ~1.02:1 against the #161616 Slideshow card.
//
// The token stays invariant under tenant branding (branding token contract
// §6), and this repair changes colour only -- outline width, offset, radius,
// selector scope, the invalid-input override and the container suppressions
// are all unchanged, so neither open clipping finding (the ordinary Nearby
// opener, the ObjectPanel Next control) is touched or claimed to be fixed.
// ---------------------------------------------------------------------------

/** The nine flat surfaces evaluated for this repair. */
const FOCUS_RING_SURFACES: ReadonlyArray<readonly [string, string]> = [
  ["panel / elevated", "#ffffff"],
  ["page", "#f3f4f6"],
  ["muted", "#f8f9fb"],
  ["danger Alert", "#fee2e2"],
  ["warning Alert", "#fef3c7"],
  ["Nearby emergency card", "#fff7f7"],
  ["Slideshow card", "#161616"],
  ["Slideshow preview", "#111111"],
  // Supplemental only: an audited dark literal tested as a flat colour. This
  // is NOT a proven Photos control background and must not be read as one.
  ["supplemental dark literal", "#0f172a"],
];

/** Every rule that paints the shared ring, by COMPLETE selector list. */
const FOCUS_RING_CONSUMERS: readonly string[] = [
  ".app-button:focus-visible, button.app-button:focus-visible, a.app-button:focus-visible",
  ".app-control:focus-visible, .app-card-section input:focus-visible, .app-card-section select:focus-visible, .app-card-section textarea:focus-visible, .app-card-section-muted input:focus-visible, .app-card-section-muted select:focus-visible, .app-card-section-muted textarea:focus-visible, .table-toolbar-row input:focus-visible, .table-toolbar-row select:focus-visible",
  ".app-inline-edit-trigger:focus-visible",
  "a.app-status-pill-link:focus-visible",
  ".admin-summary-link:focus-visible",
  ".object-panel-close:focus-visible, .object-panel-nav-button:focus-visible, .object-panel a:focus-visible, .object-panel button:focus-visible",
  ".nearby-place-open-button:focus-visible",
  ".preferred-map-chooser-option:focus-visible",
  ".preferred-map-chooser-cancel:focus-visible",
  ".shell-nav-subitem:focus-visible, .shell-nav-item-toggle:focus-visible",
  ".shell-nav-item:focus-visible, .shell-nav-account-action:focus-visible, .shell-nav-trigger:focus-visible, .shell-account-action:focus-visible, .shell-back-action:focus-visible",
  ".ui-ref-toc a:focus-visible",
];

test("--color-focus-ring is declared exactly once and is opaque -- an alpha ring cannot reach 3:1 on a light surface at any hue", () => {
  const value = declaredValue(ROOT_RULE, "--color-focus-ring");
  assert.equal(value, "#6b7280");
  assert.match(value, /^#[0-9a-f]{6}$/i, "the focus ring must be an opaque 6-digit hex");
  assert.doesNotMatch(value, /rgba?\(/i, "the focus ring must not reintroduce an alpha colour");
});

test("the focus ring clears 3:1 against all nine evaluated flat surfaces, light, tinted and dark", () => {
  const ring = declaredValue(ROOT_RULE, "--color-focus-ring");
  for (const [name, surface] of FOCUS_RING_SURFACES) {
    const ratio = contrastRatio(ring, surface);
    // Compared unrounded: a 2.999 must never be reported as a pass.
    assert.ok(
      ratio >= 3,
      `${name} (${surface}): ring ${ring} is ${ratio.toFixed(4)}:1, below the 3:1 non-text minimum`,
    );
  }
});

test("every shared-ring consumer keeps its exact selector list and unchanged outline geometry", () => {
  assert.equal(
    (GLOBALS_CSS_BLANKED.match(/var\(--color-focus-ring/g) || []).length,
    FOCUS_RING_CONSUMERS.length,
    "a consumer was added or removed without updating this list",
  );
  for (const selectorList of FOCUS_RING_CONSUMERS) {
    const rule = cssRule(selectorList);
    assert.match(rule, /outline-offset:\s*2px;/, `${selectorList} lost its 2px offset`);
    if (selectorList === "a.app-status-pill-link:focus-visible") {
      // Keeps its own --border-width-thick fallback form; this repair does not
      // add that token or normalise the shorthand.
      assert.match(
        rule,
        /outline:\s*var\(--border-width-thick, 2px\) solid var\(--color-focus-ring, currentColor\);/,
      );
    } else {
      assert.match(rule, /outline:\s*2px solid var\(--color-focus-ring\);/, `${selectorList} lost its 2px solid ring`);
    }
  }
  // The Nearby opener additionally rounds its ring; that geometry is untouched.
  assert.match(
    cssRule(".nearby-place-open-button:focus-visible"),
    /border-radius:\s*var\(--radius-small\);/,
  );
});

test("the independent invalid-input indicator and the container focus suppressions are untouched by the token repair", () => {
  const invalid = cssRule('.app-control[aria-invalid="true"]:focus-visible');
  assert.match(invalid, /outline-color:\s*var\(--color-status-error\);/);
  assert.doesNotMatch(invalid, /--color-focus-ring/, "the invalid indicator must stay independent");

  for (const container of [
    ".app-dialog:focus-visible",
    ".object-panel:focus-visible",
    ".preferred-map-chooser:focus-visible",
  ]) {
    assert.match(cssRule(container), /outline:\s*none;/, `${container} lost its suppression`);
  }
});

test("the focus-ring assertions cannot be satisfied by a comment, a duplicate declaration, or a broadened selector group", () => {
  // A commented-out token must not count as declared.
  assert.throws(
    () => declaredValue(cssRule(":root", ":root {\n  /* --color-focus-ring: #6b7280; */\n}\n"), "--color-focus-ring"),
    /expected exactly one "--color-focus-ring" declaration, found 0/,
  );
  // A duplicated declaration is ambiguous, not a pass.
  assert.throws(
    () => declaredValue(":root { --color-focus-ring: #6b7280; --color-focus-ring: rgba(37, 99, 235, 0.35); }", "--color-focus-ring"),
    /found 2/,
  );
  // A broadened selector group must not answer for the exact consumer.
  assert.throws(() =>
    cssRule(
      ".app-inline-edit-trigger:focus-visible",
      ".app-inline-edit-trigger:focus-visible, .something-else:focus-visible { outline: 2px solid red; }\n",
    ),
  );
  // A duplicated rule is ambiguous too.
  assert.throws(() =>
    cssRule(
      ".admin-summary-link:focus-visible",
      ".admin-summary-link:focus-visible { outline: 1px }\n.admin-summary-link:focus-visible { outline: 2px }\n",
    ),
  );
  // An alpha ring must fail the contrast gate these tests rely on.
  assert.throws(() => contrastRatio("rgba(37, 99, 235, 0.35)", "#ffffff"));
});
