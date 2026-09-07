"use client";

import type { OrganizerAgendaItem, OrganizerAgendaItemInput } from "@/lib/organizerAgenda";

/**
 * The one organizer-facing agenda-item field set, used unchanged by both the
 * "add an agenda item" form and each in-place "edit" form on
 * `app/organize/[eventId]/agenda/page.tsx`. No second field implementation.
 *
 * Organizer-neutral: title / description / location / speaker / date / start /
 * end only. No published toggle, no category/visual management, no reorder --
 * all deliberately out of this phase.
 */

export function emptyOrganizerAgendaItem(): OrganizerAgendaItemInput {
  return {
    title: "",
    description: "",
    location: "",
    speaker: "",
    agendaDate: "",
    startTime: "",
    endTime: "",
  };
}

export function organizerAgendaItemValues(item: OrganizerAgendaItem): OrganizerAgendaItemInput {
  return {
    title: item.title ?? "",
    description: item.description ?? "",
    location: item.location ?? "",
    speaker: item.speaker ?? "",
    agendaDate: item.agendaDate ?? "",
    startTime: (item.startTime ?? "").slice(0, 5),
    endTime: (item.endTime ?? "").slice(0, 5),
  };
}

export function OrganizerAgendaItemFields({
  values,
  onChange,
}: {
  values: OrganizerAgendaItemInput;
  onChange: (next: OrganizerAgendaItemInput) => void;
}) {
  function update<Key extends keyof OrganizerAgendaItemInput>(
    key: Key,
    value: OrganizerAgendaItemInput[Key],
  ) {
    onChange({ ...values, [key]: value });
  }
  return (
    <>
      <label>
        Title
        <input className="app-form-input" value={values.title} onChange={(event) => update("title", event.target.value)} required />
      </label>
      <label>
        Description <span style={{ fontWeight: 400 }}>(optional)</span>
        <textarea className="app-form-input" value={values.description} rows={3} onChange={(event) => update("description", event.target.value)} />
      </label>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label>
          Location <span style={{ fontWeight: 400 }}>(optional)</span>
          <input className="app-form-input" value={values.location} onChange={(event) => update("location", event.target.value)} />
        </label>
        <label>
          Speaker <span style={{ fontWeight: 400 }}>(optional)</span>
          <input className="app-form-input" value={values.speaker} onChange={(event) => update("speaker", event.target.value)} />
        </label>
      </div>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <label>
          Date <span style={{ fontWeight: 400 }}>(optional)</span>
          <input className="app-form-input" type="date" value={values.agendaDate} onChange={(event) => update("agendaDate", event.target.value)} />
        </label>
        <label>
          Start time
          <input className="app-form-input" type="time" value={values.startTime} onChange={(event) => update("startTime", event.target.value)} required />
        </label>
        <label>
          End time <span style={{ fontWeight: 400 }}>(optional)</span>
          <input className="app-form-input" type="time" value={values.endTime} min={values.startTime || undefined} onChange={(event) => update("endTime", event.target.value)} />
        </label>
      </div>
    </>
  );
}
