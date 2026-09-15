"use client";

import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import {
  REGISTRY_PLAN_STATUS_LABELS,
  REGISTRY_PLAN_STATUSES,
  type RegistryPlanInput,
  type RegistryPlanStatus,
} from "@/lib/organizerRegistryPlan";

/**
 * The one organizer-facing registry-plan field set, used unchanged by both the
 * "add a registry" form and each in-place "edit" form on
 * `app/organize/[eventId]/registry/page.tsx`. No second field implementation.
 *
 * Planning-only: registry or provider / link / status / private note. There is
 * no account, credential, connection, item list, price, or purchase control,
 * and there never will be in this field set.
 *
 * THE LINK IS AN <input>, NEVER AN <a>. It is captured as plain text and
 * rendered back as plain text. Nothing here fetches, validates, previews,
 * unfurls, or navigates to it, and it is deliberately not `type="url"` --
 * browser URL validation is a format check, and format-checking is the first
 * step toward dereferencing. An organizer may write "the shop on Main Street,
 * ask at the counter" and that is a valid value.
 */

export function OrganizerRegistryPlanFields({
  values,
  onChange,
}: {
  values: RegistryPlanInput;
  onChange: (next: RegistryPlanInput) => void;
}) {
  function update<Key extends keyof RegistryPlanInput>(key: Key, value: RegistryPlanInput[Key]) {
    onChange({ ...values, [key]: value });
  }
  return (
    <>
      <Field label="Registry or provider" required>
        {(props) => (
          <Input
            {...props}
            value={values.providerName}
            onChange={(event) => update("providerName", event.target.value)}
            required
          />
        )}
      </Field>
      <Field
        label={<>Link <span style={{ fontWeight: 400 }}>(optional)</span></>}
        help="Saved exactly as you type it, for your own reference. EpicentraX never opens or checks it."
      >
        {(props) => (
          <Input
            {...props}
            value={values.registryUrl}
            onChange={(event) => update("registryUrl", event.target.value)}
          />
        )}
      </Field>
      <Field label="Status">
        {(props) => (
          <Select
            {...props}
            value={values.status}
            onChange={(event) => update("status", event.target.value as RegistryPlanStatus)}
          >
            {REGISTRY_PLAN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {REGISTRY_PLAN_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        )}
      </Field>
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
