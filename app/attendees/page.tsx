"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import MemberRouteGuard from "@/components/auth/MemberRouteGuard";

type Attendee = {
  id: string;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  email: string | null;
  phone: string | null;
  coach_make: string | null;
  coach_model: string | null;
  coach_length: string | null;
  first_time: boolean | null;
  volunteer: boolean | null;
  handicap_parking: boolean | null;
  assigned_site: string | null;
};

type MemberEventRow = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

function fullName(first?: string | null, last?: string | null) {
  return [first, last].filter(Boolean).join(" ") || "Unnamed attendee";
}

function yesNo(value?: boolean | null) {
  return value ? "Yes" : "No";
}

function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) return "";
  if (startDate && endDate) return `${startDate} – ${endDate}`;
  return startDate || endDate || "";
}

function AttendeesPageInner() {
  const [event, setEvent] = useState<MemberEventRow | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading attendees...");

  async function loadCurrentEventData() {
    const currentEvent = getCurrentMemberEvent();

    if (!currentEvent?.id) {
      setEvent(null);
      setEventId(null);
      setAttendees([]);
      setStatus("No current event selected.");
      return;
    }

    setEvent(currentEvent);
    setEventId(currentEvent.id);
  }

  async function loadAttendees(currentEventId: string) {
    const { data, error } = await supabase
      .from("attendees")
      .select(
        "id,pilot_first,pilot_last,copilot_first,copilot_last,email,phone,coach_make,coach_model,coach_length,first_time,volunteer,handicap_parking,assigned_site",
      )
      .eq("event_id", currentEventId)
      .order("pilot_last", { ascending: true })
      .order("pilot_first", { ascending: true });

    if (error) {
      setStatus(`Could not load attendees: ${error.message}`);
      return;
    }

    setAttendees((data || []) as Attendee[]);
    setStatus(`Loaded ${(data || []).length} attendees.`);
  }

  useEffect(() => {
    async function init() {
      setStatus("Loading current event...");
      await loadCurrentEventData();
    }

    void init();

    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-member-event-changed") {
        void loadCurrentEventData();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (eventId) {
      void loadAttendees(eventId);
    }
  }, [eventId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return attendees;

    return attendees.filter((a) => {
      const pilot = fullName(a.pilot_first, a.pilot_last).toLowerCase();
      const copilot = fullName(a.copilot_first, a.copilot_last).toLowerCase();
      const coach = [a.coach_make, a.coach_model]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const site = (a.assigned_site || "").toLowerCase();

      return (
        pilot.includes(q) ||
        copilot.includes(q) ||
        coach.includes(q) ||
        site.includes(q)
      );
    });
  }, [attendees, search]);

  const dateRange = formatDateRange(event?.start_date, event?.end_date);

  return (
    <div style={{ padding: 24 }}>
      <h1>Attendee Locator</h1>
      <p>Search the current event attendee list by name, coach, or site.</p>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          Current event: {event?.name || event?.eventName || "No current event"}
        </div>

        {event?.venue_name ? (
          <div style={{ marginBottom: 4, color: "#555" }}>
            {event.venue_name}
          </div>
        ) : null}

        {event?.location ? (
          <div style={{ marginBottom: 4, color: "#555" }}>{event.location}</div>
        ) : null}

        {dateRange ? (
          <div style={{ marginBottom: 4, fontSize: 13, color: "#666" }}>
            {dateRange}
          </div>
        ) : null}

        <div style={{ fontSize: 13, color: "#555" }}>Status: {status}</div>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 12,
          marginBottom: 16,
          maxWidth: 420,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Search</div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, coach, or site"
          style={{ width: "100%", padding: 8 }}
        />
      </div>

      <div style={{ marginBottom: 12, fontSize: 13, color: "#555" }}>
        Showing {filtered.length} attendee{filtered.length === 1 ? "" : "s"}.
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.3fr 1.3fr 1fr 0.9fr 0.8fr 0.8fr 0.8fr",
            gap: 12,
            padding: 12,
            fontWeight: 700,
            borderBottom: "1px solid #eee",
          }}
        >
          <div>Pilot</div>
          <div>Co-Pilot</div>
          <div>Coach</div>
          <div>Site</div>
          <div>1st Time</div>
          <div>Volunteer</div>
          <div>Handicap</div>
        </div>

        {filtered.map((a) => (
          <div
            key={a.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1.3fr 1.3fr 1fr 0.9fr 0.8fr 0.8fr 0.8fr",
              gap: 12,
              padding: 12,
              borderBottom: "1px solid #eee",
              alignItems: "start",
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>
                {fullName(a.pilot_first, a.pilot_last)}
              </div>
              {a.email ? (
                <div style={{ fontSize: 12, color: "#666" }}>{a.email}</div>
              ) : null}
              {a.phone ? (
                <div style={{ fontSize: 12, color: "#666" }}>{a.phone}</div>
              ) : null}
            </div>

            <div>
              <div>{fullName(a.copilot_first, a.copilot_last)}</div>
            </div>

            <div>
              {[a.coach_make, a.coach_model].filter(Boolean).join(" ") || "—"}
              {a.coach_length ? (
                <div style={{ fontSize: 12, color: "#666" }}>
                  {a.coach_length} ft
                </div>
              ) : null}
            </div>

            <div>{a.assigned_site || "—"}</div>
            <div>{yesNo(a.first_time)}</div>
            <div>{yesNo(a.volunteer)}</div>
            <div>{yesNo(a.handicap_parking)}</div>
          </div>
        ))}

        {filtered.length === 0 ? (
          <div style={{ padding: 14, color: "#666" }}>No attendees found.</div>
        ) : null}
      </div>
    </div>
  );
}

export default function AttendeesPage() {
  return (
    <MemberRouteGuard>
      <AttendeesPageInner />
    </MemberRouteGuard>
  );
}
