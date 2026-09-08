/**
 * Browser adapter for the P-3H organizer private-draft BUDGET PLAN RPC
 * surface.
 *
 * This is A PRIVATE NOTEBOOK WITH NUMBERS IN IT. The rules from the contract
 * (docs/architecture/EPICENTRAX_PRIVATE_BUDGET_PLAN_CONTRACT.md) govern every
 * line of it, and of anything built on it:
 *
 *   1. EVERY NUMBER IS ORGANIZER-ENTERED. This module supplies, imports,
 *      infers, benchmarks, looks up, and suggests NOTHING. There is
 *      deliberately no starter budget, no template, no category list drawn
 *      from the catalog, and no default amount anywhere in this file.
 *   2. NOTHING IS AGGREGATED. This module exports NO total, subtotal, sum,
 *      average, count, "remaining", or affordability helper -- in one currency
 *      or across two. It returns the organizer's rows and nothing derived.
 *   3. RECORDING A COST IS NOT PAYING IT. An "actual amount" is a number the
 *      organizer wrote down, never a payment, receipt, invoice, or proof that
 *      money moved. Nothing here reaches payment, Passport, checkout, or any
 *      commerce surface, because none exists.
 *   4. A BUDGET SAYS NOTHING ABOUT READINESS. Nothing here is an input to
 *      event status, launch, or publish.
 *
 * CURRENCY. Each line carries exactly one currency: 'USD' (the default) or
 * 'BTC'. The estimated and actual amounts on a line therefore always share it.
 * USD allows at most 2 decimal places; BTC at most 8. EXCESS PRECISION IS
 * REJECTED, NEVER SILENTLY ROUNDED. There is no exchange rate, no conversion,
 * no price lookup, and no cross-currency arithmetic -- here or anywhere.
 * BTC is a private unit of account only: no wallet, address, key, or on-chain
 * anything exists in this product.
 *
 * MONEY NEVER BECOMES A JAVASCRIPT NUMBER. Amounts are handled as exact
 * decimal STRINGS from the input field, over the wire, and back again -- the
 * database stores exact `numeric` and returns exact text. Nothing in this
 * module calls Number(), parseFloat(), or any arithmetic operator on an
 * amount, so no IEEE-754 double ever holds an organizer's money value.
 *
 * GROUPING COMMAS. An organizer may type standard US-style grouping commas in
 * an amount's integer part (12,250.00). A comma is accepted ONLY where
 * correct grouping puts one -- malformed grouping is refused, never repaired.
 * The organizer's own typed value (commas and all) stays untouched in form
 * state; commas are removed -- by text substitution only, never by rounding
 * or recalculation -- at the submission boundary, so the RPC wire payload
 * always carries a plain decimal string.
 *
 * The database commands remain the authoritative authorization and validation
 * boundary (the self-service organizer-owner rule only); this module only
 * keeps route components from constructing RPC argument objects ad hoc, and
 * gives the organizer the same answer the server would give, sooner.
 */

type RpcResult = { data: unknown; error: { message: string } | null };

export type OrganizerBudgetRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
};

/** The only two currencies this capability recognises. USD is the default. */
export const BUDGET_CURRENCIES = ["USD", "BTC"] as const;
export type BudgetCurrency = (typeof BUDGET_CURRENCIES)[number];

/** Maximum fractional decimal places allowed for each currency. */
const CURRENCY_DECIMALS: Record<BudgetCurrency, number> = { USD: 2, BTC: 8 };

/** How each currency is labelled for a person reading the page. */
export const CURRENCY_LABELS: Record<BudgetCurrency, string> = {
  USD: "US dollars (USD)",
  BTC: "Bitcoin (BTC)",
};

export function isBudgetCurrency(value: unknown): value is BudgetCurrency {
  return value === "USD" || value === "BTC";
}

export function budgetCurrencyDecimals(currency: BudgetCurrency): number {
  return CURRENCY_DECIMALS[currency];
}

export type BudgetLine = {
  id: string;
  lineName: string;
  category: string | null;
  currency: BudgetCurrency;
  /** Exact decimal text as stored, or null. Never a JavaScript number. */
  estimatedAmount: string | null;
  actualAmount: string | null;
  organizerNote: string | null;
};

