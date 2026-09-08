import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  addMyPrivateDraftBudgetLine,
  BUDGET_CURRENCIES,
  budgetAmountError,
  budgetLineError,
  type BudgetLineInput,
  budgetLineValues,
  deleteMyPrivateDraftBudgetLine,
  emptyBudgetLine,
  isBudgetCurrency,
  listMyPrivateDraftBudgetLines,
  type OrganizerBudgetRpcClient,
  removeGroupingCommas,
  updateMyPrivateDraftBudgetLine,
} from "./organizerBudget";

const adapterSource = readFileSync(
  fileURLToPath(new URL("./organizerBudget.ts", import.meta.url)),
  "utf8",
);
/** Comments removed: the prose may name what is deliberately absent. */
const CODE = adapterSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const values: BudgetLineInput = {
  lineName: "Hall deposit",
  category: "Venue",
  currency: "USD",
  estimatedAmount: "1250.50",
  actualAmount: "",
  note: "they want half up front",
};

function capturingClient(row: Record<string, unknown> = {}) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const client: OrganizerBudgetRpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: [{ id: "b1", line_name: "Hall deposit", currency: "USD", ...row }], error: null };
    },
  };
  return { client, calls };
}

test("ORGANIZER-ENTERED: an empty response is an empty list -- nothing is invented", async () => {
  for (const data of [[], null, undefined]) {
    const client: OrganizerBudgetRpcClient = {
      async rpc() {
        return { data, error: null };
      },
    };
    assert.deepEqual(await listMyPrivateDraftBudgetLines(client, "e1"), []);
  }
});

test("ORGANIZER-ENTERED: the module exports no starter budget, template, or suggested amount", () => {
  assert.doesNotMatch(CODE, /starter|template|suggest|recommend|preset|sample|DEFAULT_LINES|seed|benchmark/i);
  // an empty form is empty -- only the USD default is pre-selected
  assert.deepEqual(emptyBudgetLine(), {
    lineName: "", category: "", currency: "USD", estimatedAmount: "", actualAmount: "", note: "",
  });
});

