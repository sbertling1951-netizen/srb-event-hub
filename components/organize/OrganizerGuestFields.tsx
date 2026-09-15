"use client";

import { Field, Input, Textarea } from "@/components/ui/Field";
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
      <Field label="Name" required>
        {(props) => (
          <Input
            {...props}
            value={values.displayName}
            onChange={(event) => update("displayName", event.target.value)}
            required
          />
        )}
      </Field>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Field label={<>Email <span style={{ fontWeight: 400 }}>(optional)</span></>}>
          {(props) => (
            <Input
              {...props}
              type="email"
              value={values.email}
              onChange={(event) => update("email", event.target.value)}
            />
          )}
        </Field>
        <Field label={<>Phone <span style={{ fontWeight: 400 }}>(optional)</span></>}>
          {(props) => (
            <Input
              {...props}
              value={values.phone}
              onChange={(event) => update("phone", event.target.value)}
            />
          )}
        </Field>
      </div>
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
