"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { saveMemberSession } from "@/lib/memberSession";
import { supabase } from "@/lib/supabase";

type EventRow = {
  id: string;
  name: string | null;
  venue_name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
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
  auth_user_id: string | null;
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

function normalizeEventStatus(status?: string | null) {
  return String(status || "")
    .trim()
    .toLowerCase();
}

function isMemberVisibleEvent(event: EventRow, today: string) {
  if (event.visible_to_members === false) {
    return false;
  }

  if (event.is_active === false) {
    return false;
  }

  const normalizedStatus = normalizeEventStatus(event.status);
  if (
    normalizedStatus === "inactive" ||
    normalizedStatus === "archived" ||
    normalizedStatus === "complete" ||
    normalizedStatus === "completed" ||
    normalizedStatus === "closed" ||
    normalizedStatus === "draft"
  ) {
    return false;
  }

  if (event.end_date && event.end_date < today) {
    return false;
  }

  return true;
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      setStatus("Loading events...");
      setError(null);
      const today = new Date().toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("events")
        .select(
          "id,name,venue_name,location,start_date,end_date,lat,lng,visible_to_members,status,is_active",
        )
        .eq("visible_to_members", true)
        .order("start_date", { ascending: true, nullsFirst: false })
        .limit(25);

      if (error) {
        throw error;
      }

      const memberEvents = ((data || []) as EventRow[]).filter((event) =>
        isMemberVisibleEvent(event, today),
      );

      setEvents(memberEvents);

      if (memberEvents.length === 1) {
        setSelectedEventId(memberEvents[0].id);
      }

      setStatus(
        memberEvents.length > 0
          ? "Select an event, enter code, and use your registration email."
          : "No active member events are available right now.",
      );
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load events.");
      setStatus("");
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void handleEnter();
  }

  async function handleEnter() {
    const event = events.find((e) => e.id === selectedEventId);

    if (!event) {
      setError("Select an event.");
      setStatus("");
      return;
    }

    const entered = enteredCode.trim().toLowerCase();
    const normalizedEmail = enteredEmail.trim().toLowerCase();

    if (!entered) {
      setError("Enter the event code.");
      setStatus("");
      return;
    }

    if (!normalizedEmail) {
      setError("Enter the email used for registration.");
      setStatus("");
      return;
    }

    try {
      setBusy(true);
      setStatus("Checking registration...");
      setError(null);

      const { data, error } = await supabase.rpc("verify_member_event_login", {
        p_event_id: event.id,
        p_event_code: entered,
        p_email: normalizedEmail,
      });

      if (error) {
        throw error;
      }

      let attendee =
        Array.isArray(data) && data.length > 0
          ? (data[0] as AttendeeRow)
          : null;

      console.log("MEMBER LOGIN ATTENDEE", attendee);

      if (!attendee?.id) {
        const { data: participants, error: participantError } = await supabase
          .from("attendee_household_members")
          .select("attendee_id,id,first_name,last_name,email")
          .eq("email", normalizedEmail);

        console.log("MEMBER LOGIN PARTICIPANTS", participants);
        console.log("MEMBER LOGIN PARTICIPANT ERROR", participantError);

        if (participants?.length) {
          for (const participant of participants) {
            const { data: attendeeData } = await supabase
              .from("attendees")
              .select(
                "id,entry_id,email,pilot_first,pilot_last,copilot_first,copilot_last,has_arrived,auth_user_id,event_id",
              )
              .eq("id", participant.attendee_id)
              .eq("event_id", event.id)
              .maybeSingle();

            if (attendeeData?.id) {
              attendee = attendeeData as AttendeeRow;

              console.log("MEMBER LOGIN ATTENDEE FROM PARTICIPANT", attendee);

              break;
            }
          }
        }
      }

      if (!attendee?.id) {
        setError(
          "No attendee registration was found for that email in this event.",
        );
        setStatus("");
        return;
      }

      const arrived = !!attendee.has_arrived;

      if (typeof window !== "undefined") {
        localStorage.setItem("fcoc-member-attendee-id", attendee.id);
        localStorage.setItem("fcoc-member-email", normalizedEmail);
        if (attendee.auth_user_id) {
          localStorage.setItem(
            "fcoc-member-auth-user-id",
            attendee.auth_user_id,
          );
        }
        console.log("MEMBER AUTH USER ID", attendee.auth_user_id);
        localStorage.setItem("fcoc-member-entry-id", attendee.entry_id || "");
        localStorage.setItem("fcoc-member-has-arrived", String(arrived));
        localStorage.setItem("fcoc-user-mode", "member");
        localStorage.setItem("fcoc-user-mode-changed", String(Date.now()));
      }

      saveMemberSession({
        event_id: event.id,
        event_name: event.name || null,
        event_code: null,
        venue_name: event.venue_name || null,
        location: event.location || null,
        start_date: event.start_date || null,
        end_date: event.end_date || null,
        lat: event.lat || null,
        lng: event.lng || null,
        login_at: new Date().toISOString(),
        expires_at: event.end_date ? `${event.end_date}T23:59:59` : null,
      });

      setStatus(
        arrived
          ? "Login successful. Opening dashboard..."
          : "Login successful. Opening check-in...",
      );

      router.replace(arrived ? "/member" : "/member/checkin");
      return;
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Login failed.");
      setStatus("");
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

        {status ? (
          <div style={{ fontSize: 13, color: "#666" }}>{status}</div>
        ) : null}

        {error ? (
          <div
            role="alert"
            style={{
              border: "1px solid #fecaca",
              borderRadius: 8,
              background: "#fef2f2",
              color: "#991b1b",
              padding: 12,
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        ) : null}
      </form>
    </div>
  );
}
