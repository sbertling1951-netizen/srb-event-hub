"use client";

import {
  VENDOR_PLAN_STATUS_LABELS,
  VENDOR_PLAN_STATUSES,
  type VendorPlanInput,
  type VendorPlanStatus,
} from "@/lib/organizerVendorPlan";

/**
 * The one organizer-facing vendor-plan field set, used unchanged by both the
 * "add a vendor" form and each in-place "edit" form on
 * `app/organize/[eventId]/vendors/page.tsx`. No second field implementation.
 *
 * Organizer-neutral and planning-only: name / category / status / website /
 * contact detail / private note. No admission, access, invitation, or payment
 * control, and deliberately no cost or quote field -- a vendor plan entry is a
 * private note to the organizer, nothing more.
 */

export function OrganizerVendorPlanFields({
  values,
  onChange,
}: {
  values: VendorPlanInput;
  onChange: (next: VendorPlanInput) => void;
}) {
  function update<Key extends keyof VendorPlanInput>(key: Key, value: VendorPlanInput[Key]) {
    onChange({ ...values, [key]: value });
  }
  return (
    <>
      <label>
        Vendor or supplier
        <input
          className="app-form-input"
          value={values.vendorName}
          onChange={(event) => update("vendorName", event.target.value)}
          required
        />
      </label>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label>
          Service category <span style={{ fontWeight: 400 }}>(optional)</span>
          <input
            className="app-form-input"
            value={values.serviceCategory}
            onChange={(event) => update("serviceCategory", event.target.value)}
          />
        </label>
        <label>
          Status
          <select
            className="app-form-input"
            value={values.status}
            onChange={(event) => update("status", event.target.value as VendorPlanStatus)}
          >
            {VENDOR_PLAN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {VENDOR_PLAN_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label>
          Website <span style={{ fontWeight: 400 }}>(optional)</span>
          <input
            className="app-form-input"
            value={values.website}
            onChange={(event) => update("website", event.target.value)}
          />
        </label>
        <label>
          Contact detail <span style={{ fontWeight: 400 }}>(optional)</span>
          <input
            className="app-form-input"
            value={values.contactDetail}
            onChange={(event) => update("contactDetail", event.target.value)}
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
