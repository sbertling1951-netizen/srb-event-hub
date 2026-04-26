"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { saveMemberSession } from "@/lib/memberSession";
import { supabase } from "@/lib/supabase";

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
  status?: string | null;
  is_active?: boolean | null;
};

type AttendeeRow = {
  id: string;
  entry_id: string | null;
  email: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  has_arrived: boolean | null;
};

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) {
    return "";
  }
  if (startDate && endDate) {
    return `${startDate} – ${endDate}`;
  }
  return startDate || endDate || "";
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  fontSize: 16,
  lineHeight: 1.4,
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  background: "#fff",
  appearance: "none",
  WebkitAppearance: "none",
  boxSizing: "border-box",
};

export default function MemberLoginPage() {
  const router = useRouter();

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
      const today = new Date().toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("events")
        .select(
          "id,name,venue_name,location,start_date,end_date,event_code,lat,lng,visible_to_members,status,is_active",
        )
        .eq("visible_to_members", true)
        .eq("status", "Active")
        .eq("is_active", true)
        .or(`end_date.is.null,end_date.gte.${today}`)
        .order("start_date", { ascending: true, nullsFirst: false });

      if (error) {
        throw error;
      }

      const activeEvents = (data || []) as EventRow[];
      setEvents(activeEvents);
      setStatus(
        activeEvents.length > 0
          ? "Select an event, enter code, and use your registration email."
          : "No active member events are available right now.",
      );
    } catch (err: any) {
      console.error(err);
      setStatus(err?.message || "Failed to load events.");
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void handleEnter();
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
          "id,entry_id,email,pilot_first,pilot_last,copilot_first,copilot_last,has_arrived",
        )
        .eq("event_id", event.id)
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (error) {
        throw error;
      }

      const attendee = data as AttendeeRow | null;

      if (!attendee?.id) {
        setStatus(
          "No attendee registration was found for that email in this event.",
        );
        return;
      }

      localStorage.setItem("fcoc-member-attendee-id", attendee.id);
      localStorage.setItem("fcoc-member-email", normalizedEmail);
      localStorage.setItem("fcoc-member-entry-id", attendee.entry_id || "");
      localStorage.setItem("fcoc-member-has-arrived", "false");
      localStorage.setItem("fcoc-user-mode", "member");
      localStorage.setItem("fcoc-user-mode-changed", String(Date.now()));

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

      setStatus("Login successful. Opening check-in...");
      router.replace("/member/checkin");
      return;
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

      <form
        onSubmit={handleSubmit}
        autoComplete="on"
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 16,
          display: "grid",
          gap: 12,
          position: "relative",
          zIndex: 1,
        }}
      >
        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Select Event</div>
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            style={inputStyle}
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
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            style={inputStyle}
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
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            style={inputStyle}
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            minHeight: 48,
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#0b5cff",
            color: "#ffffff",
            cursor: busy ? "not-allowed" : "pointer",
            fontWeight: 700,
            fontSize: 16,
            lineHeight: 1.2,
            opacity: busy ? 0.7 : 1,
            WebkitAppearance: "none",
            appearance: "none",
          }}
        >
          {busy ? "Checking..." : "Enter"}
        </button>

        <div style={{ fontSize: 13, color: "#666" }}>{status}</div>
      </form>
    </div>
  );
}
