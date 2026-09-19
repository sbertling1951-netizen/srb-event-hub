import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { AppButton, AppLinkButton } from "@/components/ui/AppButton";

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