/** The budget field values. `lineName` is required; everything else optional. */
export type BudgetLineInput = {
  lineName: string;
  category: string;
  currency: BudgetCurrency;
  estimatedAmount: string;
  actualAmount: string;
  note: string;
};

export function emptyBudgetLine(): BudgetLineInput {
  // USD is selected initially. Nothing else is pre-filled.
  return { lineName: "", category: "", currency: "USD", estimatedAmount: "", actualAmount: "", note: "" };
}

export function budgetLineValues(line: BudgetLine): BudgetLineInput {
  return {
    lineName: line.lineName ?? "",
    category: line.category ?? "",
    currency: isBudgetCurrency(line.currency) ? line.currency : "USD",
    estimatedAmount: line.estimatedAmount ?? "",
    actualAmount: line.actualAmount ?? "",
    note: line.organizerNote ?? "",
  };
}

/**
 * Matches a plain decimal amount, or one using standard US-style grouping
 * commas in the integer part: 1,000 / 12,250.50 / 1,234,567.89 are all
 * accepted, exactly like their ungrouped equivalents. A comma is accepted
 * ONLY where correct three-digit grouping puts one, so malformed grouping --
 * 1,00 / 12,34 / 1,2345 -- a leading or trailing comma, and more than one
 * decimal point are all refused rather than repaired. Currency symbols,
 * plus/minus signs, spaces, and scientific notation never match either
 * branch.
 */
const AMOUNT_PATTERN = /^(\d+|\d{1,3}(?:,\d{3})+)(\.\d+)?$/;

/**
 * Removes grouping commas from an amount whose format has already been
 * approved by budgetAmountError (so every comma present is known to sit at a
 * correct three-digit group boundary). Pure text substitution -- no
 * Number(), no parseFloat(), no rounding, no arithmetic. A blank input stays
 * blank. This is the ONLY place a comma is ever removed, and it never
 * changes a digit: "12,250.00" becomes "12250.00", not a different amount.
 */
export function removeGroupingCommas(raw: string): string {
  return raw.trim().replace(/,/g, "");
}

/**
 * Validates ONE amount as typed, against its line's own currency.
 *
 * Purely textual: a non-negative decimal, optionally grouped with commas,
 * with no more fractional digits than the currency allows. A value with too
 * many decimals is REFUSED here and by the database -- neither rounds it.
 * The minus sign is simply not part of the accepted shape, so a negative
 * amount can never be entered.
 */
export function budgetAmountError(raw: string, currency: BudgetCurrency): string | null {
  const value = raw.trim();
  if (!value) {
    return null; // optional
  }
  const decimals = budgetCurrencyDecimals(currency);
  if (!AMOUNT_PATTERN.test(value)) {
    return "Enter an amount as digits, like 1,250.00 — no currency symbols, plus or minus signs, spaces, or scientific notation.";
  }
  // Precision and length are measured on the comma-free digits: grouping
  // commas never touch the fractional part, so this cannot change which
  // amounts pass, only how the integer part's digit count is read.
  const plain = removeGroupingCommas(value);
  const fraction = plain.split(".")[1] ?? "";
  if (fraction.length > decimals) {
    return currency === "BTC"
      ? "A Bitcoin amount can have at most 8 decimal places."
      : "A US dollar amount can have at most 2 decimal places.";
  }
  // Length guard mirroring the database's storage-hygiene ceiling. Not a
  // budget limit, a spending cap, or a judgement about the amount.
  if ((plain.split(".")[0] ?? "").replace(/^0+/, "").length > 12) {
    return "That amount is larger than this field can hold.";
  }
  return null;
}

export function budgetLineError(input: BudgetLineInput): string | null {
  if (!input.lineName.trim()) {
    return "Give this budget line a name.";
  }
  if (input.lineName.trim().length > 200) {
    return "The name must be 200 characters or fewer.";
  }
  if (input.category.trim().length > 120) {
    return "The category must be 120 characters or fewer.";
  }
  if (!isBudgetCurrency(input.currency)) {
    return "Choose US dollars (USD) or Bitcoin (BTC).";
  }
  // Both amounts are checked against THIS line's one currency.
  const estimated = budgetAmountError(input.estimatedAmount, input.currency);
  if (estimated) {
    return estimated;
  }
  const actual = budgetAmountError(input.actualAmount, input.currency);
  if (actual) {
    return actual;
  }
  if (input.note.trim().length > 2000) {
    return "The note must be 2000 characters or fewer.";
  }
  return null;
}

