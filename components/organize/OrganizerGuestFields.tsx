"use client";

import type { PlannedGuestInput } from "@/lib/organizerGuestList";

/**
 * The one organizer-facing planned-guest field set, used unchanged by both the
 * "add a guest" form and each in-place "edit" form on
 * `app/organize/[eventId]/guests/page.tsx`. No second field implementation.
 *
 * Organizer-neutral and planning-only: display name / email / phone / private
 * note. No invitation, access, registration, household, or capacity control --
 * a planned guest is a private note to the organizer, nothing more.
 */

export function OrganizerGuestFields({
  values,
  onChange,
}: {
  values: PlannedGuestInput;
  onChange: (next: PlannedGuestInput) => void;
}) {
  function update<Key extends keyof PlannedGuestInput>(key: Key, value: PlannedGuestInput[Key]) {
    onChange({ ...values, [key]: value });
  }
  return (
    <>
      <label>
        Name
        <input
          className="app-form-input"
          value={values.displayName}
          onChange={(event) => update("displayName", event.target.value)}
          required
        />
      </label>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label>
          Email <span style={{ fontWeight: 400 }}>(optional)</span>
          <input
            className="app-form-input"
            type="email"
            value={values.email}
            onChange={(event) => update("email", event.target.value)}
          />
        </label>
        <label>
          Phone <span style={{ fontWeight: 400 }}>(optional)</span>
          <input
            className="app-form-input"
            value={values.phone}
            onChange={(event) => update("phone", event.target.value)}
          />
        </label>
      </div>
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
