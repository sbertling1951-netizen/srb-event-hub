"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { fullName, preferredDisplayLine } from "@/lib/displayNames";

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

type MemberEventRow = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

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

function memberLine(member: HouseholdMember) {
  return preferredDisplayLine(member);
}

function getRoleMember(members: HouseholdMember[], role: "pilot" | "copilot") {
  return members.find((m) => m.person_role === role) || null;
}

function AttendeesPageInner() {
  const [event, setEvent] = useState<MemberEventRow | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>(
    [],
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading attendees...");

  async function loadCurrentEventData() {
    const currentEvent = getCurrentMemberEvent();

    if (!currentEvent?.id) {
      setEvent(null);
      setEventId(null);
      setAttendees([]);
      setHouseholdMembers([]);
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
        "id,pilot_first,pilot_last,copilot_first,copilot_last,email,phone,coach_make,coach_model,coach_length,first_time,volunteer,handicap_parking,assigned_site,share_with_attendees,has_arrived",
      )
      .eq("event_id", currentEventId)
      .order("pilot_last", { ascending: true, nullsFirst: false })
      .order("pilot_first", { ascending: true, nullsFirst: false });

    if (error) {
      setStatus(`Could not load attendees: ${error.message}`);
      return;
    }

    const attendeeRows = (data || []) as Attendee[];
    setAttendees(attendeeRows);

    const attendeeIds = attendeeRows.map((a) => a.id);
    if (attendeeIds.length === 0) {
      setHouseholdMembers([]);
      setStatus("Loaded 0 attendees.");
      return;
    }

    const { data: memberData, error: memberError } = await supabase
      .from("attendee_household_members")
      .select(
        "id,attendee_id,person_role,first_name,last_name,nickname,display_name,age_text,sort_order,raw_text",
      )
      .in("attendee_id", attendeeIds)
      .order("sort_order", { ascending: true, nullsFirst: false });

    if (memberError) {
      setStatus(
        `Loaded attendees, but household members failed: ${memberError.message}`,
      );
      setHouseholdMembers([]);
      return;
    }

    setHouseholdMembers((memberData || []) as HouseholdMember[]);
    setStatus(`Loaded ${attendeeRows.length} attendees.`);
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

  const householdByAttendee = useMemo(() => {
    const map = new Map<string, HouseholdMember[]>();
    householdMembers.forEach((member) => {
      const existing = map.get(member.attendee_id) || [];
      existing.push(member);
      map.set(member.attendee_id, existing);
    });
    return map;
  }, [householdMembers]);

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
      const email = (a.email || "").toLowerCase();
      const phone = (a.phone || "").toLowerCase();

      const members = (householdByAttendee.get(a.id) || [])
        .map((m) =>
          [
            m.display_name || "",
            m.first_name || "",
            m.last_name || "",
            m.nickname || "",
            m.raw_text || "",
          ]
            .join(" ")
            .toLowerCase(),
        )
        .join(" ");

      return (
        pilot.includes(q) ||
        copilot.includes(q) ||
        coach.includes(q) ||
        site.includes(q) ||
        email.includes(q) ||
        phone.includes(q) ||
        members.includes(q)
      );
    });
  }, [attendees, householdByAttendee, search]);

  const dateRange = formatDateRange(event?.start_date, event?.end_date);

  return (
    <div style={{ padding: 24 }}>
      <h1>Attendee Locator</h1>
      <p>
        Search the current event attendee list by name, nickname, coach, email,
        phone, site, or household member.
      </p>

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
          placeholder="Name, nickname, email, phone, coach, or site"
          style={{ width: "100%", padding: 8 }}
        />
      </div>

      <div style={{ marginBottom: 12, fontSize: 13, color: "#555" }}>
        Showing {filtered.length} attendee{filtered.length === 1 ? "" : "s"}.
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {filtered.map((a) => {
          const members = householdByAttendee.get(a.id) || [];
          const pilotMember = getRoleMember(members, "pilot");
          const copilotMember = getRoleMember(members, "copilot");

          return (
            <div
              key={a.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 10,
                background: "white",
                padding: 14,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1.4fr 1fr 0.9fr",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>
                    Pilot:{" "}
                    {pilotMember
                      ? memberLine(pilotMember)
                      : fullName(a.pilot_first, a.pilot_last) || "—"}
                  </div>
                  {a.email ? (
                    <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                      {a.email}
                    </div>
                  ) : null}
                  {a.phone ? (
                    <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                      {a.phone}
                    </div>
                  ) : null}
                </div>

                <div>
                  <div style={{ fontWeight: 700 }}>
                    Co-Pilot:{" "}
                    {copilotMember
                      ? memberLine(copilotMember)
                      : fullName(a.copilot_first, a.copilot_last) || "—"}
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 700 }}>
                    {[a.coach_make, a.coach_model].filter(Boolean).join(" ") ||
                      "—"}
                  </div>
                  {a.coach_length ? (
                    <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                      {a.coach_length} ft
                    </div>
                  ) : null}
                </div>

                <div>
                  <div style={{ fontWeight: 700 }}>Site</div>
                  <div>{a.assigned_site || "—"}</div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 16,
                  flexWrap: "wrap",
                  marginTop: 10,
                  fontSize: 13,
                  color: "#555",
                }}
              >
                <div>Arrived: {yesNo(a.has_arrived)}</div>
                <div>1st Time: {yesNo(a.first_time)}</div>
                <div>Volunteer: {yesNo(a.volunteer)}</div>
                <div>Handicap: {yesNo(a.handicap_parking)}</div>
                <div>
                  Shares with attendees: {yesNo(a.share_with_attendees)}
                </div>
              </div>

              {members.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    Coach / Household Members
                  </div>
                  <div style={{ display: "grid", gap: 4, fontSize: 14 }}>
                    {members.map((member) => (
                      <div key={member.id}>
                        {member.person_role === "pilot"
                          ? "Pilot"
                          : member.person_role === "copilot"
                            ? "Co-Pilot"
                            : "Additional"}
                        : {memberLine(member)}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}

        {filtered.length === 0 ? (
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "white",
              padding: 16,
              color: "#666",
            }}
          >
            No attendees found.
          </div>
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
