"use client";

import {
  BUDGET_CURRENCIES,
  type BudgetCurrency,
  budgetCurrencyDecimals,
  type BudgetLineInput,
  CURRENCY_LABELS,
  isBudgetCurrency,
} from "@/lib/organizerBudget";

/**
 * The one organizer-facing budget field set, used unchanged by both the "add a
 * line" form and each in-place "edit" form on
 * `app/organize/[eventId]/budget/page.tsx`. No second field implementation.
 *
 * A PRIVATE NOTEBOOK: this component renders empty inputs. It offers no
 * suggested amounts, no category list, no starter budget, and no placeholder
 * that reads as a recommendation.
 *
 * The currency select carries the two approved values with USD selected
 * first. It governs BOTH amounts on this line: there is one currency per line,
 * so the estimate and the actual can never drift apart. Changing it re-labels
 * both amount fields and changes how many decimal places they accept -- it
 * NEVER converts a number the organizer typed, because no exchange rate exists
 * anywhere in this product.
 *
 * The amount inputs are plain text with `inputMode="decimal"`, deliberately
 * NOT `type="number"`: the browser must not step, round, or locale-format an
 * organizer's money. The value is carried as an exact string the whole way to
 * the database.
 */

export function OrganizerBudgetFields({
  values,
  onChange,
}: {
  values: BudgetLineInput;
  onChange: (next: BudgetLineInput) => void;
}) {
  function update<Key extends keyof BudgetLineInput>(key: Key, value: BudgetLineInput[Key]) {
    onChange({ ...values, [key]: value });
  }
  const currency: BudgetCurrency = isBudgetCurrency(values.currency) ? values.currency : "USD";
  const decimals = budgetCurrencyDecimals(currency);
  // The wording is derived from the single source of truth for the rule, so
  // the sentence and the accepted precision can never disagree.
  const decimalHint = `${currency === "BTC" ? "Bitcoin" : "US dollar"} amounts can have up to ${decimals} decimal ${
    decimals === 1 ? "place" : "places"
  }.`;

  return (
    <>
      <label>
        Budget line
        <input
          className="app-form-input"
          value={values.lineName}
          onChange={(event) => update("lineName", event.target.value)}
          required
        />
      </label>
      <label>
        Category <span style={{ fontWeight: 400 }}>(optional)</span>
        <input
          className="app-form-input"
          value={values.category}
          onChange={(event) => update("category", event.target.value)}
        />
        <span style={{ fontWeight: 400, color: "var(--color-text-muted, #475569)", fontSize: "0.85em" }}>
          Whatever wording suits you. It is not matched to anything.
        </span>
      </label>
      <label>
        Currency
        <select
          className="app-form-input"
          value={currency}
          onChange={(event) =>
            update("currency", isBudgetCurrency(event.target.value) ? event.target.value : "USD")
          }
        >
          {BUDGET_CURRENCIES.map((option) => (
            <option key={option} value={option}>
              {CURRENCY_LABELS[option]}
            </option>
          ))}
        </select>
        <span style={{ fontWeight: 400, color: "var(--color-text-muted, #475569)", fontSize: "0.85em" }}>
          Applies to both amounts on this line. EpicentraX never converts between currencies.
        </span>
      </label>
      <label>
        Estimated amount <span style={{ fontWeight: 400 }}>(optional)</span>
        <input
          className="app-form-input"
          inputMode="decimal"
          autoComplete="off"
          value={values.estimatedAmount}
          onChange={(event) => update("estimatedAmount", event.target.value)}
          aria-describedby="budget-decimal-hint"
        />
      </label>
      <label>
        Actual amount <span style={{ fontWeight: 400 }}>(optional)</span>
        <input
          className="app-form-input"
          inputMode="decimal"
          autoComplete="off"
          value={values.actualAmount}
          onChange={(event) => update("actualAmount", event.target.value)}
          aria-describedby="budget-decimal-hint"
        />
        <span
          id="budget-decimal-hint"
          style={{ fontWeight: 400, color: "var(--color-text-muted, #475569)", fontSize: "0.85em" }}
        >
          {decimalHint} Grouping commas are fine when placed the usual way, like 1,250.00 — but no
          currency symbols, plus or minus signs, spaces, or scientific notation. Writing an amount
          down here does not pay it, and EpicentraX never charges you for it.
        </span>
      </label>
      <label>
        Private note <span style={{ fontWeight: 400 }}>(optional, only you can see this)</span>
        <textarea
          className="app-form-input"
          value={values.note}
          rows={3}
          onChange={(event) => update("note", event.target.value)}
        />
      </label>
    </>
  );
}
