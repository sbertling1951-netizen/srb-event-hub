"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { logEngagement } from "@/lib/engagement";
import { preferredDisplayLine } from "@/lib/formatters";
import { useMemberWorkspace } from "@/lib/memberWorkspace/useMemberWorkspace";
import { supabase } from "@/lib/supabase";

type AttendeeRow = {
  id: string;
  entry_id?: string | null;
  email?: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  assigned_site: string | null;
  share_with_attendees: boolean | null;
  has_arrived: boolean | null;
};

type HouseholdMember = {
  id: string;
  attendee_id: string;
  person_role: "pilot" | "copilot" | "additional";
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  display_name: string | null;
  age_text: string | null;
  sort_order: number | null;
  raw_text: string | null;
};

type CheckinResult = {
  id: string;
  assigned_site: string | null;
  share_with_attendees: boolean;
  has_arrived: boolean;
};

function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) {
    return "";
  }
  if (startDate && endDate) {
    return `${startDate} – ${endDate}`;
  }
  return startDate || endDate || "";
}

function householdLine(member: HouseholdMember) {
  const first = member.first_name?.trim() || "";
  const last = member.last_name?.trim() || "";

  if (first || last) {
    return `${first} ${last}`.trim();
  }

  return preferredDisplayLine(member);
}

