"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useParams } from "next/navigation";
import {
  getCurrentAdminAccess,
  canAccessEvent,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";

type Attendee = {
  id: string;
  event_id: string;
  membership_number: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  email: string | null;
  primary_phone: string | null;
  cell_phone: string | null;
  coach_manufacturer: string | null;
  coach_model: string | null;
  coach_length: string | null;
  assigned_site: string | null;
  is_first_timer: boolean | null;
  wants_to_volunteer: boolean | null;
  handicap_parking: boolean | null;
};

function fullName(first: string | null, last: string | null) {
  return [first, last].filter(Boolean).join(" ").trim();
}

export default function AttendeeProfilePage() {
  const params = useParams();
  const attendeeId = params?.id as string;

  const [attendee, setAttendee] = useState<Attendee | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [status, setStatus] = useState("Loading attendee...");

  useEffect(() => {
    async function loadAttendee() {
      setError(null);
      setAccessDenied(false);
      setStatus("Checking access...");

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setAttendee(null);
        setError("No admin access.");
        setStatus("Access denied.");
        setAccessDenied(true);
        return;
      }

      if (
        !hasPermission(admin, "can_edit_attendees") &&
        !hasPermission(admin, "can_view_reports")
      ) {
        setAttendee(null);
        setError("You do not have permission to view attendee profiles.");
        setStatus("Access denied.");
        setAccessDenied(true);
        return;
      }

      const { data, error } = await supabase
        .from("attendees")
        .select(
          `
          id,
          event_id,
          membership_number,
          pilot_first,
          pilot_last,
          copilot_first,
          copilot_last,
          email,
          primary_phone,
          cell_phone,
          coach_manufacturer,
          coach_model,
          coach_length,
          assigned_site,
          is_first_timer,
          wants_to_volunteer,
          handicap_parking
        `,
        )
        .eq("id", attendeeId)
        .single();

      if (error) {
        setAttendee(null);
        setError(error.message);
        setStatus(`Could not load attendee: ${error.message}`);
        return;
      }

      const typedAttendee = data as Attendee;

      if (!canAccessEvent(admin, typedAttendee.event_id)) {
        setAttendee(null);
        setError("You do not have access to this attendee event.");
        setStatus("Access denied.");
        setAccessDenied(true);
        return;
      }

      setAttendee(typedAttendee);
      setStatus("Loaded");
    }

    if (attendeeId) {
      void loadAttendee();
    }
  }, [attendeeId]);

  if (accessDenied) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Attendee Profile</h1>
        {error ? <p>{error}</p> : <p>{status}</p>}
      </div>
    );
  }

  if (!attendee) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Attendee Profile</h1>
        <p>{error || status}</p>
      </div>
    );
  }

  const pilotName = fullName(attendee.pilot_first, attendee.pilot_last);
  const copilotName = fullName(attendee.copilot_first, attendee.copilot_last);
  const displayedSite = attendee.assigned_site || "Not provided";

  return (
    <div style={{ padding: 24, maxWidth: 760 }}>
      <h1 style={{ marginTop: 0 }}>{pilotName || "Attendee Profile"}</h1>

      <div
        style={{
          border: "1px solid var(--fcoc-border)",
          borderRadius: 10,
          padding: 18,
          background: "white",
        }}
      >
        {copilotName && (
          <p>
            <strong>Co-Pilot:</strong> {copilotName}
          </p>
        )}

        {attendee.membership_number && (
          <p>
            <strong>Member #:</strong> {attendee.membership_number}
          </p>
        )}

        <p>
          <strong>Site:</strong> {displayedSite}
        </p>

        {(attendee.coach_manufacturer ||
          attendee.coach_model ||
          attendee.coach_length) && (
          <p>
            <strong>Coach:</strong>{" "}
            {[
              attendee.coach_manufacturer,
              attendee.coach_model,
              attendee.coach_length,
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
        )}

        {attendee.email && (
          <p>
            <strong>Email:</strong> {attendee.email}
          </p>
        )}

        {(attendee.primary_phone || attendee.cell_phone) && (
          <p>
            <strong>Phone:</strong>{" "}
            {[attendee.primary_phone, attendee.cell_phone]
              .filter(Boolean)
              .join(" / ")}
          </p>
        )}

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 14,
          }}
        >
          {attendee.is_first_timer ? (
            <span
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                background: "#eef6ff",
              }}
            >
              First Timer
            </span>
          ) : null}

          {attendee.wants_to_volunteer ? (
            <span
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                background: "#eefaf0",
              }}
            >
              Volunteer
            </span>
          ) : null}

          {attendee.handicap_parking ? (
            <span
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                background: "#fff6e8",
              }}
            >
              Handicap Parking
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