function coerceLine(row: unknown): BudgetLine {
  const value = (row ?? {}) as Record<string, unknown>;
  const currency = value.currency;
  return {
    id: String(value.id ?? ""),
    lineName: String(value.line_name ?? ""),
    category: (value.category as string | null) ?? null,
    currency: isBudgetCurrency(currency) ? currency : "USD",
    // Kept as text exactly as the database returned it.
    estimatedAmount:
      value.estimated_amount === null || value.estimated_amount === undefined
        ? null
        : String(value.estimated_amount),
    actualAmount:
      value.actual_amount === null || value.actual_amount === undefined
        ? null
        : String(value.actual_amount),
    organizerNote: (value.organizer_note as string | null) ?? null,
  };
}

function oneRow(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("EpicentraX did not return the expected budget result.");
  }
  return row as Record<string, unknown>;
}

function lineArgs(input: BudgetLineInput) {
  return {
    p_line_name: input.lineName.trim(),
    p_category: input.category.trim() || null,
    p_currency: input.currency,
    // Sent as exact decimal STRINGS -- never Number(), never parseFloat().
    // Grouping commas are removed ONLY here, at the submission boundary: the
    // organizer's own typed value (with commas, if any) is never rewritten
    // in form state, but the wire payload always carries a plain decimal.
    p_estimated_amount: removeGroupingCommas(input.estimatedAmount) || null,
    p_actual_amount: removeGroupingCommas(input.actualAmount) || null,
    p_organizer_note: input.note.trim() || null,
  };
}

export async function listMyPrivateDraftBudgetLines(
  client: OrganizerBudgetRpcClient,
  eventId: string,
): Promise<BudgetLine[]> {
  if (!eventId) {
    throw new Error("Choose a draft to plan.");
  }
  const { data, error } = await client.rpc("list_my_private_draft_budget_lines", {
    p_event_id: eventId,
  });
  if (error) {
    throw new Error(error.message);
  }
  // Whatever the organizer wrote, in stable creation order -- and nothing
  // else. No total is computed here or anywhere downstream. An empty result is
  // an empty list, not a prompt to fill one in.
  return Array.isArray(data) ? data.map(coerceLine) : [];
}

export async function addMyPrivateDraftBudgetLine(
  client: OrganizerBudgetRpcClient,
  input: { eventId: string; values: BudgetLineInput },
): Promise<BudgetLine> {
  const validationError = budgetLineError(input.values);
  if (validationError) {
    throw new Error(validationError);
  }
  const { data, error } = await client.rpc("add_my_private_draft_budget_line", {
    p_event_id: input.eventId,
    ...lineArgs(input.values),
  });
  if (error) {
    throw new Error(error.message);
  }
  return coerceLine(oneRow(data));
}

export async function updateMyPrivateDraftBudgetLine(
  client: OrganizerBudgetRpcClient,
  input: { eventId: string; budgetLineId: string; values: BudgetLineInput },
): Promise<BudgetLine> {
  const validationError = budgetLineError(input.values);
  if (validationError) {
    throw new Error(validationError);
  }
  const { data, error } = await client.rpc("update_my_private_draft_budget_line", {
    p_event_id: input.eventId,
    p_budget_line_id: input.budgetLineId,
    ...lineArgs(input.values),
  });
  if (error) {
    throw new Error(error.message);
  }
  return coerceLine(oneRow(data));
}

export async function deleteMyPrivateDraftBudgetLine(
  client: OrganizerBudgetRpcClient,
  input: { eventId: string; budgetLineId: string },
): Promise<{ deletedId: string }> {
  const { data, error } = await client.rpc("delete_my_private_draft_budget_line", {
    p_event_id: input.eventId,
    p_budget_line_id: input.budgetLineId,
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = oneRow(data);
  return { deletedId: String(row.deleted_id ?? input.budgetLineId) };
}