function MemberCheckinPageInner() {
  const router = useRouter();
  const { event, attendeeId, isReady } = useMemberWorkspace();
  const [attendee, setAttendee] = useState<AttendeeRow | null>(null);
  const [household, setHousehold] = useState<HouseholdMember[]>([]);
  const [shareWithAttendees, setShareWithAttendees] = useState(false);
  const [hasArrived, setHasArrived] = useState(false);
  const [siteNumber, setSiteNumber] = useState("");
  const [requiresTemporaryCredentials, setRequiresTemporaryCredentials] =
    useState<boolean | null>(null);
  const [temporaryEventCode, setTemporaryEventCode] = useState("");
  const [temporaryRegistrationIdentifier, setTemporaryRegistrationIdentifier] =
    useState("");
  const [status, setStatus] = useState("Loading check-in...");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadPage = useCallback(async () => {
    try {
      setStatus("Loading check-in...");
      setError(null);

      if (!isReady) {
        setStatus("Loading check-in...");
        return;
      }

      if (!event?.id || !attendeeId) {
        setAttendee(null);
        setHousehold([]);
        setStatus("Loading check-in...");
        return;
      }

      const { data: attendeeRow, error: attendeeError } = await supabase
        .from("attendees")
        .select(
          "id,entry_id,email,pilot_first,pilot_last,copilot_first,copilot_last,assigned_site,share_with_attendees,has_arrived",
        )
        .eq("id", attendeeId)
        .eq("event_id", event.id)
        .maybeSingle<AttendeeRow>();

      if (attendeeError) {
        throw attendeeError;
      }

      if (!attendeeRow) {
        setAttendee(null);
        setHousehold([]);
        setStatus(
          "No member identity found for self check-in yet. Member login needs to store attendee identity.",
        );
        return;
      }

      if (typeof window !== "undefined") {
        localStorage.setItem("fcoc-member-attendee-id", attendeeRow.id);
      }

      setAttendee(attendeeRow);

      setShareWithAttendees(!!attendeeRow.share_with_attendees);

      setHasArrived(!!attendeeRow.has_arrived);

      if (typeof window !== "undefined") {
        localStorage.setItem(
          "fcoc-member-has-arrived",
          String(!!attendeeRow.has_arrived),
        );
      }

      setSiteNumber(attendeeRow.assigned_site || "");

      const { data: memberRows, error: memberError } = await supabase
        .from("attendee_household_members")
        .select(
          "id,attendee_id,person_role,first_name,last_name,nickname,display_name,age_text,sort_order,raw_text",
        )
        .eq("attendee_id", attendeeRow.id)
        .order("sort_order", { ascending: true, nullsFirst: false });

      if (memberError) {
        throw memberError;
      }
      setHousehold((memberRows || []) as HouseholdMember[]);

      setStatus("Self check-in ready.");
    } catch (err) {
      console.error("loadPage error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load self check-in.",
      );
      setStatus("");
    }
  }, [attendeeId, event?.id, isReady]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    if (!event?.id || !attendeeId) {
      return;
    }

    void loadPage();
  }, [attendeeId, event?.id, isReady, loadPage]);

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setRequiresTemporaryCredentials(!data.session);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!event?.id) {
      return;
    }

    const storedAttendeeId = localStorage.getItem("fcoc-member-attendee-id");
    if (!storedAttendeeId) {
      return;
    }

    void logEngagement({
      eventId: event.id,
      attendeeId: storedAttendeeId,
      activityType: "checkin_view",
    });
  }, [event?.id]);

  async function saveCheckin() {
    if (!attendee?.id || !event?.id) {
      setStatus("No attendee record found.");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const { data: sessionData } = await supabase.auth.getSession();
      const temporaryAccess = !sessionData.session;

      setRequiresTemporaryCredentials(temporaryAccess);

      if (
        temporaryAccess &&
        (!temporaryEventCode.trim() || !temporaryRegistrationIdentifier.trim())
      ) {
        throw new Error(
          "Enter your event code and registration email or mobile number to save check-in.",
        );
      }

      const { data, error } = await supabase.rpc("submit_member_checkin", {
        p_event_id: event.id,
        p_expected_attendee_id: attendee.id,
        p_has_arrived: hasArrived,
        p_share_with_attendees: shareWithAttendees,
        p_assigned_site: siteNumber,
        p_event_code: temporaryAccess ? temporaryEventCode.trim() : null,
        p_registration_identifier: temporaryAccess
          ? temporaryRegistrationIdentifier.trim()
          : null,
      });

      const updatedAttendee =
        Array.isArray(data) && data.length > 0
          ? (data[0] as CheckinResult)
          : null;

      if (error) {
        throw error;
      }

      if (!updatedAttendee?.id) {
        throw new Error(
          "Check-in verification failed. Re-enter your event code and registration email or mobile number.",
        );
      }

      setAttendee((prev) =>
        prev
          ? {
              ...prev,
              assigned_site: updatedAttendee.assigned_site,
              share_with_attendees: updatedAttendee.share_with_attendees,
              has_arrived: updatedAttendee.has_arrived,
            }
          : prev,
      );
      // Update local state immediately before navigating.
      if (typeof window !== "undefined") {
        localStorage.setItem("fcoc-member-has-arrived", String(hasArrived));
      }

      setStatus("Your check-in preferences were saved.");

      // Use client navigation to avoid reload/race condition.
      router.replace("/member");
      return;
    } catch (err) {
      console.error("saveCheckin error:", err);
      setError(err instanceof Error ? err.message : "Failed to save check-in.");
      setStatus("");
    } finally {
      setSaving(false);
    }
  }

  const dateRange = formatDateRange(event?.start_date, event?.end_date);
  const participantCapacity = event?.participant_capacity ?? 0;
  const participantCount = household.length;
  const availableSlots = Math.max(0, participantCapacity - participantCount);

  return (
    <div style={{ padding: 24, display: "grid", gap: 16, maxWidth: 760 }}>
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>My Check-In</h1>

        <div style={{ fontWeight: 700 }}>
          Current event: {event?.name || "No current event"}
        </div>

        {event?.venue_name ? (
          <div style={{ color: "#555", marginTop: 4 }}>{event.venue_name}</div>
        ) : null}

        {event?.location ? (
          <div style={{ color: "#555", marginTop: 4 }}>{event.location}</div>
        ) : null}

        {dateRange ? (
          <div style={{ color: "#666", marginTop: 4, fontSize: 13 }}>
            {dateRange}
          </div>
        ) : null}

        {status ? (
          <div style={{ marginTop: 10, fontSize: 13, color: "#666" }}>
            {status}
          </div>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#991b1b",
            borderRadius: 10,
            padding: 14,
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      ) : null}

      {!attendee ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            color: "#666",
          }}
        >
          No attendee record is available for self check-in.
        </div>
      ) : (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            display: "grid",
            gap: 14,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Coach / Household
            </div>
            {household.length > 0 ? (
              <div style={{ display: "grid", gap: 4 }}>
                {household.map((member) => (
                  <div key={member.id}>
                    {member.person_role === "pilot"
                      ? "Pilot"
                      : member.person_role === "copilot"
                        ? "Co-Pilot"
                        : "Additional"}
                    : {householdLine(member)}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "#666" }}>
                {attendee.pilot_first || attendee.pilot_last
                  ? `${attendee.pilot_first || ""} ${attendee.pilot_last || ""}`.trim()
                  : "Attendee"}
                {attendee.copilot_first || attendee.copilot_last
                  ? ` / ${`${attendee.copilot_first || ""} ${attendee.copilot_last || ""}`.trim()}`
                  : ""}
              </div>
            )}
          </div>

          {availableSlots > 0 ? (
            <div>
              <Link
                href="/member/participants"
                style={{
                  display: "inline-block",
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  textDecoration: "none",
                  fontWeight: 600,
                  color: "inherit",
                }}
              >
                ➕👤 Add Participant
              </Link>
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 10, maxWidth: 360 }}>
            <label>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                Site Number
              </div>
              <input
                value={siteNumber}
                onChange={(e) => setSiteNumber(e.target.value.toUpperCase())}
                placeholder="Enter your assigned site"
                style={{ width: "100%", padding: 10 }}
              />
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={hasArrived}
                onChange={(e) => setHasArrived(e.target.checked)}
              />
              I have arrived
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={shareWithAttendees}
                onChange={(e) => setShareWithAttendees(e.target.checked)}
              />
              Share my site / household details with other attendees
            </label>

            {requiresTemporaryCredentials ? (
              <div
                style={{
                  borderTop: "1px solid #e2e8f0",
                  paddingTop: 14,
                  display: "grid",
                  gap: 10,
                }}
              >
                <strong>Verify temporary event access</strong>
                <div style={{ color: "#475569", fontSize: 14 }}>
                  Re-enter your event code and the email address or mobile number
                  used for registration to save check-in.
                </div>
                <input
                  type="text"
                  value={temporaryEventCode}
                  onChange={(event) => setTemporaryEventCode(event.target.value)}
                  placeholder="Event code"
                  autoComplete="off"
                />
                <input
                  type="text"
                  value={temporaryRegistrationIdentifier}
                  onChange={(event) =>
                    setTemporaryRegistrationIdentifier(event.target.value)
                  }
                  placeholder="Registration email or mobile number"
                  autoComplete="off"
                />
              </div>
            ) : null}
          </div>

          <div>
            <button
              type="button"
              onClick={() => void saveCheckin()}
              disabled={saving}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MemberCheckinPage() {
  return (
    <MemberRouteGuard>
      <MemberCheckinPageInner />
    </MemberRouteGuard>
  );
}
