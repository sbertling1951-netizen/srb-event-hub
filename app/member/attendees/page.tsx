"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { MemberShellAdapter } from "@/components/shell/adapters/MemberShellAdapter";
import { logEngagement } from "@/lib/engagement";
import { fullName, preferredDisplayLine } from "@/lib/formatters";
import { useMemberWorkspace } from "@/lib/memberWorkspace/useMemberWorkspace";
import { supabase } from "@/lib/supabase";

type Attendee = {
  id: string;
  entry_id: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  email: string | null;
  primary_phone: string | null;
  cell_phone: string | null;
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

function yesNo(value?: boolean | null) {
  return value ? "Yes" : "No";
}

function displayPhone(attendee: Attendee) {
  return attendee.primary_phone || attendee.cell_phone || "";
}

function memberLine(member: HouseholdMember) {
  const full = fullName(member.first_name, member.last_name);

  if (full) {
    return full;
  }

  return (
    member.display_name ||
    preferredDisplayLine(member) ||
    member.raw_text ||
    "—"
  );
}

function getRoleMember(members: HouseholdMember[], role: "pilot" | "copilot") {
  return members.find((m) => m.person_role === role) || null;
}

function AttendeesPageInner() {
  const { event, attendeeId, isReady, session } = useMemberWorkspace();
  const [eventId, setEventId] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>(
    [],
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading attendees...");
  const [error, setError] = useState<string | null>(null);
  const [canViewLocator, setCanViewLocator] = useState(true);

  const loadCurrentEventData = useCallback(async () => {
    setError(null);
    if (!isReady) {
      setEventId(null);
      setAttendees([]);
      setHouseholdMembers([]);
      setCanViewLocator(true);
      return;
    }

    if (!event?.id || !attendeeId) {
      setEventId(null);
      setAttendees([]);
      setHouseholdMembers([]);
      setCanViewLocator(true);
      return;
    }

    setEventId(event.id);
  }, [attendeeId, event?.id, isReady]);

  const loadAttendees = useCallback(
    async (currentEventId: string) => {
      setError(null);

      const identifier =
        session?.attendee_email || session?.attendee_phone || null;
      const rpcArgs = {
        p_event_id: currentEventId,
        p_event_code: session?.event_code || null,
        p_registration_identifier: identifier,
      };

      const { data: ownRecord, error: ownRecordError } = await supabase.rpc(
        "get_my_attendee_record",
        rpcArgs,
      );

      if (ownRecordError) {
        setError(ownRecordError.message);
        setStatus("");
        return;
      }

      const viewer = Array.isArray(ownRecord) ? ownRecord[0] : null;

      if (!viewer?.share_with_attendees) {
        setCanViewLocator(false);
        setAttendees([]);
        setHouseholdMembers([]);
        setStatus(
          "Attendee Locator is available after you choose to share your information with other attendees.",
        );
        return;
      }

      setCanViewLocator(true);
      // Log engagement for Attendee Locator view
      if (currentEventId && attendeeId) {
        void logEngagement({
          eventId: currentEventId,
          attendeeId,
          activityType: "view_attendee_locator",
        });
      }

      const { data, error } = await supabase
        .rpc("get_event_attendee_locator", rpcArgs)
        .order("pilot_last", { ascending: true, nullsFirst: false })
        .order("pilot_first", { ascending: true, nullsFirst: false });

      if (error) {
        setError(error.message);
        setStatus("");
        return;
      }

      const sharedAttendeeRows = ((data || []) as Array<
        Record<string, unknown>
      >).map((row) => ({
        ...row,
        coach_make: (row.coach_manufacturer as string | null) ?? null,
        first_time: row.is_first_timer as boolean | null,
        volunteer: row.wants_to_volunteer as boolean | null,
      })) as unknown as Attendee[];

      setAttendees(sharedAttendeeRows);

      if (sharedAttendeeRows.length === 0) {
        setHouseholdMembers([]);
        setStatus("Loaded 0 shared attendees.");
        return;
      }

      const { data: memberData, error: memberError } = await supabase.rpc(
        "get_event_locator_household_members",
        rpcArgs,
      );

      if (memberError) {
        setError(
          `Loaded attendees, but household members failed: ${memberError.message}`,
        );
        setStatus("");
        setHouseholdMembers([]);
        return;
      }

      setHouseholdMembers((memberData || []) as HouseholdMember[]);
      setStatus(`Loaded ${sharedAttendeeRows.length} shared attendees.`);
    },
    [attendeeId, session],
  );

  useEffect(() => {
    if (!isReady || !event?.id || !attendeeId) {
      setStatus("Loading attendees...");
      return;
    }

    let cancelled = false;

    async function init() {
      setStatus("Loading current event...");
      await loadCurrentEventData();
      if (!cancelled && event?.id && attendeeId) {
        await loadAttendees(event.id);
      }
    }

    void init();

    return () => {
      cancelled = true;
    };
  }, [attendeeId, event?.id, isReady, loadAttendees, loadCurrentEventData]);

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
    if (!q) {
      return attendees;
    }

    return attendees.filter((a) => {
      const pilot = fullName(a.pilot_first, a.pilot_last).toLowerCase();
      const copilot = fullName(a.copilot_first, a.copilot_last).toLowerCase();
      const coach = [a.coach_make, a.coach_model]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const site = (a.assigned_site || "").toLowerCase();
      const email = (a.email || "").toLowerCase();
      const phone = displayPhone(a).toLowerCase();

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

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 1000 }}>
      <p style={{ margin: 0 }}>
        <strong>Welcome! The excitement is already building.</strong> Members
        who have chosen to share their information appear here as they begin
        using the Event Hub.
      </p>

      <p style={{ margin: 0 }}>
        As attendees arrive and complete check-in, additional
        information—including campsite assignments and coach locations (for
        those who choose to share them)—will automatically become available.
      </p>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
        }}
      >
        {status ? (
          <div style={{ fontSize: 13, color: "#555" }}>Status: {status}</div>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            border: "1px solid #fecaca",
            borderRadius: 10,
            background: "#fef2f2",
            color: "#991b1b",
            padding: 14,
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      ) : null}

      {!canViewLocator ? (
        <div
          style={{
            border: "1px solid #f59e0b",
            borderRadius: 10,
            background: "#fffbeb",
            color: "#92400e",
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>
            Attendee Locator is locked
          </div>
          <div>
            Attendee Locator is only available to members who choose to share
            their information with other attendees. Go to My Check-In and turn
            on sharing if you want to use this locator.
          </div>
        </div>
      ) : null}

      {!canViewLocator ? null : (
        <>
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "white",
              padding: 12,
              maxWidth: 420,
              width: "100%",
              minWidth: 0,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Search</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, nickname, email, phone, coach, or site"
              style={{ width: "100%", minWidth: 0, padding: 8 }}
            />
          </div>

          <div style={{ fontSize: 13, color: "#555" }}>
            Showing {filtered.length} attendee{filtered.length === 1 ? "" : "s"}
            .
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {filtered.map((a) => {
              const members = householdByAttendee.get(a.id) || [];

              console.log({
                attendeeId: a.id,
                pilot: a.pilot_last,
                members,
              });
              const pilotMember = getRoleMember(members, "pilot");
              const copilotMember = getRoleMember(members, "copilot");
              const phone = displayPhone(a);

              return (
                <div
                  key={a.id}
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 10,
                    background: "white",
                    padding: 14,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(160px, 1fr))",
                      gap: 12,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                        Pilot:{" "}
                        {pilotMember
                          ? memberLine(pilotMember)
                          : fullName(a.pilot_first, a.pilot_last) || "—"}
                      </div>
                      {a.email ? (
                        <div
                          style={{ fontSize: 12, color: "#666", marginTop: 4, overflowWrap: "anywhere" }}
                        >
                          {a.email}
                        </div>
                      ) : null}
                      {phone ? (
                        <div
                          style={{ fontSize: 12, color: "#666", marginTop: 4, overflowWrap: "anywhere" }}
                        >
                          {phone}
                        </div>
                      ) : null}
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                        Co-Pilot:{" "}
                        {copilotMember
                          ? memberLine(copilotMember)
                          : fullName(a.copilot_first, a.copilot_last) || "—"}
                      </div>
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                        {[a.coach_make, a.coach_model]
                          .filter(Boolean)
                          .join(" ") || "—"}
                      </div>
                      {a.coach_length ? (
                        <div
                          style={{ fontSize: 12, color: "#666", marginTop: 4 }}
                        >
                          {a.coach_length} ft
                        </div>
                      ) : null}
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>Site</div>
                      <div>
                        {a.has_arrived
                          ? a.assigned_site || "—"
                          : "Available after check-in"}
                      </div>
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
                    <div>
                      Status: {a.has_arrived ? "🟢 Arrived" : "🟡 Registered"}
                    </div>
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
                          <div key={member.id} style={{ overflowWrap: "anywhere" }}>
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
        </>
      )}
    </div>
  );
}

export default function AttendeesPage() {
  return (
    <MemberRouteGuard>
      <MemberShellAdapter pageTitle="Attendee Locator">
        <AttendeesPageInner />
      </MemberShellAdapter>
    </MemberRouteGuard>
  );
}
