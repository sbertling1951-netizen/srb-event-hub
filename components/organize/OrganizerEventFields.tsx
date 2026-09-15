"use client";

import { Field, Input, Select } from "@/components/ui/Field";
import type { OrganizerDraft } from "@/lib/organizerDrafts";

/**
 * The single organizer-facing event-details field set. Used unchanged by both
 * the initial "create your event" form (`app/organize/page.tsx`) and the
 * "edit event details" surface on a private draft
 * (`app/organize/[eventId]/page.tsx`). There is no second field implementation.
 *
 * It is deliberately organizer-neutral: no tenant / organization / "event
 * space" input, no status / visibility / launch control. The one name field is
 * "Event name"; the internal container reuses that name and is never surfaced.
 *
 * `plannedPlaceOptions` is the OPTIONAL §B.1 adoption pre-fill. When the
 * caller supplies texts, a small selector appears beside the Location field
 * that copies one of them into `values.location`. Deliberately:
 *
 *   * it is a plain array of STRINGS -- no venue-plan id, status, or record
 *     ever reaches this component, so a pre-fill cannot link the Event back to
 *     a planning record (copy-not-link);
 *   * the select is bound to the empty string, so it is a one-shot action
 *     rather than stored state, and it always returns to its placeholder;
 *   * it writes ONLY `values.location`. It never touches `locationMode` or any
 *     other field, and it performs no write, RPC, or navigation of its own;
 *   * it renders only when options exist and the Location field itself is
 *     showing, so the create form (which passes nothing) is unchanged.
 */

export type OrganizerLocationMode = "location" | "online" | "no_location";

export type OrganizerEventFormValues = {
  eventName: string;
  startDate: string;
  endDate: string;
  timezone: string;
  locationMode: OrganizerLocationMode;
  location: string;
  starterTemplate: string;
};

/**
 * The one canonical starter-template catalog. The `key` values are the stored
 * database / RPC values (validated verbatim by
 * create_self_service_organizer_draft and
 * save_my_self_service_private_draft_details); `label` is the ONLY string an
 * organizer ever sees. Every organizer surface -- the create selector, the
 * edit selector, and the saved Event details card -- reads its labels from
 * here, never from a raw stored key.
 */
export const STARTER_TEMPLATES = [
  { key: "casual", label: "Casual gathering", detail: "A simple starting point for a get-together." },
  { key: "birthday_family", label: "Birthday or family", detail: "A welcoming plan for family and friends." },
  { key: "club_rv", label: "Club or RV group", detail: "A familiar starting point for a club gathering." },
  { key: "conference_corporate", label: "Conference or organization", detail: "A starting point for a larger organized event." },
  { key: "dinner", label: "Dinner", detail: "A focused starting point for a meal together." },
  { key: "sports_activity", label: "Sports or activity", detail: "A starting point for an activity-centered event." },
  { key: "wedding", label: "Wedding", detail: "A starting point for a wedding celebration." },
] as const;

export const STARTER_TEMPLATE_KEYS = STARTER_TEMPLATES.map((template) => template.key);

/** Neutral, organizer-friendly fallback for any stored key not in the catalog. */
export const UNKNOWN_STARTER_TEMPLATE_LABEL = "Event starting point";

/**
 * The organizer-facing label for a stored starter-template key. An unrecognized
 * key (older data, a future key this build predates) resolves to a neutral
 * friendly label -- the raw stored value is never surfaced.
 */
export function starterTemplateLabel(key: string | null | undefined): string {
  const match = STARTER_TEMPLATES.find((template) => template.key === key);
  return match ? match.label : UNKNOWN_STARTER_TEMPLATE_LABEL;
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

export function emptyOrganizerEventForm(): OrganizerEventFormValues {
  return {
    eventName: "",
    startDate: "",
    endDate: "",
    timezone: browserTimezone(),
    locationMode: "no_location",
    location: "",
    starterTemplate: "casual",
  };
}

/** Current persisted values of a draft, shaped for the shared field set. */
export function organizerEventValuesFromDraft(draft: OrganizerDraft): OrganizerEventFormValues {
  return {
    eventName: draft.event_name ?? "",
    startDate: draft.start_date ?? "",
    endDate: draft.end_date ?? "",
    timezone: draft.timezone ?? "",
    locationMode: draft.location_mode,
    location: draft.location ?? "",
    starterTemplate: draft.starter_template ?? "casual",
  };
}

export function OrganizerEventFields({
  values,
  onChange,
  plannedPlaceOptions,
}: {
  values: OrganizerEventFormValues;
  onChange: (next: OrganizerEventFormValues) => void;
  /** Optional §B.1 pre-fill texts. Strings only -- never a planning record. */
  plannedPlaceOptions?: string[];
}) {
  function update<Key extends keyof OrganizerEventFormValues>(
    key: Key,
    value: OrganizerEventFormValues[Key],
  ) {
    onChange({ ...values, [key]: value });
  }
  function updateLocationMode(mode: OrganizerLocationMode) {
    onChange({ ...values, locationMode: mode, location: mode === "location" ? values.location : "" });
  }
  return (
    <>
      <Field label="Event name" required>
        {(props) => (
          <Input {...props} value={values.eventName} onChange={(event) => update("eventName", event.target.value)} required />
        )}
      </Field>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Field label={<>Start date <span style={{ fontWeight: 400 }}>(optional)</span></>}>
          {(props) => (
            <Input {...props} type="date" value={values.startDate} onChange={(event) => update("startDate", event.target.value)} />
          )}
        </Field>
        <Field label="End date" required>
          {(props) => (
            <Input {...props} type="date" min={values.startDate || undefined} value={values.endDate} onChange={(event) => update("endDate", event.target.value)} required />
          )}
        </Field>
        <Field label="Time zone" required>
          {(props) => (
            <Input {...props} value={values.timezone} onChange={(event) => update("timezone", event.target.value)} placeholder="America/Los_Angeles" required />
          )}
        </Field>
      </div>
      <Field label="Event place">
        {(props) => (
          <Select {...props} value={values.locationMode} onChange={(event) => updateLocationMode(event.target.value as OrganizerLocationMode)}>
            <option value="no_location">No location yet</option>
            <option value="online">Online</option>
            <option value="location">A physical location</option>
          </Select>
        )}
      </Field>
      {values.locationMode === "location" ? (
        <>
          {plannedPlaceOptions && plannedPlaceOptions.length > 0 ? (
            <Field
              label={<>Use a planned place <span style={{ fontWeight: 400 }}>(optional)</span></>}
              help="This fills the Location field. Save changes to use it for this Event."
            >
              {(props) => (
                <Select
                  {...props}
                  value=""
                  onChange={(event) => {
                    const text = event.target.value;
                    if (text) {
                      update("location", text);
                    }
                  }}
                >
                  <option value="">Choose a planned place</option>
                  {plannedPlaceOptions.map((text, index) => (
                    <option key={index} value={text}>{text}</option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label="Location" required>
            {(props) => (
              <Input {...props} value={values.location} onChange={(event) => update("location", event.target.value)} required />
            )}
          </Field>
        </>
      ) : null}
      <Field label="Starter template">
        {(props) => (
          <Select {...props} value={values.starterTemplate} onChange={(event) => update("starterTemplate", event.target.value)}>
            {STARTER_TEMPLATES.map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}
          </Select>
        )}
      </Field>
      <p style={{ margin: 0, color: "var(--color-text-muted, #475569)" }}>
        {STARTER_TEMPLATES.find((template) => template.key === values.starterTemplate)?.detail}
      </p>
    </>
  );
}
