"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import { preferredDisplayLine } from "@/lib/displayNames";

type MemberEvent = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  location?: string | null;
  venue_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

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

function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) return "";
  if (startDate && endDate) return `${startDate} – ${endDate}`;
  return startDate || endDate || "";
}

function getStoredMemberAttendeeId() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("fcoc-member-attendee-id");
}

function getStoredMemberEntryId() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("fcoc-member-entry-id");
}

function getStoredMemberEmail() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("fcoc-member-email");
}

function householdLine(member: HouseholdMember) {
  return preferredDisplayLine(member);
}

function MemberCheckinPageInner() {
  const [event, setEvent] = useState<MemberEvent | null>(null);
  const [attendee, setAttendee] = useState<AttendeeRow | null>(null);
  const [household, setHousehold] = useState<HouseholdMember[]>([]);
  const [shareWithAttendees, setShareWithAttendees] = useState(false);
  const [hasArrived, setHasArrived] = useState(false);
  const [siteNumber, setSiteNumber] = useState("");
  const [status, setStatus] = useState("Loading check-in...");
  const [saving, setSaving] = useState(false);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  useEffect(() => {
    void loadPage();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-member-attendee-id" ||
        e.key === "fcoc-member-entry-id" ||
        e.key === "fcoc-member-email" ||
        e.key === "fcoc-member-event-changed"
      ) {
        void loadPage();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  async function loadPage() {
    try {
      setStatus("Loading check-in...");
      setSuccessBanner(null);

      const currentEvent = getCurrentMemberEvent();
      if (!currentEvent?.id) {
        setEvent(null);
        setAttendee(null);
        setHousehold([]);
        setStatus("No current event selected.");
        return;
      }

      setEvent(currentEvent);

      const storedAttendeeId = getStoredMemberAttendeeId();
      const storedEntryId = getStoredMemberEntryId();
      const storedEmail = getStoredMemberEmail()?.toLowerCase() || null;

      const possibleIds = [storedAttendeeId].filter(Boolean);
      const possibleEntryIds = [storedEntryId].filter(Boolean);
      const possibleEmails = [storedEmail].filter(Boolean);

      if (
        possibleIds.length === 0 &&
        possibleEntryIds.length === 0 &&
        possibleEmails.length === 0
      ) {
        setAttendee(null);
        setHousehold([]);
        setStatus("No member identity found for self check-in.");
        return;
      }

      const { data: attendeeRows, error: attendeeError } = await supabase
        .from("attendees")
        .select(
          "id,entry_id,email,pilot_first,pilot_last,copilot_first,copilot_last,assigned_site,share_with_attendees,has_arrived",
        )
        .eq("event_id", currentEvent.id);

      if (attendeeError) throw attendeeError;

      const allAttendees = (attendeeRows || []) as AttendeeRow[];

      let attendeeRow: AttendeeRow | null =
        allAttendees.find(
          (row) => storedAttendeeId && row.id === storedAttendeeId,
        ) ||
        allAttendees.find(
          (row) => storedEntryId && row.entry_id === storedEntryId,
        ) ||
        allAttendees.find(
          (row) =>
            storedEmail && (row.email || "").toLowerCase() === storedEmail,
        ) ||
        null;

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

      if (memberError) throw memberError;
      setHousehold((memberRows || []) as HouseholdMember[]);

      setStatus("Self check-in ready.");
    } catch (err: any) {
      console.error("loadPage error:", err);
      setStatus(err?.message || "Failed to load self check-in.");
    }
  }

  async function saveCheckin() {
    if (!attendee?.id) {
      setStatus("No attendee record found.");
      return;
    }

    try {
      setSaving(true);
      setSuccessBanner(null);

      const cleanedSite = siteNumber.trim();

      const { error } = await supabase
        .from("attendees")
        .update({
          has_arrived: hasArrived,
          share_with_attendees: shareWithAttendees,
          assigned_site: cleanedSite || null,
          arrival_status: hasArrived ? "arrived" : "not_arrived",
        })
        .eq("id", attendee.id);

      if (error) throw error;

      localStorage.setItem("fcoc-member-has-arrived", String(hasArrived));

      const banner = cleanedSite
        ? `Check-in complete. Your site is ${cleanedSite}.`
        : "Check-in complete.";

      setStatus("Your check-in was saved.");
      setSuccessBanner(banner);

      if (hasArrived) {
        window.location.href = "/member/agenda";
        return;
      }

      await loadPage();
    } catch (err: any) {
      console.error("saveCheckin error:", err);
      setStatus(err?.message || "Failed to save check-in.");
    } finally {
      setSaving(false);
    }
  }

  const dateRange = formatDateRange(event?.start_date, event?.end_date);

  const householdSummary = useMemo(() => {
    if (household.length > 0) return household;
    return [];
  }, [household]);

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
          Current event: {event?.name || event?.eventName || "No current event"}
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

        <div style={{ marginTop: 10, fontSize: 13, color: "#666" }}>
          {status}
        </div>
      </div>

      {successBanner ? (
        <div
          style={{
            border: "1px solid #86efac",
            background: "#f0fdf4",
            color: "#166534",
            borderRadius: 10,
            padding: 14,
            fontWeight: 700,
          }}
        >
          {successBanner}
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
            {householdSummary.length > 0 ? (
              <div style={{ display: "grid", gap: 4 }}>
                {householdSummary.map((member) => (
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

          <div style={{ display: "grid", gap: 10, maxWidth: 360 }}>
            <label>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                Site Number
              </div>
              <input
                value={siteNumber}
                onChange={(e) => setSiteNumber(e.target.value)}
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
              {saving ? "Saving..." : "Save Check-In"}
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
