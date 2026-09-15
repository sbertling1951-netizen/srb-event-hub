"use client";

import { Field, Input, Select, Textarea } from "@/components/ui/Field";
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
 *
 * The decimal/format hint below the amount fields is ONE shared, visible
 * paragraph describing a rule that applies identically to both amounts on
 * this line -- it deliberately stays outside both Fields (Field's own
 * `help`/`error` mechanism generates its own id per instance and cannot be
 * given a caller-chosen id), and each amount Field explicitly points its
 * control's `aria-describedby` at this one shared id rather than duplicating
 * the sentence into two separate Field `help` blocks.
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
      <Field label="Budget line" required>
        {(props) => (
          <Input
            {...props}
            value={values.lineName}
            onChange={(event) => update("lineName", event.target.value)}
            required
          />
        )}
      </Field>
      <Field
        label={<>Category <span style={{ fontWeight: 400 }}>(optional)</span></>}
        help="Whatever wording suits you. It is not matched to anything."
      >
        {(props) => (
          <Input
            {...props}
            value={values.category}
            onChange={(event) => update("category", event.target.value)}
          />
        )}
      </Field>
      <Field
        label="Currency"
        help="Applies to both amounts on this line. EpicentraX never converts between currencies."
      >
        {(props) => (
          <Select
            {...props}
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
          </Select>
        )}
      </Field>
      <Field label={<>Estimated amount <span style={{ fontWeight: 400 }}>(optional)</span></>}>
        {(props) => (
          <Input
            {...props}
            inputMode="decimal"
            autoComplete="off"
            value={values.estimatedAmount}
            onChange={(event) => update("estimatedAmount", event.target.value)}
            aria-describedby="budget-decimal-hint"
          />
        )}
      </Field>
      <Field label={<>Actual amount <span style={{ fontWeight: 400 }}>(optional)</span></>}>
        {(props) => (
          <Input
            {...props}
            inputMode="decimal"
            autoComplete="off"
            value={values.actualAmount}
            onChange={(event) => update("actualAmount", event.target.value)}
            aria-describedby="budget-decimal-hint"
          />
        )}
      </Field>
      <span
        id="budget-decimal-hint"
        style={{ fontWeight: 400, color: "var(--color-text-muted, #475569)", fontSize: "0.85em" }}
      >
        {decimalHint} Grouping commas are fine when placed the usual way, like 1,250.00 — but no
        currency symbols, plus or minus signs, spaces, or scientific notation. Writing an amount
        down here does not pay it, and EpicentraX never charges you for it.
      </span>
      <Field
        label={<>Private note <span style={{ fontWeight: 400 }}>(optional, only you can see this)</span></>}
      >
        {(props) => (
          <Textarea
            {...props}
            value={values.note}
            rows={3}
            onChange={(event) => update("note", event.target.value)}
          />
        )}
      </Field>
    </>
  );
}
