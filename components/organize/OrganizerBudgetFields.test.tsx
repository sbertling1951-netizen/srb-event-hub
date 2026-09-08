import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { OrganizerBudgetFields } from "@/components/organize/OrganizerBudgetFields";
import { type BudgetLineInput, emptyBudgetLine } from "@/lib/organizerBudget";

// Focused tests for the one organizer-facing Budget Plan field set.
// Run with: npx tsx --test components/organize/OrganizerBudgetFields.test.tsx
//
// These prove the four things the contract makes load-bearing at the UI layer:
// USD is what an organizer starts in, BTC is genuinely selectable, an amount
// survives as the exact string typed (no JavaScript number ever touches it),
// and NOTHING on the surface totals, counts, scores, charges, or judges.

const pageSource = readFileSync(
  fileURLToPath(new URL("../../app/organize/[eventId]/budget/page.tsx", import.meta.url)),
  "utf8",
);
const fieldsSource = readFileSync(
  fileURLToPath(new URL("./OrganizerBudgetFields.tsx", import.meta.url)),
  "utf8",
);

const values: BudgetLineInput = {
  lineName: "Hall deposit",
  category: "Venue",
  currency: "USD",
  estimatedAmount: "1250.50",
  actualAmount: "",
  note: "",
};

/** Walks the returned element tree so handlers can be invoked directly. */

function collect(node: any, out: any[] = []): any[] {
  if (Array.isArray(node)) {
    node.forEach((child) => collect(child, out));
    return out;
  }
  if (!node || typeof node !== "object") {
    return out;
  }
  if (node.props) {
    out.push(node);
    collect(node.props.children, out);
  }
  return out;
}


function elementsFor(input: BudgetLineInput, onChange: (next: BudgetLineInput) => void = () => {}): any[] {
  return collect(OrganizerBudgetFields({ values: input, onChange }));
}


const amountInputs = (els: any[]) => els.filter((e) => e.type === "input" && e.props.inputMode === "decimal");

const selectEl = (els: any[]) => els.find((e) => e.type === "select");

test("USD IS THE INITIAL CURRENCY on a brand-new, untouched form", () => {
  assert.equal(emptyBudgetLine().currency, "USD");
  const html = renderToStaticMarkup(<OrganizerBudgetFields values={emptyBudgetLine()} onChange={() => {}} />);
  // react-dom/server marks the chosen option on the select itself
  assert.match(html, /<select[^>]*class="app-form-input"[^>]*>/);
  assert.match(html, /<option value="USD" selected="">/, "USD is the selected option in the rendered markup");
  assert.doesNotMatch(html, /<option value="BTC" selected="">/, "BTC is offered but not pre-selected");
  const select = selectEl(elementsFor(emptyBudgetLine()));
  assert.equal(select.props.value, "USD", "the select opens on USD with nothing else pre-filled");
  // and the rest of the form really is blank
  assert.equal(html.includes('value="1250"'), false);
  for (const field of amountInputs(elementsFor(emptyBudgetLine()))) {
    assert.equal(field.props.value, "", "no amount is pre-filled or suggested");
  }
});

test("BTC CAN BE SELECTED: both currencies are offered and selecting BTC is passed through unchanged", () => {
  const html = renderToStaticMarkup(<OrganizerBudgetFields values={emptyBudgetLine()} onChange={() => {}} />);
  // React marks the chosen option in the markup: on an untouched form that is USD.
  assert.match(html, /<option value="USD" selected="">US dollars \(USD\)<\/option>/);
  assert.match(html, /<option value="BTC">Bitcoin \(BTC\)<\/option>/);
  assert.equal((html.match(/<option /g) ?? []).length, 2, "exactly two currencies are offered");

  let received: BudgetLineInput | null = null;
  const select = selectEl(elementsFor(emptyBudgetLine(), (next) => { received = next; }));
  select.props.onChange({ target: { value: "BTC" } });
  assert.equal(received!.currency, "BTC", "choosing BTC reaches the form state as BTC");

  // a BTC line renders with BTC selected, and its hint states the 8-decimal rule
  const btcHtml = renderToStaticMarkup(
    <OrganizerBudgetFields values={{ ...values, currency: "BTC" }} onChange={() => {}} />,
  );
  assert.equal(selectEl(elementsFor({ ...values, currency: "BTC" })).props.value, "BTC");
  // and in the real markup BTC is now the selected option, USD is not
  assert.match(btcHtml, /<option value="BTC" selected="">Bitcoin \(BTC\)<\/option>/);
  assert.match(btcHtml, /<option value="USD">US dollars \(USD\)<\/option>/);
  assert.match(btcHtml, /Bitcoin amounts can have up to 8 decimal places\./);
  assert.match(html, /US dollar amounts can have up to 2 decimal places\./);

  // an unrecognised currency falls back to USD rather than being accepted
  const bogus = selectEl(elementsFor(emptyBudgetLine(), (next) => { received = next; }));
  bogus.props.onChange({ target: { value: "EUR" } });
  assert.equal(received!.currency, "USD", "a currency that is not USD or BTC is never adopted");
});

