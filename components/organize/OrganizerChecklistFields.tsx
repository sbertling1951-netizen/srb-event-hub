"use client";

import type { ChecklistItemInput } from "@/lib/organizerChecklist";

/**
 * The one organizer-facing checklist field set, used unchanged by both the
 * "add an item" form and each in-place "edit" form on
 * `app/organize/[eventId]/checklist/page.tsx`. No second field implementation.
 *
 * A BLANK NOTEBOOK: this component renders empty inputs. It offers no
 * suggestions, no placeholder examples that read as recommendations, no
 * starter list, and no ordering control (this phase keeps stable creation
 * order only).
 *
 * The date input is plain `type="date"` -- date only, no time. Nothing here
 * computes overdue, renders a "due" or "late" treatment, or styles a past date
 * differently from a future one. It is information the organizer entered.
 */

export function OrganizerChecklistFields({
  values,
  onChange,
}: {
  values: ChecklistItemInput;
  onChange: (next: ChecklistItemInput) => void;
}) {
  function update<Key extends keyof ChecklistItemInput>(key: Key, value: ChecklistItemInput[Key]) {
    onChange({ ...values, [key]: value });
  }
  return (
    <>
      <label>
        Item
        <input
          className="app-form-input"
          value={values.title}
          onChange={(event) => update("title", event.target.value)}
          required
        />
      </label>
      <label>
        Target date <span style={{ fontWeight: 400 }}>(optional)</span>
        <input
          className="app-form-input"
          type="date"
          value={values.targetDate}
          onChange={(event) => update("targetDate", event.target.value)}
        />
        <span style={{ fontWeight: 400, color: "var(--color-text-muted, #475569)", fontSize: "0.85em" }}>
          Just for your own reference. EpicentraX does not remind you or track this date.
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
