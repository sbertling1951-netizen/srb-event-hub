"use client";

import type { PublicEventCandidate } from "@/lib/publicEventBootstrap";

function dateRange(event: PublicEventCandidate) {
  if (event.start_date && event.end_date) return `${event.start_date} – ${event.end_date}`;
  return event.start_date || event.end_date || "Date to be announced";
}

export function PublicEventChooser({ events, onSelect }: { events: PublicEventCandidate[]; onSelect: (event: PublicEventCandidate) => void }) {
  return <section aria-label="Choose an event" style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16, marginBottom: 16 }}>
    <h2 style={{ marginTop: 0 }}>Choose an event</h2>
    <p>Select the event you want to view.</p>
    <div style={{ display: "grid", gap: 10 }}>
      {events.map((event) => <button key={event.id} type="button" onClick={() => onSelect(event)} style={{ minHeight: 56, padding: 12, textAlign: "left", background: "white", border: "1px solid #bbb", borderRadius: 8 }}>
        <strong>{event.name}</strong><br /><span>{[event.venue_name || event.location, dateRange(event)].filter(Boolean).join(" • ")}</span>
      </button>)}
    </div>
  </section>;
}