test("AMOUNTS ARE PRESERVED AS EXACT STRINGS -- no JavaScript number conversion", () => {
  // Values that a Number() round-trip would visibly damage.
  for (const raw of ["0.01500000", "1250.50", "12.567", "0.000000005", "00.10", "999999999999.99"]) {
    let received: BudgetLineInput | null = null;
    const [estimated] = amountInputs(elementsFor(emptyBudgetLine(), (next) => { received = next; }));
    estimated.props.onChange({ target: { value: raw } });
    assert.equal(
      received!.estimatedAmount,
      raw,
      `${raw} reached form state byte-for-byte (Number() would give ${String(Number(raw))})`,
    );
    assert.equal(typeof received!.estimatedAmount, "string");
  }

  // the actual-amount field behaves identically
  let received: BudgetLineInput | null = null;
  const [, actual] = amountInputs(elementsFor(emptyBudgetLine(), (next) => { received = next; }));
  actual.props.onChange({ target: { value: "0.01500000" } });
  assert.equal(received!.actualAmount, "0.01500000");

  // trailing zeros survive all the way into rendered markup
  const html = renderToStaticMarkup(
    <OrganizerBudgetFields
      values={{ ...values, currency: "BTC", estimatedAmount: "0.01500000", actualAmount: "1250.50" }}
      onChange={() => {}}
    />,
  );
  assert.match(html, /value="0\.01500000"/);
  assert.match(html, /value="1250\.50"/);

  // the inputs are deliberately NOT type=number: no browser stepping or rounding
  for (const field of amountInputs(elementsFor(values))) {
    assert.equal(field.props.type, undefined, "amount inputs are plain text, never type=number");
    assert.equal(field.props.inputMode, "decimal");
    assert.equal(field.props.step, undefined);
  }
  // and the component itself never coerces
  assert.doesNotMatch(fieldsSource, /Number\(|parseFloat|parseInt|toFixed|\btoLocaleString\b/);
});

test("NO total, subtotal, count, progress, affordability, payment, or readiness UI appears", () => {
  const forbidden =
    /total|subtotal|\bsum\b|\bcount\b|progress|remaining|affordab|over budget|under budget|\bpay now\b|checkout|invoice|receipt|wallet|readiness|\blaunch\b|\bpublish\b/i;

  // 1. nothing forbidden is RENDERED, in either currency, filled or empty
  for (const input of [
    emptyBudgetLine(),
    values,
    { ...values, currency: "BTC" as const, estimatedAmount: "0.015", actualAmount: "0.02" },
  ]) {
    const html = renderToStaticMarkup(<OrganizerBudgetFields values={input} onChange={() => {}} />);
    assert.doesNotMatch(html, forbidden, "the field set renders no aggregate or commerce language");
    // no chart, meter, or progress element of any kind
    assert.doesNotMatch(html, /<progress|<meter|<canvas|<svg|role="progressbar"/);
  }

  // 2. the field set renders exactly the approved six controls -- nothing extra
  const els = elementsFor(values);
  assert.equal(amountInputs(els).length, 2, "two amount fields: estimated and actual");
  assert.equal(els.filter((e) => e.type === "select").length, 1, "one currency select");
  assert.equal(els.filter((e) => e.type === "textarea").length, 1, "one private note");
  assert.equal(els.filter((e) => e.type === "input").length, 4, "name, category, and the two amounts");

  // 3. the ROUTE that renders them adds no aggregate or commerce affordance
  //    either. Its privacy notice legitimately says what does NOT happen, so
  //    the check targets the code with that copy removed.
  const pageCode = pageSource
    .replace(/const PRIVACY_COPY =[\s\S]*?;\n/, "")
    .replace(/const EMPTY_COPY =[\s\S]*?;\n/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(pageCode, forbidden);
  assert.doesNotMatch(pageCode, /\.reduce\(|\+=|Number\(|parseFloat|toFixed|Math\./);
  // each amount is shown beside its OWN line's currency, never merged
  assert.match(pageSource, /currency=\{line\.currency\}/);
});

test("the amount hint says correctly grouped commas are allowed and names exactly what is refused", () => {
  for (const input of [emptyBudgetLine(), { ...values, currency: "BTC" as const }]) {
    const html = renderToStaticMarkup(<OrganizerBudgetFields values={input} onChange={() => {}} />);

    // commas are ALLOWED, with the approved example -- the old prohibition is gone
    assert.match(html, /Grouping commas are fine when placed the usual way, like 1,250\.00/);
    assert.doesNotMatch(html, /no symbols or commas|commas are not|without commas/i);

    // what stays refused is still stated plainly, in one sentence
    assert.match(html, /no\s+currency symbols, plus or minus signs, spaces, or scientific notation/);

    // the currency-specific decimal hint and the no-payment / no-conversion
    // language are retained alongside it
    assert.match(html, /amounts can have up to (2|8) decimal places\./);
    assert.match(html, /does not pay it, and EpicentraX never charges you for it/);
    assert.match(html, /EpicentraX never converts between currencies/);
  }
  // the hint is the single element the amount inputs are described by
  const html = renderToStaticMarkup(<OrganizerBudgetFields values={values} onChange={() => {}} />);
  assert.equal((html.match(/aria-describedby="budget-decimal-hint"/g) ?? []).length, 2);
  assert.equal((html.match(/id="budget-decimal-hint"/g) ?? []).length, 1);
});
