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

test("NEGATIVE amounts cannot be entered, in either currency", () => {
  for (const currency of BUDGET_CURRENCIES) {
    assert.notEqual(budgetAmountError("-1", currency), null);
    assert.notEqual(budgetAmountError("-0.01", currency), null);
  }
  // and other non-amount shapes are refused rather than coerced
  for (const bad of ["$1,250", "1,250.00", "abc", "1e5", "12.", ".5", "1 250"]) {
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
