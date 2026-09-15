"use client";

import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import {
  VENUE_PLAN_STATUS_LABELS,
  VENUE_PLAN_STATUSES,
  type VenuePlanInput,
  type VenuePlanStatus,
} from "@/lib/organizerVenuePlan";

/**
 * The one organizer-facing venue/place-plan field set, used unchanged by both
 * the "add a place" form and each in-place "edit" form on
 * `app/organize/[eventId]/venues/page.tsx`. No second field implementation.
 *
 * Organizer-neutral and planning-only: place / address or description /
 * website / contact name / phone number / status / private note. No booking,
 * availability, capacity, cost, admission, access, or map control.
 *
 * The address field is deliberately labelled as a free description: it is
 * never geocoded, pinned, or searched, and an organizer may write "behind the
 * fairgrounds" instead of a street address.
 */

export function OrganizerVenuePlanFields({
  values,
  onChange,
}: {
  values: VenuePlanInput;
  onChange: (next: VenuePlanInput) => void;
}) {
  function update<Key extends keyof VenuePlanInput>(key: Key, value: VenuePlanInput[Key]) {
    onChange({ ...values, [key]: value });
  }
  return (
    <>
      <Field label="Place" required>
        {(props) => (
          <Input
            {...props}
            value={values.placeName}
            onChange={(event) => update("placeName", event.target.value)}
            required
          />
        )}
      </Field>
      <Field
        label={<>Address or description <span style={{ fontWeight: 400 }}>(optional)</span></>}
        help={<>Write it however helps you — a street address, or “behind the fairgrounds, gravel lot”.</>}
      >
        {(props) => (
          <Textarea
            {...props}
            value={values.locationDescription}
            rows={2}
            onChange={(event) => update("locationDescription", event.target.value)}
          />
        )}
      </Field>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Field label={<>Website <span style={{ fontWeight: 400 }}>(optional)</span></>}>
          {(props) => (
            <Input
              {...props}
              value={values.website}
              onChange={(event) => update("website", event.target.value)}
            />
          )}
        </Field>
        <Field label="Status">
          {(props) => (
            <Select
              {...props}
              value={values.status}
              onChange={(event) => update("status", event.target.value as VenuePlanStatus)}
            >
              {VENUE_PLAN_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {VENUE_PLAN_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Field label={<>Contact name <span style={{ fontWeight: 400 }}>(optional)</span></>}>
          {(props) => (
            <Input
              {...props}
              value={values.contactName}
              onChange={(event) => update("contactName", event.target.value)}
            />
          )}
        </Field>
        <Field label={<>Phone number <span style={{ fontWeight: 400 }}>(optional)</span></>}>
          {(props) => (
            <Input
              {...props}
              value={values.contactPhone}
              onChange={(event) => update("contactPhone", event.target.value)}
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
