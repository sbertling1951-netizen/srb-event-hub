"use client";

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

export const STARTER_TEMPLATES = [
  { key: "casual", label: "Casual gathering", detail: "A simple starting point for a get-together." },
  { key: "birthday_family", label: "Birthday or family", detail: "A welcoming plan for family and friends." },
  { key: "club_rv", label: "Club or RV group", detail: "A familiar starting point for a club gathering." },
  { key: "conference_corporate", label: "Conference or organization", detail: "A starting point for a larger organized event." },
  { key: "dinner", label: "Dinner", detail: "A focused starting point for a meal together." },
  { key: "sports_activity", label: "Sports or activity", detail: "A starting point for an activity-centered event." },
] as const;

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
}: {
  values: OrganizerEventFormValues;
  onChange: (next: OrganizerEventFormValues) => void;
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
      <label>
        Event name
        <input className="app-form-input" value={values.eventName} onChange={(event) => update("eventName", event.target.value)} required />
      </label>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label>
          Start date <span style={{ fontWeight: 400 }}>(optional)</span>
          <input className="app-form-input" type="date" value={values.startDate} onChange={(event) => update("startDate", event.target.value)} />
        </label>
        <label>
          End date
          <input className="app-form-input" type="date" min={values.startDate || undefined} value={values.endDate} onChange={(event) => update("endDate", event.target.value)} required />
        </label>
        <label>
          Time zone
          <input className="app-form-input" value={values.timezone} onChange={(event) => update("timezone", event.target.value)} placeholder="America/Los_Angeles" required />
        </label>
      </div>
      <label>
        Event place
        <select className="app-form-input" value={values.locationMode} onChange={(event) => updateLocationMode(event.target.value as OrganizerLocationMode)}>
          <option value="no_location">No location yet</option>
          <option value="online">Online</option>
          <option value="location">A physical location</option>
        </select>
      </label>
      {values.locationMode === "location" ? (
        <label>
          Location
          <input className="app-form-input" value={values.location} onChange={(event) => update("location", event.target.value)} required />
        </label>
      ) : null}
      <label>
        Starter template
        <select className="app-form-input" value={values.starterTemplate} onChange={(event) => update("starterTemplate", event.target.value)}>
          {STARTER_TEMPLATES.map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}
        </select>
      </label>
      <p style={{ margin: 0, color: "var(--color-text-muted, #475569)" }}>
        {STARTER_TEMPLATES.find((template) => template.key === values.starterTemplate)?.detail}
      </p>
    </>
  );
}
