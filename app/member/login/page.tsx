"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { saveMemberSession } from "@/lib/memberSession";

type EventRow = {
  id: string;
  name: string | null;
  venue_name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  event_code: string | null;
  lat: number | null;
  lng: number | null;
  visible_to_members?: boolean | null;
};

type AttendeeRow = {
  id: string;
  entry_id: string | null;
  email: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
};

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) return "";
  if (startDate && endDate) return `${startDate} – ${endDate}`;
  return startDate || endDate || "";
}

export default function MemberLoginPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [enteredCode, setEnteredCode] = useState("");
  const [enteredEmail, setEnteredEmail] = useState("");
  const [status, setStatus] = useState("Loading events...");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadEvents();
  }, []);

  async function loadEvents() {
    try {
      const { data, error } = await supabase
        .from("events")
        .select(
          "id,name,venue_name,location,start_date,end_date,event_code,lat,lng,visible_to_members",
        )
        .eq("visible_to_members", true)
        .order("start_date", { ascending: true, nullsFirst: false });

      if (error) throw error;

      setEvents((data || []) as EventRow[]);
      setStatus(
        "Select an event, enter code, and use your registration email.",
      );
    } catch (err: any) {
      console.error(err);
      setStatus(err?.message || "Failed to load events.");
    }
  }

  async function handleEnter() {
    const event = events.find((e) => e.id === selectedEventId);

    if (!event) {
      setStatus("Select an event.");
      return;
    }

    const expected = (event.event_code || "").trim().toLowerCase();
    const entered = enteredCode.trim().toLowerCase();
    const normalizedEmail = enteredEmail.trim().toLowerCase();

    if (!entered) {
      setStatus("Enter the event code.");
      return;
    }

    if (entered !== expected) {
      setStatus("Incorrect event code.");
      return;
    }

    if (!normalizedEmail) {
      setStatus("Enter the email used for registration.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Checking registration...");

      const { data, error } = await supabase
        .from("attendees")
        .select(
          "id,entry_id,email,pilot_first,pilot_last,copilot_first,copilot_last",
        )
        .eq("event_id", event.id)
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (error) throw error;

      const attendee = data as AttendeeRow | null;

      if (!attendee?.id) {
        setStatus(
          "No attendee registration was found for that email in this event.",
        );
        setBusy(false);
        return;
      }

      localStorage.setItem("fcoc-member-attendee-id", attendee.id);
      localStorage.setItem("fcoc-member-email", normalizedEmail);
      localStorage.setItem("fcoc-member-entry-id", attendee.entry_id || "");

      saveMemberSession({
        event_id: event.id,
        event_name: event.name || null,
        event_code: event.event_code || null,
        venue_name: event.venue_name || null,
        location: event.location || null,
        start_date: event.start_date || null,
        end_date: event.end_date || null,
        lat: event.lat || null,
        lng: event.lng || null,
        login_at: new Date().toISOString(),
        expires_at: event.end_date ? `${event.end_date}T23:59:59` : null,
      });

      window.location.href = `/nearby?event=${event.id}`;
    } catch (err: any) {
      console.error(err);
      setStatus(err?.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 700, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Member Login</h1>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Select Event</div>
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            style={{ width: "100%", padding: 10 }}
          >
            <option value="">Choose an event</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name || "Untitled event"}
                {event.start_date
                  ? ` — ${formatDateRange(event.start_date, event.end_date)}`
                  : ""}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Enter Code</div>
          <input
            type="text"
            value={enteredCode}
            onChange={(e) => setEnteredCode(e.target.value)}
            placeholder="Event code"
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Registration Email
          </div>
          <input
            type="email"
            value={enteredEmail}
            onChange={(e) => setEnteredEmail(e.target.value)}
            placeholder="Email used for registration"
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <button
          type="button"
          onClick={() => void handleEnter()}
          disabled={busy}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {busy ? "Checking..." : "Enter"}
        </button>

        <div style={{ fontSize: 13, color: "#666" }}>{status}</div>
      </div>
    </div>
  );
}
