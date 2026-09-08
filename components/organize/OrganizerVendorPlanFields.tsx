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
 * Organizer-neutral and planning-only: vendor or supplier / category / status /
 * website / contact name / phone number / private note. No admission, access,
 * invitation, or payment control, and deliberately no cost or quote field -- a
 * vendor plan entry is a private note to the organizer, nothing more.
 *
 * "Vendor or supplier" is the business name. Contact name is the person the
 * organizer speaks to there; it is a second, different field, never a
 * duplicate business-name box.
 *
 * A pre-20261002000000 entry may still carry one generic free-text contact
 * value. It is rendered read-only under an explicit "Saved earlier" heading so
 * it is never mistaken for -- or silently converted into -- a contact name or
 * a phone number.
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
          Contact name <span style={{ fontWeight: 400 }}>(optional)</span>
          <input
            className="app-form-input"
            value={values.contactName}
            onChange={(event) => update("contactName", event.target.value)}
          />
        </label>
      </div>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label>
          Phone number <span style={{ fontWeight: 400 }}>(optional)</span>
          <input
            className="app-form-input"
            value={values.contactPhone}
            onChange={(event) => update("contactPhone", event.target.value)}
          />
        </label>
      </div>
      {values.legacyContactDetail ? (
        <div className="card" style={{ display: "grid", gap: 4 }}>
          <strong style={{ fontSize: "0.9em" }}>Contact information saved earlier</strong>
          <span style={{ color: "var(--color-text-muted, #475569)" }}>
            {values.legacyContactDetail}
          </span>
          <span style={{ color: "var(--color-text-muted, #475569)", fontSize: "0.85em" }}>
            Kept exactly as you typed it. Copy anything you need into the fields above.
          </span>
        </div>
      ) : null}
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