test("NO AGGREGATION: the module exports no total, subtotal, sum, count, or affordability helper", () => {
  assert.doesNotMatch(CODE, /\btotal\b|subtotal|\bsum\b|average|\bcount\b|remaining|affordab|budget_left|overBudget/i);
  assert.doesNotMatch(CODE, /\.reduce\(|\+=|\bMath\./);
  // no arithmetic on any amount, anywhere
  assert.doesNotMatch(CODE, /estimatedAmount\s*[-+*/]|actualAmount\s*[-+*/]/);
});

test("NO CONVERSION: no exchange rate, price lookup, or cross-currency arithmetic", () => {
  assert.doesNotMatch(CODE, /exchange|\brate\b|convert|conversion|forex|\bfx\b|spot|market|price/i);
  assert.doesNotMatch(CODE, /usdTo|btcTo|toUsd|toBtc|baseCurrency|normali[sz]/i);
});

test("NO COMMERCE: no payment, Passport, checkout, wallet, key, or credential surface", () => {
  assert.doesNotMatch(CODE, /payment|passport|checkout|invoice|receipt|\btax\b|reimburse|contribution|purchase|refund/i);
  assert.doesNotMatch(CODE, /wallet|blockchain|onchain|privateKey|publicKey|seedPhrase|mnemonic|\baddress\b/i);
  assert.doesNotMatch(CODE, /\bbank\b|cardNumber|iban|credential|stripe|paypal|coinbase/i);
});

test("NO READINESS: the module never mentions readiness, launch, or publish", () => {
  assert.doesNotMatch(CODE, /readiness|\blaunch\b|\bpublish\b|\bready\b|progress|\bwarn/i);
});

test("MONEY IS NEVER A JAVASCRIPT NUMBER: no Number(), parseFloat, or toFixed on an amount", () => {
  assert.doesNotMatch(CODE, /Number\(|parseFloat|parseInt|toFixed|valueOf\(\)/);
  // amounts are declared as strings on both the input and the result shapes
  assert.match(adapterSource, /estimatedAmount: string;/);
  assert.match(adapterSource, /estimatedAmount: string \| null;/);
});

test("CURRENCY: exactly two, USD first and default, and a line carries only one", () => {
  assert.deepEqual([...BUDGET_CURRENCIES], ["USD", "BTC"]);
  assert.equal(emptyBudgetLine().currency, "USD");
  assert.ok(isBudgetCurrency("USD") && isBudgetCurrency("BTC"));
  for (const bad of ["EUR", "GBP", "eth", "", null, undefined, 1]) {
    assert.equal(isBudgetCurrency(bad), false, `${String(bad)} is not a budget currency`);
  }
  // one currency field on the input -- not one per amount
  assert.doesNotMatch(adapterSource, /estimatedCurrency|actualCurrency|currencyEstimated/);
});

test("PRECISION: USD accepts up to 2 decimals, BTC up to 8", () => {
  for (const ok of ["0", "1250", "1250.5", "1250.50", "0.01"]) {
    assert.equal(budgetAmountError(ok, "USD"), null, `${ok} is a valid USD amount`);
  }
  for (const ok of ["0.015", "0.01500000", "0.00000001", "12", "12.5"]) {
    assert.equal(budgetAmountError(ok, "BTC"), null, `${ok} is a valid BTC amount`);
  }
  // an empty amount is valid: both amounts are optional
  assert.equal(budgetAmountError("", "USD"), null);
  assert.equal(budgetAmountError("   ", "BTC"), null);
});

test("EXCESS PRECISION IS REJECTED, NEVER SILENTLY ROUNDED", () => {
  const usd = budgetAmountError("12.567", "USD");
  assert.match(String(usd), /at most 2 decimal places/);
  const btc = budgetAmountError("0.000000005", "BTC");
  assert.match(String(btc), /at most 8 decimal places/);
  // a BTC-precision amount is NOT acceptable on a USD line
  assert.match(String(budgetAmountError("0.015", "USD")), /at most 2 decimal places/);
  // nothing in the module rounds or truncates a rejected value
  assert.doesNotMatch(CODE, /toFixed|Math\.round|slice\(0,\s*\d\)|truncat/i);
});

test("GROUPING: correctly-grouped US-style commas are accepted, in either currency", () => {
  for (const ok of ["1,000", "12,250", "12,250.00", "12,250.50", "1,234,567.89", "999", "100,000,000"]) {
    assert.equal(budgetAmountError(ok, "USD"), null, `${ok} is a valid grouped USD amount`);
  }
  // grouping only ever applies to the integer part -- the fraction is unaffected
  for (const ok of ["12,345.87654321", "1,234.5", "100,000.00000001"]) {
    assert.equal(budgetAmountError(ok, "BTC"), null, `${ok} is a valid grouped BTC amount`);
  }
  // plain, ungrouped values of any length remain valid
  for (const ok of ["12250", "1000000"]) {
    assert.equal(budgetAmountError(ok, "USD"), null, `${ok} (ungrouped) is still valid`);
  }
});

test("GROUPING: malformed comma placement is refused, never repaired", () => {
  for (const bad of [
    "1,00", // final group has 2 digits, not 3
    "12,34", // final group has 2 digits, not 3
    "1,2345", // final group has 4 digits, not 3
    ",250", // leading comma
    "12,", // trailing comma, no digits after it
    "1234,567", // first group has 4 digits, not 1-3
    "12,25,0", // a valid-looking group followed by a malformed one
    "12.25.00", // two decimal points
    "1,,000", // doubled comma
  ]) {
    assert.notEqual(budgetAmountError(bad, "USD"), null, `${bad} is refused, not silently regrouped`);
  }
});

test("GROUPING: precision limits are still enforced AFTER grouping commas are removed", () => {
  // three fractional digits on a grouped USD amount -- still too many
  assert.match(String(budgetAmountError("12,250.567", "USD")), /at most 2 decimal places/);
  // nine fractional digits on a grouped BTC amount -- still too many
  assert.match(String(budgetAmountError("1,234.123456789", "BTC")), /at most 8 decimal places/);
  // a grouped amount at exactly the currency's own limit is accepted
  assert.equal(budgetAmountError("12,250.56", "USD"), null);
  assert.equal(budgetAmountError("1,234.12345678", "BTC"), null);
});

test("removeGroupingCommas is pure text substitution -- no rounding, no arithmetic, digits preserved", () => {
  assert.equal(removeGroupingCommas("12,250.00"), "12250.00");
  assert.equal(removeGroupingCommas("1,234,567.89"), "1234567.89");
  assert.equal(removeGroupingCommas("1,000"), "1000");
  assert.equal(removeGroupingCommas("  12,250.00  "), "12250.00");
  assert.equal(removeGroupingCommas(""), "");
  assert.equal(removeGroupingCommas("   "), "");
  // no commas present -- unchanged
  assert.equal(removeGroupingCommas("1250.50"), "1250.50");
});

test("NEGATIVE amounts cannot be entered, in either currency", () => {
  for (const currency of BUDGET_CURRENCIES) {
    assert.notEqual(budgetAmountError("-1", currency), null);
    assert.notEqual(budgetAmountError("-0.01", currency), null);
  }
  // and other non-amount shapes are refused rather than coerced -- a currency
  // symbol prefix is refused even though "1,250" alone (correctly grouped)
  // is now accepted; see the GROUPING tests below.
  for (const bad of ["$1,250", "abc", "1e5", "12.", ".5", "1 250", "+12.50"]) {
    assert.notEqual(budgetAmountError(bad, "USD"), null, `${bad} is refused`);
  }
});

test("budgetLineError requires a name and leaves everything else optional", () => {
  assert.equal(budgetLineError(values), null);
  assert.match(String(budgetLineError({ ...values, lineName: "   " })), /name/i);
  assert.equal(
    budgetLineError({ lineName: "DJ", category: "", currency: "USD", estimatedAmount: "", actualAmount: "", note: "" }),
    null,
    "a name-only line is valid",
  );
  assert.notEqual(budgetLineError({ ...values, lineName: "x".repeat(201) }), null);
  assert.notEqual(budgetLineError({ ...values, category: "x".repeat(121) }), null);
  assert.notEqual(budgetLineError({ ...values, note: "x".repeat(2001) }), null);
});

test("BOTH amounts on a line are validated against that line's ONE currency", () => {
  // 0.015 is fine as BTC on both fields...
  assert.equal(
    budgetLineError({ ...values, currency: "BTC", estimatedAmount: "0.015", actualAmount: "0.01500000" }),
    null,
  );
  // ...and refused on both fields as USD
  assert.match(
    String(budgetLineError({ ...values, currency: "USD", estimatedAmount: "0.015", actualAmount: "" })),
    /at most 2 decimal places/,
  );
  assert.match(
    String(budgetLineError({ ...values, currency: "USD", estimatedAmount: "", actualAmount: "0.015" })),
    /at most 2 decimal places/,
  );
});

test("amounts travel to the RPC as exact strings, with blanks sent as null", async () => {
  const { client, calls } = capturingClient();
  await addMyPrivateDraftBudgetLine(client, {
    eventId: "e1",
    values: { ...values, estimatedAmount: "1250.50", actualAmount: "" },
  });
  assert.equal(calls[0]?.name, "add_my_private_draft_budget_line");
  assert.deepEqual(calls[0]?.args, {
    p_event_id: "e1",
    p_line_name: "Hall deposit",
    p_category: "Venue",
    p_currency: "USD",
    p_estimated_amount: "1250.50",
    p_actual_amount: null,
    p_organizer_note: "they want half up front",
  });
  assert.equal(typeof calls[0]?.args?.p_estimated_amount, "string", "the amount is a string, not a number");
});

test("GROUPING: a grouped USD amount submits to add_my_private_draft_budget_line as a plain decimal string", async () => {
  const { client, calls } = capturingClient();
  const input: BudgetLineInput = { ...values, estimatedAmount: "12,250.00", actualAmount: "1,300" };
  await addMyPrivateDraftBudgetLine(client, { eventId: "e1", values: input });
  assert.equal(calls[0]?.name, "add_my_private_draft_budget_line");
  assert.deepEqual(calls[0]?.args, {
    p_event_id: "e1",
    p_line_name: "Hall deposit",
    p_category: "Venue",
    p_currency: "USD",
    p_estimated_amount: "12250.00",
    p_actual_amount: "1300",
    p_organizer_note: "they want half up front",
  });
  assert.equal(typeof calls[0]?.args?.p_estimated_amount, "string", "still a string, never a number");
  // the organizer's own typed value (with commas) is untouched -- only the
  // wire payload was normalized, and only at this submission boundary
  assert.equal(input.estimatedAmount, "12,250.00", "form state is never rewritten");
  assert.equal(input.actualAmount, "1,300", "form state is never rewritten");
});

test("GROUPING: a grouped BTC amount submits to update_my_private_draft_budget_line as a plain decimal string", async () => {
  const { client, calls } = capturingClient({ currency: "BTC" });
  const input: BudgetLineInput = {
    ...values,
    currency: "BTC",
    estimatedAmount: "12,345.87654321",
    actualAmount: "",
  };
  await updateMyPrivateDraftBudgetLine(client, { eventId: "e1", budgetLineId: "b1", values: input });
  assert.equal(calls[0]?.name, "update_my_private_draft_budget_line");
  assert.deepEqual(calls[0]?.args, {
    p_event_id: "e1",
    p_budget_line_id: "b1",
    p_line_name: "Hall deposit",
    p_category: "Venue",
    p_currency: "BTC",
    p_estimated_amount: "12345.87654321",
    p_actual_amount: null,
    p_organizer_note: "they want half up front",
  });
  assert.equal(input.estimatedAmount, "12,345.87654321", "form state is never rewritten on edit either");
});

test("GROUPING: malformed grouping never reaches the network on add or update", async () => {
  const { client, calls } = capturingClient();
  await assert.rejects(
    () => addMyPrivateDraftBudgetLine(client, { eventId: "e1", values: { ...values, estimatedAmount: "1,00" } }),
    /Enter an amount as digits/,
  );
  await assert.rejects(
    () =>
      updateMyPrivateDraftBudgetLine(client, {
        eventId: "e1",
        budgetLineId: "b1",
        values: { ...values, currency: "BTC", estimatedAmount: "1,2345" },
      }),
    /Enter an amount as digits/,
  );
  assert.equal(calls.length, 0, "no RPC call was attempted for malformed grouping");
});

test("the update RPC carries the line id and re-sends the whole field set", async () => {
  const { client, calls } = capturingClient({ currency: "BTC", estimated_amount: "0.01500000" });
  const saved = await updateMyPrivateDraftBudgetLine(client, {
    eventId: "e1",
    budgetLineId: "b1",
    values: { ...values, currency: "BTC", estimatedAmount: "0.015" },
  });
  assert.equal(calls[0]?.name, "update_my_private_draft_budget_line");
  assert.equal(calls[0]?.args?.p_budget_line_id, "b1");
  assert.equal(calls[0]?.args?.p_currency, "BTC");
  // the row comes back exactly as the database rendered it -- not reformatted
  assert.equal(saved.estimatedAmount, "0.01500000");
  assert.equal(saved.currency, "BTC");
});

test("a rejected line never reaches the network", async () => {
  const { client, calls } = capturingClient();
  await assert.rejects(
    () => addMyPrivateDraftBudgetLine(client, { ...{ eventId: "e1" }, values: { ...values, estimatedAmount: "12.567" } }),
    /at most 2 decimal places/,
  );
  await assert.rejects(
    () => updateMyPrivateDraftBudgetLine(client, { eventId: "e1", budgetLineId: "b1", values: { ...values, lineName: " " } }),
    /name/i,
  );
  assert.equal(calls.length, 0, "no RPC was attempted for an invalid line");
});

test("delete sends only the two ids and returns the removed id", async () => {
  const client: OrganizerBudgetRpcClient = {
    async rpc(name, args) {
      assert.equal(name, "delete_my_private_draft_budget_line");
      assert.deepEqual(args, { p_event_id: "e1", p_budget_line_id: "b1" });
      return { data: [{ deleted_id: "b1" }], error: null };
    },
  };
  assert.deepEqual(await deleteMyPrivateDraftBudgetLine(client, { eventId: "e1", budgetLineId: "b1" }), {
    deletedId: "b1",
  });
});

test("a database error is surfaced verbatim, and rows round-trip through the form shape", async () => {
  const client: OrganizerBudgetRpcClient = {
    async rpc() {
      return { data: null, error: { message: "Draft not found." } };
    },
  };
  await assert.rejects(() => listMyPrivateDraftBudgetLines(client, "e1"), /Draft not found\./);

  assert.deepEqual(
    budgetLineValues({
      id: "b1",
      lineName: "Hall deposit",
      category: null,
      currency: "BTC",
      estimatedAmount: "0.01500000",
      actualAmount: null,
      organizerNote: null,
    }),
    { lineName: "Hall deposit", category: "", currency: "BTC", estimatedAmount: "0.01500000", actualAmount: "", note: "" },
  );
});
